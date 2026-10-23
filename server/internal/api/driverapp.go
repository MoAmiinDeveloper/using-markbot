package api

import (
	"context"
	"errors"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

type driverCtxKey struct{}

// requireDriverApp resolves the driver behind /driver/*: the driver linked
// to the login, or for admins/managers testing the app ?driverId=<id>
// (a driver they can see). Viewers and unlinked accounts get 403.
func (s *Server) requireDriverApp(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := principalFrom(r.Context())
		var (
			d   store.Driver
			err error
		)
		switch {
		case p.Role == store.RoleDriver || (r.URL.Query().Get("driverId") == "" && canManage(r)):
			d, err = s.store.DriverByUser(r.Context(), p.UserID)
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusForbidden, "no driver profile is linked to this account")
				return
			}
		case canManage(r):
			var id int64
			if id, err = queryID(r, "driverId"); err == nil {
				d, err = s.store.Driver(r.Context(), id)
				if all, ids := s.deviceScope(r); err == nil && !driverVisible(all, ids, &d) {
					err = store.ErrNotFound
				}
			}
		default:
			writeError(w, http.StatusForbidden, "driver role required")
			return
		}
		if err != nil {
			s.failAs(w, r, err, driverNotFound)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), driverCtxKey{}, d)))
	})
}

func driverFrom(r *http.Request) store.Driver {
	d, _ := r.Context().Value(driverCtxKey{}).(store.Driver)
	return d
}

// driverJob loads {id} and checks it belongs to the request's driver.
func (s *Server) driverJob(w http.ResponseWriter, r *http.Request) (store.Job, bool) {
	id, err := pathID(r)
	var j store.Job
	if err == nil {
		j, err = s.store.Job(r.Context(), id)
	}
	if d := driverFrom(r); err == nil && (j.DriverID == nil || *j.DriverID != d.ID) {
		err = store.ErrNotFound
	}
	if err != nil {
		s.failAs(w, r, err, jobNotFound)
		return j, false
	}
	return j, true
}

func (s *Server) handleDriverMe(w http.ResponseWriter, r *http.Request) {
	d := driverFrom(r)
	u, err := s.store.UserByID(r.Context(), principalFrom(r.Context()).UserID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var vehicle *store.Device
	if d.DeviceID != nil {
		if dev, err := s.store.Device(*d.DeviceID); err == nil {
			vehicle = &dev
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u, "driver": d, "vehicle": vehicle})
}

var (
	activeJobStatuses  = []string{store.JobUnassigned, store.JobAssigned, store.JobAccepted, store.JobEnRoute, store.JobArrived, store.JobInProgress}
	historyJobStatuses = []string{store.JobCompleted, store.JobFailed, store.JobCancelled}
)

func (s *Server) handleDriverJobs(w http.ResponseWriter, r *http.Request) {
	f := store.JobFilter{DriverID: driverFrom(r).ID, Scope: store.Scope{All: true}}
	switch r.URL.Query().Get("status") {
	case "", "active":
		f.Statuses = activeJobStatuses
	case "history":
		f.Statuses, f.Limit = historyJobStatuses, 200
	default:
		writeError(w, http.StatusBadRequest, "status must be active or history")
		return
	}
	jobs, err := s.store.Jobs(r.Context(), f)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, jobs)
}

func (s *Server) handleDriverJob(w http.ResponseWriter, r *http.Request) {
	if j, ok := s.driverJob(w, r); ok {
		writeJSON(w, http.StatusOK, j)
	}
}

