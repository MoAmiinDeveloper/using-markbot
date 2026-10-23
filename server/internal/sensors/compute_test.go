package sensors

import (
	"encoding/json"
	"math"
	"math/rand/v2"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

func ptr(v float64) *float64 { return &v }

func near(a, b, eps float64) bool { return math.Abs(a-b) <= eps }

func TestCalibrate(t *testing.T) {
	s := &store.Sensor{Calibration: [][2]float64{{0, 0}, {1000, 10}, {3000, 60}, {4500, 120}}, Multiplier: 1}
	cases := []struct{ raw, want float64 }{
		{-50, 0}, {0, 0}, {500, 5}, {1000, 10}, {2000, 35}, {3000, 60}, {3750, 90}, {4500, 120}, {9999, 120},
	}
	for _, c := range cases {
		if got := Calibrate(s, c.raw); !near(got, c.want, 1e-9) {
			t.Errorf("Calibrate(%v) = %v, want %v", c.raw, got, c.want)
		}
	}
	// Decreasing tables (e.g. resistive probes) interpolate too.
	dec := &store.Sensor{Calibration: [][2]float64{{10, 100}, {190, 0}}}
	if got := Calibrate(dec, 100); !near(got, 50, 1e-9) {
		t.Errorf("decreasing table: %v", got)
	}
	lin := &store.Sensor{Multiplier: 0.1, Offset: -2}
	if got := Calibrate(lin, 255); !near(got, 23.5, 1e-9) {
		t.Errorf("multiplier/offset: %v", got)
	}
}

func TestRaw(t *testing.T) {
	attrs := map[string]any{"a": uint64(4200), "b": int64(-12), "c": 3.5, "d": true, "e": "7.25",
		"f": json.Number("8"), "g": "x", "h": []int{1}}
	want := map[string]float64{"a": 4200, "b": -12, "c": 3.5, "d": 1, "e": 7.25, "f": 8}
	for k, w := range want {
		if v, ok := Raw(attrs, k); !ok || v != w {
			t.Errorf("Raw(%s) = %v %v", k, v, ok)
		}
	}
	for _, k := range []string{"g", "h", "missing"} {
		if _, ok := Raw(attrs, k); ok {
			t.Errorf("Raw(%s) should fail", k)
		}
	}
}

func TestMedian(t *testing.T) {
	m := Median{N: 5}
	got := []float64{}
	for _, v := range []float64{10, 10, 50, 10, 10, 11, 12, -40, 13, 14} {
		got = append(got, m.Add(v))
	}
	want := []float64{10, 10, 10, 10, 10, 10, 11, 10, 11, 12}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("median series %v, want %v", got, want)
		}
	}
	one := Median{N: 1}
	if one.Add(3) != 3 || one.Add(9) != 9 {
		t.Fatal("N=1 must pass values through")
	}
}

func TestThresholdsNoisy(t *testing.T) {
	s := &store.Sensor{Decimals: 1, Min: ptr(2), Max: ptr(8)}
	rng := rand.New(rand.NewPCG(1, 2))
	var th Thresholds
	med := Median{N: 3}
	highs, lows := 0, 0
	// 4 °C, one excursion to ~10 °C hovering around the limit with noise,
	// back, then one cold excursion; noise ±0.3 must not cause repeats.
	profile := func(i int) float64 {
		switch {
		case i < 100:
			return 4
		case i < 120:
			return 4 + float64(i-100)*0.25 // ramp to 9
		case i < 200:
			return 8.3 // hovering just above the limit
		case i < 300:
			return 4
		case i < 380:
			return 1.5
		}
		return 4
	}
	for i := range 450 {
		v := med.Add(profile(i) + rng.NormFloat64()*0.15)
		switch kind, _ := th.Update(s, v); kind {
		case High:
			highs++
		case Low:
			lows++
		}
	}
	if highs != 1 || lows != 1 {
		t.Fatalf("highs=%d lows=%d, want 1 each", highs, lows)
	}
}

// fuelRun feeds a synthetic trace through median smoothing and the detector.
type fuelStep struct {
	n       int     // fixes
	delta   float64 // liters per fix (true level)
	speed   float64
	ignOn   bool
	noise   float64 // σ, liters
	spikeEv int     // every n fixes a slosh spike (0 = none)
}

func runFuel(t *testing.T, s *store.Sensor, start float64, steps []fuelStep) []FuelChange {
	t.Helper()
	rng := rand.New(rand.NewPCG(7, 9))
	var (
		det   FuelDetector
		med   = Median{N: s.Smoothing}
		level = start
		at    = time.Date(2026, 10, 1, 8, 0, 0, 0, time.UTC)
		out   []FuelChange
	)
	for _, st := range steps {
		for i := range st.n {
			level += st.delta
			v := level + rng.NormFloat64()*st.noise
			if st.spikeEv > 0 && i%st.spikeEv == st.spikeEv-1 {
				v += 15
			}
			ign := st.ignOn
			if ch := det.Add(s, at, med.Add(v), Stopped(st.speed, &ign), 0, 0); ch != nil {
				out = append(out, *ch)
			}
			at = at.Add(10 * time.Second)
		}
	}
	return out
}

