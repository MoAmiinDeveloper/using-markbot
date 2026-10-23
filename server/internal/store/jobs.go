package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Job statuses (Phase 4a, dispatch).
const (
	JobUnassigned = "unassigned"
	JobAssigned   = "assigned"
	JobAccepted   = "accepted"
	JobEnRoute    = "enRoute"
	JobArrived    = "arrived"
	JobInProgress = "inProgress"
	JobCompleted  = "completed"
	JobFailed     = "failed"
	JobCancelled  = "cancelled"
)

// JobStatuses lists every job status.
var JobStatuses = []string{JobUnassigned, JobAssigned, JobAccepted, JobEnRoute, JobArrived, JobInProgress,
	JobCompleted, JobFailed, JobCancelled}

// Stop statuses.
const (
	StopPending   = "pending"
	StopArrived   = "arrived"
	StopCompleted = "completed"
	StopSkipped   = "skipped"
)

// Job event kinds (timeline).
const (
	JobEvCreated       = "created"
	JobEvAssigned      = "assigned"
	JobEvStatus        = "status"
	JobEvStopArrived   = "stopArrived"
	JobEvStopDeparted  = "stopDeparted"
	JobEvStopCompleted = "stopCompleted"
	JobEvStopSkipped   = "stopSkipped"
	JobEvChecklist     = "checklist"
	JobEvAttachment    = "attachment"
	JobEvNote          = "note"
	JobEvUpdated       = "updated"
	JobEvLate          = "late"
)

// Live event types.
const (
	EventJob        = "job"
	EventJobDeleted = "jobDeleted"
)

// Job limits.
const (
	DefaultStopRadius = 150 // m
	MinStopRadius     = 10
	MaxStopRadius     = 5000
	maxJobStops       = 100
	maxChecklistItems = 100
)

// JobTerminal reports whether a status is final (completed, failed, cancelled).
func JobTerminal(status string) bool {
	return status == JobCompleted || status == JobFailed || status == JobCancelled
}

// JobTracked reports whether stops of a job in this status are tracked
// automatically from vehicle positions and its route is monitored.
func JobTracked(status string) bool {
	switch status {
	case JobAssigned, JobAccepted, JobEnRoute, JobArrived, JobInProgress:
		return true
	}
	return false
}

// driverTransitions are the status changes a driver may make.
var driverTransitions = map[string][]string{
	JobAssigned:   {JobAccepted},
	JobAccepted:   {JobEnRoute, JobArrived, JobFailed},
	JobEnRoute:    {JobArrived, JobInProgress, JobFailed},
	JobArrived:    {JobInProgress, JobEnRoute, JobCompleted, JobFailed},
	JobInProgress: {JobCompleted, JobFailed, JobEnRoute},
}

// managerTransitions are allowed to admins/managers in addition to the
// driver transitions.
var managerTransitions = map[string][]string{
	JobUnassigned: {JobAssigned, JobCancelled},
	JobAssigned:   {JobUnassigned, JobEnRoute, JobCancelled},
	JobAccepted:   {JobAssigned, JobUnassigned, JobCancelled},
	JobEnRoute:    {JobCompleted, JobCancelled},
	JobArrived:    {JobCancelled},
	JobInProgress: {JobCancelled},
	JobFailed:     {JobAssigned, JobUnassigned},
	JobCancelled:  {JobAssigned, JobUnassigned},
}

// JobTransitionAllowed reports whether from → to is a valid status change
// for a driver (byDriver) or an admin/manager.
func JobTransitionAllowed(from, to string, byDriver bool) bool {
	if slices.Contains(driverTransitions[from], to) {
		return true
	}
	return !byDriver && slices.Contains(managerTransitions[from], to)
}

// ConflictError is an invalid state change (HTTP 409).
type ConflictError struct{ Msg string }

func (e *ConflictError) Error() string { return e.Msg }

func conflict(format string, args ...any) error {
	return &ConflictError{Msg: fmt.Sprintf(format, args...)}
}

// JobStop is one ordered stop of a job.
type JobStop struct {
	ID          int64      `json:"id"`
	Seq         int        `json:"seq"`
	Name        string     `json:"name"`
	Address     string     `json:"address"`
	Lat         float64    `json:"lat"`
	Lng         float64    `json:"lng"`
	Radius      float64    `json:"radius"`
	Status      string     `json:"status"`
	ArrivedAt   *time.Time `json:"arrivedAt"`
	DepartedAt  *time.Time `json:"departedAt"`
	CompletedAt *time.Time `json:"completedAt"`
	Notes       string     `json:"notes"`
}

// ChecklistItem is one checklist entry of a job.
type ChecklistItem struct {
	ID       int64      `json:"id"`
	Text     string     `json:"text"`
	Required bool       `json:"required"`
	Done     bool       `json:"done"`
	DoneAt   *time.Time `json:"doneAt"`
}

// Attachment is a file attached to a job (photo, signature, document).
type Attachment struct {
	ID          int64     `json:"id"`
	JobID       int64     `json:"jobId"`
	Kind        string    `json:"kind"`
	StopID      *int64    `json:"stopId"`
	URL         string    `json:"url"`
	Name        string    `json:"name"`
	ContentType string    `json:"contentType"`
	Size        int64     `json:"size"`
	UserID      *int64    `json:"userId"`
	CreatedAt   time.Time `json:"createdAt"`

	Path string `json:"-"` // relative to the data directory
}

// AttachmentKinds lists the attachment kinds.
var AttachmentKinds = []string{"photo", "signature", "document"}

