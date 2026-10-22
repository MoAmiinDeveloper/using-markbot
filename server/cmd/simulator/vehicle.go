package main

import (
	"math"
	"math/rand/v2"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/protocol/teltonika"
)

const (
	earthRadius = 6_371_000.0 // m
	areaRadius  = 15_000.0    // waypoints stay within this distance of the center, m
	legRadius   = 4_000.0     // max distance between consecutive waypoints, m
	accel       = 2.0         // m/s²
	decel       = 3.0         // m/s²
)

type driveState int

const (
	driving driveState = iota
	idling             // engine on, standing (traffic, loading)
	parked             // engine off
)

// vehicle is a simple kinematic model of a car roaming around a center.
type vehicle struct {
	rng                  *rand.Rand
	centerLat, centerLng float64

	lat, lng   float64
	heading    float64 // degrees
	speed      float64 // m/s
	cruise     float64 // m/s target for the current leg
	wpLat      float64
	wpLng      float64
	state      driveState
	stateUntil time.Time

	ignition, motion bool
	odometer, trip   float64 // m
	altitude         float64
}

func newVehicle(rng *rand.Rand, lat, lng float64, now time.Time) *vehicle {
	v := &vehicle{rng: rng, centerLat: lat, centerLng: lng, altitude: 5 + rng.Float64()*20}
	v.lat, v.lng = offset(lat, lng, rng.Float64()*2*math.Pi, math.Sqrt(rng.Float64())*areaRadius)
	v.odometer = 5_000_000 + rng.Float64()*150_000_000
	// Start a third of the fleet parked.
	if rng.IntN(3) == 0 {
		v.state, v.stateUntil = parked, now.Add(time.Duration(rng.IntN(120))*time.Second)
	} else {
		v.ignition = true
		v.nextLeg()
	}
	return v
}

// step advances the model by dt and reports whether ignition or motion
// changed (the IO id to use as event, 0 if none).
func (v *vehicle) step(now time.Time, dt time.Duration) (event uint16) {
	ign, mot := v.ignition, v.motion
	sec := dt.Seconds()

	switch v.state {
	case parked:
		v.speed = 0
		if now.After(v.stateUntil) {
			v.ignition = true
			v.state, v.stateUntil = idling, now.Add(time.Duration(5+v.rng.IntN(20))*time.Second)
		}
	case idling:
		v.speed = 0
		if now.After(v.stateUntil) {
			v.nextLeg()
		}
	case driving:
		dist := distance(v.lat, v.lng, v.wpLat, v.wpLng)
		target := v.cruise
		// Brake to arrive at the waypoint (v² = 2·a·d), keeping a crawl speed.
		if vmax := math.Sqrt(2 * decel * dist); vmax < target {
			target = max(vmax, 2)
		}
		if v.speed < target {
			v.speed = min(target, v.speed+accel*sec)
		} else {
			v.speed = max(target, v.speed-decel*sec)
		}
		v.speed = max(0, v.speed*(0.97+0.06*v.rng.Float64())) // traffic noise

		bearing := bearingTo(v.lat, v.lng, v.wpLat, v.wpLng)
		v.heading = math.Mod(bearing+v.rng.NormFloat64()*2+360, 360)
		move := min(v.speed*sec, dist)
		v.lat, v.lng = offset(v.lat, v.lng, v.heading*math.Pi/180, move)
		v.odometer += move
		v.trip += move
		v.altitude = max(0, v.altitude+v.rng.NormFloat64()*0.5)

		if dist-move < 10 {
			v.arrive(now)
		}
	}
	v.motion = v.speed > 0.5
	switch {
	case ign != v.ignition:
		return 239
	case mot != v.motion:
		return 240
	}
	return 0
}

// arrive picks what happens at a waypoint: keep driving, idle or park.
func (v *vehicle) arrive(now time.Time) {
	v.speed = 0
	switch r := v.rng.Float64(); {
	case r < 0.15: // park with engine off for 1–6 minutes
		v.state, v.ignition, v.trip = parked, false, 0
		v.stateUntil = now.Add(time.Duration(60+v.rng.IntN(300)) * time.Second)
	case r < 0.40: // idle with engine on for 10–90 s
		v.state = idling
		v.stateUntil = now.Add(time.Duration(10+v.rng.IntN(80)) * time.Second)
	default:
		v.nextLeg()
	}
}

