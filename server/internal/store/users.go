package store

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

// User roles, see docs/API.md "Roles & access control".
const (
	RoleAdmin   = "admin"   // everything, all devices
	RoleManager = "manager" // manages the devices of their groups
	RoleViewer  = "viewer"  // read-only, devices of their groups
	RoleDriver  = "driver"  // driver app only (/me, /driver/*), linked to a Driver

	// RoleUser is the Phase 1–2 non-admin role; such accounts were migrated
	// to managers.
	//
	// Deprecated: use RoleManager or RoleViewer.
	RoleUser = RoleManager
)

// Roles lists the valid roles.
var Roles = []string{RoleAdmin, RoleManager, RoleViewer, RoleDriver}

// ErrUserInactive is returned by Authenticate for deactivated accounts.
var ErrUserInactive = errors.New("this account is deactivated")

// User is an account that can sign in to the API.
type User struct {
	ID           int64      `json:"id"`
	Email        string     `json:"email"`
	Name         string     `json:"name"`
	Role         string     `json:"role"`
	GroupIDs     []int64    `json:"groupIds"`
	Active       bool       `json:"active"`
	PasswordHash string     `json:"-"`
	CreatedAt    time.Time  `json:"createdAt"`
	LastLoginAt  *time.Time `json:"lastLoginAt"`
}

const userColumns = `id, email, name, role, active, password_hash, created_at, last_login_at`

func (s *Store) scanUser(row pgx.Row) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.Active, &u.PasswordHash, &u.CreatedAt, &u.LastLoginAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return u, ErrNotFound
	}
	u.CreatedAt = u.CreatedAt.UTC()
	if u.LastLoginAt != nil {
		t := u.LastLoginAt.UTC()
		u.LastLoginAt = &t
	}
	u.GroupIDs = s.UserGroupIDs(u.ID)
	return u, err
}

func normalizeEmail(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

// UserInput is the body of POST /users.
type UserInput struct {
	Email    string  `json:"email"`
	Name     string  `json:"name"`
	Password string  `json:"password"`
	Role     string  `json:"role"`
	GroupIDs []int64 `json:"groupIds"`
	Active   *bool   `json:"active"`
}

// UserPatch is a partial user update; nil fields are unchanged.
type UserPatch struct {
	Email    *string  `json:"email"`
	Name     *string  `json:"name"`
	Password *string  `json:"password"`
	Role     *string  `json:"role"`
	GroupIDs *[]int64 `json:"groupIds"`
	Active   *bool    `json:"active"`
}

func validateUserFields(email, name, role string) error {
	switch {
	case email == "":
		return invalid("email is required")
	case len(email) > 254:
		return invalid("email is too long")
	case utf8.RuneCountInString(name) > 100:
		return invalid("name must be at most 100 characters")
	case !slices.Contains(Roles, role):
		return invalid("role must be one of: %s", strings.Join(Roles, ", "))
	}
	if at := strings.IndexByte(email, '@'); at <= 0 || at == len(email)-1 || strings.ContainsAny(email, " \t\r\n") {
		return invalid("email is invalid")
	}
	return nil
}

// CreateUser stores a user with a bcrypt hash of password.
func (s *Store) CreateUser(ctx context.Context, email, name, password, role string) (User, error) {
	return s.CreateUserFull(ctx, UserInput{Email: email, Name: name, Password: password, Role: role})
}

// CreateUserFull stores a user together with its group memberships.
func (s *Store) CreateUserFull(ctx context.Context, in UserInput) (User, error) {
	in.Email, in.Name = normalizeEmail(in.Email), strings.TrimSpace(in.Name)
	if in.Password == "" {
		return User{}, invalid("email and password are required")
	}
	if err := validateUserFields(in.Email, in.Name, in.Role); err != nil {
		return User{}, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, err
	}
	active := in.Active == nil || *in.Active
	var id int64
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `INSERT INTO users (email, name, password_hash, role, active)
			VALUES ($1, $2, $3, $4, $5) RETURNING id`, in.Email, in.Name, string(hash), in.Role, active).Scan(&id)
		if isUniqueViolation(err) {
			return invalid("a user with this email already exists")
		}
		if err != nil {
			return err
		}
		return setUserGroups(ctx, tx, id, in.GroupIDs)
	})
	if err != nil {
		return User{}, err
	}
	if err := s.reloadAccess(ctx); err != nil {
		return User{}, err
	}
	return s.UserByID(ctx, id)
}

func setUserGroups(ctx context.Context, tx pgx.Tx, userID int64, groups []int64) error {
	if _, err := tx.Exec(ctx, `DELETE FROM user_groups WHERE user_id = $1`, userID); err != nil {
		return err
	}
	if len(groups) == 0 {
		return nil
	}
	tag, err := tx.Exec(ctx, `INSERT INTO user_groups (user_id, group_id)
		SELECT $1, g.id FROM groups g WHERE g.id = ANY($2) ON CONFLICT DO NOTHING`, userID, groups)
	if err != nil {
		return err
	}
	if int(tag.RowsAffected()) != len(uniqueIDs(groups)) {
		return invalid("unknown group in groupIds")
	}
	return nil
}

func uniqueIDs(ids []int64) []int64 {
	out := slices.Clone(ids)
	slices.Sort(out)
	return slices.Compact(out)
}

// userLockID serializes user mutations so the "last admin" checks hold.
const userLockID = 727_100_002

