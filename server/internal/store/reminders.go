package store

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// ReminderKinds lists the reminder kinds.
var ReminderKinds = []string{"insurance", "registration", "license", "permit", "inspection", "other"}

// Reminder is a dated document/renewal reminder for a vehicle and/or driver.
type Reminder struct {
	ID               int64     `json:"id"`
	DeviceID         *int64    `json:"deviceId"`
	DriverID         *int64    `json:"driverId"`
	Kind             string    `json:"kind"`
	Title            string    `json:"title"`
	DueDate          string    `json:"dueDate"`
	NotifyDaysBefore int       `json:"notifyDaysBefore"`
	Status           string    `json:"status"`
	RemainingDays    int       `json:"remainingDays"`
	Notes            string    `json:"notes"`
	CreatedAt        time.Time `json:"createdAt"`

	notified       string
	driverDeviceID *int64 // vehicle assigned to DriverID, for scoping and events
}

// ComputeStatus sets Status/RemainingDays: overdue once the due date has
// passed, dueSoon within notifyDaysBefore days (incl. the due day).
func (r *Reminder) ComputeStatus(today time.Time) {
	due, err := time.Parse(time.DateOnly, r.DueDate)
	if err != nil {
		r.Status = DueOK
		return
	}
	r.RemainingDays = daysBetween(today, due)
	r.Status = statusFor(r.RemainingDays < 0, r.RemainingDays <= r.NotifyDaysBefore)
}

// EventDeviceID is the device a reminder's events are attached to: its own
// device, else the vehicle assigned to its driver (0 = none).
func (r *Reminder) EventDeviceID() int64 {
	switch {
	case r.DeviceID != nil:
		return *r.DeviceID
	case r.driverDeviceID != nil:
		return *r.driverDeviceID
	}
	return 0
}

// VisibleIn reports whether a reminder is visible in a device scope:
// device reminders follow their device, driver-only reminders the driver's
// vehicle (unassigned drivers are visible to everyone), and reminders with
// neither are visible to everyone.
func (r *Reminder) VisibleIn(all bool, ids map[int64]bool) bool {
	if all {
		return true
	}
	if r.DeviceID != nil {
		return ids[*r.DeviceID]
	}
	if r.driverDeviceID != nil {
		return ids[*r.driverDeviceID]
	}
	return true
}

// ReminderInput is the body of POST /reminders and PATCH /reminders/{id};
// absent fields are unchanged (PATCH) or defaulted (POST).
type ReminderInput struct {
	DeviceID         OptID   `json:"deviceId"`
	DriverID         OptID   `json:"driverId"`
	Kind             *string `json:"kind"`
	Title            *string `json:"title"`
	DueDate          *string `json:"dueDate"`
	NotifyDaysBefore *int    `json:"notifyDaysBefore"`
	Notes            *string `json:"notes"`
}

func (in *ReminderInput) apply(r *Reminder) {
	if in.DeviceID.Set {
		r.DeviceID = in.DeviceID.ID
	}
	if in.DriverID.Set {
		r.DriverID = in.DriverID.ID
	}
	for _, f := range []struct {
		dst *string
		src *string
	}{{&r.Kind, in.Kind}, {&r.Title, in.Title}, {&r.DueDate, in.DueDate}, {&r.Notes, in.Notes}} {
		if f.src != nil {
			*f.dst = *f.src
		}
	}
	if in.NotifyDaysBefore != nil {
		r.NotifyDaysBefore = *in.NotifyDaysBefore
	}
}

func (r *Reminder) validate() error {
	r.Kind = strings.TrimSpace(r.Kind)
	r.Title = strings.TrimSpace(r.Title)
	r.Notes = strings.TrimSpace(r.Notes)
	if r.Kind == "" {
		r.Kind = "other"
	}
	switch {
	case !slices.Contains(ReminderKinds, r.Kind):
		return invalid("kind must be one of: %s", strings.Join(ReminderKinds, ", "))
	case r.Title == "":
		return invalid("title is required")
	case utf8.RuneCountInString(r.Title) > 200:
		return invalid("title must be at most 200 characters")
	case r.NotifyDaysBefore < 0 || r.NotifyDaysBefore > 3650:
		return invalid("notifyDaysBefore must be between 0 and 3650")
	case utf8.RuneCountInString(r.Notes) > 2000:
		return invalid("notes must be at most 2000 characters")
	}
	t, err := ParseDate("dueDate", r.DueDate)
	if err != nil {
		return err
	}
	r.DueDate = t.Format(time.DateOnly)
	return nil
}

