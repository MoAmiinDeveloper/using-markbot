package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// userToken creates a viewer (no groups) and returns its token.
func (e *env) userToken() string {
	e.t.Helper()
	return e.roleToken("user@fleet.local", store.RoleViewer)
}

// roleToken creates a user with the given role and groups and returns its token.
func (e *env) roleToken(email, role string, groups ...int64) string {
	e.t.Helper()
	if _, err := e.store.CreateUserFull(context.Background(), store.UserInput{Email: email, Name: role,
		Password: "secret1", Role: role, GroupIDs: groups}); err != nil {
		e.t.Fatal(err)
	}
	var login struct{ Token string }
	e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": email, "password": "secret1"}, 200, &login)
	return login.Token
}

type wsMsg struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// dialWS subscribes to live events.
func (e *env) dialWS(ctx context.Context) *websocket.Conn {
	e.t.Helper()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(e.srv.URL, "http")+"/api/v1/ws?token="+e.token, nil)
	if err != nil {
		e.t.Fatal(err)
	}
	e.t.Cleanup(func() { c.CloseNow() })
	return c
}

// waitWS reads frames until one of type typ arrives.
func waitWS(t *testing.T, ctx context.Context, c *websocket.Conn, typ string) wsMsg {
	t.Helper()
	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			t.Fatalf("waiting for %q: %v", typ, err)
		}
		var m wsMsg
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatal(err)
		}
		if m.Type == typ {
			return m
		}
	}
}

func TestPhase2Authz(t *testing.T) {
	e := newEnv(t, "")
	user := e.userToken()
	var d store.Device
	e.do("POST", "/api/v1/devices", e.token, map[string]any{"name": "T", "imei": "356307042441013", "speedLimit": 80}, 201, &d)
	if d.SpeedLimit != 80 || d.Source != "direct" || d.Commands {
		t.Fatalf("device %+v", d)
	}
	circle := map[string]any{"name": "Depot", "type": "circle", "center": []float64{55.27, 25.2}, "radius": 250}

	e.do("POST", "/api/v1/geofences", user, circle, 403, nil)
	e.do("PATCH", "/api/v1/geofences/1", user, map[string]any{"name": "x"}, 403, nil)
	e.do("DELETE", "/api/v1/geofences/1", user, nil, 403, nil)
	e.do("PATCH", "/api/v1/settings", user, map[string]any{"speedLimit": 50}, 403, nil)
	e.do("POST", "/api/v1/settings/traccar-token", user, nil, 403, nil)
	for _, typ := range []string{"engineStop", "engineResume", "custom"} {
		e.do("POST", "/api/v1/devices/"+itoa(d.ID)+"/commands", user, map[string]string{"type": typ, "text": "getver"}, 403, nil)
	}
	// Viewers cannot send any command; managers of the device's group can
	// send non-engine commands.
	e.do("POST", "/api/v1/devices/"+itoa(d.ID)+"/commands", user, map[string]string{"type": "getVersion"}, 403, nil)
	var g store.Group
	e.do("POST", "/api/v1/groups", e.token, map[string]any{"name": "G", "deviceIds": []int64{d.ID}}, 201, &g)
	mgr := e.roleToken("mgr@fleet.local", store.RoleManager, g.ID)
	for _, typ := range []string{"engineStop", "engineResume", "custom"} {
		e.do("POST", "/api/v1/devices/"+itoa(d.ID)+"/commands", mgr, map[string]string{"type": typ, "text": "getver"}, 403, nil)
	}
	user = mgr
	var c store.Command
	e.do("POST", "/api/v1/devices/"+itoa(d.ID)+"/commands", user, map[string]string{"type": "getVersion"}, 202, &c)
	if c.Status != "queued" || c.Text != "getver" || c.CompletedAt != nil {
		t.Fatalf("command %+v", c)
	}
	e.do("POST", "/api/v1/devices/"+itoa(d.ID)+"/commands", e.token, map[string]string{"type": "custom", "text": "getgps"}, 202, nil)
	e.do("POST", "/api/v1/devices/"+itoa(d.ID)+"/commands", e.token, map[string]string{"type": "fly"}, 400, nil)
	e.do("POST", "/api/v1/devices/999/commands", e.token, map[string]string{"type": "reboot"}, 404, nil)
	var cs []store.Command
	e.do("GET", "/api/v1/devices/"+itoa(d.ID)+"/commands?limit=1", user, nil, 200, &cs)
	if len(cs) != 1 || cs[0].Text != "getgps" {
		t.Fatalf("commands %+v", cs)
	}

	// Settings: secrets are hidden from non-admins; the bot token is write-only.
	var us, as map[string]any
	e.do("GET", "/api/v1/settings", user, nil, 200, &us)
	e.do("GET", "/api/v1/settings", e.token, nil, 200, &as)
	if us["traccarToken"] != "" || us["telegramBotToken"] != "" || us["speedLimit"] != 100.0 || us["telegramConfigured"] != false {
		t.Fatalf("user settings %v", us)
	}
	if tok, _ := as["traccarToken"].(string); len(tok) != 32 {
		t.Fatalf("admin settings %v", as)
	}
	var regen map[string]any
	e.do("POST", "/api/v1/settings/traccar-token", e.token, nil, 200, &regen)
	if regen["traccarToken"] == as["traccarToken"] {
		t.Fatal("token not regenerated")
	}
	e.do("PATCH", "/api/v1/settings", e.token, map[string]any{"speedLimit": 0}, 400, nil)
	e.do("PATCH", "/api/v1/settings", e.token, map[string]any{"overspeedMinDuration": 1.5}, 400, nil)
	var patched map[string]any
	e.do("PATCH", "/api/v1/settings", e.token, map[string]any{"speedLimit": 60, "overspeedMinDuration": 0}, 200, &patched)
	if patched["speedLimit"] != 60.0 || patched["overspeedMinDuration"] != 0.0 {
		t.Fatalf("patched %v", patched)
	}
	// Telegram API unreachable in tests: a token cannot be validated.
	e.do("PATCH", "/api/v1/settings", e.token, map[string]any{"telegramBotToken": "1:abc"}, 502, nil)
}

