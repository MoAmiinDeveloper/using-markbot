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

// The counters ($5 distance, $6 engine seconds, $7 tracker odometer) are
// increments computed from the in-order fixes of the batch.
const upsertStateSQL = `INSERT INTO device_state AS s (device_id, position_time, position, last_seen,
	gps_distance, engine_seconds, tracker_odometer)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (device_id) DO UPDATE SET
	last_seen     = GREATEST(s.last_seen, EXCLUDED.last_seen),
	position      = CASE WHEN s.position_time IS NULL OR EXCLUDED.position_time > s.position_time
	                     THEN EXCLUDED.position ELSE s.position END,
	position_time = GREATEST(s.position_time, EXCLUDED.position_time),
	gps_distance     = s.gps_distance + EXCLUDED.gps_distance,
	engine_seconds   = s.engine_seconds + EXCLUDED.engine_seconds,
	tracker_odometer = COALESCE(EXCLUDED.tracker_odometer, s.tracker_odometer)`

const insertPositionSQL = `INSERT INTO positions (device_id, device_time, server_time, lat, lng, altitude,
	speed, course, satellites, valid, priority, event_id, attributes)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
ON CONFLICT (device_id, device_time) DO NOTHING`

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

	// Odometer / engine-hour increments from fixes newer than the cache.
	latest := make(map[int64]*domain.Position, len(newest))
	lastFix := make(map[int64]*domain.Position, len(newest))
	s.mu.RLock()
	for id := range newest {
		if e, ok := s.devices[id]; ok {
			latest[id], lastFix[id] = e.dev.Position, e.lastFix
		}
	}
	s.mu.RUnlock()
	deltas := computeDeltas(ps, latest, lastFix)

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
		var dist, secs float64
		var odo *float64
		if d := deltas[id]; d != nil {
			dist, secs, odo = d.distance, d.seconds, d.odometer
		}
		b.Queue(upsertStateSQL, id, p.DeviceTime, js, now, dist, secs, odo)
	}
	// Resent records hit the unique key and are skipped; inserted marks the rest.
	inserted := make([]bool, len(ps))
	br := s.pool.SendBatch(ctx, b)
	for i := range ps {
		tag, err := br.Exec()
		if err != nil {
			br.Close()
			return fmt.Errorf("store positions: %w", err)
		}
		inserted[i] = tag.RowsAffected() == 1
	}
	if err := br.Close(); err != nil {
		return fmt.Errorf("store positions: %w", err)
	}

	s.updateCache(ps, newest, deltas, now)

	if s.hooks.Positions != nil {
		fresh := make([]domain.Position, 0, len(ps))
		for i := range ps {
			if inserted[i] {
				fresh = append(fresh, ps[i])
			}
		}
		if len(fresh) > 0 {
			s.hooks.Positions(ctx, fresh)
		}
	}
	return nil
}

// updateCache advances the cached latest positions and publishes live updates.
func (s *Store) updateCache(ps []domain.Position, newest map[int64]*domain.Position, deltas map[int64]*counterDelta, now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, d := range deltas {
		if e, ok := s.devices[id]; ok {
			e.counters.apply(d)
		}
	}
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
}

// touchLocked advances the cached last-seen time. Caller holds s.mu.
func (s *Store) touchLocked(e *deviceEntry, t time.Time) {
	if e.dev.LastSeen == nil || t.After(*e.dev.LastSeen) {
		e.dev.LastSeen = &t
	}
}

// Connection implements domain.Sink by recording the contact time and
// tracking open sessions (which decide whether commands can be sent).
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
	if e, ok := s.devices[id]; ok {
		if online {
			e.conns++
		} else {
			e.conns = max(0, e.conns-1)
		}
		s.touchLocked(e, now)
		s.announceLocked(e, now, false)
	}
	s.mu.Unlock()
	if online && s.hooks.Connected != nil {
		s.hooks.Connected(ctx, id, imei)
	}
}
