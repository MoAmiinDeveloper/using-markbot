package teltonika

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"
	"time"
)

// DefaultCommandTimeout applies to Session.Send when ctx has no deadline.
const DefaultCommandTimeout = 30 * time.Second

// ErrSessionClosed is returned by Send when the device disconnects.
var ErrSessionClosed = errors.New("teltonika: session closed")

// Session is a live TCP connection of an authorized device. It is the hook
// for sending Codec 12 commands (engine block, reboot …).
type Session struct {
	IMEI       string
	RemoteAddr string

	conn         net.Conn
	writeTimeout time.Duration
	writeMu      sync.Mutex // serializes ACKs and commands
	cmdMu        sync.Mutex // one outstanding command at a time
	replies      chan string
	done         chan struct{}
	closeOnce    sync.Once
}

func newSession(imei, remote string, conn net.Conn, writeTimeout time.Duration) *Session {
	return &Session{
		IMEI:         imei,
		RemoteAddr:   remote,
		conn:         conn,
		writeTimeout: writeTimeout,
		replies:      make(chan string, 1),
		done:         make(chan struct{}),
	}
}

// Send transmits a Codec 12 command and waits for the device's response.
// Commands on one session are serialized.
func (s *Session) Send(ctx context.Context, cmd string) (string, error) {
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, DefaultCommandTimeout)
		defer cancel()
	}
	s.cmdMu.Lock()
	defer s.cmdMu.Unlock()

	select { // drop a late reply to an earlier, timed-out command
	case <-s.replies:
	default:
	}
	if err := s.write(EncodeCodec12Command(cmd)); err != nil {
		return "", fmt.Errorf("send command: %w", err)
	}
	select {
	case r := <-s.replies:
		return r, nil
	case <-s.done:
		return "", ErrSessionClosed
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

func (s *Session) write(b []byte) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	select {
	case <-s.done:
		return ErrSessionClosed
	default:
	}
	if err := s.conn.SetWriteDeadline(time.Now().Add(s.writeTimeout)); err != nil {
		return err
	}
	_, err := s.conn.Write(b)
	return err
}

// deliver hands a command response to a waiting Send; unsolicited replies
// are dropped when nobody is waiting.
func (s *Session) deliver(reply string) {
	select {
	case s.replies <- reply:
	default:
	}
}

func (s *Session) close() { s.closeOnce.Do(func() { close(s.done) }) }

// registry indexes live sessions by IMEI. A reconnecting device replaces its
// stale session.
type registry struct {
	mu sync.RWMutex
	m  map[string]*Session
}

func (r *registry) add(s *Session) {
	r.mu.Lock()
	r.m[s.IMEI] = s
	r.mu.Unlock()
}

func (r *registry) remove(s *Session) {
	r.mu.Lock()
	if r.m[s.IMEI] == s {
		delete(r.m, s.IMEI)
	}
	r.mu.Unlock()
}

func (r *registry) get(imei string) (*Session, bool) {
	r.mu.RLock()
	s, ok := r.m[imei]
	r.mu.RUnlock()
	return s, ok
}
