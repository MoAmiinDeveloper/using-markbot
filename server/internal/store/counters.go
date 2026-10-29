package store

import (
	"context"
	"math"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
)

// Counter accumulation rules (see docs/API.md "Phase 3 implementation notes").
const (
	// maxEngineGap is the longest gap between two fixes that still counts
	// as engine time when the ignition was on (longer gaps are data holes).
	maxEngineGap = 15 * time.Minute
	// minJumpDistance counts a segment even when both fixes are slow (e.g.
	// after a tunnel or a data gap); shorter slow segments are GPS drift.
	minJumpDistance = 100.0 // m
	// maxPlausibleSpeed rejects GPS outliers.
	maxPlausibleSpeed = 300.0 // km/h
)

// counters are the per-device accumulators kept in the cache. They are only
// advanced by fixes newer than the cached latest position.
type counters struct {
	gpsDistance     float64          // m
	engineSeconds   float64          // s
	trackerOdometer *float64         // m, last odometer reported by the tracker
	lastFix         *domain.Position // last valid in-order fix (distance origin)
	driverTag       string           // upper-case iButton/RFID tag of the current driver, "" = none
	motionSince     *time.Time       // device time the current moving/idle/stopped state began
	dayKey          string           // local day of dayStartKm (YYYY-MM-DD)
	dayStartKm      float64          // odometerKm() when dayKey began
}

// Motion states derived from a single fix (the live status without offline).
func motionOf(p *domain.Position) string {
	switch {
	case p.Speed > MovingSpeed:
		return StatusMoving
	case ignitionOn(p.Attributes):
		return StatusIdle
	default:
		return StatusStopped
	}
}

// dayKey is the local calendar day of t.
func dayKey(t time.Time, loc *time.Location) string { return t.In(loc).Format(time.DateOnly) }

func (c *counters) init(latest *domain.Position) {
	if latest != nil && validFix(latest) {
		c.lastFix = latest
	}
	if latest != nil {
		c.driverTag = driverTagOf(latest)
	}
}

func (c *counters) odometerKm() float64 {
	if c.trackerOdometer != nil {
		return *c.trackerOdometer / 1000
	}
	return c.gpsDistance / 1000
}

// counterDelta is what one batch adds to a device's counters.
type counterDelta struct {
	distance float64
	seconds  float64
	odometer *float64 // newest tracker odometer in the batch
	lastFix  *domain.Position
	tag      string
	tagSet   bool
	// motionSince is set when the batch changes the moving/idle/stopped state.
	motionSince *time.Time
}

func validFix(p *domain.Position) bool {
	return p.Valid && !(p.Latitude == 0 && p.Longitude == 0)
}

// numAttr reads a numeric attribute regardless of its decoded Go type.
func numAttr(attrs map[string]any, key string) (float64, bool) {
	switch v := attrs[key].(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case int32:
		return float64(v), true
	case uint64:
		return float64(v), true
	case uint32:
		return float64(v), true
	case uint16:
		return float64(v), true
	case uint8:
		return float64(v), true
	case int16:
		return float64(v), true
	case int8:
		return float64(v), true
	}
	return 0, false
}

// driverTagOf returns the normalized driver tag of a fix: the tag when one
// is reported, "" otherwise.
func driverTagOf(p *domain.Position) string {
	if t, ok := p.Attributes[domain.AttrDriverID].(string); ok {
		return NormalizeTag(t)
	}
	return ""
}

// computeDeltas derives the counter increments of a time-sorted batch. prev
// holds the cached latest position and last valid fix of each device; fixes
// not newer than the latest position are ignored (replayed records).
func computeDeltas(ps []domain.Position, latest, lastFix map[int64]*domain.Position) map[int64]*counterDelta {
	out := make(map[int64]*counterDelta)
	for i := range ps {
		p := &ps[i]
		id := p.DeviceID
		prev := latest[id]
		if prev != nil && !p.DeviceTime.After(prev.DeviceTime) {
			continue
		}
		d := out[id]
		if d == nil {
			d = &counterDelta{}
			out[id] = d
		}
		// Engine time: the interval since the previous fix counts when the
		// ignition was on at its start.
		if prev != nil && ignitionOn(prev.Attributes) {
			if gap := p.DeviceTime.Sub(prev.DeviceTime); gap <= maxEngineGap {
				d.seconds += gap.Seconds()
			}
		}
		// GPS distance between consecutive valid fixes, ignoring drift
		// while parked and implausible jumps.
		if validFix(p) {
			if lf := lastFix[id]; lf == nil {
				lastFix[id], d.lastFix = p, p
			} else {
				dist := Haversine(lf.Latitude, lf.Longitude, p.Latitude, p.Longitude)
				dt := p.DeviceTime.Sub(lf.DeviceTime).Hours()
				switch {
				case dt > 0 && dist/1000/dt > maxPlausibleSpeed && dist > minJumpDistance:
					// outlier: keep the previous origin
				case math.Max(lf.Speed, p.Speed) > MovingSpeed || dist >= minJumpDistance:
					d.distance += dist
					lastFix[id], d.lastFix = p, p
				default:
					// parked drift: do not move the origin either, so slow
					// creeping still adds up once it exceeds minJumpDistance
				}
			}
		}
		if odo, ok := numAttr(p.Attributes, domain.AttrOdometer); ok && odo > 0 {
			d.odometer = &odo
		}
		if prev == nil || motionOf(prev) != motionOf(p) {
			t := p.DeviceTime
			d.motionSince = &t
		}
		if tag := driverTagOf(p); tag != "" {
			d.tag, d.tagSet = tag, true
		} else if on, ok := p.Attributes[domain.AttrIgnition].(bool); ok && !on {
			d.tag, d.tagSet = "", true // driver session ends with the ignition
		}
		latest[id] = p
	}
	return out
}

