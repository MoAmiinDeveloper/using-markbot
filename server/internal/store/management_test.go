package store

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
)

func mgmtStore(t *testing.T, opts Options) (*Store, *recorder) {
	t.Helper()
	rec := &recorder{}
	opts.Publisher = rec
	opts.AutoRegister = true
	return newTestStore(t, openTestPool(t, "mgmt_test"), opts), rec
}

func TestRoleMigration(t *testing.T) {
	pool := openTestPool(t, "mgmt_test")
	ctx := context.Background()
	ms, err := loadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `CREATE TABLE schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		t.Fatal(err)
	}
	for _, m := range ms {
		if m.version >= 4 {
			break
		}
		if _, err := pool.Exec(ctx, m.sql); err != nil {
			t.Fatal(m.name, err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, m.version); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO users (email, password_hash, role) VALUES
		('a@x', 'h', 'admin'), ('u@x', 'h', 'user')`); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	rows, _ := pool.Query(ctx, `SELECT email, role, active FROM users ORDER BY email`)
	got := map[string]string{}
	for rows.Next() {
		var e, r string
		var a bool
		if err := rows.Scan(&e, &r, &a); err != nil || !a {
			t.Fatal(err, a)
		}
		got[e] = r
	}
	if got["a@x"] != "admin" || got["u@x"] != "manager" {
		t.Fatalf("roles after migration %v", got)
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET role = 'user' WHERE email = 'u@x'`); err == nil {
		t.Fatal("role 'user' still accepted")
	}
}

func TestUserManagementSafety(t *testing.T) {
	clk := newClock(time.Date(2026, 10, 22, 8, 0, 0, 0, time.UTC))
	s, _ := mgmtStore(t, Options{Now: clk.Now})
	ctx := context.Background()
	admin, err := s.CreateUser(ctx, "admin@x.io", "A", "pw", RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	if admin.GroupIDs == nil || !admin.Active || admin.LastLoginAt != nil {
		t.Fatalf("admin %+v", admin)
	}
	viewer, err := s.CreateUserFull(ctx, UserInput{Email: "v@x.io", Password: "pw", Role: RoleViewer})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateUserFull(ctx, UserInput{Email: "bad@x.io", Password: "pw", Role: "user2"}); !isValidation(err) {
		t.Fatalf("bad role: %v", err)
	}
	if _, err := s.CreateUserFull(ctx, UserInput{Email: "g@x.io", Password: "pw", Role: RoleViewer, GroupIDs: []int64{99}}); !isValidation(err) {
		t.Fatalf("unknown group: %v", err)
	}

	viewerRole := RoleViewer
	adminRole := RoleAdmin
	off := false
	// Self-demotion / self-deactivation / self-deletion.
	if _, err := s.UpdateUser(ctx, admin.ID, admin.ID, UserPatch{Role: &viewerRole}); !isValidation(err) {
		t.Fatalf("self demote: %v", err)
	}
	if _, err := s.UpdateUser(ctx, admin.ID, admin.ID, UserPatch{Active: &off}); !isValidation(err) {
		t.Fatalf("self deactivate: %v", err)
	}
	if err := s.DeleteUser(ctx, admin.ID, admin.ID); !isValidation(err) {
		t.Fatalf("self delete: %v", err)
	}
	// Last admin, acted on by another (hypothetical) admin id.
	if _, err := s.UpdateUser(ctx, 999, admin.ID, UserPatch{Role: &viewerRole}); !isValidation(err) {
		t.Fatalf("demote last admin: %v", err)
	}
	if err := s.DeleteUser(ctx, 999, admin.ID); !isValidation(err) {
		t.Fatalf("delete last admin: %v", err)
	}
	// With a second admin, the first can be demoted by the second.
	if _, err := s.UpdateUser(ctx, admin.ID, viewer.ID, UserPatch{Role: &adminRole}); err != nil {
		t.Fatal(err)
	}
	u, err := s.UpdateUser(ctx, viewer.ID, admin.ID, UserPatch{Role: &viewerRole})
	if err != nil || u.Role != RoleViewer {
		t.Fatalf("demote with another admin: %+v %v", u, err)
	}
	if role, ok := s.UserRole(admin.ID); !ok || role != RoleViewer {
		t.Fatalf("cached role %q %v", role, ok)
	}

	// Login records last_login_at; inactive accounts are rejected.
	got, err := s.Authenticate(ctx, "ADMIN@x.io", "pw")
	if err != nil || got.LastLoginAt == nil || !got.LastLoginAt.Equal(clk.Now()) {
		t.Fatalf("login %+v %v", got, err)
	}
	if _, err := s.UpdateUser(ctx, viewer.ID, admin.ID, UserPatch{Active: &off}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Authenticate(ctx, "admin@x.io", "pw"); !errors.Is(err, ErrUserInactive) {
		t.Fatalf("inactive login: %v", err)
	}
	if _, err := s.Authenticate(ctx, "admin@x.io", "wrong"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("inactive wrong pw: %v", err)
	}
	if _, ok := s.UserRole(admin.ID); ok {
		t.Fatal("inactive user still has a role")
	}
	if all, ids := s.DeviceScope(admin.ID); all || len(ids) != 0 {
		t.Fatal("inactive user has a scope")
	}

	// Profile / password change.
	name := "  New Name "
	if _, err := s.UpdateProfile(ctx, viewer.ID, &name, "newsecret"); err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.CheckPassword(ctx, viewer.ID, "newsecret"); !ok {
		t.Fatal("password not changed")
	}
	if u, _ := s.UserByID(ctx, viewer.ID); u.Name != "New Name" {
		t.Fatalf("name %q", u.Name)
	}
}

func TestGroupsAndScope(t *testing.T) {
	s, rec := mgmtStore(t, Options{})
	ctx := context.Background()
	d1, _ := s.CreateDevice(ctx, DeviceInput{Name: "A", IMEI: imei1})
	d2, _ := s.CreateDevice(ctx, DeviceInput{Name: "B", IMEI: "356307042441014"})
	g, err := s.CreateGroup(ctx, GroupInput{Name: " North ", DeviceIDs: []int64{d1.ID}})
	if err != nil || g.Name != "North" || g.Color != "#ffd700" || len(g.DeviceIDs) != 1 {
		t.Fatalf("group %+v %v", g, err)
	}
	if _, err := s.CreateGroup(ctx, GroupInput{Name: "x", DeviceIDs: []int64{12345}}); !isValidation(err) {
		t.Fatalf("unknown device: %v", err)
	}
	if len(rec.take(EventAccess)) == 0 {
		t.Fatal("no access event")
	}
	u, _ := s.CreateUserFull(ctx, UserInput{Email: "m@x.io", Password: "pw", Role: RoleManager, GroupIDs: []int64{g.ID}})
	if len(u.GroupIDs) != 1 || u.GroupIDs[0] != g.ID {
		t.Fatalf("user groups %v", u.GroupIDs)
	}
	if !s.CanSeeDevice(u.ID, d1.ID) || s.CanSeeDevice(u.ID, d2.ID) {
		t.Fatal("scope wrong")
	}
	if d, _ := s.Device(d1.ID); len(d.GroupIDs) != 1 {
		t.Fatalf("device groups %v", d.GroupIDs)
	}
	// Moving d2 into the group re-announces it with its new groups.
	rec.take(EventDevice)
	ids := []int64{d1.ID, d2.ID}
	if _, err := s.UpdateGroup(ctx, g.ID, GroupPatch{DeviceIDs: &ids}); err != nil {
		t.Fatal(err)
	}
	if evs := rec.take(EventDevice); len(evs) != 1 || evs[0].(Device).ID != d2.ID {
		t.Fatalf("device events %v", evs)
	}
	if !s.CanSeeDevice(u.ID, d2.ID) || len(s.DevicesScoped(s.DeviceScope(u.ID))) != 2 {
		t.Fatal("scope not updated")
	}
	if sum := s.SummaryScoped(false, map[int64]bool{d1.ID: true}); sum.Total != 1 || sum.Never != 1 {
		t.Fatalf("summary %+v", sum)
	}
	if err := s.DeleteGroup(ctx, g.ID); err != nil {
		t.Fatal(err)
	}
	if s.CanSeeDevice(u.ID, d1.ID) {
		t.Fatal("scope survives group deletion")
	}
	// A restarted store loads the same snapshot.
	if err := s.SetDeviceGroups(ctx, d2.ID, []int64{}); err != nil {
		t.Fatal(err)
	}
}

func TestCountersAndDrivers(t *testing.T) {
	pool := openTestPool(t, "mgmt_test")
	s := newTestStore(t, pool, Options{AutoRegister: true})
	ctx := context.Background()
	if ok, err := s.Authorize(ctx, imei1, "teltonika"); !ok || err != nil {
		t.Fatal(ok, err)
	}
	id := s.Devices()[0].ID
	base := time.Date(2026, 10, 22, 8, 0, 0, 0, time.UTC)
	// 0.01° latitude ≈ 1112 m per minute while moving with ignition on.
	var batch []domain.Position
	for i := 0; i <= 10; i++ {
		batch = append(batch, pos(base.Add(time.Duration(i)*time.Minute), 25+float64(i)*0.01, 60, true))
	}
	if err := s.Positions(ctx, batch); err != nil {
		t.Fatal(err)
	}
	want := Haversine(25, 55.27, 25.1, 55.27) / 1000
	d, _ := s.Device(id)
	if math.Abs(d.Odometer-want) > 0.11 || d.EngineHours != round1(10.0/60) {
		t.Fatalf("odometer %v (want %.2f), hours %v", d.Odometer, want, d.EngineHours)
	}
	// Replayed old records and parked drift do not count; ignition off stops engine time.
	if err := s.Positions(ctx, []domain.Position{pos(base.Add(-time.Hour), 26, 60, true)}); err != nil {
		t.Fatal(err)
	}
	drift := pos(base.Add(11*time.Minute), 25.1001, 0, false)
	if err := s.Positions(ctx, []domain.Position{drift, pos(base.Add(70*time.Minute), 25.1002, 0, false)}); err != nil {
		t.Fatal(err)
	}
	if d2, _ := s.Device(id); d2.Odometer != d.Odometer || d2.EngineHours != round1(11.0/60) {
		t.Fatalf("after replay/drift: %v km %v h (was %v, %v)", d2.Odometer, d2.EngineHours, d.Odometer, d.EngineHours)
	}

	// Calibration: the displayed values equal the requested ones and keep accumulating.
	odo, hours := 1000.0, 50.0
	if d, err := s.SetDeviceCounters(ctx, id, &odo, &hours); err != nil || d.Odometer != 1000 || d.EngineHours != 50 {
		t.Fatalf("calibrated %+v %v", d, err)
	}
	if err := s.Positions(ctx, []domain.Position{pos(base.Add(80*time.Minute), 25.1, 50, true), pos(base.Add(81*time.Minute), 25.11, 50, true)}); err != nil {
		t.Fatal(err)
	}
	d, _ = s.Device(id)
	if math.Abs(d.Odometer-1001.1) > 0.15 || d.EngineHours != round1(50+1.0/60) {
		t.Fatalf("after calibration %v km %v h", d.Odometer, d.EngineHours)
	}

	// Restart: counters come back from device_state.
	s2 := newTestStore(t, pool, Options{AutoRegister: true})
	if d2, _ := s2.Device(id); d2.Odometer != d.Odometer || d2.EngineHours != d.EngineHours {
		t.Fatalf("after restart %v/%v, want %v/%v", d2.Odometer, d2.EngineHours, d.Odometer, d.EngineHours)
	}

	// Tracker odometer (meters) takes over as the base; calibration still applies.
	p := pos(base.Add(90*time.Minute), 25.12, 50, true)
	p.Attributes[domain.AttrOdometer] = 123456.0
	if err := s2.Positions(ctx, []domain.Position{p}); err != nil {
		t.Fatal(err)
	}
	odo = 200
	if d, _ := s2.SetDeviceCounters(ctx, id, &odo, nil); d.Odometer != 200 {
		t.Fatalf("calibrated tracker odometer %v", d.Odometer)
	}
	p = pos(base.Add(91*time.Minute), 25.13, 50, true)
	p.Attributes[domain.AttrOdometer] = 125456.0
	_ = s2.Positions(ctx, []domain.Position{p})
	if d, _ := s2.Device(id); d.Odometer != 202 {
		t.Fatalf("tracker odometer delta: %v", d.Odometer)
	}
	bad := -1.0
	if _, err := s2.SetDeviceCounters(ctx, id, &bad, nil); !isValidation(err) {
		t.Fatalf("negative odometer: %v", err)
	}

	// Drivers: manual assignment, overridden by an iButton tag.
	manual, err := s2.CreateDriver(ctx, DriverInput{Name: "Manual", DeviceID: &id, LicenseExpiry: ref("2027-01-31")})
	if err != nil || manual.LicenseExpiry == nil || *manual.LicenseExpiry != "2027-01-31" {
		t.Fatalf("driver %+v %v", manual, err)
	}
	tagged, err := s2.CreateDriver(ctx, DriverInput{Name: "Tagged", Tag: "00000a1b2c3d"})
	if err != nil || tagged.Tag != "00000A1B2C3D" {
		t.Fatalf("tagged %+v %v", tagged, err)
	}
	if _, err := s2.CreateDriver(ctx, DriverInput{Name: "Dup", Tag: "A1B2C3D"}); !isValidation(err) {
		t.Fatalf("duplicate tag: %v", err)
	}
	if d, _ := s2.Device(id); d.DriverID == nil || *d.DriverID != manual.ID {
		t.Fatalf("manual driver %v", d.DriverID)
	}
	p = pos(base.Add(92*time.Minute), 25.14, 50, true)
	p.Attributes[domain.AttrDriverID] = "A1B2C3D"
	_ = s2.Positions(ctx, []domain.Position{p})
	if d, _ := s2.Device(id); d.DriverID == nil || *d.DriverID != tagged.ID {
		t.Fatalf("tag driver %v", d.DriverID)
	}
	if s2.DriverForPosition(&p) != tagged.ID {
		t.Fatal("DriverForPosition")
	}
	// Ignition off ends the tag session: back to the manual driver.
	_ = s2.Positions(ctx, []domain.Position{pos(base.Add(93*time.Minute), 25.14, 0, false)})
	if d, _ := s2.Device(id); d.DriverID == nil || *d.DriverID != manual.ID {
		t.Fatalf("after ignition off %v", d.DriverID)
	}
	// Re-assigning the vehicle unassigns the previous driver.
	if err := s2.AssignDriver(ctx, id, &tagged.ID); err != nil {
		t.Fatal(err)
	}
	if m, _ := s2.Driver(ctx, manual.ID); m.DeviceID != nil {
		t.Fatalf("previous driver still assigned: %v", *m.DeviceID)
	}
	if err := s2.AssignDriver(ctx, id, nil); err != nil {
		t.Fatal(err)
	}
	if d, _ := s2.Device(id); d.DriverID != nil {
		t.Fatalf("unassigned driver %v", *d.DriverID)
	}
}

func ref[T any](v T) *T { return &v }

func TestMaintenanceStatusMath(t *testing.T) {
	today := time.Date(2026, 10, 22, 15, 0, 0, 0, time.UTC)
	cases := []struct {
		name   string
		m      Maintenance
		odo, h float64
		want   string
	}{
		{"km ok", Maintenance{IntervalKm: 10000, LastServiceKm: 80000, NotifyBeforeKm: 500}, 85000, 0, DueOK},
		{"km soon", Maintenance{IntervalKm: 10000, LastServiceKm: 80000, NotifyBeforeKm: 500}, 89500, 0, DueSoon},
		{"km overdue at due", Maintenance{IntervalKm: 10000, LastServiceKm: 80000}, 90000, 0, DueOverdue},
		{"days ok", Maintenance{IntervalDays: 30, LastServiceDate: "2026-10-01", NotifyBeforeDays: 7}, 0, 0, DueOK},
		{"days soon", Maintenance{IntervalDays: 30, LastServiceDate: "2026-09-29", NotifyBeforeDays: 7}, 0, 0, DueSoon},
		{"days due today", Maintenance{IntervalDays: 30, LastServiceDate: "2026-09-22"}, 0, 0, DueSoon},
		{"days overdue", Maintenance{IntervalDays: 30, LastServiceDate: "2026-09-21"}, 0, 0, DueOverdue},
		{"hours soon", Maintenance{IntervalHours: 250, LastServiceHours: 700, NotifyBeforeHours: 10}, 0, 941, DueSoon},
		{"hours overdue", Maintenance{IntervalHours: 250, LastServiceHours: 700}, 0, 950.1, DueOverdue},
		{"worst wins", Maintenance{IntervalKm: 10000, LastServiceKm: 0, IntervalDays: 30, LastServiceDate: "2026-09-01"}, 10, 0, DueOverdue},
	}
	for _, c := range cases {
		c.m.ComputeStatus(c.odo, c.h, today)
		if c.m.Status != c.want {
			t.Errorf("%s: status %s, want %s (%+v)", c.name, c.m.Status, c.want, c.m)
		}
	}
	m := Maintenance{IntervalKm: 10000, LastServiceKm: 80000, IntervalDays: 180, LastServiceDate: "2026-08-01"}
	m.ComputeStatus(88799.5, 0, today)
	if *m.NextDueKm != 90000 || *m.RemainingKm != 1200.5 || *m.NextDueDate != "2027-01-28" || *m.RemainingDays != 98 ||
		m.NextDueHours != nil || m.RemainingHours != nil {
		t.Fatalf("computed %+v", m)
	}
}

func TestUpkeepTransitionsOnce(t *testing.T) {
	clk := newClock(time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC))
	s, _ := mgmtStore(t, Options{Now: clk.Now})
	ctx := context.Background()
	dev, _ := s.CreateDevice(ctx, DeviceInput{Name: "T", IMEI: imei1})

	m, err := s.CreateMaintenance(ctx, MaintenanceInput{DeviceID: &dev.ID, Name: ref("Oil"), IntervalDays: ref(10),
		NotifyBeforeDays: ref(3)})
	if err != nil || m.Status != DueOK || m.LastServiceDate != "2026-10-01" {
		t.Fatalf("created %+v %v", m, err)
	}
	if _, err := s.CreateMaintenance(ctx, MaintenanceInput{DeviceID: &dev.ID, Name: ref("x")}); !isValidation(err) {
		t.Fatalf("no interval: %v", err)
	}
	rm, err := s.CreateReminder(ctx, ReminderInput{DeviceID: OptID{Set: true, ID: &dev.ID}, Kind: ref("insurance"),
		Title: ref("Insurance"), DueDate: ref("2026-10-20"), NotifyDaysBefore: ref(5)})
	if err != nil || rm.Status != DueOK || rm.RemainingDays != 19 {
		t.Fatalf("reminder %+v %v", rm, err)
	}
	if _, err := s.CreateReminder(ctx, ReminderInput{Title: ref("x"), DueDate: ref("2026-13-01")}); !isValidation(err) {
		t.Fatalf("bad date: %v", err)
	}

	check := func(wantM, wantR []string) {
		t.Helper()
		items, err := s.UpkeepTransitions(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var gotM, gotR []string
		for _, it := range items {
			if it.DeviceID != dev.ID {
				t.Fatalf("item device %d", it.DeviceID)
			}
			if it.Maintenance != nil {
				gotM = append(gotM, it.Maintenance.Status)
			} else {
				gotR = append(gotR, it.Reminder.Status)
			}
		}
		if len(gotM) != len(wantM) || len(gotR) != len(wantR) || (len(gotM) > 0 && gotM[0] != wantM[0]) ||
			(len(gotR) > 0 && gotR[0] != wantR[0]) {
			t.Fatalf("%s: transitions m=%v r=%v, want m=%v r=%v", clk.Now().Format(time.DateOnly), gotM, gotR, wantM, wantR)
		}
	}
	check(nil, nil)
	clk.Set(time.Date(2026, 10, 8, 9, 0, 0, 0, time.UTC)) // 3 days left on maintenance
	check([]string{DueSoon}, nil)
	check(nil, nil)                                        // exactly once
	clk.Set(time.Date(2026, 10, 15, 9, 0, 0, 0, time.UTC)) // maintenance overdue, reminder 5 days → dueSoon
	check([]string{DueOverdue}, []string{DueSoon})
	check(nil, nil)
	clk.Set(time.Date(2026, 10, 21, 9, 0, 0, 0, time.UTC))
	check(nil, []string{DueOverdue})

	// Completing re-arms silently and books an expense.
	got, rec, err := s.CompleteMaintenance(ctx, m.ID, CompleteInput{Cost: ref(45.5), Notes: "synthetic"})
	if err != nil || got.Status != DueOK || got.LastServiceDate != "2026-10-21" || rec.Cost != 45.5 {
		t.Fatalf("complete %+v %+v %v", got, rec, err)
	}
	check(nil, nil)
	hist, _ := s.ServiceHistory(ctx, m.ID)
	exps, _ := s.Expenses(ctx, Scope{All: true}, ExpenseFilter{Category: "maintenance"})
	if len(hist) != 1 || len(exps) != 1 || exps[0].Amount != 45.5 || exps[0].Notes != "Oil: synthetic" {
		t.Fatalf("history %+v expenses %+v", hist, exps)
	}
	// No expense without cost.
	if _, _, err := s.CompleteMaintenance(ctx, m.ID, CompleteInput{Date: "2026-10-21"}); err != nil {
		t.Fatal(err)
	}
	if exps, _ := s.Expenses(ctx, Scope{All: true}, ExpenseFilter{}); len(exps) != 1 {
		t.Fatalf("expenses %d", len(exps))
	}
	// Renewing the reminder re-arms it; it can fire again later.
	if _, err := s.UpdateReminder(ctx, rm.ID, ReminderInput{DueDate: ref("2027-10-20")}); err != nil {
		t.Fatal(err)
	}
	check(nil, nil)
	clk.Set(time.Date(2027, 10, 16, 9, 0, 0, 0, time.UTC)) // a year later the oil change is overdue again too
	check([]string{DueOverdue}, []string{DueSoon})

	// A driver-only reminder without an assigned vehicle has no event device.
	drv, _ := s.CreateDriver(ctx, DriverInput{Name: "D"})
	if _, err := s.CreateReminder(ctx, ReminderInput{DriverID: OptID{Set: true, ID: &drv.ID}, Kind: ref("license"),
		Title: ref("License"), DueDate: ref("2027-10-01")}); err != nil {
		t.Fatal(err)
	}
	items, _ := s.UpkeepTransitions(ctx)
	if len(items) != 1 || items[0].DeviceID != 0 || items[0].Reminder.Status != DueOverdue {
		t.Fatalf("driver reminder %+v", items)
	}
}

func TestExpensesAndShares(t *testing.T) {
	clk := newClock(time.Date(2026, 10, 22, 9, 0, 0, 0, time.UTC))
	s, _ := mgmtStore(t, Options{Now: clk.Now})
	ctx := context.Background()
	d1, _ := s.CreateDevice(ctx, DeviceInput{Name: "A", IMEI: imei1})
	d2, _ := s.CreateDevice(ctx, DeviceInput{Name: "B", IMEI: "356307042441014"})
	mk := func(dev int64, cat, date string, amount float64) Expense {
		t.Helper()
		e, err := s.CreateExpense(ctx, ExpenseInput{DeviceID: &dev, Category: &cat, Date: &date, Amount: &amount})
		if err != nil {
			t.Fatal(err)
		}
		return e
	}
	fuel := mk(d1.ID, "fuel", "2026-10-20", 45.5)
	mk(d1.ID, "toll", "2026-10-21", 3)
	mk(d2.ID, "fuel", "2026-09-01", 60)
	for _, bad := range []ExpenseInput{{Category: ref("fuel"), Amount: ref(1.0)}, {DeviceID: &d1.ID, Category: ref("beer"), Amount: ref(1.0)},
		{DeviceID: &d1.ID, Category: ref("fuel"), Amount: ref(-1.0)}, {DeviceID: &d1.ID, Category: ref("fuel")},
		{DeviceID: ref(int64(9999)), Category: ref("fuel"), Amount: ref(1.0)}} {
		if _, err := s.CreateExpense(ctx, bad); !isValidation(err) {
			t.Fatalf("%+v: %v", bad, err)
		}
	}
	list := func(sc Scope, f ExpenseFilter) int {
		es, err := s.Expenses(ctx, sc, f)
		if err != nil {
			t.Fatal(err)
		}
		return len(es)
	}
	all := Scope{All: true}
	if n := list(all, ExpenseFilter{}); n != 3 {
		t.Fatalf("all %d", n)
	}
	if n := list(all, ExpenseFilter{Category: "fuel"}); n != 2 {
		t.Fatalf("fuel %d", n)
	}
	if n := list(all, ExpenseFilter{From: "2026-10-01", To: "2026-10-20"}); n != 1 {
		t.Fatalf("range %d", n)
	}
	if n := list(all, ExpenseFilter{DeviceID: d2.ID}); n != 1 {
		t.Fatalf("device %d", n)
	}
	if n := list(Scope{DeviceIDs: []int64{d2.ID}}, ExpenseFilter{}); n != 1 {
		t.Fatalf("scoped %d", n)
	}
	if n := list(Scope{}, ExpenseFilter{}); n != 0 {
		t.Fatalf("empty scope %d", n)
	}
	upd, err := s.UpdateExpense(ctx, fuel.ID, ExpenseInput{Liters: OptFloat{Set: true, V: ref(30.2)}, Notes: ref("full tank")})
	if err != nil || upd.Liters == nil || *upd.Liters != 30.2 || upd.Amount != 45.5 || upd.Notes != "full tank" {
		t.Fatalf("updated %+v %v", upd, err)
	}
	upd, _ = s.UpdateExpense(ctx, fuel.ID, ExpenseInput{Liters: OptFloat{Set: true}})
	if upd.Liters != nil {
		t.Fatal("liters not cleared")
	}
	if err := s.DeleteExpense(ctx, fuel.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteExpense(ctx, fuel.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete %v", err)
	}

	l, err := s.CreateShare(ctx, d1.ID, 0, time.Hour)
	if err != nil || len(l.Token) != 40 || l.URL != "/share/"+l.Token || !l.ExpiresAt.Equal(clk.Now().Add(time.Hour)) {
		t.Fatalf("share %+v %v", l, err)
	}
	if _, err := s.ActiveShare(ctx, l.Token); err != nil {
		t.Fatal(err)
	}
	if ls, _ := s.Shares(ctx, d1.ID); len(ls) != 1 {
		t.Fatalf("shares %v", ls)
	}
	clk.Add(2 * time.Hour)
	if _, err := s.ActiveShare(ctx, l.Token); !errors.Is(err, ErrShareGone) {
		t.Fatalf("expired: %v", err)
	}
	if ls, _ := s.Shares(ctx, d1.ID); len(ls) != 0 {
		t.Fatalf("expired listed %v", ls)
	}
	l2, _ := s.CreateShare(ctx, d1.ID, 0, time.Hour)
	if err := s.RevokeShare(ctx, l2.Token); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ActiveShare(ctx, l2.Token); !errors.Is(err, ErrShareGone) {
		t.Fatalf("revoked: %v", err)
	}
	if _, err := s.ActiveShare(ctx, "nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown: %v", err)
	}
}
