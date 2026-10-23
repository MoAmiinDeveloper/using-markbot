package sensors

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"sync"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// FlushInterval is how often changed sensor states are persisted.
const FlushInterval = 30 * time.Second

// state is the live state of one sensor.
type state struct {
	Last       time.Time    `json:"last"` // device time of the last evaluated fix
	Median     Median       `json:"median"`
	Thresholds Thresholds   `json:"thresholds"`
	Fuel       FuelDetector `json:"fuel"`
	Value      *float64     `json:"-"`
	Time       *time.Time   `json:"-"`

	sig    string // calibration/source signature; a change resets the state
	device int64
	dirty  bool
}

// Service is the events rule computing sensor values and raising fuelDrain,
// refuel, sensorHigh and sensorLow events. Register it with
// events.Engine.AddRule and run Run to persist states.
type Service struct {
	st  *store.Store
	log *slog.Logger

	mu     sync.Mutex
	states map[int64]*state
	saved  map[int64]json.RawMessage // persisted states not loaded yet
}

// New loads the persisted sensor states.
func New(ctx context.Context, st *store.Store, log *slog.Logger) (*Service, error) {
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	saved, err := st.SensorStates(ctx)
	if err != nil {
		return nil, fmt.Errorf("load sensor states: %w", err)
	}
	return &Service{st: st, log: log, states: map[int64]*state{}, saved: saved}, nil
}

// signature identifies the inputs of a sensor's computed value.
func signature(s *store.Sensor) string {
	b, _ := json.Marshal([]any{s.DeviceID, s.Source, s.Type, s.Calibration, s.Multiplier, s.Offset})
	return string(b)
}

// stateFor returns the state of a sensor, loading or resetting it. Caller holds mu.
func (s *Service) stateFor(sn *store.Sensor) *state {
	sig := signature(sn)
	st, ok := s.states[sn.ID]
	if ok && st.sig == sig {
		st.Median.N = sn.Smoothing
		return st
	}
	st = &state{sig: sig, device: sn.DeviceID}
	if raw, found := s.saved[sn.ID]; found && !ok {
		var p persisted
		if json.Unmarshal(raw, &p) == nil && p.Sig == sig {
			st.Last, st.Median, st.Thresholds, st.Fuel = p.Last, p.Median, p.Thresholds, p.Fuel
		}
		delete(s.saved, sn.ID)
	}
	st.Median.N = sn.Smoothing
	s.states[sn.ID] = st
	return st
}

// persisted is the JSON stored in sensor_state.state.
type persisted struct {
	Sig        string       `json:"sig"`
	Last       time.Time    `json:"last"`
	Median     Median       `json:"median"`
	Thresholds Thresholds   `json:"thresholds"`
	Fuel       FuelDetector `json:"fuel"`
}

// Eval implements events.Rule.
func (s *Service) Eval(_ context.Context, dev *store.Device, p *domain.Position) []store.Event {
	sensors := s.st.DeviceSensors(dev.ID)
	if len(sensors) == 0 {
		return nil
	}
	var (
		evs      []store.Event
		readings = map[int64]store.SensorReading{}
	)
	s.mu.Lock()
	for i := range sensors {
		sn := &sensors[i]
		raw, ok := Raw(p.Attributes, sn.Source)
		if !ok {
			continue
		}
		st := s.stateFor(sn)
		if !st.Last.IsZero() && !p.DeviceTime.After(st.Last) {
			continue // replayed / out-of-order fix
		}
		st.Last = p.DeviceTime
		v := st.Median.Add(Calibrate(sn, raw))
		t := p.DeviceTime
		st.Value, st.Time, st.dirty = &v, &t, true
		readings[sn.ID] = store.SensorReading{Value: v, Time: t}
		evs = append(evs, s.detect(dev, sn, st, p, v)...)
	}
	s.mu.Unlock()
	s.st.SetSensorReadings(dev.ID, readings)
	return evs
}

