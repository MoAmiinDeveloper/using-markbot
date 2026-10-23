package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// ScheduleFilters selects what a scheduled report covers.
type ScheduleFilters struct {
	DeviceIDs []int64 `json:"deviceIds"`
	GroupID   *int64  `json:"groupId"`
	DriverID  *int64  `json:"driverId"`
}

// ReportSchedule is a report generated and delivered periodically.
// Validation and next-run computation live in package schedule.
type ReportSchedule struct {
	ID              int64           `json:"id"`
	Name            string          `json:"name"`
	ReportType      string          `json:"reportType"`
	Filters         ScheduleFilters `json:"filters"`
	Period          string          `json:"period"`
	Frequency       string          `json:"frequency"`
	Hour            int             `json:"hour"`
	Weekday         int             `json:"weekday"`
	MonthDay        int             `json:"monthDay"`
	Timezone        string          `json:"timezone"`
	Format          string          `json:"format"`
	TelegramUserIDs []int64         `json:"telegramUserIds"`
	Emails          []string        `json:"emails"`
	Enabled         bool            `json:"enabled"`
	LastRunAt       *time.Time      `json:"lastRunAt"`
	LastStatus      *string         `json:"lastStatus"`
	LastError       string          `json:"lastError"`
	NextRunAt       time.Time       `json:"nextRunAt"`
	CreatedBy       *int64          `json:"createdBy"`
	CreatedAt       time.Time       `json:"createdAt"`
}

// ReportRun is one entry of a schedule's run log.
type ReportRun struct {
	Time       time.Time `json:"time"`
	Status     string    `json:"status"` // ok | error
	Error      string    `json:"error"`
	Recipients []string  `json:"recipients"` // delivered to, e.g. "email:ops@example.com", "telegram:Admin"
	Manual     bool      `json:"manual"`     // POST …/run
}

const scheduleColumns = `id, name, report_type, filters, period, frequency, hour, weekday, month_day, timezone,
	format, telegram_user_ids, emails, enabled, last_run_at, last_status, last_error, next_run_at, created_by, created_at`

func scanSchedule(row pgx.Row) (ReportSchedule, error) {
	var s ReportSchedule
	err := row.Scan(&s.ID, &s.Name, &s.ReportType, &s.Filters, &s.Period, &s.Frequency, &s.Hour, &s.Weekday,
		&s.MonthDay, &s.Timezone, &s.Format, &s.TelegramUserIDs, &s.Emails, &s.Enabled, &s.LastRunAt,
		&s.LastStatus, &s.LastError, &s.NextRunAt, &s.CreatedBy, &s.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, ErrNotFound
	}
	if err != nil {
		return s, err
	}
	s.NextRunAt, s.CreatedAt = s.NextRunAt.UTC(), s.CreatedAt.UTC()
	if s.LastRunAt != nil {
		t := s.LastRunAt.UTC()
		s.LastRunAt = &t
	}
	if s.Filters.DeviceIDs == nil {
		s.Filters.DeviceIDs = []int64{}
	}
	if s.TelegramUserIDs == nil {
		s.TelegramUserIDs = []int64{}
	}
	if s.Emails == nil {
		s.Emails = []string{}
	}
	return s, nil
}

func scheduleArgs(s *ReportSchedule) []any {
	if s.Filters.DeviceIDs == nil {
		s.Filters.DeviceIDs = []int64{}
	}
	if s.TelegramUserIDs == nil {
		s.TelegramUserIDs = []int64{}
	}
	if s.Emails == nil {
		s.Emails = []string{}
	}
	return []any{s.Name, s.ReportType, s.Filters, s.Period, s.Frequency, s.Hour, s.Weekday, s.MonthDay,
		s.Timezone, s.Format, s.TelegramUserIDs, s.Emails, s.Enabled, s.NextRunAt}
}

// CreateReportSchedule stores a validated schedule.
func (s *Store) CreateReportSchedule(ctx context.Context, sc ReportSchedule) (ReportSchedule, error) {
	args := append(scheduleArgs(&sc), sc.CreatedBy)
	return scanSchedule(s.pool.QueryRow(ctx, `INSERT INTO report_schedules (name, report_type, filters, period,
			frequency, hour, weekday, month_day, timezone, format, telegram_user_ids, emails, enabled, next_run_at,
			created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING `+scheduleColumns, args...))
}

