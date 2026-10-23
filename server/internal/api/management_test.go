package api

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

func (e *env) dialWSAs(ctx context.Context, token string) *websocket.Conn {
	e.t.Helper()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(e.srv.URL, "http")+"/api/v1/ws?token="+token, nil)
	if err != nil {
		e.t.Fatal(err)
	}
	e.t.Cleanup(func() { c.CloseNow() })
	return c
}

// fleet3 creates three devices; devices 0 and 1 are in group "North".
func fleet3(e *env) ([]store.Device, store.Group) {
	e.t.Helper()
	var ds []store.Device
	for i, imei := range []string{"356307042441013", "356307042441014", "356307042441015"} {
		var d store.Device
		e.do("POST", "/api/v1/devices", e.token, map[string]any{"name": "T" + itoa(int64(i)), "imei": imei}, 201, &d)
		ds = append(ds, d)
	}
	var g store.Group
	e.do("POST", "/api/v1/groups", e.token, map[string]any{"name": "North", "deviceIds": []int64{ds[0].ID, ds[1].ID}}, 201, &g)
	return ds, g
}

func TestAccessControlMatrix(t *testing.T) {
	e := newEnv(t, "")
	ctx := context.Background()
	ds, g := fleet3(e)
	in, out := ds[0], ds[2]
	mgr := e.roleToken("mgr@x.io", store.RoleManager, g.ID)
	viewer := e.roleToken("viewer@x.io", store.RoleViewer, g.ID)

	// Positions for every device, so data endpoints have something to leak.
	now := time.Now().UTC().Truncate(time.Second)
	for _, d := range ds {
		if err := e.store.Positions(ctx, []domain.Position{{IMEI: d.IMEI, DeviceTime: now.Add(-time.Minute), Latitude: 25,
			Longitude: 55, Speed: 50, Valid: true, Attributes: map[string]any{"alarm": "sos"}}}); err != nil {
			t.Fatal(err)
		}
	}
	time.Sleep(100 * time.Millisecond) // events are emitted on the ingest hook

	type tc struct {
		method, path string
		body         any
		admin, man   int
		view         int
	}
	inP, outP := "/api/v1/devices/"+itoa(in.ID), "/api/v1/devices/"+itoa(out.ID)
	cases := []tc{
		{"GET", inP, nil, 200, 200, 200},
		{"GET", outP, nil, 200, 404, 404},
		{"GET", inP + "/positions", nil, 200, 200, 200},
		{"GET", outP + "/positions", nil, 200, 404, 404},
		{"GET", outP + "/trips", nil, 200, 404, 404},
		{"GET", outP + "/commands", nil, 200, 404, 404},
		{"POST", outP + "/commands", map[string]string{"type": "getInfo"}, 202, 404, 403},
		{"POST", inP + "/commands", map[string]string{"type": "getInfo"}, 202, 202, 403},
		{"POST", inP + "/commands", map[string]string{"type": "engineStop"}, 202, 403, 403},
		{"PATCH", inP, map[string]any{"plate": "X-1"}, 200, 200, 403},
		{"PATCH", outP, map[string]any{"plate": "X-1"}, 200, 404, 403},
		{"PATCH", inP, map[string]any{"groupIds": []int64{g.ID}}, 200, 403, 403},
		{"POST", "/api/v1/devices", map[string]any{"name": "x", "imei": "356307042441099"}, 201, 403, 403},
		{"POST", "/api/v1/geofences", map[string]any{"name": "Z", "type": "circle", "center": []float64{55, 25}, "radius": 100, "deviceIds": []int64{in.ID}}, 201, 201, 403},
		{"POST", "/api/v1/geofences", map[string]any{"name": "Z", "type": "circle", "center": []float64{55, 25}, "radius": 100}, 201, 403, 403},
		{"POST", "/api/v1/geofences", map[string]any{"name": "Z", "type": "circle", "center": []float64{55, 25}, "radius": 100, "deviceIds": []int64{out.ID}}, 201, 403, 403},
		{"GET", "/api/v1/users", nil, 200, 403, 403},
		{"POST", "/api/v1/groups", map[string]any{"name": "G2"}, 201, 403, 403},
		{"POST", "/api/v1/maintenance", map[string]any{"deviceId": out.ID, "name": "Oil", "intervalDays": 10}, 201, 400, 403},
		{"POST", "/api/v1/maintenance", map[string]any{"deviceId": in.ID, "name": "Oil", "intervalDays": 10}, 201, 201, 403},
		{"POST", "/api/v1/expenses", map[string]any{"deviceId": in.ID, "category": "fuel", "amount": 10}, 201, 201, 403},
		{"POST", "/api/v1/drivers", map[string]any{"name": "D", "deviceId": out.ID}, 201, 400, 403},
		{"POST", outP + "/share", map[string]any{"hours": 1}, 201, 404, 403},
		{"PATCH", "/api/v1/settings", map[string]any{"speedLimit": 90}, 200, 403, 403},
	}
	for _, c := range cases {
		e.do(c.method, c.path, e.token, c.body, c.admin, nil)
		e.do(c.method, c.path, mgr, c.body, c.man, nil)
		e.do(c.method, c.path, viewer, c.body, c.view, nil)
	}

	// Lists are filtered.
	var list []store.Device
	e.do("GET", "/api/v1/devices", viewer, nil, 200, &list)
	if len(list) != 2 || list[0].GroupIDs[0] != g.ID {
		t.Fatalf("viewer devices %+v", list)
	}
	var sum store.Summary
	e.do("GET", "/api/v1/summary", viewer, nil, 200, &sum)
	if sum.Total != 2 {
		t.Fatalf("viewer summary %+v", sum)
	}
	var evs []store.Event
	e.do("GET", "/api/v1/events", viewer, nil, 200, &evs)
	for _, ev := range evs {
		if ev.DeviceID == out.ID {
			t.Fatalf("viewer sees event of device %d", out.ID)
		}
	}
	e.do("GET", "/api/v1/events?deviceId="+itoa(out.ID), viewer, nil, 200, &evs)
	if len(evs) != 0 {
		t.Fatalf("filtered events %+v", evs)
	}
	var all []store.Event
	e.do("GET", "/api/v1/events", e.token, nil, 200, &all)
	if len(all) != 3 {
		t.Fatalf("admin events %d", len(all))
	}
	var gfs []store.Geofence
	e.do("GET", "/api/v1/geofences", viewer, nil, 200, &gfs)
	for _, gf := range gfs {
		for _, id := range gf.DeviceIDs {
			if id == out.ID {
				t.Fatalf("viewer sees geofence assignment %+v", gf)
			}
		}
	}
	if len(gfs) != 2 { // the in-group one (×2 created) is visible; the global one too; the out-of-group one is not
		var adminG []store.Geofence
		e.do("GET", "/api/v1/geofences", e.token, nil, 200, &adminG)
		if len(gfs) != len(adminG)-1 {
			t.Fatalf("viewer geofences %d of %d", len(gfs), len(adminG))
		}
	}
	var groups []store.Group
	e.do("GET", "/api/v1/groups", viewer, nil, 200, &groups)
	if len(groups) != 1 {
		t.Fatalf("viewer groups %+v", groups)
	}
	var ms []store.Maintenance
	e.do("GET", "/api/v1/maintenance", mgr, nil, 200, &ms)
	if len(ms) != 2 { // admin's and manager's item on the in-group device
		t.Fatalf("manager maintenance %+v", ms)
	}
	e.do("GET", "/api/v1/maintenance?deviceId="+itoa(out.ID), mgr, nil, 200, &ms)
	if len(ms) != 0 {
		t.Fatalf("out-of-scope maintenance %+v", ms)
	}

	// Removing the device from the group hides it immediately.
	e.do("PATCH", "/api/v1/groups/"+itoa(g.ID), e.token, map[string]any{"deviceIds": []int64{ds[1].ID}}, 200, nil)
	e.do("GET", inP, viewer, nil, 404, nil)
	// Deactivated users lose access with their existing token.
	var users []store.User
	e.do("GET", "/api/v1/users", e.token, nil, 200, &users)
	for _, u := range users {
		if u.Email == "viewer@x.io" {
			e.do("PATCH", "/api/v1/users/"+itoa(u.ID), e.token, map[string]any{"active": false}, 200, nil)
		}
	}
	e.do("GET", "/api/v1/devices", viewer, nil, 401, nil)
	e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": "viewer@x.io", "password": "secret1"}, 403, nil)
}

