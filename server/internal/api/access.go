package api

import "net/http"

// deviceScope reports which devices the requesting user may see.
// all == true means every device (admins). Otherwise only ids in the set.
// Every handler that returns device-related data must filter with it.
//
// Stub until the management module implements group-based access.
func (s *Server) deviceScope(r *http.Request) (all bool, ids map[int64]bool) {
	return true, nil
}

// canSeeDevice reports whether the requesting user may access device id.
func (s *Server) canSeeDevice(r *http.Request, id int64) bool {
	all, ids := s.deviceScope(r)
	return all || ids[id]
}
