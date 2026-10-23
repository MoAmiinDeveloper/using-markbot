// Package reports builds the fleet reports and the dashboard (docs/API.md,
// Phase 3 "Reports" and "Dashboard") and exports them as CSV, XLSX and PDF.
//
// Position-based reports stream each device's positions once through an
// Analyzer (trips, stops, idling, ignition spans, daily totals, per-driver
// totals); event-based reports read the events table. Addresses come from
// places and the geocode cache only, so reports never wait for a remote
// geocoder.
package reports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/geocode"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// Limits.
const (
	MaxRange    = 93 * 24 * time.Hour
	MaxRows     = 50_000 // rows per report; Report.Truncated is set beyond
	parallelism = 4      // devices analyzed concurrently
)

// Column kinds.
const (
	KindNumber   = "number"
	KindDuration = "duration" // seconds
	KindDatetime = "datetime"
	KindText     = "text"
	KindSpeed    = "speed"
	KindMoney    = "money"
	KindLink     = "link"
)

// Column describes one report column.
type Column struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Unit     string `json:"unit,omitempty"`
	Kind     string `json:"kind"`
	Decimals int    `json:"-"` // number formatting in exports
}

// Row is one report row keyed by column key (plus ids such as deviceId).
type Row map[string]any

// Subtotal is a labelled group of totals (e.g. expenses per category).
type Subtotal struct {
	Label  string         `json:"label"`
	Values map[string]any `json:"values"`
}

// Report is the generic report shape of the API contract.
type Report struct {
	Type      string         `json:"type"`
	Title     string         `json:"title"`
	Subtitle  string         `json:"subtitle,omitempty"`
	From      time.Time      `json:"from"`
	To        time.Time      `json:"to"`
	Timezone  string         `json:"timezone"`
	Columns   []Column       `json:"columns"`
	Rows      []Row          `json:"rows"`
	Totals    map[string]any `json:"totals,omitempty"`
	Subtotals []Subtotal     `json:"subtotals,omitempty"`
	Truncated bool           `json:"truncated,omitempty"`
}

// Types lists the report types with their titles, in menu order.
var Types = []struct{ Type, Title string }{
	{"summary", "Travel summary"},
	{"daily", "Daily breakdown"},
	{"trips", "Trips"},
	{"stops", "Stops"},
	{"idle", "Idling"},
	{"ignition", "Ignition"},
	{"overspeed", "Overspeed"},
	{"geofence", "Geofence visits"},
	{"alerts", "Alerts"},
	{"driver", "Driver behaviour"},
	{"expenses", "Expenses"},
	{"maintenance", "Maintenance"},
	{"systemLog", "System log"},
	{"fuel", "Fuel"},
	{"temperature", "Temperature"},
}

// Title returns the title of a report type ("" if unknown).
func Title(typ string) string {
	for _, t := range Types {
		if t.Type == typ {
			return t.Title
		}
	}
	return ""
}

// ErrUnknownType is returned for an unknown report type.
var ErrUnknownType = errors.New("unknown report type")

// Engine builds reports.
type Engine struct {
	st  *store.Store
	geo *geocode.Service
	log *slog.Logger

	dashMu    sync.Mutex
	dashCache map[string]dashEntry
}

// New returns an engine. geo may be nil (coordinates instead of addresses).
func New(st *store.Store, geo *geocode.Service, log *slog.Logger) *Engine {
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	return &Engine{st: st, geo: geo, log: log, dashCache: map[string]dashEntry{}}
}

// Request selects what a report covers.
type Request struct {
	Type     string
	Devices  []store.Device // visible devices to include, in display order
	DriverID int64          // 0 = all drivers
	From, To time.Time
	Loc      *time.Location // day boundaries and export times; UTC if nil
	Now      time.Time      // zero = time.Now()
	// AllDevices is set when no device filter was given (the caller's whole
	// scope); reports about items not tied to devices then include them.
	AllDevices bool
}

// Run builds a report.
func (e *Engine) Run(ctx context.Context, req Request) (*Report, error) {
	title := Title(req.Type)
	if title == "" {
		return nil, ErrUnknownType
	}
	if req.Loc == nil {
		req.Loc = time.UTC
	}
	if req.Now.IsZero() {
		req.Now = time.Now()
	}
	rep := &Report{Type: req.Type, Title: title, From: req.From.UTC(), To: req.To.UTC(), Timezone: req.Loc.String(),
		Rows: []Row{}}
	var err error
	switch req.Type {
	case "summary":
		err = e.summary(ctx, req, rep)
	case "daily":
		err = e.daily(ctx, req, rep)
	case "trips":
		err = e.trips(ctx, req, rep)
	case "stops":
		err = e.stops(ctx, req, rep)
	case "idle":
		err = e.idle(ctx, req, rep)
	case "ignition":
		err = e.ignition(ctx, req, rep)
	case "overspeed":
		err = e.overspeed(ctx, req, rep)
	case "geofence":
		err = e.geofence(ctx, req, rep)
	case "alerts":
		err = e.alerts(ctx, req, rep)
	case "driver":
		err = e.driver(ctx, req, rep)
	case "expenses":
		err = e.expenses(ctx, req, rep)
	case "maintenance":
		err = e.maintenance(ctx, req, rep)
	case "systemLog":
		err = e.systemLog(ctx, req, rep)
	case "fuel":
		err = e.fuel(ctx, req, rep)
	case "temperature":
		err = e.temperature(ctx, req, rep)
	}
	if err != nil {
		return nil, err
	}
	if len(rep.Rows) > MaxRows {
		rep.Rows, rep.Truncated = rep.Rows[:MaxRows], true
	}
	return rep, nil
}

