package store

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Maintenance / reminder statuses.
const (
	DueOK      = "ok"
	DueSoon    = "dueSoon"
	DueOverdue = "overdue"
)

func dueRank(s string) int {
	switch s {
	case DueSoon:
		return 1
	case DueOverdue:
		return 2
	}
	return 0
}

func worse(a, b string) string {
	if dueRank(b) > dueRank(a) {
		return b
	}
	return a
}

// Maintenance is a recurring service schedule of a device. The status and
// next/remaining fields are computed from the device's current odometer,
// engine hours and today's (UTC) date.
type Maintenance struct {
	ID                int64   `json:"id"`
	DeviceID          int64   `json:"deviceId"`
	Name              string  `json:"name"`
	IntervalKm        float64 `json:"intervalKm"`
	IntervalDays      int     `json:"intervalDays"`
	IntervalHours     float64 `json:"intervalHours"`
	LastServiceDate   string  `json:"lastServiceDate"`
	LastServiceKm     float64 `json:"lastServiceKm"`
	LastServiceHours  float64 `json:"lastServiceHours"`
	NotifyBeforeKm    float64 `json:"notifyBeforeKm"`
	NotifyBeforeDays  int     `json:"notifyBeforeDays"`
	NotifyBeforeHours float64 `json:"notifyBeforeHours"`

	Status         string   `json:"status"`
	NextDueKm      *float64 `json:"nextDueKm"`
	NextDueDate    *string  `json:"nextDueDate"`
	NextDueHours   *float64 `json:"nextDueHours"`
	RemainingKm    *float64 `json:"remainingKm"`
	RemainingDays  *int     `json:"remainingDays"`
	RemainingHours *float64 `json:"remainingHours"`

	CreatedAt time.Time `json:"createdAt"`

	notified string // status an event was last raised for
}

// ComputeStatus fills the computed fields for the given counters and day.
// km and hours items are overdue once the remaining value reaches 0; date
// items once the due date has passed (due today = dueSoon). An item is
// dueSoon when the remaining value is within its notifyBefore threshold.
// The overall status is the worst of the used intervals.
func (m *Maintenance) ComputeStatus(odometerKm, engineHours float64, today time.Time) {
	m.Status = DueOK
	m.NextDueKm, m.NextDueDate, m.NextDueHours = nil, nil, nil
	m.RemainingKm, m.RemainingDays, m.RemainingHours = nil, nil, nil
	if m.IntervalKm > 0 {
		next := round1(m.LastServiceKm + m.IntervalKm)
		rem := round1(next - odometerKm)
		m.NextDueKm, m.RemainingKm = &next, &rem
		m.Status = worse(m.Status, statusFor(rem <= 0, rem <= m.NotifyBeforeKm))
	}
	if m.IntervalDays > 0 {
		last, err := time.Parse(time.DateOnly, m.LastServiceDate)
		if err == nil {
			next := last.AddDate(0, 0, m.IntervalDays)
			ns := next.Format(time.DateOnly)
			rem := daysBetween(today, next)
			m.NextDueDate, m.RemainingDays = &ns, &rem
			m.Status = worse(m.Status, statusFor(rem < 0, rem <= m.NotifyBeforeDays))
		}
	}
	if m.IntervalHours > 0 {
		next := round1(m.LastServiceHours + m.IntervalHours)
		rem := round1(next - engineHours)
		m.NextDueHours, m.RemainingHours = &next, &rem
		m.Status = worse(m.Status, statusFor(rem <= 0, rem <= m.NotifyBeforeHours))
	}
}

func statusFor(overdue, soon bool) string {
	switch {
	case overdue:
		return DueOverdue
	case soon:
		return DueSoon
	}
	return DueOK
}

// daysBetween returns whole calendar days from a to b (UTC dates).
func daysBetween(a, b time.Time) int {
	ay, am, ad := a.UTC().Date()
	by, bm, bd := b.UTC().Date()
	da := time.Date(ay, am, ad, 0, 0, 0, 0, time.UTC)
	db := time.Date(by, bm, bd, 0, 0, 0, 0, time.UTC)
	return int(math.Round(db.Sub(da).Hours() / 24))
}

