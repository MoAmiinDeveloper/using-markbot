package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Event types.
const (
	EventGeofenceEnter = "geofenceEnter"
	EventGeofenceExit  = "geofenceExit"
	EventOverspeed     = "overspeed"
	EventIgnitionOn    = "ignitionOn"
	EventIgnitionOff   = "ignitionOff"
	EventAlarm         = "alarm"
	EventCommandResult = "commandResult"
)

// EventTypes lists every event type.
var EventTypes = []string{EventGeofenceEnter, EventGeofenceExit, EventOverspeed, EventIgnitionOn,
	EventIgnitionOff, EventAlarm, EventCommandResult}

// EventEvent is the live event type carrying a new Event.
const EventEvent = "event"

// Event is an alert raised by the events engine or a command result.
type Event struct {
	ID         int64          `json:"id"`
	DeviceID   int64          `json:"deviceId"`
	Type       string         `json:"type"`
	Time       time.Time      `json:"time"`
	Lat        float64        `json:"lat"`
	Lng        float64        `json:"lng"`
	GeofenceID *int64         `json:"geofenceId"`
	Attributes map[string]any `json:"attributes"`
	Message    string         `json:"message"`
}

const eventColumns = `id, device_id, type, time, lat, lng, geofence_id, attributes, message`

func scanEvent(row pgx.Row) (Event, error) {
	var e Event
	err := row.Scan(&e.ID, &e.DeviceID, &e.Type, &e.Time, &e.Lat, &e.Lng, &e.GeofenceID, &e.Attributes, &e.Message)
	e.Time = e.Time.UTC()
	if e.Attributes == nil {
		e.Attributes = map[string]any{}
	}
	return e, err
}

// InsertEvents persists events in one round trip, filling in their ids, and
// publishes each as a live "event".
func (s *Store) InsertEvents(ctx context.Context, evs []Event) error {
	if len(evs) == 0 {
		return nil
	}
	b := &pgx.Batch{}
	for i := range evs {
		e := &evs[i]
		if e.Attributes == nil {
			e.Attributes = map[string]any{}
		}
		e.Time = e.Time.UTC().Truncate(time.Microsecond) // database precision
		b.Queue(`INSERT INTO events (device_id, type, time, lat, lng, geofence_id, attributes, message)
			SELECT $1::bigint, $2::text, $3::timestamptz, $4::float8, $5::float8, $6::bigint, $7::jsonb, $8::text
			WHERE EXISTS (SELECT 1 FROM devices WHERE id = $1)
			RETURNING id`, e.DeviceID, e.Type, e.Time, e.Lat, e.Lng, e.GeofenceID, e.Attributes, e.Message)
	}
	br := s.pool.SendBatch(ctx, b)
	for i := range evs {
		// No row: the device was deleted meanwhile; leave ID at 0.
		if err := br.QueryRow().Scan(&evs[i].ID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			br.Close()
			return fmt.Errorf("insert event: %w", err)
		}
	}
	if err := br.Close(); err != nil {
		return fmt.Errorf("insert events: %w", err)
	}
	for i := range evs {
		if evs[i].ID != 0 {
			s.publish(EventEvent, evs[i])
		}
	}
	return nil
}

// EventFilter selects events; zero fields are ignored.
type EventFilter struct {
	DeviceID int64
	Types    []string
	From, To time.Time
	Limit    int
}

// Events returns matching events, newest first.
func (s *Store) Events(ctx context.Context, f EventFilter) ([]Event, error) {
	where := []string{"time >= $1", "time <= $2"}
	args := []any{f.From, f.To}
	if f.DeviceID != 0 {
		args = append(args, f.DeviceID)
		where = append(where, fmt.Sprintf("device_id = $%d", len(args)))
	}
	if len(f.Types) > 0 {
		args = append(args, f.Types)
		where = append(where, fmt.Sprintf("type = ANY($%d)", len(args)))
	}
	args = append(args, f.Limit)
	rows, err := s.pool.Query(ctx, `SELECT `+eventColumns+` FROM events WHERE `+strings.Join(where, " AND ")+
		fmt.Sprintf(` ORDER BY time DESC, id DESC LIMIT $%d`, len(args)), args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Event, error) { return scanEvent(r) })
	if out == nil {
		out = []Event{}
	}
	return out, err
}
