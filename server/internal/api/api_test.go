package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/moamiindeveloper/fleet/server/internal/commands"
	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/events"
	"github.com/moamiindeveloper/fleet/server/internal/hub"
	"github.com/moamiindeveloper/fleet/server/internal/notify"
	"github.com/moamiindeveloper/fleet/server/internal/protocol/teltonika"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

var secret = []byte("test-secret")

type env struct {
	t     *testing.T
	srv   *httptest.Server
	store *store.Store
	hub   *hub.Hub
	token string // admin token
}

// newEnv starts the API against TEST_DATABASE_URL in a private schema.
func newEnv(t *testing.T, webDir string) *env {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	// Per-process schema: concurrent `go test` runs must not share it.
	schema := "api_test_" + strconv.Itoa(os.Getpid())
	_, err = admin.Exec(ctx, `DROP SCHEMA IF EXISTS `+schema+` CASCADE; CREATE SCHEMA `+schema)
	if err != nil {
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), `DROP SCHEMA IF EXISTS `+schema+` CASCADE`)
		admin.Close()
	})
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	h := hub.New(64, nil)
	st, err := store.New(ctx, pool, store.Options{AutoRegister: true, Publisher: h})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.EnsureAdmin(ctx, "admin@fleet.local", "admin"); err != nil {
		t.Fatal(err)
	}
	nt, err := notify.New(ctx, st, notify.Options{TelegramAPIURL: "http://127.0.0.1:1"})
	if err != nil {
		t.Fatal(err)
	}
	engine := events.New(st, nt, nil)
	cmds, err := commands.New(ctx, st, teltonika.NewHandler(), engine, nil)
	if err != nil {
		t.Fatal(err)
	}
	st.SetHooks(store.Hooks{Positions: engine.Process, Connected: cmds.DeviceConnected})
	srv := httptest.NewServer(New(st, h, Config{JWTSecret: secret, CORSOrigins: "*", WebDir: webDir,
		Notifier: nt, Commands: cmds}))
	t.Cleanup(srv.Close)
	t.Cleanup(h.Close) // runs before srv.Close so WebSocket handlers exit

	e := &env{t: t, srv: srv, store: st, hub: h}
	var login struct {
		Token string     `json:"token"`
		User  store.User `json:"user"`
	}
	e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": "admin@fleet.local", "password": "admin"}, 200, &login)
	if login.Token == "" || login.User.Role != "admin" {
		t.Fatalf("login response %+v", login)
	}
	e.token = login.Token
	return e
}

// do performs a request and checks the status; out (if non-nil) receives the JSON body.
func (e *env) do(method, path, token string, body any, wantStatus int, out any) http.Header {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, rd)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != wantStatus {
		e.t.Fatalf("%s %s: status %d, want %d; body %s", method, path, resp.StatusCode, wantStatus, raw)
	}
	if resp.StatusCode >= 400 && resp.StatusCode != http.StatusMethodNotAllowed {
		var eb struct{ Error string }
		if json.Unmarshal(raw, &eb) != nil || eb.Error == "" {
			e.t.Fatalf("%s %s: error body not in contract format: %s", method, path, raw)
		}
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			e.t.Fatalf("%s %s: decode %s: %v", method, path, raw, err)
		}
	}
	return resp.Header
}