func fmtNum(v float64, decimals int) string {
	return strconv.FormatFloat(store.RoundTo(v, decimals), 'f', decimals, 64)
}

// detect raises the events of one new value.
func (s *Service) detect(dev *store.Device, sn *store.Sensor, st *state, p *domain.Position, v float64) []store.Event {
	var evs []store.Event
	newEvent := func(typ, msg string, attrs map[string]any) {
		evs = append(evs, store.Event{DeviceID: dev.ID, Type: typ, Time: p.DeviceTime, Lat: p.Latitude,
			Lng: p.Longitude, Attributes: attrs, Message: msg})
	}
	unit := ""
	if sn.Unit != "" {
		unit = " " + sn.Unit
	}
	if kind, limit := st.Thresholds.Update(sn, v); kind != "" {
		typ, word := store.EventSensorHigh, "above"
		if kind == Low {
			typ, word = store.EventSensorLow, "below"
		}
		newEvent(typ, fmt.Sprintf("%s: %s %s%s is %s the limit of %s%s", dev.Name, sn.Name, fmtNum(v, sn.Decimals), unit,
			word, fmtNum(limit, sn.Decimals), unit),
			map[string]any{"sensorId": sn.ID, "sensorName": sn.Name, "value": store.RoundTo(v, sn.Decimals),
				"limit": limit, "unit": sn.Unit})
	}
	if sn.Type == store.SensorFuel {
		ch := st.Fuel.Add(sn, p.DeviceTime, v, Stopped(p.Speed, store.PositionIgnition(p)), p.Latitude, p.Longitude)
		if ch != nil {
			attrs := map[string]any{"sensorId": sn.ID, "sensorName": sn.Name, "liters": store.RoundTo(ch.Liters, 1),
				"before": store.RoundTo(ch.Before, 1), "after": store.RoundTo(ch.After, 1)}
			if ch.Kind == Refuel {
				newEvent(store.EventRefuel, fmt.Sprintf("%s refuelled %s L (%s → %s L)", dev.Name,
					fmtNum(ch.Liters, 1), fmtNum(ch.Before, 1), fmtNum(ch.After, 1)), attrs)
			} else {
				newEvent(store.EventFuelDrain, fmt.Sprintf("%s: possible fuel drain of %s L (%s → %s L)", dev.Name,
					fmtNum(ch.Liters, 1), fmtNum(ch.Before, 1), fmtNum(ch.After, 1)), attrs)
			}
		}
	}
	return evs
}

// Run persists changed states every FlushInterval and once more when ctx ends.
func (s *Service) Run(ctx context.Context) {
	t := time.NewTicker(FlushInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			fctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			s.Flush(fctx)
			cancel()
			return
		case <-t.C:
			s.Flush(ctx)
		}
	}
}

func (s *Service) exists(deviceID, sensorID int64) bool {
	for _, sn := range s.st.DeviceSensors(deviceID) {
		if sn.ID == sensorID {
			return true
		}
	}
	return false
}

// Flush persists the states changed since the last flush.
func (s *Service) Flush(ctx context.Context) {
	var rows []store.SensorStateRow
	s.mu.Lock()
	for id, st := range s.states {
		if !s.exists(st.device, id) {
			delete(s.states, id)
			continue
		}
		if !st.dirty {
			continue
		}
		raw, err := json.Marshal(persisted{Sig: st.sig, Last: st.Last, Median: st.Median, Thresholds: st.Thresholds,
			Fuel: st.Fuel})
		if err != nil {
			continue
		}
		rows = append(rows, store.SensorStateRow{SensorID: id, Value: st.Value, Time: st.Time, State: raw})
		st.dirty = false
	}
	s.mu.Unlock()
	if err := s.st.SaveSensorStates(ctx, rows); err != nil {
		s.log.Error("sensors: save states", "err", err)
		s.mu.Lock()
		for _, r := range rows {
			if st := s.states[r.SensorID]; st != nil {
				st.dirty = true
			}
		}
		s.mu.Unlock()
	}
}
