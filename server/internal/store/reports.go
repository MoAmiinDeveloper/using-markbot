package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Queries used by reports and the dashboard (analytics module). They stream
// rows so a report over months of data never materializes all positions.

// ReportPoint is the subset of a position reports need.
type ReportPoint struct {
	Time     time.Time
	Lat, Lng float64
	Speed    float64 // km/h
	Valid    bool    // valid GNSS fix with non-zero coordinates
	Ignition *bool   // nil when not reported
	Driver   string  // attributes.driverId ("" when absent)
	FuelUsed *float64
}

// StreamReportPoints calls fn for every position of a device with device
// time in [from, to], in ascending time order. fn must not retain p.
func (s *Store) StreamReportPoints(ctx context.Context, deviceID int64, from, to time.Time, fn func(p *ReportPoint) error) error {
	rows, err := s.pool.Query(ctx, `SELECT device_time, lat, lng, speed, valid AND NOT (lat = 0 AND lng = 0),
			CASE WHEN jsonb_typeof(attributes->'ignition') = 'boolean' THEN (attributes->>'ignition')::boolean END,
			COALESCE(attributes->>'driverId', ''),
			CASE WHEN jsonb_typeof(attributes->'fuelUsed') = 'number' THEN (attributes->>'fuelUsed')::float8 END
		FROM positions
		WHERE device_id = $1 AND device_time >= $2 AND device_time <= $3
		ORDER BY device_time`, deviceID, from, to)
	if err != nil {
		return err
	}
	defer rows.Close()
	var p ReportPoint
	for rows.Next() {
		p.Ignition, p.FuelUsed = nil, nil
		if err := rows.Scan(&p.Time, &p.Lat, &p.Lng, &p.Speed, &p.Valid, &p.Ignition, &p.Driver, &p.FuelUsed); err != nil {
			return err
		}
		p.Time = p.Time.UTC()
		if err := fn(&p); err != nil {
			return err
		}
	}
	return rows.Err()
}

// SystemLogLookback widens the device-time window of StreamServerTimes so
// records buffered by the device (sent late) still count by arrival time.
const SystemLogLookback = 24 * time.Hour

// StreamServerTimes calls fn with the server (arrival) time of every
// position of a device received in [from, to], in ascending order.
func (s *Store) StreamServerTimes(ctx context.Context, deviceID int64, from, to time.Time, fn func(t time.Time)) error {
	rows, err := s.pool.Query(ctx, `SELECT server_time FROM positions
		WHERE device_id = $1 AND device_time >= $2 AND device_time <= $3
		  AND server_time >= $4 AND server_time <= $3
		ORDER BY server_time`, deviceID, from.Add(-SystemLogLookback), to, from)
	if err != nil {
		return err
	}
	defer rows.Close()
	var t time.Time
	for rows.Next() {
		if err := rows.Scan(&t); err != nil {
			return err
		}
		fn(t.UTC())
	}
	return rows.Err()
}

// ReportEvent is an event with what reports show next to it.
type ReportEvent struct {
	Event
	GeofenceName string // current name of the geofence, else attributes.geofenceName
	DriverTag    string // attributes.driverId of the latest fix at or before the event
}

// ReportEvents returns events of the given devices (and types, if any) in
// [from, to], oldest first, at most limit rows. withDriver also resolves the
// driver tag reported at the time of each event.
func (s *Store) ReportEvents(ctx context.Context, deviceIDs []int64, types []string, from, to time.Time,
	limit int, withDriver bool) ([]ReportEvent, error) {
	if len(deviceIDs) == 0 {
		return nil, nil
	}
	driver := `''`
	if withDriver {
		driver = `COALESCE((SELECT p.attributes->>'driverId' FROM positions p
			WHERE p.device_id = e.device_id AND p.device_time <= e.time
			ORDER BY p.device_time DESC LIMIT 1), '')`
	}
	where := "e.device_id = ANY($1) AND e.time >= $2 AND e.time <= $3"
	args := []any{deviceIDs, from, to, limit}
	if len(types) > 0 {
		where += " AND e.type = ANY($5)"
		args = append(args, types)
	}
	rows, err := s.pool.Query(ctx, `SELECT e.id, e.device_id, e.type, e.time, e.lat, e.lng, e.geofence_id,
			e.attributes, e.message, COALESCE(g.name, e.attributes->>'geofenceName', ''), `+driver+`
		FROM events e LEFT JOIN geofences g ON g.id = e.geofence_id
		WHERE `+where+` ORDER BY e.time, e.id LIMIT $4`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ReportEvent
	for rows.Next() {
		var e ReportEvent
		if err := rows.Scan(&e.ID, &e.DeviceID, &e.Type, &e.Time, &e.Lat, &e.Lng, &e.GeofenceID, &e.Attributes,
			&e.Message, &e.GeofenceName, &e.DriverTag); err != nil {
			return nil, err
		}
		e.Time = e.Time.UTC()
		if e.Attributes == nil {
			e.Attributes = map[string]any{}
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// EventCount is the number of events of one type for one device.
type EventCount struct {
	DeviceID int64
	Type     string
	Count    int
}

// CountEvents counts events per device and type in [from, to].
func (s *Store) CountEvents(ctx context.Context, deviceIDs []int64, from, to time.Time) ([]EventCount, error) {
	if len(deviceIDs) == 0 {
		return nil, nil
	}
	rows, err := s.pool.Query(ctx, `SELECT device_id, type, count(*) FROM events
		WHERE device_id = ANY($1) AND time >= $2 AND time <= $3 GROUP BY device_id, type`, deviceIDs, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EventCount
	for rows.Next() {
		var c EventCount
		if err := rows.Scan(&c.DeviceID, &c.Type, &c.Count); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// DriverRef identifies a driver for report attribution.
type DriverRef struct {
	ID       int64
	Name     string
	Tag      string
	DeviceID *int64 // manually assigned vehicle
}

// NormalizeTag canonicalizes an iButton/RFID id for comparison: upper case
// without leading zeros.
func NormalizeTag(tag string) string {
	return strings.TrimLeft(strings.ToUpper(strings.TrimSpace(tag)), "0")
}

// ReportDrivers returns every driver.
func (s *Store) ReportDrivers(ctx context.Context) ([]DriverRef, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, name, tag, device_id FROM drivers ORDER BY lower(name), id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DriverRef
	for rows.Next() {
		var d DriverRef
		if err := rows.Scan(&d.ID, &d.Name, &d.Tag, &d.DeviceID); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// GroupDeviceIDs returns the devices of a group (ErrNotFound if the group
// does not exist).
func (s *Store) GroupDeviceIDs(ctx context.Context, groupID int64) ([]int64, error) {
	var ids []int64
	err := s.pool.QueryRow(ctx, `SELECT COALESCE(array_agg(gd.device_id ORDER BY gd.device_id)
			FILTER (WHERE gd.device_id IS NOT NULL), '{}')
		FROM groups g LEFT JOIN group_devices gd ON gd.group_id = g.id WHERE g.id = $1 GROUP BY g.id`, groupID).Scan(&ids)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return ids, nil
}

// ExpensesTotal sums the expenses of the given devices dated on or after
// fromDate.
func (s *Store) ExpensesTotal(ctx context.Context, deviceIDs []int64, fromDate time.Time) (float64, error) {
	var total float64
	err := s.pool.QueryRow(ctx, `SELECT COALESCE(sum(amount), 0) FROM expenses
		WHERE device_id = ANY($1) AND date >= $2::date`, deviceIDs, fromDate.Format(time.DateOnly)).Scan(&total)
	return total, err
}