// MaintenanceInput is the body of POST /maintenance and PATCH
// /maintenance/{id}; nil fields are unchanged (PATCH) or defaulted (POST:
// lastServiceDate today, lastServiceKm/Hours the device's current counters).
type MaintenanceInput struct {
	DeviceID          *int64   `json:"deviceId"`
	Name              *string  `json:"name"`
	IntervalKm        *float64 `json:"intervalKm"`
	IntervalDays      *int     `json:"intervalDays"`
	IntervalHours     *float64 `json:"intervalHours"`
	LastServiceDate   *string  `json:"lastServiceDate"`
	LastServiceKm     *float64 `json:"lastServiceKm"`
	LastServiceHours  *float64 `json:"lastServiceHours"`
	NotifyBeforeKm    *float64 `json:"notifyBeforeKm"`
	NotifyBeforeDays  *int     `json:"notifyBeforeDays"`
	NotifyBeforeHours *float64 `json:"notifyBeforeHours"`
}

func (in *MaintenanceInput) apply(m *Maintenance) {
	setF := func(dst *float64, src *float64) {
		if src != nil {
			*dst = *src
		}
	}
	setI := func(dst *int, src *int) {
		if src != nil {
			*dst = *src
		}
	}
	if in.DeviceID != nil {
		m.DeviceID = *in.DeviceID
	}
	if in.Name != nil {
		m.Name = *in.Name
	}
	if in.LastServiceDate != nil {
		m.LastServiceDate = *in.LastServiceDate
	}
	setF(&m.IntervalKm, in.IntervalKm)
	setI(&m.IntervalDays, in.IntervalDays)
	setF(&m.IntervalHours, in.IntervalHours)
	setF(&m.LastServiceKm, in.LastServiceKm)
	setF(&m.LastServiceHours, in.LastServiceHours)
	setF(&m.NotifyBeforeKm, in.NotifyBeforeKm)
	setI(&m.NotifyBeforeDays, in.NotifyBeforeDays)
	setF(&m.NotifyBeforeHours, in.NotifyBeforeHours)
}

func nonNeg(v float64) bool { return v >= 0 && v <= 1e8 }

func (m *Maintenance) validate() error {
	m.Name = strings.TrimSpace(m.Name)
	switch {
	case m.Name == "":
		return invalid("name is required")
	case utf8.RuneCountInString(m.Name) > 100:
		return invalid("name must be at most 100 characters")
	case !nonNeg(m.IntervalKm) || !nonNeg(m.IntervalHours) || m.IntervalDays < 0 || m.IntervalDays > 36500:
		return invalid("intervals must not be negative")
	case m.IntervalKm == 0 && m.IntervalDays == 0 && m.IntervalHours == 0:
		return invalid("at least one of intervalKm, intervalDays, intervalHours is required")
	case !nonNeg(m.NotifyBeforeKm) || !nonNeg(m.NotifyBeforeHours) || m.NotifyBeforeDays < 0 || m.NotifyBeforeDays > 36500:
		return invalid("notifyBefore values must not be negative")
	case !nonNeg(m.LastServiceKm) || !nonNeg(m.LastServiceHours):
		return invalid("lastServiceKm and lastServiceHours must not be negative")
	}
	t, err := ParseDate("lastServiceDate", m.LastServiceDate)
	if err != nil {
		return err
	}
	m.LastServiceDate = t.Format(time.DateOnly)
	return nil
}

const maintenanceColumns = `id, device_id, name, interval_km, interval_days, interval_hours,
	to_char(last_service_date, 'YYYY-MM-DD'), last_service_km, last_service_hours,
	notify_before_km, notify_before_days, notify_before_hours, notified_status, created_at`

func scanMaintenance(row pgx.Row) (Maintenance, error) {
	var m Maintenance
	err := row.Scan(&m.ID, &m.DeviceID, &m.Name, &m.IntervalKm, &m.IntervalDays, &m.IntervalHours,
		&m.LastServiceDate, &m.LastServiceKm, &m.LastServiceHours,
		&m.NotifyBeforeKm, &m.NotifyBeforeDays, &m.NotifyBeforeHours, &m.notified, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return m, ErrNotFound
	}
	m.CreatedAt = m.CreatedAt.UTC()
	return m, err
}

// withStatus computes m's status from the cached device counters.
func (s *Store) withStatus(m Maintenance) Maintenance {
	odo, hours, _ := s.DeviceCounters(m.DeviceID)
	m.ComputeStatus(odo, hours, s.opts.Now())
	return m
}

// Scope restricts a listing to some devices (access control).
type Scope struct {
	All       bool
	DeviceIDs []int64
}

// sqlScope appends a device filter on column col to where/args.
func (sc Scope) sql(col string, where []string, args []any) ([]string, []any) {
	if sc.All {
		return where, args
	}
	args = append(args, sc.DeviceIDs)
	return append(where, fmt.Sprintf("%s = ANY($%d)", col, len(args))), args
}

