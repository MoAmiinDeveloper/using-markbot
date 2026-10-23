package api

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/moamiindeveloper/fleet/server/internal/reports"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// handleReportTypes lists the report types: [{"type", "title"}].
func (s *Server) handleReportTypes(w http.ResponseWriter, _ *http.Request) {
	out := make([]map[string]string, len(reports.Types))
	for i, t := range reports.Types {
		out[i] = map[string]string{"type": t.Type, "title": t.Title}
	}
	writeJSON(w, http.StatusOK, out)
}

// location parses ?tz= (IANA name, default UTC).
func location(r *http.Request) (*time.Location, error) {
	tz := strings.TrimSpace(r.URL.Query().Get("tz"))
	if tz == "" {
		return time.UTC, nil
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return nil, &store.ValidationError{Msg: "tz must be an IANA time zone such as Africa/Mogadishu"}
	}
	return loc, nil
}

// parseIDList parses "1,2,3".
func parseIDList(v, name string) ([]int64, error) {
	var out []int64
	for _, p := range strings.Split(v, ",") {
		if p = strings.TrimSpace(p); p == "" {
			continue
		}
		id, err := strconv.ParseInt(p, 10, 64)
		if err != nil || id <= 0 {
			return nil, &store.ValidationError{Msg: name + " must be a comma-separated list of positive integers"}
		}
		out = append(out, id)
	}
	return out, nil
}

// visibleDevices returns the devices a report covers: ?deviceIds= and/or
// ?groupId=, always within the caller's scope. all is set when no filter
// was given.
func (s *Server) visibleDevices(r *http.Request) (devs []store.Device, all bool, err error) {
	q := r.URL.Query()
	scopeAll, scope := s.deviceScope(r)
	visible := func(id int64) bool { return scopeAll || scope[id] }
	ids, err := parseIDList(q.Get("deviceIds"), "deviceIds")
	if err != nil {
		return nil, false, err
	}
	for _, id := range ids {
		if !visible(id) {
			return nil, false, store.ErrNotFound
		}
		if _, err := s.store.Device(id); err != nil {
			return nil, false, err
		}
	}
	var group map[int64]bool
	if v := q.Get("groupId"); v != "" {
		gid, err := strconv.ParseInt(v, 10, 64)
		if err != nil || gid <= 0 {
			return nil, false, &store.ValidationError{Msg: "groupId must be a positive integer"}
		}
		gids, err := s.store.GroupDeviceIDs(r.Context(), gid)
		if errors.Is(err, store.ErrNotFound) {
			return nil, false, &notFoundError{"group not found"}
		}
		if err != nil {
			return nil, false, err
		}
		group = make(map[int64]bool, len(gids))
		for _, id := range gids {
			group[id] = true
		}
	}
	for _, d := range s.store.Devices() {
		if !visible(d.ID) || (len(ids) > 0 && !slices.Contains(ids, d.ID)) || (group != nil && !group[d.ID]) {
			continue
		}
		devs = append(devs, d)
	}
	return devs, len(ids) == 0 && group == nil, nil
}

// notFoundError is a 404 with a specific message.
type notFoundError struct{ msg string }

func (e *notFoundError) Error() string { return e.msg }

func (s *Server) reportFail(w http.ResponseWriter, r *http.Request, err error) {
	var nf *notFoundError
	if errors.As(err, &nf) {
		writeError(w, http.StatusNotFound, nf.msg)
		return
	}
	s.fail(w, r, err)
}

func (s *Server) handleReport(w http.ResponseWriter, r *http.Request) {
	typ := chi.URLParam(r, "type")
	if reports.Title(typ) == "" {
		writeError(w, http.StatusNotFound, "unknown report type "+strconv.Quote(typ))
		return
	}
	q := r.URL.Query()
	format := strings.ToLower(q.Get("format"))
	if format == "" {
		format = reports.FormatJSON
	}
	if !slices.Contains([]string{reports.FormatJSON, reports.FormatCSV, reports.FormatXLSX, reports.FormatPDF}, format) {
		writeError(w, http.StatusBadRequest, "format must be json, csv, xlsx or pdf")
		return
	}
	from, to, err := timeRange(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if to.Sub(from) > reports.MaxRange {
		writeError(w, http.StatusBadRequest, "the period must not exceed 93 days")
		return
	}
	loc, err := location(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var driverID int64
	if v := q.Get("driverId"); v != "" {
		if driverID, err = strconv.ParseInt(v, 10, 64); err != nil || driverID <= 0 {
			writeError(w, http.StatusBadRequest, "driverId must be a positive integer")
			return
		}
	}
	devs, all, err := s.visibleDevices(r)
	if err != nil {
		s.reportFail(w, r, err)
		return
	}
	now := time.Now()
	rep, err := s.cfg.Reports.Run(r.Context(), reports.Request{Type: typ, Devices: devs, DriverID: driverID,
		From: from, To: to, Loc: loc, Now: now, AllDevices: all})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if format == reports.FormatJSON {
		writeJSON(w, http.StatusOK, rep)
		return
	}
	var buf bytes.Buffer
	switch format {
	case reports.FormatCSV:
		err = reports.WriteCSV(&buf, rep, loc)
	case reports.FormatXLSX:
		err = reports.WriteXLSX(&buf, rep, loc, now)
	case reports.FormatPDF:
		err = reports.WritePDF(&buf, rep, loc, now)
	}
	if err != nil {
		s.fail(w, r, fmt.Errorf("export %s: %w", format, err))
		return
	}
	h := w.Header()
	h.Set("Content-Type", reports.ContentType(format))
	h.Set("Content-Disposition", `attachment; filename="`+reports.Filename(rep, loc, format)+`"`)
	h.Set("Content-Length", strconv.Itoa(buf.Len()))
	h.Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = buf.WriteTo(w)
}
