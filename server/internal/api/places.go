package api

import (
	"math"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

const placeNotFound = "place not found"

func placeID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, store.ErrNotFound
	}
	return id, nil
}

func (s *Server) handleListPlaces(w http.ResponseWriter, r *http.Request) {
	ps, err := s.store.Places(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, ps)
}

func (s *Server) handleCreatePlace(w http.ResponseWriter, r *http.Request) {
	var in store.PlaceInput
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	p, err := s.store.CreatePlace(r.Context(), in)
	if err != nil {
		s.failAs(w, r, err, placeNotFound)
		return
	}
	s.cfg.Geocoder.InvalidatePlaces()
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) handleUpdatePlace(w http.ResponseWriter, r *http.Request) {
	id, err := placeID(r)
	if err != nil {
		s.failAs(w, r, err, placeNotFound)
		return
	}
	var patch store.PlacePatch
	if err := decodeJSON(w, r, &patch); err != nil {
		s.fail(w, r, err)
		return
	}
	p, err := s.store.UpdatePlace(r.Context(), id, patch)
	if err != nil {
		s.failAs(w, r, err, placeNotFound)
		return
	}
	s.cfg.Geocoder.InvalidatePlaces()
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) handleDeletePlace(w http.ResponseWriter, r *http.Request) {
	id, err := placeID(r)
	if err == nil {
		err = s.store.DeletePlace(r.Context(), id)
	}
	if err != nil {
		s.failAs(w, r, err, placeNotFound)
		return
	}
	s.cfg.Geocoder.InvalidatePlaces()
	w.WriteHeader(http.StatusNoContent)
}

// handleGeocode resolves ?lat=&lng= to {address, place}.
func (s *Server) handleGeocode(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	lat, err1 := strconv.ParseFloat(q.Get("lat"), 64)
	lng, err2 := strconv.ParseFloat(q.Get("lng"), 64)
	if err1 != nil || err2 != nil || math.IsNaN(lat) || math.IsNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		writeError(w, http.StatusBadRequest, "lat and lng must be valid coordinates")
		return
	}
	writeJSON(w, http.StatusOK, s.cfg.Geocoder.Lookup(r.Context(), lat, lng))
}