// Job is a dispatch job.
type Job struct {
	ID             int64           `json:"id"`
	Reference      string          `json:"reference"`
	Title          string          `json:"title"`
	Description    string          `json:"description"`
	Priority       string          `json:"priority"`
	Status         string          `json:"status"`
	DeviceID       *int64          `json:"deviceId"`
	DriverID       *int64          `json:"driverId"`
	CustomerName   string          `json:"customerName"`
	CustomerPhone  string          `json:"customerPhone"`
	ScheduledStart *time.Time      `json:"scheduledStart"`
	DueBy          *time.Time      `json:"dueBy"`
	Stops          []JobStop       `json:"stops"`
	Checklist      []ChecklistItem `json:"checklist"`
	Attachments    []Attachment    `json:"attachments"`
	Notes          string          `json:"notes"`
	FailureReason  string          `json:"failureReason"`
	CreatedBy      *int64          `json:"createdBy"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
	CompletedAt    *time.Time      `json:"completedAt"`
	RouteID        *int64          `json:"routeId"`
	Late           bool            `json:"late"` // dueBy passed and not finished

	prevDevice, prevDriver *int64 // previous audience (reassignment), see JobAudience
	prevSet                bool
}

// JobReference formats the server-generated job reference.
func JobReference(id int64) string { return fmt.Sprintf("JOB-%06d", id) }

// JobAudience describes who may receive live updates of a job.
type JobAudience struct {
	DeviceIDs []int64 // vehicles (current and previous); clients that see one of them get it
	NoDevice  bool    // the job has no vehicle: admins/managers get it
	DriverIDs []int64 // drivers (current and previous) whose app gets it
}

// WithPrevious records the vehicle/driver a job had before a change, so
// their audience also receives the update.
func (j Job) WithPrevious(deviceID, driverID *int64) Job {
	j.prevDevice, j.prevDriver, j.prevSet = deviceID, driverID, true
	return j
}

// JobAudience implements the live-update audience of a job.
func (j Job) JobAudience() JobAudience {
	var a JobAudience
	for _, p := range []*int64{j.DeviceID, j.prevDevice} {
		if p != nil && !slices.Contains(a.DeviceIDs, *p) {
			a.DeviceIDs = append(a.DeviceIDs, *p)
		}
	}
	a.NoDevice = j.DeviceID == nil || (j.prevSet && j.prevDevice == nil)
	for _, p := range []*int64{j.DriverID, j.prevDriver} {
		if p != nil && !slices.Contains(a.DriverIDs, *p) {
			a.DriverIDs = append(a.DriverIDs, *p)
		}
	}
	return a
}

// JobDeleted is the payload of the live "jobDeleted" message.
type JobDeleted struct {
	ID int64 `json:"id"`

	audience JobAudience
}

// NewJobDeleted builds the deletion message of j.
func NewJobDeleted(j Job) JobDeleted { return JobDeleted{ID: j.ID, audience: j.JobAudience()} }

// JobAudience implements the live-update audience.
func (d JobDeleted) JobAudience() JobAudience { return d.audience }

// JobEvent is one timeline entry.
type JobEvent struct {
	ID     int64          `json:"id"`
	JobID  int64          `json:"jobId"`
	Time   time.Time      `json:"time"`
	UserID *int64         `json:"userId"`
	Kind   string         `json:"kind"`
	Data   map[string]any `json:"data"`
}

// OptTime is a nullable time in a PATCH body: absent = unchanged, null = clear.
type OptTime struct {
	Set bool
	T   *time.Time
}

// UnmarshalJSON implements json.Unmarshaler.
func (o *OptTime) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.T = nil
		return nil
	}
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return invalid("times must be RFC 3339 strings or null")
	}
	if s == "" {
		o.T = nil
		return nil
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return invalid("times must be RFC 3339 strings like 2026-10-24T06:00:00Z")
	}
	t = t.UTC()
	o.T = &t
	return nil
}

// StopInput is a stop in a job body. Stops with an id keep their state.
type StopInput struct {
	ID      *int64   `json:"id"`
	Name    string   `json:"name"`
	Address string   `json:"address"`
	Lat     *float64 `json:"lat"`
	Lng     *float64 `json:"lng"`
	Radius  *float64 `json:"radius"`
	Notes   string   `json:"notes"`
}

// ChecklistInput is a checklist item in a job body. Items with an id keep
// their done state.
type ChecklistInput struct {
	ID       *int64 `json:"id"`
	Text     string `json:"text"`
	Required bool   `json:"required"`
}

// JobInput is the body of POST /jobs.
type JobInput struct {
	Title          string           `json:"title"`
	Description    string           `json:"description"`
	Priority       string           `json:"priority"`
	DeviceID       *int64           `json:"deviceId"`
	DriverID       *int64           `json:"driverId"`
	RouteID        *int64           `json:"routeId"`
	CustomerName   string           `json:"customerName"`
	CustomerPhone  string           `json:"customerPhone"`
	ScheduledStart OptTime          `json:"scheduledStart"`
	DueBy          OptTime          `json:"dueBy"`
	Stops          []StopInput      `json:"stops"`
	Checklist      []ChecklistInput `json:"checklist"`
	Notes          string           `json:"notes"`
}

// JobPatch is the body of PATCH /jobs/{id}; absent fields are unchanged.
type JobPatch struct {
	Title          *string           `json:"title"`
	Description    *string           `json:"description"`
	Priority       *string           `json:"priority"`
	DeviceID       OptID             `json:"deviceId"`
	DriverID       OptID             `json:"driverId"`
	RouteID        OptID             `json:"routeId"`
	CustomerName   *string           `json:"customerName"`
	CustomerPhone  *string           `json:"customerPhone"`
	ScheduledStart OptTime           `json:"scheduledStart"`
	DueBy          OptTime           `json:"dueBy"`
	Stops          *[]StopInput      `json:"stops"`
	Checklist      *[]ChecklistInput `json:"checklist"`
	Notes          *string           `json:"notes"`
	Status         *string           `json:"status"` // rejected: use POST /jobs/{id}/status
}

func checkLen(field, v string, maxRunes int) error {
	if utf8.RuneCountInString(v) > maxRunes {
		return invalid("%s must be at most %d characters", field, maxRunes)
	}
	return nil
}

func normalizeStops(stops []StopInput) error {
	if len(stops) == 0 {
		return invalid("at least one stop is required")
	}
	if len(stops) > maxJobStops {
		return invalid("a job can have at most %d stops", maxJobStops)
	}
	for i := range stops {
		st := &stops[i]
		st.Name, st.Address, st.Notes = strings.TrimSpace(st.Name), strings.TrimSpace(st.Address), strings.TrimSpace(st.Notes)
		if st.Name == "" {
			st.Name = "Stop " + strconv.Itoa(i+1)
		}
		if st.Radius == nil {
			r := float64(DefaultStopRadius)
			st.Radius = &r
		}
		switch {
		case st.Lat == nil || st.Lng == nil || !validPoint([2]float64{*st.Lng, *st.Lat}) || (*st.Lat == 0 && *st.Lng == 0):
			return invalid("stop %d: lat and lng are required (lat in [-90, 90], lng in [-180, 180])", i+1)
		case !(*st.Radius >= MinStopRadius && *st.Radius <= MaxStopRadius):
			return invalid("stop %d: radius must be between %d m and %d m", i+1, MinStopRadius, MaxStopRadius)
		}
		for _, e := range []error{checkLen("stop name", st.Name, 100), checkLen("stop address", st.Address, 300),
			checkLen("stop notes", st.Notes, 2000)} {
			if e != nil {
				return e
			}
		}
	}
	return nil
}

func normalizeChecklist(items []ChecklistInput) error {
	if len(items) > maxChecklistItems {
		return invalid("a checklist can have at most %d items", maxChecklistItems)
	}
	for i := range items {
		items[i].Text = strings.TrimSpace(items[i].Text)
		if items[i].Text == "" {
			return invalid("checklist item %d: text is required", i+1)
		}
		if err := checkLen("checklist text", items[i].Text, 200); err != nil {
			return err
		}
	}
	return nil
}

// jobFields are the scalar editable fields of a job.
type jobFields struct {
	title, description, priority, customerName, customerPhone, notes string
	deviceID, driverID, routeID                                      *int64
	scheduledStart, dueBy                                            *time.Time
}

func (f *jobFields) normalize() error {
	f.title, f.description = strings.TrimSpace(f.title), strings.TrimSpace(f.description)
	f.priority = strings.TrimSpace(f.priority)
	f.customerName, f.customerPhone = strings.TrimSpace(f.customerName), strings.TrimSpace(f.customerPhone)
	f.notes = strings.TrimSpace(f.notes)
	if f.priority == "" {
		f.priority = "normal"
	}
	if f.title == "" {
		return invalid("title is required")
	}
	if !slices.Contains([]string{"normal", "high", "urgent"}, f.priority) {
		return invalid("priority must be one of: normal, high, urgent")
	}
	for _, e := range []error{checkLen("title", f.title, 200), checkLen("description", f.description, 5000),
		checkLen("customerName", f.customerName, 100), checkLen("customerPhone", f.customerPhone, 32),
		checkLen("notes", f.notes, 5000)} {
		if e != nil {
			return e
		}
	}
	return nil
}

func jobRefErr(err error) error {
	if isForeignKeyViolation(err) {
		return invalid("unknown deviceId, driverId or routeId")
	}
	return err
}

const jobColumns = `j.id, j.title, j.description, j.priority, j.status, j.device_id, j.driver_id, j.route_id,
	j.customer_name, j.customer_phone, j.scheduled_start, j.due_by, j.notes, j.failure_reason, j.created_by,
	j.created_at, j.updated_at, j.completed_at`

func utcPtr(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

func (s *Store) scanJob(row pgx.Row) (Job, error) {
	var j Job
	err := row.Scan(&j.ID, &j.Title, &j.Description, &j.Priority, &j.Status, &j.DeviceID, &j.DriverID, &j.RouteID,
		&j.CustomerName, &j.CustomerPhone, &j.ScheduledStart, &j.DueBy, &j.Notes, &j.FailureReason, &j.CreatedBy,
		&j.CreatedAt, &j.UpdatedAt, &j.CompletedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return j, ErrNotFound
	}
	j.Reference = JobReference(j.ID)
	j.ScheduledStart, j.DueBy, j.CompletedAt = utcPtr(j.ScheduledStart), utcPtr(j.DueBy), utcPtr(j.CompletedAt)
	j.CreatedAt, j.UpdatedAt = j.CreatedAt.UTC(), j.UpdatedAt.UTC()
	j.Late = j.DueBy != nil && !JobTerminal(j.Status) && s.opts.Now().After(*j.DueBy)
	j.Stops, j.Checklist, j.Attachments = []JobStop{}, []ChecklistItem{}, []Attachment{}
	return j, err
}

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// fillJobs loads stops, checklists and attachments.
func (s *Store) fillJobs(ctx context.Context, q querier, jobs []Job) error {
	if len(jobs) == 0 {
		return nil
	}
	ids := make([]int64, len(jobs))
	at := make(map[int64]int, len(jobs))
	for i := range jobs {
		ids[i], at[jobs[i].ID] = jobs[i].ID, i
	}
	rows, err := q.Query(ctx, `SELECT job_id, id, seq, name, address, lat, lng, radius, status, arrived_at,
		departed_at, completed_at, notes FROM job_stops WHERE job_id = ANY($1) ORDER BY job_id, seq, id`, ids)
	if err != nil {
		return err
	}
	for rows.Next() {
		var (
			jid int64
			st  JobStop
		)
		if err := rows.Scan(&jid, &st.ID, &st.Seq, &st.Name, &st.Address, &st.Lat, &st.Lng, &st.Radius, &st.Status,
			&st.ArrivedAt, &st.DepartedAt, &st.CompletedAt, &st.Notes); err != nil {
			rows.Close()
			return err
		}
		st.ArrivedAt, st.DepartedAt, st.CompletedAt = utcPtr(st.ArrivedAt), utcPtr(st.DepartedAt), utcPtr(st.CompletedAt)
		j := &jobs[at[jid]]
		j.Stops = append(j.Stops, st)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	rows, err = q.Query(ctx, `SELECT job_id, id, text, required, done, done_at FROM job_checklist
		WHERE job_id = ANY($1) ORDER BY job_id, seq, id`, ids)
	if err != nil {
		return err
	}
	for rows.Next() {
		var (
			jid int64
			c   ChecklistItem
		)
		if err := rows.Scan(&jid, &c.ID, &c.Text, &c.Required, &c.Done, &c.DoneAt); err != nil {
			rows.Close()
			return err
		}
		c.DoneAt = utcPtr(c.DoneAt)
		j := &jobs[at[jid]]
		j.Checklist = append(j.Checklist, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	rows, err = q.Query(ctx, `SELECT `+attachmentColumns+` FROM job_attachments WHERE job_id = ANY($1) ORDER BY job_id, id`, ids)
	if err != nil {
		return err
	}
	for rows.Next() {
		a, err := scanAttachment(rows)
		if err != nil {
			rows.Close()
			return err
		}
		j := &jobs[at[a.JobID]]
		j.Attachments = append(j.Attachments, a)
	}
	rows.Close()
	return rows.Err()
}

const attachmentColumns = `id, job_id, stop_id, kind, name, content_type, size, path, user_id, created_at`

func scanAttachment(row pgx.Row) (Attachment, error) {
	var a Attachment
	err := row.Scan(&a.ID, &a.JobID, &a.StopID, &a.Kind, &a.Name, &a.ContentType, &a.Size, &a.Path, &a.UserID, &a.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, ErrNotFound
	}
	a.URL = "/api/v1/files/" + strconv.FormatInt(a.ID, 10)
	a.CreatedAt = a.CreatedAt.UTC()
	return a, err
}

// Job returns one job with its stops, checklist and attachments.
func (s *Store) Job(ctx context.Context, id int64) (Job, error) {
	return s.jobWith(ctx, s.pool, id)
}

func (s *Store) jobWith(ctx context.Context, q querier, id int64) (Job, error) {
	j, err := s.scanJob(q.QueryRow(ctx, `SELECT `+jobColumns+` FROM jobs j WHERE j.id = $1`, id))
	if err != nil {
		return j, err
	}
	js := []Job{j}
	if err := s.fillJobs(ctx, q, js); err != nil {
		return Job{}, err
	}
	return js[0], nil
}

// JobFilter selects jobs; zero fields are ignored.
type JobFilter struct {
	Statuses []string
	DeviceID int64
	DriverID int64
	From, To time.Time // on COALESCE(scheduled_start, created_at)
	Query    string
	Limit    int
	// Scope restricts to jobs of visible vehicles; IncludeNoDevice adds jobs
	// without a vehicle (admins/managers).
	Scope           Scope
	IncludeNoDevice bool
	// UpdatedSince returns jobs updated after the time (driver polling).
	UpdatedSince time.Time
	// OrDriverWas also returns jobs the driver was unassigned from since UpdatedSince.
	OrDriverWas bool
}

// Jobs lists jobs, newest scheduled/created first.
func (s *Store) Jobs(ctx context.Context, f JobFilter) ([]Job, error) {
	where, args := []string{"true"}, []any{}
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, strings.ReplaceAll(cond, "?", "$"+strconv.Itoa(len(args))))
	}
	if len(f.Statuses) > 0 {
		add("j.status = ANY(?)", f.Statuses)
	}
	if f.DeviceID != 0 {
		add("j.device_id = ?", f.DeviceID)
	}
	if f.DriverID != 0 {
		if f.OrDriverWas && !f.UpdatedSince.IsZero() {
			args = append(args, f.DriverID, f.UpdatedSince)
			n, m := len(args)-1, len(args)
			where = append(where, fmt.Sprintf(`(j.driver_id = $%d OR j.id IN (SELECT job_id FROM job_events
				WHERE kind = 'assigned' AND time > $%d AND (data->>'previousDriverId')::bigint = $%d))`, n, m, n))
		} else {
			add("j.driver_id = ?", f.DriverID)
		}
	}
	if !f.From.IsZero() {
		add("COALESCE(j.scheduled_start, j.created_at) >= ?", f.From)
	}
	if !f.To.IsZero() {
		add("COALESCE(j.scheduled_start, j.created_at) <= ?", f.To)
	}
	if !f.UpdatedSince.IsZero() {
		add("j.updated_at > ?", f.UpdatedSince)
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		pat := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q) + "%"
		add(`('JOB-' || lpad(j.id::text, 6, '0') ILIKE ? OR j.title ILIKE $X OR j.customer_name ILIKE $X
			OR j.description ILIKE $X OR j.customer_phone ILIKE $X)`, pat)
		where[len(where)-1] = strings.ReplaceAll(where[len(where)-1], "$X", "$"+strconv.Itoa(len(args)))
	}
	if !f.Scope.All {
		args = append(args, f.Scope.DeviceIDs)
		cond := fmt.Sprintf("j.device_id = ANY($%d)", len(args))
		if f.IncludeNoDevice {
			cond = "(" + cond + " OR j.device_id IS NULL)"
		}
		where = append(where, cond)
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 500
	}
	args = append(args, limit)
	rows, err := s.pool.Query(ctx, `SELECT `+jobColumns+` FROM jobs j WHERE `+strings.Join(where, " AND ")+
		fmt.Sprintf(` ORDER BY COALESCE(j.scheduled_start, j.created_at) DESC, j.id DESC LIMIT $%d`, len(args)), args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Job, error) { return s.scanJob(r) })
	if err != nil {
		return nil, err
	}
	if out == nil {
		out = []Job{}
	}
	return out, s.fillJobs(ctx, s.pool, out)
}

// TrackedJobs returns the jobs whose stops are tracked automatically.
func (s *Store) TrackedJobs(ctx context.Context) ([]Job, error) {
	tracked := []string{}
	for _, st := range JobStatuses {
		if JobTracked(st) {
			tracked = append(tracked, st)
		}
	}
	return s.Jobs(ctx, JobFilter{Statuses: tracked, Scope: Scope{All: true}, Limit: 100_000})
}

func insertJobEvent(ctx context.Context, tx pgx.Tx, jobID int64, t time.Time, userID *int64, kind string, data map[string]any) error {
	if data == nil {
		data = map[string]any{}
	}
	_, err := tx.Exec(ctx, `INSERT INTO job_events (job_id, time, user_id, kind, data) VALUES ($1, $2, $3, $4, $5)`,
		jobID, t, userID, kind, data)
	return err
}

func uid(userID int64) *int64 {
	if userID == 0 {
		return nil
	}
	return &userID
}

// writeStops replaces the stops of a job: inputs with an id update that stop
// (keeping its state), others are inserted, missing ones are deleted.
func writeStops(ctx context.Context, tx pgx.Tx, jobID int64, stops []StopInput) error {
	keep := []int64{}
	for _, st := range stops {
		if st.ID != nil {
			keep = append(keep, *st.ID)
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM job_stops WHERE job_id = $1 AND NOT (id = ANY($2))`, jobID, keep); err != nil {
		return err
	}
	for i, st := range stops {
		if st.ID != nil {
			tag, err := tx.Exec(ctx, `UPDATE job_stops SET seq = $3, name = $4, address = $5, lat = $6, lng = $7,
				radius = $8, notes = $9 WHERE id = $1 AND job_id = $2`, *st.ID, jobID, i+1, st.Name, st.Address,
				*st.Lat, *st.Lng, *st.Radius, st.Notes)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return invalid("unknown stop id %d", *st.ID)
			}
			continue
		}
		if _, err := tx.Exec(ctx, `INSERT INTO job_stops (job_id, seq, name, address, lat, lng, radius, notes)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, jobID, i+1, st.Name, st.Address, *st.Lat, *st.Lng, *st.Radius, st.Notes); err != nil {
			return err
		}
	}
	return nil
}

func writeChecklist(ctx context.Context, tx pgx.Tx, jobID int64, items []ChecklistInput) error {
	keep := []int64{}
	for _, c := range items {
		if c.ID != nil {
			keep = append(keep, *c.ID)
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM job_checklist WHERE job_id = $1 AND NOT (id = ANY($2))`, jobID, keep); err != nil {
		return err
	}
	for i, c := range items {
		if c.ID != nil {
			tag, err := tx.Exec(ctx, `UPDATE job_checklist SET seq = $3, text = $4, required = $5 WHERE id = $1 AND job_id = $2`,
				*c.ID, jobID, i+1, c.Text, c.Required)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return invalid("unknown checklist item id %d", *c.ID)
			}
			continue
		}
		if _, err := tx.Exec(ctx, `INSERT INTO job_checklist (job_id, seq, text, required) VALUES ($1, $2, $3, $4)`,
			jobID, i+1, c.Text, c.Required); err != nil {
			return err
		}
	}
	return nil
}

