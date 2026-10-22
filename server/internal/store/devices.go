package store

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Categories lists the allowed device categories.
var Categories = []string{"car", "truck", "van", "bus", "motorcycle", "trailer", "other"}

// Protocols lists the supported tracker protocols.
var Protocols = []string{"teltonika"}

const (
	defaultProtocol = "teltonika"
	defaultCategory = "car"
)

// ValidationError reports invalid user input.
type ValidationError struct{ Msg string }

func (e *ValidationError) Error() string { return e.Msg }

func invalid(format string, args ...any) error {
	return &ValidationError{Msg: fmt.Sprintf(format, args...)}
}

// DeviceInput holds the user-editable device fields.
type DeviceInput struct {
	Name     string `json:"name"`
	IMEI     string `json:"imei"`
	Protocol string `json:"protocol"`
	Plate    string `json:"plate"`
	Model    string `json:"model"`
	Category string `json:"category"`
	Phone    string `json:"phone"`
	// SpeedLimit in km/h, 0 = global default.
	SpeedLimit float64 `json:"speedLimit"`

	source string // existing device's source; bridged devices skip IMEI/protocol rules
}

// DevicePatch is a partial update; nil fields are left unchanged.
type DevicePatch struct {
	Name     *string `json:"name"`
	IMEI     *string `json:"imei"`
	Protocol *string `json:"protocol"`
	Plate    *string `json:"plate"`
	Model    *string `json:"model"`
	Category *string `json:"category"`
	Phone    *string `json:"phone"`

	SpeedLimit *float64 `json:"speedLimit"`
}

func (p DevicePatch) apply(in *DeviceInput) {
	set := func(dst *string, src *string) {
		if src != nil {
			*dst = *src
		}
	}
	set(&in.Name, p.Name)
	set(&in.IMEI, p.IMEI)
	set(&in.Protocol, p.Protocol)
	set(&in.Plate, p.Plate)
	set(&in.Model, p.Model)
	set(&in.Category, p.Category)
	set(&in.Phone, p.Phone)
	if p.SpeedLimit != nil {
		in.SpeedLimit = *p.SpeedLimit
	}
}

// Normalize trims fields, applies defaults and validates the input.
func (in *DeviceInput) Normalize() error {
	for _, f := range []*string{&in.Name, &in.IMEI, &in.Protocol, &in.Plate, &in.Model, &in.Category, &in.Phone} {
		*f = strings.TrimSpace(*f)
	}
	in.Protocol = strings.ToLower(in.Protocol)
	in.Category = strings.ToLower(in.Category)
	bridged := in.source == SourceTraccar
	if in.Protocol == "" {
		in.Protocol = defaultProtocol
	}
	if in.Category == "" {
		in.Category = defaultCategory
	}
	switch {
	case in.Name == "":
		return invalid("name is required")
	case utf8.RuneCountInString(in.Name) > 100:
		return invalid("name must be at most 100 characters")
	case !bridged && !slices.Contains(Protocols, in.Protocol):
		return invalid("protocol must be one of: %s", strings.Join(Protocols, ", "))
	case !slices.Contains(Categories, in.Category):
		return invalid("category must be one of: %s", strings.Join(Categories, ", "))
	case utf8.RuneCountInString(in.Plate) > 32:
		return invalid("plate must be at most 32 characters")
	case utf8.RuneCountInString(in.Model) > 64:
		return invalid("model must be at most 64 characters")
	case utf8.RuneCountInString(in.Phone) > 32:
		return invalid("phone must be at most 32 characters")
	case !(in.SpeedLimit >= 0 && in.SpeedLimit <= 500): // also rejects NaN
		return invalid("speedLimit must be between 0 and 500 km/h")
	}
	if bridged {
		return validateUniqueID(in.IMEI)
	}
	return ValidateIMEI(in.Protocol, in.IMEI)
}

// ValidateIMEI checks an identifier against the rules of protocol.
// Teltonika devices identify with a 15-digit IMEI.
func ValidateIMEI(protocol, imei string) error {
	if imei == "" {
		return invalid("imei is required")
	}
	digits := strings.Trim(imei, "0123456789") == ""
	if protocol == "teltonika" && (len(imei) != 15 || !digits) {
		return invalid("imei must be exactly 15 digits")
	}
	if !digits || len(imei) > 20 {
		return invalid("imei must be up to 20 digits")
	}
	return nil
}