// MaintenanceList returns maintenance items (optionally of one device),
// ordered by device and name, with their computed status.
func (s *Store) MaintenanceList(ctx context.Context, sc Scope, deviceID int64) ([]Maintenance, error) {
	where, args := []string{"true"}, []any{}
	if deviceID != 0 {
		args = append(args, deviceID)
		where = append(where, fmt.Sprintf("device_id = $%d", len(args)))
	}
	where, args = sc.sql("device_id", where, args)
	rows, err := s.pool.Query(ctx, `SELECT `+maintenanceColumns+` FROM maintenance WHERE `+
		strings.Join(where, " AND ")+` ORDER BY device_id, lower(name), id`, args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Maintenance, error) {
		m, err := scanMaintenance(r)
		return s.withStatus(m), err
	})
	if out == nil {
		out = []Maintenance{}
	}
	return out, err
}

// MaintenanceItem returns one item with its status.
func (s *Store) MaintenanceItem(ctx context.Context, id int64) (Maintenance, error) {
	m, err := scanMaintenance(s.pool.QueryRow(ctx, `SELECT `+maintenanceColumns+` FROM maintenance WHERE id = $1`, id))
	if err != nil {
		return m, err
	}
	return s.withStatus(m), nil
}

// CreateMaintenance inserts a schedule.
func (s *Store) CreateMaintenance(ctx context.Context, in MaintenanceInput) (Maintenance, error) {
	if in.DeviceID == nil {
		return Maintenance{}, invalid("deviceId is required")
	}
	odo, hours, err := s.DeviceCounters(*in.DeviceID)
	if err != nil {
		return Maintenance{}, invalid("unknown deviceId")
	}
	m := Maintenance{LastServiceDate: s.opts.Now().UTC().Format(time.DateOnly), LastServiceKm: odo, LastServiceHours: hours}
	in.apply(&m)
	if err := m.validate(); err != nil {
		return Maintenance{}, err
	}
	m, err = scanMaintenance(s.pool.QueryRow(ctx, `INSERT INTO maintenance (device_id, name, interval_km, interval_days,
			interval_hours, last_service_date, last_service_km, last_service_hours, notify_before_km, notify_before_days,
			notify_before_hours)
		VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11) RETURNING `+maintenanceColumns,
		m.DeviceID, m.Name, m.IntervalKm, m.IntervalDays, m.IntervalHours, m.LastServiceDate, m.LastServiceKm,
		m.LastServiceHours, m.NotifyBeforeKm, m.NotifyBeforeDays, m.NotifyBeforeHours))
	if isForeignKeyViolation(err) {
		return Maintenance{}, invalid("unknown deviceId")
	}
	if err != nil {
		return Maintenance{}, err
	}
	s.KickUpkeep()
	return s.withStatus(m), nil
}

// UpdateMaintenance applies a partial update.
func (s *Store) UpdateMaintenance(ctx context.Context, id int64, in MaintenanceInput) (Maintenance, error) {
	m, err := s.MaintenanceItem(ctx, id)
	if err != nil {
		return m, err
	}
	in.apply(&m)
	if err := m.validate(); err != nil {
		return Maintenance{}, err
	}
	m, err = scanMaintenance(s.pool.QueryRow(ctx, `UPDATE maintenance SET device_id = $2, name = $3, interval_km = $4,
			interval_days = $5, interval_hours = $6, last_service_date = $7::date, last_service_km = $8,
			last_service_hours = $9, notify_before_km = $10, notify_before_days = $11, notify_before_hours = $12
		WHERE id = $1 RETURNING `+maintenanceColumns,
		id, m.DeviceID, m.Name, m.IntervalKm, m.IntervalDays, m.IntervalHours, m.LastServiceDate, m.LastServiceKm,
		m.LastServiceHours, m.NotifyBeforeKm, m.NotifyBeforeDays, m.NotifyBeforeHours))
	if isForeignKeyViolation(err) {
		return Maintenance{}, invalid("unknown deviceId")
	}
	if err != nil {
		return Maintenance{}, err
	}
	s.KickUpkeep()
	return s.withStatus(m), nil
}