// JobChange describes the side effects of a job mutation, for events.
type JobChange struct {
	Job          Job
	PrevStatus   string
	PrevDeviceID *int64
	PrevDriverID *int64
	Assigned     bool // a (new) driver was assigned
	StatusChange bool
	StopArrived  *JobStop // a stop became arrived
}

// CreateJob inserts a job. With a driver the job starts "assigned".
func (s *Store) CreateJob(ctx context.Context, in JobInput, userID int64) (JobChange, error) {
	f := jobFields{title: in.Title, description: in.Description, priority: in.Priority, customerName: in.CustomerName,
		customerPhone: in.CustomerPhone, notes: in.Notes, deviceID: in.DeviceID, driverID: in.DriverID, routeID: in.RouteID,
		scheduledStart: in.ScheduledStart.T, dueBy: in.DueBy.T}
	if err := f.normalize(); err != nil {
		return JobChange{}, err
	}
	if err := normalizeStops(in.Stops); err != nil {
		return JobChange{}, err
	}
	if err := normalizeChecklist(in.Checklist); err != nil {
		return JobChange{}, err
	}
	status := JobUnassigned
	if f.driverID != nil {
		status = JobAssigned
	}
	now := s.opts.Now().UTC()
	var id int64
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `INSERT INTO jobs (title, description, priority, status, device_id, driver_id, route_id,
				customer_name, customer_phone, scheduled_start, due_by, notes, created_by, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14) RETURNING id`,
			f.title, f.description, f.priority, status, f.deviceID, f.driverID, f.routeID, f.customerName,
			f.customerPhone, f.scheduledStart, f.dueBy, f.notes, uid(userID), now).Scan(&id)
		if err != nil {
			return err
		}
		if err := writeStops(ctx, tx, id, in.Stops); err != nil {
			return err
		}
		if err := writeChecklist(ctx, tx, id, in.Checklist); err != nil {
			return err
		}
		if err := insertJobEvent(ctx, tx, id, now, uid(userID), JobEvCreated, map[string]any{"status": status}); err != nil {
			return err
		}
		if f.driverID != nil {
			return insertJobEvent(ctx, tx, id, now, uid(userID), JobEvAssigned, map[string]any{"driverId": *f.driverID})
		}
		return nil
	})
	if err != nil {
		return JobChange{}, jobRefErr(err)
	}
	j, err := s.Job(ctx, id)
	return JobChange{Job: j, Assigned: f.driverID != nil}, err
}