// nextLeg picks a new waypoint near the current position but inside the area.
func (v *vehicle) nextLeg() {
	v.state = driving
	for range 20 {
		lat, lng := offset(v.lat, v.lng, v.rng.Float64()*2*math.Pi, 300+v.rng.Float64()*legRadius)
		if distance(lat, lng, v.centerLat, v.centerLng) <= areaRadius {
			v.wpLat, v.wpLng = lat, lng
			break
		}
		v.wpLat, v.wpLng = v.centerLat, v.centerLng // fallback: head back to center
	}
	// Mix of city (30–70 km/h) and highway (80–110 km/h) legs.
	kmh := 30 + v.rng.Float64()*40
	if v.rng.IntN(4) == 0 {
		kmh = 80 + v.rng.Float64()*30
	}
	v.cruise = kmh / 3.6
}

// record renders the current state as an AVL record.
func (v *vehicle) record(now time.Time, event uint16) teltonika.Record {
	b2i := func(b bool) uint64 {
		if b {
			return 1
		}
		return 0
	}
	power := 12_400 + v.rng.IntN(300) // mV, battery resting
	if v.ignition {
		power = 13_800 + v.rng.IntN(500) // alternator charging
	}
	sats := 8 + v.rng.IntN(7)
	priority := uint8(0)
	if event != 0 {
		priority = 1
	}
	return teltonika.Record{
		Time:       now.UTC().Truncate(time.Millisecond),
		Priority:   priority,
		Latitude:   int32(math.Round(v.lat * 1e7)),
		Longitude:  int32(math.Round(v.lng * 1e7)),
		Altitude:   int16(v.altitude),
		Angle:      uint16(v.heading) % 360,
		Satellites: uint8(sats),
		Speed:      uint16(math.Round(min(v.speed*3.6, 110))),
		EventID:    event,
		IO: []teltonika.IOElement{
			teltonika.NewIO(239, 1, b2i(v.ignition)),
			teltonika.NewIO(240, 1, b2i(v.motion)),
			teltonika.NewIO(21, 1, uint64(3+v.rng.IntN(3))), // GSM signal
			teltonika.NewIO(69, 1, 1),                       // GNSS on with fix
			teltonika.NewIO(200, 1, 0),                      // sleep mode off
			teltonika.NewIO(66, 2, uint64(power)),
			teltonika.NewIO(67, 2, uint64(4_000+v.rng.IntN(200))),
			teltonika.NewIO(181, 2, uint64(8+v.rng.IntN(8))), // PDOP x10
			teltonika.NewIO(182, 2, uint64(6+v.rng.IntN(6))), // HDOP x10
			teltonika.NewIO(16, 4, uint64(v.odometer)),
			teltonika.NewIO(199, 4, uint64(v.trip)),
		},
	}
}

// offset moves (lat, lng) by dist meters along bearing (radians).
func offset(lat, lng, bearing, dist float64) (float64, float64) {
	φ1, λ1, δ := lat*math.Pi/180, lng*math.Pi/180, dist/earthRadius
	φ2 := math.Asin(math.Sin(φ1)*math.Cos(δ) + math.Cos(φ1)*math.Sin(δ)*math.Cos(bearing))
	λ2 := λ1 + math.Atan2(math.Sin(bearing)*math.Sin(δ)*math.Cos(φ1), math.Cos(δ)-math.Sin(φ1)*math.Sin(φ2))
	return φ2 * 180 / math.Pi, λ2 * 180 / math.Pi
}

// distance is the haversine distance in meters.
func distance(lat1, lng1, lat2, lng2 float64) float64 {
	φ1, φ2 := lat1*math.Pi/180, lat2*math.Pi/180
	dφ, dλ := φ2-φ1, (lng2-lng1)*math.Pi/180
	a := math.Sin(dφ/2)*math.Sin(dφ/2) + math.Cos(φ1)*math.Cos(φ2)*math.Sin(dλ/2)*math.Sin(dλ/2)
	return 2 * earthRadius * math.Asin(math.Sqrt(a))
}

// bearingTo returns the initial bearing in degrees from point 1 to point 2.
func bearingTo(lat1, lng1, lat2, lng2 float64) float64 {
	φ1, φ2 := lat1*math.Pi/180, lat2*math.Pi/180
	dλ := (lng2 - lng1) * math.Pi / 180
	y := math.Sin(dλ) * math.Cos(φ2)
	x := math.Cos(φ1)*math.Sin(φ2) - math.Sin(φ1)*math.Cos(φ2)*math.Cos(dλ)
	return math.Mod(math.Atan2(y, x)*180/math.Pi+360, 360)
}