func TestGeofencesAndEvents(t *testing.T) {
	e := newEnv(t, "")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws := e.dialWS(ctx)

	for _, bad := range []map[string]any{
		{"name": "x", "type": "circle", "center": []float64{55.27, 25.2}, "radius": 5},
		{"name": "x", "type": "circle", "center": []float64{55.27, 95}, "radius": 100},
		{"name": "x", "type": "circle", "center": []float64{55.27, 25.2}, "radius": 100, "color": "blue"},
		{"name": "x", "type": "polygon", "polygon": [][]float64{{55, 25}, {55.1, 25}}},
		{"type": "circle", "center": []float64{55.27, 25.2}, "radius": 100},
	} {
		e.do("POST", "/api/v1/geofences", e.token, bad, 400, nil)
	}
	var g store.Geofence
	e.do("POST", "/api/v1/geofences", e.token, map[string]any{"name": "Depot", "color": "#22c55e", "type": "circle",
		"center": []float64{55.2708, 25.2048}, "radius": 3000}, 201, &g)
	if m := waitWS(t, ctx, ws, "geofences"); m.Data != nil {
		t.Fatalf("geofences message carries data: %s", m.Data)
	}
	var raw []map[string]any
	e.do("GET", "/api/v1/geofences", e.token, nil, 200, &raw)
	if len(raw) != 1 || raw[0]["polygon"] != nil || raw[0]["radius"] != 3000.0 || len(raw[0]["deviceIds"].([]any)) != 0 {
		t.Fatalf("geofences %v", raw)
	}
	e.do("PATCH", "/api/v1/geofences/"+itoa(g.ID), e.token, map[string]any{"color": "#ff0000"}, 200, nil)
	e.do("PATCH", "/api/v1/geofences/999", e.token, map[string]any{"color": "#ff0000"}, 404, nil)
	e.do("PATCH", "/api/v1/settings", e.token, map[string]any{"speedLimit": 50, "overspeedMinDuration": 0}, 200, nil)

	// Drive a device into the geofence above the speed limit.
	if ok, err := e.store.Authorize(ctx, "356307042441013", "teltonika"); !ok || err != nil {
		t.Fatal(ok, err)
	}
	t0 := time.Now().UTC().Add(-time.Minute).Truncate(time.Second)
	mk := func(sec int, lat, speed float64) domain.Position {
		return domain.Position{IMEI: "356307042441013", Protocol: "teltonika", DeviceTime: t0.Add(time.Duration(sec) * time.Second),
			Latitude: lat, Longitude: 55.2708, Speed: speed, Valid: true, Attributes: map[string]any{}}
	}
	if err := e.store.Positions(ctx, []domain.Position{mk(0, 25.5, 30)}); err != nil {
		t.Fatal(err)
	}
	if err := e.store.Positions(ctx, []domain.Position{mk(10, 25.2048, 70)}); err != nil {
		t.Fatal(err)
	}
	var ev store.Event
	m := waitWS(t, ctx, ws, "event")
	_ = json.Unmarshal(m.Data, &ev)
	if ev.ID == 0 {
		t.Fatalf("event %s", m.Data)
	}

	var evs []store.Event
	e.do("GET", "/api/v1/events", e.token, nil, 200, &evs)
	if len(evs) != 2 {
		t.Fatalf("events %+v", evs)
	}
	types := map[string]store.Event{}
	for _, ev := range evs {
		types[ev.Type] = ev
	}
	enter, ok := types["geofenceEnter"]
	if !ok || enter.GeofenceID == nil || *enter.GeofenceID != g.ID || enter.Message != "Device 441013 entered Depot" {
		t.Fatalf("enter %+v", enter)
	}
	if os, ok := types["overspeed"]; !ok || os.Attributes["limit"] != 50.0 || os.GeofenceID != nil {
		t.Fatalf("overspeed %+v", os)
	}
	e.do("GET", "/api/v1/events?type=overspeed&deviceId="+itoa(enter.DeviceID), e.token, nil, 200, &evs)
	if len(evs) != 1 || evs[0].Type != "overspeed" {
		t.Fatalf("filtered %+v", evs)
	}
	e.do("GET", "/api/v1/events?type=nope", e.token, nil, 400, nil)
	e.do("GET", "/api/v1/events?limit=0", e.token, nil, 400, nil)

	// Raw JSON: geofenceId is null for non-geofence events.
	var rawEvs []map[string]any
	e.do("GET", "/api/v1/events?type=overspeed", e.token, nil, 200, &rawEvs)
	if v, ok := rawEvs[0]["geofenceId"]; !ok || v != nil {
		t.Fatalf("geofenceId %v", rawEvs[0])
	}

	e.do("DELETE", "/api/v1/geofences/"+itoa(g.ID), e.token, nil, 204, nil)
	e.do("DELETE", "/api/v1/geofences/"+itoa(g.ID), e.token, nil, 404, nil)
}

