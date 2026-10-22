package store

import (
	"context"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
)

// PositionsRange returns up to limit positions of a device with device time
// in [from, to], in ascending time order.
func (s *Store) PositionsRange(ctx context.Context, deviceID int64, from, to time.Time, limit int) ([]domain.Position, error) {
	dev, err := s.Device(deviceID)
	if err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT device_time, server_time, lat, lng, altitude, speed, course,
			satellites, valid, priority, event_id, attributes
		FROM positions WHERE device_id = $1 AND device_time >= $2 AND device_time <= $3
		ORDER BY device_time, id LIMIT $4`, deviceID, from, to, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Position{}
	for rows.Next() {
		p := domain.Position{DeviceID: deviceID, IMEI: dev.IMEI, Protocol: dev.Protocol}
		if err := rows.Scan(&p.DeviceTime, &p.ServerTime, &p.Latitude, &p.Longitude, &p.Altitude, &p.Speed,
			&p.Course, &p.Satellites, &p.Valid, &p.Priority, &p.EventID, &p.Attributes); err != nil {
			return nil, err
		}
		p.DeviceTime, p.ServerTime = p.DeviceTime.UTC(), p.ServerTime.UTC()
		out = append(out, p)
	}
	return out, rows.Err()
}

// Trips detects trips of a device within [from, to], streaming positions
// from the database without materializing them.
func (s *Store) Trips(ctx context.Context, deviceID int64, from, to time.Time) ([]Trip, error) {
	if _, err := s.Device(deviceID); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT device_time, lat, lng, speed,
			CASE WHEN jsonb_typeof(attributes->'ignition') = 'boolean'
			     THEN (attributes->>'ignition')::boolean END
		FROM positions
		WHERE device_id = $1 AND device_time >= $2 AND device_time <= $3
		  AND valid AND NOT (lat = 0 AND lng = 0)
		ORDER BY device_time, id`, deviceID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var (
		det TripDetector
		p   TripPoint
	)
	for rows.Next() {
		p.Ignition = nil // Scan into a nil-able pointer must start fresh
		if err := rows.Scan(&p.Time, &p.Lat, &p.Lng, &p.Speed, &p.Ignition); err != nil {
			return nil, err
		}
		p.Time = p.Time.UTC()
		det.Add(p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return det.Trips(), nil
}
