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

func (s *Server) handleListGeofences(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.store.Geofences())
}

func (s *Server) handleCreateGeofence(w http.ResponseWriter, r *http.Request) {
	var in store.GeofenceInput
	if err := decodeJSON(w, r, &in); err != nil {
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
	g, err := s.store.UpdateGeofence(r.Context(), id, p)
	if err != nil {
		s.failAs(w, r, err, geofenceNotFound)
		return
	}
	writeJSON(w, http.StatusOK, g)
}

func (s *Server) handleDeleteGeofence(w http.ResponseWriter, r *http.Request) {
	id, err := geofenceID(r)
	if err == nil {
		err = s.store.DeleteGeofence(r.Context(), id)
	}
	if err != nil {
		s.failAs(w, r, err, geofenceNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