// ---- column helpers ----

func col(key, label, kind, unit string, decimals int) Column {
	return Column{Key: key, Label: label, Kind: kind, Unit: unit, Decimals: decimals}
}

var (
	colDevice = col("device", "Vehicle", KindText, "", 0)
	colDriver = col("driver", "Driver", KindText, "", 0)
)

func km(m float64) float64   { return round(m/1000, 2) }
func secs(s float64) float64 { return math.Round(s) }
func round(v float64, d int) float64 {
	p := math.Pow(10, float64(d))
	return math.Round(v*p) / p
}

func timePtr(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t.UTC()
}

func deviceIDs(devs []store.Device) []int64 {
	ids := make([]int64, len(devs))
	for i, d := range devs {
		ids[i] = d.ID
	}
	return ids
}

func deviceRow(d *store.Device) Row { return Row{"deviceId": d.ID, "device": d.Name} }

// analyzeAll streams every device once, a few devices at a time.
func (e *Engine) analyzeAll(ctx context.Context, devs []store.Device, from, to time.Time, loc *time.Location) ([]*Analysis, error) {
	out := make([]*Analysis, len(devs))
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var (
		wg   sync.WaitGroup
		mu   sync.Mutex
		ferr error
		sem  = make(chan struct{}, parallelism)
	)
	for i := range devs {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer wg.Done()
			defer func() { <-sem }()
			z := NewAnalyzer(loc)
			err := e.st.StreamReportPoints(ctx, devs[i].ID, from, to, func(p *store.ReportPoint) error {
				z.Add(p)
				return nil
			})
			if err != nil {
				mu.Lock()
				if ferr == nil {
					ferr = fmt.Errorf("analyze device %d: %w", devs[i].ID, err)
					cancel()
				}
				mu.Unlock()
				return
			}
			out[i] = z.Finish()
		}(i)
	}
	wg.Wait()
	return out, ferr
}

// resolver returns an address resolver for the points.
func (e *Engine) resolver(ctx context.Context, pts []geocode.Point) func(lat, lng float64) string {
	if e.geo == nil {
		return func(lat, lng float64) string {
			if lat == 0 && lng == 0 {
				return ""
			}
			return geocode.Coords(lat, lng)
		}
	}
	r := e.geo.Resolve(ctx, pts)
	return r.Address
}

// ---- drivers ----

type driverIndex struct {
	byTag    map[string]*store.DriverRef
	byDevice map[int64]*store.DriverRef
	byID     map[int64]*store.DriverRef
}

func (e *Engine) drivers(ctx context.Context) (*driverIndex, error) {
	refs, err := e.st.ReportDrivers(ctx)
	if err != nil {
		return nil, err
	}
	x := &driverIndex{byTag: map[string]*store.DriverRef{}, byDevice: map[int64]*store.DriverRef{}, byID: map[int64]*store.DriverRef{}}
	for i := range refs {
		d := &refs[i]
		x.byID[d.ID] = d
		if t := store.NormalizeTag(d.Tag); t != "" {
			x.byTag[t] = d
		}
		if d.DeviceID != nil {
			x.byDevice[*d.DeviceID] = d
		}
	}
	return x, nil
}

// resolve finds the driver of a device given the reported tag: matching
// tag, else the driver assigned to the device; nil when none.
func (x *driverIndex) resolve(deviceID int64, tag string) *store.DriverRef {
	if t := store.NormalizeTag(tag); t != "" {
		if d := x.byTag[t]; d != nil {
			return d
		}
	}
	return x.byDevice[deviceID]
}

func driverName(d *store.DriverRef) any {
	if d == nil {
		return nil
	}
	return d.Name
}

func driverIDValue(d *store.DriverRef) any {
	if d == nil {
		return nil
	}
	return d.ID
}

// ---- position based reports ----

