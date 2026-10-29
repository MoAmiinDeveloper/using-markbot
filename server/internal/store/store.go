// Package store persists devices, users and positions in PostgreSQL and keeps
// the latest state of every device in memory, so listing devices and
// computing live status never hits the database.
//
// Store implements domain.Sink: the gateway hands decoded positions to it,
// it writes them in one round trip and then publishes live events.
package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
)

// Errors returned by the store.
var (
	ErrNotFound           = errors.New("not found")
	ErrDuplicateIMEI      = errors.New("a device with this IMEI already exists")
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrUnknownDevice      = errors.New("unknown device")
)

// Device statuses, see docs/API.md.
const (
	StatusMoving  = "moving"
	StatusIdle    = "idle"
	StatusStopped = "stopped"
	StatusOffline = "offline"
	StatusNever   = "never"
)

// MovingSpeed is the speed (km/h) above which a vehicle counts as moving.
const MovingSpeed = 3.0

// Live event types published to the hub.
const (
	EventPosition = "position"
	EventDevice   = "device"
	EventDeleted  = "deleted"
)

// Device sources: connected to our gateway, or bridged from a Traccar server.
const (
	SourceDirect  = "direct"
	SourceTraccar = "traccar"
)

// Publisher receives live events. *hub.Hub implements it. Publish must not block.
type Publisher interface {
	Publish(msgType string, data any)
}

// Options configures a Store.
type Options struct {
	// AutoRegister creates devices for unknown IMEIs on first connection.
	AutoRegister bool
	// OfflineAfter is how long without messages before a device is offline.
	// Defaults to 10 minutes.
	OfflineAfter time.Duration
	// Publisher receives live events; nil disables publishing.
	Publisher Publisher
	Logger    *slog.Logger
	// Now overrides the clock (tests).
	Now func() time.Time
	// Location decides where "today" starts for TodayKm. Defaults to time.Local.
	Location *time.Location
}

// Device is the API representation of a tracker together with its live state.
type Device struct {
	ID         int64            `json:"id"`
	Name       string           `json:"name"`
	IMEI       string           `json:"imei"`
	Protocol   string           `json:"protocol"`
	Plate      string           `json:"plate"`
	Model      string           `json:"model"`
	Category   string           `json:"category"`
	Phone      string           `json:"phone"`
	SpeedLimit float64          `json:"speedLimit"` // km/h, 0 = global default from Settings
	Source     string           `json:"source"`     // direct | traccar
	Commands   bool             `json:"commands"`   // can receive commands now (direct, connected over TCP)
	Status     string           `json:"status"`
	LastSeen   *time.Time       `json:"lastSeen"`
	Position   *domain.Position `json:"position"`
	CreatedAt  time.Time        `json:"createdAt"`
	UpdatedAt  time.Time        `json:"updatedAt"`

	// Phase 3 (management module).
	GroupIDs    []int64 `json:"groupIds"`
	Odometer    float64 `json:"odometer"`    // km: tracker odometer if reported, else GPS distance; plus calibration offset
	EngineHours float64 `json:"engineHours"` // h with ignition on, plus calibration offset
	DriverID    *int64  `json:"driverId"`    // current driver (iButton tag match, else manual assignment)

	// Phase 4a (automation module): latest calibrated sensor values.
	Sensors []SensorValue `json:"sensors"`

	// Activity: start of the current status (moving/idle/stopped: from the
	// fixes; offline: last contact) and distance driven today.
	StatusSince *time.Time `json:"statusSince"`
	TodayKm     float64    `json:"todayKm"`

	// Full registration: map icon ('' = status arrow) and vehicle/SIM/owner details.
	Icon    string        `json:"icon"`
	Details DeviceDetails `json:"details"`

	odoOffset   float64 // km, devices.odometer_offset
	hoursOffset float64 // h, devices.engine_hours_offset
}

// ScopeDeviceID lets the live hub filter device messages per client.
func (d Device) ScopeDeviceID() int64 { return d.ID }

// deviceEntry is the cached state of one device. Positions referenced from
// the cache are never mutated after insertion, so they can be shared.
type deviceEntry struct {
	dev          Device // Status and Commands are ignored; computed on read
	conns        int    // open TCP sessions (a reconnect briefly overlaps the old one)
	lastStatus   string // last status announced to the hub
	lastCommands bool   // last Commands value announced to the hub

	counters // odometer / engine-hour accumulators and current driver tag
}

// Store is the PostgreSQL-backed repository and domain.Sink. It is safe for
// concurrent use.
type Store struct {
	pool *pgxpool.Pool
	opts Options
	log  *slog.Logger

	hooks Hooks

	mu      sync.RWMutex
	devices map[int64]*deviceEntry
	byIMEI  map[string]int64

	geofences atomic.Pointer[[]Geofence] // immutable snapshot, swapped on change

	access    atomic.Pointer[accessSnapshot] // users, groups, memberships
	accessMu  sync.Mutex                     // serializes access reloads
	drivers   atomic.Pointer[driverIndex]    // driver tags and manual assignments
	driversMu sync.Mutex                     // serializes driver index reloads
	upkeep    chan struct{}                  // kicked when maintenance/reminder inputs change

	settingsMu sync.RWMutex
	settings   Settings

	sensorCache sensorCache // sensor definitions per device + latest readings

	params       paramCache       // mapped / calculated parameter definitions
	customEvents customEventCache // custom event definitions
}

