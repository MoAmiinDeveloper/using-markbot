package main

import (
	"math"
	"math/rand/v2"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/protocol/teltonika"
)

// Sensor simulation (-sensors), for demoing fuel and temperature sensors.
//
// io9 (AIN1, mV): fuel probe, 0–4500 mV linear for a 120 L tank
// (calibration [[0,0],[4500,120]]). The level falls with distance driven
// (30 L/100 km) and while idling, jumps up on refuels at stops (always when
// low), and sometimes drops while parked with the engine off (a drain).
// Readings carry slosh noise.
//
// io72 (Dallas temperature, 0.1 °C): a reefer held at about 4 °C whose door
// is opened every 4–10 minutes, warming it above 8 °C for a while.
const (
	tankLiters    = 120.0
	probeFullMV   = 4500.0
	fuelPerMeter  = 0.30 / 1000 // L/m
	idlePerSecond = 2.0 / 3600  // L/s
	setpoint      = 4.0         // °C
)

type sensorSim struct {
	rng *rand.Rand

	fuel       float64 // L
	fuelTarget float64 // refuel/drain in progress towards this level
	fuelRate   float64 // L/s, signed
	wasStopped bool

	temp      float64 // °C
	doorAt    time.Time
	doorUntil time.Time
	peak      float64
}

func newSensorSim(rng *rand.Rand, now time.Time) *sensorSim {
	return &sensorSim{rng: rng, fuel: 25 + rng.Float64()*85, temp: setpoint,
		doorAt: now.Add(time.Duration(60+rng.IntN(240)) * time.Second)}
}

// drive consumes fuel for meters driven.
func (s *sensorSim) drive(meters float64) {
	if s.fuelRate == 0 {
		s.fuel = max(0, s.fuel-meters*fuelPerMeter)
	}
}

// step advances refuels/drains, idle consumption and the reefer.
func (s *sensorSim) step(now time.Time, sec float64, stopped, parked, ignition bool) {
	if stopped && !s.wasStopped && s.fuelRate == 0 {
		switch r := s.rng.Float64(); {
		case s.fuel < 40 || r < 0.15: // refuel to nearly full, 4–6 L/s
			s.fuelTarget = tankLiters - 2 - s.rng.Float64()*8
			s.fuelRate = 4 + s.rng.Float64()*2
		case parked && r < 0.45: // drain 15–30 L at 1.5 L/s, engine off only
			s.fuelTarget = max(0, s.fuel-15-s.rng.Float64()*15)
			s.fuelRate = -1.5
		}
	}
	s.wasStopped = stopped
	if s.fuelRate != 0 {
		s.fuel += s.fuelRate * sec
		if (s.fuelRate > 0 && s.fuel >= s.fuelTarget) || (s.fuelRate < 0 && s.fuel <= s.fuelTarget) {
			s.fuel, s.fuelRate = s.fuelTarget, 0
		}
	} else if ignition && !parked {
		s.fuel = max(0, s.fuel-idlePerSecond*sec)
	}

	// Reefer door: warm up for the open period, then cool back to setpoint.
	switch {
	case now.After(s.doorAt) && s.doorUntil.IsZero():
		s.doorUntil = now.Add(time.Duration(60+s.rng.IntN(90)) * time.Second)
		s.peak = 10 + s.rng.Float64()*4
	case !s.doorUntil.IsZero() && now.Before(s.doorUntil):
		s.temp = min(s.peak, s.temp+0.15*sec)
	case !s.doorUntil.IsZero():
		s.doorUntil = time.Time{}
		s.doorAt = now.Add(time.Duration(240+s.rng.IntN(360)) * time.Second)
	default:
		s.temp = max(setpoint, s.temp-0.08*sec)
	}
}

// io renders the sensor IO elements.
func (s *sensorSim) io(driving bool) []teltonika.IOElement {
	noise := 0.004
	if driving {
		noise = 0.02
	}
	mv := s.fuel/tankLiters*probeFullMV + s.rng.NormFloat64()*noise*probeFullMV
	if driving && s.rng.IntN(100) == 0 { // slosh spike
		mv += (s.rng.Float64() - 0.5) * 800
	}
	mv = math.Round(min(max(mv, 0), probeFullMV+200))
	t := int32(math.Round((s.temp + s.rng.NormFloat64()*0.15) * 10))
	return []teltonika.IOElement{
		teltonika.NewIO(9, 2, uint64(mv)),
		teltonika.NewIO(72, 4, uint64(uint32(t))),
	}
}