// apply adds a batch delta to the cached counters. Caller holds s.mu.
func (c *counters) apply(d *counterDelta) {
	c.gpsDistance += d.distance
	c.engineSeconds += d.seconds
	if d.odometer != nil {
		v := *d.odometer
		c.trackerOdometer = &v
	}
	if d.lastFix != nil {
		c.lastFix = d.lastFix
	}
	if d.tagSet {
		c.driverTag = d.tag
	}
	if d.motionSince != nil {
		c.motionSince = d.motionSince
	}
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }

// SetDeviceCounters calibrates the displayed odometer (km) and/or engine
// hours: an offset is stored so that the value shown now equals the one
// given; accumulation continues from there.
func (s *Store) SetDeviceCounters(ctx context.Context, id int64, odometerKm, engineHours *float64) (Device, error) {
	if odometerKm == nil && engineHours == nil {
		return s.Device(id)
	}
	if v := odometerKm; v != nil && !(*v >= 0 && *v <= 1e8) {
		return Device{}, invalid("odometer must be between 0 and 100000000 km")
	}
	if v := engineHours; v != nil && !(*v >= 0 && *v <= 1e7) {
		return Device{}, invalid("engineHours must be between 0 and 10000000 h")
	}
	s.mu.RLock()
	e, ok := s.devices[id]
	var odoOff, hoursOff float64
	if ok {
		odoOff, hoursOff = e.dev.odoOffset, e.dev.hoursOffset
		if odometerKm != nil {
			odoOff = *odometerKm - e.odometerKm()
		}
		if engineHours != nil {
			hoursOff = *engineHours - e.engineSeconds/3600
		}
	}
	s.mu.RUnlock()
	if !ok {
		return Device{}, ErrNotFound
	}
	tag, err := s.pool.Exec(ctx, `UPDATE devices SET odometer_offset = $2, engine_hours_offset = $3, updated_at = now()
		WHERE id = $1`, id, odoOff, hoursOff)
	if err != nil {
		return Device{}, err
	}
	if tag.RowsAffected() == 0 {
		return Device{}, ErrNotFound
	}
	now := s.opts.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	if e, ok = s.devices[id]; !ok {
		return Device{}, ErrNotFound
	}
	e.dev.odoOffset, e.dev.hoursOffset = odoOff, hoursOff
	s.announceLocked(e, now, true)
	s.KickUpkeep()
	return s.view(e, now), nil
}

// DeviceCounters returns the current odometer (km) and engine hours of a device.
func (s *Store) DeviceCounters(id int64) (odometerKm, engineHours float64, err error) {
	d, err := s.Device(id)
	return d.Odometer, d.EngineHours, err
}

// UpkeepKicks delivers a signal whenever maintenance or reminder inputs
// changed (items edited, counters calibrated), so the due-check job can run
// right away instead of waiting for its next tick.
func (s *Store) UpkeepKicks() <-chan struct{} { return s.upkeep }

// KickUpkeep requests a due check; it never blocks.
func (s *Store) KickUpkeep() {
	select {
	case s.upkeep <- struct{}{}:
	default:
	}
}

// driverIndex is an immutable snapshot of driver tags and manual
// assignments, used to resolve Device.driverId without a query.
type driverIndex struct {
	byTag    map[string]int64
	byDevice map[int64]int64

	// Phase 4a: driver-app logins.
	byUser      map[int64]int64          // user id -> driver id
	driverUser  map[int64]int64          // driver id -> user id
	driverScope map[int64]map[int64]bool // user id -> visible devices (vehicle + driver-app phone)
}

