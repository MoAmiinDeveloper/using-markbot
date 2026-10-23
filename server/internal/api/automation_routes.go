package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/mail"
	"github.com/moamiindeveloper/fleet/server/internal/notify"
	"github.com/moamiindeveloper/fleet/server/internal/schedule"
	"github.com/moamiindeveloper/fleet/server/internal/sensors"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// mountAutomation registers scheduled reports, email (SMTP) and sensor
// routes (Phase 4a, automation module). Called inside the authenticated group.
func (s *Server) mountAutomation(r chi.Router) {
	if s.cfg.Scheduler == nil && s.cfg.Notifier != nil {
		// Run-now only; fleetd runs the real scheduler loop.
		s.cfg.Scheduler = schedule.New(s.store, s.cfg.Reports, s.cfg.Notifier, s.log)
	}

	r.Get("/sensors", s.handleListSensors)
	r.Group(func(r chi.Router) {
		r.Use(requireManager)
		r.Post("/sensors", s.handleCreateSensor)
		r.Patch("/sensors/{id}", s.handleUpdateSensor)
		r.Delete("/sensors/{id}", s.handleDeleteSensor)

		r.Get("/report-schedules", s.handleListSchedules)
		r.Post("/report-schedules", s.handleCreateSchedule)
		r.Get("/report-schedules/{id}", s.handleGetSchedule)
		r.Patch("/report-schedules/{id}", s.handleUpdateSchedule)
		r.Delete("/report-schedules/{id}", s.handleDeleteSchedule)
		r.Post("/report-schedules/{id}/run", s.handleRunSchedule)
		r.Get("/report-schedules/{id}/runs", s.handleScheduleRuns)
	})
	r.Group(func(r chi.Router) {
		r.Use(requireAdmin)
		r.Post("/settings/smtp/test", s.handleSMTPTest)
	})
}

// mergeJSON overlays the top-level keys of the request body on base and
// decodes the result into out (PATCH = partial update, null clears).
func mergeJSON(w http.ResponseWriter, r *http.Request, base, out any) error {
	var patch map[string]json.RawMessage
	if err := decodeJSON(w, r, &patch); err != nil {
		return err
	}
	if patch == nil {
		return &store.ValidationError{Msg: "invalid JSON body"}
	}
	raw, err := json.Marshal(base)
	if err != nil {
		return err
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return err
	}
	for k, v := range patch {
		obj[k] = v
	}
	raw, _ = json.Marshal(obj)
	if err := json.Unmarshal(raw, out); err != nil {
		return &store.ValidationError{Msg: "invalid field types in body"}
	}
	return nil
}

// ---- SMTP ----

// smtpView is Settings.smtp; the password is write-only.
type smtpView struct {
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Username   string `json:"username"`
	Password   string `json:"password"` // always ""
	From       string `json:"from"`
	TLS        string `json:"tls"`
	Configured bool   `json:"configured"`
}

func viewSMTP(c store.SMTPSettings, admin bool) smtpView {
	v := smtpView{Configured: c.Configured(), Port: c.Port, TLS: c.TLS}
	if admin {
		v.Host, v.Username, v.From = c.Host, c.Username, c.From
	}
	return v
}

// smtpPatch is PATCH /settings {"smtp": {...}}: any subset of fields.
// password: omitted, null or "" keeps the stored one; clearing username
// also clears the password.
type smtpPatch struct {
	Host     *string  `json:"host"`
	Port     *float64 `json:"port"`
	Username *string  `json:"username"`
	Password *string  `json:"password"`
	From     *string  `json:"from"`
	TLS      *string  `json:"tls"`
}