func (e *Engine) summary(ctx context.Context, req Request, rep *Report) error {
	as, err := e.analyzeAll(ctx, req.Devices, req.From, req.To, req.Loc)
	if err != nil {
		return err
	}
	counts, err := e.st.CountEvents(ctx, deviceIDs(req.Devices), req.From, req.To)
	if err != nil {
		return err
	}
	type cnt struct{ over, harsh, alerts int }
	byDev := map[int64]*cnt{}
	for _, c := range counts {
		x := byDev[c.DeviceID]
		if x == nil {
			x = &cnt{}
			byDev[c.DeviceID] = x
		}
		switch {
		case c.Type == store.EventCommandResult:
			continue
		case c.Type == store.EventOverspeed:
			x.over += c.Count
		case isHarsh(c.Type):
			x.harsh += c.Count
		}
		x.alerts += c.Count
	}
	rep.Columns = []Column{colDevice,
		col("distance", "Distance", KindNumber, "km", 2),
		col("drivingTime", "Driving time", KindDuration, "", 0),
		col("idleTime", "Idle time", KindDuration, "", 0),
		col("stopTime", "Stop time", KindDuration, "", 0),
		col("engineHours", "Engine hours", KindNumber, "h", 2),
		col("maxSpeed", "Max speed", KindSpeed, "km/h", 0),
		col("avgSpeed", "Avg speed", KindSpeed, "km/h", 1),
		col("trips", "Trips", KindNumber, "", 0),
		col("stops", "Stops", KindNumber, "", 0),
		col("overspeeds", "Overspeeds", KindNumber, "", 0),
		col("harshEvents", "Harsh events", KindNumber, "", 0),
		col("alerts", "Alerts", KindNumber, "", 0),
	}
	hasFuel := false
	tot := map[string]float64{}
	var maxSpeed float64
	for i := range req.Devices {
		a := as[i]
		c := byDev[req.Devices[i].ID]
		if c == nil {
			c = &cnt{}
		}
		row := deviceRow(&req.Devices[i])
		row["distance"] = km(a.Distance)
		row["drivingTime"] = secs(a.Driving)
		row["idleTime"] = secs(a.Idle)
		row["stopTime"] = secs(a.Stopped)
		row["engineHours"] = round(a.Engine/3600, 2)
		row["maxSpeed"] = round(a.MaxSpeed, 0)
		row["avgSpeed"] = avgSpeed(a.Distance, a.Driving)
		row["trips"] = len(a.Trips)
		row["stops"] = len(a.Stops)
		row["overspeeds"] = c.over
		row["harshEvents"] = c.harsh
		row["alerts"] = c.alerts
		if a.FuelUsed != nil {
			hasFuel = true
			row["fuelUsed"] = round(*a.FuelUsed, 1)
			tot["fuelUsed"] += *a.FuelUsed
		} else {
			row["fuelUsed"] = nil
		}
		rep.Rows = append(rep.Rows, row)
		tot["distance"] += a.Distance
		tot["drivingTime"] += a.Driving
		tot["idleTime"] += a.Idle
		tot["stopTime"] += a.Stopped
		tot["engineHours"] += a.Engine
		tot["trips"] += float64(len(a.Trips))
		tot["stops"] += float64(len(a.Stops))
		tot["overspeeds"] += float64(c.over)
		tot["harshEvents"] += float64(c.harsh)
		tot["alerts"] += float64(c.alerts)
		maxSpeed = max(maxSpeed, a.MaxSpeed)
	}
	if hasFuel {
		rep.Columns = append(rep.Columns, col("fuelUsed", "Fuel used", KindNumber, "L", 1))
	}
	rep.Totals = map[string]any{
		"distance": km(tot["distance"]), "drivingTime": secs(tot["drivingTime"]), "idleTime": secs(tot["idleTime"]),
		"stopTime": secs(tot["stopTime"]), "engineHours": round(tot["engineHours"]/3600, 2),
		"maxSpeed": round(maxSpeed, 0), "avgSpeed": avgSpeed(tot["distance"], tot["drivingTime"]),
		"trips": int(tot["trips"]), "stops": int(tot["stops"]), "overspeeds": int(tot["overspeeds"]),
		"harshEvents": int(tot["harshEvents"]), "alerts": int(tot["alerts"]),
	}
	if hasFuel {
		rep.Totals["fuelUsed"] = round(tot["fuelUsed"], 1)
	}
	return nil
}

func avgSpeed(meters, seconds float64) float64 {
	if seconds <= 0 {
		return 0
	}
	return round(meters/seconds*3.6, 1)
}

func isHarsh(t string) bool {
	return t == store.EventHarshAcceleration || t == store.EventHarshBraking || t == store.EventHarshCornering
}

func (e *Engine) daily(ctx context.Context, req Request, rep *Report) error {
	as, err := e.analyzeAll(ctx, req.Devices, req.From, req.To, req.Loc)
	if err != nil {
		return err
	}
	rep.Columns = []Column{colDevice,
		col("date", "Date", KindText, "", 0),
		col("distance", "Distance", KindNumber, "km", 2),
		col("drivingTime", "Driving time", KindDuration, "", 0),
		col("idleTime", "Idle time", KindDuration, "", 0),
		col("firstStart", "First start", KindDatetime, "", 0),
		col("lastStop", "Last stop", KindDatetime, "", 0),
		col("maxSpeed", "Max speed", KindSpeed, "km/h", 0),
	}
	var dist, drive, idle, maxSpeed float64
	for i := range req.Devices {
		for _, d := range as[i].Days {
			row := deviceRow(&req.Devices[i])
			row["date"] = d.Date.Format(time.DateOnly)
			row["distance"] = km(d.Distance)
			row["drivingTime"] = secs(d.Driving)
			row["idleTime"] = secs(d.Idle)
			row["firstStart"], row["lastStop"] = nil, nil
			if d.FirstStart != nil {
				row["firstStart"] = d.FirstStart.UTC()
			}
			if d.LastStop != nil {
				row["lastStop"] = d.LastStop.UTC()
			}
			row["maxSpeed"] = round(d.MaxSpeed, 0)
			rep.Rows = append(rep.Rows, row)
			dist += d.Distance
			drive += d.Driving
			idle += d.Idle
			maxSpeed = max(maxSpeed, d.MaxSpeed)
		}
	}
	rep.Totals = map[string]any{"distance": km(dist), "drivingTime": secs(drive), "idleTime": secs(idle),
		"maxSpeed": round(maxSpeed, 0)}
	return nil
}

