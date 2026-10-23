package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// mountManagement registers groups, users, drivers, maintenance, reminders,
// expenses and share-link routes (Phase 3, management module). Called inside
// the authenticated group.
func (s *Server) mountManagement(r chi.Router) {
	r.Patch("/me", s.handlePatchMe)
	r.Get("/groups", s.handleListGroups)
	r.Get("/drivers", s.handleListDrivers)
	r.Get("/maintenance", s.handleListMaintenance)
	r.Get("/maintenance/{id}/history", s.handleMaintenanceHistory)
	r.Get("/reminders", s.handleListReminders)
	r.Get("/expenses", s.handleListExpenses)

	r.Group(func(r chi.Router) {
		r.Use(requireAdmin)
		r.Post("/groups", s.handleCreateGroup)
		r.Patch("/groups/{id}", s.handleUpdateGroup)
		r.Delete("/groups/{id}", s.handleDeleteGroup)
		r.Get("/users", s.handleListUsers)
		r.Post("/users", s.handleCreateUser)
		r.Patch("/users/{id}", s.handleUpdateUser)
		r.Delete("/users/{id}", s.handleDeleteUser)
	})

	// Managers act on the devices of their groups (checked per handler).
	r.Group(func(r chi.Router) {
		r.Use(requireManager)
		r.Post("/drivers", s.handleCreateDriver)
		r.Patch("/drivers/{id}", s.handleUpdateDriver)
		r.Delete("/drivers/{id}", s.handleDeleteDriver)
		r.Post("/maintenance", s.handleCreateMaintenance)
		r.Patch("/maintenance/{id}", s.handleUpdateMaintenance)
		r.Delete("/maintenance/{id}", s.handleDeleteMaintenance)
		r.Post("/maintenance/{id}/complete", s.handleCompleteMaintenance)
		r.Post("/reminders", s.handleCreateReminder)
		r.Patch("/reminders/{id}", s.handleUpdateReminder)
		r.Delete("/reminders/{id}", s.handleDeleteReminder)
		r.Post("/expenses", s.handleCreateExpense)
		r.Patch("/expenses/{id}", s.handleUpdateExpense)
		r.Delete("/expenses/{id}", s.handleDeleteExpense)
		r.Post("/devices/{id}/share", s.handleCreateShare)
		r.Get("/devices/{id}/shares", s.handleListShares)
		r.Delete("/shares/{token}", s.handleRevokeShare)
	})
}

// mountPublic registers unauthenticated routes (live-location share links).
func (s *Server) mountPublic(r chi.Router) {
	r.Get("/public/share/{token}", s.handlePublicShare)
}

// pathID parses the {id} URL parameter; invalid ids are reported as not found.
func pathID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, store.ErrNotFound
	}
	return id, nil
}

// queryID parses an optional positive integer query parameter.
func queryID(r *http.Request, name string) (int64, error) {
	v := r.URL.Query().Get(name)
	if v == "" {
		return 0, nil
	}
	id, err := strconv.ParseInt(v, 10, 64)
	if err != nil || id <= 0 {
		return 0, &store.ValidationError{Msg: name + " must be a positive integer"}
	}
	return id, nil
}

// storeScope converts the caller's device scope for store listings.
func (s *Server) storeScope(r *http.Request) store.Scope {
	all, ids := s.scopeIDs(r)
	return store.Scope{All: all, DeviceIDs: ids}
}
