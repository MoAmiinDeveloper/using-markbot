// Package schedule runs scheduled reports: it computes run times in each
// schedule's time zone, generates the report with the creator's access
// scope and delivers the export by Telegram (sendDocument) and email.
package schedule

import (
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/moamiindeveloper/fleet/server/internal/mail"
	"github.com/moamiindeveloper/fleet/server/internal/reports"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// Periods, frequencies and formats.
var (
	Periods     = []string{"yesterday", "today", "lastWeek", "thisWeek", "lastMonth", "thisMonth"}
	Frequencies = []string{"daily", "weekly", "monthly"}
	Formats     = []string{reports.FormatPDF, reports.FormatXLSX, reports.FormatCSV}
)

// Limits.
const (
	MaxEmails        = 20
	MaxTelegramUsers = 50
)

func invalid(format string, args ...any) error {
	return &store.ValidationError{Msg: fmt.Sprintf(format, args...)}
}

// Location loads a schedule's time zone (UTC when empty).
func Location(tz string) (*time.Location, error) {
	if tz == "" {
		return time.UTC, nil
	}
	return time.LoadLocation(tz)
}

// Normalize applies defaults and validates the schedule fields (not the
// references to devices/groups/users, which depend on the caller).
func Normalize(sc *store.ReportSchedule) error {
	sc.Name = strings.TrimSpace(sc.Name)
	sc.Timezone = strings.TrimSpace(sc.Timezone)
	sc.Format = strings.ToLower(strings.TrimSpace(sc.Format))
	if sc.Timezone == "" {
		sc.Timezone = "UTC"
	}
	if sc.Format == "" {
		sc.Format = reports.FormatPDF
	}
	if sc.Weekday == 7 { // ISO Sunday
		sc.Weekday = 0
	}
	switch {
	case sc.Name == "":
		return invalid("name is required")
	case utf8.RuneCountInString(sc.Name) > 100:
		return invalid("name must be at most 100 characters")
	case reports.Title(sc.ReportType) == "":
		return invalid("unknown reportType %q", sc.ReportType)
	case !slices.Contains(Periods, sc.Period):
		return invalid("period must be one of: %s", strings.Join(Periods, ", "))
	case !slices.Contains(Frequencies, sc.Frequency):
		return invalid("frequency must be one of: %s", strings.Join(Frequencies, ", "))
	case sc.Hour < 0 || sc.Hour > 23:
		return invalid("hour must be between 0 and 23")
	case sc.Weekday < 0 || sc.Weekday > 6:
		return invalid("weekday must be between 0 (Sunday) and 6 (Saturday)")
	case sc.MonthDay < 1 || sc.MonthDay > 31:
		return invalid("monthDay must be between 1 and 31")
	case !slices.Contains(Formats, sc.Format):
		return invalid("format must be pdf, xlsx or csv")
	}
	if _, err := Location(sc.Timezone); err != nil {
		return invalid("timezone must be an IANA time zone such as Africa/Mogadishu")
	}
	if len(sc.Emails) > MaxEmails {
		return invalid("at most %d emails", MaxEmails)
	}
	emails := []string{}
	for _, e := range sc.Emails {
		a, err := mail.ParseAddress(e)
		if err != nil {
			return invalid("invalid email address %q", e)
		}
		if !slices.Contains(emails, a) {
			emails = append(emails, a)
		}
	}
	sc.Emails = emails
	ids := []int64{}
	for _, id := range sc.TelegramUserIDs {
		if id <= 0 {
			return invalid("telegramUserIds must be user ids")
		}
		if !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	if len(ids) > MaxTelegramUsers {
		return invalid("at most %d telegramUserIds", MaxTelegramUsers)
	}
	sc.TelegramUserIDs = ids
	if len(sc.Emails) == 0 && len(sc.TelegramUserIDs) == 0 {
		return invalid("add at least one recipient (telegramUserIds or emails)")
	}
	dev := []int64{}
	for _, id := range sc.Filters.DeviceIDs {
		if id <= 0 {
			return invalid("filters.deviceIds must be device ids")
		}
		if !slices.Contains(dev, id) {
			dev = append(dev, id)
		}
	}
	sc.Filters.DeviceIDs = dev
	return nil
}

// matches reports whether a local calendar day is a run day.
func matches(sc *store.ReportSchedule, day time.Time) bool {
	switch sc.Frequency {
	case "weekly":
		return int(day.Weekday()) == sc.Weekday
	case "monthly":
		last := time.Date(day.Year(), day.Month()+1, 0, 0, 0, 0, 0, time.UTC).Day()
		return day.Day() == min(sc.MonthDay, last) // short months: last day
	}
	return true
}

// NextRun returns the first run time strictly after after, at sc.Hour:00
// local time on a matching day of the schedule's time zone. A run hour that
// does not exist on a DST change day runs at the first hour after the gap.
func NextRun(sc *store.ReportSchedule, after time.Time) time.Time {
	loc, err := Location(sc.Timezone)
	if err != nil {
		loc = time.UTC
	}
	y, m, d := after.In(loc).Date()
	for i := 0; i <= 400; i++ {
		day := time.Date(y, m, d+i, 12, 0, 0, 0, loc) // noon: never skipped by DST
		if !matches(sc, day) {
			continue
		}
		cand := time.Date(day.Year(), day.Month(), day.Day(), sc.Hour, 0, 0, 0, loc)
		if cand.Hour() != sc.Hour { // skipped by a DST change: run when clocks resume
			cand = time.Date(day.Year(), day.Month(), day.Day(), sc.Hour+1, 0, 0, 0, loc)
		}
		if cand.After(after) {
			return cand.UTC()
		}
	}
	return after.Add(24 * time.Hour).UTC() // unreachable for valid schedules
}

// LatestDue returns the most recent run time in (…, now] starting from due
// (a missed run time), so a server that was down for several periods runs
// a schedule once, for the latest missed occurrence.
func LatestDue(sc *store.ReportSchedule, due, now time.Time) time.Time {
	t := due
	for range 5000 {
		n := NextRun(sc, t)
		if n.After(now) {
			break
		}
		t = n
	}
	return t
}

// PeriodRange returns the report period for a run at ref, in loc. Week
// periods start on Monday. Ends of past periods are 1 µs before the next
// period starts (reports treat to as inclusive).
func PeriodRange(period string, ref time.Time, loc *time.Location) (from, to time.Time) {
	l := ref.In(loc)
	today := time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, loc)
	end := func(t time.Time) time.Time { return t.Add(-time.Microsecond) }
	day := func(t time.Time, n int) time.Time { return time.Date(t.Year(), t.Month(), t.Day()+n, 0, 0, 0, 0, loc) }
	monday := day(today, -((int(today.Weekday()) + 6) % 7))
	month := time.Date(l.Year(), l.Month(), 1, 0, 0, 0, 0, loc)
	switch period {
	case "today":
		return today.UTC(), ref.UTC()
	case "thisWeek":
		return monday.UTC(), ref.UTC()
	case "lastWeek":
		return day(monday, -7).UTC(), end(monday).UTC()
	case "thisMonth":
		return month.UTC(), ref.UTC()
	case "lastMonth":
		return time.Date(l.Year(), l.Month()-1, 1, 0, 0, 0, 0, loc).UTC(), end(month).UTC()
	}
	return day(today, -1).UTC(), end(today).UTC() // yesterday
}