func (e *Engine) trips(ctx context.Context, req Request, rep *Report) error {
	as, err := e.analyzeAll(ctx, req.Devices, req.From, req.To, req.Loc)
	if err != nil {
		return err
	}
	dx, err := e.drivers(ctx)
	if err != nil {
		return err
	}
	var pts []geocode.Point
	for _, a := range as {
		for _, t := range a.Trips {
			pts = append(pts, geocode.Point{Lat: t.StartLat, Lng: t.StartLng}, geocode.Point{Lat: t.EndLat, Lng: t.EndLng})
		}
	}
	addr := e.resolver(ctx, pts)
	rep.Columns = []Column{colDevice, colDriver,
		col("start", "Start", KindDatetime, "", 0),
		col("end", "End", KindDatetime, "", 0),
		col("startAddress", "From", KindText, "", 0),
		col("endAddress", "To", KindText, "", 0),
		col("distance", "Distance", KindNumber, "km", 2),
		col("duration", "Duration", KindDuration, "", 0),
		col("maxSpeed", "Max speed", KindSpeed, "km/h", 0),
		col("avgSpeed", "Avg speed", KindSpeed, "km/h", 1),
	}
	var dist, dur, maxSpeed float64
	for i := range req.Devices {
		for _, t := range as[i].Trips {
			drv := dx.resolve(req.Devices[i].ID, t.DriverTag)
			if req.DriverID != 0 && (drv == nil || drv.ID != req.DriverID) {
				continue
			}
			row := deviceRow(&req.Devices[i])
			row["driverId"], row["driver"] = driverIDValue(drv), driverName(drv)
			row["start"], row["end"] = t.Start.UTC(), t.End.UTC()
			row["startLat"], row["startLng"], row["endLat"], row["endLng"] = t.StartLat, t.StartLng, t.EndLat, t.EndLng
			row["startAddress"] = addr(t.StartLat, t.StartLng)
			row["endAddress"] = addr(t.EndLat, t.EndLng)
			row["distance"] = km(t.Distance)
			row["duration"] = secs(t.Duration)
			row["maxSpeed"] = round(t.MaxSpeed, 0)
			row["avgSpeed"] = round(t.AvgSpeed, 1)
			rep.Rows = append(rep.Rows, row)
			dist += t.Distance
			dur += t.Duration
			maxSpeed = max(maxSpeed, t.MaxSpeed)
		}
	}
	sortRows(rep.Rows, "start")
	rep.Totals = map[string]any{"distance": km(dist), "duration": secs(dur), "maxSpeed": round(maxSpeed, 0),
		"avgSpeed": avgSpeed(dist, dur)}
	return nil
}

func (e *Engine) stops(ctx context.Context, req Request, rep *Report) error {
	as, err := e.analyzeAll(ctx, req.Devices, req.From, req.To, req.Loc)
	if err != nil {
		return err
	}
	var pts []geocode.Point
	for _, a := range as {
		for _, s := range a.Stops {
			pts = append(pts, geocode.Point{Lat: s.Lat, Lng: s.Lng})
		}
	}
	addr := e.resolver(ctx, pts)
	rep.Columns = []Column{colDevice,
		col("start", "Start", KindDatetime, "", 0),
		col("end", "End", KindDatetime, "", 0),
		col("duration", "Duration", KindDuration, "", 0),
		col("address", "Location", KindText, "", 0),
		col("ignition", "Ignition", KindText, "", 0),
	}
	var dur float64
	for i := range req.Devices {
		for _, s := range as[i].Stops {
			row := deviceRow(&req.Devices[i])
			row["start"], row["end"] = s.Start.UTC(), s.End.UTC()
			row["duration"] = secs(s.Duration())
			row["lat"], row["lng"] = s.Lat, s.Lng
			row["address"] = addr(s.Lat, s.Lng)
			row["ignition"] = "off"
			if s.Idle*2 >= s.Duration() {
				row["ignition"] = "on"
			}
			row["idleTime"] = secs(s.Idle)
			row["ongoing"] = s.Ongoing
			rep.Rows = append(rep.Rows, row)
			dur += s.Duration()
		}
	}
	sortRows(rep.Rows, "start")
	rep.Totals = map[string]any{"duration": secs(dur)}
	return nil
}

