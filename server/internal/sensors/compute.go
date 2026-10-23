// Package sensors turns raw position attributes into calibrated sensor
// values (fuel level, temperature, …), smooths them and detects fuel drains,
// refuels and threshold excursions. The pure computations here are shared
// by the live events rule (Service) and the fuel/temperature reports.
package sensors

import (
	"encoding/json"
	"math"
	"slices"
	"strconv"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// Raw extracts a numeric attribute value. Booleans count as 0/1, numeric
// strings are parsed; anything else reports ok == false.
func Raw(attrs map[string]any, key string) (float64, bool) {
	v, ok := attrs[key]
	if !ok {
		return 0, false
	}
	var f float64
	switch x := v.(type) {
	case float64:
		f = x
	case float32:
		f = float64(x)
	case int:
		f = float64(x)
	case int8:
		f = float64(x)
	case int16:
		f = float64(x)
	case int32:
		f = float64(x)
	case int64:
		f = float64(x)
	case uint:
		f = float64(x)
	case uint8:
		f = float64(x)
	case uint16:
		f = float64(x)
	case uint32:
		f = float64(x)
	case uint64:
		f = float64(x)
	case bool:
		if x {
			f = 1
		}
	case json.Number:
		var err error
		if f, err = x.Float64(); err != nil {
			return 0, false
		}
	case string:
		var err error
		if f, err = strconv.ParseFloat(x, 64); err != nil {
			return 0, false
		}
	default:
		return 0, false
	}
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return 0, false
	}
	return f, true
}

// Calibrate converts a raw reading: piecewise linear interpolation over the
// calibration table (clamped to its first/last value outside the table),
// else raw × multiplier + offset.
func Calibrate(s *store.Sensor, raw float64) float64 {
	return calibrate(s.Calibration, s.Multiplier, s.Offset, raw)
}

func calibrate(cal [][2]float64, mult, off, raw float64) float64 {
	if len(cal) < 2 {
		return raw*mult + off
	}
	if raw <= cal[0][0] {
		return cal[0][1]
	}
	last := cal[len(cal)-1]
	if raw >= last[0] {
		return last[1]
	}
	i, _ := slices.BinarySearchFunc(cal, raw, func(p [2]float64, r float64) int {
		switch {
		case p[0] < r:
			return -1
		case p[0] > r:
			return 1
		}
		return 0
	})
	// cal[i-1][0] < raw <= cal[i][0]
	a, b := cal[i-1], cal[i]
	return a[1] + (raw-a[0])*(b[1]-a[1])/(b[0]-a[0])
}

// Median is a rolling median over the last N values.
type Median struct {
	N   int
	Buf []float64
}

// Add pushes v and returns the median of the window.
func (m *Median) Add(v float64) float64 {
	n := max(m.N, 1)
	m.Buf = append(m.Buf, v)
	if len(m.Buf) > n {
		m.Buf = m.Buf[len(m.Buf)-n:]
	}
	if n == 1 {
		return v
	}
	s := slices.Clone(m.Buf)
	slices.Sort(s)
	k := len(s)
	if k%2 == 1 {
		return s[k/2]
	}
	return (s[k/2-1] + s[k/2]) / 2
}

// Hysteresis is how far a value must come back inside a limit before a new
// excursion can be reported: 2 % of the limit, at least 5 display units.
func Hysteresis(s *store.Sensor, limit float64) float64 {
	return max(math.Abs(limit)*0.02, 5*math.Pow(10, -float64(s.Decimals)))
}

// Excursion kinds.
const (
	High = "high"
	Low  = "low"
)

// Thresholds tracks min/max excursions (once per excursion, with hysteresis).
type Thresholds struct {
	HighActive bool `json:"highActive"`
	LowActive  bool `json:"lowActive"`
}

// Update applies a value and returns the excursion that started ("" if none)
// and the limit crossed.
func (t *Thresholds) Update(s *store.Sensor, v float64) (kind string, limit float64) {
	if s.Max != nil {
		mx := *s.Max
		switch {
		case !t.HighActive && v > mx:
			t.HighActive = true
			kind, limit = High, mx
		case t.HighActive && v <= mx-Hysteresis(s, mx):
			t.HighActive = false
		}
	} else {
		t.HighActive = false
	}
	if s.Min != nil {
		mn := *s.Min
		switch {
		case !t.LowActive && v < mn:
			t.LowActive = true
			if kind == "" {
				kind, limit = Low, mn
			}
		case t.LowActive && v >= mn+Hysteresis(s, mn):
			t.LowActive = false
		}
	} else {
		t.LowActive = false
	}
	return kind, limit
}

