// Package commands sends text commands (Teltonika Codec 12) to devices.
//
// A command for a connected device is sent right away; otherwise it stays
// queued until the device next connects, and expires after QueueTTL. Every
// status change is published live by the store, and the outcome is also
// recorded as a commandResult event.
package commands

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/moamiindeveloper/fleet/server/internal/protocol/teltonika"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// Command types.
const (
	EngineStop   = "engineStop"
	EngineResume = "engineResume"
	Reboot       = "reboot"
	GetInfo      = "getInfo"
	GetVersion   = "getVersion"
	Custom       = "custom"
)

// Teltonika is the Teltonika text for each predefined type.
var Teltonika = map[string]string{
	EngineStop:   "setdigout 1",
	EngineResume: "setdigout 0",
	Reboot:       "cpureset",
	GetInfo:      "getinfo",
	GetVersion:   "getver",
}

// AdminOnly reports whether a command type requires the admin role.
func AdminOnly(typ string) bool { return typ == EngineStop || typ == EngineResume || typ == Custom }

// Defaults.
const (
	QueueTTL       = 24 * time.Hour
	ReplyTimeout   = 30 * time.Second
	expireInterval = time.Minute
	maxTextLen     = 512
)

// Errors returned by Create.
var (
	ErrForbidden   = errors.New("this command requires the admin role")
	ErrUnsupported = errors.New("bridged devices cannot receive commands")
)

// Sessions finds live device sessions; *teltonika.Handler implements it.
type Sessions interface {
	Session(imei string) (*teltonika.Session, bool)
}

// Emitter records events; *events.Engine implements it.
type Emitter interface {
	Emit(ctx context.Context, deviceName string, evs ...store.Event)
}

// Service queues and sends commands. It is safe for concurrent use.
type Service struct {
	st       *store.Store
	sessions Sessions
	emit     Emitter
	log      *slog.Logger
	now      func() time.Time

	ctx    context.Context // lifetime of background sends
	cancel context.CancelFunc
	wg     sync.WaitGroup

	mu      sync.Mutex
	running map[int64]bool // device flush goroutine active
	again   map[int64]bool // flush requested while running
}

// New returns a service; emit may be nil. Commands a previous run left
// waiting for a reply are marked failed, so call it before ingest starts.
func New(ctx context.Context, st *store.Store, sessions Sessions, emit Emitter, log *slog.Logger) (*Service, error) {
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	n, err := st.FailInterruptedCommands(ctx)
	if err != nil {
		return nil, fmt.Errorf("fail interrupted commands: %w", err)
	}
	if n > 0 {
		log.Warn("commands interrupted by restart marked failed", "count", n)
	}
	bg, cancel := context.WithCancel(context.Background())
	return &Service{st: st, sessions: sessions, emit: emit, log: log, now: time.Now, ctx: bg, cancel: cancel,
		running: map[int64]bool{}, again: map[int64]bool{}}, nil
}

// Run expires stale queued commands until ctx is done, then stops pending sends.
func (s *Service) Run(ctx context.Context) {
	t := time.NewTicker(expireInterval)
	defer t.Stop()
	for {
		s.expire(ctx)
		select {
		case <-ctx.Done():
			s.cancel()
			s.wg.Wait()
			return
		case <-t.C:
		}
	}
}

// Create validates and queues a command, sending it at once when the device
// is connected. isAdmin gates the dangerous types.
func (s *Service) Create(ctx context.Context, deviceID, userID int64, isAdmin bool, typ, text string) (store.Command, error) {
	if typ == Custom {
		text = strings.TrimSpace(text)
		switch {
		case text == "":
			return store.Command{}, &store.ValidationError{Msg: "text is required for custom commands"}
		case utf8.RuneCountInString(text) > maxTextLen || strings.ContainsAny(text, "\r\n"):
			return store.Command{}, &store.ValidationError{Msg: fmt.Sprintf("text must be one line of at most %d characters", maxTextLen)}
		}
	} else if text = Teltonika[typ]; text == "" {
		return store.Command{}, &store.ValidationError{Msg: "type must be one of: engineStop, engineResume, reboot, getInfo, getVersion, custom"}
	}
	if AdminOnly(typ) && !isAdmin {
		return store.Command{}, ErrForbidden
	}
	dev, err := s.st.Device(deviceID)
	if err != nil {
		return store.Command{}, err
	}
	if dev.Source != store.SourceDirect {
		return store.Command{}, ErrUnsupported
	}
	c, err := s.st.CreateCommand(ctx, deviceID, userID, typ, text)
	if err != nil {
		return c, err
	}
	if _, ok := s.sessions.Session(dev.IMEI); ok {
		s.kick(deviceID)
	}
	return c, nil
}