// Hooks lets services observe ingest. Callbacks run synchronously on the
// ingest path and must return quickly.
type Hooks struct {
	// Positions receives the fixes of one batch that were newly stored
	// (resent duplicates are skipped), sorted by device time.
	Positions func(ctx context.Context, ps []domain.Position)
	// Connected is called when a device opens a TCP session.
	Connected func(ctx context.Context, deviceID int64, imei string)
}

// SetHooks installs ingest observers. Call it before ingest starts.
func (s *Store) SetHooks(h Hooks) { s.hooks = h }

var _ domain.Sink = (*Store)(nil)

// New runs pending migrations and loads the device cache.
func New(ctx context.Context, pool *pgxpool.Pool, opts Options) (*Store, error) {
	if opts.OfflineAfter <= 0 {
		opts.OfflineAfter = 10 * time.Minute
	}
	if opts.Logger == nil {
		opts.Logger = slog.New(slog.DiscardHandler)
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	if opts.Location == nil {
		opts.Location = time.Local
	}
	if err := Migrate(ctx, pool); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	s := &Store{
		pool:    pool,
		opts:    opts,
		log:     opts.Logger,
		devices: make(map[int64]*deviceEntry),
		byIMEI:  make(map[string]int64),
		upkeep:  make(chan struct{}, 1),
	}
	if err := s.reloadAccess(ctx); err != nil {
		return nil, fmt.Errorf("load access: %w", err)
	}
	if err := s.reloadDrivers(ctx); err != nil {
		return nil, fmt.Errorf("load drivers: %w", err)
	}
	if err := s.loadCache(ctx); err != nil {
		return nil, fmt.Errorf("load devices: %w", err)
	}
	if err := s.loadGeofences(ctx); err != nil {
		return nil, fmt.Errorf("load geofences: %w", err)
	}
	if err := s.loadSettings(ctx); err != nil {
		return nil, fmt.Errorf("load settings: %w", err)
	}
	if err := s.loadSensors(ctx, true); err != nil {
		return nil, fmt.Errorf("load sensors: %w", err)
	}
	if err := s.loadParams(ctx); err != nil {
		return nil, fmt.Errorf("load parameters: %w", err)
	}
	if err := s.loadCustomEvents(ctx); err != nil {
		return nil, fmt.Errorf("load custom events: %w", err)
	}
	return s, nil
}

const deviceColumns = `d.id, d.name, d.imei, d.protocol, d.plate, d.model, d.category, d.phone,
	d.speed_limit, d.source, d.created_at, d.updated_at, d.odometer_offset, d.engine_hours_offset, d.icon, d.details`

func scanDevice(row pgx.Row, extra ...any) (Device, error) {
	var d Device
	dst := append([]any{&d.ID, &d.Name, &d.IMEI, &d.Protocol, &d.Plate, &d.Model, &d.Category, &d.Phone, &d.SpeedLimit, &d.Source, &d.CreatedAt, &d.UpdatedAt, &d.odoOffset, &d.hoursOffset, &d.Icon, &d.Details}, extra...)
	if err := row.Scan(dst...); err != nil {
		return d, err
	}
	d.CreatedAt, d.UpdatedAt = d.CreatedAt.UTC(), d.UpdatedAt.UTC()
	return d, nil
}

func (s *Store) loadCache(ctx context.Context) error {
	rows, err := s.pool.Query(ctx, `SELECT `+deviceColumns+`, s.position, s.last_seen,
			COALESCE(s.gps_distance, 0), COALESCE(s.engine_seconds, 0), s.tracker_odometer,
			s.motion_since, COALESCE(s.day_key, ''), COALESCE(s.day_start_km, 0)
		FROM devices d LEFT JOIN device_state s ON s.device_id = d.id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	now := s.opts.Now()
	for rows.Next() {
		var (
			posJSON  []byte
			lastSeen *time.Time
			c        counters
		)
		var motionSince *time.Time
		d, err := scanDevice(rows, &posJSON, &lastSeen, &c.gpsDistance, &c.engineSeconds, &c.trackerOdometer,
			&motionSince, &c.dayKey, &c.dayStartKm)
		if err != nil {
			return err
		}
		if lastSeen != nil {
			t := lastSeen.UTC()
			d.LastSeen = &t
		}
		if len(posJSON) > 0 {
			var p domain.Position
			if err := json.Unmarshal(posJSON, &p); err != nil {
				return fmt.Errorf("device %d state: %w", d.ID, err)
			}
			d.Position = &p
		}
		c.init(d.Position)
		if motionSince != nil {
			t := motionSince.UTC()
			c.motionSince = &t
		} else if d.Position != nil {
			t := d.Position.DeviceTime
			c.motionSince = &t
		}
		e := &deviceEntry{dev: d, counters: c}
		e.lastStatus = s.status(&e.dev, now)
		s.devices[d.ID] = e
		s.byIMEI[d.IMEI] = d.ID
	}
	return rows.Err()
}

// Ping checks database connectivity.
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

// status derives the live status of d at time now.
func (s *Store) status(d *Device, now time.Time) string {
	switch {
	case d.Position == nil:
		return StatusNever
	case d.LastSeen == nil || now.Sub(*d.LastSeen) > s.opts.OfflineAfter:
		return StatusOffline
	case d.Position.Speed > MovingSpeed:
		return StatusMoving
	case ignitionOn(d.Position.Attributes):
		return StatusIdle
	default:
		return StatusStopped
	}
}

func ignitionOn(attrs map[string]any) bool {
	on, _ := attrs[domain.AttrIgnition].(bool)
	return on
}

// view returns a copy of e with its status computed. Caller holds s.mu.
func (s *Store) view(e *deviceEntry, now time.Time) Device {
	d := e.dev
	d.Status = s.status(&d, now)
	d.Commands = d.Source == SourceDirect && e.conns > 0
	d.GroupIDs = s.deviceGroupIDs(d.ID)
	d.Odometer = round1(e.odometerKm() + d.odoOffset)
	d.EngineHours = round1(e.engineSeconds/3600 + d.hoursOffset)
	d.DriverID = s.currentDriver(d.ID, e.driverTag)
	d.Sensors = s.deviceSensorValues(d.ID)
	switch d.Status {
	case StatusOffline:
		d.StatusSince = d.LastSeen
	case StatusMoving, StatusIdle, StatusStopped:
		d.StatusSince = e.motionSince
	}
	if e.dayKey != "" && e.dayKey == dayKey(now, s.opts.Location) {
		if km := e.odometerKm() - e.dayStartKm; km > 0 && km <= maxDayKm {
			d.TodayKm = round1(km)
		}
	}
	return d
}

// publish forwards an event to the publisher, if any.
func (s *Store) publish(msgType string, data any) {
	if s.opts.Publisher != nil {
		s.opts.Publisher.Publish(msgType, data)
	}
}

// Devices returns all devices ordered by name (then id).
func (s *Store) Devices() []Device { return s.DevicesScoped(true, nil) }

// DevicesScoped returns the devices in a scope (see DeviceScope) ordered by
// name (then id).
func (s *Store) DevicesScoped(all bool, ids map[int64]bool) []Device {
	now := s.opts.Now()
	s.mu.RLock()
	out := make([]Device, 0, len(s.devices))
	for id, e := range s.devices {
		if all || ids[id] {
			out = append(out, s.view(e, now))
		}
	}
	s.mu.RUnlock()
	sort.Slice(out, func(i, j int) bool {
		a, b := strings.ToLower(out[i].Name), strings.ToLower(out[j].Name)
		if a != b {
			return a < b
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// Device returns one device or ErrNotFound.
func (s *Store) Device(id int64) (Device, error) {
	now := s.opts.Now()
	s.mu.RLock()
	defer s.mu.RUnlock()
	e, ok := s.devices[id]
	if !ok {
		return Device{}, ErrNotFound
	}
	return s.view(e, now), nil
}

// Summary counts devices per status.
type Summary struct {
	Total   int `json:"total"`
	Moving  int `json:"moving"`
	Idle    int `json:"idle"`
	Stopped int `json:"stopped"`
	Offline int `json:"offline"`
	Never   int `json:"never"`
}

// Summary returns fleet-wide status counts.
func (s *Store) Summary() Summary { return s.SummaryScoped(true, nil) }

// SummaryScoped counts the devices in a scope per status.
func (s *Store) SummaryScoped(all bool, ids map[int64]bool) Summary {
	now := s.opts.Now()
	s.mu.RLock()
	defer s.mu.RUnlock()
	var sum Summary
	for id, e := range s.devices {
		if !all && !ids[id] {
			continue
		}
		sum.Total++
		switch s.status(&e.dev, now) {
		case StatusMoving:
			sum.Moving++
		case StatusIdle:
			sum.Idle++
		case StatusStopped:
			sum.Stopped++
		case StatusOffline:
			sum.Offline++
		default:
			sum.Never++
		}
	}
	return sum
}

// Run periodically re-evaluates statuses so time-based transitions (going
// offline) are pushed to live clients. It blocks until ctx is done.
func (s *Store) Run(ctx context.Context) {
	interval := min(s.opts.OfflineAfter/4, 15*time.Second)
	t := time.NewTicker(max(interval, time.Second))
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.announceStatusChanges()
		}
	}
}

func (s *Store) announceStatusChanges() {
	now := s.opts.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.devices {
		s.announceLocked(e, now, false)
	}
}

// announceLocked publishes e as a "device" event when force is set or its
// status or command availability changed since the last announcement. Events are published while
// s.mu is held so their order always matches the cache (Publish never blocks).
func (s *Store) announceLocked(e *deviceEntry, now time.Time, force bool) {
	d := s.view(e, now)
	if force || d.Status != e.lastStatus || d.Commands != e.lastCommands {
		e.lastStatus, e.lastCommands = d.Status, d.Commands
		s.publish(EventDevice, d)
	}
}
