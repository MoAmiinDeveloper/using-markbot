package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
)

func TestGeofenceContains(t *testing.T) {
	circle := Geofence{Type: GeofenceCircle, Center: &[2]float64{55.2708, 25.2048}, Radius: 1000}
	// A square around Dubai Mall-ish coordinates, given [lng, lat].
	square := Geofence{Type: GeofencePolygon, Polygon: [][2]float64{{55.0, 25.0}, {55.1, 25.0}, {55.1, 25.1}, {55.0, 25.1}}}
	// Concave "L" shape: the notch at the top right is outside.
	ell := Geofence{Type: GeofencePolygon, Polygon: [][2]float64{{0, 0}, {2, 0}, {2, 1}, {1, 1}, {1, 2}, {0, 2}}}
	cases := []struct {
		g        *Geofence
		lat, lng float64
		want     bool
	}{
		{&circle, 25.2048, 55.2708, true},
		{&circle, 25.2048 + 0.0089, 55.2708, true},  // ~990 m north
		{&circle, 25.2048 + 0.0091, 55.2708, false}, // ~1012 m north
		{&circle, 25.2048, 55.2708 + 0.0110, false}, // ~1110 m east
		{&square, 25.05, 55.05, true},
		{&square, 25.05, 55.15, false},
		{&square, 24.99, 55.05, false},
		{&ell, 0.5, 1.5, true},
		{&ell, 1.5, 0.5, true},
		{&ell, 1.5, 1.5, false},
		{&ell, 3, 3, false},
	}
	for i, c := range cases {
		if got := c.g.Contains(c.lat, c.lng); got != c.want {
			t.Errorf("case %d: Contains(%v, %v) = %v, want %v", i, c.lat, c.lng, got, c.want)
		}
	}
	if !(&Geofence{}).AppliesTo(1) || (&Geofence{DeviceIDs: []int64{2}}).AppliesTo(1) {
		t.Error("AppliesTo")
	}
}

