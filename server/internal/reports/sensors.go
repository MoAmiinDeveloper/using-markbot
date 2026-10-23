package reports

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/sensors"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// Sensor reports (Phase 4a): fuel and temperature. Values are recomputed
// from the stored positions with each sensor's current calibration and
// smoothing, so they also cover data recorded before the sensor was added.

// maxSegment caps the time a single reading accounts for (data gaps).
const maxSegment = 30 * time.Minute

type sensorRef struct {
	dev *store.Device
	sn  store.Sensor
}

// sensorsOf lists the sensors of the given types on the report's devices.
func (e *Engine) sensorsOf(req Request, types ...string) []sensorRef {
	var out []sensorRef
	for i := range req.Devices {
		for _, sn := range e.st.DeviceSensors(req.Devices[i].ID) {
			if slices.Contains(types, sn.Type) {
				out = append(out, sensorRef{dev: &req.Devices[i], sn: sn})
			}
		}
	}
	return out
}

// streamSensor calls fn with every smoothed value of a sensor in the period.
func (e *Engine) streamSensor(ctx context.Context, ref sensorRef, from, to time.Time,
	fn func(p *store.SensorPoint, v float64)) error {
	med := sensors.Median{N: ref.sn.Smoothing}
	return e.st.StreamSensorPoints(ctx, ref.dev.ID, []string{ref.sn.Source}, from, to, func(p *store.SensorPoint) error {
		raw, ok := sensors.Raw(p.Attrs, ref.sn.Source)
		if !ok {
			return nil
		}
		fn(p, med.Add(sensors.Calibrate(&ref.sn, raw)))
		return nil
	})
}

// FuelStats are the fuel figures of one sensor over a period.
type FuelStats struct {
	Readings                  int
	Start, End                float64
	Refuels, Drains           int
	RefuelLiters, DrainLiters float64
}

// Consumed = start - end + refuelled - drained, never negative.
func (f *FuelStats) Consumed() float64 {
	return max(0, f.Start-f.End+f.RefuelLiters-f.DrainLiters)
}

// FuelAccumulator computes FuelStats from smoothed levels.
type FuelAccumulator struct {
	Sensor *store.Sensor
	Stats  FuelStats
	det    sensors.FuelDetector
}

// Add processes one smoothed level.
func (a *FuelAccumulator) Add(t time.Time, v, speed float64, ignition *bool) {
	if a.Stats.Readings == 0 {
		a.Stats.Start = v
	}
	a.Stats.Readings++
	a.Stats.End = v
	if ch := a.det.Add(a.Sensor, t, v, sensors.Stopped(speed, ignition), 0, 0); ch != nil {
		if ch.Kind == sensors.Refuel {
			a.Stats.Refuels++
			a.Stats.RefuelLiters += ch.Liters
		} else {
			a.Stats.Drains++
			a.Stats.DrainLiters += ch.Liters
		}
	}
}

func (e *Engine) fuel(ctx context.Context, req Request, rep *Report) error {
	refs := e.sensorsOf(req, store.SensorFuel)
	rep.Subtitle = "Consumed = start - end + refuelled - drained. Drains are counted only while stopped or with the ignition off."
	rep.Columns = []Column{colDevice,
		col("sensor", "Sensor", KindText, "", 0),
		col("startLevel", "Start level", KindNumber, "L", 1),
		col("endLevel", "End level", KindNumber, "L", 1),
		col("consumed", "Consumed", KindNumber, "L", 1),
		col("refuels", "Refuels", KindNumber, "", 0),
		col("refuelLiters", "Refuelled", KindNumber, "L", 1),
		col("drains", "Drains", KindNumber, "", 0),
		col("drainLiters", "Drained", KindNumber, "L", 1),
		col("distance", "Distance", KindNumber, "km", 2),
		col("consumption", "Consumption", KindNumber, "L/100 km", 1),
	}
	// Distance per device (same definition as the summary report).
	var devs []store.Device
	idx := map[int64]int{}
	for _, r := range refs {
		if _, ok := idx[r.dev.ID]; !ok {
			idx[r.dev.ID] = len(devs)
			devs = append(devs, *r.dev)
		}
	}
	as, err := e.analyzeAll(ctx, devs, req.From, req.To, req.Loc)
	if err != nil {
		return err
	}
	var tot FuelStats
	var totDist, consumedWithDist, distWithData float64
	for _, ref := range refs {
		acc := FuelAccumulator{Sensor: &ref.sn}
		err := e.streamSensor(ctx, ref, req.From, req.To, func(p *store.SensorPoint, v float64) {
			acc.Add(p.Time, v, p.Speed, p.Ignition)
		})
		if err != nil {
			return fmt.Errorf("fuel sensor %d: %w", ref.sn.ID, err)
		}
		dist := as[idx[ref.dev.ID]].Distance
		row := deviceRow(ref.dev)
		row["sensorId"], row["sensor"] = ref.sn.ID, ref.sn.Name
		row["distance"] = km(dist)
		totDist += dist
		st := acc.Stats
		if st.Readings == 0 {
			for _, k := range []string{"startLevel", "endLevel", "consumed", "refuels", "refuelLiters", "drains",
				"drainLiters", "consumption"} {
				row[k] = nil
			}
			rep.Rows = append(rep.Rows, row)
			continue
		}
		c := st.Consumed()
		row["startLevel"], row["endLevel"] = round(st.Start, 1), round(st.End, 1)
		row["consumed"] = round(c, 1)
		row["refuels"], row["refuelLiters"] = st.Refuels, round(st.RefuelLiters, 1)
		row["drains"], row["drainLiters"] = st.Drains, round(st.DrainLiters, 1)
		row["consumption"] = per100(c, dist)
		rep.Rows = append(rep.Rows, row)
		tot.Refuels += st.Refuels
		tot.Drains += st.Drains
		tot.RefuelLiters += st.RefuelLiters
		tot.DrainLiters += st.DrainLiters
		consumedWithDist += c
		distWithData += dist
	}
	rep.Totals = map[string]any{"consumed": round(consumedWithDist, 1), "refuels": tot.Refuels,
		"refuelLiters": round(tot.RefuelLiters, 1), "drains": tot.Drains, "drainLiters": round(tot.DrainLiters, 1),
		"distance": km(totDist), "consumption": per100(consumedWithDist, distWithData)}
	return nil
}