func TestAuth(t *testing.T) {
	e := newEnv(t, "")

	var health map[string]string
	e.do("GET", "/api/v1/health", "", nil, 200, &health)
	if health["status"] != "ok" {
		t.Fatalf("health = %v", health)
	}

	e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": "admin@fleet.local", "password": "nope"}, 401, nil)
	e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": ""}, 400, nil)

	var me store.User
	e.do("GET", "/api/v1/me", e.token, nil, 200, &me)
	if me.Email != "admin@fleet.local" || me.Name != "Admin" || me.ID == 0 {
		t.Fatalf("me = %+v", me)
	}

	for _, path := range []string{"/api/v1/me", "/api/v1/devices", "/api/v1/summary", "/api/v1/devices/1/positions"} {
		e.do("GET", path, "", nil, 401, nil)
		e.do("GET", path, "garbage", nil, 401, nil)
	}

	forge := func(m jwt.SigningMethod, key any, exp time.Time) string {
		tok, err := jwt.NewWithClaims(m, jwt.MapClaims{"sub": "1", "role": "admin", "exp": exp.Unix()}).SignedString(key)
		if err != nil {
			t.Fatal(err)
		}
		return tok
	}
	e.do("GET", "/api/v1/me", forge(jwt.SigningMethodHS256, []byte("other"), time.Now().Add(time.Hour)), nil, 401, nil)
	e.do("GET", "/api/v1/me", forge(jwt.SigningMethodHS256, secret, time.Now().Add(-time.Minute)), nil, 401, nil)
	e.do("GET", "/api/v1/me", forge(jwt.SigningMethodNone, jwt.UnsafeAllowNoneSignatureType, time.Now().Add(time.Hour)), nil, 401, nil)

	e.do("GET", "/api/v1/nope", e.token, nil, 404, nil)
	e.do("GET", "/api/nope", "", nil, 404, nil)
}

func TestDevicesCRUD(t *testing.T) {
	e := newEnv(t, "")
	var list []store.Device
	e.do("GET", "/api/v1/devices", e.token, nil, 200, &list)
	if list == nil || len(list) != 0 {
		t.Fatalf("want empty array, got %v", list)
	}

	e.do("POST", "/api/v1/devices", e.token, map[string]string{"name": "x", "imei": "12"}, 400, nil)
	e.do("POST", "/api/v1/devices", e.token, map[string]string{"name": "x", "imei": "356307042441013", "category": "boat"}, 400, nil)
	e.do("POST", "/api/v1/devices", e.token, map[string]string{"imei": "356307042441013"}, 400, nil)

	var d store.Device
	e.do("POST", "/api/v1/devices", e.token, map[string]string{"name": "Truck 07", "imei": "356307042441013", "plate": "ABC-123", "category": "truck"}, 201, &d)
	if d.ID == 0 || d.Protocol != "teltonika" || d.Status != "never" || d.Category != "truck" || d.Position != nil {
		t.Fatalf("created %+v", d)
	}
	e.do("POST", "/api/v1/devices", e.token, map[string]string{"name": "dup", "imei": "356307042441013"}, 409, nil)

	// Raw JSON check of nullable fields.
	var raw map[string]any
	e.do("GET", "/api/v1/devices/"+itoa(d.ID), e.token, nil, 200, &raw)
	if v, ok := raw["lastSeen"]; !ok || v != nil {
		t.Fatalf("lastSeen should be null: %v", raw)
	}
	if v, ok := raw["position"]; !ok || v != nil {
		t.Fatalf("position should be null: %v", raw)
	}

	var upd store.Device
	e.do("PATCH", "/api/v1/devices/"+itoa(d.ID), e.token, map[string]string{"model": "FMB920"}, 200, &upd)
	if upd.Model != "FMB920" || upd.Name != "Truck 07" || upd.Plate != "ABC-123" {
		t.Fatalf("patched %+v", upd)
	}
	e.do("PATCH", "/api/v1/devices/"+itoa(d.ID), e.token, map[string]string{"category": "spaceship"}, 400, nil)
	e.do("PATCH", "/api/v1/devices/999999", e.token, map[string]string{"name": "x"}, 404, nil)
	e.do("GET", "/api/v1/devices/abc", e.token, nil, 404, nil)

	// Non-admin users can read but not modify.
	if _, err := e.store.CreateUser(context.Background(), "viewer@fleet.local", "Viewer", "pw", store.RoleViewer); err != nil {
		t.Fatal(err)
	}
	var login struct{ Token string }
	e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": "viewer@fleet.local", "password": "pw"}, 200, &login)
	e.do("GET", "/api/v1/devices", login.Token, nil, 200, nil)
	e.do("DELETE", "/api/v1/devices/"+itoa(d.ID), login.Token, nil, 403, nil)

	var sum store.Summary
	e.do("GET", "/api/v1/summary", e.token, nil, 200, &sum)
	if sum.Total != 1 || sum.Never != 1 {
		t.Fatalf("summary = %+v", sum)
	}

	e.do("DELETE", "/api/v1/devices/"+itoa(d.ID), e.token, nil, 204, nil)
	e.do("GET", "/api/v1/devices/"+itoa(d.ID), e.token, nil, 404, nil)
	e.do("DELETE", "/api/v1/devices/"+itoa(d.ID), e.token, nil, 404, nil)
}

