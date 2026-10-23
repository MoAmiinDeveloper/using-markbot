package api

import (
	"github.com/go-chi/chi/v5"

	"github.com/moamiindeveloper/fleet/server/internal/geocode"
	"github.com/moamiindeveloper/fleet/server/internal/reports"
)

// mountAnalytics registers reports, dashboard, places and geocoding routes
// (Phase 3, analytics module). Called inside the authenticated group.
func (s *Server) mountAnalytics(r chi.Router) {
	if s.cfg.Geocoder == nil {
		// Places and cached addresses only; fleetd configures the real one.
		s.cfg.Geocoder, _ = geocode.New(s.store, geocode.Options{Provider: "off", Logger: s.log})
	}
	if s.cfg.Reports == nil {
		s.cfg.Reports = reports.New(s.store, s.cfg.Geocoder, s.log)
	}

	r.Get("/reports", s.handleReportTypes)
	r.Get("/reports/{type}", s.handleReport)
	r.Get("/dashboard", s.handleDashboard)
	r.Get("/geocode", s.handleGeocode)

	r.Get("/places", s.handleListPlaces)
	r.Group(func(r chi.Router) {
		r.Use(requireManager)
		r.Post("/places", s.handleCreatePlace)
		r.Patch("/places/{id}", s.handleUpdatePlace)
		r.Delete("/places/{id}", s.handleDeletePlace)
	})
}