// per100 is liters per 100 km (null below 1 km).
func per100(liters, meters float64) any {
	if meters < 1000 {
		return nil
	}
	return round(liters/(meters/1000)*100, 1)
}

// TempStats are the statistics of one temperature sensor over a period.
type TempStats struct {
	Readings      int
	Min, Max, Sum float64
	OutOfRange    time.Duration
	Excursions    int

	th       sensors.Thresholds
	prevT    time.Time
	prevOut  bool
	havePrev bool
}

// Add processes one smoothed reading.
func (t *TempStats) Add(s *store.Sensor, at time.Time, v float64) {
	if t.havePrev && t.prevOut {
		t.OutOfRange += min(at.Sub(t.prevT), maxSegment)
	}
	if t.Readings == 0 {
		t.Min, t.Max = v, v
	}
	t.Readings++
	t.Min, t.Max, t.Sum = min(t.Min, v), max(t.Max, v), t.Sum+v
	if kind, _ := t.th.Update(s, v); kind != "" {
		t.Excursions++
	}
	t.prevT, t.havePrev = at, true
	t.prevOut = (s.Max != nil && v > *s.Max) || (s.Min != nil && v < *s.Min)
}

// Finish accounts for the last reading up to end.
func (t *TempStats) Finish(end time.Time) {
	if t.havePrev && t.prevOut && end.After(t.prevT) {
		t.OutOfRange += min(end.Sub(t.prevT), maxSegment)
	}
	t.havePrev = false
}

func limitValue(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}

func (e *Engine) temperature(ctx context.Context, req Request, rep *Report) error {
	refs := e.sensorsOf(req, store.SensorTemperature)
	rep.Subtitle = "Out of range = time above max or below min (each reading counts until the next, at most 30 min)."
	rep.Columns = []Column{colDevice,
		col("sensor", "Sensor", KindText, "", 0),
		col("min", "Min", KindNumber, "°C", 1),
		col("avg", "Avg", KindNumber, "°C", 1),
		col("max", "Max", KindNumber, "°C", 1),
		col("lowLimit", "Low limit", KindNumber, "°C", 1),
		col("highLimit", "High limit", KindNumber, "°C", 1),
		col("minutesOutOfRange", "Out of range", KindNumber, "min", 0),
		col("excursions", "Excursions", KindNumber, "", 0),
		col("readings", "Readings", KindNumber, "", 0),
	}
	totEx, totMin := 0, 0.0
	for _, ref := range refs {
		var ts TempStats
		end := req.To
		if req.Now.Before(end) {
			end = req.Now
		}
		err := e.streamSensor(ctx, ref, req.From, req.To, func(p *store.SensorPoint, v float64) {
			ts.Add(&ref.sn, p.Time, v)
		})
		if err != nil {
			return fmt.Errorf("temperature sensor %d: %w", ref.sn.ID, err)
		}
		ts.Finish(end)
		row := deviceRow(ref.dev)
		row["sensorId"], row["sensor"] = ref.sn.ID, ref.sn.Name
		row["lowLimit"], row["highLimit"] = limitValue(ref.sn.Min), limitValue(ref.sn.Max)
		row["readings"] = ts.Readings
		if ts.Readings == 0 {
			row["min"], row["avg"], row["max"] = nil, nil, nil
			row["minutesOutOfRange"], row["excursions"] = nil, nil
		} else {
			d := max(ref.sn.Decimals, 1)
			row["min"], row["max"] = round(ts.Min, d), round(ts.Max, d)
			row["avg"] = round(ts.Sum/float64(ts.Readings), d)
			m := round(ts.OutOfRange.Minutes(), 0)
			row["minutesOutOfRange"], row["excursions"] = m, ts.Excursions
			totEx += ts.Excursions
			totMin += m
		}
		rep.Rows = append(rep.Rows, row)
	}
	rep.Totals = map[string]any{"minutesOutOfRange": totMin, "excursions": totEx}
	return nil
}
