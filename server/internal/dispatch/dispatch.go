// Package dispatch implements jobs (dispatch), automatic stop tracking from
// vehicle positions, late-job detection and route (path) deviation alerts
// (Phase 4a). Persistence lives in the store; this package owns the side
// effects: live "job" messages, timeline-derived events and the in-memory
// snapshots the ingest-path rules read.
package dispatch

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// Emitter persists, publishes and notifies events (*events.Engine).
type Emitter interface {
	Emit(ctx context.Context, deviceName string, evs ...store.Event)
}

// storeEmitter persists events without notifications (used when no engine
// is configured, e.g. in tests).
type storeEmitter struct{ st *store.Store }

func (e storeEmitter) Emit(ctx context.Context, _ string, evs ...store.Event) {
	_ = e.st.InsertEvents(ctx, evs)
}

// Service is the dispatch service. It is safe for concurrent use.
type Service struct {
	st      *store.Store
	emit    Emitter
	log     *slog.Logger
	dataDir string
	now     func() time.Time

	// LateInterval is how often the late check (and a snapshot refresh) runs.
	LateInterval time.Duration

	refreshMu sync.Mutex
	snap      atomic.Pointer[snapshot]

	routeMu    sync.Mutex
	routeState map[routeKey]*deviationState
}

// snapshot is what the ingest-path rules read.
type snapshot struct {
	jobsByDevice   map[int64][]store.Job    // tracked jobs by tracking device
	routesByDevice map[int64][]*store.Route // monitored routes by device
}

// Options configures the service.
type Options struct {
	// DataDir holds uploaded files (attachments/ below it).
	DataDir string
	Logger  *slog.Logger
	// Emitter persists and notifies events; defaults to storing them only.
	Emitter Emitter
}

// New returns a service. Call Refresh before positions start flowing.
func New(st *store.Store, opts Options) *Service {
	if opts.Logger == nil {
		opts.Logger = slog.New(slog.DiscardHandler)
	}
	if opts.DataDir == "" {
		opts.DataDir = "data"
	}
	if opts.Emitter == nil {
		opts.Emitter = storeEmitter{st}
	}
	s := &Service{st: st, emit: opts.Emitter, log: opts.Logger, dataDir: opts.DataDir, now: time.Now,
		LateInterval: time.Minute, routeState: map[routeKey]*deviationState{}}
	s.snap.Store(&snapshot{jobsByDevice: map[int64][]store.Job{}, routesByDevice: map[int64][]*store.Route{}})
	return s
}

// SetEmitter replaces the emitter (wiring order in main).
func (s *Service) SetEmitter(e Emitter) { s.emit = e }

// DataDir returns the upload directory root.
func (s *Service) DataDir() string { return s.dataDir }

// Store returns the underlying store.
func (s *Service) Store() *store.Store { return s.st }

// TrackingDevice resolves the vehicle whose positions drive a job: the
// job's vehicle, else the driver's assigned vehicle, else the driver's
// driver-app phone. 0 when none.
func (s *Service) TrackingDevice(j *store.Job) int64 {
	if j.DeviceID != nil {
		return *j.DeviceID
	}
	if j.DriverID == nil {
		return 0
	}
	if d := s.st.AssignedDevice(*j.DriverID); d != 0 {
		return d
	}
	if d, ok := s.st.DeviceIDByIMEI(store.DriverAppIMEI(*j.DriverID)); ok {
		return d
	}
	return 0
}

// routeActive reports whether a job's route is monitored.
func routeActive(status string) bool {
	switch status {
	case store.JobAccepted, store.JobEnRoute, store.JobArrived, store.JobInProgress:
		return true
	}
	return false
}

// Refresh rebuilds the rule snapshots from the database.
func (s *Service) Refresh(ctx context.Context) error {
	s.refreshMu.Lock()
	defer s.refreshMu.Unlock()
	jobs, err := s.st.TrackedJobs(ctx)
	if err != nil {
		return fmt.Errorf("load tracked jobs: %w", err)
	}
	routes, err := s.st.Routes(ctx)
	if err != nil {
		return fmt.Errorf("load routes: %w", err)
	}
	next := &snapshot{jobsByDevice: map[int64][]store.Job{}, routesByDevice: map[int64][]*store.Route{}}
	byID := map[int64]*store.Route{}
	for i := range routes {
		r := &routes[i]
		byID[r.ID] = r
		for _, d := range r.DeviceIDs {
			next.routesByDevice[d] = append(next.routesByDevice[d], r)
		}
	}
	for _, j := range jobs {
		dev := s.TrackingDevice(&j)
		if dev == 0 {
			continue
		}
		next.jobsByDevice[dev] = append(next.jobsByDevice[dev], j)
		if j.RouteID != nil && routeActive(j.Status) {
			if r := byID[*j.RouteID]; r != nil && !slices.Contains(next.routesByDevice[dev], r) {
				next.routesByDevice[dev] = append(next.routesByDevice[dev], r)
			}
		}
	}
	s.snap.Store(next)
	s.pruneRouteState(next)
	return nil
}