const traccarBody = `{"position":{"id":0,"attributes":{"sat":9,"ignition":true,"motion":true,"batteryLevel":80,
"totalDistance":1234.5},"deviceId":3,"protocol":"osmand","serverTime":"2026-10-22T10:00:01.000+00:00",
"deviceTime":"2026-10-22T10:00:00.000+00:00","fixTime":"2026-10-22T10:00:00.000+00:00","outdated":false,
"valid":true,"latitude":25.1,"longitude":55.2,"altitude":5.0,"speed":10.0,"course":90.0,"accuracy":5.0},
"device":{"id":3,"name":"Courier phone","uniqueId":"864512345678","status":"online"}}`

func TestTraccarIngest(t *testing.T) {
	e := newEnv(t, "")
	var cfg map[string]any
	e.do("GET", "/api/v1/settings", e.token, nil, 200, &cfg)
	token := cfg["traccarToken"].(string)

	post := func(tok, body string, want int) {
		t.Helper()
		resp, err := http.Post(e.srv.URL+"/api/v1/ingest/traccar?token="+tok, "application/json", bytes.NewBufferString(body))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != want {
			t.Fatalf("POST traccar (token %q): status %d, want %d", tok, resp.StatusCode, want)
		}
	}
	post("", traccarBody, 401)
	post("wrong", traccarBody, 401)
	post(token, `{"position":{}}`, 400)
	post(token, traccarBody, 200)
	post(token, traccarBody, 200) // resend: deduplicated

	var list []store.Device
	e.do("GET", "/api/v1/devices", e.token, nil, 200, &list)
	if len(list) != 1 {
		t.Fatalf("devices %+v", list)
	}
	d := list[0]
	if d.Source != "traccar" || d.IMEI != "864512345678" || d.Name != "Courier phone" || d.Protocol != "osmand" ||
		d.Commands || d.Position == nil || d.Status != "moving" {
		t.Fatalf("bridged device %+v", d)
	}
	if p := d.Position; p.Speed != 18.52 || p.Satellites != 9 || p.Attributes["odometer"] != 1234.5 {
		t.Fatalf("position %+v", p)
	}
	var ps []domain.Position
	e.do("GET", "/api/v1/devices/"+itoa(d.ID)+"/positions?from=2026-10-22T00:00:00Z&to=2026-10-23T00:00:00Z", e.token, nil, 200, &ps)
	if len(ps) != 1 {
		t.Fatalf("positions %d", len(ps))
	}
	e.do("POST", "/api/v1/devices/"+itoa(d.ID)+"/commands", e.token, map[string]string{"type": "getInfo"}, 409, nil)
	// Bridged devices can still be edited although their id is not an IMEI.
	e.do("PATCH", "/api/v1/devices/"+itoa(d.ID), e.token, map[string]any{"name": "Courier", "speedLimit": 60}, 200, nil)
}

