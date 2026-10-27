package geocode

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

type fakeStore struct {
	mu     sync.Mutex
	places []store.Place
	cache  map[store.GeoKey]string
}

func (f *fakeStore) Places(context.Context) ([]store.Place, error) { return f.places, nil }
func (f *fakeStore) CachedAddresses(_ context.Context, keys []store.GeoKey) (map[store.GeoKey]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[store.GeoKey]string{}
	for _, k := range keys {
		if a, ok := f.cache[k]; ok {
			out[k] = a
		}
	}
	return out, nil
}
func (f *fakeStore) CacheAddress(_ context.Context, k store.GeoKey, a string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cache[k] = a
	return nil
}

func nominatim(t *testing.T, hits *atomic.Int32) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.URL.Path != "/reverse" || r.Header.Get("User-Agent") != "SomtelFleet/1.0" ||
			r.URL.Query().Get("format") != "jsonv2" {
			t.Errorf("bad request %s %v", r.URL, r.Header)
		}
		if r.URL.Query().Get("lat") == "0.000000" && r.URL.Query().Get("lon") == "-30.000000" {
			_, _ = w.Write([]byte(`{"error":"Unable to geocode"}`))
			return
		}
		_, _ = w.Write([]byte(`{"display_name":"long","address":{"road":"Maka Al Mukarama","suburb":"Hodan","city":"Mogadishu","country":"Somalia"}}`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestLookup(t *testing.T) {
	var hits atomic.Int32
	srv := nominatim(t, &hits)
	fs := &fakeStore{cache: map[store.GeoKey]string{},
		places: []store.Place{{ID: 1, Name: "Depot", Lat: 2.03, Lng: 45.3, Radius: 200},
			{ID: 2, Name: "Big zone", Lat: 2.03, Lng: 45.3, Radius: 5000}}}
	s, err := New(fs, Options{URL: srv.URL, Interval: 10 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	// Nearest covering place wins, no remote call.
	if r := s.Lookup(ctx, 2.0301, 45.3); r.Place == nil || r.Place.ID != 1 || r.Address != "Depot" {
		t.Fatalf("place %+v", r)
	}
	// Remote lookup, then cached.
	r := s.Lookup(ctx, 2.1, 45.4)
	if r.Address != "Maka Al Mukarama, Hodan, Mogadishu" || r.Place != nil {
		t.Fatalf("remote %+v", r)
	}
	s.Lookup(ctx, 2.10001, 45.40001) // same ~11 m cell
	if hits.Load() != 1 {
		t.Fatalf("hits %d", hits.Load())
	}
	// "Unable to geocode" is cached as empty and answered with coordinates.
	if r := s.Lookup(ctx, 0, -30); r.Address != "0.00000, -30.00000" {
		t.Fatalf("nothing %+v", r)
	}
	s.Lookup(ctx, 0, -30)
	if hits.Load() != 2 {
		t.Fatalf("hits %d", hits.Load())
	}
}

func TestRateLimit(t *testing.T) {
	var hits atomic.Int32
	srv := nominatim(t, &hits)
	s, _ := New(&fakeStore{cache: map[store.GeoKey]string{}}, Options{URL: srv.URL, Interval: 100 * time.Millisecond})
	start := time.Now()
	for i := range 3 {
		s.Lookup(context.Background(), 10+float64(i), 10)
	}
	if d := time.Since(start); d < 200*time.Millisecond {
		t.Fatalf("3 lookups in %v, want ≥ 200ms", d)
	}
}

func TestOffAndResolve(t *testing.T) {
	var hits atomic.Int32
	srv := nominatim(t, &hits)
	fs := &fakeStore{cache: map[store.GeoKey]string{{Lat: 21000, Lng: 454000}: "Cached street"},
		places: []store.Place{{ID: 1, Name: "Depot", Lat: 2.03, Lng: 45.3, Radius: 200}}}

	off, _ := New(fs, Options{Provider: "off", URL: srv.URL})
	if r := off.Lookup(context.Background(), 5, 5); r.Address != "5.00000, 5.00000" || hits.Load() != 0 {
		t.Fatalf("off %+v", r)
	}

	s, _ := New(fs, Options{URL: srv.URL, Interval: time.Millisecond})
	res := s.Resolve(context.Background(), []Point{{2.03, 45.3}, {2.1, 45.4}, {3, 46}, {0, 0}})
	if res.Address(2.03, 45.3) != "Depot" || res.Address(2.1, 45.4) != "Cached street" ||
		res.Address(3, 46) != "3.00000, 46.00000" || res.Address(0, 0) != "" {
		t.Fatal("resolve")
	}
	if hits.Load() != 0 {
		t.Fatal("Resolve must not call the remote service")
	}
	// The missing point was queued; the worker fills the cache.
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { s.Run(ctx); close(done) }()
	deadline := time.Now().Add(2 * time.Second)
	for {
		fs.mu.Lock()
		a := fs.cache[store.GeoKey{Lat: 30000, Lng: 460000}]
		fs.mu.Unlock()
		if a != "" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("background geocoding did not run")
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	<-done

	if _, err := New(fs, Options{Provider: "google"}); err == nil {
		t.Fatal("unknown provider accepted")
	}
}

func TestShortAddress(t *testing.T) {
	if a := ShortAddress(map[string]string{"house_number": "12", "road": "Main", "city": "Hargeisa"}); a != "12 Main, Hargeisa" {
		t.Fatal(a)
	}
	if a := ShortAddress(map[string]string{"country": "Somalia"}); a != "Somalia" {
		t.Fatal(a)
	}
}

func TestGoogleReverse(t *testing.T) {
	var gotKey, gotLatLng string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey, gotLatLng = r.URL.Query().Get("key"), r.URL.Query().Get("latlng")
		_, _ = w.Write([]byte(`{"status":"OK","results":[{"formatted_address":"Road No. 1, Hargeisa, Somaliland"}]}`))
	}))
	defer srv.Close()
	key := "test-key"
	s, err := New(nil, Options{Provider: "off", GoogleURL: srv.URL, GoogleKey: func() string { return key }})
	if err != nil {
		t.Fatal(err)
	}
	if !s.Enabled() {
		t.Fatal("google key should enable geocoding even with provider off")
	}
	addr, err := s.reverse(context.Background(), 9.5624, 44.0770)
	if err != nil || addr != "Road No. 1, Hargeisa, Somaliland" {
		t.Fatalf("addr=%q err=%v", addr, err)
	}
	if gotKey != "test-key" || gotLatLng != "9.562400,44.077000" {
		t.Fatalf("request key=%q latlng=%q", gotKey, gotLatLng)
	}
	key = ""
	if s.Enabled() {
		t.Fatal("provider off without key must be disabled")
	}
}

func TestGoogleDeniedFallsBackToOSM(t *testing.T) {
	gsrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"status":"REQUEST_DENIED","error_message":"API not enabled"}`))
	}))
	defer gsrv.Close()
	osm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"display_name":"Independence Avenue, Hargeisa","address":{"road":"Independence Avenue","city":"Hargeisa"}}`))
	}))
	defer osm.Close()
	s, err := New(nil, Options{URL: osm.URL, Interval: time.Millisecond, GoogleURL: gsrv.URL,
		GoogleKey: func() string { return "demo" }})
	if err != nil {
		t.Fatal(err)
	}
	addr, err := s.reverse(context.Background(), 9.56, 44.07)
	if err != nil || addr == "" {
		t.Fatalf("addr=%q err=%v", addr, err)
	}
}
