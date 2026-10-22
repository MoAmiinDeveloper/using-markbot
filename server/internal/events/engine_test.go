package events

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// fakeStore keeps everything in memory.
type fakeStore struct {
	mu     sync.Mutex
	dev    store.Device
	cfg    store.Settings
	fences []store.Geofence
	latest *domain.Position // returned by LatestPosition
	events []store.Event
	nextID int64
}

func (f *fakeStore) Device(id int64) (store.Device, error) {
	if id != f.dev.ID {
		return store.Device{}, store.ErrNotFound
	}
	return f.dev, nil
}
func (f *fakeStore) Settings() store.Settings    { return f.cfg }
func (f *fakeStore) Geofences() []store.Geofence { return f.fences }
func (f *fakeStore) LatestPosition(context.Context, int64, []time.Time) (*domain.Position, error) {
	return f.latest, nil
}
func (f *fakeStore) InsertEvents(_ context.Context, evs []store.Event) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := range evs {
		f.nextID++
		evs[i].ID = f.nextID
		f.events = append(f.events, evs[i])
	}
	return nil
}

// take returns and clears the recorded event types.
func (f *fakeStore) take() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for _, e := range f.events {
		out = append(out, e.Type)
	}
	f.events = nil
	return out
}

type fakeNotifier struct{ n int }

func (n *fakeNotifier) Notify(store.Event, string) { n.n++ }

var t0 = time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC)

func fix(sec int, lat, lng, speed float64, attrs map[string]any) domain.Position {
	if attrs == nil {
		attrs = map[string]any{}
	}
	return domain.Position{DeviceID: 1, DeviceTime: t0.Add(time.Duration(sec) * time.Second), Latitude: lat,
		Longitude: lng, Speed: speed, Valid: true, Attributes: attrs}
}

