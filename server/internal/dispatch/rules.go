package dispatch

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// departHysteresis returns how far outside a stop's radius a vehicle must be
// before it counts as departed, so GPS jitter at the edge does not depart.
func departHysteresis(radius float64) float64 { return math.Max(25, 0.2*radius) }

func validFix(p *domain.Position) bool {
	return p.Valid && !(p.Latitude == 0 && p.Longitude == 0)
}

// StopRule tracks job stops from vehicle positions (events.Rule).
func (s *Service) StopRule() *StopRule { return &StopRule{s} }

// StopRule marks stops arrived/departed and raises jobStopArrived.
type StopRule struct{ s *Service }

// Eval implements events.Rule.
func (r *StopRule) Eval(ctx context.Context, dev *store.Device, p *domain.Position) []store.Event {
	if !validFix(p) {
		return nil
	}
	s := r.s
	jobs := s.snap.Load().jobsByDevice[dev.ID]
	if len(jobs) == 0 {
		return nil
	}
	var (
		evs     []store.Event
		changed bool
	)
	for ji := range jobs {
		j := &jobs[ji]
		for si := range j.Stops {
			st := &j.Stops[si]
			d := store.StopDistance(st, p.Latitude, p.Longitude)
			switch {
			case st.Status == store.StopPending && st.ArrivedAt == nil && d <= st.Radius:
				ch, ok, err := s.st.AutoStopArrived(ctx, j.ID, st.ID, p.DeviceTime, p.Latitude, p.Longitude)
				if err != nil {
					s.log.Error("dispatch: stop arrival", "job", j.ID, "stop", st.ID, "err", err)
					continue
				}
				if !ok {
					continue
				}
				changed = true
				s.publish(ch.Job)
				if ev, _, ok := s.jobEvent(&ch.Job, store.EventJobStopArrived,
					fmt.Sprintf("%s arrived at %s (%s)", ch.Job.Reference, st.Name, ch.Job.Title),
					map[string]any{"stopId": st.ID, "stopName": st.Name, "auto": true},
					&[2]float64{p.Longitude, p.Latitude}, p.DeviceTime); ok {
					evs = append(evs, ev)
				}
			case st.ArrivedAt != nil && st.DepartedAt == nil && d > st.Radius+departHysteresis(st.Radius):
				ch, ok, err := s.st.AutoStopDeparted(ctx, j.ID, st.ID, p.DeviceTime, p.Latitude, p.Longitude)
				if err != nil {
					s.log.Error("dispatch: stop departure", "job", j.ID, "stop", st.ID, "err", err)
					continue
				}
				if ok {
					changed = true
					s.publish(ch.Job)
				}
			}
		}
	}
	if changed {
		s.refresh(ctx)
	}
	return evs
}

// RouteRule raises routeDeviation / routeReturn (events.Rule).
func (s *Service) RouteRule() *RouteRule { return &RouteRule{s} }

// RouteRule checks monitored devices against their routes' corridors.
type RouteRule struct{ s *Service }

type routeKey struct{ device, route int64 }

// deviationState is the corridor state of one device on one route.
type deviationState struct {
	outside      bool
	outsideSince time.Time
	fired        bool // routeDeviation raised for this excursion
	maxDistance  float64
	last         time.Time
}

func (s *Service) pruneRouteState(next *snapshot) {
	s.routeMu.Lock()
	defer s.routeMu.Unlock()
	for k := range s.routeState {
		keep := false
		for _, r := range next.routesByDevice[k.device] {
			if r.ID == k.route {
				keep = true
				break
			}
		}
		if !keep {
			delete(s.routeState, k)
		}
	}
}

// Eval implements events.Rule.
func (r *RouteRule) Eval(_ context.Context, dev *store.Device, p *domain.Position) []store.Event {
	if !validFix(p) {
		return nil
	}
	s := r.s
	routes := s.snap.Load().routesByDevice[dev.ID]
	if len(routes) == 0 {
		return nil
	}
	var evs []store.Event
	s.routeMu.Lock()
	defer s.routeMu.Unlock()
	for _, rt := range routes {
		k := routeKey{dev.ID, rt.ID}
		st := s.routeState[k]
		if st == nil {
			st = &deviationState{}
			s.routeState[k] = st
		}
		if !st.last.IsZero() && !p.DeviceTime.After(st.last) {
			continue
		}
		st.last = p.DeviceTime
		d := DistanceToPath([2]float64{p.Longitude, p.Latitude}, rt.Path)
		newEvent := func(typ, msg string, attrs map[string]any) {
			attrs["routeId"], attrs["routeName"], attrs["corridor"] = rt.ID, rt.Name, rt.Corridor
			evs = append(evs, store.Event{DeviceID: dev.ID, Type: typ, Time: p.DeviceTime, Lat: p.Latitude,
				Lng: p.Longitude, Attributes: attrs, Message: msg})
		}
		if d > rt.Corridor {
			if !st.outside {
				st.outside, st.outsideSince, st.fired, st.maxDistance = true, p.DeviceTime, false, d
			}
			st.maxDistance = math.Max(st.maxDistance, d)
			minDur := time.Duration(rt.MinDeviationSeconds) * time.Second
			if !st.fired && p.DeviceTime.Sub(st.outsideSince) >= minDur {
				st.fired = true
				newEvent(store.EventRouteDeviation, fmt.Sprintf("%s left route %s (%.0f m off)", dev.Name, rt.Name, d),
					map[string]any{"distance": math.Round(d)})
			}
			continue
		}
		if st.fired {
			newEvent(store.EventRouteReturn, fmt.Sprintf("%s returned to route %s", dev.Name, rt.Name),
				map[string]any{"maxDistance": math.Round(st.maxDistance),
					"seconds": int(p.DeviceTime.Sub(st.outsideSince) / time.Second)})
		}
		st.outside, st.fired, st.maxDistance = false, false, 0
	}
	return evs
}
