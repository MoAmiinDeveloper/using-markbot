package reports

import (
	"sort"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// Thresholds of the analysis (see docs/API.md, Reports).
const (
	MinStop        = 5 * time.Minute  // stops report: stationary at least this long
	MinIdle        = 3 * time.Minute  // idle report: ignition on, not moving, at least this long
	MaxMovingGap   = 5 * time.Minute  // a longer gap after a moving fix counts as stopped
	SystemLogGap   = 30 * time.Minute // systemLog: a gap is this long without data
	minScoreKm     = 10.0             // driver score: shorter distances count as this
	movingSpeedKmh = store.MovingSpeed
)

// Segment states.
const (
	stDriving = iota
	stIdle
	stStopped
)

// Trip is a detected trip with the driver tag seen during it.
type Trip struct {
	store.Trip
	DriverTag string
}

// Stop is a stationary period between trips.
type Stop struct {
	Start, End time.Time
	Lat, Lng   float64
	Idle       float64 // seconds with ignition on during the stop
	Ongoing    bool    // still stopped at the end of the data
}

// Duration is the stop length in seconds.
func (s Stop) Duration() float64 { return s.End.Sub(s.Start).Seconds() }

// Period is an idle period or an ignition-on span.
type Period struct {
	Start, End time.Time
	Lat, Lng   float64
	Distance   float64 // meters (ignition spans)
	Open       bool    // not closed within the data (ignition still on)
}

// DayStats aggregates one calendar day (in the report time zone).
type DayStats struct {
	Date       time.Time // midnight, report location
	Distance   float64   // meters
	Driving    float64   // seconds
	Idle       float64   // seconds
	FirstStart *time.Time
	LastStop   *time.Time
	MaxSpeed   float64
}

// DriverStats aggregates driving per driver tag ("" = no tag reported).
type DriverStats struct {
	Distance float64 // meters
	Driving  float64 // seconds
	Idle     float64 // seconds
	Trips    int
}

// Analysis is the result of one pass over a device's positions.
type Analysis struct {
	Points    int
	First     *store.ReportPoint
	Last      *store.ReportPoint
	Trips     []Trip
	Stops     []Stop
	Idles     []Period // idle periods ≥ MinIdle
	Ignitions []Period // ignition on→off spans
	Days      []*DayStats
	Drivers   map[string]*DriverStats

	Distance float64 // meters, sum of trips
	Driving  float64 // seconds moving
	Idle     float64 // seconds ignition on, not moving
	Stopped  float64 // seconds stationary with ignition off/unknown (incl. long gaps)
	Engine   float64 // seconds with ignition on (or moving when ignition is unknown)
	MaxSpeed float64 // km/h, valid fixes
	FuelUsed *float64
}

// Analyzer consumes a device's positions in ascending time order.
type Analyzer struct {
	loc *time.Location
	a   Analysis

	det      store.TripDetector
	tripTags []tagAt // driver tags with times, to label trips

	prev    store.ReportPoint
	hasPrev bool
	ign     *bool // last known ignition
	tag     string

	idleRun   *Period // current idle run
	ignSpan   *Period
	fuelFirst *float64
	fuelLast  *float64

	days    map[int64]*DayStats // key: unix seconds of local midnight
	idleSum []Period            // every idle run (any length), for stop ignition
}

type tagAt struct {
	t   time.Time
	tag string
}

// NewAnalyzer returns an analyzer bucketing days in loc (UTC if nil).
func NewAnalyzer(loc *time.Location) *Analyzer {
	if loc == nil {
		loc = time.UTC
	}
	return &Analyzer{loc: loc, days: map[int64]*DayStats{}, a: Analysis{Drivers: map[string]*DriverStats{}}}
}

func (z *Analyzer) day(t time.Time) *DayStats {
	lt := t.In(z.loc)
	mid := time.Date(lt.Year(), lt.Month(), lt.Day(), 0, 0, 0, 0, z.loc)
	k := mid.Unix()
	d := z.days[k]
	if d == nil {
		d = &DayStats{Date: mid}
		z.days[k] = d
	}
	return d
}

func (z *Analyzer) driver(tag string) *DriverStats {
	d := z.a.Drivers[tag]
	if d == nil {
		d = &DriverStats{}
		z.a.Drivers[tag] = d
	}
	return d
}

// Add feeds the next position.
func (z *Analyzer) Add(p *store.ReportPoint) {
	z.a.Points++
	if z.a.First == nil {
		cp := *p
		z.a.First = &cp
	}
	prevIgn := z.ign // ignition known at the previous fix
	if p.Ignition != nil {
		v := *p.Ignition
		z.ign = &v
	}
	ignOn := z.ign != nil && *z.ign
	if p.Driver != z.tag || len(z.tripTags) == 0 {
		z.tag = p.Driver
		z.tripTags = append(z.tripTags, tagAt{p.Time, p.Driver})
	}
	if p.FuelUsed != nil {
		v := *p.FuelUsed
		if z.fuelFirst == nil {
			z.fuelFirst = &v
		}
		z.fuelLast = &v
	}
	if p.Valid {
		z.a.MaxSpeed = max(z.a.MaxSpeed, p.Speed)
		dd := z.day(p.Time)
		dd.MaxSpeed = max(dd.MaxSpeed, p.Speed)
		z.det.Add(store.TripPoint{Time: p.Time, Lat: p.Lat, Lng: p.Lng, Speed: p.Speed, Ignition: p.Ignition})
	} else {
		z.day(p.Time) // the day has data
	}

	// Segment prev -> p, classified by the state at prev.
	if z.hasPrev {
		a := &z.prev
		dt := p.Time.Sub(a.Time).Seconds()
		if dt > 0 {
			state := stStopped
			switch {
			case a.Speed > movingSpeedKmh && p.Time.Sub(a.Time) <= MaxMovingGap:
				state = stDriving
			case prevIgn != nil && *prevIgn && a.Speed <= movingSpeedKmh:
				state = stIdle
			}
			dd := z.day(a.Time)
			ds := z.driver(a.Driver)
			switch state {
			case stDriving:
				z.a.Driving += dt
				dd.Driving += dt
				ds.Driving += dt
			case stIdle:
				z.a.Idle += dt
				dd.Idle += dt
				ds.Idle += dt
			default:
				z.a.Stopped += dt
			}
			if (prevIgn != nil && *prevIgn) || (prevIgn == nil && state == stDriving) {
				z.a.Engine += dt
			}
			// Idle runs.
			if state == stIdle {
				if z.idleRun == nil {
					z.idleRun = &Period{Start: a.Time, Lat: a.Lat, Lng: a.Lng}
				}
				z.idleRun.End = p.Time
			} else {
				z.closeIdle()
			}
			// Distance within ignition spans.
			if z.ignSpan != nil && a.Valid && p.Valid {
				z.ignSpan.Distance += store.Haversine(a.Lat, a.Lng, p.Lat, p.Lng)
			}
		}
	}

	// Ignition spans (after the segment, so the span starts at this fix).
	switch {
	case ignOn && z.ignSpan == nil:
		z.ignSpan = &Period{Start: p.Time, End: p.Time, Lat: p.Lat, Lng: p.Lng, Open: true}
	case ignOn:
		z.ignSpan.End = p.Time
	case z.ign != nil && !*z.ign && z.ignSpan != nil:
		z.ignSpan.End, z.ignSpan.Open = p.Time, false
		z.a.Ignitions = append(z.a.Ignitions, *z.ignSpan)
		z.ignSpan = nil
	}

	z.prev, z.hasPrev = *p, true
}

func (z *Analyzer) closeIdle() {
	if z.idleRun == nil {
		return
	}
	r := *z.idleRun
	z.idleRun = nil
	z.idleSum = append(z.idleSum, r)
	if r.End.Sub(r.Start) >= MinIdle {
		z.a.Idles = append(z.a.Idles, r)
	}
}

// Finish ends the pass and returns the analysis.
func (z *Analyzer) Finish() *Analysis {
	a := &z.a
	if z.hasPrev {
		last := z.prev
		a.Last = &last
	}
	z.closeIdle()
	if z.ignSpan != nil {
		a.Ignitions = append(a.Ignitions, *z.ignSpan)
		z.ignSpan = nil
	}
	if z.fuelFirst != nil && *z.fuelLast >= *z.fuelFirst {
		v := *z.fuelLast - *z.fuelFirst
		a.FuelUsed = &v
	}

	// Trips, labelled with the first driver tag reported during the trip.
	ti := 0
	for _, t := range z.det.Trips() {
		for ti+1 < len(z.tripTags) && !z.tripTags[ti+1].t.After(t.Start) {
			ti++
		}
		tag := ""
		for j := ti; j < len(z.tripTags) && !z.tripTags[j].t.After(t.End); j++ {
			if z.tripTags[j].tag != "" {
				tag = z.tripTags[j].tag
				break
			}
		}
		a.Trips = append(a.Trips, Trip{Trip: t, DriverTag: tag})
		a.Distance += t.Distance
		z.driver(tag).Distance += t.Distance
		z.driver(tag).Trips++
		z.splitTrip(t)
	}

	// Stops: the stationary periods around trips.
	if a.First != nil {
		var stops []Stop
		cur := Stop{Start: a.First.Time, Lat: a.First.Lat, Lng: a.First.Lng}
		for _, t := range a.Trips {
			cur.End = t.Start
			stops = append(stops, cur)
			cur = Stop{Start: t.End, Lat: t.EndLat, Lng: t.EndLng}
		}
		cur.End, cur.Ongoing = a.Last.Time, true
		stops = append(stops, cur)
		j := 0
		for _, s := range stops {
			if s.End.Sub(s.Start) < MinStop {
				continue
			}
			for j < len(z.idleSum) && !z.idleSum[j].End.After(s.Start) {
				j++
			}
			for k := j; k < len(z.idleSum) && z.idleSum[k].Start.Before(s.End); k++ {
				lo, hi := maxTime(s.Start, z.idleSum[k].Start), minTime(s.End, z.idleSum[k].End)
				if hi.After(lo) {
					s.Idle += hi.Sub(lo).Seconds()
				}
			}
			a.Stops = append(a.Stops, s)
		}
	}

	for _, d := range z.days {
		a.Days = append(a.Days, d)
	}
	sortDays(a.Days)
	return a
}

// splitTrip spreads a trip's distance over the days it covers (in
// proportion to time) and records first start / last stop per day.
func (z *Analyzer) splitTrip(t store.Trip) {
	start, end := t.Start, t.End
	sd := z.day(start)
	if sd.FirstStart == nil || start.Before(*sd.FirstStart) {
		s := start
		sd.FirstStart = &s
	}
	ed := z.day(end)
	if ed.LastStop == nil || end.After(*ed.LastStop) {
		e := end
		ed.LastStop = &e
	}
	total := end.Sub(start).Seconds()
	if total <= 0 {
		sd.Distance += t.Distance
		return
	}
	for cur := start; cur.Before(end); {
		d := z.day(cur)
		next := d.Date.AddDate(0, 0, 1)
		if next.After(end) {
			next = end
		}
		d.Distance += t.Distance * next.Sub(cur).Seconds() / total
		cur = next
	}
}

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

// SystemLog accumulates packet arrival statistics.
type SystemLog struct {
	Packets     int
	First, Last time.Time
	Gaps        int
	LongestGap  float64 // seconds
}

// Add records one packet arrival (ascending order).
func (l *SystemLog) Add(t time.Time) {
	if l.Packets == 0 {
		l.First = t
	} else {
		gap := t.Sub(l.Last)
		if gap > SystemLogGap {
			l.Gaps++
		}
		l.LongestGap = max(l.LongestGap, gap.Seconds())
	}
	l.Last = t
	l.Packets++
}

// AvgInterval is the mean time between packets in seconds (0 if < 2).
func (l *SystemLog) AvgInterval() float64 {
	if l.Packets < 2 {
		return 0
	}
	return l.Last.Sub(l.First).Seconds() / float64(l.Packets-1)
}

// Score computes the driver score: 100 − (overspeeds×5 + harsh×3 +
// idleHours×2) per 100 km driven, clamped to 0–100. Distances below
// minScoreKm count as minScoreKm so short drives are not over-penalized.
func Score(distanceKm float64, overspeeds, harsh int, idleHours float64) float64 {
	per100 := max(distanceKm, minScoreKm) / 100
	s := 100 - (float64(overspeeds)*5+float64(harsh)*3+idleHours*2)/per100
	return min(100, max(0, s))
}

func sortDays(ds []*DayStats) {
	sort.Slice(ds, func(i, j int) bool { return ds[i].Date.Before(ds[j].Date) })
}