func newEngine() (*Engine, *fakeStore, *fakeNotifier) {
	fs := &fakeStore{
		dev: store.Device{ID: 1, Name: "Truck 07"},
		cfg: store.Settings{SpeedLimit: 100, OverspeedMinDuration: 20},
		fences: []store.Geofence{{ID: 3, Name: "Depot", Type: store.GeofenceCircle,
			Center: &[2]float64{55.27, 25.20}, Radius: 500}},
	}
	n := &fakeNotifier{}
	return New(fs, n, nil), fs, n
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func check(t *testing.T, fs *fakeStore, want ...string) {
	t.Helper()
	if got := fs.take(); !equal(got, want) {
		t.Fatalf("events = %v, want %v", got, want)
	}
}

const (
	inLat, inLng   = 25.20, 55.27
	outLat, outLng = 25.30, 55.27
)

func TestGeofenceEnterExit(t *testing.T) {
	e, fs, n := newEngine()
	ctx := context.Background()
	e.Process(ctx, []domain.Position{fix(0, outLat, outLng, 0, nil)}) // baseline
	check(t, fs)
	e.Process(ctx, []domain.Position{fix(10, inLat, inLng, 0, nil), fix(20, inLat, inLng, 0, nil)})
	check(t, fs, store.EventGeofenceEnter)
	// Invalid fixes are ignored for geofences.
	bad := fix(30, outLat, outLng, 0, nil)
	bad.Valid = false
	e.Process(ctx, []domain.Position{bad})
	check(t, fs)
	e.Process(ctx, []domain.Position{fix(40, outLat, outLng, 0, nil)})
	check(t, fs, store.EventGeofenceExit)
	if n.n != 2 {
		t.Fatalf("notified %d", n.n)
	}

	// Geofences limited to other devices do not apply.
	fs.fences[0].DeviceIDs = []int64{2}
	e.Process(ctx, []domain.Position{fix(50, inLat, inLng, 0, nil)})
	check(t, fs)
}

func TestGeofenceEventFields(t *testing.T) {
	e, fs, _ := newEngine()
	ctx := context.Background()
	e.Process(ctx, []domain.Position{fix(0, outLat, outLng, 0, nil), fix(1, inLat, inLng, 0, nil)})
	if len(fs.events) != 1 {
		t.Fatalf("events %+v", fs.events)
	}
	ev := fs.events[0]
	if ev.GeofenceID == nil || *ev.GeofenceID != 3 || ev.Message != "Truck 07 entered Depot" ||
		ev.Attributes["geofenceName"] != "Depot" || !ev.Time.Equal(t0.Add(time.Second)) || ev.Lat != inLat {
		t.Fatalf("event %+v", ev)
	}
}

func TestOverspeedMinDurationAndRearm(t *testing.T) {
	e, fs, _ := newEngine()
	ctx := context.Background()
	e.Process(ctx, []domain.Position{fix(0, outLat, outLng, 50, nil)})
	// Above the limit for only 15 s: no event.
	e.Process(ctx, []domain.Position{fix(5, outLat, outLng, 110, nil), fix(20, outLat, outLng, 120, nil),
		fix(25, outLat, outLng, 90, nil)})
	check(t, fs)
	// Continuously above for 20 s: exactly one event.
	e.Process(ctx, []domain.Position{fix(30, outLat, outLng, 110, nil), fix(40, outLat, outLng, 130, nil),
		fix(50, outLat, outLng, 115, nil), fix(60, outLat, outLng, 140, nil)})
	check(t, fs, store.EventOverspeed)
	// Drop below re-arms; next interval fires again.
	e.Process(ctx, []domain.Position{fix(70, outLat, outLng, 80, nil), fix(80, outLat, outLng, 105, nil),
		fix(100, outLat, outLng, 106, nil)})
	check(t, fs, store.EventOverspeed)

	// Device limit overrides the global default.
	fs.dev.SpeedLimit = 150
	e.Process(ctx, []domain.Position{fix(110, outLat, outLng, 80, nil), fix(120, outLat, outLng, 140, nil),
		fix(200, outLat, outLng, 140, nil)})
	check(t, fs)
}

func TestOverspeedAttributes(t *testing.T) {
	e, fs, _ := newEngine()
	fs.cfg.OverspeedMinDuration = 0
	e.Process(context.Background(), []domain.Position{fix(0, outLat, outLng, 0, nil), fix(1, outLat, outLng, 112.04, nil)})
	if len(fs.events) != 1 {
		t.Fatalf("events %+v", fs.events)
	}
	a := fs.events[0].Attributes
	if a["speed"] != 112.0 || a["limit"] != 100.0 || fs.events[0].Message != "Truck 07 is speeding: 112 km/h (limit 100 km/h)" {
		t.Fatalf("event %+v", fs.events[0])
	}
}

func TestIgnitionAndAlarm(t *testing.T) {
	e, fs, _ := newEngine()
	ctx := context.Background()
	on := map[string]any{domain.AttrIgnition: true}
	off := map[string]any{domain.AttrIgnition: false}
	e.Process(ctx, []domain.Position{fix(0, outLat, outLng, 0, off)})
	e.Process(ctx, []domain.Position{fix(1, outLat, outLng, 0, off), fix(2, outLat, outLng, 0, on),
		fix(3, outLat, outLng, 0, nil), fix(4, outLat, outLng, 0, on), fix(5, outLat, outLng, 0, off)})
	check(t, fs, store.EventIgnitionOn, store.EventIgnitionOff)

	e.Process(ctx, []domain.Position{fix(6, outLat, outLng, 0, map[string]any{domain.AttrAlarm: "powerCut"})})
	check(t, fs, store.EventAlarm)
	if fs.nextID == 0 {
		t.Fatal("not persisted")
	}
}

func TestOutOfOrderRecordsDoNotFire(t *testing.T) {
	e, fs, _ := newEngine()
	ctx := context.Background()
	e.Process(ctx, []domain.Position{fix(0, outLat, outLng, 0, nil), fix(100, outLat, outLng, 0, nil)})
	// Replayed older records (inside the fence, alarm, ignition) are stored but silent.
	e.Process(ctx, []domain.Position{fix(50, inLat, inLng, 0, map[string]any{domain.AttrAlarm: "sos",
		domain.AttrIgnition: true}), fix(100, inLat, inLng, 0, nil)})
	check(t, fs)
	// The next newer fix is still compared with the newest state (outside).
	e.Process(ctx, []domain.Position{fix(101, outLat, outLng, 0, nil)})
	check(t, fs)
}

func TestNoSpamOnRestart(t *testing.T) {
	// Before the restart the vehicle was inside the fence, ignition on and
	// already speeding: a fresh engine initialises from that fix silently.
	e, fs, _ := newEngine()
	fs.latest = &domain.Position{DeviceID: 1, DeviceTime: t0, Latitude: inLat, Longitude: inLng, Speed: 130,
		Valid: true, Attributes: map[string]any{domain.AttrIgnition: true}}
	ctx := context.Background()
	e.Process(ctx, []domain.Position{fix(30, inLat, inLng, 130, map[string]any{domain.AttrIgnition: true}),
		fix(60, inLat, inLng, 135, map[string]any{domain.AttrIgnition: true})})
	check(t, fs)
	// Real changes after the restart still fire.
	e.Process(ctx, []domain.Position{fix(90, outLat, outLng, 50, map[string]any{domain.AttrIgnition: false})})
	check(t, fs, store.EventGeofenceExit, store.EventIgnitionOff)

	// A device without history takes its first fix as the baseline; only
	// an alarm on it fires.
	e2, fs2, _ := newEngine()
	e2.Process(ctx, []domain.Position{fix(0, inLat, inLng, 0, map[string]any{domain.AttrIgnition: true,
		domain.AttrAlarm: "sos"})})
	check(t, fs2, store.EventAlarm)
}

func TestNewGeofenceFiresEnter(t *testing.T) {
	e, fs, _ := newEngine()
	ctx := context.Background()
	fs.fences = nil
	e.Process(ctx, []domain.Position{fix(0, inLat, inLng, 0, nil)})
	fs.fences = []store.Geofence{{ID: 4, Name: "New", Type: store.GeofencePolygon,
		Polygon: [][2]float64{{55.2, 25.1}, {55.3, 25.1}, {55.3, 25.25}, {55.2, 25.25}}}}
	e.Process(ctx, []domain.Position{fix(1, inLat, inLng, 0, nil)})
	check(t, fs, store.EventGeofenceEnter)
	// Deleting it forgets membership without an exit event.
	fs.fences = nil
	e.Process(ctx, []domain.Position{fix(2, outLat, outLng, 0, nil)})
	check(t, fs)
}
