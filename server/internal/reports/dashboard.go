package reports

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// Dashboard is the GET /dashboard response.
type Dashboard struct {
	From          time.Time         `json:"from"`
	To            time.Time         `json:"to"`
	DistanceByDay []DayDistance     `json:"distanceByDay"`
	AlertsByType  map[string]int    `json:"alertsByType"`
	TopVehicles   []VehicleDistance `json:"topVehicles"`
	DriverScores  []DriverScore     `json:"driverScores"`
	Maintenance   store.DueCounts   `json:"maintenance"`
	Reminders     store.DueCounts   `json:"reminders"`
	Expenses      ExpensesThisMonth `json:"expenses"`
	Utilization   float64           `json:"utilization"`
}

// DayDistance is the fleet distance of one day (km).
type DayDistance struct {
	Date     string  `json:"date"`
	Distance float64 `json:"distance"`
}

// VehicleDistance ranks vehicles by distance (km).
type VehicleDistance struct {
	DeviceID int64   `json:"deviceId"`
	Name     string  `json:"name"`
	Distance float64 `json:"distance"`
}

// DriverScore is one driver's score over the period.
type DriverScore struct {
	DriverID *int64  `json:"driverId"`
	DeviceID *int64  `json:"deviceId,omitempty"` // set when no driver is known (vehicle bucket)
	Name     string  `json:"name"`
	Score    float64 `json:"score"`
	Distance float64 `json:"distance"` // km
}

// ExpensesThisMonth totals the current calendar month.
type ExpensesThisMonth struct {
	Total    float64 `json:"total"`
	Currency string  `json:"currency"`
}

// Dashboard limits.
const (
	MaxDashboardDays = 93
	dashboardTop     = 5
	dashboardDrivers = 10
	dashboardTTL     = time.Minute
)

type dashEntry struct {
	at time.Time
	d  *Dashboard
}

// DashboardRequest selects the dashboard scope.
type DashboardRequest struct {
	Devices []store.Device // visible devices
	All     bool           // caller sees every device (includes unassigned reminders)
	Scope   map[int64]bool // visible device ids when !All
	Days    int
	Loc     *time.Location
	Now     time.Time
}

// Dashboard computes the dashboard (cached for a minute per scope).
func (e *Engine) Dashboard(ctx context.Context, req DashboardRequest) (*Dashboard, error) {
	if req.Loc == nil {
		req.Loc = time.UTC
	}
	if req.Now.IsZero() {
		req.Now = time.Now()
	}
	ids := deviceIDs(req.Devices)
	key := fmt.Sprintf("%d|%s|%t|%v", req.Days, req.Loc, req.All, ids)
	e.dashMu.Lock()
	if c, ok := e.dashCache[key]; ok && req.Now.Sub(c.at) < dashboardTTL && req.Now.Sub(c.at) >= 0 {
		e.dashMu.Unlock()
		return c.d, nil
	}
	e.dashMu.Unlock()

	now := req.Now.In(req.Loc)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, req.Loc)
	from := today.AddDate(0, 0, -(req.Days - 1))
	to := req.Now
	d := &Dashboard{From: from.UTC(), To: to.UTC(), AlertsByType: map[string]int{},
		TopVehicles: []VehicleDistance{}, DriverScores: []DriverScore{}}

	as, err := e.analyzeAll(ctx, req.Devices, from, to, req.Loc)
	if err != nil {
		return nil, err
	}
	byDay := map[string]float64{}
	var driving float64
	for i, a := range as {
		for _, day := range a.Days {
			byDay[day.Date.Format(time.DateOnly)] += day.Distance
		}
		driving += a.Driving
		d.TopVehicles = append(d.TopVehicles, VehicleDistance{DeviceID: req.Devices[i].ID, Name: req.Devices[i].Name,
			Distance: km(a.Distance)})
	}
	for day := from; !day.After(today); day = day.AddDate(0, 0, 1) {
		k := day.Format(time.DateOnly)
		d.DistanceByDay = append(d.DistanceByDay, DayDistance{Date: k, Distance: km(byDay[k])})
	}
	sort.SliceStable(d.TopVehicles, func(i, j int) bool { return d.TopVehicles[i].Distance > d.TopVehicles[j].Distance })
	if len(d.TopVehicles) > dashboardTop {
		d.TopVehicles = d.TopVehicles[:dashboardTop]
	}
	if period := to.Sub(from).Seconds(); period > 0 && len(req.Devices) > 0 {
		d.Utilization = round(min(1, driving/(float64(len(req.Devices))*period)), 4)
	}

	counts, err := e.st.CountEvents(ctx, ids, from, to)
	if err != nil {
		return nil, err
	}
	for _, c := range counts {
		if c.Type != store.EventCommandResult {
			d.AlertsByType[c.Type] += c.Count
		}
	}

	aggs, err := e.driverAggregates(ctx, req.Devices, as, from, to)
	if err != nil {
		return nil, err
	}
	harshScoring := e.st.Settings().HarshScoring
	for _, g := range aggs {
		if g.distance == 0 {
			continue
		}
		s := DriverScore{Name: g.name(), Score: g.score(harshScoring), Distance: km(g.distance)}
		if g.ref != nil {
			id := g.ref.ID
			s.DriverID = &id
		} else {
			id := g.device.ID
			s.DeviceID = &id
		}
		d.DriverScores = append(d.DriverScores, s)
	}
	sort.SliceStable(d.DriverScores, func(i, j int) bool {
		a, b := d.DriverScores[i], d.DriverScores[j]
		if a.Score != b.Score {
			return a.Score > b.Score
		}
		if a.Distance != b.Distance {
			return a.Distance > b.Distance
		}
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})
	if len(d.DriverScores) > dashboardDrivers {
		d.DriverScores = d.DriverScores[:dashboardDrivers]
	}

	up, err := e.st.UpkeepSummary(ctx, req.All, req.Scope)
	if err != nil {
		return nil, err
	}
	d.Maintenance, d.Reminders = up.Maintenance, up.Reminders

	month := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, req.Loc)
	total, err := e.st.ExpensesTotal(ctx, ids, month)
	if err != nil {
		return nil, err
	}
	d.Expenses = ExpensesThisMonth{Total: round(total, 2), Currency: e.st.Settings().Currency}

	e.dashMu.Lock()
	for k, c := range e.dashCache { // drop stale entries
		if req.Now.Sub(c.at) >= dashboardTTL {
			delete(e.dashCache, k)
		}
	}
	e.dashCache[key] = dashEntry{at: req.Now, d: d}
	e.dashMu.Unlock()
	return d, nil
}
