package api

import "github.com/go-chi/chi/v5"

// mountDispatch registers jobs/dispatch, driver-app and route (path)
// management routes (Phase 4a, dispatch module). Called inside the
// authenticated group.
func (s *Server) mountDispatch(r chi.Router) {}