// DeleteMaintenance removes a schedule and its service history.
func (s *Store) DeleteMaintenance(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM maintenance WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ServiceRecord is one completed service of a maintenance item.
type ServiceRecord struct {
	ID            int64     `json:"id"`
	MaintenanceID int64     `json:"maintenanceId"`
	DeviceID      int64     `json:"deviceId"`
	Date          string    `json:"date"`
	Odometer      float64   `json:"odometer"`
	EngineHours   float64   `json:"engineHours"`
	Cost          float64   `json:"cost"`
	Notes         string    `json:"notes"`
	CreatedAt     time.Time `json:"createdAt"`
}

// CompleteInput is the body of POST /maintenance/{id}/complete.
type CompleteInput struct {
	Date        string   `json:"date"`
	Odometer    *float64 `json:"odometer"`
	EngineHours *float64 `json:"engineHours"`
	Cost        *float64 `json:"cost"`
	Notes       string   `json:"notes"`
}

// CompleteMaintenance records a service: it stores a ServiceRecord, resets
// the schedule to it (re-arming the due notifications) and, when cost > 0,
// creates a "maintenance" expense. Missing odometer/engineHours default to
// the device's current counters, a missing date to today.
func (s *Store) CompleteMaintenance(ctx context.Context, id int64, in CompleteInput) (Maintenance, ServiceRecord, error) {
	var rec ServiceRecord
	m, err := s.MaintenanceItem(ctx, id)
	if err != nil {
		return m, rec, err
	}
	if strings.TrimSpace(in.Date) == "" {
		in.Date = s.opts.Now().UTC().Format(time.DateOnly)
	}
	date, err := ParseDate("date", in.Date)
	if err != nil {
		return m, rec, err
	}
	odo, hours, _ := s.DeviceCounters(m.DeviceID)
	if in.Odometer != nil {
		odo = *in.Odometer
	}
	if in.EngineHours != nil {
		hours = *in.EngineHours
	}
	cost := 0.0
	if in.Cost != nil {
		cost = *in.Cost
	}
	in.Notes = strings.TrimSpace(in.Notes)
	switch {
	case !nonNeg(odo) || !nonNeg(hours):
		return m, rec, invalid("odometer and engineHours must not be negative")
	case !(cost >= 0 && cost <= 1e12):
		return m, rec, invalid("cost must not be negative")
	case utf8.RuneCountInString(in.Notes) > 2000:
		return m, rec, invalid("notes must be at most 2000 characters")
	}
	ds := date.Format(time.DateOnly)
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `INSERT INTO service_records (maintenance_id, device_id, date, odometer, engine_hours, cost, notes)
			VALUES ($1, $2, $3::date, $4, $5, $6, $7) RETURNING id, created_at`,
			id, m.DeviceID, ds, odo, hours, cost, in.Notes).Scan(&rec.ID, &rec.CreatedAt)
		if err != nil {
			return err
		}
		m, err = scanMaintenance(tx.QueryRow(ctx, `UPDATE maintenance SET last_service_date = $2::date,
				last_service_km = $3, last_service_hours = $4, notified_status = 'ok'
			WHERE id = $1 RETURNING `+maintenanceColumns, id, ds, odo, hours))
		if err != nil {
			return err
		}
		if cost > 0 {
			notes := m.Name
			if in.Notes != "" {
				notes += ": " + in.Notes
			}
			_, err = tx.Exec(ctx, `INSERT INTO expenses (device_id, category, amount, odometer, date, notes)
				VALUES ($1, 'maintenance', $2, $3, $4::date, $5)`, m.DeviceID, cost, odo, ds, notes)
		}
		return err
	})
	if err != nil {
		return Maintenance{}, rec, err
	}
	rec.MaintenanceID, rec.DeviceID, rec.Date, rec.Odometer, rec.EngineHours, rec.Cost, rec.Notes =
		id, m.DeviceID, ds, odo, hours, cost, in.Notes
	rec.CreatedAt = rec.CreatedAt.UTC()
	s.KickUpkeep()
	return s.withStatus(m), rec, nil
}

// ServiceHistory returns the service records of an item, newest first.
func (s *Store) ServiceHistory(ctx context.Context, maintenanceID int64) ([]ServiceRecord, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, maintenance_id, device_id, to_char(date, 'YYYY-MM-DD'), odometer,
			engine_hours, cost, notes, created_at
		FROM service_records WHERE maintenance_id = $1 ORDER BY date DESC, id DESC`, maintenanceID)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (ServiceRecord, error) {
		var x ServiceRecord
		err := r.Scan(&x.ID, &x.MaintenanceID, &x.DeviceID, &x.Date, &x.Odometer, &x.EngineHours, &x.Cost, &x.Notes, &x.CreatedAt)
		x.CreatedAt = x.CreatedAt.UTC()
		return x, err
	})
	if out == nil {
		out = []ServiceRecord{}
	}
	return out, err
}