func fuelSensor() *store.Sensor {
	return &store.Sensor{Type: store.SensorFuel, Smoothing: 5, TankCapacity: ptr(120),
		FuelDropThreshold: ptr(8), FuelFillThreshold: ptr(10)}
}

func TestFuelRefuelAndDrain(t *testing.T) {
	s := fuelSensor()
	changes := runFuel(t, s, 80, []fuelStep{
		{n: 200, delta: -0.03, speed: 60, ignOn: true, noise: 1.5, spikeEv: 37}, // driving: -6 L, slosh
		{n: 30, speed: 0, noise: 0.3},                                           // parked
		{n: 20, delta: 2, speed: 0, noise: 0.3},                                 // refuel +40 L
		{n: 30, speed: 0, noise: 0.3},
		{n: 100, delta: -0.03, speed: 50, ignOn: true, noise: 1.5, spikeEv: 23}, // drive -3 L
		{n: 40, speed: 0, noise: 0.3},                                           // parked, ignition off
		{n: 15, delta: -1.2, speed: 0, noise: 0.3},                              // drain 18 L
		{n: 40, speed: 0, noise: 0.3},
		{n: 50, delta: -0.03, speed: 50, ignOn: true, noise: 1.5},
	})
	if len(changes) != 2 {
		t.Fatalf("changes = %+v, want refuel + drain", changes)
	}
	r, d := changes[0], changes[1]
	if r.Kind != Refuel || !near(r.Liters, 40, 2) || !near(r.Before, 74, 2) || !near(r.After, 114, 2) {
		t.Errorf("refuel = %+v", r)
	}
	if d.Kind != Drain || !near(d.Liters, 18, 2) {
		t.Errorf("drain = %+v", d)
	}
}

func TestFuelNoFalseDrains(t *testing.T) {
	s := fuelSensor()
	// Hard driving with heavy slosh, then a long idle with the engine on
	// (2 L/h for 4 h = 8 L, slowly) and a drop while driving: no events.
	changes := runFuel(t, s, 100, []fuelStep{
		{n: 500, delta: -0.04, speed: 80, ignOn: true, noise: 3, spikeEv: 11},
		{n: 1440, delta: -8.0 / 1440, speed: 0, ignOn: true, noise: 0.4},
		{n: 10, delta: -2, speed: 70, ignOn: true, noise: 0.5}, // fast drop while moving
		{n: 100, delta: -0.03, speed: 60, ignOn: true, noise: 1.5},
	})
	if len(changes) != 0 {
		t.Fatalf("unexpected changes %+v", changes)
	}
	// A small top-up below the threshold is ignored too.
	if changes := runFuel(t, s, 50, []fuelStep{{n: 30, noise: 0.3}, {n: 6, delta: 1}, {n: 30, noise: 0.3}}); len(changes) != 0 {
		t.Fatalf("small top-up: %+v", changes)
	}
}

func TestFuelSparseParkedDrain(t *testing.T) {
	// Parked with ignition off reporting every hour: a drop between two
	// sparse fixes is still a drain (recent samples are kept).
	s := fuelSensor()
	s.Smoothing = 1
	var det FuelDetector
	at := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	off := false
	var got []*FuelChange
	for i, v := range []float64{90, 90.2, 89.9, 70, 70.1, 69.9, 70, 70} {
		got = append(got, det.Add(s, at.Add(time.Duration(i)*time.Hour), v, Stopped(0, &off), 0, 0))
	}
	n := 0
	for _, c := range got {
		if c != nil {
			n++
			if c.Kind != Drain || !near(c.Liters, 20.2, 0.5) {
				t.Errorf("drain = %+v", c)
			}
		}
	}
	if n != 1 {
		t.Fatalf("%d changes", n)
	}
}

func TestHysteresis(t *testing.T) {
	s := &store.Sensor{Decimals: 1}
	if h := Hysteresis(s, 8); !near(h, 0.5, 1e-9) {
		t.Errorf("h(8) = %v", h)
	}
	if h := Hysteresis(s, 100); !near(h, 2, 1e-9) {
		t.Errorf("h(100) = %v", h)
	}
}

func TestFuelGapAfterDriving(t *testing.T) {
	// The tracker was off for hours after driving (e.g. server/device
	// restart): a lower level on the next, stopped fix is not a drain.
	s := fuelSensor()
	s.Smoothing = 1
	var det FuelDetector
	at := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	on := true
	for i := range 5 {
		if c := det.Add(s, at.Add(time.Duration(i)*10*time.Second), 110-float64(i)*0.1, Stopped(60, &on), 0, 0); c != nil {
			t.Fatal(c)
		}
	}
	off := false
	for i := range 10 {
		if c := det.Add(s, at.Add(4*time.Hour+time.Duration(i)*10*time.Second), 100, Stopped(0, &off), 0, 0); c != nil {
			t.Fatalf("false drain %+v", c)
		}
	}
}
