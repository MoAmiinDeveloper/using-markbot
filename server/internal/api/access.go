package api

import (
	"net/http"
	"slices"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// deviceScope reports which devices the requesting user may see.
// all == true means every device (admins). Otherwise only ids in the set
// (the devices of the user's groups). Every handler that returns
// device-related data must filter with it. The map is shared: do not modify.
//
// The scope comes from the store's in-memory access snapshot, which is
// rebuilt whenever groups, memberships or users change, so it is cheap to
// call repeatedly and always current.
func (s *Server) deviceScope(r *http.Request) (all bool, ids map[int64]bool) {
	return s.store.DeviceScope(principalFrom(r.Context()).UserID)
}

// canSeeDevice reports whether the requesting user may access device id.
func (s *Server) canSeeDevice(r *http.Request, id int64) bool {
	all, ids := s.deviceScope(r)
	return all || ids[id]
}

// scopeIDs returns the visible device ids as a sorted slice (nil for admins,
// with all == true), e.g. for SQL "device_id = ANY($n)" filters.
func (s *Server) scopeIDs(r *http.Request) (all bool, list []int64) {
	all, ids := s.deviceScope(r)
	if all {
		return true, nil
	}
	list = make([]int64, 0, len(ids))
	for id := range ids {
		list = append(list, id)
	}
	slices.Sort(list)
	return false, list
}

func roleOf(r *http.Request) string { return principalFrom(r.Context()).Role }

// canManage reports whether the caller may modify fleet data (admin or manager).
func canManage(r *http.Request) bool {
	role := roleOf(r)
	return role == store.RoleAdmin || role == store.RoleManager
}

// requireManager restricts a route to admins and managers. It must run
// after authenticate.
func requireManager(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !canManage(r) {
			writeError(w, http.StatusForbidden, "manager or admin role required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// visibleDevice parses {id} and checks that the caller may see the device;
// otherwise it writes 404 (hidden devices are indistinguishable from
// missing ones) and returns ok == false.
func (s *Server) visibleDevice(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := deviceID(r)
	if err == nil && !s.canSeeDevice(r, id) {
		err = store.ErrNotFound
	}
	if err == nil {
		_, err = s.store.Device(id)
	}
	if err != nil {
		s.fail(w, r, err)
		return 0, false
	}
	return id, true
}

// checkDeviceRef validates an optional device reference in a request body:
// it must exist and be visible to the caller (400 otherwise).
func (s *Server) checkDeviceRef(r *http.Request, id *int64) error {
	if id == nil {
		return nil
	}
	if _, err := s.store.Device(*id); err != nil || !s.canSeeDevice(r, *id) {
		return &store.ValidationError{Msg: "unknown deviceId"}
	}
	return nil
}

// forbiddenError is mapped to 403 by fail.
type forbiddenError struct{ msg string }

func (e *forbiddenError) Error() string { return e.msg }

func errForbidden(msg string) error { return &forbiddenError{msg: msg} }

// optionalID is a nullable id in a PATCH body (see store.OptID).
type optionalID = store.OptID
