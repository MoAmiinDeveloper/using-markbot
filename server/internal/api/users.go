package api

import (
	"net/http"
	"slices"
	"unicode/utf8"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

const (
	userNotFound  = "user not found"
	groupNotFound = "group not found"
	minPassword   = 6
)

func checkPassword(pw string) error {
	if utf8.RuneCountInString(pw) < minPassword {
		return &store.ValidationError{Msg: "password must be at least 6 characters"}
	}
	if len(pw) > 72 { // bcrypt limit
		return &store.ValidationError{Msg: "password must be at most 72 bytes"}
	}
	return nil
}

// --- groups ---

func (s *Server) handleListGroups(w http.ResponseWriter, r *http.Request) {
	gs, err := s.store.Groups(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if !isAdmin(r) {
		mine := s.store.UserGroupIDs(principalFrom(r.Context()).UserID)
		out := make([]store.Group, 0, len(mine))
		for _, g := range gs {
			if slices.Contains(mine, g.ID) {
				out = append(out, g)
			}
		}
		gs = out
	}
	writeJSON(w, http.StatusOK, gs)
}

func (s *Server) handleCreateGroup(w http.ResponseWriter, r *http.Request) {
	var in store.GroupInput
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	g, err := s.store.CreateGroup(r.Context(), in)
	if err != nil {
		s.failAs(w, r, err, groupNotFound)
		return
	}
	writeJSON(w, http.StatusCreated, g)
}

func (s *Server) handleUpdateGroup(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		s.failAs(w, r, err, groupNotFound)
		return
	}
	var p store.GroupPatch
	if err := decodeJSON(w, r, &p); err != nil {
		s.fail(w, r, err)
		return
	}
	g, err := s.store.UpdateGroup(r.Context(), id, p)
	if err != nil {
		s.failAs(w, r, err, groupNotFound)
		return
	}
	writeJSON(w, http.StatusOK, g)
}

func (s *Server) handleDeleteGroup(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err == nil {
		err = s.store.DeleteGroup(r.Context(), id)
	}
	if err != nil {
		s.failAs(w, r, err, groupNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- users ---

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	us, err := s.store.Users(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, us)
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var in store.UserInput
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	if err := checkPassword(in.Password); err != nil {
		s.fail(w, r, err)
		return
	}
	u, err := s.store.CreateUserFull(r.Context(), in)
	if err != nil {
		s.failAs(w, r, err, userNotFound)
		return
	}
	writeJSON(w, http.StatusCreated, u)
}

func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		s.failAs(w, r, err, userNotFound)
		return
	}
	var p store.UserPatch
	if err := decodeJSON(w, r, &p); err != nil {
		s.fail(w, r, err)
		return
	}
	if p.Password != nil {
		if err := checkPassword(*p.Password); err != nil {
			s.fail(w, r, err)
			return
		}
	}
	u, err := s.store.UpdateUser(r.Context(), principalFrom(r.Context()).UserID, id, p)
	if err != nil {
		s.failAs(w, r, err, userNotFound)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err == nil {
		err = s.store.DeleteUser(r.Context(), principalFrom(r.Context()).UserID, id)
	}
	if err != nil {
		s.failAs(w, r, err, userNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handlePatchMe lets any user change their name and password. A new
// password requires the current one.
func (s *Server) handlePatchMe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name            *string `json:"name"`
		CurrentPassword string  `json:"currentPassword"`
		NewPassword     string  `json:"newPassword"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	uid := principalFrom(r.Context()).UserID
	if req.NewPassword != "" {
		if err := checkPassword(req.NewPassword); err != nil {
			s.fail(w, r, err)
			return
		}
		ok, err := s.store.CheckPassword(r.Context(), uid, req.CurrentPassword)
		if err != nil {
			s.failAs(w, r, err, userNotFound)
			return
		}
		if !ok {
			writeError(w, http.StatusBadRequest, "current password is incorrect")
			return
		}
	}
	u, err := s.store.UpdateProfile(r.Context(), uid, req.Name, req.NewPassword)
	if err != nil {
		s.failAs(w, r, err, userNotFound)
		return
	}
	writeJSON(w, http.StatusOK, u)
}
