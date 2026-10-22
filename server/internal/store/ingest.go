package store

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
)

const upsertStateSQL = `INSERT INTO device_state AS s (device_id, position_time, position, last_seen)
VALUES ($1, $2, $3, $4)
ON CONFLICT (device_id) DO UPDATE SET
	last_seen     = GREATEST(s.last_seen, EXCLUDED.last_seen),
	position      = CASE WHEN s.position_time IS NULL OR EXCLUDED.position_time > s.position_time
	                     THEN EXCLUDED.position ELSE s.position END,
	position_time = GREATEST(s.position_time, EXCLUDED.position_time)`

const insertPositionSQL = `INSERT INTO positions (device_id, device_time, server_time, lat, lng, altitude,
	speed, course, satellites, valid, priority, event_id, attributes)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`

// Authorize implements domain.Sink. Known IMEIs are resolved from memory;
// unknown ones are registered when AutoRegister is enabled.
func (s *Store) Authorize(ctx context.Context, imei, protocol string) (bool, error) {
	s.mu.RLock()
	_, ok := s.byIMEI[imei]
	s.mu.RUnlock()
	if ok {
		return true, nil
	}
	if !s.opts.AutoRegister {
		s.log.Warn("rejecting unknown device", "imei", imei, "protocol", protocol)
		return false, nil
	}
	if err := ValidateIMEI(protocol, imei); err != nil {
		s.log.Warn("rejecting device with invalid IMEI", "imei", imei, "protocol", protocol, "err", err)
		return false, nil
	}
	suffix := imei[max(0, len(imei)-6):]
	// ON CONFLICT returns the existing row if another connection won the race.
	row := s.pool.QueryRow(ctx, `INSERT INTO devices AS d (name, imei, protocol) VALUES ($1, $2, $3)
		ON CONFLICT (imei) DO UPDATE SET imei = EXCLUDED.imei RETURNING `+deviceColumns,
		"Device "+suffix, imei, protocol)
	d, err := scanDevice(row)
	if err != nil {
		return false, fmt.Errorf("auto-register %s: %w", imei, err)
	}
	s.cacheNewDevice(d)
	s.log.Info("auto-registered device", "id", d.ID, "imei", imei, "protocol", protocol)
	return true, nil
}

// Positions implements domain.Sink. The batch is written in a single round
// trip (pgx batches run in one implicit transaction): all positions plus one
// device_state upsert per device. Afterwards fixes newer than the cached
// latest position are published, oldest first, so replayed buffered records
// are stored but never move a vehicle backwards on the live map.
func (s *Store) Positions(ctx context.Context, batch []domain.Position) error {
	if len(batch) == 0 {
		return nil
	}
	now := s.opts.Now().UTC()

	// Copy: the cache keeps pointers into ps, the caller may reuse batch.
	ps := make([]domain.Position, len(batch))
	s.mu.RLock()
	for i := range batch {
		id, ok := s.byIMEI[batch[i].IMEI]
		if !ok {
			s.mu.RUnlock()
			return fmt.Errorf("%w: %s", ErrUnknownDevice, batch[i].IMEI)
		}
		batch[i].DeviceID = id
		ps[i] = batch[i]
	}
	s.mu.RUnlock()

	for i := range ps {
		p := &ps[i]
		p.DeviceTime = p.DeviceTime.UTC()
		if p.ServerTime.IsZero() {
			p.ServerTime = now
		}
		p.ServerTime = p.ServerTime.UTC()
		if p.Attributes == nil {
			p.Attributes = map[string]any{}
		}
	}
	// Stable sort by device time: newest-per-device is last, publish order is chronological.
	sort.SliceStable(ps, func(i, j int) bool { return ps[i].DeviceTime.Before(ps[j].DeviceTime) })
	newest := make(map[int64]*domain.Position)
	for i := range ps {
		newest[ps[i].DeviceID] = &ps[i]
	}

	b := &pgx.Batch{}
	for i := range ps {
		p := &ps[i]
		b.Queue(insertPositionSQL, p.DeviceID, p.DeviceTime, p.ServerTime, p.Latitude, p.Longitude,
			p.Altitude, p.Speed, p.Course, p.Satellites, p.Valid, p.Priority, p.EventID, p.Attributes)
	}
	for id, p := range newest {
		js, err := json.Marshal(p)
		if err != nil {
			return fmt.Errorf("encode position: %w", err)
		}
		b.Queue(upsertStateSQL, id, p.DeviceTime, js, now)
	}
	if err := s.pool.SendBatch(ctx, b).Close(); err != nil {
		return fmt.Errorf("store positions: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	touched := make(map[int64]*deviceEntry, len(newest))
	for i := range ps {
		p := &ps[i]
		e, ok := s.devices[p.DeviceID]
		if !ok { // deleted meanwhile
			continue
		}
		touched[p.DeviceID] = e
		if cur := e.dev.Position; cur == nil || p.DeviceTime.After(cur.DeviceTime) {
			e.dev.Position = p
			s.publish(EventPosition, p)
		}
	}
	for _, e := range touched {
		s.touchLocked(e, now)
		s.announceLocked(e, now, false)
	}
	return nil
}

// touchLocked advances the cached last-seen time. Caller holds s.mu.
func (s *Store) touchLocked(e *deviceEntry, t time.Time) {
	if e.dev.LastSeen == nil || t.After(*e.dev.LastSeen) {
		e.dev.LastSeen = &t
	}
}

// Connection implements domain.Sink by recording the contact time.
func (s *Store) Connection(ctx context.Context, imei string, online bool, remoteAddr string) {
	s.mu.RLock()
	id, ok := s.byIMEI[imei]
	s.mu.RUnlock()
	if !ok {
		return
	}
	s.log.Debug("device connection", "id", id, "imei", imei, "online", online, "remote", remoteAddr)
	now := s.opts.Now().UTC()
	// Disconnects are often reported with an already-cancelled session context.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if _, err := s.pool.Exec(ctx, `INSERT INTO device_state AS s (device_id, last_seen) VALUES ($1, $2)
		ON CONFLICT (device_id) DO UPDATE SET last_seen = GREATEST(s.last_seen, EXCLUDED.last_seen)`, id, now); err != nil {
		s.log.Error("update last_seen", "id", id, "err", err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if e, ok := s.devices[id]; ok {
		s.touchLocked(e, now)
		s.announceLocked(e, now, false)
	}
}
