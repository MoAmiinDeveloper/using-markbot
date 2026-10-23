package api

import (
	"net/http"
	"strconv"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

const (
	defaultCommandLimit = 50
	maxCommandLimit     = 500
)

func (s *Server) handleCreateCommand(w http.ResponseWriter, r *http.Request) {
	if !canManage(r) {
		writeError(w, http.StatusForbidden, "viewers cannot send commands")
		return
	}
	id, ok := s.visibleDevice(w, r)
	if !ok {
		return
	}
	var req struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	p := principalFrom(r.Context())
	c, err := s.cfg.Commands.Create(r.Context(), id, p.UserID, p.Role == store.RoleAdmin, req.Type, req.Text)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, c)
}

func (s *Server) handleListCommands(w http.ResponseWriter, r *http.Request) {
	id, ok := s.visibleDevice(w, r)
	if !ok {
		return
	}
	var err error
	limit := defaultCommandLimit
	if v := r.URL.Query().Get("limit"); v != "" {
		if limit, err = strconv.Atoi(v); err != nil || limit <= 0 {
			writeError(w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		limit = min(limit, maxCommandLimit)
	}
	cs, err := s.store.Commands(r.Context(), id, limit)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, cs)
}