func (p *smtpPatch) apply(c store.SMTPSettings) (store.SMTPSettings, error) {
	if p == nil {
		return c, nil
	}
	bad := func(msg string) (store.SMTPSettings, error) { return c, &store.ValidationError{Msg: msg} }
	if p.Host != nil {
		h := strings.TrimSpace(*p.Host)
		if len(h) > 253 || strings.ContainsAny(h, " /:@") {
			return bad("smtp.host must be a host name or IP address")
		}
		c.Host = h
	}
	if p.Port != nil {
		v := *p.Port
		if !(v >= 1 && v <= 65535 && v == float64(int(v))) {
			return bad("smtp.port must be between 1 and 65535")
		}
		c.Port = int(v)
	}
	if p.Username != nil {
		c.Username = strings.TrimSpace(*p.Username)
		if c.Username == "" {
			c.Password = ""
		}
	}
	if p.Password != nil && *p.Password != "" {
		c.Password = *p.Password
	}
	if p.From != nil {
		f := strings.TrimSpace(*p.From)
		if f != "" {
			if _, err := mail.ParseAddress(f); err != nil {
				return bad("smtp.from must be an email address, e.g. Somtel Fleet <fleet@example.com>")
			}
		}
		c.From = f
	}
	if p.TLS != nil {
		t := strings.ToLower(strings.TrimSpace(*p.TLS))
		if t != store.SMTPStartTLS && t != store.SMTPTLS && t != store.SMTPNone {
			return bad("smtp.tls must be starttls, tls or none")
		}
		c.TLS = t
	}
	if c.Host != "" && c.From == "" {
		return bad("smtp.from is required")
	}
	return c, nil
}

