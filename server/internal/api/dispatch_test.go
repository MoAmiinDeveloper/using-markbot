package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/moamiindeveloper/fleet/server/internal/commands"
	"github.com/moamiindeveloper/fleet/server/internal/dispatch"
	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/events"
	"github.com/moamiindeveloper/fleet/server/internal/hub"
	"github.com/moamiindeveloper/fleet/server/internal/notify"
	"github.com/moamiindeveloper/fleet/server/internal/protocol/teltonika"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// newDispatchEnv is newEnv with the dispatch service and its rules wired
// like cmd/fleetd (own schema, temporary data directory).
func newDispatchEnv(t *testing.T) (*env, *dispatch.Service) {
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
	schema := "dispatch_api_test_" + strconv.Itoa(os.Getpid())
	if _, err := admin.Exec(ctx, `DROP SCHEMA IF EXISTS `+schema+` CASCADE; CREATE SCHEMA `+schema); err != nil {
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
	h := hub.New(256, nil)
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
	ds := dispatch.New(st, dispatch.Options{DataDir: t.TempDir(), Emitter: engine})
	if err := ds.Refresh(ctx); err != nil {
		t.Fatal(err)
	}
	engine.AddRule(ds.StopRule())
	engine.AddRule(ds.RouteRule())
	cmds, err := commands.New(ctx, st, teltonika.NewHandler(), engine, nil)
	if err != nil {
		t.Fatal(err)
	}
	st.SetHooks(store.Hooks{Positions: engine.Process, Connected: cmds.DeviceConnected})
	srv := httptest.NewServer(New(st, h, Config{JWTSecret: secret, Notifier: nt, Commands: cmds, Dispatch: ds}))
	t.Cleanup(srv.Close)
	t.Cleanup(h.Close)
	e := &env{t: t, srv: srv, store: st, hub: h}
	var login struct{ Token string }
	e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": "admin@fleet.local", "password": "admin"}, 200, &login)
	e.token = login.Token
	return e, ds
}

// newDriver creates a driver (optionally with a vehicle) and its login.
func (e *env) newDriver(name, email string, deviceID *int64) (store.Driver, string) {
	e.t.Helper()
	var d store.Driver
	e.do("POST", "/api/v1/drivers", e.token, map[string]any{"name": name, "deviceId": deviceID}, 201, &d)
	var u store.User
	e.do("POST", "/api/v1/drivers/"+itoa(d.ID)+"/account", e.token, map[string]any{"email": email, "password": "secret1"}, 201, &u)
	if u.Role != store.RoleDriver {
		e.t.Fatalf("driver account role %q", u.Role)
	}
	var login struct {
		Token string
		User  store.User
	}
	e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": email, "password": "secret1"}, 200, &login)
	if login.User.Role != "driver" {
		e.t.Fatalf("login role %q", login.User.Role)
	}
	return d, login.Token
}

func (e *env) device(name, imei string) store.Device {
	e.t.Helper()
	var d store.Device
	e.do("POST", "/api/v1/devices", e.token, map[string]any{"name": name, "imei": imei}, 201, &d)
	return d
}

// fix ingests one position through the normal store path (events run on the hook).
func (e *env) fix(imei string, t time.Time, lat, lng, speed float64) {
	e.t.Helper()
	if err := e.store.Positions(context.Background(), []domain.Position{{IMEI: imei, DeviceTime: t, Latitude: lat,
		Longitude: lng, Speed: speed, Valid: true, Attributes: map[string]any{"ignition": true}}}); err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) events(typ string) []store.Event {
	e.t.Helper()
	var evs []store.Event
	e.do("GET", "/api/v1/events?type="+typ+"&from=2000-01-01T00:00:00Z", e.token, nil, 200, &evs)
	return evs
}

func jobBody(title string, deviceID, driverID *int64, stops ...[2]float64) map[string]any {
	var ss []map[string]any
	for i, s := range stops {
		ss = append(ss, map[string]any{"name": "S" + strconv.Itoa(i+1), "lat": s[0], "lng": s[1], "radius": 100})
	}
	return map[string]any{"title": title, "deviceId": deviceID, "driverId": driverID, "stops": ss,
		"checklist": []map[string]any{{"text": "Check seal", "required": true}, {"text": "Photo"}}}
}

func ptr(v int64) *int64 { return &v }

func TestJobStatusTransitions(t *testing.T) {
	e, _ := newDispatchEnv(t)
	dev := e.device("Truck", "356307042441013")
	drv, dtok := e.newDriver("Ahmed", "ahmed@x.io", ptr(dev.ID))

	var j store.Job
	e.do("POST", "/api/v1/jobs", e.token, jobBody("Deliver", ptr(dev.ID), nil, [2]float64{2.04, 45.31}), 201, &j)
	if j.Status != store.JobUnassigned || j.Reference != fmt.Sprintf("JOB-%06d", j.ID) || len(j.Stops) != 1 ||
		j.Stops[0].Status != store.StopPending || len(j.Checklist) != 2 || j.CreatedBy == nil {
		t.Fatalf("created job %+v", j)
	}
	jp := "/api/v1/jobs/" + itoa(j.ID)
	e.do("POST", jp+"/status", e.token, map[string]any{"status": "assigned"}, 409, nil) // no driver
	e.do("POST", jp+"/status", e.token, map[string]any{"status": "completed"}, 409, nil)
	e.do("POST", jp+"/status", e.token, map[string]any{"status": "bogus"}, 400, nil)
	e.do("PATCH", jp, e.token, map[string]any{"status": "assigned"}, 400, nil)
	// Driver cannot see the job yet.
	e.do("GET", "/api/v1/driver/jobs/"+itoa(j.ID), dtok, nil, 404, nil)

	e.do("PATCH", jp, e.token, map[string]any{"driverId": drv.ID}, 200, &j)
	if j.Status != store.JobAssigned {
		t.Fatalf("after assigning: %s", j.Status)
	}
	dp := "/api/v1/driver/jobs/" + itoa(j.ID)
	e.do("POST", dp+"/status", dtok, map[string]any{"status": "completed"}, 409, nil)
	e.do("POST", dp+"/status", dtok, map[string]any{"status": "cancelled"}, 409, nil)
	for _, st := range []string{"accepted", "enRoute", "arrived", "inProgress"} {
		e.do("POST", dp+"/status", dtok, map[string]any{"status": st, "lat": 2.04, "lng": 45.31}, 200, &j)
		if j.Status != st {
			t.Fatalf("status %s, want %s", j.Status, st)
		}
	}
	// Required checklist item blocks completion by the driver.
	e.do("POST", dp+"/status", dtok, map[string]any{"status": "completed"}, 409, nil)
	e.do("POST", dp+"/checklist/"+itoa(j.Checklist[0].ID), dtok, map[string]any{"done": true}, 200, &j)
	if !j.Checklist[0].Done || j.Checklist[0].DoneAt == nil {
		t.Fatalf("checklist %+v", j.Checklist)
	}
	e.do("POST", dp+"/stops/"+itoa(j.Stops[0].ID), dtok, map[string]any{"status": "completed", "notes": "left at door"}, 200, &j)
	if j.Stops[0].Status != store.StopCompleted || j.Stops[0].Notes != "left at door" || j.Stops[0].CompletedAt == nil {
		t.Fatalf("stop %+v", j.Stops[0])
	}
	e.do("POST", dp+"/stops/"+itoa(j.Stops[0].ID), dtok, map[string]any{"status": "arrived"}, 409, nil)
	e.do("POST", dp+"/notes", dtok, map[string]any{"text": "All good"}, 200, nil)
	e.do("POST", dp+"/status", dtok, map[string]any{"status": "completed"}, 200, &j)
	if j.Status != store.JobCompleted || j.CompletedAt == nil {
		t.Fatalf("completed %+v", j)
	}
	for _, st := range []string{"assigned", "inProgress", "cancelled", "unassigned"} {
		e.do("POST", jp+"/status", e.token, map[string]any{"status": st}, 409, nil)
	}

	// Timeline.
	var tl []store.JobEvent
	e.do("GET", jp+"/timeline", e.token, nil, 200, &tl)
	var kinds []string
	for _, ev := range tl {
		kinds = append(kinds, ev.Kind)
	}
	want := "created,updated,assigned,status,status,status,status,status,checklist,stopCompleted,note,status"
	if strings.Join(kinds, ",") != want {
		t.Fatalf("timeline kinds %v", kinds)
	}
	if tl[4].Data["lat"] != 2.04 || tl[4].Data["status"] != "accepted" || tl[4].UserID == nil {
		t.Fatalf("status event %+v", tl[4])
	}

	// Manager flows: fail/reopen/cancel.
	var j2 store.Job
	e.do("POST", "/api/v1/jobs", e.token, jobBody("Pickup", ptr(dev.ID), &drv.ID, [2]float64{2.05, 45.32}), 201, &j2)
	if j2.Status != store.JobAssigned {
		t.Fatalf("created with driver: %s", j2.Status)
	}
	jp2 := "/api/v1/jobs/" + itoa(j2.ID)
	e.do("POST", jp2+"/status", e.token, map[string]any{"status": "cancelled", "reason": "customer closed"}, 200, &j2)
	if j2.FailureReason != "customer closed" {
		t.Fatalf("reason %+v", j2)
	}
	e.do("POST", "/api/v1/driver/jobs/"+itoa(j2.ID)+"/status", dtok, map[string]any{"status": "accepted"}, 409, nil)
	e.do("POST", jp2+"/status", e.token, map[string]any{"status": "assigned"}, 200, &j2)
	e.do("POST", jp2+"/status", e.token, map[string]any{"status": "unassigned"}, 200, &j2)
	if j2.DriverID != nil || j2.FailureReason != "" {
		t.Fatalf("unassigned job %+v", j2)
	}

	// Events: jobAssigned (twice: PATCH + create), jobStatus for status changes.
	if n := len(e.events(store.EventJobAssigned)); n != 2 {
		t.Fatalf("%d jobAssigned events", n)
	}
	sts := e.events(store.EventJobStatus)
	if len(sts) < 5 || sts[0].Attributes["reference"] != j2.Reference {
		t.Fatalf("jobStatus events %+v", sts)
	}

	// Filters.
	var list []store.Job
	e.do("GET", "/api/v1/jobs?status=completed", e.token, nil, 200, &list)
	if len(list) != 1 || list[0].ID != j.ID {
		t.Fatalf("filter status %+v", list)
	}
	e.do("GET", "/api/v1/jobs?q=pick", e.token, nil, 200, &list)
	if len(list) != 1 || list[0].ID != j2.ID {
		t.Fatalf("filter q %+v", list)
	}
	e.do("GET", "/api/v1/jobs?q="+j.Reference, e.token, nil, 200, &list)
	if len(list) != 1 || list[0].ID != j.ID {
		t.Fatalf("filter reference %+v", list)
	}
	e.do("DELETE", jp2, e.token, nil, 204, nil)
	e.do("GET", jp2, e.token, nil, 404, nil)
}

func TestDriverRoleLockout(t *testing.T) {
	e, _ := newDispatchEnv(t)
	dev := e.device("Truck", "356307042441013")
	_, dtok := e.newDriver("Ahmed", "ahmed@x.io", ptr(dev.ID))
	forbidden := []struct{ method, path string }{
		{"GET", "/api/v1/devices"}, {"GET", "/api/v1/devices/" + itoa(dev.ID)}, {"GET", "/api/v1/summary"},
		{"GET", "/api/v1/events"}, {"GET", "/api/v1/geofences"}, {"GET", "/api/v1/settings"},
		{"GET", "/api/v1/jobs"}, {"POST", "/api/v1/jobs"}, {"GET", "/api/v1/routes"}, {"GET", "/api/v1/drivers"},
		{"GET", "/api/v1/reports/summary"}, {"GET", "/api/v1/dashboard"}, {"GET", "/api/v1/me/notifications"},
		{"POST", "/api/v1/me/telegram/link"}, {"GET", "/api/v1/users"}, {"POST", "/api/v1/drivers/1/account"},
		{"GET", "/api/v1/driver/../devices"}, {"GET", "/api/v1/expenses"}, {"GET", "/api/v1/places"},
	}
	for _, c := range forbidden {
		e.do(c.method, c.path, dtok, nil, 403, nil)
	}
	var me store.User
	e.do("GET", "/api/v1/me", dtok, nil, 200, &me)
	if me.Role != store.RoleDriver {
		t.Fatalf("me %+v", me)
	}
	e.do("PATCH", "/api/v1/me", dtok, map[string]any{"name": "Ahmed A."}, 200, nil)
	var dm struct {
		User    store.User
		Driver  store.Driver
		Vehicle *store.Device
	}
	e.do("GET", "/api/v1/driver/me", dtok, nil, 200, &dm)
	if dm.Vehicle == nil || dm.Vehicle.ID != dev.ID || dm.Driver.UserID == nil || *dm.Driver.UserID != me.ID {
		t.Fatalf("driver me %+v", dm)
	}
	e.do("GET", "/api/v1/driver/jobs", dtok, nil, 200, nil)

	// Viewers and admins without a linked driver cannot use /driver/*; admins may with ?driverId.
	viewer := e.roleToken("v@x.io", store.RoleViewer)
	e.do("GET", "/api/v1/driver/jobs", viewer, nil, 403, nil)
	e.do("GET", "/api/v1/driver/jobs", e.token, nil, 403, nil)
	e.do("GET", "/api/v1/driver/jobs?driverId="+itoa(dm.Driver.ID), e.token, nil, 200, nil)

	// Account management: update password (200), duplicate email (400), delete (204), then login fails.
	e.do("POST", "/api/v1/drivers/"+itoa(dm.Driver.ID)+"/account", e.token, map[string]any{"email": "ahmed@x.io", "password": "newpass1"}, 200, nil)
	e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": "ahmed@x.io", "password": "newpass1"}, 200, nil)
	d2, _ := e.newDriver("Bilal", "bilal@x.io", nil)
	e.do("POST", "/api/v1/drivers/"+itoa(d2.ID)+"/account", e.token, map[string]any{"email": "ahmed@x.io"}, 400, nil)
	e.do("DELETE", "/api/v1/drivers/"+itoa(dm.Driver.ID)+"/account", e.token, nil, 204, nil)
	e.do("DELETE", "/api/v1/drivers/"+itoa(dm.Driver.ID)+"/account", e.token, nil, 404, nil)
	e.do("GET", "/api/v1/driver/me", dtok, nil, 401, nil)
	var drv store.Driver
	e.do("GET", "/api/v1/drivers", e.token, nil, 200, nil)
	_ = drv
}

func TestDriverSeesOnlyOwnJobs(t *testing.T) {
	e, _ := newDispatchEnv(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	devA := e.device("A", "356307042441013")
	devB := e.device("B", "356307042441014")
	_, tokA := e.newDriver("Ann", "ann@x.io", ptr(devA.ID))
	drvB, tokB := e.newDriver("Ben", "ben@x.io", ptr(devB.ID))
	wsA := e.dialWSAs(ctx, tokA)
	time.Sleep(100 * time.Millisecond)

	var jb store.Job
	e.do("POST", "/api/v1/jobs", e.token, jobBody("For Ben", ptr(devB.ID), &drvB.ID, [2]float64{2.1, 45.1}), 201, &jb)
	e.fix(devB.IMEI, time.Now().Add(-time.Minute), 2.2, 45.2, 10)
	e.fix(devA.IMEI, time.Now().Add(-time.Minute), 2.3, 45.3, 10)
	// Ann's frames until her own position: nothing of Ben (job, position, device, event).
	for {
		_, data, err := wsA.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var m wsMsg
		_ = json.Unmarshal(data, &m)
		var scoped struct {
			ID       int64 `json:"id"`
			DeviceID int64 `json:"deviceId"`
		}
		_ = json.Unmarshal(m.Data, &scoped)
		if m.Type == "job" || m.Type == "event" || (m.Type == "device" && scoped.ID != devA.ID) ||
			(m.Type == "position" && scoped.DeviceID != devA.ID) {
			t.Fatalf("driver A received %s", data)
		}
		if m.Type == "position" {
			break
		}
	}

	var listA, listB []store.Job
	e.do("GET", "/api/v1/driver/jobs", tokA, nil, 200, &listA)
	e.do("GET", "/api/v1/driver/jobs", tokB, nil, 200, &listB)
	if len(listA) != 0 || len(listB) != 1 || listB[0].ID != jb.ID {
		t.Fatalf("lists A=%v B=%v", listA, listB)
	}
	e.do("GET", "/api/v1/driver/jobs/"+itoa(jb.ID), tokA, nil, 404, nil)
	e.do("POST", "/api/v1/driver/jobs/"+itoa(jb.ID)+"/status", tokA, map[string]any{"status": "accepted"}, 404, nil)
	e.do("GET", "/api/v1/jobs/"+itoa(jb.ID), tokA, nil, 403, nil)

	// Reassign Ben's job to Ann: Ann gets the job frame, Ben's updates feed shows it left.
	since := time.Now().UTC().Add(-time.Second).Format(time.RFC3339Nano)
	var annDrv store.Driver
	{
		var ds []store.Driver
		e.do("GET", "/api/v1/drivers", e.token, nil, 200, &ds)
		for _, d := range ds {
			if d.Name == "Ann" {
				annDrv = d
			}
		}
	}
	e.do("PATCH", "/api/v1/jobs/"+itoa(jb.ID), e.token, map[string]any{"driverId": annDrv.ID}, 200, nil)
	m := waitWS(t, ctx, wsA, "job")
	var got store.Job
	_ = json.Unmarshal(m.Data, &got)
	if got.ID != jb.ID || got.DriverID == nil || *got.DriverID != annDrv.ID {
		t.Fatalf("job frame %+v", got)
	}
	var upd struct {
		Jobs []store.Job
		Now  time.Time
	}
	e.do("GET", "/api/v1/driver/updates?since="+since, tokB, nil, 200, &upd)
	if len(upd.Jobs) != 1 || *upd.Jobs[0].DriverID != annDrv.ID || upd.Now.IsZero() {
		t.Fatalf("ben updates %+v", upd)
	}
	e.do("GET", "/api/v1/driver/updates?since="+since, tokA, nil, 200, &upd)
	if len(upd.Jobs) != 1 {
		t.Fatalf("ann updates %+v", upd)
	}
	e.do("GET", "/api/v1/driver/updates?since="+upd.Now.Format(time.RFC3339Nano), tokA, nil, 200, &upd)
	if len(upd.Jobs) != 0 {
		t.Fatalf("no new updates expected: %+v", upd)
	}
}

func TestJobVisibilityForManagers(t *testing.T) {
	e, _ := newDispatchEnv(t)
	ds, g := fleet3(e)
	mgr := e.roleToken("mgr@x.io", store.RoleManager, g.ID)
	viewer := e.roleToken("viewer@x.io", store.RoleViewer, g.ID)
	var in, out, none store.Job
	e.do("POST", "/api/v1/jobs", e.token, jobBody("in", ptr(ds[0].ID), nil, [2]float64{1, 1}), 201, &in)
	e.do("POST", "/api/v1/jobs", e.token, jobBody("out", ptr(ds[2].ID), nil, [2]float64{1, 1}), 201, &out)
	e.do("POST", "/api/v1/jobs", e.token, jobBody("none", nil, nil, [2]float64{1, 1}), 201, &none)
	var list []store.Job
	e.do("GET", "/api/v1/jobs", mgr, nil, 200, &list)
	if len(list) != 2 {
		t.Fatalf("manager sees %d jobs", len(list))
	}
	e.do("GET", "/api/v1/jobs", viewer, nil, 200, &list)
	if len(list) != 1 || list[0].ID != in.ID {
		t.Fatalf("viewer sees %+v", list)
	}
	e.do("GET", "/api/v1/jobs/"+itoa(out.ID), mgr, nil, 404, nil)
	e.do("PATCH", "/api/v1/jobs/"+itoa(in.ID), viewer, map[string]any{"title": "x"}, 403, nil)
	e.do("PATCH", "/api/v1/jobs/"+itoa(in.ID), mgr, map[string]any{"deviceId": ds[2].ID}, 400, nil)
	e.do("POST", "/api/v1/jobs", mgr, jobBody("x", ptr(ds[2].ID), nil, [2]float64{1, 1}), 400, nil)
	e.do("POST", "/api/v1/jobs", e.token, map[string]any{"title": "no stops"}, 400, nil)
	e.do("POST", "/api/v1/jobs", e.token, map[string]any{"title": "bad", "stops": []map[string]any{{"lat": 91, "lng": 1}}}, 400, nil)

	// PATCH stops keeps ids/state of kept stops, adds and removes others.
	var j store.Job
	e.do("PATCH", "/api/v1/jobs/"+itoa(in.ID), mgr, map[string]any{"stops": []map[string]any{
		{"name": "New first", "lat": 3, "lng": 3},
		{"id": in.Stops[0].ID, "name": "Renamed", "lat": 1, "lng": 1},
	}, "dueBy": "2030-01-01T00:00:00Z"}, 200, &j)
	if len(j.Stops) != 2 || j.Stops[1].ID != in.Stops[0].ID || j.Stops[1].Name != "Renamed" || j.Stops[0].Seq != 1 ||
		j.DueBy == nil || j.Late {
		t.Fatalf("patched stops %+v", j)
	}
}

func TestStopAutoArrivalAndLate(t *testing.T) {
	e, ds := newDispatchEnv(t)
	dev := e.device("Truck", "356307042441013")
	drv, dtok := e.newDriver("Ahmed", "ahmed@x.io", nil)
	// Job without a vehicle: the driver's assigned vehicle is tracked.
	e.do("PATCH", "/api/v1/drivers/"+itoa(drv.ID), e.token, map[string]any{"deviceId": dev.ID}, 200, nil)
	past := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	body := jobBody("Two stops", nil, &drv.ID, [2]float64{2.000, 45.000}, [2]float64{2.010, 45.000})
	body["dueBy"] = past
	var j store.Job
	e.do("POST", "/api/v1/jobs", e.token, body, 201, &j)
	if !j.Late {
		t.Fatalf("job should be late: %+v", j)
	}
	dp := "/api/v1/driver/jobs/" + itoa(j.ID)
	e.do("POST", dp+"/status", dtok, map[string]any{"status": "accepted"}, 200, nil)
	e.do("POST", dp+"/status", dtok, map[string]any{"status": "enRoute"}, 200, nil)

	t0 := time.Now().Add(-10 * time.Minute).UTC().Truncate(time.Second)
	e.fix(dev.IMEI, t0, 1.990, 45.000, 40)                      // baseline, 1.1 km away
	e.fix(dev.IMEI, t0.Add(time.Minute), 1.995, 45.000, 40)     // 550 m away
	e.fix(dev.IMEI, t0.Add(2*time.Minute), 2.0005, 45.000, 5)   // 55 m: arrived at stop 1
	e.fix(dev.IMEI, t0.Add(3*time.Minute), 2.0011, 45.000, 5)   // 122 m: inside hysteresis (100+25)
	e.fix(dev.IMEI, t0.Add(4*time.Minute), 2.0030, 45.000, 30)  // 333 m: departed
	e.fix(dev.IMEI, t0.Add(5*time.Minute), 2.0100, 45.0005, 10) // stop 2

	e.do("GET", "/api/v1/jobs/"+itoa(j.ID), e.token, nil, 200, &j)
	s1, s2 := j.Stops[0], j.Stops[1]
	if s1.Status != store.StopArrived || s1.ArrivedAt == nil || !s1.ArrivedAt.Equal(t0.Add(2*time.Minute)) ||
		s1.DepartedAt == nil || !s1.DepartedAt.Equal(t0.Add(4*time.Minute)) {
		t.Fatalf("stop 1 %+v", s1)
	}
	if s2.Status != store.StopArrived || s2.DepartedAt != nil || j.Status != store.JobArrived {
		t.Fatalf("stop 2 %+v, job %s", s2, j.Status)
	}
	arr := e.events(store.EventJobStopArrived)
	if len(arr) != 2 || arr[0].DeviceID != dev.ID || arr[1].Attributes["stopId"] != float64(s1.ID) {
		t.Fatalf("jobStopArrived events %+v", arr)
	}
	var tl []store.JobEvent
	e.do("GET", "/api/v1/jobs/"+itoa(j.ID)+"/timeline", e.token, nil, 200, &tl)
	n := 0
	for _, ev := range tl {
		if ev.Kind == store.JobEvStopDeparted {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("timeline %+v", tl)
	}

	// jobLate fires once.
	ctx := context.Background()
	for range 2 {
		if err := ds.CheckLate(ctx); err != nil {
			t.Fatal(err)
		}
	}
	late := e.events(store.EventJobLate)
	if len(late) != 1 || late[0].Attributes["jobId"] != float64(j.ID) {
		t.Fatalf("jobLate events %+v", late)
	}
	// Moving dueBy re-arms it.
	e.do("PATCH", "/api/v1/jobs/"+itoa(j.ID), e.token, map[string]any{"dueBy": time.Now().Add(-time.Minute).UTC().Format(time.RFC3339)}, 200, nil)
	_ = ds.CheckLate(ctx)
	if n := len(e.events(store.EventJobLate)); n != 2 {
		t.Fatalf("%d jobLate events after new dueBy", n)
	}
}

func TestRouteDeviation(t *testing.T) {
	e, ds := newDispatchEnv(t)
	devA := e.device("A", "356307042441013")
	devB := e.device("B", "356307042441014")
	var rt store.Route
	e.do("POST", "/api/v1/routes", e.token, map[string]any{"name": "East", "path": [][2]float64{{45.0, 2.0}, {45.1, 2.0}},
		"corridor": 200, "minDeviationSeconds": 60, "deviceIds": []int64{devA.ID}}, 201, &rt)
	if rt.Color != "#ffd700" || len(rt.DeviceIDs) != 1 {
		t.Fatalf("route %+v", rt)
	}
	e.do("POST", "/api/v1/routes", e.token, map[string]any{"name": "Bad", "path": [][2]float64{{45, 2}}}, 400, nil)
	if got := ds.MonitoredRoutes(devA.ID); len(got) != 1 {
		t.Fatalf("monitored %+v", got)
	}

	t0 := time.Now().Add(-30 * time.Minute).UTC().Truncate(time.Second)
	off := 2.0 + 0.0036                                      // ~400 m north
	e.fix(devA.IMEI, t0, 2.0, 45.01, 50)                     // baseline
	e.fix(devA.IMEI, t0.Add(10*time.Second), 2.0, 45.02, 50) // on route
	e.fix(devA.IMEI, t0.Add(20*time.Second), off, 45.03, 50) // off, 0 s
	e.fix(devA.IMEI, t0.Add(50*time.Second), off, 45.04, 50) // off, 30 s
	e.fix(devA.IMEI, t0.Add(60*time.Second), 2.0, 45.05, 50) // back before min duration: nothing
	e.fix(devA.IMEI, t0.Add(70*time.Second), off, 45.06, 50) // off again
	e.fix(devA.IMEI, t0.Add(140*time.Second), off, 45.07, 50)
	e.fix(devA.IMEI, t0.Add(150*time.Second), off, 45.08, 50) // still off: no second event
	e.fix(devA.IMEI, t0.Add(160*time.Second), 2.001, 45.09, 50)
	dev := e.events(store.EventRouteDeviation)
	ret := e.events(store.EventRouteReturn)
	if len(dev) != 1 || !dev[0].Time.Equal(t0.Add(140*time.Second)) || dev[0].Attributes["routeId"] != float64(rt.ID) {
		t.Fatalf("deviation events %+v", dev)
	}
	if len(ret) != 1 || !ret[0].Time.Equal(t0.Add(160*time.Second)) {
		t.Fatalf("return events %+v", ret)
	}

	// Device B is monitored only through an active job with routeId.
	_, btok := e.newDriver("B driver", "b@x.io", ptr(devB.ID))
	var bdrv []store.Driver
	e.do("GET", "/api/v1/drivers", e.token, nil, 200, &bdrv)
	var j store.Job
	body := jobBody("Routed", ptr(devB.ID), &bdrv[0].ID, [2]float64{2.0, 45.1})
	body["routeId"] = rt.ID
	e.do("POST", "/api/v1/jobs", e.token, body, 201, &j)
	if len(ds.MonitoredRoutes(devB.ID)) != 0 {
		t.Fatal("assigned job should not monitor the route yet")
	}
	e.do("POST", "/api/v1/driver/jobs/"+itoa(j.ID)+"/status", btok, map[string]any{"status": "accepted"}, 200, nil)
	if len(ds.MonitoredRoutes(devB.ID)) != 1 {
		t.Fatal("accepted job should monitor its route")
	}
	e.fix(devB.IMEI, t0, 2.0, 45.01, 50)
	e.fix(devB.IMEI, t0.Add(10*time.Second), off, 45.02, 50)
	e.fix(devB.IMEI, t0.Add(80*time.Second), off, 45.03, 50)
	if n := len(e.events(store.EventRouteDeviation)); n != 2 {
		t.Fatalf("%d deviation events", n)
	}

	// Manager scope and deletion.
	mgr := e.roleToken("m@x.io", store.RoleManager)
	var list []store.Route
	e.do("GET", "/api/v1/routes", mgr, nil, 200, &list)
	if len(list) != 0 {
		t.Fatalf("manager sees %+v", list)
	}
	e.do("PATCH", "/api/v1/routes/"+itoa(rt.ID), mgr, map[string]any{"name": "x"}, 404, nil)
	e.do("PATCH", "/api/v1/routes/"+itoa(rt.ID), e.token, map[string]any{"corridor": 5}, 400, nil)
	e.do("DELETE", "/api/v1/routes/"+itoa(rt.ID), e.token, nil, 204, nil)
	e.do("GET", "/api/v1/jobs/"+itoa(j.ID), e.token, nil, 200, &j)
	if j.RouteID != nil || len(ds.MonitoredRoutes(devA.ID)) != 0 {
		t.Fatalf("route still referenced: %+v", j.RouteID)
	}
}

func TestRouteFromTrip(t *testing.T) {
	e, _ := newDispatchEnv(t)
	dev := e.device("A", "356307042441013")
	t0 := time.Now().Add(-time.Hour).UTC().Truncate(time.Second)
	for i := 0; i <= 60; i++ {
		lat, lng := 2.0+0.00003*float64(i%2), 45.0+0.0005*float64(i) // straight east with ±3 m jitter
		if i > 40 {
			lat, lng = 2.0+0.0005*float64(i-40), 45.02 // then north
		}
		e.fix(dev.IMEI, t0.Add(time.Duration(i)*10*time.Second), lat, lng, 40)
	}
	var rt store.Route
	e.do("POST", "/api/v1/routes/from-trip", e.token, map[string]any{"deviceId": dev.ID, "name": "Recorded",
		"from": t0.Add(-time.Minute).Format(time.RFC3339), "to": t0.Add(time.Hour).Format(time.RFC3339)}, 201, &rt)
	if len(rt.Path) < 3 || len(rt.Path) > 5 || rt.Corridor != 200 || rt.MinDeviationSeconds != 60 {
		t.Fatalf("route from trip: %d points %+v", len(rt.Path), rt)
	}
	e.do("POST", "/api/v1/routes/from-trip", e.token, map[string]any{"deviceId": dev.ID, "name": "Empty",
		"from": "2001-01-01T00:00:00Z", "to": "2001-01-02T00:00:00Z"}, 400, nil)
	e.do("POST", "/api/v1/routes/from-trip", e.token, map[string]any{"deviceId": 999, "name": "x",
		"from": "2001-01-01T00:00:00Z", "to": "2001-01-02T00:00:00Z"}, 400, nil)
}

// multipartBody builds a multipart upload.
func multipartBody(t *testing.T, fields map[string]string, fileName string, content []byte) (string, *bytes.Buffer) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		_ = mw.WriteField(k, v)
	}
	if content != nil {
		fw, _ := mw.CreateFormFile("file", fileName)
		_, _ = fw.Write(content)
	}
	_ = mw.Close()
	return mw.FormDataContentType(), &buf
}

func (e *env) upload(path, token string, fields map[string]string, fileName string, content []byte, want int, out any) {
	e.t.Helper()
	ct, body := multipartBody(e.t, fields, fileName, content)
	req, _ := http.NewRequest("POST", e.srv.URL+path, body)
	req.Header.Set("Content-Type", ct)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != want {
		e.t.Fatalf("upload %s: status %d, want %d: %s", path, resp.StatusCode, want, raw)
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			e.t.Fatal(err)
		}
	}
}

