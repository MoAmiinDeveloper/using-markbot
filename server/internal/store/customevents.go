package store

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/moamiindeveloper/fleet/server/internal/expr"
)

// Custom event severities.
var Severities = []string{"info", "warning", "critical"}

// CustomEvent raises an event of type "custom" when Condition has held for
// Duration seconds on a device's fixes.
type CustomEvent struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	Condition string    `json:"condition"`
	DeviceIDs []int64   `json:"deviceIds"` // empty = all devices
	Duration  int       `json:"duration"`  // seconds
	Message   string    `json:"message"`   // template: {device}, {name}, {<parameter>}
	Severity  string    `json:"severity"`
	NotifyEnd bool      `json:"notifyEnd"` // also raise an event when the condition clears
	Enabled   bool      `json:"enabled"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`

	compiled *expr.Expr
}

// Compiled returns the compiled condition (nil if it does not compile).
func (c *CustomEvent) Compiled() *expr.Expr { return c.compiled }

// AppliesTo reports whether the custom event covers the device.
func (c *CustomEvent) AppliesTo(deviceID int64) bool {
	return len(c.DeviceIDs) == 0 || slices.Contains(c.DeviceIDs, deviceID)
}

// CustomEventInput is the body of POST/PUT /custom-events.
type CustomEventInput struct {
	Name      string  `json:"name"`
	Condition string  `json:"condition"`
	DeviceIDs []int64 `json:"deviceIds"`
	Duration  int     `json:"duration"`
	Message   string  `json:"message"`
	Severity  string  `json:"severity"`
	NotifyEnd bool    `json:"notifyEnd"`
	Enabled   *bool   `json:"enabled"`
}

func (s *Store) normalizeCustomEvent(in *CustomEventInput) error {
	in.Name = strings.TrimSpace(in.Name)
	in.Condition = strings.TrimSpace(in.Condition)
	in.Message = strings.TrimSpace(in.Message)
	in.Severity = strings.TrimSpace(in.Severity)
	if in.Severity == "" {
		in.Severity = "warning"
	}
	if in.Enabled == nil {
		t := true
		in.Enabled = &t
	}
	if in.DeviceIDs == nil {
		in.DeviceIDs = []int64{}
	}
	switch {
	case in.Name == "":
		return invalid("name is required")
	case utf8.RuneCountInString(in.Name) > 64:
		return invalid("name must be at most 64 characters")
	case utf8.RuneCountInString(in.Message) > 300:
		return invalid("message must be at most 300 characters")
	case !slices.Contains(Severities, in.Severity):
		return invalid("severity must be one of: %s", strings.Join(Severities, ", "))
	case in.Duration < 0 || in.Duration > 86400:
		return invalid("duration must be between 0 and 86400 seconds")
	}
	if _, err := expr.Compile(in.Condition); err != nil {
		return invalid("condition: %v", err)
	}
	slices.Sort(in.DeviceIDs)
	in.DeviceIDs = slices.Compact(in.DeviceIDs)
	for _, id := range in.DeviceIDs {
		if _, err := s.Device(id); err != nil {
			return invalid("device %d not found", id)
		}
	}
	return nil
}

const customEventColumns = `id, name, condition, device_ids, duration, message, severity, notify_end, enabled, created_at, updated_at`

func scanCustomEvent(row pgx.Row) (CustomEvent, error) {
	var c CustomEvent
	err := row.Scan(&c.ID, &c.Name, &c.Condition, &c.DeviceIDs, &c.Duration, &c.Message, &c.Severity,
		&c.NotifyEnd, &c.Enabled, &c.CreatedAt, &c.UpdatedAt)
	if c.DeviceIDs == nil {
		c.DeviceIDs = []int64{}
	}
	c.CreatedAt, c.UpdatedAt = c.CreatedAt.UTC(), c.UpdatedAt.UTC()
	return c, err
}

type customEventCache struct{ list atomic.Pointer[[]CustomEvent] }

func (s *Store) loadCustomEvents(ctx context.Context) error {
	rows, err := s.pool.Query(ctx, `SELECT `+customEventColumns+` FROM custom_events ORDER BY id`)
	if err != nil {
		return err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (CustomEvent, error) { return scanCustomEvent(r) })
	if err != nil {
		return err
	}
	for i := range list {
		if e, err := expr.Compile(list[i].Condition); err == nil {
			list[i].compiled = e
		} else {
			s.log.Warn("custom event condition does not compile", "id", list[i].ID, "err", err)
		}
	}
	s.customEvents.list.Store(&list)
	return nil
}

func (s *Store) reloadCustomEvents(ctx context.Context) {
	if err := s.loadCustomEvents(context.WithoutCancel(ctx)); err != nil {
		s.log.Error("reload custom events", "err", err)
	}
}

// CustomEvents returns all custom events ordered by id (shared snapshot; do not modify).
func (s *Store) CustomEvents() []CustomEvent {
	if p := s.customEvents.list.Load(); p != nil {
		return *p
	}
	return nil
}

// CustomEventByID returns one custom event or ErrNotFound.
func (s *Store) CustomEventByID(id int64) (CustomEvent, error) {
	for _, c := range s.CustomEvents() {
		if c.ID == id {
			return c, nil
		}
	}
	return CustomEvent{}, ErrNotFound
}

// CreateCustomEvent validates and inserts a custom event.
func (s *Store) CreateCustomEvent(ctx context.Context, in CustomEventInput) (CustomEvent, error) {
	if err := s.normalizeCustomEvent(&in); err != nil {
		return CustomEvent{}, err
	}
	c, err := scanCustomEvent(s.pool.QueryRow(ctx, `INSERT INTO custom_events (name, condition, device_ids, duration,
			message, severity, notify_end, enabled)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING `+customEventColumns,
		in.Name, in.Condition, in.DeviceIDs, in.Duration, in.Message, in.Severity, in.NotifyEnd, *in.Enabled))
	if err != nil {
		return CustomEvent{}, fmt.Errorf("create custom event: %w", err)
	}
	s.reloadCustomEvents(ctx)
	return c, nil
}

// UpdateCustomEvent replaces a custom event.
func (s *Store) UpdateCustomEvent(ctx context.Context, id int64, in CustomEventInput) (CustomEvent, error) {
	if err := s.normalizeCustomEvent(&in); err != nil {
		return CustomEvent{}, err
	}
	c, err := scanCustomEvent(s.pool.QueryRow(ctx, `UPDATE custom_events SET name = $2, condition = $3,
			device_ids = $4, duration = $5, message = $6, severity = $7, notify_end = $8, enabled = $9, updated_at = now()
		WHERE id = $1 RETURNING `+customEventColumns,
		id, in.Name, in.Condition, in.DeviceIDs, in.Duration, in.Message, in.Severity, in.NotifyEnd, *in.Enabled))
	if errors.Is(err, pgx.ErrNoRows) {
		return CustomEvent{}, ErrNotFound
	}
	if err != nil {
		return CustomEvent{}, err
	}
	s.reloadCustomEvents(ctx)
	return c, nil
}

// DeleteCustomEvent removes a custom event; its past events stay.
func (s *Store) DeleteCustomEvent(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM custom_events WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	s.reloadCustomEvents(ctx)
	return nil
}
