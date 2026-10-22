package api

import "github.com/go-chi/chi/v5"

// mountManagement registers groups, users, drivers, maintenance, reminders,
// expenses and share-link routes (Phase 3, management module). Called inside
// the authenticated group.
func (s *Server) mountManagement(r chi.Router) {}

// mountPublic registers unauthenticated routes (live-location share links).
func (s *Server) mountPublic(r chi.Router) {}