func (e *Engine) idle(ctx context.Context, req Request, rep *Report) error {
	as, err := e.analyzeAll(ctx, req.Devices, req.From, req.To, req.Loc)
	if err != nil {
		return err
	}
	var pts []geocode.Point
	for _, a := range as {
		for _, p := range a.Idles {
			pts = append(pts, geocode.Point{Lat: p.Lat, Lng: p.Lng})
		}
	}
	addr := e.resolver(ctx, pts)
	rep.Columns = []Column{colDevice,
		col("start", "Start", KindDatetime, "", 0),
		col("end", "End", KindDatetime, "", 0),
		col("duration", "Duration", KindDuration, "", 0),
		col("address", "Location", KindText, "", 0),
	}
	var dur float64
	for i := range req.Devices {
		for _, p := range as[i].Idles {
			row := deviceRow(&req.Devices[i])
			d := p.End.Sub(p.Start).Seconds()
			row["start"], row["end"], row["duration"] = p.Start.UTC(), p.End.UTC(), secs(d)
			row["lat"], row["lng"] = p.Lat, p.Lng
			row["address"] = addr(p.Lat, p.Lng)
			rep.Rows = append(rep.Rows, row)
			dur += d
		}
	}
	sortRows(rep.Rows, "start")
	rep.Totals = map[string]any{"duration": secs(dur)}
	return nil
}

func (e *Engine) ignition(ctx context.Context, req Request, rep *Report) error {
	as, err := e.analyzeAll(ctx, req.Devices, req.From, req.To, req.Loc)
	if err != nil {
		return err
	}
	rep.Columns = []Column{colDevice,
		col("on", "Ignition on", KindDatetime, "", 0),
		col("off", "Ignition off", KindDatetime, "", 0),
		col("duration", "Duration", KindDuration, "", 0),
		col("distance", "Distance", KindNumber, "km", 2),
	}
	var dur, dist float64
	for i := range req.Devices {
		for _, p := range as[i].Ignitions {
			row := deviceRow(&req.Devices[i])
			d := p.End.Sub(p.Start).Seconds()
			row["on"] = p.Start.UTC()
			row["off"] = nil
			if !p.Open {
				row["off"] = p.End.UTC()
			}
			row["duration"], row["distance"] = secs(d), km(p.Distance)
			rep.Rows = append(rep.Rows, row)
			dur += d
			dist += p.Distance
		}
	}
	sortRows(rep.Rows, "on")
	rep.Totals = map[string]any{"duration": secs(dur), "distance": km(dist)}
	return nil
}

// ---- event based reports ----

func (e *Engine) deviceIndex(devs []store.Device) map[int64]*store.Device {
	m := make(map[int64]*store.Device, len(devs))
	for i := range devs {
		m[devs[i].ID] = &devs[i]
	}
	return m
}

func (e *Engine) overspeed(ctx context.Context, req Request, rep *Report) error {
	evs, err := e.st.ReportEvents(ctx, deviceIDs(req.Devices), []string{store.EventOverspeed}, req.From, req.To, MaxRows+1, true)
	if err != nil {
		return err
	}
	dx, err := e.drivers(ctx)
	if err != nil {
		return err
	}
	pts := make([]geocode.Point, len(evs))
	for i, ev := range evs {
		pts[i] = geocode.Point{Lat: ev.Lat, Lng: ev.Lng}
	}
	addr := e.resolver(ctx, pts)
	devs := e.deviceIndex(req.Devices)
	rep.Columns = []Column{colDevice, colDriver,
		col("time", "Time", KindDatetime, "", 0),
		col("speed", "Speed", KindSpeed, "km/h", 0),
		col("limit", "Limit", KindSpeed, "km/h", 0),
		col("maxSpeed", "Max speed", KindSpeed, "km/h", 0),
		col("address", "Location", KindText, "", 0),
	}
	var maxSpeed float64
	for _, ev := range evs {
		d := devs[ev.DeviceID]
		drv := dx.resolve(ev.DeviceID, ev.DriverTag)
		if d == nil || (req.DriverID != 0 && (drv == nil || drv.ID != req.DriverID)) {
			continue
		}
		row := deviceRow(d)
		row["eventId"] = ev.ID
		row["driverId"], row["driver"] = driverIDValue(drv), driverName(drv)
		row["time"] = ev.Time
		row["speed"] = numAttr(ev.Attributes, "speed")
		row["limit"] = numAttr(ev.Attributes, "limit")
		ms := numAttr(ev.Attributes, "maxSpeed")
		if ms == nil {
			ms = row["speed"]
		}
		row["maxSpeed"] = ms
		if v, ok := ms.(float64); ok {
			maxSpeed = max(maxSpeed, v)
		}
		row["lat"], row["lng"] = ev.Lat, ev.Lng
		row["address"] = addr(ev.Lat, ev.Lng)
		rep.Rows = append(rep.Rows, row)
	}
	rep.Totals = map[string]any{"maxSpeed": maxSpeed}
	return nil
}

func numAttr(attrs map[string]any, key string) any {
	switch v := attrs[key].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	}
	return nil
}

