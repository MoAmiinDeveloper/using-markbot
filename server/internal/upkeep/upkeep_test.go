package upkeep

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/store"
	"github.com/moamiindeveloper/fleet/server/internal/store/storetest"
)

type emitter struct {
	mu  sync.Mutex
	evs []store.Event
}

func (e *emitter) Emit(_ context.Context, _ string, evs ...store.Event) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.evs = append(e.evs, evs...)
}

func (e *emitter) take() []store.Event {
	e.mu.Lock()
	defer e.mu.Unlock()
	out := e.evs
	e.evs = nil
	return out
}

func ref[T any](v T) *T { return &v }

func TestKmMaintenanceAndReminderEvents(t *testing.T) {
	st := storetest.New(t, "upkeep_test", store.Options{AutoRegister: true})
	ctx := context.Background()
	const imei = "356307042441013"
	if ok, err := st.Authorize(ctx, imei, "teltonika"); !ok || err != nil {
		t.Fatal(ok, err)
	}
	dev := st.Devices()[0]
	em := &emitter{}
	j := New(st, em, nil)

	// Service due after 2 km, warn 1 km before.
	m, err := st.CreateMaintenance(ctx, store.MaintenanceInput{DeviceID: &dev.ID, Name: ref("Oil change"),
		IntervalKm: ref(2.0), NotifyBeforeKm: ref(1.0)})
	if err != nil || m.Status != store.DueOK || m.LastServiceKm != 0 {
		t.Fatalf("maintenance %+v %v", m, err)
	}
	if _, err := st.CreateReminder(ctx, store.ReminderInput{DeviceID: store.OptID{Set: true, ID: &dev.ID},
		Kind: ref("registration"), Title: ref("Registration"), DueDate: ref(time.Now().UTC().AddDate(0, 0, -1).Format(time.DateOnly))}); err != nil {
		t.Fatal(err)
	}
	drv, _ := st.CreateDriver(ctx, store.DriverInput{Name: "Nobody"})
	if _, err := st.CreateReminder(ctx, store.ReminderInput{DriverID: store.OptID{Set: true, ID: &drv.ID},
		Title: ref("License"), DueDate: ref("2020-01-01")}); err != nil {
		t.Fatal(err)
	}
	if err := j.Check(ctx); err != nil {
		t.Fatal(err)
	}
	evs := em.take()
	if len(evs) != 1 || evs[0].Type != store.EventDocumentExpiry || evs[0].Attributes["status"] != store.DueOverdue ||
		evs[0].DeviceID != dev.ID {
		t.Fatalf("reminder events %+v", evs)
	}

	drive := func(from, to float64, start time.Time) {
		t.Helper()
		var ps []domain.Position
		for i, lat := 0, from; lat <= to+1e-9; i, lat = i+1, lat+0.001 {
			ps = append(ps, domain.Position{IMEI: imei, DeviceTime: start.Add(time.Duration(i) * 10 * time.Second),
				Latitude: lat, Longitude: 55.27, Speed: 50, Valid: true, Attributes: map[string]any{"ignition": true}})
		}
		if err := st.Positions(ctx, ps); err != nil {
			t.Fatal(err)
		}
	}
	start := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	drive(25, 25.012, start) // ≈ 1.33 km → dueSoon
	_ = j.Check(ctx)
	_ = j.Check(ctx)
	evs = em.take()
	if len(evs) != 1 || evs[0].Type != store.EventMaintenanceDue || evs[0].Attributes["status"] != store.DueSoon ||
		evs[0].Attributes["itemId"] != m.ID {
		t.Fatalf("dueSoon events %+v", evs)
	}
	drive(25.013, 25.02, start.Add(10*time.Minute)) // ≈ 2.2 km → overdue
	_ = j.Check(ctx)
	_ = j.Check(ctx)
	evs = em.take()
	if len(evs) != 1 || evs[0].Attributes["status"] != store.DueOverdue || evs[0].Message != dev.Name+": Oil change is overdue" {
		t.Fatalf("overdue events %+v", evs)
	}

	// Run picks up store kicks (here: completing the service re-arms, nothing fires).
	runCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() { j.Run(runCtx); close(done) }()
	if _, _, err := st.CompleteMaintenance(ctx, m.ID, store.CompleteInput{}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(100 * time.Millisecond)
	cancel()
	<-done
	if evs := em.take(); len(evs) != 0 {
		t.Fatalf("events after completion %+v", evs)
	}
}
