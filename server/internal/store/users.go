package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

// User roles.
const (
	RoleAdmin = "admin"
	RoleUser  = "user"
)

// User is an account that can sign in to the API.
type User struct {
	ID           int64     `json:"id"`
	Email        string    `json:"email"`
	Name         string    `json:"name"`
	Role         string    `json:"role"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"-"`
}

const userColumns = `id, email, name, role, password_hash, created_at`

func scanUser(row pgx.Row) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.PasswordHash, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return u, ErrNotFound
	}
	return u, err
}

func normalizeEmail(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

// CreateUser stores a user with a bcrypt hash of password.
func (s *Store) CreateUser(ctx context.Context, email, name, password, role string) (User, error) {
	email = normalizeEmail(email)
	if email == "" || password == "" {
		return User{}, invalid("email and password are required")
	}
	if role != RoleAdmin && role != RoleUser {
		return User{}, invalid("role must be admin or user")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, err
	}
	u, err := scanUser(s.pool.QueryRow(ctx, `INSERT INTO users (email, name, password_hash, role)
		VALUES ($1, $2, $3, $4) RETURNING `+userColumns, email, name, string(hash), role))
	if isUniqueViolation(err) {
		return User{}, invalid("a user with this email already exists")
	}
	return u, err
}

// EnsureAdmin creates the default admin account when no users exist yet.
// It reports whether an account was created.
func (s *Store) EnsureAdmin(ctx context.Context, email, password string) (bool, error) {
	var exists bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users)`).Scan(&exists); err != nil {
		return false, err
	}
	if exists {
		return false, nil
	}
	if _, err := s.CreateUser(ctx, email, "Admin", password, RoleAdmin); err != nil {
		return false, fmt.Errorf("create admin: %w", err)
	}
	return true, nil
}

// UserByID loads a user or returns ErrNotFound.
func (s *Store) UserByID(ctx context.Context, id int64) (User, error) {
	return scanUser(s.pool.QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE id = $1`, id))
}

// dummyHash is compared against when the email is unknown so that response
// time does not reveal which accounts exist.
var dummyHash = sync.OnceValue(func() []byte {
	h, _ := bcrypt.GenerateFromPassword([]byte("fleet-dummy-password"), bcrypt.DefaultCost)
	return h
})

// Authenticate checks credentials and returns the user or ErrInvalidCredentials.
func (s *Store) Authenticate(ctx context.Context, email, password string) (User, error) {
	u, err := scanUser(s.pool.QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE email = $1`, normalizeEmail(email)))
	switch {
	case errors.Is(err, ErrNotFound):
		_ = bcrypt.CompareHashAndPassword(dummyHash(), []byte(password))
		return User{}, ErrInvalidCredentials
	case err != nil:
		return User{}, err
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) != nil {
		return User{}, ErrInvalidCredentials
	}
	return u, nil
}
