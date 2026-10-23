package schedule

import (
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

func mustLoc(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Skip("tzdata missing:", err)
	}
	return loc
}

func TestNextRun(t *testing.T) {
	mog := mustLoc(t, "Africa/Mogadishu")   // UTC+3, no DST
	ktm := mustLoc(t, "Asia/Kathmandu")     // UTC+5:45
	ny := mustLoc(t, "America/New_York")    // DST
	lhi := mustLoc(t, "Pacific/Kiritimati") // UTC+14
	cases := []struct {
		name  string
		sc    store.ReportSchedule
		after time.Time
		want  time.Time
	}{
		{"daily later today", store.ReportSchedule{Frequency: "daily", Hour: 7, Timezone: "Africa/Mogadishu"},
			time.Date(2026, 10, 23, 2, 0, 0, 0, time.UTC), time.Date(2026, 10, 23, 7, 0, 0, 0, mog)},
		{"daily exactly at run time → tomorrow", store.ReportSchedule{Frequency: "daily", Hour: 7, Timezone: "Africa/Mogadishu"},
			time.Date(2026, 10, 23, 7, 0, 0, 0, mog), time.Date(2026, 10, 24, 7, 0, 0, 0, mog)},
		{"daily local date differs from UTC", store.ReportSchedule{Frequency: "daily", Hour: 1, Timezone: "Africa/Mogadishu"},
			time.Date(2026, 10, 23, 22, 30, 0, 0, time.UTC), time.Date(2026, 10, 25, 1, 0, 0, 0, mog)},
		{"half-hour offset zone", store.ReportSchedule{Frequency: "daily", Hour: 0, Timezone: "Asia/Kathmandu"},
			time.Date(2026, 10, 23, 18, 0, 0, 0, time.UTC), time.Date(2026, 10, 24, 0, 0, 0, 0, ktm)},
		{"+14 zone", store.ReportSchedule{Frequency: "daily", Hour: 6, Timezone: "Pacific/Kiritimati"},
			time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC), time.Date(2026, 10, 24, 6, 0, 0, 0, lhi)},
		{"weekly monday", store.ReportSchedule{Frequency: "weekly", Hour: 8, Weekday: 1, Timezone: "Africa/Mogadishu"},
			time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC), time.Date(2026, 10, 26, 8, 0, 0, 0, mog)},
		{"weekly sunday same day before hour", store.ReportSchedule{Frequency: "weekly", Hour: 20, Weekday: 0, Timezone: "UTC"},
			time.Date(2026, 10, 25, 19, 59, 0, 0, time.UTC), time.Date(2026, 10, 25, 20, 0, 0, 0, time.UTC)},
		{"monthly 31 in February", store.ReportSchedule{Frequency: "monthly", Hour: 6, MonthDay: 31, Timezone: "UTC"},
			time.Date(2027, 2, 1, 0, 0, 0, 0, time.UTC), time.Date(2027, 2, 28, 6, 0, 0, 0, time.UTC)},
		{"monthly 31 leap February", store.ReportSchedule{Frequency: "monthly", Hour: 6, MonthDay: 31, Timezone: "UTC"},
			time.Date(2028, 2, 1, 0, 0, 0, 0, time.UTC), time.Date(2028, 2, 29, 6, 0, 0, 0, time.UTC)},
		{"monthly 31 in April then May", store.ReportSchedule{Frequency: "monthly", Hour: 6, MonthDay: 31, Timezone: "UTC"},
			time.Date(2027, 4, 30, 7, 0, 0, 0, time.UTC), time.Date(2027, 5, 31, 6, 0, 0, 0, time.UTC)},
		{"monthly 1st across year", store.ReportSchedule{Frequency: "monthly", Hour: 0, MonthDay: 1, Timezone: "Africa/Mogadishu"},
			time.Date(2026, 12, 31, 22, 0, 0, 0, time.UTC), time.Date(2027, 2, 1, 0, 0, 0, 0, mog)},
		{"DST spring-forward gap hour", store.ReportSchedule{Frequency: "daily", Hour: 2, Timezone: "America/New_York"},
			time.Date(2027, 3, 14, 0, 0, 0, 0, ny), time.Date(2027, 3, 14, 3, 0, 0, 0, ny)},
		{"DST fall-back", store.ReportSchedule{Frequency: "daily", Hour: 7, Timezone: "America/New_York"},
			time.Date(2026, 11, 1, 0, 0, 0, 0, ny), time.Date(2026, 11, 1, 7, 0, 0, 0, ny)},
	}
	for _, c := range cases {
		got := NextRun(&c.sc, c.after)
		if !got.Equal(c.want) {
			t.Errorf("%s: NextRun = %s, want %s", c.name, got, c.want.UTC())
		}
		if got.Location() != time.UTC {
			t.Errorf("%s: not UTC", c.name)
		}
	}
	// The run after the DST change is 24 h + 1 h of wall clock later in UTC.
	sc := store.ReportSchedule{Frequency: "daily", Hour: 7, Timezone: "America/New_York"}
	a := NextRun(&sc, time.Date(2026, 10, 31, 0, 0, 0, 0, ny))
	b := NextRun(&sc, a)
	if b.Sub(a) != 25*time.Hour {
		t.Errorf("fall-back interval %v", b.Sub(a))
	}
}