func (s *Store) reloadDrivers(ctx context.Context) error {
	s.driversMu.Lock()
	defer s.driversMu.Unlock()
	rows, err := s.pool.Query(ctx, `SELECT id, tag, device_id, user_id FROM drivers`)
	if err != nil {
		return err
	}
	idx := &driverIndex{byTag: map[string]int64{}, byDevice: map[int64]int64{},
		byUser: map[int64]int64{}, driverUser: map[int64]int64{}, driverScope: map[int64]map[int64]bool{}}
	for rows.Next() {
		var (
			id     int64
			tag    string
			device *int64
			user   *int64
		)
		if err := rows.Scan(&id, &tag, &device, &user); err != nil {
			rows.Close()
			return err
		}
		if tag = NormalizeTag(tag); tag != "" {
			idx.byTag[tag] = id
		}
		if device != nil {
			idx.byDevice[*device] = id
		}
		if user != nil {
			idx.byUser[*user] = id
			idx.driverUser[id] = *user
			scope := map[int64]bool{}
			if device != nil {
				scope[*device] = true
			}
			if dev, ok := s.deviceIDByIMEI(DriverAppIMEI(id)); ok {
				scope[dev] = true
			}
			idx.driverScope[*user] = scope
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	prev := s.drivers.Swap(idx)
	if prev == nil {
		return nil
	}
	if !driverScopesEqual(prev.driverScope, idx.driverScope) {
		defer s.publish(EventAccess, nil) // live clients re-evaluate their scope
	}
	// Re-announce devices whose current driver may have changed.
	now := s.opts.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, e := range s.devices {
		if !equalPtr(s.driverFrom(prev, id, e.driverTag), s.driverFrom(idx, id, e.driverTag)) {
			s.announceLocked(e, now, true)
		}
	}
	return nil
}

func equalPtr(a, b *int64) bool { return (a == nil) == (b == nil) && (a == nil || *a == *b) }

func (s *Store) driverFrom(idx *driverIndex, deviceID int64, tag string) *int64 {
	if idx == nil {
		return nil
	}
	if tag != "" {
		if id, ok := idx.byTag[tag]; ok {
			return &id
		}
	}
	if id, ok := idx.byDevice[deviceID]; ok {
		return &id
	}
	return nil
}

// currentDriver resolves the driver of a device: a known tag reported by the
// tracker wins, else the manually assigned driver.
func (s *Store) currentDriver(deviceID int64, tag string) *int64 {
	return s.driverFrom(s.drivers.Load(), deviceID, tag)
}

// DriverForPosition resolves the driver of a historical fix: tag match, else
// the driver currently assigned to the device. Returns 0 when unknown.
func (s *Store) DriverForPosition(p *domain.Position) int64 {
	if id := s.driverFrom(s.drivers.Load(), p.DeviceID, driverTagOf(p)); id != nil {
		return *id
	}
	return 0
}

func driverScopesEqual(a, b map[int64]map[int64]bool) bool {
	if len(a) != len(b) {
		return false
	}
	for u, sa := range a {
		sb, ok := b[u]
		if !ok || len(sa) != len(sb) {
			return false
		}
		for d := range sa {
			if !sb[d] {
				return false
			}
		}
	}
	return true
}

// driverScope returns the devices a driver-role user may see: the vehicle
// assigned to their driver and their driver-app phone (shared map).
func (s *Store) driverScope(userID int64) map[int64]bool {
	if idx := s.drivers.Load(); idx != nil {
		if sc := idx.driverScope[userID]; sc != nil {
			return sc
		}
	}
	return emptyScope
}

// DriverIDForUser returns the driver linked to a login (0 when none).
func (s *Store) DriverIDForUser(userID int64) int64 {
	if idx := s.drivers.Load(); idx != nil {
		return idx.byUser[userID]
	}
	return 0
}

// UserIDForDriver returns the login linked to a driver (0 when none).
func (s *Store) UserIDForDriver(driverID int64) int64 {
	if idx := s.drivers.Load(); idx != nil {
		return idx.driverUser[driverID]
	}
	return 0
}

// AssignedDevice returns the vehicle manually assigned to a driver (0 when none).
func (s *Store) AssignedDevice(driverID int64) int64 {
	if idx := s.drivers.Load(); idx != nil {
		for dev, d := range idx.byDevice {
			if d == driverID {
				return dev
			}
		}
	}
	return 0
}

func (s *Store) deviceIDByIMEI(imei string) (int64, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	id, ok := s.byIMEI[imei]
	return id, ok
}