func pngBytes(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	img.Set(1, 1, color.Black)
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestUploadsAndFileAccess(t *testing.T) {
	e, _ := newDispatchEnv(t)
	ds, g := fleet3(e)
	drvA, tokA := e.newDriver("Ann", "ann@x.io", ptr(ds[0].ID))
	_, tokB := e.newDriver("Ben", "ben@x.io", ptr(ds[1].ID))
	mgrOut := e.roleToken("m@x.io", store.RoleManager) // no groups
	mgrIn := e.roleToken("m2@x.io", store.RoleManager, g.ID)
	var j store.Job
	e.do("POST", "/api/v1/jobs", e.token, jobBody("POD", ptr(ds[0].ID), &drvA.ID, [2]float64{2, 45}), 201, &j)
	dp := "/api/v1/driver/jobs/" + itoa(j.ID) + "/attachments"

	var a store.Attachment
	e.upload(dp, tokA, map[string]string{"kind": "signature", "stopId": itoa(j.Stops[0].ID)}, `..\..\evil"name.txt`, pngBytes(t), 201, &a)
	if a.Kind != "signature" || a.ContentType != "image/png" || a.URL != "/api/v1/files/"+itoa(a.ID) ||
		a.StopID == nil || strings.ContainsAny(a.Name, `/\"`) || !strings.HasSuffix(a.Name, ".png") {
		t.Fatalf("attachment %+v", a)
	}
	// Validation.
	e.upload(dp, tokA, map[string]string{"kind": "photo"}, "a.txt", []byte("hello, plain text"), 415, nil)
	e.upload(dp, tokA, map[string]string{"kind": "photo"}, "x.svg", []byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`), 415, nil)
	big := append(pngBytes(t), make([]byte, MaxUploadBytes)...)
	e.upload(dp, tokA, map[string]string{"kind": "photo"}, "big.png", big, 413, nil)
	e.upload(dp, tokA, map[string]string{"kind": "selfie"}, "a.png", pngBytes(t), 400, nil)
	e.upload(dp, tokA, map[string]string{"kind": "photo", "stopId": "999999"}, "a.png", pngBytes(t), 400, nil)
	e.upload(dp, tokA, map[string]string{"kind": "photo"}, "", nil, 400, nil)
	e.upload(dp, tokB, map[string]string{"kind": "photo"}, "a.png", pngBytes(t), 404, nil)
	var pdf store.Attachment
	e.upload("/api/v1/jobs/"+itoa(j.ID)+"/attachments", e.token, nil, "doc.pdf", []byte("%PDF-1.4\n%fake\n"), 201, &pdf)
	if pdf.Kind != "document" || pdf.ContentType != "application/pdf" {
		t.Fatalf("pdf %+v", pdf)
	}
	e.do("GET", "/api/v1/jobs/"+itoa(j.ID), e.token, nil, 200, &j)
	if len(j.Attachments) != 2 {
		t.Fatalf("job attachments %+v", j.Attachments)
	}

	// File access.
	get := func(path, token string, header bool) (int, http.Header, []byte) {
		req, _ := http.NewRequest("GET", e.srv.URL+path, nil)
		if header {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, resp.Header, b
	}
	fp := "/api/v1/files/" + itoa(a.ID)
	code, h, b := get(fp, tokA, true)
	if code != 200 || h.Get("Content-Type") != "image/png" || !bytes.Equal(b, pngBytes(t)) ||
		h.Get("X-Content-Type-Options") != "nosniff" || !strings.HasPrefix(h.Get("Content-Disposition"), "inline") {
		t.Fatalf("driver file: %d %v", code, h)
	}
	for _, c := range []struct {
		tok  string
		want int
	}{{e.token, 200}, {mgrIn, 200}, {mgrOut, 404}, {tokB, 404}, {"", 401}} {
		if code, _, _ := get(fp, c.tok, c.tok != ""); code != c.want {
			t.Fatalf("file access: %d, want %d", code, c.want)
		}
	}
	if code, _, _ := get(fp+"?token="+tokA, "", false); code != 200 {
		t.Fatalf("?token= access: %d", code)
	}
	if code, _, _ := get("/api/v1/devices?token="+e.token, "", false); code != 401 {
		t.Fatalf("?token= must only work for files: %d", code)
	}
	// Deleting the job removes its files.
	e.do("DELETE", "/api/v1/jobs/"+itoa(j.ID), e.token, nil, 204, nil)
	if code, _, _ := get(fp, e.token, true); code != 404 {
		t.Fatalf("file after delete: %d", code)
	}
}

func TestDriverAppLocation(t *testing.T) {
	e, _ := newDispatchEnv(t)
	dev := e.device("Truck", "356307042441013")
	drvNo, tokNo := e.newDriver("Walker", "walk@x.io", nil)
	_, tokVeh := e.newDriver("Rider", "ride@x.io", ptr(dev.ID))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws := e.dialWSAs(ctx, tokNo)
	time.Sleep(100 * time.Millisecond)

	var res struct {
		Stored   bool
		DeviceID *int64
	}
	now := time.Now().UTC()
	e.do("POST", "/api/v1/driver/location", tokNo, map[string]any{"lat": 2.04, "lng": 45.31, "speed": 12, "accuracy": 8,
		"time": now.Add(-30 * time.Second).Format(time.RFC3339)}, 200, &res)
	if !res.Stored || res.DeviceID == nil {
		t.Fatalf("location %+v", res)
	}
	d, err := e.store.Device(*res.DeviceID)
	if err != nil || d.IMEI != "DRV"+itoa(drvNo.ID) || d.Protocol != "driverapp" || d.Position == nil ||
		d.Position.Attributes["accuracy"] != 8.0 {
		t.Fatalf("driverapp device %+v %v", d, err)
	}
	e.do("POST", "/api/v1/driver/location", tokNo, map[string]any{"lat": 2.05, "lng": 45.32}, 200, &res)
	var ps []domain.Position
	e.do("GET", "/api/v1/devices/"+itoa(d.ID)+"/positions", e.token, nil, 200, &ps)
	if len(ps) != 2 {
		t.Fatalf("history %d", len(ps))
	}
	// The driver's WS receives its phone's positions.
	waitWS(t, ctx, ws, "position")
	// Admin can rename the pseudo device.
	e.do("PATCH", "/api/v1/devices/"+itoa(d.ID), e.token, map[string]any{"name": "Walker phone"}, 200, nil)

	e.do("POST", "/api/v1/driver/location", tokVeh, map[string]any{"lat": 2.04, "lng": 45.31}, 200, &res)
	if res.Stored {
		t.Fatal("driver with a vehicle must not be tracked by default")
	}
	e.do("PATCH", "/api/v1/settings", e.token, map[string]any{"driverAppTracking": true}, 200, nil)
	e.do("POST", "/api/v1/driver/location", tokVeh, map[string]any{"lat": 2.04, "lng": 45.31}, 200, &res)
	if !res.Stored {
		t.Fatal("driverAppTracking on: expected stored")
	}
	var set map[string]any
	e.do("GET", "/api/v1/settings", e.token, nil, 200, &set)
	if set["driverAppTracking"] != true {
		t.Fatalf("settings %+v", set)
	}
	for _, bad := range []map[string]any{{"lat": 91, "lng": 1}, {"lng": 1}, {"lat": 0, "lng": 0},
		{"lat": 1, "lng": 1, "time": "2001-01-01T00:00:00Z"}, {"lat": 1, "lng": 1, "speed": -1}} {
		e.do("POST", "/api/v1/driver/location", tokNo, bad, 400, nil)
	}
}

func TestSniffType(t *testing.T) {
	webp := append([]byte("RIFF\x24\x00\x00\x00WEBPVP8 "), make([]byte, 20)...)
	jpeg := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 'J', 'F', 'I', 'F', 0}
	for _, c := range []struct {
		b    []byte
		want string
	}{{webp, "image/webp"}, {jpeg, "image/jpeg"}, {[]byte("%PDF-1.7"), "application/pdf"},
		{[]byte("GIF89a....."), ""}, {[]byte("<html></html>"), ""}} {
		if got := sniffType(c.b); got != c.want {
			t.Errorf("sniff %q: %q, want %q", c.b[:4], got, c.want)
		}
	}
	if n := safeFileName("../../a/b/c.JPEG", "photo", ".jpg"); n != "c.JPEG" {
		t.Errorf("name %q", n)
	}
	if n := safeFileName("", "signature", ".png"); n != "signature.png" {
		t.Errorf("name %q", n)
	}
}
