package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Driver is a person who drives fleet vehicles.
type Driver struct {
	ID            int64     `json:"id"`
	Name          string    `json:"name"`
	Phone         string    `json:"phone"`
	LicenseNumber string    `json:"licenseNumber"`
	LicenseExpiry *string   `json:"licenseExpiry"` // YYYY-MM-DD or null
	Tag           string    `json:"tag"`           // iButton/RFID id (upper-case hex), "" = none
	DeviceID      *int64    `json:"deviceId"`      // manually assigned vehicle
	Notes         string    `json:"notes"`
	CreatedAt     time.Time `json:"createdAt"`
}

// DriverInput is the body of POST /drivers.
type DriverInput struct {
	Name          string  `json:"name"`
	Phone         string  `json:"phone"`
	LicenseNumber string  `json:"licenseNumber"`
	LicenseExpiry *string `json:"licenseExpiry"`
	Tag           string  `json:"tag"`
	DeviceID      *int64  `json:"deviceId"`
	Notes         string  `json:"notes"`
}

const driverColumns = `id, name, phone, license_number, to_char(license_expiry, 'YYYY-MM-DD'), tag, device_id, notes, created_at`

func scanDriver(row pgx.Row) (Driver, error) {
	var d Driver
	err := row.Scan(&d.ID, &d.Name, &d.Phone, &d.LicenseNumber, &d.LicenseExpiry, &d.Tag, &d.DeviceID, &d.Notes, &d.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, ErrNotFound
	}
	d.CreatedAt = d.CreatedAt.UTC()
	return d, err
}

// ParseDate validates a YYYY-MM-DD date.
func ParseDate(field, v string) (time.Time, error) {
	t, err := time.Parse(time.DateOnly, strings.TrimSpace(v))
	if err != nil {
		return t, invalid("%s must be a date like 2026-12-31", field)
	}
	return t, nil
}

func (in *DriverInput) normalize() error {
	for _, f := range []*string{&in.Name, &in.Phone, &in.LicenseNumber, &in.Notes} {
		*f = strings.TrimSpace(*f)
	}
	in.Tag = strings.ToUpper(strings.TrimSpace(in.Tag))
	if in.LicenseExpiry != nil && strings.TrimSpace(*in.LicenseExpiry) == "" {
		in.LicenseExpiry = nil
	}
	switch {
	case in.Name == "":
		return invalid("name is required")
	case utf8.RuneCountInString(in.Name) > 100:
		return invalid("name must be at most 100 characters")
	case utf8.RuneCountInString(in.Phone) > 32:
		return invalid("phone must be at most 32 characters")
	case utf8.RuneCountInString(in.LicenseNumber) > 64:
		return invalid("licenseNumber must be at most 64 characters")
	case len(in.Tag) > 64 || strings.ContainsFunc(in.Tag, func(r rune) bool { return r < 0x21 || r > 0x7e }):
		return invalid("tag must be at most 64 printable characters without spaces")
	case utf8.RuneCountInString(in.Notes) > 2000:
		return invalid("notes must be at most 2000 characters")
	}
	if in.LicenseExpiry != nil {
		t, err := ParseDate("licenseExpiry", *in.LicenseExpiry)
		if err != nil {
			return err
		}
		v := t.Format(time.DateOnly)
		in.LicenseExpiry = &v
	}
	return nil
}

// Drivers returns all drivers ordered by name.
func (s *Store) Drivers(ctx context.Context) ([]Driver, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+driverColumns+` FROM drivers ORDER BY lower(name), id`)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Driver, error) { return scanDriver(r) })
	if out == nil {
		out = []Driver{}
	}
	return out, err
}

// Driver returns one driver or ErrNotFound.
func (s *Store) Driver(ctx context.Context, id int64) (Driver, error) {
	return scanDriver(s.pool.QueryRow(ctx, `SELECT `+driverColumns+` FROM drivers WHERE id = $1`, id))
}

func driverWriteErr(err error) error {
	switch {
	case isUniqueViolation(err):
		return invalid("another driver already uses this tag")
	case isForeignKeyViolation(err):
		return invalid("unknown deviceId")
	}
	return err
}

