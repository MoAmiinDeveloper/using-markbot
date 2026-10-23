package reports

import (
	"math"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

var base = time.Date(2026, 10, 20, 8, 0, 0, 0, time.UTC)

const stepDeg = 500 / 111194.9266 // ≈ 500 m of latitude

func near(a, b, tol float64) bool { return math.Abs(a-b) <= tol }

// scenario: 30 s fixes over 70 minutes.
//
//	00–10 stopped, ignition off
//	10–14 idle (ignition on)          -> idle period 4 min
//	14–34 driving 60 km/h, tag 00AB   -> 20 km
//	34–40 stopped with ignition on    -> stop (ignition on) + idle period 6 min
//	40–50 driving                     -> 10 km
//	50–70 ignition off, parked
func scenario() []store.ReportPoint {
	var pts []store.ReportPoint
	lat := 25.0
	prevMoving := false
	for sec := 0; sec <= 70*60; sec += 30 {
		m := float64(sec) / 60
		if prevMoving {
			lat += stepDeg
		}
		on := m >= 10 && m < 50
		moving := (m >= 14 && m < 34) || (m >= 40 && m < 50)
		p := store.ReportPoint{Time: base.Add(time.Duration(sec) * time.Second), Lat: lat, Lng: 55, Valid: true,
			Ignition: &on}
		if moving {
			p.Speed = 60
		}
		if m >= 14 && m < 34 {
			p.Driver = "00AB"
		}
		pts = append(pts, p)
		prevMoving = moving
	}
	return pts
}

func analyze(loc *time.Location, pts []store.ReportPoint) *Analysis {
	z := NewAnalyzer(loc)
	for i := range pts {
		z.Add(&pts[i])
	}
	return z.Finish()
}

func TestAnalyzerScenario(t *testing.T) {
	a := analyze(time.UTC, scenario())
	at := func(min float64) time.Time { return base.Add(time.Duration(min * float64(time.Minute))) }

	if a.Points != 141 {
		t.Fatalf("points %d", a.Points)
	}
	// Times by state.
	if a.Driving != 1800 || a.Idle != 600 || a.Stopped != 1800 || a.Engine != 2400 {
		t.Fatalf("driving %v idle %v stopped %v engine %v", a.Driving, a.Idle, a.Stopped, a.Engine)
	}
	if a.MaxSpeed != 60 {
		t.Fatalf("max speed %v", a.MaxSpeed)
	}
	// Trips: the first starts when the ignition turns on (existing detector rule).
	if len(a.Trips) != 2 {
		t.Fatalf("trips %+v", a.Trips)
	}
	t1, t2 := a.Trips[0], a.Trips[1]
	if !t1.Start.Equal(at(10)) || !t1.End.Equal(at(34)) || !near(t1.Distance, 20000, 5) || t1.DriverTag != "00AB" {
		t.Fatalf("trip1 %+v", t1)
	}
	if !t2.Start.Equal(at(40)) || !t2.End.Equal(at(50)) || !near(t2.Distance, 10000, 5) || t2.DriverTag != "" {
		t.Fatalf("trip2 %+v", t2)
	}
	if !near(a.Distance, 30000, 10) {
		t.Fatalf("distance %v", a.Distance)
	}
	// Stops ≥ 5 min with their ignition.
	if len(a.Stops) != 3 {
		t.Fatalf("stops %+v", a.Stops)
	}
	want := []struct {
		s, e    float64
		idle    float64
		ongoing bool
	}{{0, 10, 0, false}, {34, 40, 360, false}, {50, 70, 0, true}}
	for i, w := range want {
		s := a.Stops[i]
		if !s.Start.Equal(at(w.s)) || !s.End.Equal(at(w.e)) || s.Idle != w.idle || s.Ongoing != w.ongoing {
			t.Errorf("stop %d: %+v, want %+v", i, s, w)
		}
	}
	// Idle periods ≥ 3 min.
	if len(a.Idles) != 2 || !a.Idles[0].Start.Equal(at(10)) || !a.Idles[0].End.Equal(at(14)) ||
		!a.Idles[1].Start.Equal(at(34)) || !a.Idles[1].End.Equal(at(40)) {
		t.Fatalf("idles %+v", a.Idles)
	}
	// One ignition span 10 -> 50 with the driven distance.
	if len(a.Ignitions) != 1 || !a.Ignitions[0].Start.Equal(at(10)) || !a.Ignitions[0].End.Equal(at(50)) ||
		a.Ignitions[0].Open || !near(a.Ignitions[0].Distance, 30000, 10) {
		t.Fatalf("ignitions %+v", a.Ignitions)
	}
	// Drivers.
	d := a.Drivers["00AB"]
	if d == nil || !near(d.Distance, 20000, 5) || d.Driving != 1200 || d.Trips != 1 {
		t.Fatalf("driver 00AB %+v", d)
	}
	if nd := a.Drivers[""]; nd == nil || !near(nd.Distance, 10000, 5) || nd.Driving != 600 || nd.Idle != 600 {
		t.Fatalf("no driver %+v", nd)
	}
	// Single day.
	if len(a.Days) != 1 || !near(a.Days[0].Distance, 30000, 10) || a.Days[0].Driving != 1800 ||
		!a.Days[0].FirstStart.Equal(at(10)) || !a.Days[0].LastStop.Equal(at(50)) {
		t.Fatalf("days %+v", a.Days[0])
	}
}

func TestAnalyzerDaysSplitByTimeZone(t *testing.T) {
	// In UTC+3 the day ends at 21:00 UTC: put the scenario across it.
	loc := time.FixedZone("UTC+3", 3*3600)
	pts := scenario()
	shift := time.Date(2026, 10, 20, 20, 30, 0, 0, time.UTC).Sub(base) // trip1 runs 20:40–21:04 UTC
	for i := range pts {
		pts[i].Time = pts[i].Time.Add(shift)
	}
	a := analyze(loc, pts)
	if len(a.Days) != 2 {
		t.Fatalf("days %d", len(a.Days))
	}
	d1, d2 := a.Days[0], a.Days[1]
	if d1.Date.Format(time.DateOnly) != "2026-10-20" || d2.Date.Format(time.DateOnly) != "2026-10-21" {
		t.Fatalf("dates %v %v", d1.Date, d2.Date)
	}
	// Trip 1 (24 min, 20 km) spends 20 of 24 minutes on day 1.
	if !near(d1.Distance, 20000*20.0/24, 10) || !near(d1.Distance+d2.Distance, a.Distance, 0.001) {
		t.Fatalf("split %v + %v of %v", d1.Distance, d2.Distance, a.Distance)
	}
	if d1.FirstStart == nil || d1.LastStop != nil || d2.FirstStart == nil || d2.LastStop == nil {
		t.Fatalf("first/last %+v %+v", d1, d2)
	}
	if d1.Driving+d2.Driving != a.Driving {
		t.Fatalf("driving split")
	}
}

func TestAnalyzerGapsAndInvalid(t *testing.T) {
	on := true
	pts := []store.ReportPoint{
		{Time: base, Lat: 25, Lng: 55, Speed: 50, Valid: true},
		// 20 min gap after a moving fix: counted as stopped, not driving.
		{Time: base.Add(20 * time.Minute), Lat: 25.01, Lng: 55, Speed: 50, Valid: true},
		{Time: base.Add(21 * time.Minute), Lat: 0, Lng: 0, Speed: 0, Valid: false, Ignition: &on},
		{Time: base.Add(30 * time.Minute), Lat: 25.01, Lng: 55, Speed: 0, Valid: true, Ignition: &on},
	}
	a := analyze(nil, pts)
	if a.Driving != 60 || a.Stopped != 1200 || a.Idle != 540 {
		t.Fatalf("driving %v stopped %v idle %v", a.Driving, a.Stopped, a.Idle)
	}
	if len(a.Ignitions) != 1 || !a.Ignitions[0].Open || a.Ignitions[0].Distance != 0 {
		t.Fatalf("ignitions %+v", a.Ignitions)
	}
}

func TestSystemLog(t *testing.T) {
	var l SystemLog
	for _, m := range []int{0, 1, 2, 40, 41, 120} {
		l.Add(base.Add(time.Duration(m) * time.Minute))
	}
	if l.Packets != 6 || l.Gaps != 2 || l.LongestGap != 79*60 || !l.First.Equal(base) ||
		!l.Last.Equal(base.Add(2*time.Hour)) || l.AvgInterval() != 24*60 {
		t.Fatalf("%+v avg %v", l, l.AvgInterval())
	}
	var empty SystemLog
	if empty.AvgInterval() != 0 {
		t.Fatal("empty avg")
	}
}

func TestScore(t *testing.T) {
	cases := []struct {
		km          float64
		over, harsh int
		idleH       float64
		want        float64
	}{
		{200, 0, 0, 0, 100},
		{200, 2, 2, 1, 100 - (10+6+2)/2.0},
		{100, 30, 0, 0, 0}, // clamped
		{1, 1, 0, 0, 50},   // short distance counts as 10 km
		{0, 0, 0, 0, 100},
	}
	for _, c := range cases {
		if got := Score(c.km, c.over, c.harsh, c.idleH); !near(got, c.want, 1e-9) {
			t.Errorf("Score(%v,%v,%v,%v) = %v, want %v", c.km, c.over, c.harsh, c.idleH, got, c.want)
		}
	}
}
