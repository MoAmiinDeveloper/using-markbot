package schedule

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/mail"
	"github.com/moamiindeveloper/fleet/server/internal/reports"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// Defaults.
const (
	DefaultInterval = 30 * time.Second // how often due schedules are looked up
	RunTimeout      = 5 * time.Minute  // report generation + delivery
)

// Deliverer sends report files (*notify.Service).
type Deliverer interface {
	SendTelegramDocument(ctx context.Context, userID int64, name string, data []byte, caption string) error
	SendEmail(ctx context.Context, msg mail.Message) error
}

// Service runs due schedules and executes runs on demand.
type Service struct {
	st       *store.Store
	reports  *reports.Engine
	deliver  Deliverer
	log      *slog.Logger
	Interval time.Duration
	Now      func() time.Time
}

// New returns a service; log may be nil.
func New(st *store.Store, eng *reports.Engine, d Deliverer, log *slog.Logger) *Service {
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	return &Service{st: st, reports: eng, deliver: d, log: log, Interval: DefaultInterval, Now: time.Now}
}

// Run executes due schedules until ctx is done. A schedule missed while the
// server was down runs once, for its latest missed occurrence.
func (s *Service) Run(ctx context.Context) {
	t := time.NewTicker(s.Interval)
	defer t.Stop()
	for {
		if err := s.RunDue(ctx); err != nil && ctx.Err() == nil {
			s.log.Error("schedule: run due", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// RunDue runs every schedule whose next run time has passed.
func (s *Service) RunDue(ctx context.Context) error {
	now := s.Now().UTC()
	due, err := s.st.DueReportSchedules(ctx, now)
	if err != nil {
		return err
	}
	for _, sc := range due {
		if ctx.Err() != nil {
			return nil
		}
		ref := LatestDue(&sc, sc.NextRunAt, now)
		next := NextRun(&sc, now)
		ok, err := s.st.ClaimReportSchedule(ctx, sc.ID, sc.NextRunAt, next)
		if err != nil {
			return err
		}
		if !ok {
			continue // edited or claimed by another instance meanwhile
		}
		run := s.Execute(ctx, sc, ref, false)
		s.log.Info("schedule: report sent", "schedule", sc.ID, "name", sc.Name, "status", run.Status,
			"recipients", len(run.Recipients), "err", run.Error)
	}
	return nil
}

// Execute generates the report of sc for a run at ref, delivers it and
// records the run. Errors are reported in the returned run.
func (s *Service) Execute(ctx context.Context, sc store.ReportSchedule, ref time.Time, manual bool) store.ReportRun {
	ctx, cancel := context.WithTimeout(ctx, RunTimeout)
	defer cancel()
	run := store.ReportRun{Time: s.Now().UTC().Truncate(time.Microsecond), Manual: manual, Recipients: []string{}}
	var errs []string
	file, name, caption, err := s.generate(ctx, &sc, ref)
	if err != nil {
		errs = append(errs, err.Error())
	} else {
		for _, uid := range sc.TelegramUserIDs {
			who := fmt.Sprintf("user %d", uid)
			if u, err := s.st.UserByID(ctx, uid); err == nil {
				who = u.Email
			} else if errors.Is(err, store.ErrNotFound) {
				errs = append(errs, fmt.Sprintf("telegram %s: user no longer exists", who))
				continue
			}
			if err := s.deliver.SendTelegramDocument(ctx, uid, name, file, caption); err != nil {
				errs = append(errs, fmt.Sprintf("telegram %s: %v", who, err))
				continue
			}
			run.Recipients = append(run.Recipients, "telegram:"+who)
		}
		ct := reports.ContentType(sc.Format)
		for _, addr := range sc.Emails {
			msg := mail.Message{To: []string{addr}, Subject: caption,
				Text:        caption + "\n\nThe report is attached.\n\n-- \nSomtel Fleet scheduled report \"" + sc.Name + "\"\n",
				Attachments: []mail.Attachment{{Name: name, ContentType: ct, Data: file}}}
			if err := s.deliver.SendEmail(ctx, msg); err != nil {
				errs = append(errs, fmt.Sprintf("email %s: %v", addr, err))
				continue
			}
			run.Recipients = append(run.Recipients, "email:"+addr)
		}
		if len(run.Recipients) == 0 && len(errs) == 0 {
			errs = append(errs, "no recipients")
		}
	}
	run.Status = "ok"
	if len(errs) > 0 {
		run.Status, run.Error = "error", strings.Join(errs, "; ")
	}
	rctx, rcancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer rcancel()
	if err := s.st.RecordReportRun(rctx, sc.ID, run); err != nil {
		s.log.Error("schedule: record run", "schedule", sc.ID, "err", err)
	}
	return run
}

// generate builds and exports the report with the creator's access scope.
func (s *Service) generate(ctx context.Context, sc *store.ReportSchedule, ref time.Time) (data []byte, name, caption string, err error) {
	if sc.CreatedBy == nil {
		return nil, "", "", errors.New("the schedule's owner no longer exists")
	}
	if _, ok := s.st.UserRole(*sc.CreatedBy); !ok {
		return nil, "", "", errors.New("the schedule's owner was deleted or deactivated")
	}
	loc, err := Location(sc.Timezone)
	if err != nil {
		return nil, "", "", fmt.Errorf("invalid time zone %q", sc.Timezone)
	}
	devs, all, err := s.devices(ctx, sc)
	if err != nil {
		return nil, "", "", err
	}
	from, to := PeriodRange(sc.Period, ref, loc)
	var driverID int64
	if sc.Filters.DriverID != nil {
		driverID = *sc.Filters.DriverID
	}
	now := s.Now()
	rep, err := s.reports.Run(ctx, reports.Request{Type: sc.ReportType, Devices: devs, DriverID: driverID,
		From: from, To: to, Loc: loc, Now: now, AllDevices: all})
	if err != nil {
		return nil, "", "", fmt.Errorf("generate report: %w", err)
	}
	var buf bytes.Buffer
	switch sc.Format {
	case reports.FormatCSV:
		err = reports.WriteCSV(&buf, rep, loc)
	case reports.FormatXLSX:
		err = reports.WriteXLSX(&buf, rep, loc, now)
	default:
		err = reports.WritePDF(&buf, rep, loc, now)
	}
	if err != nil {
		return nil, "", "", fmt.Errorf("export %s: %w", sc.Format, err)
	}
	period := from.In(loc).Format("2006-01-02")
	if t := to.In(loc).Format("2006-01-02"); t != period {
		period += " – " + t
	}
	caption = fmt.Sprintf("%s: %s, %s", sc.Name, rep.Title, period)
	return buf.Bytes(), reports.Filename(rep, loc, sc.Format), caption, nil
}

// devices resolves the schedule's filters within the owner's scope.
// Devices deleted or no longer visible are skipped.
func (s *Service) devices(ctx context.Context, sc *store.ReportSchedule) ([]store.Device, bool, error) {
	scopeAll, scope := s.st.DeviceScope(*sc.CreatedBy)
	var group map[int64]bool
	if g := sc.Filters.GroupID; g != nil {
		ids, err := s.st.GroupDeviceIDs(ctx, *g)
		if errors.Is(err, store.ErrNotFound) {
			return nil, false, errors.New("the schedule's group no longer exists")
		}
		if err != nil {
			return nil, false, err
		}
		group = map[int64]bool{}
		for _, id := range ids {
			group[id] = true
		}
	}
	want := map[int64]bool{}
	for _, id := range sc.Filters.DeviceIDs {
		want[id] = true
	}
	var out []store.Device
	for _, d := range s.st.Devices() {
		if (!scopeAll && !scope[d.ID]) || (len(want) > 0 && !want[d.ID]) || (group != nil && !group[d.ID]) {
			continue
		}
		out = append(out, d)
	}
	return out, len(want) == 0 && group == nil, nil
}