func TestNotificationsAPI(t *testing.T) {
	e := newEnv(t, "")
	var prefs struct {
		TelegramLinked bool                      `json:"telegramLinked"`
		Push           struct{ Enabled bool }    `json:"push"`
		Events         map[string]store.Channels `json:"events"`
	}
	e.do("GET", "/api/v1/me/notifications", e.token, nil, 200, &prefs)
	if prefs.TelegramLinked || prefs.Push.Enabled || len(prefs.Events) != len(store.NotifyEventTypes) || len(prefs.Events) != 22 || // 12 + 10 Phase 4a types
		prefs.Events["alarm"] != (store.Channels{InApp: true, Telegram: true, Push: true}) {
		t.Fatalf("defaults %+v", prefs)
	}
	e.do("PUT", "/api/v1/me/notifications", e.token, map[string]any{"events": map[string]any{
		"overspeed": map[string]bool{"inApp": true}}}, 200, &prefs)
	if prefs.Events["overspeed"] != (store.Channels{InApp: true}) || !prefs.Events["geofenceExit"].Telegram {
		t.Fatalf("updated %+v", prefs)
	}
	e.do("PUT", "/api/v1/me/notifications", e.token, map[string]any{"events": map[string]any{"bogus": map[string]bool{}}}, 400, nil)
	e.do("POST", "/api/v1/me/telegram/link", e.token, nil, 409, nil) // bot not configured
	e.do("DELETE", "/api/v1/me/telegram", e.token, nil, 204, nil)

	var key map[string]string
	e.do("GET", "/api/v1/push/vapid-key", e.token, nil, 200, &key)
	if len(key["publicKey"]) < 80 {
		t.Fatalf("vapid key %v", key)
	}
	e.do("POST", "/api/v1/push/subscriptions", e.token, map[string]any{"endpoint": "http://insecure"}, 400, nil)
	sub := map[string]any{"endpoint": "https://push.example.com/abc", "expirationTime": nil,
		"keys": map[string]string{"p256dh": "BOr", "auth": "xyz"}}
	e.do("POST", "/api/v1/push/subscriptions", e.token, sub, 201, nil)
	e.do("GET", "/api/v1/me/notifications", e.token, nil, 200, &prefs)
	if !prefs.Push.Enabled {
		t.Fatal("push should be enabled")
	}
	e.do("DELETE", "/api/v1/push/subscriptions", e.token, map[string]string{"endpoint": "https://push.example.com/abc"}, 204, nil)
	var res map[string]any
	e.do("POST", "/api/v1/me/notifications/test", e.token, nil, 200, &res)
	if res["telegram"] != false || res["push"] != 0.0 {
		t.Fatalf("test result %v", res)
	}
}
