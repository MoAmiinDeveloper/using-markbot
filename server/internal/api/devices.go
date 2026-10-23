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

func (s *Server) handleListDevices(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.store.DevicesScoped(s.deviceScope(r)))
}

func (s *Server) handleGetDevice(w http.ResponseWriter, r *http.Request) {
	id, ok := s.visibleDevice(w, r)
	if !ok {
		return
	}
	d, err := s.store.Device(id)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

// deviceExtras are the Phase 3 device fields accepted by POST/PATCH
// /devices besides store.DeviceInput.
type deviceExtras struct {
	GroupIDs    *[]int64   `json:"groupIds"`    // admin only
	Odometer    *float64   `json:"odometer"`    // km, calibrates the displayed odometer
	EngineHours *float64   `json:"engineHours"` // h, calibrates the displayed engine hours
	DriverID    optionalID `json:"driverId"`    // manual driver assignment; null unassigns
}

func (x *deviceExtras) validate(r *http.Request) error {
	if x.GroupIDs != nil && !isAdmin(r) {
		return errForbidden("only admins can change device groups")
	}
	if v := x.Odometer; v != nil && !(*v >= 0 && *v <= 1e8) {
		return &store.ValidationError{Msg: "odometer must be between 0 and 100000000 km"}
	}
	if v := x.EngineHours; v != nil && !(*v >= 0 && *v <= 1e7) {
		return &store.ValidationError{Msg: "engineHours must be between 0 and 10000000 h"}
	}
	return nil
}

// apply stores the extras for device id and returns the updated device.
func (s *Server) applyDeviceExtras(r *http.Request, id int64, x *deviceExtras) (store.Device, error) {
	ctx := r.Context()
	if x.GroupIDs != nil {
		if err := s.store.SetDeviceGroups(ctx, id, *x.GroupIDs); err != nil {
			return store.Device{}, err
		}
	}
	if x.DriverID.Set {
		if x.DriverID.ID != nil {
			if err := s.checkDriverRef(r, x.DriverID.ID); err != nil {
				return store.Device{}, err
			}
		}
		if err := s.store.AssignDriver(ctx, id, x.DriverID.ID); err != nil {
			return store.Device{}, err
		}
	}
	return s.store.SetDeviceCounters(ctx, id, x.Odometer, x.EngineHours)
}

func (s *Server) handleCreateDevice(w http.ResponseWriter, r *http.Request) {
	var in struct {
		store.DeviceInput
		deviceExtras
	}
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	if err := in.deviceExtras.validate(r); err != nil {
		s.fail(w, r, err)
		return
	}
	d, err := s.store.CreateDevice(r.Context(), in.DeviceInput)
	if err == nil {
		d, err = s.applyDeviceExtras(r, d.ID, &in.deviceExtras)
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, d)
}

func (s *Server) handleUpdateDevice(w http.ResponseWriter, r *http.Request) {
	id, ok := s.visibleDevice(w, r)
	if !ok {
		return
	}
	var p struct {
		store.DevicePatch
		deviceExtras
	}
	if err := decodeJSON(w, r, &p); err != nil {
		s.fail(w, r, err)
		return
	}
	if err := p.deviceExtras.validate(r); err != nil {
		s.fail(w, r, err)
		return
	}
	d, err := s.store.UpdateDevice(r.Context(), id, p.DevicePatch)
	if err == nil {
		d, err = s.applyDeviceExtras(r, d.ID, &p.deviceExtras)
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) handleDeleteDevice(w http.ResponseWriter, r *http.Request) {
	id, ok := s.visibleDevice(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteDevice(r.Context(), id); err != nil {
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
	id, ok := s.visibleDevice(w, r)
	if !ok {
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
	if v := r.URL.Query().Get("sensors"); v == "1" || v == "true" { // automation module
		writeJSON(w, http.StatusOK, s.positionsWithSensors(id, ps))
		return
	}
	writeJSON(w, http.StatusOK, ps)
}

func (s *Server) handleTrips(w http.ResponseWriter, r *http.Request) {
	id, ok := s.visibleDevice(w, r)
	if !ok {
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
