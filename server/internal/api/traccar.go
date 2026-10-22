package api

import (
	"crypto/subtle"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/store"
	"github.com/moamiindeveloper/fleet/server/internal/traccar"
)

// handleTraccar ingests one position forwarded by a Traccar server
// (forward.type=json). It is authenticated by the ?token= query parameter
// and feeds the same ingest path as directly connected devices.
func (s *Server) handleTraccar(w http.ResponseWriter, r *http.Request) {
	want := s.store.Settings().TraccarToken
	got := r.URL.Query().Get("token")
	if want == "" || subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
		writeError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	if err != nil {
		writeError(w, http.StatusBadRequest, "request body too large")
		return
	}
	fix, err := traccar.Decode(body, time.Now())
	if err != nil {
		s.log.Warn("traccar: rejected payload", "err", err)
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	dev, err := s.store.EnsureBridgedDevice(r.Context(), fix.UniqueID, fix.Position.Protocol, fix.DeviceName)
	switch {
	case errors.Is(err, store.ErrUnknownDevice):
		// AUTO_REGISTER is off: acknowledge so Traccar does not retry forever.
		s.log.Warn("traccar: ignoring unknown device", "uniqueId", fix.UniqueID)
		writeJSON(w, http.StatusOK, map[string]string{"status": "ignored"})
		return
	case err != nil:
		s.fail(w, r, err)
		return
	}
	if fix.Position.Protocol == "" {
		fix.Position.Protocol = dev.Protocol
	}
	if err := s.store.Positions(r.Context(), []domain.Position{fix.Position}); err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
