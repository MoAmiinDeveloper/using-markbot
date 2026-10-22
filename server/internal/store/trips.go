package store

import (
	"math"
	"time"
)

// Trip is one journey derived from a device's positions.
type Trip struct {
	Start    time.Time `json:"start"`
	End      time.Time `json:"end"`
	StartLat float64   `json:"startLat"`
	StartLng float64   `json:"startLng"`
	EndLat   float64   `json:"endLat"`
	EndLng   float64   `json:"endLng"`
	Distance float64   `json:"distance"` // meters
	Duration float64   `json:"duration"` // seconds
	MaxSpeed float64   `json:"maxSpeed"` // km/h
	AvgSpeed float64   `json:"avgSpeed"` // km/h
}

// TripStopDuration is how long a vehicle must stay stationary to end a trip.
const TripStopDuration = 5 * time.Minute

// TripPoint is the subset of a position needed for trip detection.
type TripPoint struct {
	Time     time.Time
	Lat, Lng float64
	Speed    float64 // km/h
	Ignition *bool   // nil when unknown
}

// TripDetector turns a chronological stream of points into trips in O(1)
// memory per device. A trip starts when speed exceeds MovingSpeed or the
// ignition turns on, and ends at the start of a stationary period lasting at
// least TripStopDuration. Ignition-only periods without movement are discarded.
type TripDetector struct {
	trips []Trip

	prevIgn *bool

	in       bool
	cur      Trip
	last     TripPoint // last point added to the current trip
	moved    bool      // current trip contains a moving point
	stopped  bool      // in a stationary run
	stop     TripPoint // first point of the stationary run
	stopDist float64   // trip distance when the stationary run began
}

// Add feeds the next point; points must be in ascending time order.
func (d *TripDetector) Add(p TripPoint) {
	moving := p.Speed > MovingSpeed
	ignOn := p.Ignition != nil && *p.Ignition && d.prevIgn != nil && !*d.prevIgn
	if p.Ignition != nil {
		d.prevIgn = p.Ignition
	}

	if !d.in {
		if !moving && !ignOn {
			return
		}
		d.in, d.moved, d.stopped = true, false, false
		d.cur = Trip{Start: p.Time, StartLat: p.Lat, StartLng: p.Lng}
		d.last = p
	} else {
		d.cur.Distance += Haversine(d.last.Lat, d.last.Lng, p.Lat, p.Lng)
		d.last = p
	}
	d.cur.MaxSpeed = max(d.cur.MaxSpeed, p.Speed)

	if moving {
		d.moved, d.stopped = true, false
		return
	}
	if !d.stopped {
		d.stopped, d.stop, d.stopDist = true, p, d.cur.Distance
	}
	if p.Time.Sub(d.stop.Time) >= TripStopDuration {
		d.finish(d.stop, d.stopDist)
	}
}

// Trips ends any trip in progress and returns all detected trips.
func (d *TripDetector) Trips() []Trip {
	if d.in {
		if d.stopped {
			d.finish(d.stop, d.stopDist)
		} else {
			d.finish(d.last, d.cur.Distance)
		}
	}
	if d.trips == nil {
		return []Trip{}
	}
	return d.trips
}

func (d *TripDetector) finish(end TripPoint, dist float64) {
	d.in = false
	if !d.moved {
		return
	}
	t := d.cur
	t.End, t.EndLat, t.EndLng, t.Distance = end.Time, end.Lat, end.Lng, dist
	t.Duration = t.End.Sub(t.Start).Seconds()
	if t.Duration > 0 {
		t.AvgSpeed = t.Distance / t.Duration * 3.6
	}
	d.trips = append(d.trips, t)
}

const earthRadius = 6371008.8 // meters, mean radius

// Haversine returns the great-circle distance in meters.
func Haversine(lat1, lng1, lat2, lng2 float64) float64 {
	const rad = math.Pi / 180
	dLat := (lat2 - lat1) * rad
	dLng := (lng2 - lng1) * rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadius * math.Asin(math.Min(1, math.Sqrt(a)))
}