func TestPositionsRange(t *testing.T) {
	e := newEnv(t, "")
	ctx := context.Background()
	const imei = "356307042441013"
	if ok, err := e.store.Authorize(ctx, imei, "teltonika"); !ok || err != nil {
		t.Fatal(ok, err)
	}
	id := e.store.Devices()[0].ID

	base := time.Now().UTC().Truncate(time.Second).Add(-time.Hour)
	var batch []domain.Position
	for i := 0; i < 10; i++ {
		batch = append(batch, domain.Position{IMEI: imei, Protocol: "teltonika", DeviceTime: base.Add(time.Duration(i) * time.Minute),
			Latitude: 25 + float64(i)*0.01, Longitude: 55, Speed: 60, Valid: true, Attributes: map[string]any{"ignition": true}})
	}
	batch = append(batch, domain.Position{IMEI: imei, DeviceTime: base.Add(-48 * time.Hour), Latitude: 1, Longitude: 1, Valid: true})
	if err := e.store.Positions(ctx, batch); err != nil {
		t.Fatal(err)
	}

	var ps []domain.Position
	e.do("GET", "/api/v1/devices/"+itoa(id)+"/positions", e.token, nil, 200, &ps)
	if len(ps) != 10 { // default range is the last 24h
		t.Fatalf("default range returned %d positions, want 10", len(ps))
	}
	for i := 1; i < len(ps); i++ {
		if !ps[i].DeviceTime.After(ps[i-1].DeviceTime) {
			t.Fatal("positions not ascending")
		}
	}
	if ps[0].IMEI != imei || ps[0].DeviceID != id || ps[0].Attributes["ignition"] != true {
		t.Fatalf("position = %+v", ps[0])
	}

	q := "?from=" + base.Add(2*time.Minute).Format(time.RFC3339) + "&to=" + base.Add(5*time.Minute).Format(time.RFC3339)
	e.do("GET", "/api/v1/devices/"+itoa(id)+"/positions"+q, e.token, nil, 200, &ps)
	if len(ps) != 4 {
		t.Fatalf("range returned %d positions, want 4", len(ps))
	}
	e.do("GET", "/api/v1/devices/"+itoa(id)+"/positions"+q+"&limit=2", e.token, nil, 200, &ps)
	if len(ps) != 2 || !ps[0].DeviceTime.Equal(base.Add(2*time.Minute)) {
		t.Fatalf("limit returned %+v", ps)
	}
	all := "?from=" + base.Add(-72*time.Hour).Format(time.RFC3339)
	e.do("GET", "/api/v1/devices/"+itoa(id)+"/positions"+all, e.token, nil, 200, &ps)
	if len(ps) != 11 {
		t.Fatalf("wide range returned %d positions, want 11", len(ps))
	}

	e.do("GET", "/api/v1/devices/"+itoa(id)+"/positions?from=yesterday", e.token, nil, 400, nil)
	e.do("GET", "/api/v1/devices/"+itoa(id)+"/positions?limit=-1", e.token, nil, 400, nil)
	e.do("GET", "/api/v1/devices/"+itoa(id)+"/positions"+"?from="+base.Format(time.RFC3339)+"&to="+base.Add(-time.Hour).Format(time.RFC3339), e.token, nil, 400, nil)
	e.do("GET", "/api/v1/devices/424242/positions", e.token, nil, 404, nil)

	var trips []store.Trip
	e.do("GET", "/api/v1/devices/"+itoa(id)+"/trips", e.token, nil, 200, &trips)
	if len(trips) != 1 || trips[0].Distance < 9000 {
		t.Fatalf("trips = %+v", trips)
	}

	var d store.Device
	e.do("GET", "/api/v1/devices/"+itoa(id), e.token, nil, 200, &d)
	if d.Status != "moving" || d.Position == nil || !d.Position.DeviceTime.Equal(base.Add(9*time.Minute)) {
		t.Fatalf("device = %+v", d)
	}
}

