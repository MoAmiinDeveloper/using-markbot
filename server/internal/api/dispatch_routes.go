package api

import (
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// mountDispatch registers jobs/dispatch, driver-app and route (path)
// management routes (Phase 4a, dispatch module). Called inside the
// authenticated group. Driver accounts are limited to /me, /driver/* and
// /files/{id} by authenticate.
func (s *Server) mountDispatch(r chi.Router) {
	r.Get("/jobs", s.handleListJobs)
	r.Get("/jobs/{id}", s.handleGetJob)
	r.Get("/jobs/{id}/timeline", s.handleJobTimeline)
	r.Get("/files/{id}", s.handleFile)
	r.Get("/routes", s.handleListRoutes)
	r.Get("/routes/{id}", s.handleGetRoute)

	r.Group(func(r chi.Router) {
		r.Use(requireManager)
		r.Post("/jobs", s.handleCreateJob)
		r.Patch("/jobs/{id}", s.handleUpdateJob)
		r.Delete("/jobs/{id}", s.handleDeleteJob)
		r.Post("/jobs/{id}/status", s.handleJobStatus)
		r.Post("/jobs/{id}/attachments", s.handleJobAttachment)
		r.Post("/drivers/{id}/account", s.handleDriverAccount)
		r.Delete("/drivers/{id}/account", s.handleDeleteDriverAccount)
		r.Post("/routes", s.handleCreateRoute)
		r.Post("/routes/from-trip", s.handleRouteFromTrip)
		r.Patch("/routes/{id}", s.handleUpdateRoute)
		r.Delete("/routes/{id}", s.handleDeleteRoute)
	})

	r.Route("/driver", func(r chi.Router) {
		r.Use(s.requireDriverApp)
		r.Get("/me", s.handleDriverMe)
		r.Get("/jobs", s.handleDriverJobs)
		r.Get("/jobs/{id}", s.handleDriverJob)
		r.Post("/jobs/{id}/status", s.handleDriverJobStatus)
		r.Post("/jobs/{id}/stops/{stopId}", s.handleDriverStop)
		r.Post("/jobs/{id}/checklist/{itemId}", s.handleDriverChecklist)
		r.Post("/jobs/{id}/attachments", s.handleDriverAttachment)
		r.Post("/jobs/{id}/notes", s.handleDriverNote)
		r.Post("/location", s.handleDriverLocation)
		r.Get("/updates", s.handleDriverUpdates)
	})
}

const (
	jobNotFound        = "job not found"
	routeNotFound      = "route not found"
	attachmentNotFound = "file not found"
)

// failDispatch maps store.ConflictError to 409, otherwise like failAs.
func (s *Server) failDispatch(w http.ResponseWriter, r *http.Request, err error, notFound string) {
	var ce *store.ConflictError
	if errors.As(err, &ce) {
		writeError(w, http.StatusConflict, ce.Msg)
		return
	}
	s.failAs(w, r, err, notFound)
}

// jobVisible reports whether the caller may see a job: drivers their own
// jobs, admins all, others jobs of visible vehicles and (managers) jobs
// without a vehicle.
func (s *Server) jobVisible(r *http.Request, j *store.Job) bool {
	p := principalFrom(r.Context())
	return s.jobAudienceAllows(p.UserID, p.Role, j.JobAudience())
}

// visibleJob loads {id} and checks visibility (404 otherwise).
func (s *Server) visibleJob(w http.ResponseWriter, r *http.Request) (store.Job, bool) {
	id, err := pathID(r)
	var j store.Job
	if err == nil {
		j, err = s.store.Job(r.Context(), id)
	}
	if err == nil && !s.jobVisible(r, &j) {
		err = store.ErrNotFound
	}
	if err != nil {
		s.failAs(w, r, err, jobNotFound)
		return j, false
	}
	return j, true
}

// checkRouteRef validates an optional route reference (400 when unknown or
// not visible).
func (s *Server) checkRouteRef(r *http.Request, id *int64) error {
	if id == nil {
		return nil
	}
	rt, err := s.store.Route(r.Context(), *id)
	if err != nil || !s.routeVisible(r, &rt) {
		return &store.ValidationError{Msg: "unknown routeId"}
	}
	return nil
}

func (s *Server) handleListJobs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := store.JobFilter{Query: q.Get("q"), IncludeNoDevice: canManage(r), Scope: s.storeScope(r)}
	var err error
	for _, st := range strings.Split(q.Get("status"), ",") {
		if st = strings.TrimSpace(st); st == "" {
			continue
		}
		if !slices.Contains(store.JobStatuses, st) {
			writeError(w, http.StatusBadRequest, "unknown status "+strconv.Quote(st))
			return
		}
		f.Statuses = append(f.Statuses, st)
	}
	if f.DeviceID, err = queryID(r, "deviceId"); err != nil {
		s.fail(w, r, err)
		return
	}
	if f.DriverID, err = queryID(r, "driverId"); err != nil {
		s.fail(w, r, err)
		return
	}
	for _, p := range []struct {
		name string
		dst  *time.Time
	}{{"from", &f.From}, {"to", &f.To}} {
		if v := q.Get(p.name); v != "" {
			if *p.dst, err = time.Parse(time.RFC3339, v); err != nil {
				writeError(w, http.StatusBadRequest, p.name+" must be an RFC 3339 time")
				return
			}
		}
	}
	if v := q.Get("limit"); v != "" {
		if f.Limit, err = strconv.Atoi(v); err != nil || f.Limit <= 0 {
			writeError(w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		f.Limit = min(f.Limit, 5000)
	}
	jobs, err := s.store.Jobs(r.Context(), f)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, jobs)
}

func (s *Server) handleGetJob(w http.ResponseWriter, r *http.Request) {
	if j, ok := s.visibleJob(w, r); ok {
		writeJSON(w, http.StatusOK, j)
	}
}

func (s *Server) handleJobTimeline(w http.ResponseWriter, r *http.Request) {
	j, ok := s.visibleJob(w, r)
	if !ok {
		return
	}
	evs, err := s.store.JobTimeline(r.Context(), j.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, evs)
}

// checkJobRefs validates device, driver and route references of a body.
func (s *Server) checkJobRefs(r *http.Request, device, driver, route *int64) error {
	if err := s.checkDeviceRef(r, device); err != nil {
		return err
	}
	if err := s.checkDriverRef(r, driver); err != nil {
		return err
	}
	return s.checkRouteRef(r, route)
}

func (s *Server) handleCreateJob(w http.ResponseWriter, r *http.Request) {
	var in store.JobInput
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	if err := s.checkJobRefs(r, in.DeviceID, in.DriverID, in.RouteID); err != nil {
		s.fail(w, r, err)
		return
	}
	j, err := s.cfg.Dispatch.CreateJob(r.Context(), in, principalFrom(r.Context()).UserID)
	if err != nil {
		s.failDispatch(w, r, err, jobNotFound)
		return
	}
	writeJSON(w, http.StatusCreated, j)
}

func (s *Server) handleUpdateJob(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.visibleJob(w, r)
	if !ok {
		return
	}
	var p store.JobPatch
	if err := decodeJSON(w, r, &p); err != nil {
		s.fail(w, r, err)
		return
	}
	var dev, drv, rt *int64
	if p.DeviceID.Set {
		dev = p.DeviceID.ID
	}
	if p.DriverID.Set {
		drv = p.DriverID.ID
	}
	if p.RouteID.Set {
		rt = p.RouteID.ID
	}
	if err := s.checkJobRefs(r, dev, drv, rt); err != nil {
		s.fail(w, r, err)
		return
	}
	j, err := s.cfg.Dispatch.UpdateJob(r.Context(), cur.ID, p, principalFrom(r.Context()).UserID)
	if err != nil {
		s.failDispatch(w, r, err, jobNotFound)
		return
	}
	writeJSON(w, http.StatusOK, j)
}

func (s *Server) handleDeleteJob(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.visibleJob(w, r)
	if !ok {
		return
	}
	if err := s.cfg.Dispatch.DeleteJob(r.Context(), cur.ID); err != nil {
		s.failDispatch(w, r, err, jobNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// statusRequest is the body of the status endpoints.
type statusRequest struct {
	Status string   `json:"status"`
	Reason string   `json:"reason"`
	Lat    *float64 `json:"lat"`
	Lng    *float64 `json:"lng"`
}

// locationData returns {lat, lng} for the timeline when both are valid.
func locationData(lat, lng *float64) map[string]any {
	if lat == nil || lng == nil || !(*lat >= -90 && *lat <= 90 && *lng >= -180 && *lng <= 180) {
		return nil
	}
	return map[string]any{"lat": *lat, "lng": *lng}
}

func (s *Server) handleJobStatus(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.visibleJob(w, r)
	if !ok {
		return
	}
	var req statusRequest
	if err := decodeJSON(w, r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	j, err := s.cfg.Dispatch.SetStatus(r.Context(), cur.ID, req.Status, req.Reason,
		principalFrom(r.Context()).UserID, false, locationData(req.Lat, req.Lng))
	if err != nil {
		s.failDispatch(w, r, err, jobNotFound)
		return
	}
	writeJSON(w, http.StatusOK, j)
}

func (s *Server) handleJobAttachment(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.visibleJob(w, r)
	if !ok {
		return
	}
	s.upload(w, r, cur)
}

// --- driver accounts ---

func (s *Server) handleDriverAccount(w http.ResponseWriter, r *http.Request) {
	d, ok := s.visibleDriver(w, r)
	if !ok {
		return
	}
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	if req.Password != "" || d.UserID == nil {
		if err := checkPassword(req.Password); err != nil {
			s.fail(w, r, err)
			return
		}
	}
	u, created, err := s.store.SetDriverAccount(r.Context(), d.ID, req.Email, req.Password)
	if err != nil {
		s.failAs(w, r, err, driverNotFound)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, u)
}

func (s *Server) handleDeleteDriverAccount(w http.ResponseWriter, r *http.Request) {
	d, ok := s.visibleDriver(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteDriverAccount(r.Context(), d.ID); err != nil {
		s.failAs(w, r, err, "driver has no account")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
