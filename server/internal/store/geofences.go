package store

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Geofence types.
const (
	GeofenceCircle  = "circle"
	GeofencePolygon = "polygon"
)

// EventGeofences is the live event (no data) published when geofences change.
const EventGeofences = "geofences"

// Geofence limits.
const (
	MinGeofenceRadius = 10      // meters
	MaxGeofenceRadius = 100_000 // meters
	maxPolygonPoints  = 2000
	defaultColor      = "#3b82f6"
)

// Geofence is a named area; coordinates are [lng, lat] like GeoJSON.
type Geofence struct {
	ID        int64        `json:"id"`
	Name      string       `json:"name"`
	Color     string       `json:"color"`
	Type      string       `json:"type"`
	Center    *[2]float64  `json:"center,omitempty"`
	Radius    float64      `json:"radius,omitempty"`
	Polygon   [][2]float64 `json:"polygon,omitempty"`
	DeviceIDs []int64      `json:"deviceIds"`
	CreatedAt time.Time    `json:"createdAt"`
}

// AppliesTo reports whether the geofence covers the device.
func (g *Geofence) AppliesTo(deviceID int64) bool {
	return len(g.DeviceIDs) == 0 || slices.Contains(g.DeviceIDs, deviceID)
}

// Contains reports whether the point lies inside the geofence. Polygons use
// ray casting on lng/lat as planar coordinates, which is accurate enough for
// geofence-sized areas away from the antimeridian.
func (g *Geofence) Contains(lat, lng float64) bool {
	switch g.Type {
	case GeofenceCircle:
		return g.Center != nil && Haversine(lat, lng, g.Center[1], g.Center[0]) <= g.Radius
	case GeofencePolygon:
		in := false
		pts := g.Polygon
		for i, j := 0, len(pts)-1; i < len(pts); j, i = i, i+1 {
			xi, yi, xj, yj := pts[i][0], pts[i][1], pts[j][0], pts[j][1]
			if (yi > lat) != (yj > lat) && lng < (xj-xi)*(lat-yi)/(yj-yi)+xi {
				in = !in
			}
		}
		return in
	}
	return false
}

// GeofenceInput is the body of POST /geofences.
type GeofenceInput struct {
	Name      string       `json:"name"`
	Color     string       `json:"color"`
	Type      string       `json:"type"`
	Center    *[2]float64  `json:"center"`
	Radius    float64      `json:"radius"`
	Polygon   [][2]float64 `json:"polygon"`
	DeviceIDs []int64      `json:"deviceIds"`
}

// GeofencePatch is a partial update; nil fields are left unchanged.
type GeofencePatch struct {
	Name      *string       `json:"name"`
	Color     *string       `json:"color"`
	Type      *string       `json:"type"`
	Center    *[2]float64   `json:"center"`
	Radius    *float64      `json:"radius"`
	Polygon   *[][2]float64 `json:"polygon"`
	DeviceIDs *[]int64      `json:"deviceIds"`
}

var hexColor = regexp.MustCompile(`^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`)

func validPoint(p [2]float64) bool {
	return p[0] >= -180 && p[0] <= 180 && p[1] >= -90 && p[1] <= 90 // NaN fails every comparison
}

// normalize trims, applies defaults and validates. Fields of the other
// geometry type are cleared.
func (s *Store) normalizeGeofence(in *GeofenceInput) error {
	in.Name = strings.TrimSpace(in.Name)
	in.Color = strings.TrimSpace(in.Color)
	in.Type = strings.ToLower(strings.TrimSpace(in.Type))
	if in.Color == "" {
		in.Color = defaultColor
	}
	switch {
	case in.Name == "":
		return invalid("name is required")
	case utf8.RuneCountInString(in.Name) > 100:
		return invalid("name must be at most 100 characters")
	case !hexColor.MatchString(in.Color):
		return invalid("color must be a hex color like #22c55e")
	}
	switch in.Type {
	case GeofenceCircle:
		in.Polygon = nil
		switch {
		case in.Center == nil:
			return invalid("center is required for circle geofences")
		case !validPoint(*in.Center):
			return invalid("center must be [lng, lat] with lng in [-180, 180] and lat in [-90, 90]")
		case !(in.Radius >= MinGeofenceRadius && in.Radius <= MaxGeofenceRadius):
			return invalid("radius must be between %d m and %d m", MinGeofenceRadius, MaxGeofenceRadius)
		}
	case GeofencePolygon:
		in.Center, in.Radius = nil, 0
		if n := len(in.Polygon); n > 1 && in.Polygon[0] == in.Polygon[n-1] {
			in.Polygon = in.Polygon[:n-1] // accept closed rings
		}
		if len(in.Polygon) < 3 {
			return invalid("polygon must have at least 3 points")
		}
		if len(in.Polygon) > maxPolygonPoints {
			return invalid("polygon must have at most %d points", maxPolygonPoints)
		}
		for _, p := range in.Polygon {
			if !validPoint(p) {
				return invalid("polygon points must be [lng, lat] with lng in [-180, 180] and lat in [-90, 90]")
			}
		}
	default:
		return invalid("type must be circle or polygon")
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
	in.DeviceIDs = ids
	return nil
}

const geofenceColumns = `id, name, color, type, center_lng, center_lat, radius, polygon, device_ids, created_at`

func scanGeofence(row pgx.Row) (Geofence, error) {
	var (
		g          Geofence
		lng, lat   *float64
		radius     *float64
		polygonRaw [][2]float64
	)
	err := row.Scan(&g.ID, &g.Name, &g.Color, &g.Type, &lng, &lat, &radius, &polygonRaw, &g.DeviceIDs, &g.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return g, ErrNotFound
	}
	if err != nil {
		return g, err
	}
	if lng != nil && lat != nil {
		g.Center = &[2]float64{*lng, *lat}
	}
	if radius != nil {
		g.Radius = *radius
	}
	g.Polygon = polygonRaw
	if g.DeviceIDs == nil {
		g.DeviceIDs = []int64{}
	}
	g.CreatedAt = g.CreatedAt.UTC()
	return g, nil
}

func (s *Store) loadGeofences(ctx context.Context) error {
	rows, err := s.pool.Query(ctx, `SELECT `+geofenceColumns+` FROM geofences ORDER BY id`)
	if err != nil {
		return err
	}
	gs, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Geofence, error) { return scanGeofence(r) })
	if err != nil {
		return err
	}
	s.geofences.Store(&gs)
	return nil
}