// validateUniqueID checks the identifier of a bridged (Traccar) device, which
// may be any short printable string.
func validateUniqueID(id string) error {
	switch {
	case id == "":
		return invalid("imei is required")
	case len(id) > 64 || strings.ContainsFunc(id, func(r rune) bool { return r < 0x21 || r == 0x7f }):
		return invalid("unique id must be at most 64 printable characters without spaces")
	}
	return nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// CreateDevice validates and inserts a device.
func (s *Store) CreateDevice(ctx context.Context, in DeviceInput) (Device, error) {
	if err := in.Normalize(); err != nil {
		return Device{}, err
	}
	row := s.pool.QueryRow(ctx, `INSERT INTO devices AS d (name, imei, protocol, plate, model, category, phone, speed_limit)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING `+deviceColumns,
		in.Name, in.IMEI, in.Protocol, in.Plate, in.Model, in.Category, in.Phone, in.SpeedLimit)
	d, err := scanDevice(row)
	if isUniqueViolation(err) {
		return Device{}, ErrDuplicateIMEI
	}
	if err != nil {
		return Device{}, err
	}
	return s.cacheNewDevice(d), nil
}

// cacheNewDevice adds d to the cache (unless already present), announces it
// and returns its current view.
func (s *Store) cacheNewDevice(d Device) Device {
	now := s.opts.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.devices[d.ID]
	if !ok {
		e = &deviceEntry{dev: d}
		s.devices[d.ID] = e
		s.byIMEI[d.IMEI] = d.ID
		s.announceLocked(e, now, true)
	}
	return s.view(e, now)
}

// UpdateDevice applies a partial update.
func (s *Store) UpdateDevice(ctx context.Context, id int64, p DevicePatch) (Device, error) {
	cur, err := s.Device(id)
	if err != nil {
		return Device{}, err
	}
	in := DeviceInput{Name: cur.Name, IMEI: cur.IMEI, Protocol: cur.Protocol, Plate: cur.Plate,
		Model: cur.Model, Category: cur.Category, Phone: cur.Phone, SpeedLimit: cur.SpeedLimit, source: cur.Source}
	p.apply(&in)
	if err := in.Normalize(); err != nil {
		return Device{}, err
	}
	row := s.pool.QueryRow(ctx, `UPDATE devices AS d SET name = $2, imei = $3, protocol = $4, plate = $5,
			model = $6, category = $7, phone = $8, speed_limit = $9, updated_at = now()
		WHERE id = $1 RETURNING `+deviceColumns,
		id, in.Name, in.IMEI, in.Protocol, in.Plate, in.Model, in.Category, in.Phone, in.SpeedLimit)
	d, err := scanDevice(row)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return Device{}, ErrNotFound
	case isUniqueViolation(err):
		return Device{}, ErrDuplicateIMEI
	case err != nil:
		return Device{}, err
	}

	now := s.opts.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.devices[id]
	if !ok { // deleted concurrently
		return Device{}, ErrNotFound
	}
	if e.dev.IMEI != d.IMEI {
		delete(s.byIMEI, e.dev.IMEI)
		s.byIMEI[d.IMEI] = id
	}
	d.Position, d.LastSeen = e.dev.Position, e.dev.LastSeen
	e.dev = d
	s.announceLocked(e, now, true)
	return s.view(e, now), nil
}

// EnsureBridgedDevice returns the device with the given unique id, creating
// it with source "traccar" when unknown and AutoRegister is enabled (else
// ErrUnknownDevice). An existing device keeps its source.
func (s *Store) EnsureBridgedDevice(ctx context.Context, uniqueID, protocol, name string) (Device, error) {
	s.mu.RLock()
	id, ok := s.byIMEI[uniqueID]
	s.mu.RUnlock()
	if ok {
		return s.Device(id)
	}
	if !s.opts.AutoRegister {
		return Device{}, fmt.Errorf("%w: %s", ErrUnknownDevice, uniqueID)
	}
	if err := validateUniqueID(uniqueID); err != nil {
		return Device{}, err
	}
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 100 {
		name = "Device " + uniqueID[max(0, len(uniqueID)-6):]
	}
	protocol = strings.ToLower(strings.TrimSpace(protocol))
	if protocol == "" {
		protocol = "traccar"
	}
	row := s.pool.QueryRow(ctx, `INSERT INTO devices AS d (name, imei, protocol, source) VALUES ($1, $2, $3, $4)
		ON CONFLICT (imei) DO UPDATE SET imei = EXCLUDED.imei RETURNING `+deviceColumns,
		name, uniqueID, protocol, SourceTraccar)
	d, err := scanDevice(row)
	if err != nil {
		return Device{}, fmt.Errorf("register bridged device %s: %w", uniqueID, err)
	}
	s.log.Info("registered bridged device", "id", d.ID, "uniqueId", uniqueID, "protocol", protocol)
	return s.cacheNewDevice(d), nil
}

// DeleteDevice removes a device together with its positions and state.
func (s *Store) DeleteDevice(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM devices WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if e, ok := s.devices[id]; ok {
		delete(s.byIMEI, e.dev.IMEI)
		delete(s.devices, id)
	}
	s.publish(EventDeleted, map[string]int64{"id": id})
	return nil
}
