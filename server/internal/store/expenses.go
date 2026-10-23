package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// ExpenseCategories lists the expense categories.
var ExpenseCategories = []string{"fuel", "maintenance", "toll", "parking", "fine", "insurance", "tyres", "other"}

// Expense is a cost booked against a vehicle.
type Expense struct {
	ID        int64     `json:"id"`
	DeviceID  int64     `json:"deviceId"`
	DriverID  *int64    `json:"driverId"`
	Category  string    `json:"category"`
	Amount    float64   `json:"amount"`
	Liters    *float64  `json:"liters"`
	Odometer  *float64  `json:"odometer"`
	Date      string    `json:"date"`
	Notes     string    `json:"notes"`
	CreatedAt time.Time `json:"createdAt"`
}

// ExpenseInput is the body of POST /expenses and PATCH /expenses/{id}.
// Absent fields are unchanged (PATCH); liters/odometer/driverId accept null.
type ExpenseInput struct {
	DeviceID *int64   `json:"deviceId"`
	DriverID OptID    `json:"driverId"`
	Category *string  `json:"category"`
	Amount   *float64 `json:"amount"`
	Liters   OptFloat `json:"liters"`
	Odometer OptFloat `json:"odometer"`
	Date     *string  `json:"date"`
	Notes    *string  `json:"notes"`
}

// OptFloat is a nullable number in a PATCH body (see OptID).
type OptFloat struct {
	Set bool
	V   *float64
}

// UnmarshalJSON implements json.Unmarshaler.
func (o *OptFloat) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.V = nil
		return nil
	}
	var v float64
	if err := json.Unmarshal(b, &v); err != nil {
		return invalid("numbers must be numeric or null")
	}
	o.V = &v
	return nil
}

func (in *ExpenseInput) apply(e *Expense) {
	if in.DeviceID != nil {
		e.DeviceID = *in.DeviceID
	}
	if in.DriverID.Set {
		e.DriverID = in.DriverID.ID
	}
	if in.Category != nil {
		e.Category = *in.Category
	}
	if in.Amount != nil {
		e.Amount = *in.Amount
	}
	if in.Liters.Set {
		e.Liters = in.Liters.V
	}
	if in.Odometer.Set {
		e.Odometer = in.Odometer.V
	}
	if in.Date != nil {
		e.Date = *in.Date
	}
	if in.Notes != nil {
		e.Notes = *in.Notes
	}
}

func (e *Expense) validate() error {
	e.Category = strings.ToLower(strings.TrimSpace(e.Category))
	e.Notes = strings.TrimSpace(e.Notes)
	switch {
	case e.DeviceID <= 0:
		return invalid("deviceId is required")
	case !slices.Contains(ExpenseCategories, e.Category):
		return invalid("category must be one of: %s", strings.Join(ExpenseCategories, ", "))
	case !(e.Amount >= 0 && e.Amount <= 1e12):
		return invalid("amount must be a non-negative number")
	case e.Liters != nil && !(*e.Liters >= 0 && *e.Liters <= 1e6):
		return invalid("liters must be a non-negative number")
	case e.Odometer != nil && !nonNeg(*e.Odometer):
		return invalid("odometer must be a non-negative number")
	case utf8.RuneCountInString(e.Notes) > 2000:
		return invalid("notes must be at most 2000 characters")
	}
	t, err := ParseDate("date", e.Date)
	if err != nil {
		return err
	}
	e.Date = t.Format(time.DateOnly)
	return nil
}

const expenseColumns = `id, device_id, driver_id, category, amount, liters, odometer, to_char(date, 'YYYY-MM-DD'), notes, created_at`

func scanExpense(row pgx.Row) (Expense, error) {
	var e Expense
	err := row.Scan(&e.ID, &e.DeviceID, &e.DriverID, &e.Category, &e.Amount, &e.Liters, &e.Odometer, &e.Date, &e.Notes, &e.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return e, ErrNotFound
	}
	e.CreatedAt = e.CreatedAt.UTC()
	return e, err
}

// ExpenseFilter selects expenses; zero fields are ignored. From/To are
// inclusive YYYY-MM-DD dates.
type ExpenseFilter struct {
	DeviceID int64
	Category string
	From, To string
	Limit    int
}

// Expenses returns matching expenses, newest first.
func (s *Store) Expenses(ctx context.Context, sc Scope, f ExpenseFilter) ([]Expense, error) {
	where, args := []string{"true"}, []any{}
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, fmt.Sprintf(cond, len(args)))
	}
	if f.DeviceID != 0 {
		add("device_id = $%d", f.DeviceID)
	}
	if f.Category != "" {
		add("category = $%d", f.Category)
	}
	if f.From != "" {
		add("date >= $%d::date", f.From)
	}
	if f.To != "" {
		add("date <= $%d::date", f.To)
	}
	where, args = sc.sql("device_id", where, args)
	if f.Limit <= 0 {
		f.Limit = 1000
	}
	args = append(args, f.Limit)
	rows, err := s.pool.Query(ctx, `SELECT `+expenseColumns+` FROM expenses WHERE `+strings.Join(where, " AND ")+
		fmt.Sprintf(` ORDER BY date DESC, id DESC LIMIT $%d`, len(args)), args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Expense, error) { return scanExpense(r) })
	if out == nil {
		out = []Expense{}
	}
	return out, err
}

