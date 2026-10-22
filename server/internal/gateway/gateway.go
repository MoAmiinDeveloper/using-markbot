// Package gateway runs the device-facing TCP/UDP listeners and hands each
// connection or datagram to its vendor protocol implementation.
package gateway

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"runtime"
	"runtime/debug"
	"sync"
	"sync/atomic"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/protocol"
)

// Listener binds one protocol to its ports. An empty address disables that
// transport.
type Listener struct {
	Protocol protocol.Protocol
	TCPAddr  string
	UDPAddr  string
}

// Tunables.
const (
	shutdownGrace   = 10 * time.Second
	udpQueueSize    = 1024
	maxDatagramSize = 64 << 10
	maxAcceptDelay  = time.Second
)

var keepAlive = net.KeepAliveConfig{
	Enable:   true,
	Idle:     60 * time.Second,
	Interval: 15 * time.Second,
	Count:    4,
}

// Server accepts device traffic for a set of protocol listeners.
type Server struct {
	sink      domain.Sink
	log       *slog.Logger
	listeners []Listener

	active  atomic.Int64
	mu      sync.Mutex
	conns   map[net.Conn]struct{}
	closing bool
	wg      sync.WaitGroup
}

// New creates a gateway. Nothing listens until Run is called.
func New(sink domain.Sink, log *slog.Logger, listeners ...Listener) *Server {
	if log == nil {
		log = slog.Default()
	}
	return &Server{
		sink:      sink,
		log:       log.With("component", "gateway"),
		listeners: listeners,
		conns:     make(map[net.Conn]struct{}),
	}
}

// ActiveConnections returns the number of open TCP device connections.
func (s *Server) ActiveConnections() int { return int(s.active.Load()) }

// Run binds all listeners, serves until ctx is cancelled, then closes
// listeners and connections and waits (bounded) for handlers to finish.
// It returns an error only if a listener could not be started.
func (s *Server) Run(ctx context.Context) error {
	if len(s.listeners) == 0 {
		return errors.New("gateway: no listeners configured")
	}
	lc := net.ListenConfig{KeepAliveConfig: keepAlive}
	var closers []func() error
	closeAll := func() {
		for _, c := range closers {
			_ = c()
		}
	}

	for _, l := range s.listeners {
		if l.Protocol == nil {
			closeAll()
			return errors.New("gateway: listener without protocol")
		}
		name := l.Protocol.Name()
		log := s.log.With("protocol", name)
		if l.TCPAddr != "" {
			ln, err := lc.Listen(ctx, "tcp", l.TCPAddr)
			if err != nil {
				closeAll()
				return fmt.Errorf("gateway: %s tcp listen %s: %w", name, l.TCPAddr, err)
			}
			closers = append(closers, ln.Close)
			log.Info("listening", "transport", "tcp", "addr", ln.Addr().String())
			s.wg.Add(1)
			go s.serveTCP(ctx, ln, l.Protocol, log)
		}
		if l.UDPAddr != "" {
			pc, err := lc.ListenPacket(ctx, "udp", l.UDPAddr)
			if err != nil {
				closeAll()
				return fmt.Errorf("gateway: %s udp listen %s: %w", name, l.UDPAddr, err)
			}
			closers = append(closers, pc.Close)
			log.Info("listening", "transport", "udp", "addr", pc.LocalAddr().String())
			s.wg.Add(1)
			go s.serveUDP(ctx, pc, l.Protocol, log)
		}
	}

	<-ctx.Done()
	s.log.Info("shutting down", "connections", s.ActiveConnections())
	closeAll()
	s.closeConns()

	done := make(chan struct{})
	go func() { s.wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(shutdownGrace):
		s.log.Warn("shutdown grace period exceeded, handlers still running")
	}
	return nil
}