func (e *Engine) geofence(ctx context.Context, req Request, rep *Report) error {
	evs, err := e.st.ReportEvents(ctx, deviceIDs(req.Devices),
		[]string{store.EventGeofenceEnter, store.EventGeofenceExit}, req.From, req.To, 4*MaxRows, false)
	if err != nil {
		return err
	}
	devs := e.deviceIndex(req.Devices)
	rep.Columns = []Column{colDevice,
		col("geofence", "Geofence", KindText, "", 0),
		col("enter", "Enter", KindDatetime, "", 0),
		col("exit", "Exit", KindDatetime, "", 0),
		col("duration", "Duration", KindDuration, "", 0),
	}
	type key struct {
		dev  int64
		name string
		id   int64
	}
	open := map[key]Row{}
	end := minTime(req.To, req.Now)
	newRow := func(d *store.Device, ev *store.ReportEvent) Row {
		row := deviceRow(d)
		row["geofenceId"], row["geofence"] = ev.GeofenceID, ev.GeofenceName
		return row
	}
	for i := range evs {
		ev := &evs[i]
		d := devs[ev.DeviceID]
		if d == nil {
			continue
		}
		k := key{dev: ev.DeviceID, name: ev.GeofenceName}
		if ev.GeofenceID != nil {
			k = key{dev: ev.DeviceID, id: *ev.GeofenceID}
		}
		if ev.Type == store.EventGeofenceEnter {
			if prev := open[k]; prev != nil { // missed exit: the visit lasted until this enter
				prev["duration"] = secs(ev.Time.Sub(prev["enter"].(time.Time)).Seconds())
			}
			row := newRow(d, ev)
			row["enter"], row["exit"] = ev.Time, nil
			row["duration"] = secs(max(0, end.Sub(ev.Time).Seconds())) // still inside
			open[k] = row
			rep.Rows = append(rep.Rows, row)
			continue
		}
		if row := open[k]; row != nil {
			row["exit"] = ev.Time
			row["duration"] = secs(ev.Time.Sub(row["enter"].(time.Time)).Seconds())
			delete(open, k)
			continue
		}
		// Exit without an enter in range: inside since before the period.
		row := newRow(d, ev)
		row["enter"], row["exit"] = nil, ev.Time
		row["duration"] = secs(max(0, ev.Time.Sub(req.From).Seconds()))
		rep.Rows = append(rep.Rows, row)
	}
	var dur float64
	for _, row := range rep.Rows {
		dur += row["duration"].(float64)
	}
	rep.Totals = map[string]any{"duration": dur}
	return nil
}

func (e *Engine) alerts(ctx context.Context, req Request, rep *Report) error {
	types := make([]string, 0, len(store.EventTypes))
	for _, t := range store.EventTypes {
		if t != store.EventCommandResult {
			types = append(types, t)
		}
	}
	evs, err := e.st.ReportEvents(ctx, deviceIDs(req.Devices), types, req.From, req.To, MaxRows+1, false)
	if err != nil {
		return err
	}
	pts := make([]geocode.Point, len(evs))
	for i, ev := range evs {
		pts[i] = geocode.Point{Lat: ev.Lat, Lng: ev.Lng}
	}
	addr := e.resolver(ctx, pts)
	devs := e.deviceIndex(req.Devices)
	rep.Columns = []Column{colDevice,
		col("time", "Time", KindDatetime, "", 0),
		col("type", "Type", KindText, "", 0),
		col("message", "Message", KindText, "", 0),
		col("address", "Location", KindText, "", 0),
	}
	for _, ev := range evs {
		d := devs[ev.DeviceID]
		if d == nil {
			continue
		}
		row := deviceRow(d)
		row["eventId"] = ev.ID
		row["time"], row["type"], row["message"] = ev.Time, ev.Type, ev.Message
		row["lat"], row["lng"] = ev.Lat, ev.Lng
		row["address"] = addr(ev.Lat, ev.Lng)
		rep.Rows = append(rep.Rows, row)
	}
	return nil
}

// ---- driver behaviour ----

type driverAgg struct {
	ref                    *store.DriverRef
	device                 *store.Device // bucket for driving without a known driver
	distance, driving, idl float64
	over, acc, brake, corn int
}

func (g *driverAgg) name() string {
	if g.ref != nil {
		return g.ref.Name
	}
	return g.device.Name
}

func (g *driverAgg) harsh() int { return g.acc + g.brake + g.corn }

func (g *driverAgg) score(harshScoring bool) float64 {
	h := 0
	if harshScoring {
		h = g.harsh()
	}
	return round(Score(g.distance/1000, g.over, h, g.idl/3600), 1)
}

// driverAggregates attributes driving and behaviour events to drivers.
func (e *Engine) driverAggregates(ctx context.Context, devs []store.Device, as []*Analysis, from, to time.Time) ([]*driverAgg, error) {
	dx, err := e.drivers(ctx)
	if err != nil {
		return nil, err
	}
	aggs := map[string]*driverAgg{}
	get := func(dev *store.Device, tag string) *driverAgg {
		ref := dx.resolve(dev.ID, tag)
		k := fmt.Sprintf("v%d", dev.ID)
		if ref != nil {
			k = fmt.Sprintf("d%d", ref.ID)
		}
		g := aggs[k]
		if g == nil {
			g = &driverAgg{ref: ref, device: dev}
			aggs[k] = g
		}
		return g
	}
	for i := range devs {
		for tag, st := range as[i].Drivers {
			g := get(&devs[i], tag)
			g.distance += st.Distance
			g.driving += st.Driving
			g.idl += st.Idle
		}
	}
	types := append([]string{store.EventOverspeed}, store.HarshEventTypes...)
	evs, err := e.st.ReportEvents(ctx, deviceIDs(devs), types, from, to, 20*MaxRows, true)
	if err != nil {
		return nil, err
	}
	idx := e.deviceIndex(devs)
	for _, ev := range evs {
		d := idx[ev.DeviceID]
		if d == nil {
			continue
		}
		g := get(d, ev.DriverTag)
		switch ev.Type {
		case store.EventOverspeed:
			g.over++
		case store.EventHarshAcceleration:
			g.acc++
		case store.EventHarshBraking:
			g.brake++
		case store.EventHarshCornering:
			g.corn++
		}
	}
	out := make([]*driverAgg, 0, len(aggs))
	for _, g := range aggs {
		if g.distance == 0 && g.driving == 0 && g.idl == 0 && g.over == 0 && g.harsh() == 0 {
			continue
		}
		out = append(out, g)
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := strings.ToLower(out[i].name()), strings.ToLower(out[j].name())
		if a != b {
			return a < b
		}
		return out[i].device.ID < out[j].device.ID
	})
	return out, nil
}

