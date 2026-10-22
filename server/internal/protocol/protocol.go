// Package protocol defines how vendor tracker protocols plug into the gateway.
// Adding a new vendor = implement Protocol in a sub-package and register it in
// the gateway on its own port. Nothing else in the system changes.
package protocol

import (
	"context"
	"log/slog"
	"net"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
)

// Protocol is a vendor protocol implementation.
type Protocol interface {
	// Name is the stable identifier stored with devices/positions ("teltonika").
	Name() string
	// HandleTCP owns one accepted TCP connection until it closes or ctx is
	// cancelled: identify the device, decode packets, push to sink, ACK.
	HandleTCP(ctx context.Context, conn net.Conn, sink domain.Sink, log *slog.Logger) error
	// HandleUDP processes a single datagram and returns the reply to send
	// back (nil = no reply). Protocols without UDP support return an error.
	HandleUDP(ctx context.Context, packet []byte, from net.Addr, sink domain.Sink, log *slog.Logger) ([]byte, error)
}