// Geofences returns all geofences ordered by id. The slice is a shared,
// immutable snapshot: callers must not modify it.
func (s *Store) Geofences() []Geofence { return *s.geofences.Load() }

// Geofence returns one geofence or ErrNotFound.
func (s *Store) Geofence(id int64) (Geofence, error) {
	for _, g := range s.Geofences() {
		if g.ID == id {
			return g, nil
		}
	}
	return Geofence{}, ErrNotFound
}

// reloadGeofences refreshes the snapshot after a change and notifies clients.
func (s *Store) reloadGeofences(ctx context.Context) {
	if err := s.loadGeofences(context.WithoutCancel(ctx)); err != nil {
		s.log.Error("reload geofences", "err", err)
	}
	s.publish(EventGeofences, nil)
}

func centerArgs(c *[2]float64) (lng, lat any) {
	if c == nil {
		return nil, nil
	}
	return c[0], c[1]
}

func nullable[T comparable](v T) any {
	var zero T
	if v == zero {
		return nil
	}
	return v
}

// CreateGeofence validates and inserts a geofence.
func (s *Store) CreateGeofence(ctx context.Context, in GeofenceInput) (Geofence, error) {
	if err := s.normalizeGeofence(&in); err != nil {
		return Geofence{}, err
	}
	lng, lat := centerArgs(in.Center)
	var poly any
	if in.Polygon != nil {
		poly = in.Polygon
	}
	g, err := scanGeofence(s.pool.QueryRow(ctx, `INSERT INTO geofences (name, color, type, center_lng, center_lat,
			radius, polygon, device_ids)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING `+geofenceColumns,
		in.Name, in.Color, in.Type, lng, lat, nullable(in.Radius), poly, in.DeviceIDs))
	if err != nil {
		return Geofence{}, fmt.Errorf("create geofence: %w", err)
	}
	s.reloadGeofences(ctx)
	return g, nil
}

// UpdateGeofence applies a partial update.
func (s *Store) UpdateGeofence(ctx context.Context, id int64, p GeofencePatch) (Geofence, error) {
	cur, err := s.Geofence(id)
	if err != nil {
		return Geofence{}, err
	}
	in := GeofenceInput{Name: cur.Name, Color: cur.Color, Type: cur.Type, Center: cur.Center, Radius: cur.Radius,
		Polygon: cur.Polygon, DeviceIDs: cur.DeviceIDs}
	if p.Name != nil {
		in.Name = *p.Name
	}
	if p.Color != nil {
		in.Color = *p.Color
	}
	if p.Type != nil {
		in.Type = *p.Type
	}
	if p.Center != nil {
		in.Center = p.Center
	}
	if p.Radius != nil {
		in.Radius = *p.Radius
	}
	if p.Polygon != nil {
		in.Polygon = *p.Polygon
	}
	if p.DeviceIDs != nil {
		in.DeviceIDs = *p.DeviceIDs
	}
	if err := s.normalizeGeofence(&in); err != nil {
		return Geofence{}, err
	}
	lng, lat := centerArgs(in.Center)
	var poly any
	if in.Polygon != nil {
		poly = in.Polygon
	}
	g, err := scanGeofence(s.pool.QueryRow(ctx, `UPDATE geofences SET name = $2, color = $3, type = $4,
			center_lng = $5, center_lat = $6, radius = $7, polygon = $8, device_ids = $9, updated_at = now()
		WHERE id = $1 RETURNING `+geofenceColumns,
		id, in.Name, in.Color, in.Type, lng, lat, nullable(in.Radius), poly, in.DeviceIDs))
	if err != nil {
		return Geofence{}, err
	}
	s.reloadGeofences(ctx)
	return g, nil
}

// DeleteGeofence removes a geofence; its past events keep a null geofence id.
func (s *Store) DeleteGeofence(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM geofences WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	s.reloadGeofences(ctx)
	return nil
}
