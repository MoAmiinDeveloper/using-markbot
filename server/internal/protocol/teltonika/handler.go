// Package teltonika implements the Teltonika FMxxx protocol: Codec 8, 8E and
// 16 AVL data over TCP and UDP, plus Codec 12 GPRS commands over TCP.
package teltonika

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/protocol"
)

const protocolName = "teltonika"

// Defaults, overridable with Options.
const (
	DefaultIdleTimeout      = 5 * time.Minute
	DefaultHandshakeTimeout = 30 * time.Second
	DefaultWriteTimeout     = 10 * time.Second
	DefaultMaxPacketSize    = 64 << 10
	DefaultAuthCacheTTL     = time.Minute
)

// Handler is the Teltonika protocol implementation. Besides
// protocol.Protocol it exposes live TCP sessions for sending Codec 12
// commands (see Session).
type Handler struct {
	idleTimeout      time.Duration
	handshakeTimeout time.Duration
	writeTimeout     time.Duration
	maxPacketSize    int
	now              func() time.Time

	sessions *registry
	auth     *authCache
}

var _ protocol.Protocol = (*Handler)(nil)

// Option configures a Handler.
type Option func(*Handler)

// WithIdleTimeout sets how long a TCP connection may stay silent before it is
// closed. FMB devices send at least every few minutes, even when parked.
func WithIdleTimeout(d time.Duration) Option { return func(h *Handler) { h.idleTimeout = d } }

// WithHandshakeTimeout bounds the time between accept and the IMEI message.
func WithHandshakeTimeout(d time.Duration) Option {
	return func(h *Handler) { h.handshakeTimeout = d }
}

// WithWriteTimeout bounds each write (ACKs, commands) to the device.
func WithWriteTimeout(d time.Duration) Option { return func(h *Handler) { h.writeTimeout = d } }

// WithMaxPacketSize sets the largest accepted frame payload in bytes.
func WithMaxPacketSize(n int) Option { return func(h *Handler) { h.maxPacketSize = n } }

// WithAuthCacheTTL sets how long UDP authorization results are cached.
func WithAuthCacheTTL(d time.Duration) Option {
	return func(h *Handler) { h.auth.ttl = d }
}

// New returns the Teltonika protocol. The concrete type is *Handler.
func New(opts ...Option) protocol.Protocol { return NewHandler(opts...) }

// NewHandler is like New but returns the concrete type, for callers that
// need Session access.
func NewHandler(opts ...Option) *Handler {
	h := &Handler{
		idleTimeout:      DefaultIdleTimeout,
		handshakeTimeout: DefaultHandshakeTimeout,
		writeTimeout:     DefaultWriteTimeout,
		maxPacketSize:    DefaultMaxPacketSize,
		now:              time.Now,
		sessions:         &registry{m: make(map[string]*Session)},
		auth:             &authCache{ttl: DefaultAuthCacheTTL, m: make(map[string]authEntry)},
	}
	for _, o := range opts {
		o(h)
	}
	return h
}

// Name implements protocol.Protocol.
func (h *Handler) Name() string { return protocolName }

// Session returns the live TCP session of a device, if connected.
func (h *Handler) Session(imei string) (*Session, bool) { return h.sessions.get(imei) }