func (s *Server) serveTCP(ctx context.Context, ln net.Listener, p protocol.Protocol, log *slog.Logger) {
	defer s.wg.Done()
	var delay time.Duration
	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil || errors.Is(err, net.ErrClosed) {
				return
			}
			// Transient (e.g. EMFILE): back off like net/http.
			delay = min(max(2*delay, 5*time.Millisecond), maxAcceptDelay)
			log.Warn("accept failed", "err", err, "retry_in", delay)
			select {
			case <-time.After(delay):
			case <-ctx.Done():
				return
			}
			continue
		}
		delay = 0
		if !s.track(conn) {
			conn.Close()
			return
		}
		s.wg.Add(1)
		go s.handleConn(ctx, conn, p, log)
	}
}

func (s *Server) handleConn(ctx context.Context, conn net.Conn, p protocol.Protocol, log *slog.Logger) {
	defer s.wg.Done()
	defer s.untrack(conn)
	log = log.With("remote", conn.RemoteAddr().String())
	defer func() {
		if r := recover(); r != nil {
			log.Error("panic in connection handler", "panic", r, "stack", string(debug.Stack()))
		}
	}()

	log.Debug("connection accepted")
	if err := p.HandleTCP(ctx, conn, s.sink, log); err != nil && ctx.Err() == nil {
		log.Info("connection closed", "err", err)
		return
	}
	log.Debug("connection closed")
}

// track registers a connection; it fails once shutdown has started.
func (s *Server) track(c net.Conn) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closing {
		return false
	}
	s.conns[c] = struct{}{}
	s.active.Add(1)
	return true
}

func (s *Server) untrack(c net.Conn) {
	c.Close()
	s.mu.Lock()
	if _, ok := s.conns[c]; ok {
		delete(s.conns, c)
		s.active.Add(-1)
	}
	s.mu.Unlock()
}

func (s *Server) closeConns() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closing = true
	for c := range s.conns {
		c.Close()
	}
}

type datagram struct {
	data []byte
	from net.Addr
}

func (s *Server) serveUDP(ctx context.Context, pc net.PacketConn, p protocol.Protocol, log *slog.Logger) {
	defer s.wg.Done()

	jobs := make(chan datagram, udpQueueSize)
	var workers sync.WaitGroup
	for range max(4, runtime.GOMAXPROCS(0)*2) {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for d := range jobs {
				s.handleDatagram(ctx, pc, p, d, log)
			}
		}()
	}
	defer func() {
		close(jobs)
		workers.Wait()
	}()

	buf := make([]byte, maxDatagramSize)
	var delay time.Duration
	for {
		n, from, err := pc.ReadFrom(buf)
		if err != nil {
			if ctx.Err() != nil || errors.Is(err, net.ErrClosed) {
				return
			}
			delay = min(max(2*delay, 5*time.Millisecond), maxAcceptDelay)
			log.Warn("udp read failed", "err", err, "retry_in", delay)
			select {
			case <-time.After(delay):
			case <-ctx.Done():
				return
			}
			continue
		}
		delay = 0
		d := datagram{data: append([]byte(nil), buf[:n]...), from: from}
		select {
		case jobs <- d:
		default:
			// Overloaded: drop; the device resends un-ACKed data.
			log.Warn("udp queue full, dropping datagram", "remote", from.String())
		}
	}
}

func (s *Server) handleDatagram(ctx context.Context, pc net.PacketConn, p protocol.Protocol, d datagram, log *slog.Logger) {
	log = log.With("remote", d.from.String())
	defer func() {
		if r := recover(); r != nil {
			log.Error("panic in udp handler", "panic", r, "stack", string(debug.Stack()))
		}
	}()
	reply, err := p.HandleUDP(ctx, d.data, d.from, s.sink, log)
	if err != nil {
		log.Info("udp datagram rejected", "err", err)
	}
	if len(reply) == 0 {
		return
	}
	if _, err := pc.WriteTo(reply, d.from); err != nil && ctx.Err() == nil {
		log.Warn("udp reply failed", "err", err)
	}
}
