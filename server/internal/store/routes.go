package store

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Route limits and defaults (Phase 4a).
const (
	DefaultRouteCorridor     = 200 // m
	DefaultRouteMinDeviation = 60  // s
	MinRouteCorridor         = 10
	MaxRouteCorridor         = 10_000
	MaxRouteMinDeviation     = 86_400
	MaxRoutePoints           = 10_000
	defaultRouteColor        = "#ffd700"
)

// EventRoutes is the live event (no data) published when routes change.
const EventRoutes = "routes"

// Route is a planned path with a corridor; coordinates are [lng, lat].
type Route struct {
	ID                  int64        `json:"id"`
	Name                string       `json:"name"`
	Color               string       `json:"color"`
	Path                [][2]float64 `json:"path"`
	Corridor            float64      `json:"corridor"`
	DeviceIDs           []int64      `json:"deviceIds"`
	MinDeviationSeconds int          `json:"minDeviationSeconds"`
	CreatedAt           time.Time    `json:"createdAt"`
	UpdatedAt           time.Time    `json:"updatedAt"`
}

// RouteInput is the body of POST /routes. Nil numbers take the defaults.
type RouteInput struct {
	Name                string       `json:"name"`
	Color               string       `json:"color"`
	Path                [][2]float64 `json:"path"`
	Corridor            *float64     `json:"corridor"`
	DeviceIDs           []int64      `json:"deviceIds"`
	MinDeviationSeconds *float64     `json:"minDeviationSeconds"`
}

// RoutePatch is a partial update; nil fields are unchanged.
type RoutePatch struct {
	Name                *string       `json:"name"`
	Color               *string       `json:"color"`
	Path                *[][2]float64 `json:"path"`
	Corridor            *float64      `json:"corridor"`
	DeviceIDs           *[]int64      `json:"deviceIds"`
	MinDeviationSeconds *float64      `json:"minDeviationSeconds"`
}

func (s *Store) normalizeRoute(in *RouteInput) error {
	in.Name = strings.TrimSpace(in.Name)
	in.Color = strings.ToLower(strings.TrimSpace(in.Color))
	if in.Color == "" {
		in.Color = defaultRouteColor
	}
	if in.Corridor == nil {
		v := float64(DefaultRouteCorridor)
		in.Corridor = &v
	}
	if in.MinDeviationSeconds == nil {
		v := float64(DefaultRouteMinDeviation)
		in.MinDeviationSeconds = &v
	}
	md := *in.MinDeviationSeconds
	switch {
	case in.Name == "":
		return invalid("name is required")
	case utf8.RuneCountInString(in.Name) > 100:
		return invalid("name must be at most 100 characters")
	case !hexColor.MatchString(in.Color):
		return invalid("color must be a hex color like #ffd700")
	case len(in.Path) < 2:
		return invalid("path must have at least 2 points")
	case len(in.Path) > MaxRoutePoints:
		return invalid("path must have at most %d points", MaxRoutePoints)
	case !(*in.Corridor >= MinRouteCorridor && *in.Corridor <= MaxRouteCorridor):
		return invalid("corridor must be between %d m and %d m", MinRouteCorridor, MaxRouteCorridor)
	case !(md >= 0 && md <= MaxRouteMinDeviation && md == float64(int(md))):
		return invalid("minDeviationSeconds must be a whole number between 0 and %d", MaxRouteMinDeviation)
	}
	for _, p := range in.Path {
		if !validPoint(p) {
			return invalid("path points must be [lng, lat] with lng in [-180, 180] and lat in [-90, 90]")
		}
	}
	ids := make([]int64, 0, len(in.DeviceIDs))
	for _, id := range in.DeviceIDs {
		if slices.Contains(ids, id) {
			continue
		}
		if _, err := s.Device(id); err != nil {
			return invalid("unknown device id %d", id)
		}
		ids = append(ids, id)
	}
	slices.Sort(ids)
	in.DeviceIDs = ids
	return nil
}

const routeSelect = `SELECT r.id, r.name, r.color, r.path, r.corridor, r.min_deviation_seconds, r.created_at, r.updated_at,
	COALESCE((SELECT array_agg(device_id ORDER BY device_id) FROM route_devices WHERE route_id = r.id), '{}')
	FROM routes r`

