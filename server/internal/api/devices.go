package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

const (
	defaultPositionLimit = 10000
	maxPositionLimit     = 100000
	defaultRange         = 24 * time.Hour
)

// deviceID parses the {id} URL parameter; invalid ids are reported as not found.
func deviceID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, store.ErrNotFound
	}
	return id, nil
}

func (s *Server) handleListDevices(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.store.Devices())
}

func (s *Server) handleGetDevice(w http.ResponseWriter, r *http.Request) {
	id, err := deviceID(r)
	if err == nil {
		var d store.Device
		if d, err = s.store.Device(id); err == nil {
			writeJSON(w, http.StatusOK, d)
			return
		}
	}
	s.fail(w, r, err)
}

func (s *Server) handleCreateDevice(w http.ResponseWriter, r *http.Request) {
	var in store.DeviceInput
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	d, err := s.store.CreateDevice(r.Context(), in)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, d)
}

func (s *Server) handleUpdateDevice(w http.ResponseWriter, r *http.Request) {
	id, err := deviceID(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var p store.DevicePatch
	if err := decodeJSON(w, r, &p); err != nil {
		s.fail(w, r, err)
		return
	}
	d, err := s.store.UpdateDevice(r.Context(), id, p)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) handleDeleteDevice(w http.ResponseWriter, r *http.Request) {
	id, err := deviceID(r)
	if err == nil {
		err = s.store.DeleteDevice(r.Context(), id)
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// timeRange parses ?from=&to= (RFC 3339), defaulting to the last 24 hours.
func timeRange(r *http.Request) (from, to time.Time, err error) {
	q := r.URL.Query()
	to = time.Now().UTC()
	if v := q.Get("to"); v != "" {
		if to, err = time.Parse(time.RFC3339, v); err != nil {
			return from, to, &store.ValidationError{Msg: "to must be an RFC 3339 time"}
		}
	}
	from = to.Add(-defaultRange)
	if v := q.Get("from"); v != "" {
		if from, err = time.Parse(time.RFC3339, v); err != nil {
			return from, to, &store.ValidationError{Msg: "from must be an RFC 3339 time"}
		}
	}
	if from.After(to) {
		return from, to, &store.ValidationError{Msg: "from must not be after to"}
	}
	return from, to, nil
}

func (s *Server) handlePositions(w http.ResponseWriter, r *http.Request) {
	id, err := deviceID(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	from, to, err := timeRange(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	limit := defaultPositionLimit
	if v := r.URL.Query().Get("limit"); v != "" {
		if limit, err = strconv.Atoi(v); err != nil || limit <= 0 {
			writeError(w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		limit = min(limit, maxPositionLimit)
	}
	ps, err := s.store.PositionsRange(r.Context(), id, from, to, limit)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, ps)
}

func (s *Server) handleTrips(w http.ResponseWriter, r *http.Request) {
	id, err := deviceID(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	from, to, err := timeRange(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	trips, err := s.store.Trips(r.Context(), id, from, to)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, trips)
}
