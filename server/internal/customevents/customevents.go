// Package customevents raises user-defined events: a condition over position
// fields and parameters (raw, mapped or calculated) that must hold for a
// minimum duration, e.g. "ignition && power < 11.5" for 60 s.
package customevents

import (
	"context"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"sync"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// Store is the subset of *store.Store the rule needs.
type Store interface {
	CustomEvents() []store.CustomEvent
	DeviceParams(deviceID int64) []store.ParamDef
}

// state of one custom event on one device.
type state struct {
	initialised bool
	condition   string // a changed condition restarts the state
	last        time.Time
	since       time.Time // condition true since (zero = false)
	fired       bool      // start event raised for the current period
}

type key struct{ event, device int64 }

// Rule implements events.Rule.
type Rule struct {
	st Store

	started time.Time

	mu     sync.Mutex
	states map[key]*state
}

// New returns the rule; register it with events.Engine.AddRule.
func New(st Store) *Rule { return &Rule{st: st, started: time.Now(), states: map[key]*state{}} }

// Eval implements events.Rule.
func (r *Rule) Eval(_ context.Context, dev *store.Device, p *domain.Position) []store.Event {
	var evs []store.Event
	defs := r.st.CustomEvents()
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := range defs {
		c := &defs[i]
		e := c.Compiled()
		if !c.Enabled || e == nil || !c.AppliesTo(dev.ID) {
			continue
		}
		k := key{c.ID, dev.ID}
		s := r.states[k]
		if s == nil || s.condition != c.Condition {
			s = &state{condition: c.Condition}
			r.states[k] = s
		}
		if !s.last.IsZero() && !p.DeviceTime.After(s.last) {
			continue
		}
		ok, err := e.EvalBool(store.PositionEnv(p))
		if err != nil {
			continue // inputs not in this fix: keep the current state
		}
		s.last = p.DeviceTime
		first := !s.initialised
		s.initialised = true
		switch {
		case ok && s.since.IsZero():
			s.since = p.DeviceTime
			// Already true on the first fix after a restart: assume it was
			// announced before, like the built-in rules do. A definition
			// created or changed since the start fires normally.
			s.fired = first && c.UpdatedAt.Before(r.started)
		case !ok && !s.since.IsZero():
			if s.fired && c.NotifyEnd {
				evs = append(evs, r.event(c, dev, p, "end", p.DeviceTime.Sub(s.since)))
			}
			s.since, s.fired = time.Time{}, false
		}
		if ok && !s.fired && p.DeviceTime.Sub(s.since) >= time.Duration(c.Duration)*time.Second {
			s.fired = true
			evs = append(evs, r.event(c, dev, p, "start", p.DeviceTime.Sub(s.since)))
		}
	}
	return evs
}

// Forget drops the states of a device or custom event (0 = any).
func (r *Rule) Forget(eventID, deviceID int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for k := range r.states {
		if (eventID == 0 || k.event == eventID) && (deviceID == 0 || k.device == deviceID) {
			delete(r.states, k)
		}
	}
}

func (r *Rule) event(c *store.CustomEvent, dev *store.Device, p *domain.Position, phase string, held time.Duration) store.Event {
	msg := Render(c.Message, c.Name, dev, p, r.st.DeviceParams(dev.ID))
	if c.Message == "" {
		msg = dev.Name + ": " + c.Name
	}
	if phase == "end" {
		msg = dev.Name + ": " + c.Name + " ended"
	}
	return store.Event{DeviceID: dev.ID, Type: store.EventCustom, Time: p.DeviceTime, Lat: p.Latitude, Lng: p.Longitude,
		Message: msg, Attributes: map[string]any{
			"customEventId": c.ID, "name": c.Name, "severity": c.Severity, "phase": phase,
			"duration": math.Round(held.Seconds()),
		}}
}

var placeholder = regexp.MustCompile(`\{([A-Za-z_][A-Za-z0-9_]*)\}`)

// Render fills a message template: {device}, {plate}, {name} and any
// parameter key, e.g. "{device} battery low: {power} V". Numbers use the
// decimals of the parameter definition; unknown placeholders stay as typed.
func Render(tpl, name string, dev *store.Device, p *domain.Position, defs []store.ParamDef) string {
	decimals := map[string]int{"speed": 0, "course": 0, "altitude": 0, "lat": 5, "lng": 5}
	for _, d := range defs {
		decimals[d.Key] = d.Decimals
	}
	env := store.PositionEnv(p)
	return placeholder.ReplaceAllStringFunc(tpl, func(m string) string {
		k := m[1 : len(m)-1]
		switch k {
		case "device":
			return dev.Name
		case "plate":
			return dev.Plate
		case "name":
			return name
		}
		v, ok := env(k)
		if !ok || v == nil {
			return m
		}
		switch x := v.(type) {
		case float64:
			d, ok := decimals[k]
			if !ok {
				d = 2
			}
			return strconv.FormatFloat(store.RoundTo(x, d), 'f', -1, 64)
		case bool:
			if x {
				return "yes"
			}
			return "no"
		}
		return fmt.Sprint(v)
	})
}
