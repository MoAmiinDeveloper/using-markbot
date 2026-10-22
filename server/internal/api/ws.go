package api

import (
	"context"
	"net/http"
	"time"

	"github.com/coder/websocket"
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
	if _, err := s.parseToken(tok); err != nil {
		writeError(w, http.StatusUnauthorized, "invalid or expired token")
		return
	}
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: s.wsOrigins})
	if err != nil {
		return // Accept already wrote the HTTP error
	}
	defer c.CloseNow()

	sub := s.hub.Subscribe()
	defer s.hub.Unsubscribe(sub)

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
