// Package geocode turns coordinates into human readable addresses: the
// nearest user-defined place (POI) whose radius covers the point wins,
// otherwise a reverse-geocoding lookup (Nominatim) cached in the database.
//
// Lookups against the remote service are rate limited (1 request/s by
// default, as the public Nominatim usage policy requires) and never happen on
// the ingest path. Reports only read places and the cache (Resolve); missing
// addresses are queued for a background worker so later reports have them.
package geocode

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// Defaults.
const (
	DefaultURL       = "https://nominatim.openstreetmap.org"
	DefaultUserAgent = "SomtelFleet/1.0"
	DefaultInterval  = time.Second     // minimum time between remote requests
	DefaultTimeout   = 5 * time.Second // per remote request
	DefaultQueueSize = 2000
	placesTTL        = time.Minute
)

// Store is the subset of *store.Store the service needs.
type Store interface {
	Places(ctx context.Context) ([]store.Place, error)
	CachedAddresses(ctx context.Context, keys []store.GeoKey) (map[store.GeoKey]string, error)
	CacheAddress(ctx context.Context, k store.GeoKey, address string) error
}

// Options configures a Service.
type Options struct {
	// Provider is "nominatim" (default) or "off" (places and coordinates only).
	Provider string
	// URL is the Nominatim base URL.
	URL string
	// GoogleKey returns the current Google Maps API key; when it is non-empty
	// the Google Geocoding API is used instead of Nominatim (even when
	// Provider is "off").
	GoogleKey func() string
	// GoogleURL is the Geocoding API endpoint (overridable for tests).
	GoogleURL  string
	UserAgent  string
	Interval   time.Duration
	Timeout    time.Duration
	QueueSize  int
	HTTPClient *http.Client
	Logger     *slog.Logger
}

// Service resolves addresses. It is safe for concurrent use.
type Service struct {
	st   Store
	opts Options
	log  *slog.Logger
	off  bool

	limitMu sync.Mutex
	next    time.Time // earliest time of the next remote request

	placesMu  sync.Mutex
	places    []store.Place
	placesAt  time.Time
	placesBad bool

	queue   chan store.GeoKey
	pending sync.Map // GeoKey -> struct{}: queued, not yet resolved
}

// New creates a service. Call Run to start the background worker.
func New(st Store, opts Options) (*Service, error) {
	opts.Provider = strings.ToLower(strings.TrimSpace(opts.Provider))
	switch opts.Provider {
	case "":
		opts.Provider = "nominatim"
	case "nominatim", "off":
	default:
		return nil, fmt.Errorf("unknown geocoder %q (want nominatim or off)", opts.Provider)
	}
	if opts.URL == "" {
		opts.URL = DefaultURL
	}
	if opts.GoogleKey == nil {
		opts.GoogleKey = func() string { return "" }
	}
	if opts.GoogleURL == "" {
		opts.GoogleURL = DefaultGoogleURL
	}
	opts.URL = strings.TrimSuffix(opts.URL, "/")
	if opts.UserAgent == "" {
		opts.UserAgent = DefaultUserAgent
	}
	if opts.Interval <= 0 {
		opts.Interval = DefaultInterval
	}
	if opts.Timeout <= 0 {
		opts.Timeout = DefaultTimeout
	}
	if opts.QueueSize <= 0 {
		opts.QueueSize = DefaultQueueSize
	}
	if opts.HTTPClient == nil {
		opts.HTTPClient = &http.Client{}
	}
	if opts.Logger == nil {
		opts.Logger = slog.New(slog.DiscardHandler)
	}
	return &Service{st: st, opts: opts, log: opts.Logger, off: opts.Provider == "off",
		queue: make(chan store.GeoKey, opts.QueueSize)}, nil
}

// Enabled reports whether remote reverse geocoding is on.
func (s *Service) Enabled() bool { return !s.off || s.opts.GoogleKey() != "" }

// DefaultGoogleURL is the Google Geocoding API endpoint.
const DefaultGoogleURL = "https://maps.googleapis.com/maps/api/geocode/json"

// googleReply is the subset of a Geocoding API reverse response we use.
type googleReply struct {
	Status       string `json:"status"`
	ErrorMessage string `json:"error_message"`
	Results      []struct {
		FormattedAddress string `json:"formatted_address"`
	} `json:"results"`
}

func (s *Service) reverseGoogle(ctx context.Context, key string, lat, lng float64) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, s.opts.Timeout)
	defer cancel()
	q := url.Values{"latlng": {strconv.FormatFloat(lat, 'f', 6, 64) + "," + strconv.FormatFloat(lng, 'f', 6, 64)},
		"key": {key}, "language": {"en"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.opts.GoogleURL+"?"+q.Encode(), nil)
	if err != nil {
		return "", err
	}
	resp, err := s.opts.HTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var rep googleReply
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&rep); err != nil {
		return "", fmt.Errorf("google geocoding: %w", err)
	}
	switch rep.Status {
	case "OK":
		if len(rep.Results) > 0 && rep.Results[0].FormattedAddress != "" {
			return truncate(rep.Results[0].FormattedAddress, 200), nil
		}
		return "", errNotFound
	case "ZERO_RESULTS":
		return "", errNotFound
	default:
		return "", fmt.Errorf("google geocoding: %s %s", rep.Status, rep.ErrorMessage)
	}
}

