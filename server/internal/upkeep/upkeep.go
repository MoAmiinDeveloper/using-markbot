// Package upkeep runs the maintenance / document-reminder due check: every
// interval (10 min), at startup and whenever the store signals that inputs
// changed, it raises one maintenanceDue / documentExpiry event per status
// transition (ok → dueSoon, → overdue).
package upkeep

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// DefaultInterval is how often the due check runs.
const DefaultInterval = 10 * time.Minute

// Emitter persists, publishes and notifies events (*events.Engine).
type Emitter interface {
	Emit(ctx context.Context, deviceName string, evs ...store.Event)
}

// Job is the background due checker.
type Job struct {
	st       *store.Store
	emit     Emitter
	log      *slog.Logger
	Interval time.Duration
	now      func() time.Time
}

// New returns a job; log may be nil.
func New(st *store.Store, emit Emitter, log *slog.Logger) *Job {
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	return &Job{st: st, emit: emit, log: log, Interval: DefaultInterval, now: time.Now}
}

// Run checks immediately, then on every tick or store kick until ctx ends.
func (j *Job) Run(ctx context.Context) {
	t := time.NewTicker(j.Interval)
	defer t.Stop()
	for {
		if err := j.Check(ctx); err != nil && ctx.Err() == nil {
			j.log.Error("upkeep: due check", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		case <-j.st.UpkeepKicks():
		}
	}
}

// Check runs one due check and emits the resulting events.
func (j *Job) Check(ctx context.Context) error {
	items, err := j.st.UpkeepTransitions(ctx)
	for _, it := range items {
		ev, name, ok := j.event(it)
		if ok {
			j.emit.Emit(ctx, name, ev)
		}
	}
	return err
}

func statusText(s string) string {
	if s == store.DueOverdue {
		return "overdue"
	}
	return "due soon"
}

// event builds the event of a transition; ok is false when the item is not
// attached to any device (e.g. a reminder of an unassigned driver).
func (j *Job) event(it store.UpkeepItem) (store.Event, string, bool) {
	if it.DeviceID == 0 {
		return store.Event{}, "", false
	}
	dev, err := j.st.Device(it.DeviceID)
	if err != nil {
		return store.Event{}, "", false
	}
	ev := store.Event{DeviceID: dev.ID, Time: j.now().UTC()}
	if p := dev.Position; p != nil {
		ev.Lat, ev.Lng = p.Latitude, p.Longitude
	}
	if m := it.Maintenance; m != nil {
		ev.Type = store.EventMaintenanceDue
		attrs := map[string]any{"itemId": m.ID, "name": m.Name, "status": m.Status}
		detail := ""
		if m.RemainingKm != nil {
			attrs["nextDueKm"], attrs["remainingKm"] = *m.NextDueKm, *m.RemainingKm
			detail = fmt.Sprintf(" (%s km left)", num(*m.RemainingKm))
		}
		if m.RemainingDays != nil {
			attrs["nextDueDate"], attrs["remainingDays"] = *m.NextDueDate, *m.RemainingDays
			if detail == "" {
				detail = fmt.Sprintf(" (due %s)", *m.NextDueDate)
			}
		}
		if m.RemainingHours != nil {
			attrs["nextDueHours"], attrs["remainingHours"] = *m.NextDueHours, *m.RemainingHours
			if detail == "" {
				detail = fmt.Sprintf(" (%s engine hours left)", num(*m.RemainingHours))
			}
		}
		if m.Status == store.DueOverdue {
			detail = ""
		}
		ev.Attributes = attrs
		ev.Message = fmt.Sprintf("%s: %s is %s%s", dev.Name, m.Name, statusText(m.Status), detail)
		return ev, dev.Name, true
	}
	r := it.Reminder
	ev.Type = store.EventDocumentExpiry
	attrs := map[string]any{"itemId": r.ID, "name": r.Title, "kind": r.Kind, "status": r.Status,
		"dueDate": r.DueDate, "remainingDays": r.RemainingDays}
	if r.DriverID != nil {
		attrs["driverId"] = *r.DriverID
	}
	ev.Attributes = attrs
	verb := "expires " + r.DueDate
	if r.Status == store.DueOverdue {
		verb = "expired " + r.DueDate
	}
	ev.Message = fmt.Sprintf("%s: %s %s", dev.Name, r.Title, verb)
	return ev, dev.Name, true
}

// num formats a remaining amount: one decimal below 10, whole numbers above.
func num(v float64) string {
	if v < 10 {
		return strconv.FormatFloat(v, 'f', 1, 64)
	}
	return strconv.FormatFloat(v, 'f', 0, 64)
}