func TestWebSocketScope(t *testing.T) {
	e := newEnv(t, "")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ds, g := fleet3(e)
	viewer := e.roleToken("viewer@x.io", store.RoleViewer, g.ID)
	vws := e.dialWSAs(ctx, viewer)
	aws := e.dialWSAs(ctx, e.token)
	time.Sleep(100 * time.Millisecond) // let both subscriptions register

	at := time.Now().UTC().Truncate(time.Second)
	for i, d := range []store.Device{ds[2], ds[0]} { // out-of-group first
		if err := e.store.Positions(ctx, []domain.Position{{IMEI: d.IMEI, DeviceTime: at.Add(time.Duration(i) * time.Second),
			Latitude: 25, Longitude: 55, Valid: true, Attributes: map[string]any{}}}); err != nil {
			t.Fatal(err)
		}
	}
	// Admin gets both; the viewer's first position is the in-group device's.
	var p domain.Position
	_ = json.Unmarshal(waitWS(t, ctx, aws, "position").Data, &p)
	if p.DeviceID != ds[2].ID {
		t.Fatalf("admin first position %d", p.DeviceID)
	}
	_ = json.Unmarshal(waitWS(t, ctx, vws, "position").Data, &p)
	if p.DeviceID != ds[0].ID {
		t.Fatalf("viewer received position of device %d (not in its groups)", p.DeviceID)
	}

	// Group change: the viewer is told it lost ds[0] and gained ds[2].
	e.do("PATCH", "/api/v1/groups/"+itoa(g.ID), e.token, map[string]any{"deviceIds": []int64{ds[1].ID, ds[2].ID}}, 200, nil)
	got := map[string]int64{}
	for len(got) < 2 {
		_, data, err := vws.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var m struct {
			Type string `json:"type"`
			Data struct {
				ID int64 `json:"id"`
			} `json:"data"`
		}
		_ = json.Unmarshal(data, &m)
		if m.Type == store.EventAccess {
			t.Fatal("internal access frame forwarded")
		}
		if (m.Type == "deleted" && m.Data.ID == ds[0].ID) || (m.Type == "device" && m.Data.ID == ds[2].ID) {
			got[m.Type] = m.Data.ID
		}
	}
	if err := e.store.Positions(ctx, []domain.Position{{IMEI: ds[0].IMEI, DeviceTime: at.Add(10 * time.Second), Latitude: 25,
		Longitude: 55, Valid: true, Attributes: map[string]any{}}, {IMEI: ds[2].IMEI, DeviceTime: at.Add(11 * time.Second),
		Latitude: 25, Longitude: 55, Valid: true, Attributes: map[string]any{}}}); err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal(waitWS(t, ctx, vws, "position").Data, &p)
	if p.DeviceID != ds[2].ID {
		t.Fatalf("after regrouping viewer received device %d", p.DeviceID)
	}
}