func scanRoute(row pgx.Row) (Route, error) {
	var r Route
	err := row.Scan(&r.ID, &r.Name, &r.Color, &r.Path, &r.Corridor, &r.MinDeviationSeconds, &r.CreatedAt, &r.UpdatedAt, &r.DeviceIDs)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, ErrNotFound
	}
	if r.DeviceIDs == nil {
		r.DeviceIDs = []int64{}
	}
	r.CreatedAt, r.UpdatedAt = r.CreatedAt.UTC(), r.UpdatedAt.UTC()
	return r, err
}

// Routes returns all routes ordered by name.
func (s *Store) Routes(ctx context.Context) ([]Route, error) {
	rows, err := s.pool.Query(ctx, routeSelect+` ORDER BY lower(r.name), r.id`)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Route, error) { return scanRoute(r) })
	if out == nil {
		out = []Route{}
	}
	return out, err
}

// Route returns one route or ErrNotFound.
func (s *Store) Route(ctx context.Context, id int64) (Route, error) {
	return scanRoute(s.pool.QueryRow(ctx, routeSelect+` WHERE r.id = $1`, id))
}

func setRouteDevices(ctx context.Context, tx pgx.Tx, id int64, ids []int64) error {
	if _, err := tx.Exec(ctx, `DELETE FROM route_devices WHERE route_id = $1`, id); err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `INSERT INTO route_devices (route_id, device_id)
		SELECT $1, d FROM unnest($2::bigint[]) d ON CONFLICT DO NOTHING`, id, ids)
	if isForeignKeyViolation(err) {
		return invalid("unknown device in deviceIds")
	}
	return err
}

// CreateRoute validates and inserts a route.
func (s *Store) CreateRoute(ctx context.Context, in RouteInput) (Route, error) {
	if err := s.normalizeRoute(&in); err != nil {
		return Route{}, err
	}
	var id int64
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO routes (name, color, path, corridor, min_deviation_seconds)
			VALUES ($1, $2, $3, $4, $5) RETURNING id`, in.Name, in.Color, in.Path, *in.Corridor,
			int(*in.MinDeviationSeconds)).Scan(&id); err != nil {
			return err
		}
		return setRouteDevices(ctx, tx, id, in.DeviceIDs)
	})
	if err != nil {
		return Route{}, err
	}
	s.publish(EventRoutes, nil)
	return s.Route(ctx, id)
}

// UpdateRoute applies a partial update.
func (s *Store) UpdateRoute(ctx context.Context, id int64, p RoutePatch) (Route, error) {
	cur, err := s.Route(ctx, id)
	if err != nil {
		return Route{}, err
	}
	corr, md := cur.Corridor, float64(cur.MinDeviationSeconds)
	in := RouteInput{Name: cur.Name, Color: cur.Color, Path: cur.Path, Corridor: &corr, DeviceIDs: cur.DeviceIDs,
		MinDeviationSeconds: &md}
	if p.Name != nil {
		in.Name = *p.Name
	}
	if p.Color != nil {
		in.Color = *p.Color
	}
	if p.Path != nil {
		in.Path = *p.Path
	}
	if p.Corridor != nil {
		in.Corridor = p.Corridor
	}
	if p.DeviceIDs != nil {
		in.DeviceIDs = *p.DeviceIDs
	}
	if p.MinDeviationSeconds != nil {
		in.MinDeviationSeconds = p.MinDeviationSeconds
	}
	if err := s.normalizeRoute(&in); err != nil {
		return Route{}, err
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE routes SET name = $2, color = $3, path = $4, corridor = $5,
			min_deviation_seconds = $6, updated_at = now() WHERE id = $1`,
			id, in.Name, in.Color, in.Path, *in.Corridor, int(*in.MinDeviationSeconds))
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return setRouteDevices(ctx, tx, id, in.DeviceIDs)
	})
	if err != nil {
		return Route{}, err
	}
	s.publish(EventRoutes, nil)
	return s.Route(ctx, id)
}

// DeleteRoute removes a route (jobs keep running without it).
func (s *Store) DeleteRoute(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM routes WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	s.publish(EventRoutes, nil)
	return nil
}
