// Package events turns incoming fixes into alerts: geofence enter/exit,
// overspeed, ignition changes and device alarms.
//
// The engine runs on the ingest path after positions are persisted. Rules are
// evaluated per device in device-time order and only on fixes newer than the
// last evaluated one, so replayed buffered records never fire stale alerts.
// Per-device state lives in memory and is initialised lazily from the latest
// stored fix, so a restart does not re-announce the current situation.
package events

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// persistTimeout bounds the event insert, independent of the device session.
const persistTimeout = 5 * time.Second

// Store is the subset of *store.Store the engine needs.
type Store interface {
	Device(id int64) (store.Device, error)
	Settings() store.Settings
	Geofences() []store.Geofence
	LatestPosition(ctx context.Context, deviceID int64, exclude []time.Time) (*domain.Position, error)
	InsertEvents(ctx context.Context, evs []store.Event) error
}

// Notifier delivers persisted events to external channels. Notify must not block.
type Notifier interface {
	Notify(e store.Event, deviceName string)
}

// Engine evaluates alert rules. It is safe for concurrent use.
type Engine struct {
	st     Store
	notify Notifier
	log    *slog.Logger

	mu      sync.Mutex
	devices map[int64]*state
}

// state is the rule state of one device.
type state struct {
	mu          sync.Mutex
	initialised bool
	last        time.Time      // device time of the last evaluated fix
	fencesKnown bool           // inside was computed from a valid fix
	inside      map[int64]bool // geofence id -> inside
	ignition    *bool          // last known ignition
	overSince   time.Time      // start of the current overspeed interval
	overActive  bool           // speed is above the limit
	overFired   bool           // event already raised for this interval
	overMax     float64        // highest speed in the current interval
}

// New returns an engine; notify may be nil.
func New(st Store, notify Notifier, log *slog.Logger) *Engine {
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	return &Engine{st: st, notify: notify, log: log, devices: make(map[int64]*state)}
}

// Process evaluates newly stored fixes (sorted by device time). It is meant
// as the store's Positions hook.
func (e *Engine) Process(ctx context.Context, ps []domain.Position) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), persistTimeout)
	defer cancel()
	byDevice := make(map[int64][]domain.Position)
	var order []int64
	for _, p := range ps {
		if _, ok := byDevice[p.DeviceID]; !ok {
			order = append(order, p.DeviceID)
		}
		byDevice[p.DeviceID] = append(byDevice[p.DeviceID], p)
	}
	for _, id := range order {
		e.processDevice(ctx, id, byDevice[id])
	}
}

func (e *Engine) processDevice(ctx context.Context, id int64, ps []domain.Position) {
	dev, err := e.st.Device(id)
	if err != nil { // deleted meanwhile
		e.mu.Lock()
		delete(e.devices, id)
		e.mu.Unlock()
		return
	}
	e.mu.Lock()
	s, ok := e.devices[id]
	if !ok {
		s = &state{inside: map[int64]bool{}}
		e.devices[id] = s
	}
	e.mu.Unlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	cfg := e.st.Settings()
	fences := e.st.Geofences()
	if !s.initialised {
		exclude := make([]time.Time, len(ps))
		for i := range ps {
			exclude[i] = ps[i].DeviceTime
		}
		prev, err := e.st.LatestPosition(ctx, id, exclude)
		if err != nil {
			e.log.Error("events: load last position", "device", id, "err", err)
			return // retry initialisation with the next batch
		}
		var evs []store.Event
		s.initialised = true
		if prev == nil {
			// No history: the first fix is the baseline. It only raises
			// alarms, which are momentary rather than a state change.
			for _, ev := range evaluate(&dev, cfg, fences, s, &ps[0]) {
				if ev.Type == store.EventAlarm {
					evs = append(evs, ev)
				}
			}
			ps = ps[1:]
		} else {
			evaluate(&dev, cfg, fences, s, prev) // already evaluated before the restart
			if s.overActive {
				s.overFired = true // assume it was reported before the restart
			}
		}
		e.Emit(ctx, dev.Name, evs...)
	}

	var evs []store.Event
	for i := range ps {
		evs = append(evs, evaluate(&dev, cfg, fences, s, &ps[i])...)
	}
	e.Emit(ctx, dev.Name, evs...)
}