// ScoreFormula documents the driver score.
const ScoreFormula = "Score = 100 − (overspeeds×5 + harsh events×3 + idle hours×2) per 100 km driven, clamped to 0–100 (distances under 10 km count as 10 km)."

func (e *Engine) driver(ctx context.Context, req Request, rep *Report) error {
	as, err := e.analyzeAll(ctx, req.Devices, req.From, req.To, req.Loc)
	if err != nil {
		return err
	}
	aggs, err := e.driverAggregates(ctx, req.Devices, as, req.From, req.To)
	if err != nil {
		return err
	}
	harshScoring := e.st.Settings().HarshScoring
	rep.Subtitle = ScoreFormula
	if !harshScoring {
		rep.Subtitle += " Harsh events are not scored (harshScoring off)."
	}
	rep.Columns = []Column{colDriver,
		col("distance", "Distance", KindNumber, "km", 2),
		col("drivingTime", "Driving time", KindDuration, "", 0),
		col("overspeeds", "Overspeeds", KindNumber, "", 0),
		col("harshAcceleration", "Harsh accel.", KindNumber, "", 0),
		col("harshBraking", "Harsh braking", KindNumber, "", 0),
		col("harshCornering", "Harsh cornering", KindNumber, "", 0),
		col("idleTime", "Idle time", KindDuration, "", 0),
		col("score", "Score", KindNumber, "", 1),
	}
	var dist, drive, idl float64
	var over, acc, brk, crn int
	for _, g := range aggs {
		if req.DriverID != 0 && (g.ref == nil || g.ref.ID != req.DriverID) {
			continue
		}
		row := Row{"driverId": driverIDValue(g.ref), "driver": g.name()}
		if g.ref == nil {
			row["deviceId"] = g.device.ID
		}
		row["distance"] = km(g.distance)
		row["drivingTime"] = secs(g.driving)
		row["overspeeds"] = g.over
		row["harshAcceleration"], row["harshBraking"], row["harshCornering"] = g.acc, g.brake, g.corn
		row["idleTime"] = secs(g.idl)
		row["score"] = g.score(harshScoring)
		rep.Rows = append(rep.Rows, row)
		dist += g.distance
		drive += g.driving
		idl += g.idl
		over += g.over
		acc += g.acc
		brk += g.brake
		crn += g.corn
	}
	rep.Totals = map[string]any{"distance": km(dist), "drivingTime": secs(drive), "overspeeds": over,
		"harshAcceleration": acc, "harshBraking": brk, "harshCornering": crn, "idleTime": secs(idl)}
	return nil
}

// ---- management data ----

func (e *Engine) expenses(ctx context.Context, req Request, rep *Report) error {
	fromDate, toDate := req.From.In(req.Loc), req.To.In(req.Loc)
	exps, err := e.st.Expenses(ctx, store.Scope{DeviceIDs: deviceIDs(req.Devices)}, store.ExpenseFilter{
		From: fromDate.Format(time.DateOnly), To: toDate.Format(time.DateOnly), Limit: MaxRows + 1})
	if err != nil {
		return err
	}
	slices.Reverse(exps) // oldest first
	currency := e.st.Settings().Currency
	devs := e.deviceIndex(req.Devices)
	rep.Columns = []Column{
		col("date", "Date", KindText, "", 0),
		colDevice,
		col("category", "Category", KindText, "", 0),
		col("amount", "Amount", KindMoney, currency, 2),
		col("liters", "Liters", KindNumber, "L", 2),
		col("notes", "Notes", KindText, "", 0),
	}
	type sub struct{ amount, liters float64 }
	byCat := map[string]*sub{}
	var amount, liters float64
	for _, x := range exps {
		d := devs[x.DeviceID]
		if d == nil || (req.DriverID != 0 && (x.DriverID == nil || *x.DriverID != req.DriverID)) {
			continue
		}
		row := deviceRow(d)
		row["expenseId"] = x.ID
		row["driverId"] = x.DriverID
		row["date"] = x.Date
		row["category"] = x.Category
		row["amount"] = round(x.Amount, 2)
		row["liters"] = nil
		if x.Liters != nil {
			row["liters"] = round(*x.Liters, 2)
			liters += *x.Liters
		}
		row["notes"] = x.Notes
		rep.Rows = append(rep.Rows, row)
		amount += x.Amount
		s := byCat[x.Category]
		if s == nil {
			s = &sub{}
			byCat[x.Category] = s
		}
		s.amount += x.Amount
		if x.Liters != nil {
			s.liters += *x.Liters
		}
	}
	rep.Totals = map[string]any{"amount": round(amount, 2), "liters": round(liters, 2)}
	cats := make([]string, 0, len(byCat))
	for c := range byCat {
		cats = append(cats, c)
	}
	sort.Strings(cats)
	for _, c := range cats {
		rep.Subtotals = append(rep.Subtotals, Subtotal{Label: c,
			Values: map[string]any{"amount": round(byCat[c].amount, 2), "liters": round(byCat[c].liters, 2)}})
	}
	return nil
}

