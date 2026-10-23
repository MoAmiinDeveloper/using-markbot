package store

import (
	"context"
	"errors"
	"math"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// EventPlaces is the live event (no data) published when places change.
const EventPlaces = "places"

// PlaceCategories are the accepted Place.Category values.
var PlaceCategories = []string{"depot", "customer", "fuel", "parking", "workshop", "other"}

// Place limits and defaults.
const (
	MinPlaceRadius     = 10     // meters
	MaxPlaceRadius     = 50_000 // meters
	DefaultPlaceRadius = 150
	defaultPlaceColor  = "#ffd700"
)

// Place is a named point of interest; reports show its name instead of a
// street address for positions within its radius.
type Place struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	Category  string    `json:"category"`
	Lat       float64   `json:"lat"`
	Lng       float64   `json:"lng"`
	Radius    float64   `json:"radius"` // meters
	Color     string    `json:"color"`
	CreatedAt time.Time `json:"createdAt"`
}

// PlaceInput is the body of POST /places.
type PlaceInput struct {
	Name     string   `json:"name"`
	Category string   `json:"category"`
	Lat      *float64 `json:"lat"`
	Lng      *float64 `json:"lng"`
	Radius   float64  `json:"radius"`
	Color    string   `json:"color"`
}

// PlacePatch is a partial update; nil fields are left unchanged.
type PlacePatch struct {
	Name     *string  `json:"name"`
	Category *string  `json:"category"`
	Lat      *float64 `json:"lat"`
	Lng      *float64 `json:"lng"`
	Radius   *float64 `json:"radius"`
	Color    *string  `json:"color"`
}

func normalizePlace(p *Place) error {
	p.Name = strings.TrimSpace(p.Name)
	p.Category = strings.ToLower(strings.TrimSpace(p.Category))
	p.Color = strings.TrimSpace(p.Color)
	if p.Category == "" {
		p.Category = "other"
	}
	if p.Color == "" {
		p.Color = defaultPlaceColor
	}
	if p.Radius == 0 {
		p.Radius = DefaultPlaceRadius
	}
	switch {
	case p.Name == "":
		return invalid("name is required")
	case utf8.RuneCountInString(p.Name) > 100:
		return invalid("name must be at most 100 characters")
	case !slices.Contains(PlaceCategories, p.Category):
		return invalid("category must be one of %s", strings.Join(PlaceCategories, ", "))
	case !(p.Lat >= -90 && p.Lat <= 90) || !(p.Lng >= -180 && p.Lng <= 180):
		return invalid("lat/lng are required and must be valid coordinates")
	case !(p.Radius >= MinPlaceRadius && p.Radius <= MaxPlaceRadius):
		return invalid("radius must be between %d and %d meters", MinPlaceRadius, MaxPlaceRadius)
	case !hexColor.MatchString(p.Color):
		return invalid("color must be a hex color like #ffd700")
	}
	return nil
}

const placeColumns = `id, name, category, lat, lng, radius, color, created_at`

func scanPlace(row pgx.Row) (Place, error) {
	var p Place
	err := row.Scan(&p.ID, &p.Name, &p.Category, &p.Lat, &p.Lng, &p.Radius, &p.Color, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	p.CreatedAt = p.CreatedAt.UTC()
	return p, err
}

// Places returns every place ordered by name.
func (s *Store) Places(ctx context.Context) ([]Place, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+placeColumns+` FROM places ORDER BY lower(name), id`)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Place, error) { return scanPlace(r) })
	if out == nil {
		out = []Place{}
	}
	return out, err
}

// Place returns one place or ErrNotFound.
func (s *Store) Place(ctx context.Context, id int64) (Place, error) {
	return scanPlace(s.pool.QueryRow(ctx, `SELECT `+placeColumns+` FROM places WHERE id = $1`, id))
}

