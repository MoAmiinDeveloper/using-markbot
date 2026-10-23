package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
)

// Sensor types.
const (
	SensorFuel        = "fuel"
	SensorTemperature = "temperature"
	SensorHumidity    = "humidity"
	SensorVoltage     = "voltage"
	SensorGeneric     = "generic"
)

// SensorTypes lists the sensor types.
var SensorTypes = []string{SensorFuel, SensorTemperature, SensorHumidity, SensorVoltage, SensorGeneric}

// Sensor defaults.
const (
	DefaultFuelDropThreshold = 8.0  // L
	DefaultFuelFillThreshold = 10.0 // L
	DefaultFuelSmoothing     = 5    // fixes
	MaxSmoothing             = 50
	maxCalibrationPoints     = 200
)

// SensorInput holds the user-editable sensor fields (POST body).
type SensorInput struct {
	DeviceID          int64        `json:"deviceId"`
	Name              string       `json:"name"`
	Type              string       `json:"type"`
	Source            string       `json:"source"`
	Calibration       [][2]float64 `json:"calibration"`
	Multiplier        *float64     `json:"multiplier"`
	Offset            float64      `json:"offset"`
	Unit              *string      `json:"unit"`
	Decimals          *int         `json:"decimals"`
	Min               *float64     `json:"min"`
	Max               *float64     `json:"max"`
	TankCapacity      *float64     `json:"tankCapacity"`
	FuelDropThreshold *float64     `json:"fuelDropThreshold"`
	FuelFillThreshold *float64     `json:"fuelFillThreshold"`
	Smoothing         int          `json:"smoothing"`
}

// Sensor is a calibrated value derived from a position attribute.
type Sensor struct {
	ID                int64        `json:"id"`
	DeviceID          int64        `json:"deviceId"`
	Name              string       `json:"name"`
	Type              string       `json:"type"`
	Source            string       `json:"source"`
	Calibration       [][2]float64 `json:"calibration"`
	Multiplier        float64      `json:"multiplier"`
	Offset            float64      `json:"offset"`
	Unit              string       `json:"unit"`
	Decimals          int          `json:"decimals"`
	Min               *float64     `json:"min"`
	Max               *float64     `json:"max"`
	TankCapacity      *float64     `json:"tankCapacity"`
	FuelDropThreshold *float64     `json:"fuelDropThreshold"`
	FuelFillThreshold *float64     `json:"fuelFillThreshold"`
	Smoothing         int          `json:"smoothing"`
	CreatedAt         time.Time    `json:"createdAt"`
}

// Input returns the editable fields of s (for merge-style updates).
func (s Sensor) Input() SensorInput {
	m := s.Multiplier
	u := s.Unit
	d := s.Decimals
	return SensorInput{DeviceID: s.DeviceID, Name: s.Name, Type: s.Type, Source: s.Source,
		Calibration: s.Calibration, Multiplier: &m, Offset: s.Offset, Unit: &u, Decimals: &d,
		Min: s.Min, Max: s.Max, TankCapacity: s.TankCapacity, FuelDropThreshold: s.FuelDropThreshold,
		FuelFillThreshold: s.FuelFillThreshold, Smoothing: s.Smoothing}
}

// DropThreshold is the fuel drain threshold in liters (default applied).
func (s *Sensor) DropThreshold() float64 {
	if s.FuelDropThreshold != nil && *s.FuelDropThreshold > 0 {
		return *s.FuelDropThreshold
	}
	return DefaultFuelDropThreshold
}

// FillThreshold is the refuel threshold in liters (default applied).
func (s *Sensor) FillThreshold() float64 {
	if s.FuelFillThreshold != nil && *s.FuelFillThreshold > 0 {
		return *s.FuelFillThreshold
	}
	return DefaultFuelFillThreshold
}

var sourcePattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{0,63}$`)

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

func finitePtr(v *float64) bool { return v == nil || finite(*v) }

// defaultUnit is the unit used when none was given.
func defaultUnit(typ string) string {
	switch typ {
	case SensorFuel:
		return "L"
	case SensorTemperature:
		return "°C"
	case SensorHumidity:
		return "%"
	case SensorVoltage:
		return "V"
	}
	return ""
}

// normalize validates in and returns the sensor it describes.
func (in *SensorInput) normalize() (Sensor, error) {
	s := Sensor{DeviceID: in.DeviceID, Name: strings.TrimSpace(in.Name), Type: strings.TrimSpace(in.Type),
		Source: strings.TrimSpace(in.Source), Offset: in.Offset, Min: in.Min, Max: in.Max,
		TankCapacity: in.TankCapacity, FuelDropThreshold: in.FuelDropThreshold, FuelFillThreshold: in.FuelFillThreshold,
		Smoothing: in.Smoothing, Multiplier: 1, Decimals: 1}
	switch {
	case s.DeviceID <= 0:
		return s, invalid("deviceId is required")
	case s.Name == "":
		return s, invalid("name is required")
	case utf8.RuneCountInString(s.Name) > 100:
		return s, invalid("name must be at most 100 characters")
	case !slices.Contains(SensorTypes, s.Type):
		return s, invalid("type must be one of: %s", strings.Join(SensorTypes, ", "))
	case !sourcePattern.MatchString(s.Source):
		return s, invalid("source must be a position attribute key such as io9, fuel or power")
	}
	if in.Multiplier != nil {
		s.Multiplier = *in.Multiplier
	}
	if in.Decimals != nil {
		s.Decimals = *in.Decimals
	}
	if in.Unit != nil {
		s.Unit = strings.TrimSpace(*in.Unit)
	} else {
		s.Unit = defaultUnit(s.Type)
	}
	switch {
	case !finite(s.Multiplier) || !finite(s.Offset):
		return s, invalid("multiplier and offset must be numbers")
	case utf8.RuneCountInString(s.Unit) > 16:
		return s, invalid("unit must be at most 16 characters")
	case s.Decimals < 0 || s.Decimals > 6:
		return s, invalid("decimals must be between 0 and 6")
	case !finitePtr(s.Min) || !finitePtr(s.Max):
		return s, invalid("min and max must be numbers or null")
	case s.Min != nil && s.Max != nil && *s.Min >= *s.Max:
		return s, invalid("min must be less than max")
	case s.TankCapacity != nil && !(*s.TankCapacity > 0 && finite(*s.TankCapacity)):
		return s, invalid("tankCapacity must be a positive number or null")
	case s.FuelDropThreshold != nil && !(*s.FuelDropThreshold > 0 && finite(*s.FuelDropThreshold)):
		return s, invalid("fuelDropThreshold must be a positive number or null")
	case s.FuelFillThreshold != nil && !(*s.FuelFillThreshold > 0 && finite(*s.FuelFillThreshold)):
		return s, invalid("fuelFillThreshold must be a positive number or null")
	case s.Smoothing < 0 || s.Smoothing > MaxSmoothing:
		return s, invalid("smoothing must be between 1 and %d fixes", MaxSmoothing)
	}
	if s.Smoothing == 0 {
		s.Smoothing = 1
		if s.Type == SensorFuel {
			s.Smoothing = DefaultFuelSmoothing
		}
	}
	if s.Type == SensorFuel {
		if s.FuelDropThreshold == nil {
			v := DefaultFuelDropThreshold
			s.FuelDropThreshold = &v
		}
		if s.FuelFillThreshold == nil {
			v := DefaultFuelFillThreshold
			s.FuelFillThreshold = &v
		}
	}
	cal := slices.Clone(in.Calibration)
	if len(cal) > maxCalibrationPoints {
		return s, invalid("calibration must have at most %d points", maxCalibrationPoints)
	}
	if len(cal) == 1 {
		return s, invalid("calibration needs at least 2 points (or none to use multiplier/offset)")
	}
	for _, p := range cal {
		if !finite(p[0]) || !finite(p[1]) {
			return s, invalid("calibration points must be [raw, value] number pairs")
		}
	}
	sort.SliceStable(cal, func(i, j int) bool { return cal[i][0] < cal[j][0] })
	for i := 1; i < len(cal); i++ {
		if cal[i][0] == cal[i-1][0] {
			return s, invalid("calibration raw values must be distinct")
		}
	}
	if cal == nil {
		cal = [][2]float64{}
	}
	s.Calibration = cal
	return s, nil
}

// ---- cache ----

// SensorReading is the latest computed value of a sensor.
type SensorReading struct {
	Value float64
	Time  time.Time
}

// SensorValue is a sensor's latest value as shown on Device.sensors.
type SensorValue struct {
	ID    int64      `json:"id"`
	Name  string     `json:"name"`
	Type  string     `json:"type"`
	Value *float64   `json:"value"` // rounded to the sensor's decimals; null until known
	Unit  string     `json:"unit"`
	Time  *time.Time `json:"time"`
}

// sensorCache holds the sensor definitions per device and latest readings.
type sensorCache struct {
	mu       sync.RWMutex
	byDevice map[int64][]Sensor
	readings map[int64]SensorReading
}

// RoundTo rounds v to d decimals.
func RoundTo(v float64, d int) float64 {
	p := math.Pow(10, float64(d))
	return math.Round(v*p) / p
}

// deviceSensorValues returns the Device.sensors array (never nil).
func (s *Store) deviceSensorValues(deviceID int64) []SensorValue {
	c := &s.sensorCache
	c.mu.RLock()
	defer c.mu.RUnlock()
	list := c.byDevice[deviceID]
	out := make([]SensorValue, 0, len(list))
	for i := range list {
		sn := &list[i]
		v := SensorValue{ID: sn.ID, Name: sn.Name, Type: sn.Type, Unit: sn.Unit}
		if r, ok := c.readings[sn.ID]; ok {
			val := RoundTo(r.Value, sn.Decimals)
			t := r.Time
			v.Value, v.Time = &val, &t
		}
		out = append(out, v)
	}
	return out
}

// DeviceSensors returns the sensors of a device from the cache (shared,
// do not modify).
func (s *Store) DeviceSensors(deviceID int64) []Sensor {
	s.sensorCache.mu.RLock()
	defer s.sensorCache.mu.RUnlock()
	return s.sensorCache.byDevice[deviceID]
}

// SetSensorReadings records the latest values of a device's sensors and
// re-announces the device when a displayed value changed.
func (s *Store) SetSensorReadings(deviceID int64, rs map[int64]SensorReading) {
	if len(rs) == 0 {
		return
	}
	c := &s.sensorCache
	changed := false
	c.mu.Lock()
	dec := map[int64]int{}
	for _, sn := range c.byDevice[deviceID] {
		dec[sn.ID] = sn.Decimals
	}
	for id, r := range rs {
		d, ok := dec[id]
		if !ok {
			continue // deleted meanwhile
		}
		old, had := c.readings[id]
		if !had || RoundTo(old.Value, d) != RoundTo(r.Value, d) {
			changed = true
		}
		if !had || !r.Time.Before(old.Time) {
			c.readings[id] = r
		}
	}
	c.mu.Unlock()
	if changed {
		s.announceDevice(deviceID)
	}
}

// announceDevice publishes the device's current view.
func (s *Store) announceDevice(deviceID int64) {
	now := s.opts.Now()
	s.mu.Lock()
	if e, ok := s.devices[deviceID]; ok {
		s.announceLocked(e, now, true)
	}
	s.mu.Unlock()
}

const sensorColumns = `id, device_id, name, type, source, calibration, multiplier, "offset", unit, decimals,
	min_value, max_value, tank_capacity, fuel_drop_threshold, fuel_fill_threshold, smoothing, created_at`

func scanSensor(row pgx.Row) (Sensor, error) {
	var s Sensor
	err := row.Scan(&s.ID, &s.DeviceID, &s.Name, &s.Type, &s.Source, &s.Calibration, &s.Multiplier, &s.Offset,
		&s.Unit, &s.Decimals, &s.Min, &s.Max, &s.TankCapacity, &s.FuelDropThreshold, &s.FuelFillThreshold,
		&s.Smoothing, &s.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, ErrNotFound
	}
	s.CreatedAt = s.CreatedAt.UTC()
	if s.Calibration == nil {
		s.Calibration = [][2]float64{}
	}
	return s, err
}

// loadSensors (re)builds the sensor cache; readings are loaded on first call.
func (s *Store) loadSensors(ctx context.Context, withReadings bool) error {
	rows, err := s.pool.Query(ctx, `SELECT `+sensorColumns+` FROM sensors ORDER BY device_id, lower(name), id`)
	if err != nil {
		return err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Sensor, error) { return scanSensor(r) })
	if err != nil {
		return err
	}
	byDevice := map[int64][]Sensor{}
	ids := map[int64]bool{}
	for _, sn := range list {
		byDevice[sn.DeviceID] = append(byDevice[sn.DeviceID], sn)
		ids[sn.ID] = true
	}
	var readings map[int64]SensorReading
	if withReadings {
		readings = map[int64]SensorReading{}
		rows, err := s.pool.Query(ctx, `SELECT sensor_id, value, time FROM sensor_state WHERE value IS NOT NULL AND time IS NOT NULL`)
		if err != nil {
			return err
		}
		for rows.Next() {
			var (
				id int64
				r  SensorReading
			)
			if err := rows.Scan(&id, &r.Value, &r.Time); err != nil {
				rows.Close()
				return err
			}
			r.Time = r.Time.UTC()
			readings[id] = r
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
	}
	c := &s.sensorCache
	c.mu.Lock()
	c.byDevice = byDevice
	if readings != nil {
		c.readings = readings
	}
	if c.readings == nil {
		c.readings = map[int64]SensorReading{}
	}
	for id := range c.readings {
		if !ids[id] {
			delete(c.readings, id)
		}
	}
	c.mu.Unlock()
	return nil
}

// reloadSensors refreshes the cache after a change and re-announces device.
func (s *Store) reloadSensors(ctx context.Context, deviceIDs ...int64) {
	if err := s.loadSensors(ctx, false); err != nil {
		s.log.Error("reload sensors", "err", err)
	}
	for _, id := range deviceIDs {
		s.announceDevice(id)
	}
}

// ResetSensorReading forgets the latest value of a sensor (e.g. after its
// calibration changed) so it is recomputed from the next fix.
func (s *Store) resetSensorReading(ctx context.Context, id int64) error {
	s.sensorCache.mu.Lock()
	delete(s.sensorCache.readings, id)
	s.sensorCache.mu.Unlock()
	_, err := s.pool.Exec(ctx, `DELETE FROM sensor_state WHERE sensor_id = $1`, id)
	return err
}

// Sensors lists sensors, optionally of one device, limited to a scope.
func (s *Store) Sensors(ctx context.Context, deviceID int64, all bool, scope map[int64]bool) ([]Sensor, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+sensorColumns+` FROM sensors
		WHERE ($1 = 0 OR device_id = $1) ORDER BY device_id, lower(name), id`, deviceID)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Sensor, error) { return scanSensor(r) })
	if err != nil {
		return nil, err
	}
	out := []Sensor{}
	for _, sn := range list {
		if all || scope[sn.DeviceID] {
			out = append(out, sn)
		}
	}
	return out, nil
}

// Sensor returns one sensor.
func (s *Store) Sensor(ctx context.Context, id int64) (Sensor, error) {
	return scanSensor(s.pool.QueryRow(ctx, `SELECT `+sensorColumns+` FROM sensors WHERE id = $1`, id))
}

func calibrationJSON(c [][2]float64) []byte {
	b, _ := json.Marshal(c)
	return b
}

// CreateSensor validates and stores a sensor.
func (s *Store) CreateSensor(ctx context.Context, in SensorInput) (Sensor, error) {
	sn, err := in.normalize()
	if err != nil {
		return sn, err
	}
	if _, err := s.Device(sn.DeviceID); err != nil {
		return sn, invalid("unknown deviceId")
	}
	sn, err = scanSensor(s.pool.QueryRow(ctx, `INSERT INTO sensors (device_id, name, type, source, calibration,
			multiplier, "offset", unit, decimals, min_value, max_value, tank_capacity, fuel_drop_threshold,
			fuel_fill_threshold, smoothing)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
		RETURNING `+sensorColumns, sn.DeviceID, sn.Name, sn.Type, sn.Source, calibrationJSON(sn.Calibration),
		sn.Multiplier, sn.Offset, sn.Unit, sn.Decimals, sn.Min, sn.Max, sn.TankCapacity, sn.FuelDropThreshold,
		sn.FuelFillThreshold, sn.Smoothing))
	if err != nil {
		return sn, fmt.Errorf("create sensor: %w", err)
	}
	s.reloadSensors(ctx, sn.DeviceID)
	return sn, nil
}

// UpdateSensor replaces the editable fields of a sensor. The latest value
// is reset when the value computation (source, calibration…) changed.
func (s *Store) UpdateSensor(ctx context.Context, id int64, in SensorInput) (Sensor, error) {
	old, err := s.Sensor(ctx, id)
	if err != nil {
		return old, err
	}
	sn, err := in.normalize()
	if err != nil {
		return sn, err
	}
	if _, err := s.Device(sn.DeviceID); err != nil {
		return sn, invalid("unknown deviceId")
	}
	sn, err = scanSensor(s.pool.QueryRow(ctx, `UPDATE sensors SET device_id = $2, name = $3, type = $4, source = $5,
			calibration = $6, multiplier = $7, "offset" = $8, unit = $9, decimals = $10, min_value = $11,
			max_value = $12, tank_capacity = $13, fuel_drop_threshold = $14, fuel_fill_threshold = $15,
			smoothing = $16, updated_at = now()
		WHERE id = $1 RETURNING `+sensorColumns, id, sn.DeviceID, sn.Name, sn.Type, sn.Source,
		calibrationJSON(sn.Calibration), sn.Multiplier, sn.Offset, sn.Unit, sn.Decimals, sn.Min, sn.Max,
		sn.TankCapacity, sn.FuelDropThreshold, sn.FuelFillThreshold, sn.Smoothing))
	if err != nil {
		return sn, err
	}
	if old.DeviceID != sn.DeviceID || old.Source != sn.Source || old.Type != sn.Type ||
		old.Multiplier != sn.Multiplier || old.Offset != sn.Offset || !slices.Equal(old.Calibration, sn.Calibration) {
		if err := s.resetSensorReading(ctx, id); err != nil {
			return sn, err
		}
	}
	s.reloadSensors(ctx, old.DeviceID, sn.DeviceID)
	return sn, nil
}

// DeleteSensor removes a sensor.
func (s *Store) DeleteSensor(ctx context.Context, id int64) error {
	var dev int64
	err := s.pool.QueryRow(ctx, `DELETE FROM sensors WHERE id = $1 RETURNING device_id`, id).Scan(&dev)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	s.reloadSensors(ctx, dev)
	return nil
}

// ---- detector state persistence ----

// SensorStateRow is the persisted state of a sensor.
type SensorStateRow struct {
	SensorID int64
	Value    *float64
	Time     *time.Time
	State    json.RawMessage
}

// SensorStates loads the persisted detector states.
func (s *Store) SensorStates(ctx context.Context) (map[int64]json.RawMessage, error) {
	rows, err := s.pool.Query(ctx, `SELECT sensor_id, state FROM sensor_state`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]json.RawMessage{}
	for rows.Next() {
		var (
			id int64
			st json.RawMessage
		)
		if err := rows.Scan(&id, &st); err != nil {
			return nil, err
		}
		out[id] = st
	}
	return out, rows.Err()
}

// SaveSensorStates upserts states in one round trip; rows of deleted
// sensors are skipped.
func (s *Store) SaveSensorStates(ctx context.Context, rows []SensorStateRow) error {
	if len(rows) == 0 {
		return nil
	}
	b := &pgx.Batch{}
	for _, r := range rows {
		st := r.State
		if len(st) == 0 {
			st = json.RawMessage(`{}`)
		}
		b.Queue(`INSERT INTO sensor_state (sensor_id, value, time, state, updated_at)
			SELECT $1, $2, $3, $4, now() WHERE EXISTS (SELECT 1 FROM sensors WHERE id = $1)
			ON CONFLICT (sensor_id) DO UPDATE SET value = EXCLUDED.value, time = EXCLUDED.time,
				state = EXCLUDED.state, updated_at = now()`, r.SensorID, r.Value, r.Time, st)
	}
	return s.pool.SendBatch(ctx, b).Close()
}

// ---- report streaming ----

// SensorPoint is a fix with the raw values of the requested attributes.
type SensorPoint struct {
	Time     time.Time
	Lat, Lng float64
	Speed    float64
	Ignition *bool
	Attrs    map[string]any
}

// StreamSensorPoints calls fn for every position of a device in [from, to]
// that carries at least one of keys, in time order. fn must not retain p.
func (s *Store) StreamSensorPoints(ctx context.Context, deviceID int64, keys []string, from, to time.Time,
	fn func(p *SensorPoint) error) error {
	rows, err := s.pool.Query(ctx, `SELECT device_time, lat, lng, speed,
			CASE WHEN jsonb_typeof(attributes->'ignition') = 'boolean' THEN (attributes->>'ignition')::boolean END,
			(SELECT jsonb_object_agg(k, attributes->k) FROM unnest($4::text[]) k WHERE attributes ? k)
		FROM positions
		WHERE device_id = $1 AND device_time >= $2 AND device_time <= $3 AND attributes ?| $4::text[]
		ORDER BY device_time`, deviceID, from, to, keys)
	if err != nil {
		return err
	}
	defer rows.Close()
	var p SensorPoint
	for rows.Next() {
		p.Ignition, p.Attrs = nil, nil
		if err := rows.Scan(&p.Time, &p.Lat, &p.Lng, &p.Speed, &p.Ignition, &p.Attrs); err != nil {
			return err
		}
		p.Time = p.Time.UTC()
		if err := fn(&p); err != nil {
			return err
		}
	}
	return rows.Err()
}

// PositionIgnition returns attributes.ignition of p (nil when absent).
func PositionIgnition(p *domain.Position) *bool {
	if v, ok := p.Attributes[domain.AttrIgnition].(bool); ok {
		return &v
	}
	return nil
}
