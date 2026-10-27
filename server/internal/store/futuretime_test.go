package store

import (
	"context"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
)

// A record stamped in the future (unsynced tracker clock) must not become the
// permanent latest position: later real fixes still update status.
func TestFutureDeviceTimeDoesNotFreezeLatest(t *testing.T) {
	ctx := context.Background()
	pool := openTestPool(t, "store_future_test")
	now := time.Date(2026, 10, 27, 18, 0, 0, 0, time.UTC)
	clk := newClock(now)
	s := newTestStore(t, pool, Options{AutoRegister: true, Now: clk.Now, OfflineAfter: 10 * time.Minute})
	if ok, _ := s.Authorize(ctx, imei1, "teltonika"); !ok {
		t.Fatal("authorize failed")
	}

	// Parked with ignition on, but stamped a year ahead.
	future := pos(now.AddDate(1, 0, 0), 25.0, 0, true)
	if err := s.Positions(ctx, []domain.Position{future}); err != nil {
		t.Fatal(err)
	}
	d := s.Devices()[0]
	if !d.Position.DeviceTime.Equal(now) {
		t.Fatalf("future time not replaced: %v", d.Position.DeviceTime)
	}
	if d.Position.Attributes[AttrOriginalTime] == nil {
		t.Fatal("original device time not kept")
	}
	if d.Status != StatusIdle {
		t.Fatalf("status = %s, want idle", d.Status)
	}

	// A minute later the vehicle drives off: status must follow.
	clk.Set(now.Add(time.Minute))
	if err := s.Positions(ctx, []domain.Position{pos(now.Add(time.Minute), 25.01, 60, true)}); err != nil {
		t.Fatal(err)
	}
	if d := s.Devices()[0]; d.Status != StatusMoving || d.Position.Speed != 60 {
		t.Fatalf("after real fix: status=%s speed=%v, want moving 60", d.Status, d.Position.Speed)
	}
}
