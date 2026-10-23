package api

import (
	"context"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/mail/mailtest"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

func TestSMTPSettingsAPI(t *testing.T) {
	e := newEnv(t, "")
	var cfg settingsView
	e.do("GET", "/api/v1/settings", e.token, nil, 200, &cfg)
	if cfg.SMTP.Configured || cfg.SMTP.Port != 587 || cfg.SMTP.TLS != "starttls" {
		t.Fatalf("default smtp %+v", cfg.SMTP)
	}
	e.do("POST", "/api/v1/settings/smtp/test", e.token, map[string]string{"to": "a@example.com"}, 409, nil)

	srv := mailtest.New(t, false)
	e.do("PATCH", "/api/v1/settings", e.token, map[string]any{"smtp": map[string]any{"host": srv.Host, "port": srv.Port,
		"username": "fleet", "password": "pw", "from": "Somtel Fleet <fleet@example.com>", "tls": "none"}}, 200, &cfg)
	if !cfg.SMTP.Configured || cfg.SMTP.Password != "" || cfg.SMTP.Host != srv.Host || cfg.SMTP.Username != "fleet" {
		t.Fatalf("smtp view %+v", cfg.SMTP)
	}
	// An empty password keeps the stored one; other fields are partial.
	e.do("PATCH", "/api/v1/settings", e.token, map[string]any{"smtp": map[string]any{"password": "", "port": srv.Port}}, 200, nil)
	if s := e.store.Settings().SMTP; s.Password != "pw" || s.Host != srv.Host {
		t.Fatalf("stored smtp %+v", s)
	}
	for _, bad := range []map[string]any{{"tls": "ssl"}, {"port": 0}, {"from": "nope"}, {"host": "a b"}} {
		e.do("PATCH", "/api/v1/settings", e.token, map[string]any{"smtp": bad}, 400, nil)
	}
	// Non-admins see only whether email is configured.
	viewer := e.roleToken("v@fleet.local", store.RoleViewer)
	e.do("GET", "/api/v1/settings", viewer, nil, 200, &cfg)
	if !cfg.SMTP.Configured || cfg.SMTP.Host != "" || cfg.SMTP.Username != "" {
		t.Fatalf("viewer smtp %+v", cfg.SMTP)
	}
	e.do("POST", "/api/v1/settings/smtp/test", viewer, map[string]string{"to": "a@example.com"}, 403, nil)

	var res map[string]any
	e.do("POST", "/api/v1/settings/smtp/test", e.token, map[string]string{"to": "ops@example.com"}, 200, &res)
	if m := srv.Messages(); len(m) != 1 || m[0].To[0] != "ops@example.com" || m[0].Auth != "fleet:pw" {
		t.Fatalf("test mail %+v", m)
	}
	e.do("POST", "/api/v1/settings/smtp/test", e.token, map[string]string{"to": "bad"}, 400, nil)
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	dead := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	e.do("PATCH", "/api/v1/settings", e.token, map[string]any{"smtp": map[string]any{"port": dead}}, 200, nil)
	e.do("POST", "/api/v1/settings/smtp/test", e.token, map[string]string{"to": "ops@example.com"}, 502, nil)

	// Notification prefs carry the new types and the email channel.
	var prefs notificationPrefs
	e.do("GET", "/api/v1/me/notifications", e.token, nil, 200, &prefs)
	for _, typ := range []string{"jobAssigned", "jobStatus", "jobStopArrived", "jobLate", "routeDeviation",
		"routeReturn", "fuelDrain", "refuel", "sensorHigh", "sensorLow"} {
		c, ok := prefs.Events[typ]
		if !ok || !c.InApp || c.Email {
			t.Errorf("%s prefs %+v %v", typ, c, ok)
		}
	}
	prefs.Events["sensorHigh"] = store.Channels{InApp: true, Email: true}
	e.do("PUT", "/api/v1/me/notifications", e.token, map[string]any{"events": prefs.Events}, 200, &prefs)
	if c := prefs.Events["sensorHigh"]; !c.Email || c.Telegram {
		t.Fatalf("saved %+v", c)
	}
}

func TestSensorsAPI(t *testing.T) {
	e := newEnv(t, "")
	var dev store.Device
	e.do("POST", "/api/v1/devices", e.token, map[string]any{"name": "Reefer", "imei": "356307042441013"}, 201, &dev)
	if dev.Sensors == nil || len(dev.Sensors) != 0 {
		t.Fatalf("sensors must be [] %+v", dev.Sensors)
	}
	base := "/api/v1/sensors"
	var fuel, temp store.Sensor
	e.do("POST", base, e.token, map[string]any{"deviceId": dev.ID, "name": "Tank", "type": "fuel", "source": "io9",
		"calibration": [][2]float64{{0, 0}, {4500, 120}}, "tankCapacity": 120, "smoothing": 1}, 201, &fuel)
	e.do("POST", base, e.token, map[string]any{"deviceId": dev.ID, "name": "Cargo", "type": "temperature",
		"source": "io72", "multiplier": 0.1, "max": 8}, 201, &temp)
	if temp.Unit != "°C" || temp.Decimals != 1 || temp.Max == nil || *temp.Max != 8 || temp.Min != nil {
		t.Fatalf("temp %+v", temp)
	}
	e.do("POST", base, e.token, map[string]any{"deviceId": dev.ID, "name": "x", "type": "nope", "source": "io1"}, 400, nil)
	e.do("POST", base, e.token, map[string]any{"deviceId": 9999, "name": "x", "type": "fuel", "source": "io1"}, 400, nil)

	// Scope: a manager outside the device's groups sees nothing; viewers cannot write.
	mgr := e.roleToken("m@fleet.local", store.RoleManager)
	var list []store.Sensor
	e.do("GET", base, mgr, nil, 200, &list)
	if len(list) != 0 {
		t.Fatalf("manager sees %+v", list)
	}
	e.do("PATCH", base+"/"+itoa(fuel.ID), mgr, map[string]any{"name": "y"}, 404, nil)
	e.do("GET", base+"?deviceId="+itoa(dev.ID), mgr, nil, 404, nil)
	viewer := e.roleToken("v@fleet.local", store.RoleViewer)
	e.do("POST", base, viewer, map[string]any{"deviceId": dev.ID}, 403, nil)
	e.do("GET", base+"?deviceId="+itoa(dev.ID), e.token, nil, 200, &list)
	if len(list) != 2 {
		t.Fatalf("list %+v", list)
	}

	// PATCH is partial; null clears a threshold.
	var upd store.Sensor
	e.do("PATCH", base+"/"+itoa(temp.ID), e.token, map[string]any{"min": -5, "max": nil, "name": "Cargo hold"}, 200, &upd)
	if upd.Name != "Cargo hold" || upd.Max != nil || upd.Min == nil || *upd.Min != -5 || upd.Multiplier != 0.1 || upd.Source != "io72" {
		t.Fatalf("patched %+v", upd)
	}
	e.do("PATCH", base+"/"+itoa(temp.ID), e.token, map[string]any{"decimals": 9}, 400, nil)

	// Positions with computed sensor values.
	ctx := context.Background()
	if ok, err := e.store.Authorize(ctx, dev.IMEI, "teltonika"); !ok || err != nil {
		t.Fatal(ok, err)
	}
	t0 := time.Now().Add(-10 * time.Minute).UTC().Truncate(time.Second)
	var ps []domain.Position
	for i := range 3 {
		ps = append(ps, domain.Position{IMEI: dev.IMEI, DeviceTime: t0.Add(time.Duration(i) * time.Minute),
			Latitude: 2, Longitude: 45, Valid: true, Satellites: 8,
			Attributes: map[string]any{"io9": uint64(2250 + i*375), "io72": int64(-35)}})
	}
	if err := e.store.Positions(ctx, ps); err != nil {
		t.Fatal(err)
	}
	var pv []struct {
		Time    time.Time          `json:"time"`
		Sensors map[string]float64 `json:"sensors"`
	}
	e.do("GET", "/api/v1/devices/"+itoa(dev.ID)+"/positions?sensors=1&from="+t0.Add(-time.Minute).Format(time.RFC3339), e.token, nil, 200, &pv)
	if len(pv) != 3 || pv[0].Sensors[strconv.FormatInt(fuel.ID, 10)] != 60 || pv[2].Sensors[itoa(fuel.ID)] != 80 ||
		pv[1].Sensors[itoa(temp.ID)] != -3.5 {
		t.Fatalf("positions %+v", pv)
	}
	var plain []map[string]any
	e.do("GET", "/api/v1/devices/"+itoa(dev.ID)+"/positions?from="+t0.Add(-time.Minute).Format(time.RFC3339), e.token, nil, 200, &plain)
	if _, has := plain[0]["sensors"]; has {
		t.Fatal("sensors must be opt-in")
	}
	// Device JSON lists the sensors (values come from the live rule, not wired here).
	e.do("GET", "/api/v1/devices/"+itoa(dev.ID), e.token, nil, 200, &dev)
	if len(dev.Sensors) != 2 || dev.Sensors[0].Name == "" {
		t.Fatalf("device sensors %+v", dev.Sensors)
	}

	var types []map[string]string
	e.do("GET", "/api/v1/reports", e.token, nil, 200, &types)
	if n := len(types); n < 15 || types[n-2]["type"] != "fuel" || types[n-1]["type"] != "temperature" {
		t.Fatalf("catalogue %v", types)
	}
	var rep struct {
		Rows []map[string]any `json:"rows"`
	}
	e.do("GET", "/api/v1/reports/fuel?from="+t0.Add(-time.Minute).Format(time.RFC3339), e.token, nil, 200, &rep)
	if len(rep.Rows) != 1 || rep.Rows[0]["startLevel"] != 60.0 || rep.Rows[0]["endLevel"] != 80.0 {
		t.Fatalf("fuel report %+v", rep.Rows)
	}
	e.do("DELETE", base+"/"+itoa(fuel.ID), e.token, nil, 204, nil)
	e.do("DELETE", base+"/"+itoa(fuel.ID), e.token, nil, 404, nil)
}

func TestReportSchedulesAPI(t *testing.T) {
	e := newEnv(t, "")
	srv := mailtest.New(t, false)
	if _, err := e.store.UpdateSettings(context.Background(), func(c *store.Settings) error {
		c.SMTP = store.SMTPSettings{Host: srv.Host, Port: srv.Port, From: "fleet@example.com", TLS: store.SMTPNone}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var dev store.Device
	e.do("POST", "/api/v1/devices", e.token, map[string]any{"name": "Truck 07", "imei": "356307042441013"}, 201, &dev)
	base := "/api/v1/report-schedules"
	var sc store.ReportSchedule
	e.do("POST", base, e.token, map[string]any{"name": "Daily summary", "reportType": "summary",
		"filters": map[string]any{"deviceIds": []int64{dev.ID}}, "period": "yesterday", "frequency": "daily", "hour": 7,
		"timezone": "Africa/Mogadishu", "format": "csv", "emails": []string{"ops@example.com"}}, 201, &sc)
	if sc.ID == 0 || !sc.Enabled || sc.LastStatus != nil || sc.LastRunAt != nil || sc.NextRunAt.IsZero() ||
		sc.Weekday != 1 || sc.MonthDay != 1 || sc.TelegramUserIDs == nil {
		t.Fatalf("created %+v", sc)
	}
	mog, _ := time.LoadLocation("Africa/Mogadishu")
	if l := sc.NextRunAt.In(mog); l.Hour() != 7 || l.Minute() != 0 || !sc.NextRunAt.After(time.Now()) {
		t.Fatalf("nextRunAt %s", sc.NextRunAt)
	}
	for _, bad := range []map[string]any{
		{"name": "x", "reportType": "nope", "emails": []string{"a@b.c"}},
		{"name": "x", "reportType": "summary"},
		{"name": "x", "reportType": "summary", "emails": []string{"a@b.c"}, "timezone": "Nowhere/City"},
		{"name": "x", "reportType": "summary", "emails": []string{"a@b.c"}, "filters": map[string]any{"deviceIds": []int64{999}}},
		{"name": "x", "reportType": "summary", "telegramUserIds": []int64{999}},
		{"name": "x", "reportType": "summary", "emails": []string{"a@b.c"}, "frequency": "hourly"},
	} {
		e.do("POST", base, e.token, bad, 400, nil)
	}
	var upd store.ReportSchedule
	e.do("PATCH", base+"/"+itoa(sc.ID), e.token, map[string]any{"frequency": "weekly", "weekday": 5, "hour": 18}, 200, &upd)
	if l := upd.NextRunAt.In(mog); l.Weekday() != time.Friday || l.Hour() != 18 || upd.Name != "Daily summary" ||
		upd.Format != "csv" || len(upd.Filters.DeviceIDs) != 1 {
		t.Fatalf("patched %+v", upd)
	}

	var run store.ReportRun
	e.do("POST", base+"/"+itoa(sc.ID)+"/run", e.token, nil, 200, &run)
	if run.Status != "ok" || !run.Manual || len(run.Recipients) != 1 || run.Recipients[0] != "email:ops@example.com" {
		t.Fatalf("run %+v", run)
	}
	if m := srv.Messages(); len(m) != 1 || !strings.Contains(m[0].Data, ".csv\"") {
		t.Fatalf("mail %+v", m)
	}
	var runs []store.ReportRun
	e.do("GET", base+"/"+itoa(sc.ID)+"/runs", e.token, nil, 200, &runs)
	if len(runs) != 1 || runs[0].Status != "ok" {
		t.Fatalf("runs %+v", runs)
	}
	e.do("GET", base+"/"+itoa(sc.ID), e.token, nil, 200, &upd)
	if upd.LastStatus == nil || *upd.LastStatus != "ok" || upd.LastRunAt == nil {
		t.Fatalf("after run %+v", upd)
	}

	// Managers only see and edit their own schedules; viewers have no access.
	mgr := e.roleToken("m@fleet.local", store.RoleManager)
	var list []store.ReportSchedule
	e.do("GET", base, mgr, nil, 200, &list)
	if len(list) != 0 {
		t.Fatalf("manager list %+v", list)
	}
	e.do("GET", base+"/"+itoa(sc.ID), mgr, nil, 404, nil)
	e.do("POST", base+"/"+itoa(sc.ID)+"/run", mgr, nil, 404, nil)
	// A manager cannot schedule reports about devices outside their groups.
	e.do("POST", base, mgr, map[string]any{"name": "m", "reportType": "trips", "emails": []string{"m@example.com"},
		"filters": map[string]any{"deviceIds": []int64{dev.ID}}}, 400, nil)
	var mine store.ReportSchedule
	e.do("POST", base, mgr, map[string]any{"name": "m", "reportType": "trips", "frequency": "monthly", "monthDay": 31,
		"emails": []string{"m@example.com"}}, 201, &mine)
	e.do("GET", base, mgr, nil, 200, &list)
	if len(list) != 1 || list[0].ID != mine.ID {
		t.Fatalf("manager list %+v", list)
	}
	e.do("GET", base, e.token, nil, 200, &list)
	if len(list) != 2 {
		t.Fatalf("admin list %+v", list)
	}
	viewer := e.roleToken("v@fleet.local", store.RoleViewer)
	e.do("GET", base, viewer, nil, 403, nil)

	e.do("DELETE", base+"/"+itoa(sc.ID), e.token, nil, 204, nil)
	e.do("GET", base+"/"+itoa(sc.ID)+"/runs", e.token, nil, 404, nil)
}