// lockJob loads the scalar fields of a job FOR UPDATE.
func (s *Store) lockJob(ctx context.Context, tx pgx.Tx, id int64) (Job, error) {
	return s.scanJob(tx.QueryRow(ctx, `SELECT `+jobColumns+` FROM jobs j WHERE j.id = $1 FOR UPDATE`, id))
}

// mutateJob runs fn on a locked job inside a transaction, bumps updated_at
// and returns the job afterwards.
func (s *Store) mutateJob(ctx context.Context, id int64, fn func(tx pgx.Tx, cur Job, ch *JobChange) error) (JobChange, error) {
	var ch JobChange
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		cur, err := s.lockJob(ctx, tx, id)
		if err != nil {
			return err
		}
		js := []Job{cur}
		if err := s.fillJobs(ctx, tx, js); err != nil {
			return err
		}
		cur = js[0]
		ch.PrevStatus, ch.PrevDeviceID, ch.PrevDriverID = cur.Status, cur.DeviceID, cur.DriverID
		if err := fn(tx, cur, &ch); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE jobs SET updated_at = $2 WHERE id = $1`, id, s.opts.Now().UTC())
		return err
	})
	if err != nil {
		return JobChange{}, jobRefErr(err)
	}
	j, err := s.Job(ctx, id)
	ch.Job = j.WithPrevious(ch.PrevDeviceID, ch.PrevDriverID)
	ch.StatusChange = j.Status != ch.PrevStatus
	return ch, err
}

func samePtr(a, b *int64) bool { return (a == nil) == (b == nil) && (a == nil || *a == *b) }

// UpdateJob applies a manager edit. Changing the driver re-assigns the job
// (status assigned, or unassigned when cleared) unless it is finished.
func (s *Store) UpdateJob(ctx context.Context, id int64, p JobPatch, userID int64) (JobChange, error) {
	if p.Status != nil {
		return JobChange{}, invalid("use POST /jobs/{id}/status to change the status")
	}
	if p.Stops != nil {
		if err := normalizeStops(*p.Stops); err != nil {
			return JobChange{}, err
		}
	}
	if p.Checklist != nil {
		if err := normalizeChecklist(*p.Checklist); err != nil {
			return JobChange{}, err
		}
	}
	now := s.opts.Now().UTC()
	return s.mutateJob(ctx, id, func(tx pgx.Tx, cur Job, ch *JobChange) error {
		f := jobFields{title: cur.Title, description: cur.Description, priority: cur.Priority,
			customerName: cur.CustomerName, customerPhone: cur.CustomerPhone, notes: cur.Notes,
			deviceID: cur.DeviceID, driverID: cur.DriverID, routeID: cur.RouteID,
			scheduledStart: cur.ScheduledStart, dueBy: cur.DueBy}
		set := func(dst *string, src *string) {
			if src != nil {
				*dst = *src
			}
		}
		set(&f.title, p.Title)
		set(&f.description, p.Description)
		set(&f.priority, p.Priority)
		set(&f.customerName, p.CustomerName)
		set(&f.customerPhone, p.CustomerPhone)
		set(&f.notes, p.Notes)
		if p.DeviceID.Set {
			f.deviceID = p.DeviceID.ID
		}
		if p.DriverID.Set {
			f.driverID = p.DriverID.ID
		}
		if p.RouteID.Set {
			f.routeID = p.RouteID.ID
		}
		if p.ScheduledStart.Set {
			f.scheduledStart = p.ScheduledStart.T
		}
		if p.DueBy.Set {
			f.dueBy = p.DueBy.T
		}
		if err := f.normalize(); err != nil {
			return err
		}
		status := cur.Status
		driverChanged := !samePtr(f.driverID, cur.DriverID)
		if driverChanged && !JobTerminal(cur.Status) {
			if f.driverID == nil {
				status = JobUnassigned
			} else {
				status = JobAssigned
			}
		}
		resetLate := p.DueBy.Set && !sameTime(f.dueBy, cur.DueBy)
		_, err := tx.Exec(ctx, `UPDATE jobs SET title = $2, description = $3, priority = $4, device_id = $5,
				driver_id = $6, route_id = $7, customer_name = $8, customer_phone = $9, scheduled_start = $10,
				due_by = $11, notes = $12, status = $13, late_notified = late_notified AND NOT $14 WHERE id = $1`,
			id, f.title, f.description, f.priority, f.deviceID, f.driverID, f.routeID, f.customerName, f.customerPhone,
			f.scheduledStart, f.dueBy, f.notes, status, resetLate)
		if err != nil {
			return err
		}
		if p.Stops != nil {
			if err := writeStops(ctx, tx, id, *p.Stops); err != nil {
				return err
			}
		}
		if p.Checklist != nil {
			if err := writeChecklist(ctx, tx, id, *p.Checklist); err != nil {
				return err
			}
		}
		if err := insertJobEvent(ctx, tx, id, now, uid(userID), JobEvUpdated, nil); err != nil {
			return err
		}
		if driverChanged {
			data := map[string]any{"driverId": f.driverID}
			if cur.DriverID != nil {
				data["previousDriverId"] = *cur.DriverID
			}
			if err := insertJobEvent(ctx, tx, id, now, uid(userID), JobEvAssigned, data); err != nil {
				return err
			}
			ch.Assigned = f.driverID != nil
		}
		if status != cur.Status {
			return insertJobEvent(ctx, tx, id, now, uid(userID), JobEvStatus,
				map[string]any{"from": cur.Status, "status": status})
		}
		return nil
	})
}

func sameTime(a, b *time.Time) bool { return (a == nil) == (b == nil) && (a == nil || a.Equal(*b)) }

// SetJobStatus changes the status along the transition table (ConflictError
// otherwise). byDriver applies the driver table and requires the required
// checklist items before completion. data is added to the timeline entry.
func (s *Store) SetJobStatus(ctx context.Context, id int64, to, reason string, userID int64, byDriver bool, data map[string]any) (JobChange, error) {
	reason = strings.TrimSpace(reason)
	if !slices.Contains(JobStatuses, to) {
		return JobChange{}, invalid("status must be one of: %s", strings.Join(JobStatuses, ", "))
	}
	if err := checkLen("reason", reason, 1000); err != nil {
		return JobChange{}, err
	}
	now := s.opts.Now().UTC()
	return s.mutateJob(ctx, id, func(tx pgx.Tx, cur Job, ch *JobChange) error {
		if !JobTransitionAllowed(cur.Status, to, byDriver) {
			return conflict("cannot change status from %s to %s", cur.Status, to)
		}
		if to == JobAssigned && cur.DriverID == nil {
			return conflict("the job has no driver; set driverId first")
		}
		if to == JobCompleted && byDriver {
			for _, c := range cur.Checklist {
				if c.Required && !c.Done {
					return conflict("required checklist items are not done")
				}
			}
		}
		failure := cur.FailureReason
		switch to {
		case JobFailed, JobCancelled:
			failure = reason
		case JobUnassigned, JobAssigned:
			failure = ""
		}
		_, err := tx.Exec(ctx, `UPDATE jobs SET status = $2, failure_reason = $3,
				completed_at = CASE WHEN $2 = 'completed' THEN $4::timestamptz WHEN $2 IN ('failed', 'cancelled') THEN completed_at ELSE NULL END,
				driver_id = CASE WHEN $2 = 'unassigned' THEN NULL ELSE driver_id END
			WHERE id = $1`, id, to, failure, now)
		if err != nil {
			return err
		}
		ev := map[string]any{"from": cur.Status, "status": to}
		if reason != "" {
			ev["reason"] = reason
		}
		for k, v := range data {
			ev[k] = v
		}
		if to == JobUnassigned && cur.DriverID != nil {
			if err := insertJobEvent(ctx, tx, id, now, uid(userID), JobEvAssigned,
				map[string]any{"driverId": nil, "previousDriverId": *cur.DriverID}); err != nil {
				return err
			}
		}
		return insertJobEvent(ctx, tx, id, now, uid(userID), JobEvStatus, ev)
	})
}

// UpdateJobStop is a driver's stop update (arrived, completed, skipped).
// Arriving moves an accepted/enRoute job to arrived.
func (s *Store) UpdateJobStop(ctx context.Context, jobID, stopID int64, status string, notes *string, userID int64, data map[string]any) (JobChange, error) {
	if !slices.Contains([]string{StopArrived, StopCompleted, StopSkipped}, status) {
		return JobChange{}, invalid("status must be one of: arrived, completed, skipped")
	}
	if notes != nil {
		n := strings.TrimSpace(*notes)
		notes = &n
		if err := checkLen("notes", n, 2000); err != nil {
			return JobChange{}, err
		}
	}
	now := s.opts.Now().UTC()
	return s.mutateJob(ctx, jobID, func(tx pgx.Tx, cur Job, ch *JobChange) error {
		var st *JobStop
		for i := range cur.Stops {
			if cur.Stops[i].ID == stopID {
				st = &cur.Stops[i]
			}
		}
		if st == nil {
			return ErrNotFound
		}
		switch cur.Status {
		case JobAccepted, JobEnRoute, JobArrived, JobInProgress:
		default:
			return conflict("stops can only be updated while the job is active (status %s)", cur.Status)
		}
		ok := (st.Status == StopPending) || (st.Status == StopArrived && status != StopArrived)
		if !ok {
			return conflict("cannot change stop status from %s to %s", st.Status, status)
		}
		_, err := tx.Exec(ctx, `UPDATE job_stops SET status = $2,
				arrived_at = CASE WHEN $2 = 'arrived' THEN COALESCE(arrived_at, $3) ELSE arrived_at END,
				completed_at = CASE WHEN $2 = 'completed' THEN $3 ELSE completed_at END,
				notes = COALESCE($4, notes)
			WHERE id = $1`, stopID, status, now, notes)
		if err != nil {
			return err
		}
		kind := map[string]string{StopArrived: JobEvStopArrived, StopCompleted: JobEvStopCompleted, StopSkipped: JobEvStopSkipped}[status]
		ev := map[string]any{"stopId": stopID, "name": st.Name}
		for k, v := range data {
			ev[k] = v
		}
		if err := insertJobEvent(ctx, tx, jobID, now, uid(userID), kind, ev); err != nil {
			return err
		}
		if status == StopArrived {
			arrived := *st
			arrived.Status = StopArrived
			ch.StopArrived = &arrived
			return arriveJob(ctx, tx, cur, jobID, now, uid(userID))
		}
		return nil
	})
}

// arriveJob moves an accepted/enRoute job to arrived.
func arriveJob(ctx context.Context, tx pgx.Tx, cur Job, jobID int64, t time.Time, userID *int64) error {
	if cur.Status != JobAccepted && cur.Status != JobEnRoute {
		return nil
	}
	if _, err := tx.Exec(ctx, `UPDATE jobs SET status = 'arrived' WHERE id = $1`, jobID); err != nil {
		return err
	}
	return insertJobEvent(ctx, tx, jobID, t, userID, JobEvStatus, map[string]any{"from": cur.Status, "status": JobArrived, "auto": userID == nil})
}

// SetChecklistItem marks a checklist item done or not done.
func (s *Store) SetChecklistItem(ctx context.Context, jobID, itemID int64, done bool, userID int64) (JobChange, error) {
	now := s.opts.Now().UTC()
	return s.mutateJob(ctx, jobID, func(tx pgx.Tx, cur Job, ch *JobChange) error {
		if JobTerminal(cur.Status) {
			return conflict("the job is %s", cur.Status)
		}
		var item *ChecklistItem
		for i := range cur.Checklist {
			if cur.Checklist[i].ID == itemID {
				item = &cur.Checklist[i]
			}
		}
		if item == nil {
			return ErrNotFound
		}
		if _, err := tx.Exec(ctx, `UPDATE job_checklist SET done = $2, done_at = CASE WHEN $2 THEN $3::timestamptz END
			WHERE id = $1`, itemID, done, now); err != nil {
			return err
		}
		return insertJobEvent(ctx, tx, jobID, now, uid(userID), JobEvChecklist,
			map[string]any{"itemId": itemID, "text": item.Text, "done": done})
	})
}

// AddJobNote adds a timeline note.
func (s *Store) AddJobNote(ctx context.Context, jobID int64, text string, userID int64) (JobChange, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return JobChange{}, invalid("text is required")
	}
	if err := checkLen("text", text, 2000); err != nil {
		return JobChange{}, err
	}
	now := s.opts.Now().UTC()
	return s.mutateJob(ctx, jobID, func(tx pgx.Tx, _ Job, _ *JobChange) error {
		return insertJobEvent(ctx, tx, jobID, now, uid(userID), JobEvNote, map[string]any{"text": text})
	})
}

// AddAttachment records an uploaded file (already written under the data
// directory at a.Path).
func (s *Store) AddAttachment(ctx context.Context, a Attachment) (Attachment, JobChange, error) {
	if !slices.Contains(AttachmentKinds, a.Kind) {
		return Attachment{}, JobChange{}, invalid("kind must be one of: %s", strings.Join(AttachmentKinds, ", "))
	}
	now := s.opts.Now().UTC()
	var out Attachment
	ch, err := s.mutateJob(ctx, a.JobID, func(tx pgx.Tx, cur Job, _ *JobChange) error {
		if a.StopID != nil && !slices.ContainsFunc(cur.Stops, func(st JobStop) bool { return st.ID == *a.StopID }) {
			return invalid("unknown stopId")
		}
		var err error
		out, err = scanAttachment(tx.QueryRow(ctx, `INSERT INTO job_attachments (job_id, stop_id, kind, name, content_type,
				size, path, user_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING `+attachmentColumns,
			a.JobID, a.StopID, a.Kind, a.Name, a.ContentType, a.Size, a.Path, a.UserID, now))
		if err != nil {
			return err
		}
		return insertJobEvent(ctx, tx, a.JobID, now, a.UserID, JobEvAttachment,
			map[string]any{"attachmentId": out.ID, "kind": out.Kind, "name": out.Name, "stopId": out.StopID})
	})
	return out, ch, err
}

// Attachment returns one attachment or ErrNotFound.
func (s *Store) Attachment(ctx context.Context, id int64) (Attachment, error) {
	return scanAttachment(s.pool.QueryRow(ctx, `SELECT `+attachmentColumns+` FROM job_attachments WHERE id = $1`, id))
}

// DeleteJob removes a job and returns it (with its attachments, whose files
// the caller removes).
func (s *Store) DeleteJob(ctx context.Context, id int64) (Job, error) {
	j, err := s.Job(ctx, id)
	if err != nil {
		return j, err
	}
	tag, err := s.pool.Exec(ctx, `DELETE FROM jobs WHERE id = $1`, id)
	if err != nil {
		return j, err
	}
	if tag.RowsAffected() == 0 {
		return j, ErrNotFound
	}
	// Attachments uploaded between the read and the delete are found by path prefix by the caller.
	return j, nil
}

// JobTimeline returns the timeline of a job, oldest first.
func (s *Store) JobTimeline(ctx context.Context, jobID int64) ([]JobEvent, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, job_id, time, user_id, kind, data FROM job_events
		WHERE job_id = $1 ORDER BY time, id`, jobID)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (JobEvent, error) {
		var e JobEvent
		err := r.Scan(&e.ID, &e.JobID, &e.Time, &e.UserID, &e.Kind, &e.Data)
		e.Time = e.Time.UTC()
		if e.Data == nil {
			e.Data = map[string]any{}
		}
		return e, err
	})
	if out == nil {
		out = []JobEvent{}
	}
	return out, err
}