// UpdateUser applies a partial update. actorID is the admin performing it:
// admins cannot demote or deactivate themselves, and the last active admin
// cannot be demoted or deactivated.
func (s *Store) UpdateUser(ctx context.Context, actorID, id int64, p UserPatch) (User, error) {
	var hash string
	if p.Password != nil {
		if *p.Password == "" {
			return User{}, invalid("password must not be empty")
		}
		h, err := bcrypt.GenerateFromPassword([]byte(*p.Password), bcrypt.DefaultCost)
		if err != nil {
			return User{}, err
		}
		hash = string(h)
	}
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, userLockID); err != nil {
			return err
		}
		cur, err := s.scanUser(tx.QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE id = $1`, id))
		if err != nil {
			return err
		}
		email, name, role, active := cur.Email, cur.Name, cur.Role, cur.Active
		if p.Email != nil {
			email = normalizeEmail(*p.Email)
		}
		if p.Name != nil {
			name = strings.TrimSpace(*p.Name)
		}
		if p.Role != nil {
			role = *p.Role
		}
		if p.Active != nil {
			active = *p.Active
		}
		if err := validateUserFields(email, name, role); err != nil {
			return err
		}
		losesAdmin := cur.Role == RoleAdmin && cur.Active && (role != RoleAdmin || !active)
		if losesAdmin && id == actorID {
			return invalid("you cannot demote or deactivate your own account")
		}
		if losesAdmin {
			if err := lastAdminCheck(ctx, tx, id); err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `UPDATE users SET email = $2, name = $3, role = $4, active = $5,
			password_hash = CASE WHEN $6 = '' THEN password_hash ELSE $6 END WHERE id = $1`,
			id, email, name, role, active, hash)
		if isUniqueViolation(err) {
			return invalid("a user with this email already exists")
		}
		if err != nil {
			return err
		}
		if p.GroupIDs != nil {
			return setUserGroups(ctx, tx, id, *p.GroupIDs)
		}
		return nil
	})
	if err != nil {
		return User{}, err
	}
	if err := s.reloadAccess(ctx); err != nil {
		return User{}, err
	}
	return s.UserByID(ctx, id)
}

// lastAdminCheck fails when id is the only active admin.
func lastAdminCheck(ctx context.Context, tx pgx.Tx, id int64) error {
	var others int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM users WHERE role = 'admin' AND active AND id <> $1`, id).Scan(&others); err != nil {
		return err
	}
	if others == 0 {
		return invalid("the last active admin cannot be removed, demoted or deactivated")
	}
	return nil
}

// DeleteUser removes a user. Admins cannot delete themselves and the last
// active admin cannot be deleted.
func (s *Store) DeleteUser(ctx context.Context, actorID, id int64) error {
	if id == actorID {
		return invalid("you cannot delete your own account")
	}
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, userLockID); err != nil {
			return err
		}
		var role string
		var active bool
		err := tx.QueryRow(ctx, `SELECT role, active FROM users WHERE id = $1`, id).Scan(&role, &active)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if role == RoleAdmin && active {
			if err := lastAdminCheck(ctx, tx, id); err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
		return err
	})
	if err != nil {
		return err
	}
	return s.reloadAccess(ctx)
}

// Users returns all users ordered by name, then email.
func (s *Store) Users(ctx context.Context) ([]User, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+userColumns+` FROM users ORDER BY lower(name), email`)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (User, error) { return s.scanUser(r) })
	if out == nil {
		out = []User{}
	}
	return out, err
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
	return s.scanUser(s.pool.QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE id = $1`, id))
}

// dummyHash is compared against when the email is unknown so that response
// time does not reveal which accounts exist.
var dummyHash = sync.OnceValue(func() []byte {
	h, _ := bcrypt.GenerateFromPassword([]byte("fleet-dummy-password"), bcrypt.DefaultCost)
	return h
})

// Authenticate checks credentials and returns the user, ErrInvalidCredentials
// or (for a correct password of a deactivated account) ErrUserInactive. A
// successful login records last_login_at.
func (s *Store) Authenticate(ctx context.Context, email, password string) (User, error) {
	u, err := s.scanUser(s.pool.QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE email = $1`, normalizeEmail(email)))
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
	if !u.Active {
		return User{}, ErrUserInactive
	}
	now := s.opts.Now().UTC().Truncate(time.Microsecond)
	if _, err := s.pool.Exec(ctx, `UPDATE users SET last_login_at = $2 WHERE id = $1`, u.ID, now); err != nil {
		return User{}, err
	}
	u.LastLoginAt = &now
	return u, nil
}

// CheckPassword reports whether password is the user's current password.
func (s *Store) CheckPassword(ctx context.Context, userID int64, password string) (bool, error) {
	u, err := s.UserByID(ctx, userID)
	if err != nil {
		return false, err
	}
	return bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) == nil, nil
}

// UpdateProfile changes a user's own name and/or password (empty = unchanged).
func (s *Store) UpdateProfile(ctx context.Context, userID int64, name *string, newPassword string) (User, error) {
	var hash string
	if newPassword != "" {
		h, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
		if err != nil {
			return User{}, err
		}
		hash = string(h)
	}
	cur, err := s.UserByID(ctx, userID)
	if err != nil {
		return User{}, err
	}
	n := cur.Name
	if name != nil {
		n = strings.TrimSpace(*name)
		if utf8.RuneCountInString(n) > 100 {
			return User{}, invalid("name must be at most 100 characters")
		}
	}
	tag, err := s.pool.Exec(ctx, `UPDATE users SET name = $2,
		password_hash = CASE WHEN $3 = '' THEN password_hash ELSE $3 END WHERE id = $1`, userID, n, hash)
	if err != nil {
		return User{}, err
	}
	if tag.RowsAffected() == 0 {
		return User{}, ErrNotFound
	}
	return s.UserByID(ctx, userID)
}
