package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/dispatch"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// Route (path) management, Phase 4a.

// routeVisible: routes without devices are visible to everyone, others when
// at least one of their devices is visible.
func (s *Server) routeVisible(r *http.Request, rt *store.Route) bool {
	all, ids := s.deviceScope(r)
	if all || len(rt.DeviceIDs) == 0 {
		return true
	}
	for _, id := range rt.DeviceIDs {
		if ids[id] {
			return true
		}
	}
	return false
}

// narrowRoute limits deviceIds to the visible ones.
func (s *Server) narrowRoute(r *http.Request, rt store.Route) store.Route {
	all, ids := s.deviceScope(r)
	if all {
		return rt
	}
	visible := []int64{}
	for _, id := range rt.DeviceIDs {
		if ids[id] {
			visible = append(visible, id)
		}
	}
	rt.DeviceIDs = visible
	return rt
}

// checkRouteDevices: every listed device must be visible to the caller.
func (s *Server) checkRouteDevices(r *http.Request, deviceIDs []int64) error {
	for _, id := range deviceIDs {
		if !s.canSeeDevice(r, id) {
			return &store.ValidationError{Msg: "unknown device id " + strconv.FormatInt(id, 10)}
		}
	}
	return nil
}

// visibleRoute loads {id} (404 when missing or hidden).
func (s *Server) visibleRoute(w http.ResponseWriter, r *http.Request) (store.Route, bool) {
	id, err := pathID(r)
	var rt store.Route
	if err == nil {
		rt, err = s.store.Route(r.Context(), id)
	}
	if err == nil && !s.routeVisible(r, &rt) {
		err = store.ErrNotFound
	}
	if err != nil {
		s.failAs(w, r, err, routeNotFound)
		return rt, false
	}
	return rt, true
}

// manageableRoute additionally requires all of the route's devices to be
// visible (otherwise a manager would silently drop hidden assignments).
func (s *Server) manageableRoute(w http.ResponseWriter, r *http.Request) (store.Route, bool) {
	rt, ok := s.visibleRoute(w, r)
	if !ok {
		return rt, false
	}
	if err := s.checkRouteDevices(r, rt.DeviceIDs); err != nil {
		writeError(w, http.StatusForbidden, "this route includes vehicles outside your groups")
		return rt, false
	}
	return rt, true
}

func (s *Server) handleListRoutes(w http.ResponseWriter, r *http.Request) {
	rts, err := s.store.Routes(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	out := make([]store.Route, 0, len(rts))
	for i := range rts {
		if s.routeVisible(r, &rts[i]) {
			out = append(out, s.narrowRoute(r, rts[i]))
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleGetRoute(w http.ResponseWriter, r *http.Request) {
	if rt, ok := s.visibleRoute(w, r); ok {
		writeJSON(w, http.StatusOK, s.narrowRoute(r, rt))
	}
}

func (s *Server) handleCreateRoute(w http.ResponseWriter, r *http.Request) {
	var in store.RouteInput
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	if err := s.checkRouteDevices(r, in.DeviceIDs); err != nil {
		s.fail(w, r, err)
		return
	}
	rt, err := s.cfg.Dispatch.CreateRoute(r.Context(), in)
	if err != nil {
		s.failAs(w, r, err, routeNotFound)
		return
	}
	writeJSON(w, http.StatusCreated, rt)
}

func (s *Server) handleUpdateRoute(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.manageableRoute(w, r)
	if !ok {
		return
	}
	var p store.RoutePatch
	if err := decodeJSON(w, r, &p); err != nil {
		s.fail(w, r, err)
		return
	}
	if p.DeviceIDs != nil {
		if err := s.checkRouteDevices(r, *p.DeviceIDs); err != nil {
			s.fail(w, r, err)
			return
		}
	}
	rt, err := s.cfg.Dispatch.UpdateRoute(r.Context(), cur.ID, p)
	if err != nil {
		s.failAs(w, r, err, routeNotFound)
		return
	}
	writeJSON(w, http.StatusOK, rt)
}

func (s *Server) handleDeleteRoute(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.manageableRoute(w, r)
	if !ok {
		return
	}
	if err := s.cfg.Dispatch.DeleteRoute(r.Context(), cur.ID); err != nil {
		s.failAs(w, r, err, routeNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Route-from-trip limits.
const (
	fromTripMaxRange  = 31 * 24 * time.Hour
	fromTripMaxPoints = 200_000
	fromTripTolerance = 20.0 // m, Douglas-Peucker
)

func (s *Server) handleRouteFromTrip(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DeviceID            int64    `json:"deviceId"`
		From                string   `json:"from"`
		To                  string   `json:"to"`
		Name                string   `json:"name"`
		Color               string   `json:"color"`
		Corridor            *float64 `json:"corridor"`
		MinDeviationSeconds *float64 `json:"minDeviationSeconds"`
		DeviceIDs           []int64  `json:"deviceIds"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	if _, err := s.store.Device(req.DeviceID); err != nil || !s.canSeeDevice(r, req.DeviceID) {
		writeError(w, http.StatusBadRequest, "unknown deviceId")
		return
	}
	from, err1 := time.Parse(time.RFC3339, req.From)
	to, err2 := time.Parse(time.RFC3339, req.To)
	switch {
	case err1 != nil || err2 != nil:
		writeError(w, http.StatusBadRequest, "from and to must be RFC 3339 times")
		return
	case !from.Before(to):
		writeError(w, http.StatusBadRequest, "from must be before to")
		return
	case to.Sub(from) > fromTripMaxRange:
		writeError(w, http.StatusBadRequest, "the period must be at most 31 days")
		return
	}
	if err := s.checkRouteDevices(r, req.DeviceIDs); err != nil {
		s.fail(w, r, err)
		return
	}
	ps, err := s.store.PositionsRange(r.Context(), req.DeviceID, from, to, fromTripMaxPoints)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	path := make([][2]float64, 0, len(ps))
	for i := range ps {
		p := &ps[i]
		if !p.Valid || (p.Latitude == 0 && p.Longitude == 0) {
			continue
		}
		pt := [2]float64{p.Longitude, p.Latitude}
		if n := len(path); n > 0 && path[n-1] == pt {
			continue
		}
		path = append(path, pt)
	}
	path = dispatch.Simplify(path, fromTripTolerance)
	if len(path) < 2 {
		writeError(w, http.StatusBadRequest, "not enough positions in this period to build a route")
		return
	}
	if len(path) > store.MaxRoutePoints {
		writeError(w, http.StatusBadRequest, "the trip is too long for one route; choose a shorter period")
		return
	}
	rt, err := s.cfg.Dispatch.CreateRoute(r.Context(), store.RouteInput{Name: req.Name, Color: req.Color, Path: path,
		Corridor: req.Corridor, MinDeviationSeconds: req.MinDeviationSeconds, DeviceIDs: req.DeviceIDs})
	if err != nil {
		s.failAs(w, r, err, routeNotFound)
		return
	}
	writeJSON(w, http.StatusCreated, rt)
}
