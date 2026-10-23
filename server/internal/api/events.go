package api

import (
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

const (
	defaultEventLimit = 200
	maxEventLimit     = 5000
	defaultEventRange = 7 * 24 * time.Hour
)

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := store.EventFilter{Limit: defaultEventLimit}
	var err error
	if f.From, f.To, err = timeRange(r); err != nil {
		s.fail(w, r, err)
		return
	}
	if q.Get("from") == "" {
		f.From = f.To.Add(-defaultEventRange)
	}
	if v := q.Get("deviceId"); v != "" {
		if f.DeviceID, err = strconv.ParseInt(v, 10, 64); err != nil || f.DeviceID <= 0 {
			writeError(w, http.StatusBadRequest, "deviceId must be a positive integer")
			return
		}
	}
	for _, t := range strings.Split(q.Get("type"), ",") {
		if t = strings.TrimSpace(t); t == "" {
			continue
		}
		if !slices.Contains(store.EventTypes, t) {
			writeError(w, http.StatusBadRequest, "unknown event type "+strconv.Quote(t))
			return
		}
		f.Types = append(f.Types, t)
	}
	if v := q.Get("limit"); v != "" {
		if f.Limit, err = strconv.Atoi(v); err != nil || f.Limit <= 0 {
			writeError(w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		f.Limit = min(f.Limit, maxEventLimit)
	}
	f.Scoped, f.DeviceIDs = false, nil
	if all, ids := s.scopeIDs(r); !all {
		f.Scoped, f.DeviceIDs = true, ids
	}
	evs, err := s.store.Events(r.Context(), f)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, evs)
}

func geofenceID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, store.ErrNotFound
	}
	return id, nil
}

const geofenceNotFound = "geofence not found"

// handleListGeofences returns, for non-admins, the geofences that apply to
// all devices or to at least one visible device, with deviceIds narrowed to
// the visible ones.
func (s *Server) handleListGeofences(w http.ResponseWriter, r *http.Request) {
	all, ids := s.deviceScope(r)
	gs := s.store.Geofences()
	if all {
		writeJSON(w, http.StatusOK, gs)
		return
	}
	out := make([]store.Geofence, 0, len(gs))
	for _, g := range gs {
		if len(g.DeviceIDs) == 0 {
			out = append(out, g)
			continue
		}
		var visible []int64
		for _, id := range g.DeviceIDs {
			if ids[id] {
				visible = append(visible, id)
			}
		}
		if len(visible) > 0 {
			g.DeviceIDs = visible
			out = append(out, g)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// checkGeofenceDevices enforces the manager rule: a manager may only write
// geofences assigned to devices of their groups (non-empty deviceIds, all
// visible). Geofences for all devices (deviceIds []) are admin-only.
func (s *Server) checkGeofenceDevices(r *http.Request, deviceIDs []int64) error {
	all, ids := s.deviceScope(r)
	if all {
		return nil
	}
	if len(deviceIDs) == 0 {
		return errForbidden("only admins can manage geofences that apply to all devices")
	}
	for _, id := range deviceIDs {
		if !ids[id] {
			return errForbidden("geofence includes devices outside your groups")
		}
	}
	return nil
}

func (s *Server) geofenceByID(id int64) (store.Geofence, error) {
	for _, g := range s.store.Geofences() {
		if g.ID == id {
			return g, nil
		}
	}
	return store.Geofence{}, store.ErrNotFound
}

func (s *Server) handleCreateGeofence(w http.ResponseWriter, r *http.Request) {
	var in store.GeofenceInput
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	if err := s.checkGeofenceDevices(r, in.DeviceIDs); err != nil {
		s.fail(w, r, err)
		return
	}
	g, err := s.store.CreateGeofence(r.Context(), in)
	if err != nil {
		s.failAs(w, r, err, geofenceNotFound)
		return
	}
	writeJSON(w, http.StatusCreated, g)
}

func (s *Server) handleUpdateGeofence(w http.ResponseWriter, r *http.Request) {
	id, err := geofenceID(r)
	if err != nil {
		s.failAs(w, r, err, geofenceNotFound)
		return
	}
	var p store.GeofencePatch
	if err := decodeJSON(w, r, &p); err != nil {
		s.fail(w, r, err)
		return
	}
	cur, err := s.geofenceByID(id)
	if err == nil {
		err = s.checkGeofenceDevices(r, cur.DeviceIDs)
	}
	if err == nil && p.DeviceIDs != nil {
		err = s.checkGeofenceDevices(r, *p.DeviceIDs)
	}
	if err != nil {
		s.failAs(w, r, err, geofenceNotFound)
		return
	}
	g, err := s.store.UpdateGeofence(r.Context(), id, p)
	if err != nil {
		s.failAs(w, r, err, geofenceNotFound)
		return
	}
	writeJSON(w, http.StatusOK, g)
}

func (s *Server) handleDeleteGeofence(w http.ResponseWriter, r *http.Request) {
	id, err := geofenceID(r)
	var cur store.Geofence
	if err == nil {
		cur, err = s.geofenceByID(id)
	}
	if err == nil {
		err = s.checkGeofenceDevices(r, cur.DeviceIDs)
	}
	if err == nil {
		err = s.store.DeleteGeofence(r.Context(), id)
	}
	if err != nil {
		s.failAs(w, r, err, geofenceNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