func (s *Server) handleDriverJobStatus(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.driverJob(w, r)
	if !ok {
		return
	}
	var req statusRequest
	if err := decodeJSON(w, r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	j, err := s.cfg.Dispatch.SetStatus(r.Context(), cur.ID, req.Status, req.Reason,
		principalFrom(r.Context()).UserID, true, locationData(req.Lat, req.Lng))
	if err != nil {
		s.failDispatch(w, r, err, jobNotFound)
		return
	}
	writeJSON(w, http.StatusOK, j)
}

func (s *Server) handleDriverStop(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.driverJob(w, r)
	if !ok {
		return
	}
	stopID, err := strconv.ParseInt(chi.URLParam(r, "stopId"), 10, 64)
	if err != nil || stopID <= 0 {
		writeError(w, http.StatusNotFound, "stop not found")
		return
	}
	var req struct {
		Status string   `json:"status"`
		Notes  *string  `json:"notes"`
		Lat    *float64 `json:"lat"`
		Lng    *float64 `json:"lng"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	j, err := s.cfg.Dispatch.UpdateStop(r.Context(), cur.ID, stopID, req.Status, req.Notes,
		principalFrom(r.Context()).UserID, locationData(req.Lat, req.Lng))
	if err != nil {
		s.failDispatch(w, r, err, "stop not found")
		return
	}
	writeJSON(w, http.StatusOK, j)
}

func (s *Server) handleDriverChecklist(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.driverJob(w, r)
	if !ok {
		return
	}
	itemID, err := strconv.ParseInt(chi.URLParam(r, "itemId"), 10, 64)
	if err != nil || itemID <= 0 {
		writeError(w, http.StatusNotFound, "checklist item not found")
		return
	}
	var req struct {
		Done *bool `json:"done"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	if req.Done == nil {
		writeError(w, http.StatusBadRequest, "done is required")
		return
	}
	j, err := s.cfg.Dispatch.SetChecklist(r.Context(), cur.ID, itemID, *req.Done, principalFrom(r.Context()).UserID)
	if err != nil {
		s.failDispatch(w, r, err, "checklist item not found")
		return
	}
	writeJSON(w, http.StatusOK, j)
}

func (s *Server) handleDriverAttachment(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.driverJob(w, r)
	if !ok {
		return
	}
	s.upload(w, r, cur)
}

func (s *Server) handleDriverNote(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.driverJob(w, r)
	if !ok {
		return
	}
	var req struct {
		Text string `json:"text"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	j, err := s.cfg.Dispatch.AddNote(r.Context(), cur.ID, req.Text, principalFrom(r.Context()).UserID)
	if err != nil {
		s.failDispatch(w, r, err, jobNotFound)
		return
	}
	writeJSON(w, http.StatusOK, j)
}

// maxLocationAge rejects stale phone fixes; maxLocationSkew future ones.
const (
	maxLocationAge  = 7 * 24 * time.Hour
	maxLocationSkew = 5 * time.Minute
)

func (s *Server) handleDriverLocation(w http.ResponseWriter, r *http.Request) {
	d := driverFrom(r)
	var req struct {
		Lat      *float64 `json:"lat"`
		Lng      *float64 `json:"lng"`
		Speed    *float64 `json:"speed"`    // km/h
		Course   *float64 `json:"course"`   // degrees
		Accuracy *float64 `json:"accuracy"` // m
		Altitude *float64 `json:"altitude"` // m
		Time     string   `json:"time"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	switch {
	case req.Lat == nil || req.Lng == nil || !(*req.Lat >= -90 && *req.Lat <= 90 && *req.Lng >= -180 && *req.Lng <= 180) ||
		(*req.Lat == 0 && *req.Lng == 0):
		writeError(w, http.StatusBadRequest, "lat and lng are required (lat in [-90, 90], lng in [-180, 180])")
		return
	case req.Speed != nil && !(*req.Speed >= 0 && *req.Speed <= 500):
		writeError(w, http.StatusBadRequest, "speed must be between 0 and 500 km/h")
		return
	case req.Course != nil && !(*req.Course >= 0 && *req.Course <= 360):
		writeError(w, http.StatusBadRequest, "course must be between 0 and 360")
		return
	case req.Accuracy != nil && !(*req.Accuracy >= 0 && *req.Accuracy < 1e6):
		writeError(w, http.StatusBadRequest, "accuracy must be a non-negative number of meters")
		return
	case req.Altitude != nil && (math.IsNaN(*req.Altitude) || math.Abs(*req.Altitude) > 1e5):
		writeError(w, http.StatusBadRequest, "altitude is out of range")
		return
	}
	now := time.Now().UTC()
	t := now
	if req.Time != "" {
		var err error
		if t, err = time.Parse(time.RFC3339, req.Time); err != nil {
			writeError(w, http.StatusBadRequest, "time must be an RFC 3339 time")
			return
		}
		if t.After(now.Add(maxLocationSkew)) || t.Before(now.Add(-maxLocationAge)) {
			writeError(w, http.StatusBadRequest, "time must be within the last 7 days")
			return
		}
	}
	// Phone GPS is stored only for drivers without a vehicle, unless the
	// driverAppTracking setting asks for it anyway.
	if d.DeviceID != nil && !s.store.Settings().DriverAppTracking {
		writeJSON(w, http.StatusOK, map[string]any{"stored": false, "deviceId": nil})
		return
	}
	dev, err := s.store.EnsureDriverAppDevice(r.Context(), d.ID, d.Name)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	p := domain.Position{IMEI: dev.IMEI, Protocol: store.ProtocolDriverApp, DeviceTime: t.UTC(), ServerTime: now,
		Latitude: *req.Lat, Longitude: *req.Lng, Valid: true, Attributes: map[string]any{}}
	if req.Speed != nil {
		p.Speed = *req.Speed
	}
	if req.Course != nil {
		p.Course = *req.Course
	}
	if req.Altitude != nil {
		p.Altitude = *req.Altitude
	}
	if req.Accuracy != nil {
		p.Attributes["accuracy"] = *req.Accuracy
	}
	p.Attributes[domain.AttrMotion] = p.Speed > store.MovingSpeed
	if err := s.store.Positions(r.Context(), []domain.Position{p}); err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"stored": true, "deviceId": dev.ID})
}

func (s *Server) handleDriverUpdates(w http.ResponseWriter, r *http.Request) {
	now := time.Now().UTC()
	f := store.JobFilter{DriverID: driverFrom(r).ID, Scope: store.Scope{All: true}, Limit: 1000}
	if v := r.URL.Query().Get("since"); v != "" {
		since, err := time.Parse(time.RFC3339, v)
		if err != nil {
			writeError(w, http.StatusBadRequest, "since must be an RFC 3339 time")
			return
		}
		f.UpdatedSince, f.OrDriverWas = since, true
	} else {
		f.Statuses = activeJobStatuses
	}
	jobs, err := s.store.Jobs(r.Context(), f)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"jobs": jobs, "now": now})
}
