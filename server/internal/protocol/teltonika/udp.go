package teltonika

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"sync"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
)

// HandleUDP implements protocol.Protocol for one UDP datagram. It returns
// the ACK to send, or nil (no ACK) with an error when the datagram is
// malformed, unauthorized or the sink failed, so the device resends.
func (h *Handler) HandleUDP(ctx context.Context, packet []byte, from net.Addr, sink domain.Sink, log *slog.Logger) ([]byte, error) {
	hdr, avl, err := DecodeUDPPacket(packet)
	if err != nil {
		return nil, fmt.Errorf("udp header: %w", err)
	}
	ok, err := h.auth.authorize(ctx, sink, hdr.IMEI, h.now())
	if err != nil {
		return nil, fmt.Errorf("authorize %s: %w", hdr.IMEI, err)
	}
	if !ok {
		return nil, fmt.Errorf("device %s not authorized", hdr.IMEI)
	}
	_, recs, err := DecodeAVL(avl)
	if err != nil {
		return nil, fmt.Errorf("imei %s: %w", hdr.IMEI, err)
	}
	if err := sink.Positions(ctx, positions(hdr.IMEI, recs, h.now())); err != nil {
		return nil, fmt.Errorf("imei %s: sink: %w", hdr.IMEI, err)
	}
	log.Debug("udp packet accepted", "imei", hdr.IMEI, "records", len(recs))
	return EncodeUDPAck(hdr.PacketID, hdr.AVLPacketID, uint8(len(recs))), nil
}

// authCache memoizes Sink.Authorize results (positive and negative) for UDP,
// where every datagram would otherwise hit the store.
type authCache struct {
	ttl time.Duration
	mu  sync.Mutex
	m   map[string]authEntry
}

type authEntry struct {
	ok      bool
	expires time.Time
}

const authCachePruneAt = 10_000

func (c *authCache) authorize(ctx context.Context, sink domain.Sink, imei string, now time.Time) (bool, error) {
	c.mu.Lock()
	e, hit := c.m[imei]
	c.mu.Unlock()
	if hit && now.Before(e.expires) {
		return e.ok, nil
	}
	ok, err := sink.Authorize(ctx, imei, protocolName)
	if err != nil {
		return false, err // errors are not cached
	}
	c.mu.Lock()
	if len(c.m) >= authCachePruneAt {
		for k, v := range c.m {
			if !now.Before(v.expires) {
				delete(c.m, k)
			}
		}
		if len(c.m) >= authCachePruneAt { // flooded with live entries: start over
			clear(c.m)
		}
	}
	c.m[imei] = authEntry{ok: ok, expires: now.Add(c.ttl)}
	c.mu.Unlock()
	return ok, nil
}
