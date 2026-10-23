package api

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// raw performs a GET and returns status, headers and body.
func (e *env) raw(path, token string) (int, http.Header, []byte) {
	e.t.Helper()
	req, _ := http.NewRequest("GET", e.srv.URL+path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, resp.Header, b
}

type reportBody struct {
	Type    string           `json:"type"`
	Columns []map[string]any `json:"columns"`
	Rows    []map[string]any `json:"rows"`
	Totals  map[string]any   `json:"totals"`
}

func TestAnalyticsAPI(t *testing.T) {
	e := newEnv(t, "")
	ctx := context.Background()
	var d1, d2 store.Device
	e.do("POST", "/api/v1/devices", e.token, map[string]any{"name": "Truck 1", "imei": "356307042441013"}, 201, &d1)
	e.do("POST", "/api/v1/devices", e.token, map[string]any{"name": "Truck 2", "imei": "356307042441014"}, 201, &d2)
	g, err := e.store.CreateGroup(ctx, store.GroupInput{Name: "North", DeviceIDs: []int64{d1.ID}})
	if err != nil {
		t.Fatal(err)
	}
	viewer := e.roleToken("viewer@fleet.local", store.RoleViewer, g.ID)
	manager := e.roleToken("manager@fleet.local", store.RoleManager, g.ID)

	// A short drive for both devices.
	now := time.Now().UTC().Truncate(time.Second)
	for _, d := range []store.Device{d1, d2} {
		var batch []domain.Position
		for i := 0; i < 20; i++ {
			batch = append(batch, domain.Position{IMEI: d.IMEI, Protocol: "teltonika",
				DeviceTime: now.Add(time.Duration(i-30) * time.Minute), Latitude: 2.03 + float64(i)*0.005, Longitude: 45.3,
				Speed: 50, Valid: true, Satellites: 8, Attributes: map[string]any{"ignition": true}})
		}
		if ok, err := e.store.Authorize(ctx, d.IMEI, "teltonika"); !ok || err != nil {
			t.Fatal(ok, err)
		}
		if err := e.store.Positions(ctx, batch); err != nil {
			t.Fatal(err)
		}
	}

	// Report types.
	var types []map[string]string
	e.do("GET", "/api/v1/reports", viewer, nil, 200, &types)
	if len(types) != 15 { // 13 Phase 3 + fuel, temperature (Phase 4a)
		t.Fatalf("types %v", types)
	}

	// Viewer reads reports but only sees the devices of their groups.
	var rep reportBody
	e.do("GET", "/api/v1/reports/summary", viewer, nil, 200, &rep)
	if len(rep.Rows) != 1 || rep.Rows[0]["device"] != "Truck 1" || rep.Rows[0]["distance"].(float64) <= 0 {
		t.Fatalf("viewer summary %+v", rep)
	}
	e.do("GET", "/api/v1/reports/summary", e.token, nil, 200, &rep)
	if len(rep.Rows) != 2 {
		t.Fatalf("admin summary %+v", rep.Rows)
	}
	e.do("GET", "/api/v1/reports/trips?deviceIds="+itoa(d2.ID), viewer, nil, 404, nil)
	e.do("GET", "/api/v1/reports/trips?deviceIds="+itoa(d2.ID), e.token, nil, 200, &rep)
	if len(rep.Rows) != 1 || rep.Rows[0]["deviceId"].(float64) != float64(d2.ID) {
		t.Fatalf("trips %+v", rep.Rows)
	}
	e.do("GET", "/api/v1/reports/summary?groupId="+itoa(g.ID), e.token, nil, 200, &rep)
	if len(rep.Rows) != 1 {
		t.Fatalf("group filter %+v", rep.Rows)
	}
	e.do("GET", "/api/v1/reports/summary?groupId=999", e.token, nil, 404, nil)
	e.do("GET", "/api/v1/reports/bogus", e.token, nil, 404, nil)
	e.do("GET", "/api/v1/reports/summary?format=doc", e.token, nil, 400, nil)
	e.do("GET", "/api/v1/reports/summary?tz=Mars/Base", e.token, nil, 400, nil)
	from := now.Add(-100 * 24 * time.Hour).Format(time.RFC3339)
	e.do("GET", "/api/v1/reports/summary?from="+from, e.token, nil, 400, nil)
	e.do("GET", "/api/v1/reports/summary", "", nil, 401, nil)

	// Exports.
	for _, c := range []struct{ format, ctype, magic string }{
		{"csv", "text/csv; charset=utf-8", "\xEF\xBB\xBF"},
		{"xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "PK"},
		{"pdf", "application/pdf", "%PDF-"},
	} {
		code, h, body := e.raw("/api/v1/reports/trips?tz=Africa/Mogadishu&format="+c.format, viewer)
		if code != 200 || h.Get("Content-Type") != c.ctype || !bytes.HasPrefix(body, []byte(c.magic)) {
			t.Fatalf("%s: %d %v %q", c.format, code, h, body[:min(len(body), 20)])
		}
		cd := h.Get("Content-Disposition")
		if !strings.HasPrefix(cd, `attachment; filename="trips_`) || !strings.HasSuffix(cd, "."+c.format+`"`) {
			t.Fatalf("disposition %q", cd)
		}
	}

	// Dashboard is scoped too.
	var dash struct {
		DistanceByDay []map[string]any `json:"distanceByDay"`
		TopVehicles   []map[string]any `json:"topVehicles"`
		Expenses      map[string]any   `json:"expenses"`
		Utilization   float64          `json:"utilization"`
	}
	e.do("GET", "/api/v1/dashboard?days=7", viewer, nil, 200, &dash)
	if len(dash.DistanceByDay) != 7 || len(dash.TopVehicles) != 1 || dash.Expenses["currency"] != "USD" {
		t.Fatalf("dashboard %+v", dash)
	}
	e.do("GET", "/api/v1/dashboard?days=0", viewer, nil, 400, nil)

	// Places: everyone reads, admin/manager write.
	place := map[string]any{"name": "Main depot", "category": "depot", "lat": 2.03, "lng": 45.3, "radius": 300}
	e.do("POST", "/api/v1/places", viewer, place, 403, nil)
	var p store.Place
	e.do("POST", "/api/v1/places", manager, place, 201, &p)
	if p.Color != "#ffd700" || p.Radius != 300 {
		t.Fatalf("place %+v", p)
	}
	e.do("POST", "/api/v1/places", e.token, map[string]any{"name": "x", "lat": 2}, 400, nil)
	e.do("POST", "/api/v1/places", e.token, map[string]any{"name": "x", "lat": 2, "lng": 3, "category": "zoo"}, 400, nil)
	e.do("PATCH", "/api/v1/places/"+itoa(p.ID), viewer, map[string]any{"name": "y"}, 403, nil)
	e.do("PATCH", "/api/v1/places/"+itoa(p.ID), e.token, map[string]any{"name": "Depot A"}, 200, &p)
	var places []store.Place
	e.do("GET", "/api/v1/places", viewer, nil, 200, &places)
	if len(places) != 1 || places[0].Name != "Depot A" {
		t.Fatalf("places %+v", places)
	}

	// Geocode: the place wins; elsewhere coordinates (geocoder off in tests).
	var geo struct {
		Address string       `json:"address"`
		Place   *store.Place `json:"place"`
	}
	e.do("GET", "/api/v1/geocode?lat=2.0301&lng=45.3", viewer, nil, 200, &geo)
	if geo.Address != "Depot A" || geo.Place == nil || geo.Place.ID != p.ID {
		t.Fatalf("geocode %+v", geo)
	}
	e.do("GET", "/api/v1/geocode?lat=10&lng=10", viewer, nil, 200, &geo)
	if geo.Address != "10.00000, 10.00000" || geo.Place != nil {
		t.Fatalf("geocode %+v", geo)
	}
	e.do("GET", "/api/v1/geocode?lat=100&lng=10", viewer, nil, 400, nil)

	// Trip addresses use the place name.
	e.do("GET", "/api/v1/reports/trips?deviceIds="+itoa(d1.ID), viewer, nil, 200, &rep)
	if rep.Rows[0]["startAddress"] != "Depot A" {
		t.Fatalf("startAddress %v", rep.Rows[0]["startAddress"])
	}

	e.do("DELETE", "/api/v1/places/"+itoa(p.ID), viewer, nil, 403, nil)
	e.do("DELETE", "/api/v1/places/"+itoa(p.ID), manager, nil, 204, nil)
	e.do("DELETE", "/api/v1/places/"+itoa(p.ID), manager, nil, 404, nil)
}

func TestPhase3Settings(t *testing.T) {
	e := newEnv(t, "")
	var s map[string]any
	e.do("GET", "/api/v1/settings", e.token, nil, 200, &s)
	if s["currency"] != "USD" || s["idleAlertMinutes"] != 0.0 || s["harshScoring"] != true {
		t.Fatalf("defaults %v", s)
	}
	e.do("PATCH", "/api/v1/settings", e.token, map[string]any{"currency": "sos", "idleAlertMinutes": 15, "harshScoring": false}, 200, &s)
	if s["currency"] != "SOS" || s["idleAlertMinutes"] != 15.0 || s["harshScoring"] != false {
		t.Fatalf("patched %v", s)
	}
	e.do("PATCH", "/api/v1/settings", e.token, map[string]any{"currency": "DOLLARS"}, 400, nil)
	e.do("PATCH", "/api/v1/settings", e.token, map[string]any{"idleAlertMinutes": 1.5}, 400, nil)
	e.do("PATCH", "/api/v1/settings", e.token, map[string]any{"idleAlertMinutes": 2000}, 400, nil)

	// New event types: notification defaults and /events filter.
	var prefs struct {
		Events map[string]store.Channels `json:"events"`
	}
	e.do("GET", "/api/v1/me/notifications", e.token, nil, 200, &prefs)
	for _, typ := range []string{"harshAcceleration", "harshBraking", "harshCornering", "idle"} {
		if prefs.Events[typ] != (store.Channels{InApp: true}) {
			t.Fatalf("%s default %+v", typ, prefs.Events[typ])
		}
	}
	for _, typ := range []string{"maintenanceDue", "documentExpiry"} {
		if prefs.Events[typ] != (store.Channels{InApp: true, Telegram: true, Push: true}) {
			t.Fatalf("%s default %+v", typ, prefs.Events[typ])
		}
	}
	e.do("PUT", "/api/v1/me/notifications", e.token, map[string]any{"events": map[string]any{
		"idle": map[string]bool{"inApp": true, "telegram": true, "push": false}}}, 200, &prefs)
	if !prefs.Events["idle"].Telegram {
		t.Fatal("idle prefs not saved")
	}
	e.do("GET", "/api/v1/events?type=harshBraking,idle,maintenanceDue", e.token, nil, 200, nil)
}