// Coords formats a coordinate fallback address.
func Coords(lat, lng float64) string {
	return strconv.FormatFloat(lat, 'f', 5, 64) + ", " + strconv.FormatFloat(lng, 'f', 5, 64)
}

// InvalidatePlaces drops the cached place list (call after place changes).
func (s *Service) InvalidatePlaces() {
	s.placesMu.Lock()
	s.placesAt = time.Time{}
	s.placesMu.Unlock()
}

func (s *Service) loadPlaces(ctx context.Context) []store.Place {
	s.placesMu.Lock()
	defer s.placesMu.Unlock()
	if !s.placesAt.IsZero() && time.Since(s.placesAt) < placesTTL {
		return s.places
	}
	ps, err := s.st.Places(ctx)
	if err != nil {
		s.log.Warn("geocode: load places", "err", err)
		return s.places // stale is better than nothing
	}
	s.places, s.placesAt = ps, time.Now()
	return ps
}

// NearestPlace returns the closest place whose radius covers the point.
func NearestPlace(places []store.Place, lat, lng float64) *store.Place {
	var (
		best  *store.Place
		bestD float64
	)
	for i := range places {
		p := &places[i]
		if d := store.Haversine(lat, lng, p.Lat, p.Lng); d <= p.Radius && (best == nil || d < bestD) {
			best, bestD = p, d
		}
	}
	if best == nil {
		return nil
	}
	cp := *best
	return &cp
}

// Point is a coordinate to resolve.
type Point struct{ Lat, Lng float64 }

// Resolver answers addresses for a batch prepared by Resolve.
type Resolver struct {
	places []store.Place
	cache  map[store.GeoKey]string
}

// Address returns the place name, cached address or the coordinates.
func (r *Resolver) Address(lat, lng float64) string {
	if lat == 0 && lng == 0 {
		return ""
	}
	if p := NearestPlace(r.places, lat, lng); p != nil {
		return p.Name
	}
	la, ln := store.GeocodeKey(lat, lng)
	if a := r.cache[store.GeoKey{Lat: la, Lng: ln}]; a != "" {
		return a
	}
	return Coords(lat, lng)
}

// Resolve prepares addresses for many points from places and the cache in
// one database round trip, without remote lookups. Points still unknown are
// queued for background geocoding.
func (s *Service) Resolve(ctx context.Context, pts []Point) *Resolver {
	r := &Resolver{places: s.loadPlaces(ctx)}
	seen := make(map[store.GeoKey]bool)
	var keys []store.GeoKey
	for _, p := range pts {
		if (p.Lat == 0 && p.Lng == 0) || NearestPlace(r.places, p.Lat, p.Lng) != nil {
			continue
		}
		la, ln := store.GeocodeKey(p.Lat, p.Lng)
		k := store.GeoKey{Lat: la, Lng: ln}
		if !seen[k] {
			seen[k] = true
			keys = append(keys, k)
		}
	}
	cache, err := s.st.CachedAddresses(ctx, keys)
	if err != nil {
		s.log.Warn("geocode: read cache", "err", err)
		cache = map[store.GeoKey]string{}
	}
	r.cache = cache
	if s.Enabled() {
		for _, k := range keys {
			if _, ok := cache[k]; !ok {
				s.enqueue(k)
			}
		}
	}
	return r
}

func (s *Service) enqueue(k store.GeoKey) {
	if _, dup := s.pending.LoadOrStore(k, struct{}{}); dup {
		return
	}
	select {
	case s.queue <- k:
	default: // full: drop, a later report re-queues it
		s.pending.Delete(k)
	}
}

// Run geocodes queued points until ctx is done.
func (s *Service) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case k := <-s.queue:
			lat, lng := float64(k.Lat)/1e4, float64(k.Lng)/1e4
			if _, err := s.lookupAndCache(ctx, k, lat, lng); err != nil && ctx.Err() == nil {
				s.log.Debug("geocode: background lookup failed", "lat", lat, "lng", lng, "err", err)
			}
			s.pending.Delete(k)
		}
	}
}

// Result is the answer of Lookup.
type Result struct {
	Address string       `json:"address"`
	Place   *store.Place `json:"place"`
}