// CreatePlace validates and stores a place.
func (s *Store) CreatePlace(ctx context.Context, in PlaceInput) (Place, error) {
	if in.Lat == nil || in.Lng == nil {
		return Place{}, invalid("lat/lng are required and must be valid coordinates")
	}
	p := Place{Name: in.Name, Category: in.Category, Lat: *in.Lat, Lng: *in.Lng, Radius: in.Radius, Color: in.Color}
	if err := normalizePlace(&p); err != nil {
		return p, err
	}
	p, err := scanPlace(s.pool.QueryRow(ctx, `INSERT INTO places (name, category, lat, lng, radius, color)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING `+placeColumns, p.Name, p.Category, p.Lat, p.Lng, p.Radius, p.Color))
	if err == nil {
		s.publish(EventPlaces, nil)
	}
	return p, err
}

// UpdatePlace applies a partial update.
func (s *Store) UpdatePlace(ctx context.Context, id int64, patch PlacePatch) (Place, error) {
	p, err := s.Place(ctx, id)
	if err != nil {
		return p, err
	}
	if patch.Name != nil {
		p.Name = *patch.Name
	}
	if patch.Category != nil {
		p.Category = *patch.Category
	}
	if patch.Lat != nil {
		p.Lat = *patch.Lat
	}
	if patch.Lng != nil {
		p.Lng = *patch.Lng
	}
	if patch.Radius != nil {
		if *patch.Radius == 0 || math.IsNaN(*patch.Radius) {
			return p, invalid("radius must be between %d and %d meters", MinPlaceRadius, MaxPlaceRadius)
		}
		p.Radius = *patch.Radius
	}
	if patch.Color != nil {
		p.Color = *patch.Color
	}
	if err := normalizePlace(&p); err != nil {
		return p, err
	}
	p, err = scanPlace(s.pool.QueryRow(ctx, `UPDATE places SET name = $2, category = $3, lat = $4, lng = $5,
		radius = $6, color = $7, updated_at = now() WHERE id = $1 RETURNING `+placeColumns,
		id, p.Name, p.Category, p.Lat, p.Lng, p.Radius, p.Color))
	if err == nil {
		s.publish(EventPlaces, nil)
	}
	return p, err
}

// DeletePlace removes a place.
func (s *Store) DeletePlace(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM places WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	s.publish(EventPlaces, nil)
	return nil
}

// GeocodeKey rounds coordinates to the geocode cache grid (1e-4°, ~11 m).
func GeocodeKey(lat, lng float64) (int32, int32) {
	return int32(math.Round(lat * 1e4)), int32(math.Round(lng * 1e4))
}

// GeoKey identifies one cache cell.
type GeoKey struct{ Lat, Lng int32 }

// CachedAddresses returns the cached addresses for the given cells. Cells
// cached as "nothing found" map to "".
func (s *Store) CachedAddresses(ctx context.Context, keys []GeoKey) (map[GeoKey]string, error) {
	out := make(map[GeoKey]string, len(keys))
	if len(keys) == 0 {
		return out, nil
	}
	lats := make([]int32, len(keys))
	lngs := make([]int32, len(keys))
	for i, k := range keys {
		lats[i], lngs[i] = k.Lat, k.Lng
	}
	rows, err := s.pool.Query(ctx, `SELECT c.lat_key, c.lng_key, c.address
		FROM geocode_cache c JOIN unnest($1::int[], $2::int[]) AS k(lat_key, lng_key)
		  ON c.lat_key = k.lat_key AND c.lng_key = k.lng_key`, lats, lngs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var (
			k    GeoKey
			addr string
		)
		if err := rows.Scan(&k.Lat, &k.Lng, &addr); err != nil {
			return nil, err
		}
		out[k] = addr
	}
	return out, rows.Err()
}

// CacheAddress stores a geocoding result ("" = nothing found).
func (s *Store) CacheAddress(ctx context.Context, k GeoKey, address string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO geocode_cache (lat_key, lng_key, address) VALUES ($1, $2, $3)
		ON CONFLICT (lat_key, lng_key) DO UPDATE SET address = EXCLUDED.address, created_at = now()`,
		k.Lat, k.Lng, address)
	return err
}
