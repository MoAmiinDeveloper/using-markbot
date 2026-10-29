package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// mountParameters registers data parameters (mapped and calculated) and
// custom events. Definitions that apply to all devices are admin-only;
// managers may define them for devices they can see.
func (s *Server) mountParameters(r chi.Router) {
	r.Get("/params", s.handleListParams)
	r.Get("/custom-events", s.handleListCustomEvents)
	r.Group(func(r chi.Router) {
		r.Use(requireManager)
		r.Post("/params", s.handleCreateParam)
		r.Put("/params/{id}", s.handleUpdateParam)
		r.Delete("/params/{id}", s.handleDeleteParam)
		r.Post("/params/test", s.handleTestExpression)

		r.Post("/custom-events", s.handleCreateCustomEvent)
		r.Put("/custom-events/{id}", s.handleUpdateCustomEvent)
		r.Delete("/custom-events/{id}", s.handleDeleteCustomEvent)
	})
}

func (s *Server) handleListParams(w http.ResponseWriter, r *http.Request) {
	var devID int64
	if v := r.URL.Query().Get("deviceId"); v != "" {
		id, err := strconv.ParseInt(v, 10, 64)
		if err != nil || id <= 0 || !s.canSeeDevice(r, id) {
			writeError(w, http.StatusNotFound, "device not found")
			return
		}
		devID = id
	}
	out := []store.ParamDef{}
	for _, d := range s.store.Params(devID) {
		if d.DeviceID == nil || s.canSeeDevice(r, *d.DeviceID) {
			out = append(out, d)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// checkParamScope allows global definitions to admins only.
func (s *Server) checkParamScope(w http.ResponseWriter, r *http.Request, deviceID *int64) bool {
	if deviceID == nil {
		if !isAdmin(r) {
			writeError(w, http.StatusForbidden, "only admins can define parameters for all devices")
			return false
		}
		return true
	}
	if !s.canSeeDevice(r, *deviceID) {
		writeError(w, http.StatusBadRequest, "unknown deviceId")
		return false
	}
	return true
}

func (s *Server) visibleParam(w http.ResponseWriter, r *http.Request) (store.ParamDef, bool) {
	id, err := pathID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return store.ParamDef{}, false
	}
	d, err := s.store.Param(id)
	if err != nil || d.DeviceID != nil && !s.canSeeDevice(r, *d.DeviceID) {
		writeError(w, http.StatusNotFound, "parameter not found")
		return store.ParamDef{}, false
	}
	return d, s.checkParamScope(w, r, d.DeviceID)
}

func (s *Server) handleCreateParam(w http.ResponseWriter, r *http.Request) {
	var in store.ParamInput
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	if !s.checkParamScope(w, r, in.DeviceID) {
		return
	}
	d, err := s.store.CreateParam(r.Context(), in)
	if err != nil {
		s.failParam(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, d)
}

func (s *Server) handleUpdateParam(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.visibleParam(w, r)
	if !ok {
		return
	}
	var in store.ParamInput
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	if !s.checkParamScope(w, r, in.DeviceID) {
		return
	}
	d, err := s.store.UpdateParam(r.Context(), cur.ID, in)
	if err != nil {
		s.failParam(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) handleDeleteParam(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.visibleParam(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteParam(r.Context(), cur.ID); err != nil {
		s.failAs(w, r, err, "parameter not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) failParam(w http.ResponseWriter, r *http.Request, err error) {
	if err == store.ErrDuplicateParam {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	s.failAs(w, r, err, "parameter not found")
}

func (s *Server) handleTestExpression(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Expression string `json:"expression"`
		DeviceID   int64  `json:"deviceId"`
	}
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	if in.DeviceID != 0 && !s.canSeeDevice(r, in.DeviceID) {
		writeError(w, http.StatusBadRequest, "unknown deviceId")
		return
	}
	res, err := s.store.TestExpression(in.Expression, in.DeviceID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// ---- custom events ----

func (s *Server) handleListCustomEvents(w http.ResponseWriter, r *http.Request) {
	all, scope := s.deviceScope(r)
	out := []store.CustomEvent{}
	for _, c := range s.store.CustomEvents() {
		if all || len(c.DeviceIDs) > 0 && containsAll(scope, c.DeviceIDs) {
			out = append(out, c)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func containsAll(scope map[int64]bool, ids []int64) bool {
	for _, id := range ids {
		if !scope[id] {
			return false
		}
	}
	return true
}

// checkCustomEventScope: all-device custom events are admin-only; others may
// only name devices the user can see.
func (s *Server) checkCustomEventScope(w http.ResponseWriter, r *http.Request, ids []int64) bool {
	if len(ids) == 0 {
		if !isAdmin(r) {
			writeError(w, http.StatusForbidden, "only admins can create custom events for all devices")
			return false
		}
		return true
	}
	for _, id := range ids {
		if !s.canSeeDevice(r, id) {
			writeError(w, http.StatusBadRequest, "unknown device "+strconv.FormatInt(id, 10))
			return false
		}
	}
	return true
}

func (s *Server) visibleCustomEvent(w http.ResponseWriter, r *http.Request) (store.CustomEvent, bool) {
	id, err := pathID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return store.CustomEvent{}, false
	}
	c, err := s.store.CustomEventByID(id)
	all, scope := s.deviceScope(r)
	if err != nil || !all && (len(c.DeviceIDs) == 0 || !containsAll(scope, c.DeviceIDs)) {
		writeError(w, http.StatusNotFound, "custom event not found")
		return store.CustomEvent{}, false
	}
	return c, true
}

func (s *Server) handleCreateCustomEvent(w http.ResponseWriter, r *http.Request) {
	var in store.CustomEventInput
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	if !s.checkCustomEventScope(w, r, in.DeviceIDs) {
		return
	}
	c, err := s.store.CreateCustomEvent(r.Context(), in)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (s *Server) handleUpdateCustomEvent(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.visibleCustomEvent(w, r)
	if !ok {
		return
	}
	var in store.CustomEventInput
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	if !s.checkCustomEventScope(w, r, in.DeviceIDs) {
		return
	}
	c, err := s.store.UpdateCustomEvent(r.Context(), cur.ID, in)
	if err != nil {
		s.failAs(w, r, err, "custom event not found")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) handleDeleteCustomEvent(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.visibleCustomEvent(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteCustomEvent(r.Context(), cur.ID); err != nil {
		s.failAs(w, r, err, "custom event not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