// HandleTCP implements protocol.Protocol. It returns nil when the device or
// the server closed the connection normally.
func (h *Handler) HandleTCP(ctx context.Context, conn net.Conn, sink domain.Sink, log *slog.Logger) (err error) {
	defer conn.Close()
	// Unblock pending reads on shutdown.
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()

	remote := conn.RemoteAddr().String()
	br := bufio.NewReaderSize(conn, 4096)

	imei, err := h.handshake(ctx, conn, br, sink)
	if err != nil {
		return h.closeReason(ctx, fmt.Errorf("handshake: %w", err))
	}
	log = log.With("imei", imei)
	log.Info("device connected")

	sess := newSession(imei, remote, conn, h.writeTimeout)
	h.sessions.add(sess)
	sink.Connection(ctx, imei, true, remote)
	defer func() {
		sess.close()
		h.sessions.remove(sess)
		cctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		sink.Connection(cctx, imei, false, remote)
		cancel()
		log.Info("device disconnected", "err", err)
	}()

	var buf []byte
	var ack [4]byte
	for {
		if err := conn.SetReadDeadline(time.Now().Add(h.idleTimeout)); err != nil {
			return h.closeReason(ctx, err)
		}
		payload, err := ReadFrame(br, buf, h.maxPacketSize)
		if payload != nil {
			buf = payload[:cap(payload)]
		}
		switch {
		case errors.Is(err, ErrBadCRC):
			// Stream is still aligned; the device resends un-ACKed data.
			log.Warn("dropping packet", "err", err)
			continue
		case err != nil:
			return h.closeReason(ctx, err)
		}

		switch codec := payload[0]; codec {
		case Codec8, Codec8E, Codec16:
			_, recs, err := DecodeAVL(payload)
			if err != nil {
				// CRC was valid, so this is a decoder/device mismatch.
				// Don't ACK; the device reconnects and resends.
				log.Error("malformed AVL packet", "codec", codec, "err", err, "len", len(payload))
				return err
			}
			if err := sink.Positions(ctx, positions(imei, recs, h.now())); err != nil {
				log.Error("sink rejected positions, closing without ACK", "records", len(recs), "err", err)
				return fmt.Errorf("sink: %w", err)
			}
			binary.BigEndian.PutUint32(ack[:], uint32(len(recs)))
			if err := sess.write(ack[:]); err != nil {
				return h.closeReason(ctx, fmt.Errorf("write ACK: %w", err))
			}
			log.Debug("packet accepted", "codec", codec, "records", len(recs))
		case Codec12:
			typ, data, err := DecodeCodec12(payload)
			if err != nil {
				log.Warn("malformed Codec 12 message", "err", err)
				continue
			}
			if typ != Codec12Response {
				log.Warn("unexpected Codec 12 message type", "type", typ)
				continue
			}
			log.Info("command response", "response", string(data))
			sess.deliver(string(data))
		default:
			log.Warn("unsupported codec, ignoring packet", "codec", codec, "len", len(payload))
		}
	}
}

// handshake reads the IMEI, authorizes it and answers 0x01 / 0x00.
func (h *Handler) handshake(ctx context.Context, conn net.Conn, br *bufio.Reader, sink domain.Sink) (string, error) {
	if err := conn.SetReadDeadline(time.Now().Add(h.handshakeTimeout)); err != nil {
		return "", err
	}
	var lb [2]byte
	if _, err := io.ReadFull(br, lb[:]); err != nil {
		return "", err
	}
	n := int(binary.BigEndian.Uint16(lb[:]))
	if n == 0 || n > maxIMEILen {
		return "", fmt.Errorf("%w: length %d", ErrBadIMEI, n)
	}
	raw := make([]byte, n)
	if _, err := io.ReadFull(br, raw); err != nil {
		return "", err
	}
	if !validIMEI(raw) {
		return "", fmt.Errorf("%w: %q", ErrBadIMEI, raw)
	}
	imei := string(raw)

	ok, err := sink.Authorize(ctx, imei, protocolName)
	reply := byte(0x01)
	if err != nil || !ok {
		reply = 0x00
	}
	_ = conn.SetWriteDeadline(time.Now().Add(h.writeTimeout))
	if _, werr := conn.Write([]byte{reply}); werr != nil && err == nil && ok {
		return "", werr
	}
	switch {
	case err != nil:
		return "", fmt.Errorf("authorize %s: %w", imei, err)
	case !ok:
		return "", fmt.Errorf("device %s not authorized", imei)
	}
	return imei, nil
}

// closeReason maps normal termination (EOF, shutdown) to nil and annotates
// idle timeouts.
func (h *Handler) closeReason(ctx context.Context, err error) error {
	switch {
	case ctx.Err() != nil, errors.Is(err, io.EOF), errors.Is(err, io.ErrClosedPipe), errors.Is(err, net.ErrClosed):
		return nil
	case errors.Is(err, os.ErrDeadlineExceeded):
		return fmt.Errorf("idle timeout: %w", err)
	}
	return err
}
