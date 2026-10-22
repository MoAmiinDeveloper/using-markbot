package api

import "github.com/go-chi/chi/v5"

// mountAnalytics registers reports, dashboard, places and geocoding routes
// (Phase 3, analytics module). Called inside the authenticated group.
func (s *Server) mountAnalytics(r chi.Router) {}