const reminderColumns = `r.id, r.device_id, r.driver_id, r.kind, r.title, to_char(r.due_date, 'YYYY-MM-DD'),
	r.notify_days_before, r.notes, r.notified_status, r.created_at, dr.device_id`

const reminderFrom = ` FROM reminders r LEFT JOIN drivers dr ON dr.id = r.driver_id`

func (s *Store) scanReminder(row pgx.Row) (Reminder, error) {
	var r Reminder
	err := row.Scan(&r.ID, &r.DeviceID, &r.DriverID, &r.Kind, &r.Title, &r.DueDate, &r.NotifyDaysBefore, &r.Notes,
		&r.notified, &r.CreatedAt, &r.driverDeviceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, ErrNotFound
	}
	r.CreatedAt = r.CreatedAt.UTC()
	r.ComputeStatus(s.opts.Now())
	return r, err
}

// ReminderFilter selects reminders; zero fields are ignored.
type ReminderFilter struct {
	DeviceID int64
	DriverID int64
}

// Reminders returns reminders ordered by due date. Scoping is applied by
// the caller with VisibleIn.
func (s *Store) Reminders(ctx context.Context, f ReminderFilter) ([]Reminder, error) {
	where, args := []string{"true"}, []any{}
	if f.DeviceID != 0 {
		args = append(args, f.DeviceID)
		where = append(where, fmt.Sprintf("r.device_id = $%d", len(args)))
	}
	if f.DriverID != 0 {
		args = append(args, f.DriverID)
		where = append(where, fmt.Sprintf("r.driver_id = $%d", len(args)))
	}
	rows, err := s.pool.Query(ctx, `SELECT `+reminderColumns+reminderFrom+` WHERE `+strings.Join(where, " AND ")+
		` ORDER BY r.due_date, r.id`, args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Reminder, error) { return s.scanReminder(r) })
	if out == nil {
		out = []Reminder{}
	}
	return out, err
}

// Reminder returns one reminder or ErrNotFound.
func (s *Store) Reminder(ctx context.Context, id int64) (Reminder, error) {
	return s.scanReminder(s.pool.QueryRow(ctx, `SELECT `+reminderColumns+reminderFrom+` WHERE r.id = $1`, id))
}

func reminderWriteErr(err error) error {
	if isForeignKeyViolation(err) {
		return invalid("unknown deviceId or driverId")
	}
	return err
}

// CreateReminder inserts a reminder (notifyDaysBefore defaults to 14).
func (s *Store) CreateReminder(ctx context.Context, in ReminderInput) (Reminder, error) {
	r := Reminder{NotifyDaysBefore: 14}
	in.apply(&r)
	if err := r.validate(); err != nil {
		return Reminder{}, err
	}
	var id int64
	err := s.pool.QueryRow(ctx, `INSERT INTO reminders (device_id, driver_id, kind, title, due_date, notify_days_before, notes)
		VALUES ($1, $2, $3, $4, $5::date, $6, $7) RETURNING id`,
		r.DeviceID, r.DriverID, r.Kind, r.Title, r.DueDate, r.NotifyDaysBefore, r.Notes).Scan(&id)
	if err != nil {
		return Reminder{}, reminderWriteErr(err)
	}
	s.KickUpkeep()
	return s.Reminder(ctx, id)
}