func TestWebSocket(t *testing.T) {
	e := newEnv(t, "")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	wsURL := "ws" + strings.TrimPrefix(e.srv.URL, "http") + "/api/v1/ws"

	if _, resp, err := websocket.Dial(ctx, wsURL+"?token=bad", nil); err == nil || resp == nil || resp.StatusCode != 401 {
		t.Fatalf("bad token: err=%v resp=%v", err, resp)
	}

	c, _, err := websocket.Dial(ctx, wsURL+"?token="+e.token, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()

	var d store.Device
	e.do("POST", "/api/v1/devices", e.token, map[string]string{"name": "Van", "imei": "356307042441099"}, 201, &d)
	e.do("DELETE", "/api/v1/devices/"+itoa(d.ID), e.token, nil, 204, nil)

	for _, want := range []string{"device", "deleted"} {
		_, data, err := c.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var msg struct {
			Type string          `json:"type"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(data, &msg); err != nil || msg.Type != want {
			t.Fatalf("got %s, want type %q", data, want)
		}
		if want == "deleted" && string(msg.Data) != `{"id":`+itoa(d.ID)+`}` {
			t.Fatalf("deleted payload %s", msg.Data)
		}
	}
}

func TestSPAAndCORS(t *testing.T) {
	dir := t.TempDir()
	must := func(err error) {
		if err != nil {
			t.Fatal(err)
		}
	}
	must(os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>app</html>"), 0o644))
	must(os.Mkdir(filepath.Join(dir, "assets"), 0o755))
	must(os.WriteFile(filepath.Join(dir, "assets", "app.js"), []byte("console.log(1)"), 0o644))
	e := newEnv(t, dir)

	get := func(path string) (int, string, http.Header) {
		resp, err := http.Get(e.srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b), resp.Header
	}
	if _, body, _ := get("/../../etc/passwd"); strings.Contains(body, "root:") {
		t.Error("path traversal")
	}
	for _, p := range []string{"/", "/devices/12", "/history?x=1"} {
		if code, body, _ := get(p); code != 200 || body != "<html>app</html>" {
			t.Errorf("GET %s = %d %q, want index.html", p, code, body)
		}
	}
	if code, body, h := get("/assets/app.js"); code != 200 || body != "console.log(1)" || !strings.Contains(h.Get("Cache-Control"), "immutable") {
		t.Errorf("asset = %d %q %v", code, body, h)
	}
	if code, _, _ := get("/assets/missing.js"); code != 404 {
		t.Errorf("missing asset = %d, want 404", code)
	}
	if code, body, _ := get("/api/v1/unknown"); code != 404 || !strings.Contains(body, `"error"`) {
		t.Errorf("unknown API path = %d %q", code, body)
	}

	req, _ := http.NewRequest("OPTIONS", e.srv.URL+"/api/v1/devices", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("Access-Control-Request-Method", "POST")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 204 || resp.Header.Get("Access-Control-Allow-Origin") != "*" ||
		!strings.Contains(resp.Header.Get("Access-Control-Allow-Headers"), "Authorization") {
		t.Fatalf("preflight = %d %v", resp.StatusCode, resp.Header)
	}

	// JSON responses are gzip-compressed when the client accepts it.
	req, _ = http.NewRequest("GET", e.srv.URL+"/api/v1/devices", nil)
	req.Header.Set("Authorization", "Bearer "+e.token)
	req.Header.Set("Accept-Encoding", "gzip")
	resp, err = http.DefaultTransport.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.Header.Get("Content-Encoding") != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", resp.Header.Get("Content-Encoding"))
	}
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