func TestUsersAndMe(t *testing.T) {
	e := newEnv(t, "")
	var g store.Group
	e.do("POST", "/api/v1/groups", e.token, map[string]any{"name": "G", "color": "#ABC"}, 201, &g)
	if g.Color != "#abc" || g.DeviceIDs == nil {
		t.Fatalf("group %+v", g)
	}
	var u store.User
	e.do("POST", "/api/v1/users", e.token, map[string]any{"email": "a@b.co", "password": "123", "role": "viewer"}, 400, nil)
	e.do("POST", "/api/v1/users", e.token, map[string]any{"email": "a@b.co", "password": "123456", "role": "boss"}, 400, nil)
	e.do("POST", "/api/v1/users", e.token, map[string]any{"email": "a@b.co", "name": "Ann", "password": "123456",
		"role": "manager", "groupIds": []int64{g.ID}}, 201, &u)
	if u.Role != "manager" || len(u.GroupIDs) != 1 || !u.Active || u.CreatedAt.IsZero() {
		t.Fatalf("user %+v", u)
	}
	e.do("POST", "/api/v1/users", e.token, map[string]any{"email": "A@b.co", "password": "123456", "role": "viewer"}, 400, nil)

	var me store.User
	e.do("GET", "/api/v1/me", e.token, nil, 200, &me)
	if me.LastLoginAt == nil || me.GroupIDs == nil {
		t.Fatalf("me %+v", me)
	}
	// Admin safety over HTTP.
	e.do("PATCH", "/api/v1/users/"+itoa(me.ID), e.token, map[string]any{"role": "viewer"}, 400, nil)
	e.do("DELETE", "/api/v1/users/"+itoa(me.ID), e.token, nil, 400, nil)
	e.do("PATCH", "/api/v1/users/999", e.token, map[string]any{"name": "x"}, 404, nil)

	// PATCH /me: password change requires the current password.
	var login struct{ Token string }
	e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": "a@b.co", "password": "123456"}, 200, &login)
	e.do("PATCH", "/api/v1/me", login.Token, map[string]any{"newPassword": "abcdefg"}, 400, nil)
	e.do("PATCH", "/api/v1/me", login.Token, map[string]any{"currentPassword": "wrong", "newPassword": "abcdefg"}, 400, nil)
	e.do("PATCH", "/api/v1/me", login.Token, map[string]any{"currentPassword": "123456", "newPassword": "abc"}, 400, nil)
	var upd store.User
	e.do("PATCH", "/api/v1/me", login.Token, map[string]any{"name": "Anna", "currentPassword": "123456", "newPassword": "abcdefg"}, 200, &upd)
	if upd.Name != "Anna" || upd.Role != "manager" {
		t.Fatalf("updated %+v", upd)
	}
	e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": "a@b.co", "password": "123456"}, 401, nil)
	e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": "a@b.co", "password": "abcdefg"}, 200, nil)

	e.do("DELETE", "/api/v1/users/"+itoa(u.ID), e.token, nil, 204, nil)
	e.do("GET", "/api/v1/me", login.Token, nil, 401, nil)
	e.do("DELETE", "/api/v1/groups/"+itoa(g.ID), e.token, nil, 204, nil)
	e.do("DELETE", "/api/v1/groups/"+itoa(g.ID), e.token, nil, 404, nil)
}

