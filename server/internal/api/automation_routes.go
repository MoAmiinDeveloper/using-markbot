package api

import "github.com/go-chi/chi/v5"

// mountAutomation registers scheduled reports, email (SMTP) and sensor
// routes (Phase 4a, automation module). Called inside the authenticated group.
func (s *Server) mountAutomation(r chi.Router) {}