// AutoStopArrived marks a pending stop arrived from a vehicle fix (no-op when
// it is no longer pending). ok reports whether anything changed.
func (s *Store) AutoStopArrived(ctx context.Context, jobID, stopID int64, t time.Time, lat, lng float64) (ch JobChange, ok bool, err error) {
	t = t.UTC().Truncate(time.Microsecond)
	ch, err = s.mutateJob(ctx, jobID, func(tx pgx.Tx, cur Job, c *JobChange) error {
		if !JobTracked(cur.Status) {
			return errNoChange
		}
		var st *JobStop
		for i := range cur.Stops {
			if cur.Stops[i].ID == stopID {
				st = &cur.Stops[i]
			}
		}
		if st == nil || st.Status != StopPending || st.ArrivedAt != nil {
			return errNoChange
		}
		if _, err := tx.Exec(ctx, `UPDATE job_stops SET status = 'arrived', arrived_at = $2 WHERE id = $1`, stopID, t); err != nil {
			return err
		}
		if err := insertJobEvent(ctx, tx, jobID, t, nil, JobEvStopArrived,
			map[string]any{"stopId": stopID, "name": st.Name, "auto": true, "lat": lat, "lng": lng}); err != nil {
			return err
		}
		arrived := *st
		arrived.Status, arrived.ArrivedAt = StopArrived, &t
		c.StopArrived = &arrived
		return arriveJob(ctx, tx, cur, jobID, t, nil)
	})
	if errors.Is(err, errNoChange) {
		return JobChange{}, false, nil
	}
	return ch, err == nil, err
}