func TestLatestDue(t *testing.T) {
	sc := store.ReportSchedule{Frequency: "daily", Hour: 7, Timezone: "UTC"}
	due := time.Date(2026, 10, 20, 7, 0, 0, 0, time.UTC)
	now := time.Date(2026, 10, 23, 9, 0, 0, 0, time.UTC)
	if got := LatestDue(&sc, due, now); !got.Equal(time.Date(2026, 10, 23, 7, 0, 0, 0, time.UTC)) {
		t.Errorf("LatestDue = %s", got)
	}
	if got := LatestDue(&sc, due, due); !got.Equal(due) {
		t.Errorf("not missed: %s", got)
	}
}

func TestPeriodRange(t *testing.T) {
	mog := mustLoc(t, "Africa/Mogadishu")
	ref := time.Date(2026, 10, 23, 7, 0, 0, 0, mog) // Friday
	us := time.Microsecond
	cases := map[string][2]time.Time{
		"yesterday": {time.Date(2026, 10, 22, 0, 0, 0, 0, mog), time.Date(2026, 10, 23, 0, 0, 0, 0, mog).Add(-us)},
		"today":     {time.Date(2026, 10, 23, 0, 0, 0, 0, mog), ref},
		"thisWeek":  {time.Date(2026, 10, 19, 0, 0, 0, 0, mog), ref},
		"lastWeek":  {time.Date(2026, 10, 12, 0, 0, 0, 0, mog), time.Date(2026, 10, 19, 0, 0, 0, 0, mog).Add(-us)},
		"thisMonth": {time.Date(2026, 10, 1, 0, 0, 0, 0, mog), ref},
		"lastMonth": {time.Date(2026, 9, 1, 0, 0, 0, 0, mog), time.Date(2026, 10, 1, 0, 0, 0, 0, mog).Add(-us)},
	}
	for p, want := range cases {
		from, to := PeriodRange(p, ref, mog)
		if !from.Equal(want[0]) || !to.Equal(want[1]) {
			t.Errorf("%s: %s – %s, want %s – %s", p, from, to, want[0], want[1])
		}
	}
	// Sunday belongs to the week that started on Monday; January → December.
	sun := time.Date(2027, 1, 3, 10, 0, 0, 0, time.UTC)
	if from, _ := PeriodRange("thisWeek", sun, time.UTC); !from.Equal(time.Date(2026, 12, 28, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("sunday week start %s", from)
	}
	if from, to := PeriodRange("lastMonth", sun, time.UTC); !from.Equal(time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC)) ||
		!to.Equal(time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC).Add(-us)) {
		t.Errorf("lastMonth over new year %s %s", from, to)
	}
}

func TestNormalize(t *testing.T) {
	ok := store.ReportSchedule{Name: " Daily ", ReportType: "summary", Period: "yesterday", Frequency: "weekly",
		Weekday: 7, MonthDay: 1, Emails: []string{"Ops <ops@example.com>", "ops@example.com"}}
	if err := Normalize(&ok); err != nil {
		t.Fatal(err)
	}
	if ok.Name != "Daily" || ok.Weekday != 0 || ok.Timezone != "UTC" || ok.Format != "pdf" || len(ok.Emails) != 1 ||
		ok.Emails[0] != "ops@example.com" {
		t.Fatalf("normalized %+v", ok)
	}
	for _, bad := range []store.ReportSchedule{
		{Name: "x", ReportType: "nope", Period: "today", Frequency: "daily", MonthDay: 1, Emails: []string{"a@b.c"}},
		{Name: "x", ReportType: "fuel", Period: "today", Frequency: "daily", MonthDay: 1},
		{Name: "x", ReportType: "fuel", Period: "today", Frequency: "daily", MonthDay: 1, Emails: []string{"bad"}},
		{Name: "x", ReportType: "fuel", Period: "today", Frequency: "daily", MonthDay: 1, Hour: 24, Emails: []string{"a@b.c"}},
		{Name: "x", ReportType: "fuel", Period: "today", Frequency: "daily", MonthDay: 1, Timezone: "Mars/Base", Emails: []string{"a@b.c"}},
		{Name: "x", ReportType: "fuel", Period: "today", Frequency: "hourly", MonthDay: 1, Emails: []string{"a@b.c"}},
		{Name: "x", ReportType: "fuel", Period: "today", Frequency: "daily", MonthDay: 32, Emails: []string{"a@b.c"}},
	} {
		if err := Normalize(&bad); err == nil {
			t.Errorf("accepted %+v", bad)
		}
	}
}
