package store

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

// Driver-app phones are stored as devices with this protocol and an IMEI of
// DriverAppIMEIPrefix + driver id (Phase 4a).
const (
	ProtocolDriverApp   = "driverapp"
	DriverAppIMEIPrefix = "DRV"
)

// DriverAppIMEI returns the pseudo IMEI of a driver's phone.
func DriverAppIMEI(driverID int64) string {
	return DriverAppIMEIPrefix + strconv.FormatInt(driverID, 10)
}

// EnsureDriverAppDevice returns the driver-app pseudo device of a driver,
// creating it on first use (independent of AutoRegister).
func (s *Store) EnsureDriverAppDevice(ctx context.Context, driverID int64, driverName string) (Device, error) {
	imei := DriverAppIMEI(driverID)
	if id, ok := s.deviceIDByIMEI(imei); ok {
		return s.Device(id)
	}
	name := strings.TrimSpace(driverName)
	if utf8.RuneCountInString(name) > 90 {
		name = string([]rune(name)[:90])
	}
	if name == "" {
		name = "Driver " + strconv.FormatInt(driverID, 10)
	}
	name += " (phone)"
	row := s.pool.QueryRow(ctx, `INSERT INTO devices AS d (name, imei, protocol, category, source) VALUES ($1, $2, $3, 'other', $4)
		ON CONFLICT (imei) DO UPDATE SET imei = EXCLUDED.imei RETURNING `+deviceColumns,
		name, imei, ProtocolDriverApp, SourceDirect)
	d, err := scanDevice(row)
	if err != nil {
		return Device{}, fmt.Errorf("register driver-app device %s: %w", imei, err)
	}
	s.log.Info("registered driver-app device", "id", d.ID, "imei", imei)
	d = s.cacheNewDevice(d)
	// The driver's login may now see its phone.
	return d, s.reloadDrivers(ctx)
}

// DriverByUser returns the driver linked to a login or ErrNotFound.
func (s *Store) DriverByUser(ctx context.Context, userID int64) (Driver, error) {
	return scanDriver(s.pool.QueryRow(ctx, `SELECT `+driverColumns+` FROM drivers WHERE user_id = $1`, userID))
}

// SetDriverAccount creates the driver-app login (role driver) of a driver,
// or updates its email (and password when not empty) when it exists.
// created reports whether a new account was made.
func (s *Store) SetDriverAccount(ctx context.Context, driverID int64, email, password string) (u User, created bool, err error) {
	email = normalizeEmail(email)
	if password != "" && len(password) < 6 {
		return User{}, false, invalid("password must be at least 6 characters")
	}
	var hash string
	if password != "" {
		h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if err != nil {
			return User{}, false, err
		}
		hash = string(h)
	}
	var userID int64
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var (
			name string
			cur  *int64
		)
		err := tx.QueryRow(ctx, `SELECT name, user_id FROM drivers WHERE id = $1 FOR UPDATE`, driverID).Scan(&name, &cur)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if err := validateUserFields(email, name, RoleDriver); err != nil {
			return err
		}
		if cur != nil {
			userID = *cur
			_, err = tx.Exec(ctx, `UPDATE users SET email = $2,
				password_hash = CASE WHEN $3 = '' THEN password_hash ELSE $3 END WHERE id = $1`, userID, email, hash)
		} else {
			if hash == "" {
				return invalid("email and password are required")
			}
			created = true
			err = tx.QueryRow(ctx, `INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)
				RETURNING id`, email, name, hash, RoleDriver).Scan(&userID)
			if err == nil {
				_, err = tx.Exec(ctx, `UPDATE drivers SET user_id = $2 WHERE id = $1`, driverID, userID)
			}
		}
		if isUniqueViolation(err) {
			return invalid("a user with this email already exists")
		}
		return err
	})
	if err != nil {
		return User{}, false, err
	}
	if err := s.reloadAccess(ctx); err != nil {
		return User{}, false, err
	}
	if err := s.reloadDrivers(ctx); err != nil {
		return User{}, false, err
	}
	u, err = s.UserByID(ctx, userID)
	return u, created, err
}

// DeleteDriverAccount removes the login of a driver (ErrNotFound when none).
func (s *Store) DeleteDriverAccount(ctx context.Context, driverID int64) error {
	var userID *int64
	err := s.pool.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id = $1`, driverID).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && userID == nil) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if _, err := s.pool.Exec(ctx, `DELETE FROM users WHERE id = $1 AND role = $2`, *userID, RoleDriver); err != nil {
		return err
	}
	// A non-driver account (role changed by an admin) is only unlinked.
	if _, err := s.pool.Exec(ctx, `UPDATE drivers SET user_id = NULL WHERE id = $1`, driverID); err != nil {
		return err
	}
	if err := s.reloadAccess(ctx); err != nil {
		return err
	}
	return s.reloadDrivers(ctx)
}

// DeviceIDByIMEI resolves a device by IMEI from the cache.
func (s *Store) DeviceIDByIMEI(imei string) (int64, bool) { return s.deviceIDByIMEI(imei) }
