package store

import (
	"math"
	"testing"
	"time"
)

var t0 = time.Date(2026, 10, 22, 8, 0, 0, 0, time.UTC)

// track builds points every step, starting at t0+offset, moving north at
// speed km/h (stationary when speed is 0) from lat.
type track struct {
	pts []TripPoint
	t   time.Time
	lat float64
}

func newTrack() *track { return &track{t: t0, lat: 25} }

func (tr *track) add(n int, step time.Duration, speed float64, ign *bool) *track {
	for i := 0; i < n; i++ {
		tr.pts = append(tr.pts, TripPoint{Time: tr.t, Lat: tr.lat, Lng: 55, Speed: speed, Ignition: ign})
		tr.t = tr.t.Add(step)
		tr.lat += speed / 3.6 * step.Seconds() / 111195 // degrees of latitude travelled
	}
	return tr
}

func (tr *track) trips() []Trip {
	var d TripDetector
	for _, p := range tr.pts {
		d.Add(p)
	}
	return d.Trips()
}

func ptr(b bool) *bool { return &b }

func TestHaversine(t *testing.T) {
	got := haversine(0, 0, 1, 0)
	if math.Abs(got-111195) > 1 {
		t.Fatalf("1 degree of latitude = %.1f m, want ~111195", got)
	}
	if haversine(25, 55, 25, 55) != 0 {
		t.Fatal("same point should be 0")
	}
}

func TestSingleTrip(t *testing.T) {
	tr := newTrack().
		add(10, 30*time.Second, 0, nil).  // parked 5 min
		add(20, 30*time.Second, 60, nil). // drive 10 min at 60 km/h
		add(20, 30*time.Second, 0, nil)   // parked 10 min
	trips := tr.trips()
	if len(trips) != 1 {
		t.Fatalf("got %d trips, want 1: %+v", len(trips), trips)
	}
	trip := trips[0]
	if want := t0.Add(5 * time.Minute); !trip.Start.Equal(want) {
		t.Errorf("start = %v, want %v", trip.Start, want)
	}
	// Ends at the first stationary point, i.e. right after 10 minutes of driving.
	if want := t0.Add(15 * time.Minute); !trip.End.Equal(want) {
		t.Errorf("end = %v, want %v", trip.End, want)
	}
	if trip.Duration != 600 {
		t.Errorf("duration = %v, want 600", trip.Duration)
	}
	if math.Abs(trip.Distance-10000) > 5 { // 60 km/h for 10 min
		t.Errorf("distance = %.1f, want ~10000", trip.Distance)
	}
	if trip.MaxSpeed != 60 || math.Abs(trip.AvgSpeed-60) > 0.1 {
		t.Errorf("max/avg = %v/%v, want 60/60", trip.MaxSpeed, trip.AvgSpeed)
	}
	if trip.StartLat != 25 || trip.EndLat <= trip.StartLat {
		t.Errorf("unexpected coordinates %+v", trip)
	}
}

func TestShortStopDoesNotSplit(t *testing.T) {
	tr := newTrack().
		add(10, 30*time.Second, 50, nil).
		add(8, 30*time.Second, 0, nil). // 4 minute traffic light
		add(10, 30*time.Second, 50, nil).
		add(12, 30*time.Second, 0, nil)
	if n := len(tr.trips()); n != 1 {
		t.Fatalf("got %d trips, want 1", n)
	}
}

func TestLongStopSplits(t *testing.T) {
	tr := newTrack().
		add(10, 30*time.Second, 50, nil).
		add(12, 30*time.Second, 0, nil). // 6 minutes
		add(10, 30*time.Second, 50, nil).
		add(12, 30*time.Second, 0, nil)
	trips := tr.trips()
	if len(trips) != 2 {
		t.Fatalf("got %d trips, want 2", len(trips))
	}
	if !trips[1].Start.After(trips[0].End) {
		t.Fatal("trips overlap")
	}
}

func TestIgnitionStartsTrip(t *testing.T) {
	tr := newTrack().
		add(4, 30*time.Second, 0, ptr(false)).
		add(4, 30*time.Second, 0, ptr(true)). // ignition on, warming up 2 min
		add(10, 30*time.Second, 40, ptr(true)).
		add(12, 30*time.Second, 0, ptr(false))
	trips := tr.trips()
	if len(trips) != 1 {
		t.Fatalf("got %d trips, want 1", len(trips))
	}
	if want := t0.Add(2 * time.Minute); !trips[0].Start.Equal(want) {
		t.Errorf("start = %v, want ignition-on time %v", trips[0].Start, want)
	}
}

func TestIgnitionWithoutMovementIsNoTrip(t *testing.T) {
	tr := newTrack().
		add(2, 30*time.Second, 0, ptr(false)).
		add(20, 30*time.Second, 0, ptr(true)).
		add(2, 30*time.Second, 0, ptr(false))
	if trips := tr.trips(); len(trips) != 0 {
		t.Fatalf("got %+v, want none", trips)
	}
}

func TestTripInProgressEndsAtLastPoint(t *testing.T) {
	tr := newTrack().add(10, 30*time.Second, 70, nil)
	trips := tr.trips()
	if len(trips) != 1 {
		t.Fatalf("got %d trips, want 1", len(trips))
	}
	if want := tr.pts[len(tr.pts)-1].Time; !trips[0].End.Equal(want) {
		t.Errorf("end = %v, want %v", trips[0].End, want)
	}
}

func TestNoPoints(t *testing.T) {
	var d TripDetector
	if trips := d.Trips(); trips == nil || len(trips) != 0 {
		t.Fatalf("want empty non-nil slice, got %#v", trips)
	}
}