func TestGeofenceCRUD(t *testing.T) {
	rec := &recorder{}
	s := newTestStore(t, testPool(t), Options{Publisher: rec})
	ctx := context.Background()
	d, err := s.CreateDevice(ctx, DeviceInput{Name: "A", IMEI: imei1})
	if err != nil {
		t.Fatal(err)
	}

	bad := []GeofenceInput{
		{Name: "", Type: "circle", Center: &[2]float64{55, 25}, Radius: 100},
		{Name: "x", Type: "circle", Center: &[2]float64{55, 25}, Radius: 5},
		{Name: "x", Type: "circle", Center: &[2]float64{55, 25}, Radius: 100_001},
		{Name: "x", Type: "circle", Center: &[2]float64{55, 95}, Radius: 100},
		{Name: "x", Type: "circle", Radius: 100},
		{Name: "x", Type: "polygon", Polygon: [][2]float64{{0, 0}, {1, 1}}},
		{Name: "x", Type: "polygon", Polygon: [][2]float64{{0, 0}, {1, 1}, {0, 0}}}, // closed ring of 2 points
		{Name: "x", Type: "polygon", Polygon: [][2]float64{{0, 0}, {1, 1}, {181, 0}}},
		{Name: "x", Color: "red", Type: "circle", Center: &[2]float64{55, 25}, Radius: 100},
		{Name: "x", Type: "square"},
		{Name: "x", Type: "circle", Center: &[2]float64{55, 25}, Radius: 100, DeviceIDs: []int64{999}},
	}
	for i, in := range bad {
		if _, err := s.CreateGeofence(ctx, in); !isValidation(err) {
			t.Errorf("bad[%d]: err = %v, want validation error", i, err)
		}
	}

	g, err := s.CreateGeofence(ctx, GeofenceInput{Name: " Depot ", Type: "polygon",
		Polygon: [][2]float64{{0, 0}, {1, 0}, {1, 1}, {0, 0}, {0, 0}}[:4], DeviceIDs: []int64{d.ID, d.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if g.Name != "Depot" || g.Color != defaultColor || len(g.Polygon) != 3 || len(g.DeviceIDs) != 1 || g.Center != nil {
		t.Fatalf("created %+v", g)
	}
	if n := len(rec.take(EventGeofences)); n != 1 {
		t.Fatalf("geofences events = %d", n)
	}

	// Switch to a circle: the polygon is dropped.
	typ, r := "circle", 250.0
	g, err = s.UpdateGeofence(ctx, g.ID, GeofencePatch{Type: &typ, Center: &[2]float64{55.27, 25.2}, Radius: &r})
	if err != nil {
		t.Fatal(err)
	}
	if g.Polygon != nil || g.Radius != 250 || g.Center[0] != 55.27 || len(s.Geofences()) != 1 || s.Geofences()[0].Radius != 250 {
		t.Fatalf("updated %+v / cache %+v", g, s.Geofences())
	}

	// Cache survives a reload.
	s2 := newTestStore(t, s.pool, Options{})
	if gs := s2.Geofences(); len(gs) != 1 || gs[0].Type != "circle" || gs[0].DeviceIDs[0] != d.ID {
		t.Fatalf("reloaded %+v", gs)
	}

	if err := s.DeleteGeofence(ctx, g.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteGeofence(ctx, g.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete: %v", err)
	}
	if len(s.Geofences()) != 0 {
		t.Fatal("cache not updated")
	}
}

func TestPositionsDedupeAndHook(t *testing.T) {
	s := newTestStore(t, testPool(t), Options{AutoRegister: true})
	ctx := context.Background()
	var got [][]domain.Position
	s.SetHooks(Hooks{Positions: func(_ context.Context, ps []domain.Position) { got = append(got, ps) }})
	if ok, err := s.Authorize(ctx, imei1, "teltonika"); !ok || err != nil {
		t.Fatal(ok, err)
	}
	base := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	batch := []domain.Position{pos(base, 25, 10, true), pos(base.Add(time.Minute), 25.1, 20, true)}
	if err := s.Positions(ctx, batch); err != nil {
		t.Fatal(err)
	}
	// Resend of the same packet plus one new record and an in-batch duplicate.
	batch = []domain.Position{pos(base, 25, 10, true), pos(base.Add(time.Minute), 25.1, 20, true),
		pos(base.Add(2*time.Minute), 25.2, 30, true), pos(base.Add(2*time.Minute), 25.2, 30, true)}
	if err := s.Positions(ctx, batch); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM positions`).Scan(&n); err != nil || n != 3 {
		t.Fatalf("stored %d positions (err %v), want 3", n, err)
	}
	if len(got) != 2 || len(got[0]) != 2 || len(got[1]) != 1 || !got[1][0].DeviceTime.Equal(base.Add(2*time.Minute)) {
		t.Fatalf("hook batches %+v", got)
	}

	d, _ := s.Device(got[0][0].DeviceID)
	p, err := s.LatestPosition(ctx, d.ID, []time.Time{base.Add(2 * time.Minute)})
	if err != nil || p == nil || !p.DeviceTime.Equal(base.Add(time.Minute)) {
		t.Fatalf("LatestPosition = %+v, %v", p, err)
	}
}

func TestMigrationDedupesExisting(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	// Apply only 0001, insert duplicates, then migrate the rest.
	ms, err := loadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, ms[0].sql+`;
		CREATE TABLE schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
		INSERT INTO schema_migrations (version) VALUES (1);
		INSERT INTO devices (imei, name, protocol) VALUES ('1', 'x', 'teltonika');
		INSERT INTO positions (device_id, device_time, lat, lng) VALUES
			(1, '2026-01-01T00:00:00Z', 1, 1), (1, '2026-01-01T00:00:00Z', 2, 2), (1, '2026-01-01T00:01:00Z', 3, 3)`); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var n int
	var lat float64
	if err := pool.QueryRow(ctx, `SELECT count(*), min(lat) FILTER (WHERE device_time = '2026-01-01T00:00:00Z') FROM positions`).Scan(&n, &lat); err != nil {
		t.Fatal(err)
	}
	if n != 2 || lat != 1 {
		t.Fatalf("after migration: %d rows, kept lat %v", n, lat)
	}
}

func TestBridgedDeviceAndSettings(t *testing.T) {
	s := newTestStore(t, testPool(t), Options{AutoRegister: true})
	ctx := context.Background()
	d, err := s.EnsureBridgedDevice(ctx, "abc-123", "OsmAnd", "Phone")
	if err != nil {
		t.Fatal(err)
	}
	if d.Source != SourceTraccar || d.Protocol != "osmand" || d.Name != "Phone" || d.Commands {
		t.Fatalf("bridged %+v", d)
	}
	again, err := s.EnsureBridgedDevice(ctx, "abc-123", "osmand", "Other")
	if err != nil || again.ID != d.ID {
		t.Fatalf("second ensure %+v %v", again, err)
	}
	// Bridged devices skip IMEI/protocol rules on update; speedLimit is validated.
	limit := 80.0
	if d, err = s.UpdateDevice(ctx, d.ID, DevicePatch{SpeedLimit: &limit}); err != nil || d.SpeedLimit != 80 {
		t.Fatalf("update %+v %v", d, err)
	}
	limit = -1
	if _, err := s.UpdateDevice(ctx, d.ID, DevicePatch{SpeedLimit: &limit}); !isValidation(err) {
		t.Fatalf("negative speed limit: %v", err)
	}

	off := newTestStore(t, s.pool, Options{AutoRegister: false})
	if _, err := off.EnsureBridgedDevice(ctx, "new-one", "osmand", ""); !errors.Is(err, ErrUnknownDevice) {
		t.Fatalf("auto-register off: %v", err)
	}

	cfg := s.Settings()
	if cfg.SpeedLimit != DefaultSpeedLimit || cfg.OverspeedMinDuration != DefaultOverspeedMinDuration || len(cfg.TraccarToken) != 32 {
		t.Fatalf("defaults %+v", cfg)
	}
	if _, err := s.UpdateSettings(ctx, func(c *Settings) error { c.SpeedLimit = 90; return nil }); err != nil {
		t.Fatal(err)
	}
	if got := newTestStore(t, s.pool, Options{}).Settings(); got.SpeedLimit != 90 || got.TraccarToken != cfg.TraccarToken {
		t.Fatalf("reloaded settings %+v", got)
	}
}

func TestCommandsAndEvents(t *testing.T) {
	rec := &recorder{}
	s := newTestStore(t, testPool(t), Options{Publisher: rec})
	ctx := context.Background()
	d, _ := s.CreateDevice(ctx, DeviceInput{Name: "A", IMEI: imei1})
	u, _ := s.CreateUser(ctx, "u@x", "U", "pw", RoleUser)

	c, err := s.CreateCommand(ctx, d.ID, u.ID, "getVersion", "getver")
	if err != nil || c.Status != CommandQueued {
		t.Fatal(c, err)
	}
	if _, err := s.TransitionCommand(ctx, c.ID, CommandSent, CommandSuccess, "x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("wrong-state transition: %v", err)
	}
	if c, err = s.TransitionCommand(ctx, c.ID, CommandQueued, CommandSent, ""); err != nil || c.CompletedAt != nil {
		t.Fatal(c, err)
	}
	if n, err := s.FailInterruptedCommands(ctx); n != 1 || err != nil {
		t.Fatal(n, err)
	}
	old, _ := s.CreateCommand(ctx, d.ID, u.ID, "reboot", "cpureset")
	exp, err := s.ExpireCommands(ctx, time.Now().Add(time.Hour))
	if err != nil || len(exp) != 1 || exp[0].ID != old.ID || exp[0].CompletedAt == nil {
		t.Fatalf("expired %+v %v", exp, err)
	}
	cs, _ := s.Commands(ctx, d.ID, 10)
	if len(cs) != 2 || cs[0].ID != old.ID || cs[1].Status != CommandFailed {
		t.Fatalf("commands %+v", cs)
	}
	if n := len(rec.take(EventCommand)); n != 4 { // create, sent, create, expired
		t.Fatalf("command events = %d, want 4", n)
	}

	now := time.Now().UTC().Truncate(time.Second)
	evs := []Event{
		{DeviceID: d.ID, Type: EventOverspeed, Time: now.Add(-time.Hour), Message: "a"},
		{DeviceID: d.ID, Type: EventAlarm, Time: now, Attributes: map[string]any{"alarm": "sos"}},
		{DeviceID: 9999, Type: EventAlarm, Time: now}, // unknown device: skipped
	}
	if err := s.InsertEvents(ctx, evs); err != nil {
		t.Fatal(err)
	}
	if evs[0].ID == 0 || evs[1].ID == 0 || evs[2].ID != 0 {
		t.Fatalf("ids %d %d %d", evs[0].ID, evs[1].ID, evs[2].ID)
	}
	if n := len(rec.take(EventEvent)); n != 2 {
		t.Fatalf("published %d events", n)
	}
	got, err := s.Events(ctx, EventFilter{From: now.Add(-2 * time.Hour), To: now, Limit: 10})
	if err != nil || len(got) != 2 || got[0].Type != EventAlarm || got[0].Attributes["alarm"] != "sos" {
		t.Fatalf("events %+v %v", got, err)
	}
	got, _ = s.Events(ctx, EventFilter{DeviceID: d.ID, Types: []string{EventOverspeed}, From: now.Add(-2 * time.Hour), To: now, Limit: 10})
	if len(got) != 1 || got[0].GeofenceID != nil {
		t.Fatalf("filtered %+v", got)
	}
}