// Emit persists events, publishes them live and hands them to the notifier.
func (e *Engine) Emit(ctx context.Context, deviceName string, evs ...store.Event) {
	if len(evs) == 0 {
		return
	}
	if err := e.st.InsertEvents(ctx, evs); err != nil {
		e.log.Error("events: persist", "count", len(evs), "err", err)
		return
	}
	for _, ev := range evs {
		if ev.ID != 0 && e.notify != nil {
			e.notify.Notify(ev, deviceName)
		}
	}
}

// evaluate applies p to the device state and returns the events it raises.
// Fixes not newer than the last evaluated one only get stored by the caller.
func evaluate(dev *store.Device, cfg store.Settings, fences []store.Geofence, s *state, p *domain.Position) []store.Event {
	if !s.last.IsZero() && !p.DeviceTime.After(s.last) {
		return nil
	}
	s.last = p.DeviceTime
	var evs []store.Event
	newEvent := func(typ, msg string, attrs map[string]any) *store.Event {
		evs = append(evs, store.Event{DeviceID: dev.ID, Type: typ, Time: p.DeviceTime, Lat: p.Latitude,
			Lng: p.Longitude, Attributes: attrs, Message: msg})
		return &evs[len(evs)-1]
	}
	fixed := p.Valid && !(p.Latitude == 0 && p.Longitude == 0)

	// Geofences: ignore invalid fixes; forget fences that no longer apply.
	// The first valid fix only establishes membership.
	if fixed {
		current := make(map[int64]bool, len(s.inside))
		for i := range fences {
			g := &fences[i]
			if !g.AppliesTo(dev.ID) {
				continue
			}
			in, was := g.Contains(p.Latitude, p.Longitude), s.inside[g.ID]
			if in {
				current[g.ID] = true
			}
			if in == was || !s.fencesKnown {
				continue
			}
			typ, verb := store.EventGeofenceEnter, "entered"
			if !in {
				typ, verb = store.EventGeofenceExit, "exited"
			}
			id := g.ID
			ev := newEvent(typ, fmt.Sprintf("%s %s %s", dev.Name, verb, g.Name), map[string]any{"geofenceName": g.Name})
			ev.GeofenceID = &id
		}
		s.inside, s.fencesKnown = current, true
	}

	// Ignition changes.
	if on, ok := p.Attributes[domain.AttrIgnition].(bool); ok {
		if s.ignition != nil && *s.ignition != on {
			if on {
				newEvent(store.EventIgnitionOn, dev.Name+" ignition on", map[string]any{})
			} else {
				newEvent(store.EventIgnitionOff, dev.Name+" ignition off", map[string]any{})
			}
		}
		s.ignition = &on
	}

	// Overspeed: above the limit continuously for the minimum duration.
	if fixed {
		limit := dev.SpeedLimit
		if limit <= 0 {
			limit = cfg.SpeedLimit
		}
		switch {
		case limit <= 0 || p.Speed <= limit:
			s.overActive, s.overFired = false, false
		case !s.overActive:
			s.overActive, s.overFired, s.overSince, s.overMax = true, false, p.DeviceTime, p.Speed
		default:
			s.overMax = max(s.overMax, p.Speed)
		}
		minDur := time.Duration(cfg.OverspeedMinDuration) * time.Second
		if s.overActive && !s.overFired && p.DeviceTime.Sub(s.overSince) >= minDur {
			s.overFired = true
			newEvent(store.EventOverspeed,
				fmt.Sprintf("%s is speeding: %.0f km/h (limit %.0f km/h)", dev.Name, p.Speed, limit),
				map[string]any{"speed": round1(p.Speed), "maxSpeed": round1(s.overMax), "limit": limit})
		}
	}

	// Device alarms.
	if alarm, ok := p.Attributes[domain.AttrAlarm].(string); ok && alarm != "" {
		newEvent(store.EventAlarm, fmt.Sprintf("%s alarm: %s", dev.Name, AlarmLabel(alarm)), map[string]any{"alarm": alarm})
	}
	return evs
}

func round1(v float64) float64 { return float64(int64(v*10+0.5)) / 10 }

// AlarmLabel returns a human readable alarm name.
func AlarmLabel(alarm string) string {
	switch alarm {
	case "sos":
		return "SOS"
	case "powerCut":
		return "power cut"
	case "jamming":
		return "GSM/GPS jamming"
	case "":
		return "unknown"
	}
	return strings.ToLower(alarm[:1]) + alarm[1:]
}