func TestFleetOpsHTTP(t *testing.T) {
	e := newEnv(t, "")
	var d store.Device
	e.do("POST", "/api/v1/devices", e.token, map[string]any{"name": "T", "imei": "356307042441013"}, 201, &d)
	if d.GroupIDs == nil || d.Odometer != 0 || d.DriverID != nil {
		t.Fatalf("device %+v", d)
	}
	// Calibrate counters and assign a driver through PATCH /devices.
	var drv store.Driver
	e.do("POST", "/api/v1/drivers", e.token, map[string]any{"name": "Ahmed", "tag": "a1b2", "licenseExpiry": "2027-01-31"}, 201, &drv)
	e.do("PATCH", "/api/v1/devices/"+itoa(d.ID), e.token, map[string]any{"odometer": 80000, "engineHours": 700, "driverId": drv.ID}, 200, &d)
	if d.Odometer != 80000 || d.EngineHours != 700 || d.DriverID == nil || *d.DriverID != drv.ID {
		t.Fatalf("patched %+v", d)
	}
	e.do("PATCH", "/api/v1/drivers/"+itoa(drv.ID), e.token, map[string]any{"deviceId": nil, "licenseExpiry": nil}, 200, &drv)
	if drv.DeviceID != nil || drv.LicenseExpiry != nil || drv.Tag != "A1B2" {
		t.Fatalf("driver %+v", drv)
	}

	var m store.Maintenance
	e.do("POST", "/api/v1/maintenance", e.token, map[string]any{"deviceId": d.ID, "name": "Oil change", "intervalKm": 10000,
		"notifyBeforeKm": 500, "lastServiceKm": 70400}, 201, &m)
	if m.Status != store.DueSoon || *m.RemainingKm != 400 {
		t.Fatalf("maintenance %+v", m)
	}
	e.do("POST", "/api/v1/maintenance/"+itoa(m.ID)+"/complete", e.token, map[string]any{"date": "2026-10-20", "cost": 120.5, "notes": "synthetic oil"}, 200, &m)
	if m.Status != store.DueOK || m.LastServiceKm != 80000 || m.LastServiceDate != "2026-10-20" {
		t.Fatalf("completed %+v", m)
	}
	var hist []store.ServiceRecord
	e.do("GET", "/api/v1/maintenance/"+itoa(m.ID)+"/history", e.token, nil, 200, &hist)
	var exps []store.Expense
	e.do("GET", "/api/v1/expenses?category=maintenance&from=2026-10-01&to=2026-10-31", e.token, nil, 200, &exps)
	if len(hist) != 1 || len(exps) != 1 || exps[0].Amount != 120.5 {
		t.Fatalf("history %+v expenses %+v", hist, exps)
	}
	e.do("GET", "/api/v1/expenses?from=nope", e.token, nil, 400, nil)
	e.do("PATCH", "/api/v1/expenses/"+itoa(exps[0].ID), e.token, map[string]any{"liters": 4.5}, 200, nil)
	e.do("DELETE", "/api/v1/expenses/"+itoa(exps[0].ID), e.token, nil, 204, nil)

	var rm store.Reminder
	e.do("POST", "/api/v1/reminders", e.token, map[string]any{"deviceId": d.ID, "kind": "insurance", "title": "Insurance",
		"dueDate": time.Now().UTC().AddDate(0, 0, 3).Format(time.DateOnly)}, 201, &rm)
	if rm.Status != store.DueSoon || rm.NotifyDaysBefore != 14 {
		t.Fatalf("reminder %+v", rm)
	}
	var rms []store.Reminder
	e.do("GET", "/api/v1/reminders?deviceId="+itoa(d.ID), e.token, nil, 200, &rms)
	if len(rms) != 1 {
		t.Fatalf("reminders %+v", rms)
	}
	e.do("DELETE", "/api/v1/reminders/"+itoa(rm.ID), e.token, nil, 204, nil)
	e.do("DELETE", "/api/v1/maintenance/"+itoa(m.ID), e.token, nil, 204, nil)

	// Share links: create, public read without IMEI, revoke → 410.
	var l store.ShareLink
	e.do("POST", "/api/v1/devices/"+itoa(d.ID)+"/share", e.token, map[string]any{"hours": 0}, 400, nil)
	e.do("POST", "/api/v1/devices/"+itoa(d.ID)+"/share", e.token, map[string]any{"hours": 2}, 201, &l)
	if l.URL != "/share/"+l.Token || time.Until(l.ExpiresAt) < 119*time.Minute {
		t.Fatalf("share %+v", l)
	}
	if err := e.store.Positions(context.Background(), []domain.Position{{IMEI: d.IMEI, DeviceTime: time.Now().UTC(),
		Latitude: 25, Longitude: 55, Valid: true, Attributes: map[string]any{"ignition": true, "power": 13.8}}}); err != nil {
		t.Fatal(err)
	}
	var pub map[string]any
	e.do("GET", "/api/v1/public/share/"+l.Token, "", nil, 200, &pub)
	raw, _ := json.Marshal(pub)
	if pub["name"] != "T" || pub["position"] == nil || strings.Contains(string(raw), d.IMEI) || strings.Contains(string(raw), "power") {
		t.Fatalf("public share %s", raw)
	}
	var ls []store.ShareLink
	e.do("GET", "/api/v1/devices/"+itoa(d.ID)+"/shares", e.token, nil, 200, &ls)
	if len(ls) != 1 {
		t.Fatalf("shares %+v", ls)
	}
	e.do("DELETE", "/api/v1/shares/"+l.Token, e.token, nil, 204, nil)
	e.do("GET", "/api/v1/public/share/"+l.Token, "", nil, 410, nil)
	e.do("GET", "/api/v1/public/share/unknown", "", nil, 404, nil)
}