func (s *Service) refresh(ctx context.Context) {
	if err := s.Refresh(context.WithoutCancel(ctx)); err != nil {
		s.log.Error("dispatch: refresh", "err", err)
	}
}

// MonitoredRoutes returns the routes monitored for a device (tests, UI).
func (s *Service) MonitoredRoutes(deviceID int64) []store.Route {
	var out []store.Route
	for _, r := range s.snap.Load().routesByDevice[deviceID] {
		out = append(out, *r)
	}
	return out
}

// publish sends the live "job" message.
func (s *Service) publish(j store.Job) { s.st.Publish(store.EventJob, j) }

// after handles the side effects of a job mutation: live update, snapshot
// refresh and events.
func (s *Service) after(ctx context.Context, ch store.JobChange, reason string) {
	s.publish(ch.Job)
	s.refresh(ctx)
	j := &ch.Job
	if ch.Assigned && j.DriverID != nil {
		name := ""
		if d, err := s.st.Driver(ctx, *j.DriverID); err == nil {
			name = d.Name
		}
		s.event(ctx, j, store.EventJobAssigned, fmt.Sprintf("%s %s assigned to %s", j.Reference, j.Title, name),
			map[string]any{"driverId": *j.DriverID, "driverName": name}, nil)
	} else if ch.StatusChange && ch.StopArrived == nil {
		attrs := map[string]any{"previousStatus": ch.PrevStatus}
		if reason != "" {
			attrs["reason"] = reason
		}
		s.event(ctx, j, store.EventJobStatus, fmt.Sprintf("%s %s is now %s", j.Reference, j.Title, StatusLabel(j.Status)), attrs, nil)
	}
	if st := ch.StopArrived; st != nil {
		s.event(ctx, j, store.EventJobStopArrived, fmt.Sprintf("%s arrived at %s (%s)", j.Reference, st.Name, j.Title),
			map[string]any{"stopId": st.ID, "stopName": st.Name}, &[2]float64{st.Lng, st.Lat})
	}
}

// StatusLabel is a human readable job status.
func StatusLabel(status string) string {
	switch status {
	case store.JobEnRoute:
		return "en route"
	case store.JobInProgress:
		return "in progress"
	}
	return status
}

// jobEvent builds a job event on the job's tracking device; ok is false when
// the job has no device (events need one).
func (s *Service) jobEvent(j *store.Job, typ, msg string, attrs map[string]any, at *[2]float64, t time.Time) (store.Event, string, bool) {
	devID := s.TrackingDevice(j)
	if devID == 0 {
		return store.Event{}, "", false
	}
	dev, err := s.st.Device(devID)
	if err != nil {
		return store.Event{}, "", false
	}
	if attrs == nil {
		attrs = map[string]any{}
	}
	attrs["jobId"], attrs["reference"], attrs["status"], attrs["title"] = j.ID, j.Reference, j.Status, j.Title
	ev := store.Event{DeviceID: devID, Type: typ, Time: t, Attributes: attrs, Message: dev.Name + ": " + msg}
	if at != nil {
		ev.Lng, ev.Lat = at[0], at[1]
	} else if p := dev.Position; p != nil {
		ev.Lat, ev.Lng = p.Latitude, p.Longitude
	}
	return ev, dev.Name, true
}

func (s *Service) event(ctx context.Context, j *store.Job, typ, msg string, attrs map[string]any, at *[2]float64) {
	if ev, name, ok := s.jobEvent(j, typ, msg, attrs, at, s.now().UTC()); ok {
		s.emit.Emit(context.WithoutCancel(ctx), name, ev)
	}
}

// CreateJob creates a job (actor = user id).
func (s *Service) CreateJob(ctx context.Context, in store.JobInput, actor int64) (store.Job, error) {
	ch, err := s.st.CreateJob(ctx, in, actor)
	if err != nil {
		return store.Job{}, err
	}
	s.after(ctx, ch, "")
	return ch.Job, nil
}

// UpdateJob applies a manager edit.
func (s *Service) UpdateJob(ctx context.Context, id int64, p store.JobPatch, actor int64) (store.Job, error) {
	ch, err := s.st.UpdateJob(ctx, id, p, actor)
	if err != nil {
		return store.Job{}, err
	}
	s.after(ctx, ch, "")
	return ch.Job, nil
}

