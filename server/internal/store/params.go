package store

import (
	"context"
	"errors"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strings"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/expr"
)

// Parameter kinds.
const (
	ParamMapped     = "mapped"     // a name (and unit) for a raw attribute
	ParamCalculated = "calculated" // a formula adding a new attribute at ingest
)

// EventParams is the live event (no data) published when parameter definitions change.
const EventParams = "params"

// ParamDef names a raw attribute or defines a calculated one. DeviceID nil
// applies to every device; a device-specific definition of the same key wins.
type ParamDef struct {
	ID         int64     `json:"id"`
	DeviceID   *int64    `json:"deviceId"`
	Key        string    `json:"key"`
	Kind       string    `json:"kind"`
	Name       string    `json:"name"`
	Expression string    `json:"expression"`
	Unit       string    `json:"unit"`
	Decimals   int       `json:"decimals"`
	Hidden     bool      `json:"hidden"`
	Position   int       `json:"position"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

// ParamInput is the body of POST/PUT /params.
type ParamInput struct {
	DeviceID   *int64 `json:"deviceId"`
	Key        string `json:"key"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	Expression string `json:"expression"`
	Unit       string `json:"unit"`
	Decimals   *int   `json:"decimals"`
	Hidden     bool   `json:"hidden"`
	Position   int    `json:"position"`
}

var paramKeyRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,63}$`)

// PositionFields are the identifiers that read position fields rather than
// attributes; calculated parameters cannot use them as keys.
var PositionFields = []string{"speed", "course", "altitude", "satellites", "lat", "lng", "valid", "priority", "eventId"}

// PositionEnv resolves expression identifiers against a fix: position fields
// first, then attributes (raw and calculated).
func PositionEnv(p *domain.Position) expr.Env {
	return func(name string) (any, bool) {
		switch name {
		case "speed":
			return p.Speed, true
		case "course":
			return p.Course, true
		case "altitude":
			return p.Altitude, true
		case "satellites":
			return p.Satellites, true
		case "lat":
			return p.Latitude, true
		case "lng":
			return p.Longitude, true
		case "valid":
			return p.Valid, true
		case "priority":
			return p.Priority, true
		case "eventId":
			return p.EventID, true
		}
		v, ok := p.Attributes[name]
		return v, ok
	}
}

func (in *ParamInput) normalize() (*expr.Expr, error) {
	in.Key = strings.TrimSpace(in.Key)
	in.Kind = strings.TrimSpace(in.Kind)
	in.Name = strings.TrimSpace(in.Name)
	in.Expression = strings.TrimSpace(in.Expression)
	in.Unit = strings.TrimSpace(in.Unit)
	if in.Kind == "" {
		in.Kind = ParamMapped
	}
	if in.Decimals == nil {
		d := 2
		in.Decimals = &d
	}
	switch {
	case in.Kind != ParamMapped && in.Kind != ParamCalculated:
		return nil, invalid("kind must be mapped or calculated")
	case !paramKeyRe.MatchString(in.Key):
		return nil, invalid("key must start with a letter and use only letters, digits and _ (max 64)")
	case in.Name == "":
		return nil, invalid("name is required")
	case utf8.RuneCountInString(in.Name) > 64:
		return nil, invalid("name must be at most 64 characters")
	case utf8.RuneCountInString(in.Unit) > 16:
		return nil, invalid("unit must be at most 16 characters")
	case *in.Decimals < 0 || *in.Decimals > 6:
		return nil, invalid("decimals must be between 0 and 6")
	case in.Position < 0 || in.Position > 10000:
		return nil, invalid("position must be between 0 and 10000")
	}
	if in.Kind == ParamMapped {
		in.Expression = ""
		return nil, nil
	}
	if slices.Contains(PositionFields, in.Key) {
		return nil, invalid("%q is a built-in field; choose another key", in.Key)
	}
	e, err := expr.Compile(in.Expression)
	if err != nil {
		return nil, invalid("formula: %v", err)
	}
	if slices.Contains(e.Vars(), in.Key) {
		return nil, invalid("the formula cannot use its own key %q", in.Key)
	}
	return e, nil
}

// paramIndex is the immutable snapshot of all definitions.
type paramIndex struct {
	defs     []ParamDef // ordered by position, id
	compiled map[int64]*expr.Expr
}

type paramCache struct{ idx atomic.Pointer[paramIndex] }

const paramColumns = `id, device_id, key, kind, name, expression, unit, decimals, hidden, position, created_at, updated_at`

func scanParam(row pgx.Row) (ParamDef, error) {
	var p ParamDef
	err := row.Scan(&p.ID, &p.DeviceID, &p.Key, &p.Kind, &p.Name, &p.Expression, &p.Unit, &p.Decimals,
		&p.Hidden, &p.Position, &p.CreatedAt, &p.UpdatedAt)
	p.CreatedAt, p.UpdatedAt = p.CreatedAt.UTC(), p.UpdatedAt.UTC()
	return p, err
}

func (s *Store) loadParams(ctx context.Context) error {
	rows, err := s.pool.Query(ctx, `SELECT `+paramColumns+` FROM param_defs ORDER BY position, id`)
	if err != nil {
		return err
	}
	defs, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (ParamDef, error) { return scanParam(r) })
	if err != nil {
		return err
	}
	idx := &paramIndex{defs: defs, compiled: map[int64]*expr.Expr{}}
	for _, d := range defs {
		if d.Kind != ParamCalculated {
			continue
		}
		e, err := expr.Compile(d.Expression)
		if err != nil { // stored before a language change; skip rather than fail startup
			s.log.Warn("calculated parameter does not compile", "id", d.ID, "key", d.Key, "err", err)
			continue
		}
		idx.compiled[d.ID] = e
	}
	s.params.idx.Store(idx)
	return nil
}

func (s *Store) reloadParams(ctx context.Context) {
	if err := s.loadParams(context.WithoutCancel(ctx)); err != nil {
		s.log.Error("reload parameters", "err", err)
	}
	s.publish(EventParams, nil)
}

// DeviceParams returns the definitions effective for a device (device-specific
// definitions replace global ones with the same key), in evaluation order.
func (s *Store) DeviceParams(deviceID int64) []ParamDef {
	idx := s.params.idx.Load()
	if idx == nil {
		return nil
	}
	own := map[string]bool{}
	for _, d := range idx.defs {
		if d.DeviceID != nil && *d.DeviceID == deviceID {
			own[d.Key] = true
		}
	}
	var out []ParamDef
	for _, d := range idx.defs {
		if d.DeviceID == nil && !own[d.Key] || d.DeviceID != nil && *d.DeviceID == deviceID {
			out = append(out, d)
		}
	}
	return out
}

// applyCalculated adds the calculated parameters of the device to p's
// attributes, in order, so later formulas can use earlier results. A formula
// whose inputs are missing (or fail) leaves its key unset.
func (s *Store) applyCalculated(p *domain.Position) {
	idx := s.params.idx.Load()
	if idx == nil || len(idx.compiled) == 0 {
		return
	}
	env := PositionEnv(p)
	for _, d := range s.DeviceParams(p.DeviceID) {
		e := idx.compiled[d.ID]
		if e == nil {
			continue
		}
		v, err := e.Eval(env)
		if err != nil {
			continue
		}
		if f, ok := v.(float64); ok {
			if math.IsNaN(f) || math.IsInf(f, 0) {
				continue
			}
			v = RoundTo(f, d.Decimals)
		}
		p.Attributes[d.Key] = v
	}
}

// Params lists definitions: all of them (deviceID 0) or the global ones plus
// those of one device.
func (s *Store) Params(deviceID int64) []ParamDef {
	idx := s.params.idx.Load()
	out := []ParamDef{}
	if idx == nil {
		return out
	}
	for _, d := range idx.defs {
		if deviceID == 0 || d.DeviceID == nil || *d.DeviceID == deviceID {
			out = append(out, d)
		}
	}
	return out
}

// Param returns one definition or ErrNotFound.
func (s *Store) Param(id int64) (ParamDef, error) {
	if idx := s.params.idx.Load(); idx != nil {
		for _, d := range idx.defs {
			if d.ID == id {
				return d, nil
			}
		}
	}
	return ParamDef{}, ErrNotFound
}

// ErrDuplicateParam is returned when the key is already defined for the scope.
var ErrDuplicateParam = errors.New("this parameter is already defined for these devices")

func (s *Store) checkParamDevice(in *ParamInput) error {
	if in.DeviceID == nil {
		return nil
	}
	if _, err := s.Device(*in.DeviceID); err != nil {
		return invalid("device %d not found", *in.DeviceID)
	}
	return nil
}

// CreateParam validates and inserts a definition.
func (s *Store) CreateParam(ctx context.Context, in ParamInput) (ParamDef, error) {
	if _, err := in.normalize(); err != nil {
		return ParamDef{}, err
	}
	if err := s.checkParamDevice(&in); err != nil {
		return ParamDef{}, err
	}
	d, err := scanParam(s.pool.QueryRow(ctx, `INSERT INTO param_defs (device_id, key, kind, name, expression, unit,
			decimals, hidden, position)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING `+paramColumns,
		in.DeviceID, in.Key, in.Kind, in.Name, in.Expression, in.Unit, *in.Decimals, in.Hidden, in.Position))
	if isUniqueViolation(err) {
		return ParamDef{}, ErrDuplicateParam
	}
	if err != nil {
		return ParamDef{}, fmt.Errorf("create parameter: %w", err)
	}
	s.reloadParams(ctx)
	return d, nil
}

// UpdateParam replaces a definition.
func (s *Store) UpdateParam(ctx context.Context, id int64, in ParamInput) (ParamDef, error) {
	if _, err := in.normalize(); err != nil {
		return ParamDef{}, err
	}
	if err := s.checkParamDevice(&in); err != nil {
		return ParamDef{}, err
	}
	d, err := scanParam(s.pool.QueryRow(ctx, `UPDATE param_defs SET device_id = $2, key = $3, kind = $4, name = $5,
			expression = $6, unit = $7, decimals = $8, hidden = $9, position = $10, updated_at = now()
		WHERE id = $1 RETURNING `+paramColumns,
		id, in.DeviceID, in.Key, in.Kind, in.Name, in.Expression, in.Unit, *in.Decimals, in.Hidden, in.Position))
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return ParamDef{}, ErrNotFound
	case isUniqueViolation(err):
		return ParamDef{}, ErrDuplicateParam
	case err != nil:
		return ParamDef{}, err
	}
	s.reloadParams(ctx)
	return d, nil
}

// DeleteParam removes a definition. Values already stored on fixes stay.
func (s *Store) DeleteParam(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM param_defs WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	s.reloadParams(ctx)
	return nil
}

// ParamTestResult is the outcome of evaluating a formula on a device's latest fix.
type ParamTestResult struct {
	Value   any        `json:"value"`
	Error   string     `json:"error,omitempty"`
	Missing bool       `json:"missing,omitempty"` // an input is not reported by the device
	Time    *time.Time `json:"time"`              // fix used
	Vars    []string   `json:"vars"`
}

// TestExpression compiles src and evaluates it on the latest fix of the
// device (deviceID 0: syntax check only).
func (s *Store) TestExpression(src string, deviceID int64) (ParamTestResult, error) {
	e, err := expr.Compile(src)
	if err != nil {
		return ParamTestResult{}, invalid("%v", err)
	}
	res := ParamTestResult{Vars: e.Vars()}
	if deviceID == 0 {
		return res, nil
	}
	d, err := s.Device(deviceID)
	if err != nil {
		return ParamTestResult{}, err
	}
	if d.Position == nil {
		res.Error = "this device has not reported yet"
		return res, nil
	}
	t := d.Position.DeviceTime
	res.Time = &t
	v, err := e.Eval(PositionEnv(d.Position))
	if err != nil {
		res.Error = err.Error()
		res.Missing = errors.Is(err, expr.ErrMissing)
		return res, nil
	}
	if f, ok := v.(float64); ok && (math.IsNaN(f) || math.IsInf(f, 0)) {
		res.Error = "the result is not a finite number"
		return res, nil
	}
	res.Value = v
	return res, nil
}