// UpdateReminder applies a partial update.
func (s *Store) UpdateReminder(ctx context.Context, id int64, in ReminderInput) (Reminder, error) {
	r, err := s.Reminder(ctx, id)
	if err != nil {
		return r, err
	}
	in.apply(&r)
	if err := r.validate(); err != nil {
		return Reminder{}, err
	}
	tag, err := s.pool.Exec(ctx, `UPDATE reminders SET device_id = $2, driver_id = $3, kind = $4, title = $5,
			due_date = $6::date, notify_days_before = $7, notes = $8 WHERE id = $1`,
		id, r.DeviceID, r.DriverID, r.Kind, r.Title, r.DueDate, r.NotifyDaysBefore, r.Notes)
	if err != nil {
		return Reminder{}, reminderWriteErr(err)
	}
	if tag.RowsAffected() == 0 {
		return Reminder{}, ErrNotFound
	}
	s.KickUpkeep()
	return s.Reminder(ctx, id)
}

// DeleteReminder removes a reminder.
func (s *Store) DeleteReminder(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM reminders WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// UpkeepItem is a maintenance item or reminder whose status moved up
// (ok → dueSoon → overdue) since the last check; an event must be raised.
type UpkeepItem struct {
	Maintenance *Maintenance
	Reminder    *Reminder
	DeviceID    int64 // device the event is attached to
}

// UpkeepTransitions computes the current status of every maintenance item
// and reminder and records it. Items whose status got worse are returned,
// exactly once per transition (the record is a compare-and-set, so
// concurrent checks cannot both report it). Improvements (after a service,
// an edit or a renewal) re-arm silently.
func (s *Store) UpkeepTransitions(ctx context.Context) ([]UpkeepItem, error) {
	var out []UpkeepItem
	ms, err := s.MaintenanceList(ctx, Scope{All: true}, 0)
	if err != nil {
		return nil, err
	}
	for i := range ms {
		m := &ms[i]
		if m.Status == m.notified {
			continue
		}
		won, err := s.casNotified(ctx, "maintenance", m.ID, m.notified, m.Status)
		if err != nil {
			return out, err
		}
		if won && dueRank(m.Status) > dueRank(m.notified) {
			out = append(out, UpkeepItem{Maintenance: m, DeviceID: m.DeviceID})
		}
	}
	rs, err := s.Reminders(ctx, ReminderFilter{})
	if err != nil {
		return out, err
	}
	for i := range rs {
		r := &rs[i]
		if r.Status == r.notified {
			continue
		}
		won, err := s.casNotified(ctx, "reminders", r.ID, r.notified, r.Status)
		if err != nil {
			return out, err
		}
		if won && dueRank(r.Status) > dueRank(r.notified) {
			out = append(out, UpkeepItem{Reminder: r, DeviceID: r.EventDeviceID()})
		}
	}
	return out, nil
}

func (s *Store) casNotified(ctx context.Context, table string, id int64, from, to string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE `+table+` SET notified_status = $3 WHERE id = $1 AND notified_status = $2`, id, from, to)
	return tag.RowsAffected() == 1, err
}

// UpkeepCounts returns how many maintenance items and reminders in a scope
// are dueSoon / overdue (e.g. for the dashboard).
type UpkeepCounts struct {
	Maintenance DueCounts `json:"maintenance"`
	Reminders   DueCounts `json:"reminders"`
}

// DueCounts counts items per non-ok status.
type DueCounts struct {
	DueSoon int `json:"dueSoon"`
	Overdue int `json:"overdue"`
}

func (c *DueCounts) add(status string) {
	switch status {
	case DueSoon:
		c.DueSoon++
	case DueOverdue:
		c.Overdue++
	}
}

// UpkeepSummary counts due items visible in a device scope.
func (s *Store) UpkeepSummary(ctx context.Context, all bool, ids map[int64]bool) (UpkeepCounts, error) {
	var c UpkeepCounts
	ms, err := s.MaintenanceList(ctx, Scope{All: true}, 0)
	if err != nil {
		return c, err
	}
	for _, m := range ms {
		if all || ids[m.DeviceID] {
			c.Maintenance.add(m.Status)
		}
	}
	rs, err := s.Reminders(ctx, ReminderFilter{})
	if err != nil {
		return c, err
	}
	for _, r := range rs {
		if r.VisibleIn(all, ids) {
			c.Reminders.add(r.Status)
		}
	}
	return c, nil
}