// Fuel change kinds.
const (
	Refuel = "refuel"
	Drain  = "drain"
)

// FuelChange is a detected refuel or drain.
type FuelChange struct {
	Kind          string
	Liters        float64
	Before, After float64
	Start, Time   time.Time // when the change began / was confirmed
	Lat, Lng      float64   // position when confirmed
}

// Fuel detection parameters.
const (
	fuelWindow    = 30 * time.Minute // a change must happen within this time
	fuelKeepMin   = 6                // samples kept regardless of age (sparse reporting while parked)
	fuelStableFix = 3                // fixes without further change that end a refuel/drain
)

type fuelSample struct {
	T time.Time `json:"t"`
	V float64   `json:"v"`
	S bool      `json:"s"` // taken while stopped
}

// FuelDetector finds refuels and drains in a smoothed fuel level series.
// Refuels are detected at any time; drains only while the vehicle is
// stopped (speed ≤ 3 km/h) or the ignition is off. A change is measured
// against the highest (drain) or lowest (refuel) level of the last 30
// minutes — so slow consumption while idling never adds up to a drain — and
// is reported once, when the level stopped changing for a few fixes or the
// vehicle drove off.
type FuelDetector struct {
	Window  []fuelSample `json:"window"`
	Phase   string       `json:"phase"` // "" | refuel | drain
	Base    float64      `json:"base"`  // level before the change
	Extreme float64      `json:"extreme"`
	Stable  int          `json:"stable"`
	Since   time.Time    `json:"since"`
}

// Stopped reports whether drains may be detected at this fix.
func Stopped(speed float64, ignition *bool) bool {
	return speed <= store.MovingSpeed || (ignition != nil && !*ignition)
}

// Add processes a smoothed level; it returns a confirmed change, if any.
func (d *FuelDetector) Add(s *store.Sensor, t time.Time, v float64, stopped bool, lat, lng float64) *FuelChange {
	fill, drop := s.FillThreshold(), s.DropThreshold()
	tol := 0.5
	if s.TankCapacity != nil {
		tol = max(tol, *s.TankCapacity*0.005)
	}
	var out *FuelChange
	finish := func() {
		liters := d.Extreme - d.Base
		kind := Refuel
		if d.Phase == Drain {
			liters, kind = d.Base-d.Extreme, Drain
		}
		thr := fill
		if kind == Drain {
			thr = drop
		}
		if liters >= thr {
			out = &FuelChange{Kind: kind, Liters: liters, Before: d.Base, After: d.Extreme, Start: d.Since, Time: t,
				Lat: lat, Lng: lng}
		}
		d.Phase, d.Stable = "", 0
		d.Window = d.Window[:0]
	}

	switch d.Phase {
	case Refuel:
		if v > d.Extreme+tol {
			d.Stable = 0
		} else {
			d.Stable++
		}
		d.Extreme = max(d.Extreme, v)
		if d.Stable >= fuelStableFix || !stopped {
			finish()
		}
	case Drain:
		if v < d.Extreme-tol {
			d.Stable = 0
		} else {
			d.Stable++
		}
		d.Extreme = min(d.Extreme, v)
		if d.Stable >= fuelStableFix || !stopped {
			finish()
		}
	}

	if d.Phase == "" && out == nil {
		// Expire old samples, keeping a few taken while stopped for sparse
		// reporting (a drop across a long gap while driving is not a drain).
		cut := 0
		for cut < len(d.Window) && t.Sub(d.Window[cut].T) > fuelWindow &&
			(cut < len(d.Window)-fuelKeepMin || !d.Window[cut].S) {
			cut++
		}
		d.Window = d.Window[cut:]
		if !stopped {
			d.Window = d.Window[:0] // consumption while driving is not a drain
		}
		if len(d.Window) > 0 {
			lo, hi := d.Window[0].V, d.Window[0].V
			for _, x := range d.Window[1:] {
				lo, hi = min(lo, x.V), max(hi, x.V)
			}
			switch {
			case v-lo >= fill:
				d.Phase, d.Base, d.Extreme, d.Stable, d.Since = Refuel, lo, v, 0, t
			case stopped && hi-v >= drop:
				d.Phase, d.Base, d.Extreme, d.Stable, d.Since = Drain, hi, v, 0, t
			}
		}
		if d.Phase == "" {
			d.Window = append(d.Window, fuelSample{T: t, V: v, S: stopped})
			if len(d.Window) > 2000 {
				d.Window = d.Window[len(d.Window)-2000:]
			}
		}
	} else if out != nil {
		d.Window = append(d.Window[:0], fuelSample{T: t, V: v, S: stopped})
	}
	return out
}