// DeviceConnected flushes the device's queue; it is the store's Connected hook.
func (s *Service) DeviceConnected(_ context.Context, deviceID int64, _ string) { s.kick(deviceID) }

// kick starts (or re-triggers) the flush goroutine of a device, so commands
// of one device go out one at a time and in order.
func (s *Service) kick(deviceID int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ctx.Err() != nil {
		return
	}
	if s.running[deviceID] {
		s.again[deviceID] = true
		return
	}
	s.running[deviceID] = true
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		for {
			s.flush(deviceID)
			s.mu.Lock()
			if !s.again[deviceID] || s.ctx.Err() != nil {
				delete(s.running, deviceID)
				delete(s.again, deviceID)
				s.mu.Unlock()
				return
			}
			delete(s.again, deviceID)
			s.mu.Unlock()
		}
	}()
}

// flush sends the queued commands of a device while it stays connected.
func (s *Service) flush(deviceID int64) {
	ctx := s.ctx
	dev, err := s.st.Device(deviceID)
	if err != nil {
		return
	}
	queued, err := s.st.QueuedCommands(ctx, deviceID)
	if err != nil {
		s.log.Error("commands: load queue", "device", deviceID, "err", err)
		return
	}
	for _, c := range queued {
		sess, ok := s.sessions.Session(dev.IMEI)
		if !ok {
			return // stays queued until the next connection
		}
		if _, err := s.st.TransitionCommand(ctx, c.ID, store.CommandQueued, store.CommandSent, ""); err != nil {
			if !errors.Is(err, store.ErrNotFound) { // else: expired meanwhile
				s.log.Error("commands: mark sent", "command", c.ID, "err", err)
			}
			continue
		}
		s.log.Info("sending command", "device", deviceID, "command", c.ID, "text", c.Text)
		sctx, cancel := context.WithTimeout(ctx, ReplyTimeout)
		reply, err := sess.Send(sctx, c.Text)
		cancel()
		status, response := store.CommandSuccess, reply
		if err != nil {
			status, response = store.CommandFailed, failure(err)
			s.log.Warn("command failed", "device", deviceID, "command", c.ID, "err", err)
		}
		// Record the outcome even when shutting down.
		rctx, rcancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		done, err := s.st.TransitionCommand(rctx, c.ID, store.CommandSent, status, response)
		if err != nil {
			s.log.Error("commands: record result", "command", c.ID, "err", err)
		} else {
			s.result(rctx, dev, done)
		}
		rcancel()
	}
}

func failure(err error) string {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return "no response from device"
	case errors.Is(err, teltonika.ErrSessionClosed):
		return "device disconnected"
	case errors.Is(err, context.Canceled):
		return "server shutting down"
	}
	return err.Error()
}

// expire marks commands queued for longer than QueueTTL as expired.
func (s *Service) expire(ctx context.Context) {
	cs, err := s.st.ExpireCommands(ctx, s.now().Add(-QueueTTL))
	if err != nil {
		if ctx.Err() == nil {
			s.log.Error("commands: expire", "err", err)
		}
		return
	}
	for _, c := range cs {
		if dev, err := s.st.Device(c.DeviceID); err == nil {
			s.result(ctx, dev, c)
		}
	}
}

// result records the outcome of a command as a commandResult event.
func (s *Service) result(ctx context.Context, dev store.Device, c store.Command) {
	if s.emit == nil {
		return
	}
	var msg string
	switch c.Status {
	case store.CommandSuccess:
		msg = fmt.Sprintf("%s replied to %q: %s", dev.Name, c.Text, c.Response)
	case store.CommandExpired:
		msg = fmt.Sprintf("Command %q to %s expired: the device did not connect within 24 hours", c.Text, dev.Name)
	default:
		msg = fmt.Sprintf("Command %q to %s failed: %s", c.Text, dev.Name, c.Response)
	}
	ev := store.Event{DeviceID: dev.ID, Type: store.EventCommandResult, Time: s.now().UTC(), Message: msg,
		Attributes: map[string]any{"commandId": c.ID, "commandType": c.Type, "status": c.Status, "response": c.Response}}
	if p := dev.Position; p != nil {
		ev.Lat, ev.Lng = p.Latitude, p.Longitude
	}
	s.emit.Emit(ctx, dev.Name, ev)
}