// Lookup resolves one point: place, cache, then (rate limited) remote
// lookup; it falls back to the coordinates on any failure.
func (s *Service) Lookup(ctx context.Context, lat, lng float64) Result {
	if p := NearestPlace(s.loadPlaces(ctx), lat, lng); p != nil {
		return Result{Address: p.Name, Place: p}
	}
	la, ln := store.GeocodeKey(lat, lng)
	k := store.GeoKey{Lat: la, Lng: ln}
	cached, err := s.st.CachedAddresses(ctx, []store.GeoKey{k})
	if err != nil {
		s.log.Warn("geocode: read cache", "err", err)
	}
	if a, ok := cached[k]; ok {
		if a == "" {
			a = Coords(lat, lng)
		}
		return Result{Address: a}
	}
	if !s.Enabled() {
		return Result{Address: Coords(lat, lng)}
	}
	addr, err := s.lookupAndCache(ctx, k, lat, lng)
	if err != nil || addr == "" {
		if err != nil {
			s.log.Warn("geocode: lookup failed", "err", err)
		}
		return Result{Address: Coords(lat, lng)}
	}
	return Result{Address: addr}
}

// errNotFound means the service answered but has no address for the point.
var errNotFound = errors.New("no address")

func (s *Service) lookupAndCache(ctx context.Context, k store.GeoKey, lat, lng float64) (string, error) {
	addr, err := s.reverse(ctx, lat, lng)
	if errors.Is(err, errNotFound) {
		addr, err = "", nil
	}
	if err != nil {
		return "", err
	}
	if cerr := s.st.CacheAddress(context.WithoutCancel(ctx), k, addr); cerr != nil {
		s.log.Warn("geocode: write cache", "err", cerr)
	}
	return addr, nil
}

// wait blocks until the rate limiter admits a request.
func (s *Service) wait(ctx context.Context) error {
	s.limitMu.Lock()
	now := time.Now()
	at := s.next
	if at.Before(now) {
		at = now
	}
	s.next = at.Add(s.opts.Interval)
	s.limitMu.Unlock()
	if d := time.Until(at); d > 0 {
		t := time.NewTimer(d)
		defer t.Stop()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
		}
	}
	return nil
}

// nominatimReply is the subset of the jsonv2 reverse response we use.
type nominatimReply struct {
	Error       string            `json:"error"`
	DisplayName string            `json:"display_name"`
	Name        string            `json:"name"`
	Address     map[string]string `json:"address"`
}

func (s *Service) reverse(ctx context.Context, lat, lng float64) (string, error) {
	if key := s.opts.GoogleKey(); key != "" {
		addr, err := s.reverseGoogle(ctx, key, lat, lng)
		// A refused key or used-up quota falls back to OpenStreetMap.
		if err == nil || errors.Is(err, errNotFound) || s.off {
			return addr, err
		}
		s.log.Warn("google geocoding failed, using OpenStreetMap", "err", err)
	}
	if s.off {
		return "", errNotFound
	}
	ctx, cancel := context.WithTimeout(ctx, s.opts.Timeout+s.opts.Interval*5)
	defer cancel()
	if err := s.wait(ctx); err != nil {
		return "", err
	}
	rctx, rcancel := context.WithTimeout(ctx, s.opts.Timeout)
	defer rcancel()
	q := url.Values{"format": {"jsonv2"}, "lat": {strconv.FormatFloat(lat, 'f', 6, 64)},
		"lon": {strconv.FormatFloat(lng, 'f', 6, 64)}, "zoom": {"17"}, "addressdetails": {"1"}}
	req, err := http.NewRequestWithContext(rctx, http.MethodGet, s.opts.URL+"/reverse?"+q.Encode(), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", s.opts.UserAgent)
	req.Header.Set("Accept-Language", "en")
	resp, err := s.opts.HTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("nominatim: HTTP %d", resp.StatusCode)
	}
	var rep nominatimReply
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&rep); err != nil {
		return "", fmt.Errorf("nominatim: %w", err)
	}
	if rep.Error != "" {
		return "", errNotFound
	}
	if a := ShortAddress(rep.Address); a != "" {
		return a, nil
	}
	if rep.DisplayName == "" {
		return "", errNotFound
	}
	return truncate(rep.DisplayName, 200), nil
}

// ShortAddress builds a compact "street, area, city" address from
// Nominatim address details.
func ShortAddress(a map[string]string) string {
	pick := func(keys ...string) string {
		for _, k := range keys {
			if v := strings.TrimSpace(a[k]); v != "" {
				return v
			}
		}
		return ""
	}
	street := pick("road", "pedestrian", "footway", "street", "highway")
	if street != "" {
		if n := strings.TrimSpace(a["house_number"]); n != "" {
			street = n + " " + street
		}
	}
	parts := []string{street,
		pick("neighbourhood", "suburb", "quarter", "hamlet", "city_district", "district"),
		pick("city", "town", "village", "municipality", "county", "state", "region"),
	}
	var out []string
	for _, p := range parts {
		if p != "" && (len(out) == 0 || out[len(out)-1] != p) {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		if c := strings.TrimSpace(a["country"]); c != "" {
			return c
		}
	}
	return truncate(strings.Join(out, ", "), 200)
}

func truncate(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}