// CreateDriver inserts a driver. Assigning a vehicle unassigns the driver
// previously assigned to it.
func (s *Store) CreateDriver(ctx context.Context, in DriverInput) (Driver, error) {
	if err := in.normalize(); err != nil {
		return Driver{}, err
	}
	var d Driver
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if in.DeviceID != nil {
			if _, err := tx.Exec(ctx, `UPDATE drivers SET device_id = NULL WHERE device_id = $1`, *in.DeviceID); err != nil {
				return err
			}
		}
		var err error
		d, err = scanDriver(tx.QueryRow(ctx, `INSERT INTO drivers (name, phone, license_number, license_expiry, tag, device_id, notes)
			VALUES ($1, $2, $3, $4::date, $5, $6, $7) RETURNING `+driverColumns,
			in.Name, in.Phone, in.LicenseNumber, in.LicenseExpiry, in.Tag, in.DeviceID, in.Notes))
		return err
	})
	if err != nil {
		return Driver{}, driverWriteErr(err)
	}
	return d, s.reloadDrivers(ctx)
}

// DriverPatch is a partial driver update. DeviceIDSet distinguishes
// "deviceId": null (unassign) from an absent field.
type DriverPatch struct {
	Name          *string
	Phone         *string
	LicenseNumber *string
	LicenseExpiry *string // "" clears
	LicenseSet    bool
	Tag           *string
	DeviceID      *int64
	DeviceIDSet   bool
	Notes         *string
}

// UpdateDriver applies a partial update.
func (s *Store) UpdateDriver(ctx context.Context, id int64, p DriverPatch) (Driver, error) {
	cur, err := s.Driver(ctx, id)
	if err != nil {
		return Driver{}, err
	}
	in := DriverInput{Name: cur.Name, Phone: cur.Phone, LicenseNumber: cur.LicenseNumber, LicenseExpiry: cur.LicenseExpiry,
		Tag: cur.Tag, DeviceID: cur.DeviceID, Notes: cur.Notes}
	set := func(dst, src *string) {
		if src != nil {
			*dst = *src
		}
	}
	set(&in.Name, p.Name)
	set(&in.Phone, p.Phone)
	set(&in.LicenseNumber, p.LicenseNumber)
	set(&in.Tag, p.Tag)
	set(&in.Notes, p.Notes)
	if p.LicenseSet {
		in.LicenseExpiry = p.LicenseExpiry
	}
	if p.DeviceIDSet {
		in.DeviceID = p.DeviceID
	}
	if err := in.normalize(); err != nil {
		return Driver{}, err
	}
	var d Driver
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if in.DeviceID != nil {
			if _, err := tx.Exec(ctx, `UPDATE drivers SET device_id = NULL WHERE device_id = $1 AND id <> $2`, *in.DeviceID, id); err != nil {
				return err
			}
		}
		var err error
		d, err = scanDriver(tx.QueryRow(ctx, `UPDATE drivers SET name = $2, phone = $3, license_number = $4,
				license_expiry = $5::date, tag = $6, device_id = $7, notes = $8
			WHERE id = $1 RETURNING `+driverColumns,
			id, in.Name, in.Phone, in.LicenseNumber, in.LicenseExpiry, in.Tag, in.DeviceID, in.Notes))
		return err
	})
	if err != nil {
		return Driver{}, driverWriteErr(err)
	}
	return d, s.reloadDrivers(ctx)
}

// DeleteDriver removes a driver (their reminders go too; expenses keep a null driver).
func (s *Store) DeleteDriver(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM drivers WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if err := s.reloadDrivers(ctx); err != nil {
		return err
	}
	s.KickUpkeep()
	return nil
}

// AssignDriver makes driverID the manually assigned driver of a device
// (nil unassigns whoever is assigned).
func (s *Store) AssignDriver(ctx context.Context, deviceID int64, driverID *int64) error {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE drivers SET device_id = NULL WHERE device_id = $1`, deviceID); err != nil {
			return err
		}
		if driverID == nil {
			return nil
		}
		tag, err := tx.Exec(ctx, `UPDATE drivers SET device_id = $1 WHERE id = $2`, deviceID, *driverID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return invalid("unknown driverId")
		}
		return nil
	})
	if err != nil {
		return driverWriteErr(err)
	}
	return s.reloadDrivers(ctx)
}

func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}

// OptID is a nullable id in a PATCH body that records whether the field
// was present: absent = unchanged, null = clear, number = set.
type OptID struct {
	Set bool
	ID  *int64
}

// UnmarshalJSON implements json.Unmarshaler.
func (o *OptID) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.ID = nil
		return nil
	}
	var v int64
	if err := json.Unmarshal(b, &v); err != nil {
		return invalid("ids must be integers or null")
	}
	o.ID = &v
	return nil
}