// UpdateReportSchedule saves the editable fields (and next run) of a schedule.
func (s *Store) UpdateReportSchedule(ctx context.Context, sc ReportSchedule) (ReportSchedule, error) {
	args := append([]any{sc.ID}, scheduleArgs(&sc)...)
	return scanSchedule(s.pool.QueryRow(ctx, `UPDATE report_schedules SET name = $2, report_type = $3, filters = $4,
			period = $5, frequency = $6, hour = $7, weekday = $8, month_day = $9, timezone = $10, format = $11,
			telegram_user_ids = $12, emails = $13, enabled = $14, next_run_at = $15, updated_at = now()
		WHERE id = $1 RETURNING `+scheduleColumns, args...))
}

// ReportSchedule returns one schedule.
func (s *Store) ReportSchedule(ctx context.Context, id int64) (ReportSchedule, error) {
	return scanSchedule(s.pool.QueryRow(ctx, `SELECT `+scheduleColumns+` FROM report_schedules WHERE id = $1`, id))
}

// ReportSchedules lists schedules, all of them when createdBy is 0.
func (s *Store) ReportSchedules(ctx context.Context, createdBy int64) ([]ReportSchedule, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+scheduleColumns+` FROM report_schedules
		WHERE $1 = 0 OR created_by = $1 ORDER BY lower(name), id`, createdBy)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (ReportSchedule, error) { return scanSchedule(r) })
	if out == nil {
		out = []ReportSchedule{}
	}
	return out, err
}

// DeleteReportSchedule removes a schedule and its run log.
func (s *Store) DeleteReportSchedule(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM report_schedules WHERE id = $1`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// DueReportSchedules returns enabled schedules whose next run is at or
// before now, oldest first.
func (s *Store) DueReportSchedules(ctx context.Context, now time.Time) ([]ReportSchedule, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+scheduleColumns+` FROM report_schedules
		WHERE enabled AND next_run_at <= $1 ORDER BY next_run_at, id`, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ReportSchedule, error) { return scanSchedule(r) })
}

// ClaimReportSchedule advances next_run_at from prev to next; it returns
// false when another worker (or an edit) changed it first.
func (s *Store) ClaimReportSchedule(ctx context.Context, id int64, prev, next time.Time) (bool, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE report_schedules SET next_run_at = $3
		WHERE id = $1 AND enabled AND next_run_at = $2`, id, prev, next)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// maxRunsKept is the run log length per schedule.
const maxRunsKept = 100

// RecordReportRun appends to the run log and updates the last-run fields.
func (s *Store) RecordReportRun(ctx context.Context, scheduleID int64, run ReportRun) error {
	if run.Recipients == nil {
		run.Recipients = []string{}
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO report_runs (schedule_id, time, status, error, recipients, manual)
			SELECT $1, $2, $3, $4, $5, $6 WHERE EXISTS (SELECT 1 FROM report_schedules WHERE id = $1)`,
			scheduleID, run.Time, run.Status, run.Error, run.Recipients, run.Manual); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM report_runs WHERE schedule_id = $1 AND id NOT IN
			(SELECT id FROM report_runs WHERE schedule_id = $1 ORDER BY time DESC, id DESC LIMIT $2)`,
			scheduleID, maxRunsKept); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE report_schedules SET last_run_at = $2, last_status = $3, last_error = $4
			WHERE id = $1`, scheduleID, run.Time, run.Status, run.Error)
		return err
	})
}

// ReportRuns returns the run log of a schedule, newest first.
func (s *Store) ReportRuns(ctx context.Context, scheduleID int64, limit int) ([]ReportRun, error) {
	rows, err := s.pool.Query(ctx, `SELECT time, status, error, recipients, manual FROM report_runs
		WHERE schedule_id = $1 ORDER BY time DESC, id DESC LIMIT $2`, scheduleID, limit)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (ReportRun, error) {
		var run ReportRun
		err := r.Scan(&run.Time, &run.Status, &run.Error, &run.Recipients, &run.Manual)
		run.Time = run.Time.UTC()
		if run.Recipients == nil {
			run.Recipients = []string{}
		}
		return run, err
	})
	if out == nil {
		out = []ReportRun{}
	}
	return out, err
}