// AutoStopDeparted records leaving an arrived stop's radius.
func (s *Store) AutoStopDeparted(ctx context.Context, jobID, stopID int64, t time.Time, lat, lng float64) (ch JobChange, ok bool, err error) {
	t = t.UTC().Truncate(time.Microsecond)
	ch, err = s.mutateJob(ctx, jobID, func(tx pgx.Tx, cur Job, _ *JobChange) error {
		var st *JobStop
		for i := range cur.Stops {
			if cur.Stops[i].ID == stopID {
				st = &cur.Stops[i]
			}
		}
		if st == nil || st.ArrivedAt == nil || st.DepartedAt != nil || t.Before(*st.ArrivedAt) {
			return errNoChange
		}
		if _, err := tx.Exec(ctx, `UPDATE job_stops SET departed_at = $2 WHERE id = $1`, stopID, t); err != nil {
			return err
		}
		return insertJobEvent(ctx, tx, jobID, t, nil, JobEvStopDeparted,
			map[string]any{"stopId": stopID, "name": st.Name, "auto": true, "lat": lat, "lng": lng})
	})
	if errors.Is(err, errNoChange) {
		return JobChange{}, false, nil
	}
	return ch, err == nil, err
}

var errNoChange = errors.New("no change")

// LateJobs marks unfinished jobs past their dueBy as notified and returns
// them (each job once per dueBy value).
func (s *Store) LateJobs(ctx context.Context) ([]Job, error) {
	now := s.opts.Now().UTC()
	var ids []int64
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `UPDATE jobs SET late_notified = true, updated_at = $1
			WHERE NOT late_notified AND due_by IS NOT NULL AND due_by < $1
			  AND status NOT IN ('completed', 'failed', 'cancelled') RETURNING id`, now)
		if err != nil {
			return err
		}
		ids, err = pgx.CollectRows(rows, pgx.RowTo[int64])
		if err != nil {
			return err
		}
		for _, id := range ids {
			if err := insertJobEvent(ctx, tx, id, now, nil, JobEvLate, nil); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil || len(ids) == 0 {
		return nil, err
	}
	out := make([]Job, 0, len(ids))
	for _, id := range ids {
		j, err := s.Job(ctx, id)
		if err == nil {
			out = append(out, j)
		}
	}
	return out, nil
}

// StopDistance returns the distance in meters from a point to a stop.
func StopDistance(st *JobStop, lat, lng float64) float64 { return Haversine(lat, lng, st.Lat, st.Lng) }