// Expense returns one expense or ErrNotFound.
func (s *Store) Expense(ctx context.Context, id int64) (Expense, error) {
	return scanExpense(s.pool.QueryRow(ctx, `SELECT `+expenseColumns+` FROM expenses WHERE id = $1`, id))
}

func expenseWriteErr(err error) error {
	if isForeignKeyViolation(err) {
		return invalid("unknown deviceId or driverId")
	}
	return err
}

// CreateExpense inserts an expense (date defaults to today).
func (s *Store) CreateExpense(ctx context.Context, in ExpenseInput) (Expense, error) {
	e := Expense{Date: s.opts.Now().UTC().Format(time.DateOnly)}
	in.apply(&e)
	if in.Amount == nil {
		return Expense{}, invalid("amount is required")
	}
	if err := e.validate(); err != nil {
		return Expense{}, err
	}
	e, err := scanExpense(s.pool.QueryRow(ctx, `INSERT INTO expenses (device_id, driver_id, category, amount, liters, odometer, date, notes)
		VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8) RETURNING `+expenseColumns,
		e.DeviceID, e.DriverID, e.Category, e.Amount, e.Liters, e.Odometer, e.Date, e.Notes))
	return e, expenseWriteErr(err)
}

// UpdateExpense applies a partial update.
func (s *Store) UpdateExpense(ctx context.Context, id int64, in ExpenseInput) (Expense, error) {
	e, err := s.Expense(ctx, id)
	if err != nil {
		return e, err
	}
	in.apply(&e)
	if err := e.validate(); err != nil {
		return Expense{}, err
	}
	e, err = scanExpense(s.pool.QueryRow(ctx, `UPDATE expenses SET device_id = $2, driver_id = $3, category = $4,
			amount = $5, liters = $6, odometer = $7, date = $8::date, notes = $9
		WHERE id = $1 RETURNING `+expenseColumns,
		id, e.DeviceID, e.DriverID, e.Category, e.Amount, e.Liters, e.Odometer, e.Date, e.Notes))
	return e, expenseWriteErr(err)
}

// DeleteExpense removes an expense.
func (s *Store) DeleteExpense(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM expenses WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ErrShareGone is returned for expired or revoked share links.
var ErrShareGone = errors.New("this share link has expired or was revoked")

// ShareLink is a public, expiring live-location link for one device.
type ShareLink struct {
	Token     string     `json:"token"`
	URL       string     `json:"url"`
	DeviceID  int64      `json:"deviceId"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt time.Time  `json:"expiresAt"`
	RevokedAt *time.Time `json:"revokedAt,omitempty"`
}

func scanShare(row pgx.Row) (ShareLink, error) {
	var l ShareLink
	err := row.Scan(&l.Token, &l.DeviceID, &l.CreatedAt, &l.ExpiresAt, &l.RevokedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return l, ErrNotFound
	}
	l.URL = "/share/" + l.Token
	l.CreatedAt, l.ExpiresAt = l.CreatedAt.UTC(), l.ExpiresAt.UTC()
	if l.RevokedAt != nil {
		t := l.RevokedAt.UTC()
		l.RevokedAt = &t
	}
	return l, err
}

const shareColumns = `token, device_id, created_at, expires_at, revoked_at`

// CreateShare creates a link valid for d.
func (s *Store) CreateShare(ctx context.Context, deviceID, userID int64, d time.Duration) (ShareLink, error) {
	b := make([]byte, 20)
	if _, err := rand.Read(b); err != nil {
		return ShareLink{}, err
	}
	exp := s.opts.Now().UTC().Add(d).Truncate(time.Microsecond)
	l, err := scanShare(s.pool.QueryRow(ctx, `INSERT INTO share_links (token, device_id, user_id, expires_at)
		VALUES ($1, $2, $3, $4) RETURNING `+shareColumns, hex.EncodeToString(b), deviceID, nullable(userID), exp))
	if isForeignKeyViolation(err) {
		return l, ErrNotFound
	}
	return l, err
}

// Shares returns the active (not expired, not revoked) links of a device.
func (s *Store) Shares(ctx context.Context, deviceID int64) ([]ShareLink, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+shareColumns+` FROM share_links
		WHERE device_id = $1 AND revoked_at IS NULL AND expires_at > $2 ORDER BY created_at DESC`, deviceID, s.opts.Now())
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (ShareLink, error) { return scanShare(r) })
	if out == nil {
		out = []ShareLink{}
	}
	return out, err
}

// Share returns a link by token (any state) or ErrNotFound.
func (s *Store) Share(ctx context.Context, token string) (ShareLink, error) {
	return scanShare(s.pool.QueryRow(ctx, `SELECT `+shareColumns+` FROM share_links WHERE token = $1`, token))
}

// ActiveShare returns a usable link, ErrShareGone or ErrNotFound.
func (s *Store) ActiveShare(ctx context.Context, token string) (ShareLink, error) {
	l, err := s.Share(ctx, token)
	if err != nil {
		return l, err
	}
	if l.RevokedAt != nil || !l.ExpiresAt.After(s.opts.Now()) {
		return l, ErrShareGone
	}
	return l, nil
}

// RevokeShare revokes a link (it then answers 410).
func (s *Store) RevokeShare(ctx context.Context, token string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE share_links SET revoked_at = COALESCE(revoked_at, now()) WHERE token = $1`, token)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
