package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/coder/websocket"

	"github.com/moamiindeveloper/fleet/server/internal/hub"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

const (
	wsPingInterval = 30 * time.Second
	wsWriteTimeout = 10 * time.Second
)

// handleWS streams hub events to an authenticated browser. The token comes
// from ?token= because browsers cannot set headers on WebSocket requests.
func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	tok := r.URL.Query().Get("token")
	if tok == "" {
		tok = bearerToken(r)
	}
	p, err := s.parseToken(tok)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid or expired token")
		return
	}
	if _, ok := s.store.UserRole(p.UserID); !ok {
		writeError(w, http.StatusUnauthorized, "user no longer exists or is deactivated")
		return
	}
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: s.wsOrigins})
	if err != nil {
		return // Accept already wrote the HTTP error
	}
	defer c.CloseNow()

	// Device-scoped messages (positions, devices, events, commands) are
	// filtered per client against the live access snapshot.
	uid := p.UserID
	sub := s.hub.SubscribeFiltered(func(deviceID int64) bool { return s.store.CanSeeDevice(uid, deviceID) })
	defer s.hub.Unsubscribe(sub)
	scope := s.wsScope(uid)

	// Clients send nothing; CloseRead handles control frames and cancels
	// ctx once the peer goes away.
	ctx := c.CloseRead(r.Context())
	ping := time.NewTicker(wsPingInterval)
	defer ping.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case frame, ok := <-sub.C:
			if !ok {
				c.Close(websocket.StatusGoingAway, "server shutting down or client too slow")
				return
			}
			if bytes.Equal(frame, accessFrame) {
				// Groups or roles changed: tell this client about devices it
				// gained ("device") or lost ("deleted"); not forwarded as is.
				if _, ok := s.store.UserRole(uid); !ok {
					c.Close(websocket.StatusPolicyViolation, "account deactivated")
					return
				}
				next := s.wsScope(uid)
				for _, f := range scope.diff(next, s.store) {
					if err := s.wsDo(ctx, func(ctx context.Context) error { return c.Write(ctx, websocket.MessageText, f) }); err != nil {
						return
					}
				}
				scope = next
				continue
			}
			if err := s.wsDo(ctx, func(ctx context.Context) error { return c.Write(ctx, websocket.MessageText, frame) }); err != nil {
				return
			}
		case <-ping.C:
			if err := s.wsDo(ctx, c.Ping); err != nil {
				return
			}
		}
	}
}

func (s *Server) wsDo(ctx context.Context, f func(context.Context) error) error {
	ctx, cancel := context.WithTimeout(ctx, wsWriteTimeout)
	defer cancel()
	err := f(ctx)
	if err != nil {
		s.log.Debug("websocket closed", "err", err)
	}
	return err
}

// accessFrame is the encoded store.EventAccess hub message.
var accessFrame, _ = json.Marshal(hub.Message{Type: store.EventAccess})

// wsScope is a client's device scope at one point in time.
type wsScope struct {
	all bool
	ids map[int64]bool
}

func (s *Server) wsScope(userID int64) wsScope {
	all, ids := s.store.DeviceScope(userID)
	return wsScope{all: all, ids: ids}
}

func (w wsScope) has(id int64) bool { return w.all || w.ids[id] }

// diff returns the frames that move a client from scope w to next: the
// current state of every newly visible device and a "deleted" message for
// every device that is no longer visible.
func (w wsScope) diff(next wsScope, st *store.Store) [][]byte {
	var out [][]byte
	enc := func(typ string, data any) {
		if b, err := json.Marshal(hub.Message{Type: typ, Data: data}); err == nil {
			out = append(out, b)
		}
	}
	for _, d := range st.Devices() {
		was, is := w.has(d.ID), next.has(d.ID)
		switch {
		case is && !was:
			enc(store.EventDevice, d)
		case was && !is:
			enc(store.EventDeleted, map[string]int64{"id": d.ID})
		}
	}
	return out
}