func (s *Server) handleSMTPTest(w http.ResponseWriter, r *http.Request) {
	var req struct {
		To string `json:"to"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	to := strings.TrimSpace(req.To)
	if to == "" {
		if u, err := s.store.UserByID(r.Context(), principalFrom(r.Context()).UserID); err == nil {
			to = u.Email
		}
	}
	addr, err := mail.ParseAddress(to)
	if err != nil {
		writeError(w, http.StatusBadRequest, "to must be an email address")
		return
	}
	err = s.cfg.Notifier.SendEmail(r.Context(), mail.Message{To: []string{addr}, Subject: "Somtel Fleet test email",
		Text: "This is a test email from Somtel Fleet.\n\nEmail delivery (SMTP) is working.\n"})
	switch {
	case errors.Is(err, notify.ErrEmailNotConfigured):
		writeError(w, http.StatusConflict, err.Error())
	case err != nil:
		writeError(w, http.StatusBadGateway, "sending failed: "+err.Error())
	default:
		writeJSON(w, http.StatusOK, map[string]any{"sent": true, "to": addr})
	}
}

// ---- sensors ----

func (s *Server) handleListSensors(w http.ResponseWriter, r *http.Request) {
	var devID int64
	if v := r.URL.Query().Get("deviceId"); v != "" {
		id, err := strconv.ParseInt(v, 10, 64)
		if err != nil || id <= 0 {
			writeError(w, http.StatusBadRequest, "deviceId must be a positive integer")
			return
		}
		if !s.canSeeDevice(r, id) {
			writeError(w, http.StatusNotFound, "device not found")
			return
		}
		devID = id
	}
	all, scope := s.deviceScope(r)
	list, err := s.store.Sensors(r.Context(), devID, all, scope)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleCreateSensor(w http.ResponseWriter, r *http.Request) {
	var in store.SensorInput
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	if in.DeviceID != 0 && !s.canSeeDevice(r, in.DeviceID) {
		writeError(w, http.StatusBadRequest, "unknown deviceId")
		return
	}
	sn, err := s.store.CreateSensor(r.Context(), in)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, sn)
}

// visibleSensor loads {id}, hiding sensors of devices outside the scope.
func (s *Server) visibleSensor(w http.ResponseWriter, r *http.Request) (store.Sensor, bool) {
	id, err := pathID(r)
	var sn store.Sensor
	if err == nil {
		sn, err = s.store.Sensor(r.Context(), id)
	}
	if err == nil && !s.canSeeDevice(r, sn.DeviceID) {
		err = store.ErrNotFound
	}
	if err != nil {
		s.failAs(w, r, err, "sensor not found")
		return sn, false
	}
	return sn, true
}

func (s *Server) handleUpdateSensor(w http.ResponseWriter, r *http.Request) {
	sn, ok := s.visibleSensor(w, r)
	if !ok {
		return
	}
	var in store.SensorInput
	if err := mergeJSON(w, r, sn.Input(), &in); err != nil {
		s.fail(w, r, err)
		return
	}
	if !s.canSeeDevice(r, in.DeviceID) {
		writeError(w, http.StatusBadRequest, "unknown deviceId")
		return
	}
	out, err := s.store.UpdateSensor(r.Context(), sn.ID, in)
	if err != nil {
		s.failAs(w, r, err, "sensor not found")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleDeleteSensor(w http.ResponseWriter, r *http.Request) {
	sn, ok := s.visibleSensor(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteSensor(r.Context(), sn.ID); err != nil {
		s.failAs(w, r, err, "sensor not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// positionView is a Position with computed sensor values (?sensors=1).
type positionView struct {
	domain.Position
	Sensors map[string]float64 `json:"sensors"`
}

// positionsWithSensors computes each sensor's smoothed value along the
// returned positions (smoothing restarts at the first returned fix).
func (s *Server) positionsWithSensors(deviceID int64, ps []domain.Position) []positionView {
	list := s.store.DeviceSensors(deviceID)
	meds := make([]sensors.Median, len(list))
	for i := range list {
		meds[i].N = list[i].Smoothing
	}
	out := make([]positionView, len(ps))
	for i := range ps {
		out[i] = positionView{Position: ps[i], Sensors: map[string]float64{}}
		for j := range list {
			sn := &list[j]
			if raw, ok := sensors.Raw(ps[i].Attributes, sn.Source); ok {
				v := meds[j].Add(sensors.Calibrate(sn, raw))
				out[i].Sensors[strconv.FormatInt(sn.ID, 10)] = store.RoundTo(v, sn.Decimals)
			}
		}
	}
	return out
}

// ---- scheduled reports ----

// scheduleInput is the body of POST (and merged PATCH) /report-schedules.
type scheduleInput struct {
	Name            string                `json:"name"`
	ReportType      string                `json:"reportType"`
	Filters         store.ScheduleFilters `json:"filters"`
	Period          string                `json:"period"`
	Frequency       string                `json:"frequency"`
	Hour            *int                  `json:"hour"`
	Weekday         *int                  `json:"weekday"`
	MonthDay        *int                  `json:"monthDay"`
	Timezone        string                `json:"timezone"`
	Format          string                `json:"format"`
	TelegramUserIDs []int64               `json:"telegramUserIds"`
	Emails          []string              `json:"emails"`
	Enabled         *bool                 `json:"enabled"`
}

func intOr(p *int, def int) int {
	if p == nil {
		return def
	}
	return *p
}

// toSchedule validates the input, including references, for the caller.
func (s *Server) toSchedule(r *http.Request, in scheduleInput) (store.ReportSchedule, error) {
	sc := store.ReportSchedule{Name: in.Name, ReportType: in.ReportType, Filters: in.Filters, Period: in.Period,
		Frequency: in.Frequency, Hour: intOr(in.Hour, 7), Weekday: intOr(in.Weekday, 1), MonthDay: intOr(in.MonthDay, 1),
		Timezone: in.Timezone, Format: in.Format, TelegramUserIDs: in.TelegramUserIDs, Emails: in.Emails, Enabled: true}
	if in.Enabled != nil {
		sc.Enabled = *in.Enabled
	}
	if sc.Period == "" {
		sc.Period = "yesterday"
	}
	if sc.Frequency == "" {
		sc.Frequency = "daily"
	}
	if err := schedule.Normalize(&sc); err != nil {
		return sc, err
	}
	for _, id := range sc.Filters.DeviceIDs {
		if _, err := s.store.Device(id); err != nil || !s.canSeeDevice(r, id) {
			return sc, &store.ValidationError{Msg: "unknown device in filters.deviceIds"}
		}
	}
	if g := sc.Filters.GroupID; g != nil {
		if _, err := s.store.GroupDeviceIDs(r.Context(), *g); err != nil {
			if errors.Is(err, store.ErrNotFound) {
				return sc, &store.ValidationError{Msg: "unknown filters.groupId"}
			}
			return sc, err
		}
	}
	if d := sc.Filters.DriverID; d != nil && *d <= 0 {
		return sc, &store.ValidationError{Msg: "filters.driverId must be a driver id"}
	}
	for _, id := range sc.TelegramUserIDs {
		if _, err := s.store.UserByID(r.Context(), id); err != nil {
			if errors.Is(err, store.ErrNotFound) {
				return sc, &store.ValidationError{Msg: "unknown user in telegramUserIds"}
			}
			return sc, err
		}
	}
	return sc, nil
}

// visibleSchedule loads {id}: admins see every schedule, managers their own.
func (s *Server) visibleSchedule(w http.ResponseWriter, r *http.Request) (store.ReportSchedule, bool) {
	id, err := pathID(r)
	var sc store.ReportSchedule
	if err == nil {
		sc, err = s.store.ReportSchedule(r.Context(), id)
	}
	p := principalFrom(r.Context())
	if err == nil && p.Role != store.RoleAdmin && (sc.CreatedBy == nil || *sc.CreatedBy != p.UserID) {
		err = store.ErrNotFound
	}
	if err != nil {
		s.failAs(w, r, err, "schedule not found")
		return sc, false
	}
	return sc, true
}

func (s *Server) handleListSchedules(w http.ResponseWriter, r *http.Request) {
	p := principalFrom(r.Context())
	var by int64
	if p.Role != store.RoleAdmin {
		by = p.UserID
	}
	list, err := s.store.ReportSchedules(r.Context(), by)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleGetSchedule(w http.ResponseWriter, r *http.Request) {
	if sc, ok := s.visibleSchedule(w, r); ok {
		writeJSON(w, http.StatusOK, sc)
	}
}

func (s *Server) handleCreateSchedule(w http.ResponseWriter, r *http.Request) {
	var in scheduleInput
	if err := decodeJSON(w, r, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	sc, err := s.toSchedule(r, in)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	uid := principalFrom(r.Context()).UserID
	sc.CreatedBy = &uid
	sc.NextRunAt = schedule.NextRun(&sc, time.Now())
	out, err := s.store.CreateReportSchedule(r.Context(), sc)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

func (s *Server) handleUpdateSchedule(w http.ResponseWriter, r *http.Request) {
	cur, ok := s.visibleSchedule(w, r)
	if !ok {
		return
	}
	var in scheduleInput
	if err := mergeJSON(w, r, cur, &in); err != nil {
		s.fail(w, r, err)
		return
	}
	sc, err := s.toSchedule(r, in)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	sc.ID = cur.ID
	sc.NextRunAt = schedule.NextRun(&sc, time.Now())
	out, err := s.store.UpdateReportSchedule(r.Context(), sc)
	if err != nil {
		s.failAs(w, r, err, "schedule not found")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleDeleteSchedule(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.visibleSchedule(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteReportSchedule(r.Context(), sc.ID); err != nil {
		s.failAs(w, r, err, "schedule not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRunSchedule(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.visibleSchedule(w, r)
	if !ok {
		return
	}
	if s.cfg.Scheduler == nil {
		writeError(w, http.StatusServiceUnavailable, "the report scheduler is not available")
		return
	}
	// Finish (and log) the run even if the client goes away.
	ctx := context.WithoutCancel(r.Context())
	run := s.cfg.Scheduler.Execute(ctx, sc, time.Now(), true)
	writeJSON(w, http.StatusOK, run)
}

func (s *Server) handleScheduleRuns(w http.ResponseWriter, r *http.Request) {
	sc, ok := s.visibleSchedule(w, r)
	if !ok {
		return
	}
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			writeError(w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		limit = min(n, 100)
	}
	runs, err := s.store.ReportRuns(r.Context(), sc.ID, limit)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, runs)
}
