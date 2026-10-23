package reports

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/geocode"
	"github.com/moamiindeveloper/fleet/server/internal/store"
	"github.com/moamiindeveloper/fleet/server/internal/store/storetest"
)

// seed stores the analyzer scenario for one device plus events, a driver,
// an expense and a maintenance item, using the real schema.
func seed(t *testing.T) (*store.Store, store.Device) {
	t.Helper()
	ctx := context.Background()
	pool := storetest.Pool(t, "reports_test")
	st, err := store.New(ctx, pool, store.Options{AutoRegister: true, Now: func() time.Time { return base.Add(2 * time.Hour) }})
	if err != nil {
		t.Fatal(err)
	}
	dev, err := st.CreateDevice(ctx, store.DeviceInput{Name: "Truck 07", IMEI: "356307042441013"})
	if err != nil {
		t.Fatal(err)
	}
	var batch []domain.Position
	for _, p := range scenario() {
		attrs := map[string]any{"ignition": *p.Ignition}
		if p.Driver != "" {
			attrs["driverId"] = p.Driver
		}
		attrs["fuelUsed"] = float64(p.Time.Sub(base).Minutes()) / 10
		batch = append(batch, domain.Position{IMEI: dev.IMEI, Protocol: "teltonika", DeviceTime: p.Time,
			ServerTime: p.Time.Add(2 * time.Second), Latitude: p.Lat, Longitude: p.Lng, Speed: p.Speed, Valid: true,
			Satellites: 9, Attributes: attrs})
	}
	if ok, err := st.Authorize(ctx, dev.IMEI, "teltonika"); !ok || err != nil {
		t.Fatal(ok, err)
	}
	if err := st.Positions(ctx, batch); err != nil {
		t.Fatal(err)
	}
	at := func(min float64) time.Time { return base.Add(time.Duration(min * float64(time.Minute))) }
	evs := []store.Event{
		{DeviceID: dev.ID, Type: store.EventOverspeed, Time: at(20), Lat: 25.1, Lng: 55,
			Attributes: map[string]any{"speed": 112.0, "maxSpeed": 118.0, "limit": 100.0}, Message: "speeding"},
		{DeviceID: dev.ID, Type: store.EventHarshBraking, Time: at(21), Message: "brake"},
		{DeviceID: dev.ID, Type: store.EventHarshAcceleration, Time: at(45), Message: "acc"},
		{DeviceID: dev.ID, Type: store.EventGeofenceEnter, Time: at(5), Attributes: map[string]any{"geofenceName": "Depot"}},
		{DeviceID: dev.ID, Type: store.EventGeofenceExit, Time: at(15), Attributes: map[string]any{"geofenceName": "Depot"}},
		{DeviceID: dev.ID, Type: store.EventGeofenceEnter, Time: at(60), Attributes: map[string]any{"geofenceName": "Depot"}},
		{DeviceID: dev.ID, Type: store.EventCommandResult, Time: at(61)},
	}
	if err := st.InsertEvents(ctx, evs); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO drivers (name, tag) VALUES ('Ahmed Ali', 'AB')`,
		`INSERT INTO expenses (device_id, category, amount, liters, date) VALUES (1, 'fuel', 45.5, 30, '2026-10-20'),
			(1, 'toll', 4.5, NULL, '2026-10-20'), (1, 'fuel', 10, 5, '2026-09-01')`,
		`INSERT INTO maintenance (device_id, name, interval_days, last_service_date, notify_before_days)
			VALUES (1, 'Oil change', 30, '2026-09-01', 7)`,
		`INSERT INTO places (name, lat, lng, radius) VALUES ('Home base', 25, 55, 100)`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatal(q, err)
		}
	}
	dev, _ = st.Device(dev.ID)
	return st, dev
}

func run(t *testing.T, e *Engine, typ string, dev store.Device, driverID int64) *Report {
	t.Helper()
	rep, err := e.Run(context.Background(), Request{Type: typ, Devices: []store.Device{dev}, DriverID: driverID,
		From: base.Add(-time.Hour), To: base.Add(2 * time.Hour), Now: base.Add(2 * time.Hour)})
	if err != nil {
		t.Fatalf("%s: %v", typ, err)
	}
	for _, c := range rep.Columns {
		for _, r := range rep.Rows {
			if _, ok := r[c.Key]; !ok {
				t.Fatalf("%s: row lacks column %s: %v", typ, c.Key, r)
			}
		}
	}
	// Every report exports in every format.
	var buf bytes.Buffer
	if err := WriteCSV(&buf, rep, nil); err != nil {
		t.Fatal(err)
	}
	if err := WriteXLSX(&buf, rep, nil, base); err != nil {
		t.Fatal(err)
	}
	if err := WritePDF(&buf, rep, nil, base); err != nil {
		t.Fatal(err)
	}
	return rep
}

func TestReportsEndToEnd(t *testing.T) {
	st, dev := seed(t)
	geo, err := geocode.New(st, geocode.Options{Provider: "off"})
	if err != nil {
		t.Fatal(err)
	}
	e := New(st, geo, nil)

	sum := run(t, e, "summary", dev, 0)
	r := sum.Rows[0]
	if !near(r["distance"].(float64), 30, 0.01) || r["drivingTime"] != 1800.0 || r["idleTime"] != 600.0 ||
		r["trips"] != 2 || r["stops"] != 3 || r["overspeeds"] != 1 || r["harshEvents"] != 2 || r["alerts"] != 6 ||
		r["engineHours"] != round(2400.0/3600, 2) || r["fuelUsed"] != 7.0 || r["avgSpeed"] != 60.0 {
		t.Fatalf("summary %v", r)
	}
	if sum.Columns[len(sum.Columns)-1].Key != "fuelUsed" {
		t.Fatal("fuel column missing")
	}

	trips := run(t, e, "trips", dev, 0)
	if len(trips.Rows) != 2 || trips.Rows[0]["driver"] != "Ahmed Ali" || trips.Rows[1]["driver"] != nil ||
		trips.Rows[0]["startAddress"] != "Home base" {
		t.Fatalf("trips %v", trips.Rows)
	}
	var tripKm float64
	for _, row := range trips.Rows {
		tripKm += row["distance"].(float64)
	}
	if !near(tripKm, r["distance"].(float64), 0.02) {
		t.Fatalf("trip sum %v vs summary %v", tripKm, r["distance"])
	}
	if got := run(t, e, "trips", dev, 1); len(got.Rows) != 1 {
		t.Fatalf("driver filter %d", len(got.Rows))
	}

	if rep := run(t, e, "daily", dev, 0); len(rep.Rows) != 1 || rep.Rows[0]["date"] != "2026-10-20" {
		t.Fatalf("daily %v", rep.Rows)
	}
	if rep := run(t, e, "stops", dev, 0); len(rep.Rows) != 3 || rep.Rows[1]["ignition"] != "on" || rep.Rows[0]["ignition"] != "off" {
		t.Fatalf("stops %v", rep.Rows)
	}
	if rep := run(t, e, "idle", dev, 0); len(rep.Rows) != 2 || rep.Totals["duration"] != 600.0 {
		t.Fatalf("idle %v", rep.Rows)
	}
	if rep := run(t, e, "ignition", dev, 0); len(rep.Rows) != 1 || rep.Rows[0]["duration"] != 2400.0 {
		t.Fatalf("ignition %v", rep.Rows)
	}
	if rep := run(t, e, "overspeed", dev, 0); len(rep.Rows) != 1 || rep.Rows[0]["driver"] != "Ahmed Ali" ||
		rep.Rows[0]["maxSpeed"] != 118.0 || rep.Rows[0]["limit"] != 100.0 {
		t.Fatalf("overspeed %v", rep.Rows)
	}
	gf := run(t, e, "geofence", dev, 0)
	if len(gf.Rows) != 2 || gf.Rows[0]["duration"] != 600.0 || gf.Rows[1]["exit"] != nil ||
		gf.Rows[1]["duration"] != 3600.0 || gf.Rows[0]["geofence"] != "Depot" {
		t.Fatalf("geofence %v", gf.Rows)
	}
	if rep := run(t, e, "alerts", dev, 0); len(rep.Rows) != 6 {
		t.Fatalf("alerts %d", len(rep.Rows))
	}
	drv := run(t, e, "driver", dev, 0)
	if len(drv.Rows) != 2 {
		t.Fatalf("driver %v", drv.Rows)
	}
	for _, row := range drv.Rows {
		switch row["driver"] {
		case "Ahmed Ali": // 20 km, 1 overspeed, 1 harsh braking -> 100 - (5+3)/0.2
			if row["overspeeds"] != 1 || row["harshBraking"] != 1 || row["score"] != 60.0 || !near(row["distance"].(float64), 20, 0.01) {
				t.Fatalf("ahmed %v", row)
			}
		case "Truck 07": // 10 km, 1 harsh accel, 10 min idle -> 100 - (3 + 1/6*2)/0.1
			if row["driverId"] != nil || row["deviceId"] != dev.ID || row["harshAcceleration"] != 1 || row["score"] != round(100-(3+2.0/6)/0.1, 1) {
				t.Fatalf("truck bucket %v", row)
			}
		default:
			t.Fatalf("row %v", row)
		}
	}
	exp := run(t, e, "expenses", dev, 0)
	if len(exp.Rows) != 2 || exp.Totals["amount"] != 50.0 || len(exp.Subtotals) != 2 || exp.Subtotals[0].Label != "fuel" {
		t.Fatalf("expenses %v %v", exp.Rows, exp.Subtotals)
	}
	mnt := run(t, e, "maintenance", dev, 0)
	if len(mnt.Rows) != 1 || mnt.Rows[0]["item"] != "Oil change" || mnt.Rows[0]["nextDue"] != "2026-10-01" {
		t.Fatalf("maintenance %v", mnt.Rows)
	}
	sys := run(t, e, "systemLog", dev, 0)
	if sys.Rows[0]["packets"] != 141 || sys.Rows[0]["gaps"] != 0 || sys.Rows[0]["avgInterval"] != 30.0 {
		t.Fatalf("systemLog %v", sys.Rows)
	}
	if _, err := e.Run(context.Background(), Request{Type: "nope"}); err != ErrUnknownType {
		t.Fatal(err)
	}

	// Dashboard over the seeded day.
	d, err := e.Dashboard(context.Background(), DashboardRequest{Devices: []store.Device{dev}, All: true, Days: 3,
		Now: base.Add(2 * time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if len(d.DistanceByDay) != 3 || !near(d.DistanceByDay[2].Distance, 30, 0.01) || d.AlertsByType["overspeed"] != 1 ||
		d.AlertsByType["commandResult"] != 0 || len(d.TopVehicles) != 1 || len(d.DriverScores) != 2 ||
		d.DriverScores[0].Name != "Truck 07" || d.Maintenance.Overdue != 1 || d.Expenses.Currency != "USD" ||
		d.Expenses.Total != 50 || d.Utilization <= 0 || d.Utilization > 1 {
		t.Fatalf("dashboard %+v", d)
	}
}
