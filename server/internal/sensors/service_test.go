package sensors

import (
	"context"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/events"
	"github.com/moamiindeveloper/fleet/server/internal/store"
	"github.com/moamiindeveloper/fleet/server/internal/store/storetest"
)

type capture struct{ evs []store.Event }

func (c *capture) Notify(e store.Event, _ string) { c.evs = append(c.evs, e) }

func TestServiceEvents(t *testing.T) {
	ctx := context.Background()
	pool := storetest.Pool(t, "sensors_svc_test")
	st, err := store.New(ctx, pool, store.Options{AutoRegister: true})
	if err != nil {
		t.Fatal(err)
	}
	dev, err := st.CreateDevice(ctx, store.DeviceInput{Name: "Reefer 1", IMEI: "356307042441013"})
	if err != nil {
		t.Fatal(err)
	}
	fuel, err := st.CreateSensor(ctx, store.SensorInput{DeviceID: dev.ID, Name: "Tank", Type: "fuel", Source: "io9",
		Calibration: [][2]float64{{4500, 120}, {0, 0}}, TankCapacity: ptr(120)})
	if err != nil {
		t.Fatal(err)
	}
	if fuel.Smoothing != 5 || *fuel.FuelDropThreshold != 8 || fuel.Unit != "L" || fuel.Calibration[0][0] != 0 {
		t.Fatalf("fuel defaults %+v", fuel)
	}
	temp, err := st.CreateSensor(ctx, store.SensorInput{DeviceID: dev.ID, Name: "Cargo", Type: "temperature",
		Source: "io72", Multiplier: ptr(0.1), Max: ptr(8)})
	if err != nil {
		t.Fatal(err)
	}
	for _, bad := range []store.SensorInput{
		{DeviceID: dev.ID, Name: "x", Type: "pressure", Source: "io1"},
		{DeviceID: dev.ID, Name: "x", Type: "fuel", Source: "io 1"},
		{DeviceID: dev.ID, Name: "x", Type: "fuel", Source: "io1", Calibration: [][2]float64{{1, 1}}},
		{DeviceID: dev.ID, Name: "x", Type: "fuel", Source: "io1", Calibration: [][2]float64{{1, 1}, {1, 2}}},
		{DeviceID: dev.ID, Name: "x", Type: "generic", Source: "io1", Min: ptr(5), Max: ptr(1)},
		{DeviceID: 999, Name: "x", Type: "generic", Source: "io1"},
	} {
		if _, err := st.CreateSensor(ctx, bad); err == nil {
			t.Errorf("accepted %+v", bad)
		}
	}

	svc, err := New(ctx, st, nil)
	if err != nil {
		t.Fatal(err)
	}
	cap := &capture{}
	eng := events.New(st, cap, nil)
	eng.AddRule(svc)
	st.SetHooks(store.Hooks{Positions: eng.Process})
	if ok, err := st.Authorize(ctx, dev.IMEI, "teltonika"); !ok || err != nil {
		t.Fatal(ok, err)
	}

	t0 := time.Now().Add(-time.Hour).Truncate(time.Second)
	i := 0
	send := func(mv float64, tempRaw int64, speed float64, ign bool) {
		p := domain.Position{IMEI: dev.IMEI, Protocol: "teltonika", DeviceTime: t0.Add(time.Duration(i) * 10 * time.Second),
			Latitude: 2.04, Longitude: 45.3, Speed: speed, Valid: true, Satellites: 9,
			Attributes: map[string]any{"io9": uint64(mv), "io72": tempRaw, "ignition": ign}}
		i++
		if err := st.Positions(ctx, []domain.Position{p}); err != nil {
			t.Fatal(err)
		}
	}
	mvOf := func(l float64) float64 { return l / 120 * 4500 }
	for range 10 {
		send(mvOf(60), 40, 0, false)
	}
	for k := range 10 { // refuel 60 → 100 L
		send(mvOf(60+float64(k+1)*4), 41, 0, false)
	}
	for range 10 {
		send(mvOf(100), 95, 0, false) // 9.5 °C: one sensorHigh
	}
	for range 5 {
		send(mvOf(100), 42, 0, false)
	}
	got := map[string]int{}
	for _, e := range cap.evs {
		got[e.Type]++
		if e.Type == store.EventRefuel {
			if l := e.Attributes["liters"].(float64); !near(l, 40, 1.5) || e.Attributes["sensorId"] != fuel.ID {
				t.Errorf("refuel attrs %v", e.Attributes)
			}
		}
		if e.Type == store.EventSensorHigh && (e.Attributes["limit"] != 8.0 || e.Attributes["sensorId"] != temp.ID) {
			t.Errorf("high attrs %v", e.Attributes)
		}
	}
	if got[store.EventRefuel] != 1 || got[store.EventSensorHigh] != 1 || got[store.EventFuelDrain] != 0 {
		t.Fatalf("events %v", got)
	}

	// Device JSON carries the latest values.
	d, _ := st.Device(dev.ID)
	if len(d.Sensors) != 2 {
		t.Fatalf("device sensors %+v", d.Sensors)
	}
	for _, v := range d.Sensors {
		if v.Value == nil || v.Time == nil {
			t.Fatalf("no value %+v", v)
		}
		if v.ID == fuel.ID && !near(*v.Value, 100, 0.1) {
			t.Errorf("fuel value %v", *v.Value)
		}
		if v.ID == temp.ID && *v.Value != 4.2 {
			t.Errorf("temp value %v", *v.Value)
		}
	}

	// Persisted state survives a restart: no repeated events, values kept.
	svc.Flush(ctx)
	st2, err := store.New(ctx, pool, store.Options{AutoRegister: true})
	if err != nil {
		t.Fatal(err)
	}
	d2, _ := st2.Device(dev.ID)
	if len(d2.Sensors) != 2 || d2.Sensors[0].Value == nil {
		t.Fatalf("after restart %+v", d2.Sensors)
	}
	svc2, err := New(ctx, st2, nil)
	if err != nil {
		t.Fatal(err)
	}
	sn := st2.DeviceSensors(dev.ID)
	for k := range sn {
		if sn[k].ID == temp.ID {
			s2 := svc2.stateFor(&sn[k])
			if s2.Last.IsZero() || len(s2.Median.Buf) == 0 {
				t.Fatalf("state not restored: %+v", s2)
			}
		}
	}

	// Deleting a sensor removes it from the device.
	if err := st.DeleteSensor(ctx, temp.ID); err != nil {
		t.Fatal(err)
	}
	if d, _ := st.Device(dev.ID); len(d.Sensors) != 1 {
		t.Fatalf("after delete %+v", d.Sensors)
	}
}
