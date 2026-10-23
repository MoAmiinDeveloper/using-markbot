package reports

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/store"
	"github.com/moamiindeveloper/fleet/server/internal/store/storetest"
)

func fptr(v float64) *float64 { return &v }

func TestTempStats(t *testing.T) {
	s := &store.Sensor{Decimals: 1, Min: fptr(2), Max: fptr(8)}
	t0 := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	var ts TempStats
	// 4 °C, 9 °C for 10 min (readings every 5 min), 4 °C, 1 °C for 5 min,
	// then a 2 h gap while at 9 °C (capped at 30 min).
	vals := []float64{4, 9, 9, 4, 1, 4, 9}
	for i, v := range vals {
		ts.Add(s, t0.Add(time.Duration(i)*5*time.Minute), v)
	}
	ts.Finish(t0.Add(30*time.Minute + 2*time.Hour))
	if ts.Readings != 7 || ts.Min != 1 || ts.Max != 9 || ts.Excursions != 3 {
		t.Fatalf("%+v", ts)
	}
	if ts.OutOfRange != 10*time.Minute+5*time.Minute+30*time.Minute {
		t.Fatalf("out of range %v", ts.OutOfRange)
	}
}

func TestFuelAndTemperatureReports(t *testing.T) {
	ctx := context.Background()
	t0 := time.Date(2026, 10, 1, 6, 0, 0, 0, time.UTC)
	st := storetest.New(t, "reports_sensor_test", store.Options{AutoRegister: true, Now: func() time.Time { return t0.Add(24 * time.Hour) }})
	dev, err := st.CreateDevice(ctx, store.DeviceInput{Name: "Truck 07", IMEI: "356307042441013"})
	if err != nil {
		t.Fatal(err)
	}
	fuel, err := st.CreateSensor(ctx, store.SensorInput{DeviceID: dev.ID, Name: "Tank", Type: "fuel", Source: "io9",
		Calibration: [][2]float64{{0, 0}, {4500, 120}}, Smoothing: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateSensor(ctx, store.SensorInput{DeviceID: dev.ID, Name: "Cargo", Type: "temperature",
		Source: "io72", Multiplier: fptr(0.1), Min: fptr(0), Max: fptr(8), Smoothing: 1}); err != nil {
		t.Fatal(err)
	}
	if ok, err := st.Authorize(ctx, dev.IMEI, "teltonika"); !ok || err != nil {
		t.Fatal(ok, err)
	}
	mv := func(l float64) uint64 { return uint64(l / 120 * 4500) }
	var ps []domain.Position
	at := t0
	lat := 2.0
	add := func(liters float64, speed float64, temp int64, ign bool) {
		if speed > 0 {
			lat += speed / 3.6 * 60 / 111_320 // north, 1-min fixes
		}
		ps = append(ps, domain.Position{IMEI: dev.IMEI, DeviceTime: at, Latitude: lat, Longitude: 45, Speed: speed,
			Valid: true, Satellites: 9, Attributes: map[string]any{"io9": mv(liters), "io72": temp, "ignition": ign}})
		at = at.Add(time.Minute)
	}
	level := 80.0
	for range 60 { // drive 60 km at 60 km/h, 0.2 L/km → 12 L
		add(level, 60, 40, true)
		level -= 0.2
	}
	for range 10 { // parked, cargo warms to 10 °C for 10 min
		add(level, 0, 100, false)
	}
	for k := range 8 { // refuel +40 L
		add(level+float64(k+1)*5, 0, 40, false)
	}
	level += 40
	for range 10 {
		add(level, 0, 40, false)
	}
	for k := range 5 { // drain 20 L while parked
		add(level-float64(k+1)*4, 0, 40, false)
	}
	level -= 20
	for range 10 {
		add(level, 0, 40, false)
	}
	if err := st.Positions(ctx, ps); err != nil {
		t.Fatal(err)
	}
	e := New(st, nil, nil)
	devs := []store.Device{dev}
	req := Request{Devices: devs, From: t0, To: at, Now: at}

	req.Type = "fuel"
	rep, err := e.Run(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	if len(rep.Rows) != 1 {
		t.Fatalf("rows %v", rep.Rows)
	}
	r := rep.Rows[0]
	if r["sensorId"] != fuel.ID || r["refuels"] != 1 || r["drains"] != 1 {
		t.Fatalf("fuel row %v", r)
	}
	approx := func(k string, want, eps float64) {
		t.Helper()
		if v, ok := r[k].(float64); !ok || v < want-eps || v > want+eps {
			t.Errorf("%s = %v, want %v", k, r[k], want)
		}
	}
	approx("startLevel", 80, 0.1)
	approx("endLevel", 88, 0.2)
	approx("refuelLiters", 40, 0.5)
	approx("drainLiters", 20, 0.5)
	approx("consumed", 12, 0.6)  // 80 − 88 + 40 − 20
	approx("distance", 59, 0.5)  // 59 one-minute segments
	approx("consumption", 20, 1) // L/100 km

	req.Type = "temperature"
	rep, err = e.Run(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	r = rep.Rows[0]
	if r["min"] != 4.0 || r["max"] != 10.0 || r["excursions"] != 1 || r["minutesOutOfRange"] != 10.0 ||
		r["highLimit"] != 8.0 || r["lowLimit"] != 0.0 {
		t.Fatalf("temperature row %v", r)
	}
	for _, f := range []func() error{
		func() error { return WriteCSV(&bytes.Buffer{}, rep, time.UTC) },
		func() error { return WriteXLSX(&bytes.Buffer{}, rep, time.UTC, at) },
		func() error { return WritePDF(&bytes.Buffer{}, rep, time.UTC, at) },
	} {
		if err := f(); err != nil {
			t.Fatal(err)
		}
	}
	if Title("fuel") != "Fuel" || Title("temperature") != "Temperature" {
		t.Fatal("catalogue")
	}
}
