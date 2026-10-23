package dispatch

import (
	"math"
	"testing"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

func TestDistanceToPath(t *testing.T) {
	path := [][2]float64{{45.0, 2.0}, {45.01, 2.0}} // ~1.1 km east-west at lat 2
	// 0.001° north of the line ≈ 111 m.
	if d := DistanceToPath([2]float64{45.005, 2.001}, path); math.Abs(d-111.2) > 1 {
		t.Fatalf("perpendicular distance %.1f", d)
	}
	// Beyond the end: distance to the end point.
	if d := DistanceToPath([2]float64{45.011, 2.0}, path); math.Abs(d-111.2) > 1.5 {
		t.Fatalf("end distance %.1f", d)
	}
	if d := DistanceToPath([2]float64{45.003, 2.0}, path); d > 0.01 {
		t.Fatalf("on-line distance %.3f", d)
	}
}

func TestSimplify(t *testing.T) {
	// A straight line sampled every ~11 m with ±5 m jitter, then a corner.
	var path [][2]float64
	for i := 0; i <= 100; i++ {
		jitter := 0.00004 * float64(i%3-1) // ±4.4 m
		path = append(path, [2]float64{45 + 0.0001*float64(i), 2 + jitter})
	}
	for i := 1; i <= 50; i++ {
		path = append(path, [2]float64{45.01, 2 + 0.0001*float64(i)})
	}
	out := Simplify(path, 20)
	if len(out) != 3 {
		t.Fatalf("simplified to %d points: %v", len(out), out)
	}
	if out[0] != path[0] || out[len(out)-1] != path[len(path)-1] {
		t.Fatal("end points not kept")
	}
	if out[1] != [2]float64{45.01, 2 + 0.00004*float64(100%3-1)} {
		t.Fatalf("corner %v", out[1])
	}
	// Every original point stays within the tolerance.
	for _, p := range path {
		if d := DistanceToPath(p, out); d > 20 {
			t.Fatalf("point %v is %.1f m off", p, d)
		}
	}
	if got := Simplify(path[:2], 20); len(got) != 2 {
		t.Fatalf("two points: %v", got)
	}
}

func TestTransitionTable(t *testing.T) {
	type tc struct {
		from, to string
		driver   bool
		ok       bool
	}
	cases := []tc{
		{store.JobAssigned, store.JobAccepted, true, true},
		{store.JobAccepted, store.JobEnRoute, true, true},
		{store.JobEnRoute, store.JobArrived, true, true},
		{store.JobArrived, store.JobInProgress, true, true},
		{store.JobInProgress, store.JobCompleted, true, true},
		{store.JobInProgress, store.JobFailed, true, true},
		{store.JobAssigned, store.JobCompleted, true, false},
		{store.JobAssigned, store.JobCancelled, true, false},
		{store.JobAssigned, store.JobCancelled, false, true},
		{store.JobUnassigned, store.JobAccepted, true, false},
		{store.JobUnassigned, store.JobAssigned, false, true},
		{store.JobCompleted, store.JobAssigned, false, false},
		{store.JobCompleted, store.JobInProgress, true, false},
		{store.JobFailed, store.JobAssigned, false, true},
		{store.JobFailed, store.JobAssigned, true, false},
		{store.JobCancelled, store.JobUnassigned, false, true},
		{store.JobEnRoute, store.JobCompleted, false, true},
		{store.JobEnRoute, store.JobCompleted, true, false},
	}
	for _, c := range cases {
		if got := store.JobTransitionAllowed(c.from, c.to, c.driver); got != c.ok {
			t.Errorf("%s -> %s (driver %v): %v, want %v", c.from, c.to, c.driver, got, c.ok)
		}
	}
}
