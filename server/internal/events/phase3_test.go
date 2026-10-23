package events

import (
	"context"
	"testing"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

func TestHarshEvents(t *testing.T) {
	e, fs, _ := newEngine()
	ctx := context.Background()
	// Harsh on the very first fix fires (momentary, like alarms).
	e.Process(ctx, []domain.Position{fix(0, outLat, outLng, 40, map[string]any{"harsh": "braking", "harshValue": 2.5})})
	check(t, fs, store.EventHarshBraking)
	e.Process(ctx, []domain.Position{
		fix(10, outLat, outLng, 50, map[string]any{"harsh": "acceleration"}),
		fix(20, outLat, outLng, 50, map[string]any{"harsh": "cornering"}),
		fix(30, outLat, outLng, 50, map[string]any{"harsh": "bogus"}),
		fix(40, outLat, outLng, 50, nil),
	})
	check(t, fs, store.EventHarshAcceleration, store.EventHarshCornering)
	// Replayed (older) records do not fire.
	e.Process(ctx, []domain.Position{fix(5, outLat, outLng, 50, map[string]any{"harsh": "braking"})})
	check(t, fs)
}

func TestHarshEventFields(t *testing.T) {
	e, fs, _ := newEngine()
	e.Process(context.Background(), []domain.Position{fix(0, outLat, outLng, 40, map[string]any{"harsh": "braking", "harshValue": 2.5})})
	ev := fs.events[0]
	if ev.Message != "Truck 07 harsh braking at 40 km/h" || ev.Attributes["value"] != 2.5 || ev.Attributes["speed"] != 40.0 {
		t.Fatalf("event %+v", ev)
	}
}

func TestIdleEvents(t *testing.T) {
	e, fs, _ := newEngine()
	fs.cfg.IdleAlertMinutes = 5
	ctx := context.Background()
	on := func() map[string]any { return map[string]any{"ignition": true} }
	off := map[string]any{"ignition": false}
	e.Process(ctx, []domain.Position{fix(0, outLat, outLng, 0, off)}) // baseline
	check(t, fs)
	// Ignition on, idle for 4 min: nothing yet.
	e.Process(ctx, []domain.Position{fix(60, outLat, outLng, 0, on()), fix(300, outLat, outLng, 2, on())})
	check(t, fs, store.EventIgnitionOn)
	// 5 min reached -> one event, not repeated.
	e.Process(ctx, []domain.Position{fix(360, outLat, outLng, 0, on()), fix(600, outLat, outLng, 0, on())})
	if len(fs.events) != 1 || fs.events[0].Type != store.EventIdle || fs.events[0].Attributes["minutes"] != 5 {
		t.Fatalf("events %+v", fs.events)
	}
	check(t, fs, store.EventIdle)
	// Moving ends the period; a new idle period fires again.
	e.Process(ctx, []domain.Position{fix(700, outLat, outLng, 30, on()), fix(800, outLat, outLng, 0, on()),
		fix(1100, outLat, outLng, 0, on())})
	check(t, fs, store.EventIdle)
	// Ignition off resets; idle without ignition never fires.
	e.Process(ctx, []domain.Position{fix(1200, outLat, outLng, 0, off), fix(2000, outLat, outLng, 0, nil)})
	check(t, fs, store.EventIgnitionOff)

	// Disabled (0 minutes): no idle events.
	fs.cfg.IdleAlertMinutes = 0
	e.Process(ctx, []domain.Position{fix(2100, outLat, outLng, 0, on()), fix(4000, outLat, outLng, 0, on())})
	check(t, fs, store.EventIgnitionOn)
}