// SetStatus changes a job's status (byDriver selects the driver transition table).
func (s *Service) SetStatus(ctx context.Context, id int64, status, reason string, actor int64, byDriver bool, data map[string]any) (store.Job, error) {
	ch, err := s.st.SetJobStatus(ctx, id, status, reason, actor, byDriver, data)
	if err != nil {
		return store.Job{}, err
	}
	s.after(ctx, ch, reason)
	return ch.Job, nil
}

// UpdateStop is a driver's stop update.
func (s *Service) UpdateStop(ctx context.Context, jobID, stopID int64, status string, notes *string, actor int64, data map[string]any) (store.Job, error) {
	ch, err := s.st.UpdateJobStop(ctx, jobID, stopID, status, notes, actor, data)
	if err != nil {
		return store.Job{}, err
	}
	s.after(ctx, ch, "")
	return ch.Job, nil
}

// SetChecklist marks a checklist item.
func (s *Service) SetChecklist(ctx context.Context, jobID, itemID int64, done bool, actor int64) (store.Job, error) {
	ch, err := s.st.SetChecklistItem(ctx, jobID, itemID, done, actor)
	if err != nil {
		return store.Job{}, err
	}
	s.after(ctx, ch, "")
	return ch.Job, nil
}

// AddNote adds a timeline note.
func (s *Service) AddNote(ctx context.Context, jobID int64, text string, actor int64) (store.Job, error) {
	ch, err := s.st.AddJobNote(ctx, jobID, text, actor)
	if err != nil {
		return store.Job{}, err
	}
	s.after(ctx, ch, "")
	return ch.Job, nil
}

// AddAttachment records an uploaded file.
func (s *Service) AddAttachment(ctx context.Context, a store.Attachment) (store.Attachment, error) {
	out, ch, err := s.st.AddAttachment(ctx, a)
	if err != nil {
		return out, err
	}
	s.after(ctx, ch, "")
	return out, nil
}

// DeleteJob removes a job and its files.
func (s *Service) DeleteJob(ctx context.Context, id int64) error {
	j, err := s.st.DeleteJob(ctx, id)
	if err != nil {
		return err
	}
	if err := os.RemoveAll(s.JobDir(id)); err != nil {
		s.log.Warn("dispatch: remove job files", "job", id, "err", err)
	}
	s.st.Publish(store.EventJobDeleted, store.NewJobDeleted(j))
	s.refresh(ctx)
	return nil
}

// JobDir is the directory of a job's uploaded files.
func (s *Service) JobDir(jobID int64) string {
	return filepath.Join(s.dataDir, "attachments", fmt.Sprint(jobID))
}

// CreateRoute, UpdateRoute and DeleteRoute wrap the store and refresh the
// monitoring snapshot.
func (s *Service) CreateRoute(ctx context.Context, in store.RouteInput) (store.Route, error) {
	r, err := s.st.CreateRoute(ctx, in)
	if err == nil {
		s.refresh(ctx)
	}
	return r, err
}

// UpdateRoute updates a route.
func (s *Service) UpdateRoute(ctx context.Context, id int64, p store.RoutePatch) (store.Route, error) {
	r, err := s.st.UpdateRoute(ctx, id, p)
	if err == nil {
		s.refresh(ctx)
	}
	return r, err
}

// DeleteRoute deletes a route; jobs using it lose their routeId.
func (s *Service) DeleteRoute(ctx context.Context, id int64) error {
	jobs, _ := s.st.Jobs(ctx, store.JobFilter{Scope: store.Scope{All: true}, Limit: 100_000})
	err := s.st.DeleteRoute(ctx, id)
	if err != nil {
		return err
	}
	for _, j := range jobs {
		if j.RouteID != nil && *j.RouteID == id {
			if nj, err := s.st.Job(ctx, j.ID); err == nil {
				s.publish(nj)
			}
		}
	}
	s.refresh(ctx)
	return nil
}

// Run performs the late check every LateInterval (refreshing the rule
// snapshot too, so driver re-assignments are picked up) until ctx ends.
func (s *Service) Run(ctx context.Context) {
	t := time.NewTicker(s.LateInterval)
	defer t.Stop()
	for {
		if err := s.CheckLate(ctx); err != nil && ctx.Err() == nil {
			s.log.Error("dispatch: late check", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.refresh(ctx)
		}
	}
}

// CheckLate emits jobLate once for each unfinished job past its dueBy.
func (s *Service) CheckLate(ctx context.Context) error {
	jobs, err := s.st.LateJobs(ctx)
	for i := range jobs {
		j := &jobs[i]
		s.publish(*j)
		s.event(ctx, j, store.EventJobLate, fmt.Sprintf("%s %s is late (due %s)", j.Reference, j.Title,
			j.DueBy.UTC().Format("2006-01-02 15:04 UTC")), map[string]any{"dueBy": j.DueBy}, nil)
	}
	return err
}
