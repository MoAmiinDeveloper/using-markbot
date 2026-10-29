package store

import (
	"context"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
)

// Status duration and today's distance survive a restart and reset at the
// local midnight.
func TestActivityStatusSinceAndTodayKm(t *testing.T) {
	ctx := context.Background()
	pool := openTestPool(t, "store_activity_test")
	loc := time.FixedZone("EAT", 3*3600)
	// 23:50 local on the 27th.
	start := time.Date(2026, 10, 27, 20, 50, 0, 0, time.UTC)
	clk := newClock(start)
	opts := Options{AutoRegister: true, Now: clk.Now, Location: loc}
	s := newTestStore(t, pool, opts)
	if ok, _ := s.Authorize(ctx, imei1, "teltonika"); !ok {
		t.Fatal("authorize failed")
	}
	feed := func(at time.Time, lat, speed float64, ign bool) {
		t.Helper()
		clk.Set(at)
		if err := s.Positions(ctx, []domain.Position{pos(at, lat, speed, ign)}); err != nil {
			t.Fatal(err)
		}
	}
	feed(start, 25.00, 0, false)                    // parked
	feed(start.Add(1*time.Minute), 25.00, 50, true) // drives off
	feed(start.Add(2*time.Minute), 25.01, 60, true) // ~1.1 km
	d := s.Devices()[0]
	if d.Status != StatusMoving || d.StatusSince == nil || !d.StatusSince.Equal(start.Add(time.Minute)) {
		t.Fatalf("moving since %v (%s)", d.StatusSince, d.Status)
	}
	if d.TodayKm < 1 || d.TodayKm > 1.3 {
		t.Fatalf("todayKm before midnight = %v", d.TodayKm)
	}

	// After local midnight the day restarts; the batch's own distance counts.
	mid := time.Date(2026, 10, 27, 21, 5, 0, 0, time.UTC) // 00:05 local on the 28th
	feed(mid, 25.02, 60, true)
	d = s.Devices()[0]
	if d.TodayKm < 1 || d.TodayKm > 1.3 || !d.StatusSince.Equal(start.Add(time.Minute)) {
		t.Fatalf("after midnight: todayKm=%v since=%v", d.TodayKm, d.StatusSince)
	}

	// Restart: values come back from device_state.
	s2 := newTestStore(t, pool, opts)
	d = s2.Devices()[0]
	if d.TodayKm < 1 || d.TodayKm > 1.3 || d.StatusSince == nil || !d.StatusSince.Equal(start.Add(time.Minute)) {
		t.Fatalf("after restart: todayKm=%v since=%v", d.TodayKm, d.StatusSince)
	}

	// Stopping starts a new period; a day without data shows 0 km.
	feed(mid.Add(time.Minute), 25.02, 0, false)
	d = s.Devices()[0]
	if d.Status != StatusStopped || !d.StatusSince.Equal(mid.Add(time.Minute)) {
		t.Fatalf("stopped since %v (%s)", d.StatusSince, d.Status)
	}
	clk.Set(mid.Add(25 * time.Hour))
	if d := s.Devices()[0]; d.TodayKm != 0 || d.Status != StatusOffline || d.StatusSince == nil {
		t.Fatalf("next day: %+v", d)
	}
}