func (e *Engine) maintenance(ctx context.Context, req Request, rep *Report) error {
	rep.Columns = []Column{colDevice,
		col("item", "Item", KindText, "", 0),
		col("status", "Status", KindText, "", 0),
		col("nextDue", "Next due", KindText, "", 0),
		col("remaining", "Remaining", KindText, "", 0),
		col("lastService", "Last service", KindText, "", 0),
	}
	items, err := e.st.MaintenanceList(ctx, store.Scope{DeviceIDs: deviceIDs(req.Devices)}, 0)
	if err != nil {
		return err
	}
	devs := e.deviceIndex(req.Devices)
	for _, it := range items {
		d := devs[it.DeviceID]
		if d == nil {
			continue
		}
		row := deviceRow(d)
		row["maintenanceId"] = it.ID
		row["item"], row["status"], row["lastService"] = it.Name, it.Status, it.LastServiceDate
		var next, rem []string
		if it.NextDueKm != nil {
			next = append(next, fmt.Sprintf("%.0f km", *it.NextDueKm))
		}
		if it.NextDueDate != nil {
			next = append(next, *it.NextDueDate)
		}
		if it.NextDueHours != nil {
			next = append(next, fmt.Sprintf("%.0f h", *it.NextDueHours))
		}
		if it.RemainingKm != nil {
			rem = append(rem, fmt.Sprintf("%.0f km", *it.RemainingKm))
		}
		if it.RemainingDays != nil {
			rem = append(rem, fmt.Sprintf("%d days", *it.RemainingDays))
		}
		if it.RemainingHours != nil {
			rem = append(rem, fmt.Sprintf("%.0f h", *it.RemainingHours))
		}
		row["nextDue"], row["remaining"] = strings.Join(next, " · "), strings.Join(rem, " · ")
		row["nextDueKm"], row["nextDueDate"], row["nextDueHours"] = it.NextDueKm, it.NextDueDate, it.NextDueHours
		row["remainingKm"], row["remainingDays"], row["remainingHours"] = it.RemainingKm, it.RemainingDays, it.RemainingHours
		rep.Rows = append(rep.Rows, row)
	}
	return nil
}

// ---- system log ----

func (e *Engine) systemLog(ctx context.Context, req Request, rep *Report) error {
	rep.Subtitle = "Gaps are periods over 30 minutes without data, by server arrival time."
	rep.Columns = []Column{colDevice,
		col("packets", "Packets", KindNumber, "", 0),
		col("firstPacket", "First packet", KindDatetime, "", 0),
		col("lastPacket", "Last packet", KindDatetime, "", 0),
		col("gaps", "Gaps > 30 min", KindNumber, "", 0),
		col("longestGap", "Longest gap", KindDuration, "", 0),
		col("avgInterval", "Avg interval", KindDuration, "", 0),
	}
	logs := make([]SystemLog, len(req.Devices))
	var (
		wg   sync.WaitGroup
		mu   sync.Mutex
		ferr error
		sem  = make(chan struct{}, parallelism)
	)
	for i := range req.Devices {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer wg.Done()
			defer func() { <-sem }()
			if err := e.st.StreamServerTimes(ctx, req.Devices[i].ID, req.From, req.To, logs[i].Add); err != nil {
				mu.Lock()
				ferr = err
				mu.Unlock()
			}
		}(i)
	}
	wg.Wait()
	if ferr != nil {
		return ferr
	}
	var packets, gaps int
	for i := range req.Devices {
		l := &logs[i]
		row := deviceRow(&req.Devices[i])
		row["packets"], row["gaps"] = l.Packets, l.Gaps
		row["firstPacket"], row["lastPacket"] = timePtr(l.First), timePtr(l.Last)
		row["longestGap"] = secs(l.LongestGap)
		row["avgInterval"] = round(l.AvgInterval(), 1)
		rep.Rows = append(rep.Rows, row)
		packets += l.Packets
		gaps += l.Gaps
	}
	rep.Totals = map[string]any{"packets": packets, "gaps": gaps}
	return nil
}

// sortRows orders rows by a time column (stable, so device order is kept
// for equal times).
func sortRows(rows []Row, key string) {
	sort.SliceStable(rows, func(i, j int) bool {
		a, _ := rows[i][key].(time.Time)
		b, _ := rows[j][key].(time.Time)
		return a.Before(b)
	})
}
