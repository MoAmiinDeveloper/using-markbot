package store

import (
	"context"
	"errors"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
)

type event struct {
	typ  string
	data any
}

type recorder struct {
	mu     sync.Mutex
	events []event
}

func (r *recorder) Publish(typ string, data any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, event{typ, data})
}

func (r *recorder) take(typ string) []any {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []any
	rest := r.events[:0]
	for _, e := range r.events {
		if e.typ == typ {
			out = append(out, e.data)
		} else {
			rest = append(rest, e)
		}
	}
	r.events = rest
	return out
}

// clock is a settable time source.
type clock struct{ ns atomic.Int64 }

func (c *clock) Now() time.Time           { return time.Unix(0, c.ns.Load()).UTC() }
func (c *clock) Set(t time.Time)          { c.ns.Store(t.UnixNano()) }
func (c *clock) Add(d time.Duration)      { c.ns.Add(int64(d)) }
func newClock(t time.Time) *clock         { c := &clock{}; c.Set(t); return c }
func testPool(t *testing.T) *pgxpool.Pool { return openTestPool(t, "store_test") }

// openTestPool connects to TEST_DATABASE_URL using a freshly created schema
// so that test packages can share one database. It skips the test when the
// variable is unset.
func openTestPool(t testing.TB, schema string) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	if _, err := admin.Exec(ctx, `DROP SCHEMA IF EXISTS `+schema+` CASCADE; CREATE SCHEMA `+schema); err != nil {
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func newTestStore(t *testing.T, pool *pgxpool.Pool, opts Options) *Store {
	t.Helper()
	s, err := New(context.Background(), pool, opts)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

const imei1 = "356307042441013"

func TestDeviceCRUD(t *testing.T) {
	ctx := context.Background()
	rec := &recorder{}
	s := newTestStore(t, testPool(t), Options{Publisher: rec})

	if _, err := s.CreateDevice(ctx, DeviceInput{Name: "x", IMEI: "123"}); !isValidation(err) {
		t.Fatalf("short IMEI: err = %v, want validation error", err)
	}
	if _, err := s.CreateDevice(ctx, DeviceInput{Name: "x", IMEI: imei1, Category: "boat"}); !isValidation(err) {
		t.Fatalf("bad category: err = %v, want validation error", err)
	}

	b, err := s.CreateDevice(ctx, DeviceInput{Name: "  Truck B ", IMEI: imei1, Plate: "B-1"})
	if err != nil {
		t.Fatal(err)
	}
	if b.Name != "Truck B" || b.Protocol != "teltonika" || b.Category != "car" || b.Status != StatusNever || b.LastSeen != nil {
		t.Fatalf("unexpected device %+v", b)
	}
	if _, err := s.CreateDevice(ctx, DeviceInput{Name: "dup", IMEI: imei1}); !errors.Is(err, ErrDuplicateIMEI) {
		t.Fatalf("duplicate: err = %v", err)
	}
	a, err := s.CreateDevice(ctx, DeviceInput{Name: "car a", IMEI: "356307042441014", Category: "Van"})
	if err != nil {
		t.Fatal(err)
	}
	if got := rec.take(EventDevice); len(got) != 2 {
		t.Fatalf("published %d device events, want 2", len(got))
	}

	list := s.Devices()
	if len(list) != 2 || list[0].ID != a.ID || list[1].ID != b.ID {
		t.Fatalf("Devices not ordered by name: %+v", list)
	}

	model, imei2 := "FMB920", "356307042441015"
	upd, err := s.UpdateDevice(ctx, b.ID, DevicePatch{Model: &model, IMEI: &imei2})
	if err != nil {
		t.Fatal(err)
	}
	if upd.Model != model || upd.Plate != "B-1" || upd.IMEI != imei2 || !upd.UpdatedAt.After(b.UpdatedAt.Add(-time.Second)) {
		t.Fatalf("unexpected update result %+v", upd)
	}
	if ok, _ := s.Authorize(ctx, imei2, "teltonika"); !ok {
		t.Fatal("IMEI cache not updated after IMEI change")
	}
	dupIMEI := "356307042441014"
	if _, err := s.UpdateDevice(ctx, b.ID, DevicePatch{IMEI: &dupIMEI}); !errors.Is(err, ErrDuplicateIMEI) {
		t.Fatalf("update to duplicate IMEI: err = %v", err)
	}
	if _, err := s.UpdateDevice(ctx, 999999, DevicePatch{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("update missing: err = %v", err)
	}

	if err := s.DeleteDevice(ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteDevice(ctx, b.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete: err = %v", err)
	}
	if _, err := s.Device(b.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("deleted device still cached")
	}
	if got := rec.take(EventDeleted); len(got) != 1 {
		t.Fatalf("deleted events = %v", got)
	}
}

func isValidation(err error) bool {
	var ve *ValidationError
	return errors.As(err, &ve)
}

func TestAuthorize(t *testing.T) {
	ctx := context.Background()
	pool := testPool(t)

	strict := newTestStore(t, pool, Options{AutoRegister: false})
	if ok, err := strict.Authorize(ctx, imei1, "teltonika"); ok || err != nil {
		t.Fatalf("strict: ok=%v err=%v", ok, err)
	}

	rec := &recorder{}
	s := newTestStore(t, pool, Options{AutoRegister: true, Publisher: rec})
	if ok, _ := s.Authorize(ctx, "12345", "teltonika"); ok {
		t.Fatal("invalid IMEI must be rejected")
	}
	for i := 0; i < 2; i++ {
		if ok, err := s.Authorize(ctx, imei1, "teltonika"); !ok || err != nil {
			t.Fatalf("auto-register: ok=%v err=%v", ok, err)
		}
	}
	list := s.Devices()
	if len(list) != 1 || list[0].Name != "Device 441013" || list[0].IMEI != imei1 {
		t.Fatalf("auto-registered devices = %+v", list)
	}
	if n := len(rec.take(EventDevice)); n != 1 {
		t.Fatalf("published %d device events, want 1", n)
	}
	// A second store instance racing on the same IMEI gets the existing row.
	other := newTestStore(t, pool, Options{AutoRegister: true})
	if ok, err := other.Authorize(ctx, imei1, "teltonika"); !ok || err != nil {
		t.Fatalf("existing: ok=%v err=%v", ok, err)
	}
}

func pos(at time.Time, lat, speed float64, ign bool) domain.Position {
	return domain.Position{
		IMEI: imei1, Protocol: "teltonika", DeviceTime: at,
		Latitude: lat, Longitude: 55.27, Speed: speed, Valid: true, Satellites: 9,
		Attributes: map[string]any{domain.AttrIgnition: ign, domain.AttrPower: 13.8},
	}
}

func TestPositionsIngest(t *testing.T) {
	ctx := context.Background()
	pool := testPool(t)
	now := time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC)
	clk := newClock(now)
	rec := &recorder{}
	s := newTestStore(t, pool, Options{AutoRegister: true, Publisher: rec, Now: clk.Now, OfflineAfter: 10 * time.Minute})

	if err := s.Positions(ctx, []domain.Position{pos(now, 25, 50, true)}); !errors.Is(err, ErrUnknownDevice) {
		t.Fatalf("unknown device: err = %v", err)
	}
	if ok, _ := s.Authorize(ctx, imei1, "teltonika"); !ok {
		t.Fatal("authorize failed")
	}
	rec.take(EventDevice)

	// Out-of-order batch: the store sorts and publishes chronologically.
	batch := []domain.Position{
		pos(now.Add(-1*time.Minute), 25.002, 60, true),
		pos(now.Add(-3*time.Minute), 25.000, 40, true),
		pos(now.Add(-2*time.Minute), 25.001, 50, true),
	}
	if err := s.Positions(ctx, batch); err != nil {
		t.Fatal(err)
	}
	if batch[0].DeviceID == 0 {
		t.Fatal("DeviceID not filled in")
	}
	published := rec.take(EventPosition)
	if len(published) != 3 {
		t.Fatalf("published %d positions, want 3", len(published))
	}
	for i := 1; i < 3; i++ {
		if !published[i].(*domain.Position).DeviceTime.After(published[i-1].(*domain.Position).DeviceTime) {
			t.Fatal("positions not published chronologically")
		}
	}
	devs := rec.take(EventDevice)
	if len(devs) != 1 || devs[0].(Device).Status != StatusMoving {
		t.Fatalf("device events = %+v, want one moving", devs)
	}
	d := s.Devices()[0]
	if d.Status != StatusMoving || d.Position.Latitude != 25.002 || d.LastSeen == nil || !d.LastSeen.Equal(now) {
		t.Fatalf("unexpected device state %+v", d)
	}

	// Replayed old record: stored but neither published nor made latest.
	clk.Add(time.Minute)
	if err := s.Positions(ctx, []domain.Position{pos(now.Add(-time.Hour), 24, 0, false)}); err != nil {
		t.Fatal(err)
	}
	if n := len(rec.take(EventPosition)); n != 0 {
		t.Fatalf("old record published %d times", n)
	}
	if d := s.Devices()[0]; d.Position.Latitude != 25.002 || !d.LastSeen.Equal(now.Add(time.Minute)) {
		t.Fatalf("latest changed by old record: %+v", d.Position)
	}

	// Idle (ignition on, not moving), then stopped.
	if err := s.Positions(ctx, []domain.Position{pos(now.Add(time.Minute), 25.003, 0, true)}); err != nil {
		t.Fatal(err)
	}
	if st := s.Devices()[0].Status; st != StatusIdle {
		t.Fatalf("status = %s, want idle", st)
	}
	if err := s.Positions(ctx, []domain.Position{pos(now.Add(2*time.Minute), 25.003, 0, false)}); err != nil {
		t.Fatal(err)
	}
	if st := s.Devices()[0].Status; st != StatusStopped {
		t.Fatalf("status = %s, want stopped", st)
	}
	rec.take(EventDevice)
	rec.take(EventPosition)

	// Going offline is announced by the periodic check.
	clk.Add(11 * time.Minute)
	s.announceStatusChanges()
	devs = rec.take(EventDevice)
	if len(devs) != 1 || devs[0].(Device).Status != StatusOffline {
		t.Fatalf("offline events = %+v", devs)
	}
	if sum := s.Summary(); sum.Total != 1 || sum.Offline != 1 {
		t.Fatalf("summary = %+v", sum)
	}

	// Connection brings it back online.
	s.Connection(ctx, imei1, true, "127.0.0.1:1234")
	if st := s.Devices()[0].Status; st != StatusStopped {
		t.Fatalf("status after connect = %s, want stopped", st)
	}

	// History is complete and ascending.
	id := s.Devices()[0].ID
	hist, err := s.PositionsRange(ctx, id, now.Add(-2*time.Hour), now.Add(time.Hour), 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(hist) != 6 {
		t.Fatalf("history has %d positions, want 6", len(hist))
	}
	for i := 1; i < len(hist); i++ {
		if hist[i].DeviceTime.Before(hist[i-1].DeviceTime) {
			t.Fatal("history not ascending")
		}
	}
	if hist[0].IMEI != imei1 || hist[0].Attributes[domain.AttrPower] != 13.8 || hist[0].DeviceTime.Location() != time.UTC {
		t.Fatalf("unexpected history row %+v", hist[0])
	}
	if lim, _ := s.PositionsRange(ctx, id, now.Add(-2*time.Hour), now.Add(time.Hour), 2); len(lim) != 2 {
		t.Fatalf("limit ignored: %d", len(lim))
	}

	// A fresh store restores the cache from device_state.
	s2 := newTestStore(t, pool, Options{Now: clk.Now})
	d2 := s2.Devices()[0]
	if d2.Position == nil || !d2.Position.DeviceTime.Equal(now.Add(2*time.Minute)) || d2.LastSeen == nil || !d2.LastSeen.Equal(clk.Now()) {
		t.Fatalf("restored state = %+v", d2)
	}

	// Deleting cascades to positions.
	if err := s.DeleteDevice(ctx, id); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM positions`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("positions left after delete: %d (%v)", n, err)
	}
}

func TestTripsFromDB(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t, testPool(t), Options{AutoRegister: true})
	if ok, _ := s.Authorize(ctx, imei1, "teltonika"); !ok {
		t.Fatal("authorize failed")
	}
	start := time.Date(2026, 10, 22, 6, 0, 0, 0, time.UTC)
	var batch []domain.Position
	lat := 25.0
	for i := 0; i < 40; i++ { // 10 min driving at 60 km/h, then 10 min parked
		speed := 60.0
		if i >= 20 {
			speed = 0
		}
		batch = append(batch, pos(start.Add(time.Duration(i)*30*time.Second), lat, speed, speed > 0))
		lat += speed / 3.6 * 30 / 111195
	}
	if err := s.Positions(ctx, batch); err != nil {
		t.Fatal(err)
	}
	trips, err := s.Trips(ctx, s.Devices()[0].ID, start.Add(-time.Hour), start.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(trips) != 1 || trips[0].Duration != 600 || trips[0].Distance < 9900 || trips[0].Distance > 10100 {
		t.Fatalf("trips = %+v", trips)
	}
	if _, err := s.Trips(ctx, 424242, start, start); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing device: err = %v", err)
	}
}

func TestUsers(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t, testPool(t), Options{})

	created, err := s.EnsureAdmin(ctx, "Admin@Fleet.local", "secret")
	if err != nil || !created {
		t.Fatalf("EnsureAdmin: %v %v", created, err)
	}
	if created, _ := s.EnsureAdmin(ctx, "other@fleet.local", "x"); created {
		t.Fatal("EnsureAdmin must not create a second admin")
	}
	u, err := s.Authenticate(ctx, " admin@fleet.LOCAL", "secret")
	if err != nil || u.Role != RoleAdmin || u.Email != "admin@fleet.local" {
		t.Fatalf("Authenticate: %+v %v", u, err)
	}
	if _, err := s.Authenticate(ctx, "admin@fleet.local", "wrong"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("wrong password: %v", err)
	}
	if _, err := s.Authenticate(ctx, "nobody@fleet.local", "secret"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("unknown user: %v", err)
	}
	if got, err := s.UserByID(ctx, u.ID); err != nil || got.Email != u.Email {
		t.Fatalf("UserByID: %+v %v", got, err)
	}
	if _, err := s.UserByID(ctx, 999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("UserByID missing: %v", err)
	}
}

func TestMigrateIdempotent(t *testing.T) {
	pool := testPool(t)
	for i := 0; i < 2; i++ {
		if err := Migrate(context.Background(), pool); err != nil {
			t.Fatal(err)
		}
	}
}
