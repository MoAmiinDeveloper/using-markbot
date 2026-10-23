package schedule

import (
	"context"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	netmail "net/mail"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/mail/mailtest"
	"github.com/moamiindeveloper/fleet/server/internal/notify"
	"github.com/moamiindeveloper/fleet/server/internal/reports"
	"github.com/moamiindeveloper/fleet/server/internal/store"
	"github.com/moamiindeveloper/fleet/server/internal/store/storetest"
)

const botToken = "42:test"

type tgDoc struct {
	Chat, Caption, Name string
	Data                []byte
}

// fakeBot accepts sendDocument (multipart) like the Bot API.
type fakeBot struct {
	*httptest.Server
	mu   sync.Mutex
	docs []tgDoc
}

func newFakeBot(t *testing.T) *fakeBot {
	f := &fakeBot{}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/bot"+botToken+"/sendDocument" {
			w.WriteHeader(404)
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": 404, "description": "Not Found"})
			return
		}
		mt, params, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if mt != "multipart/form-data" {
			w.WriteHeader(400)
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": 400, "description": "bad type " + mt})
			return
		}
		var d tgDoc
		mr := multipart.NewReader(r.Body, params["boundary"])
		for {
			p, err := mr.NextPart()
			if err != nil {
				break
			}
			b, _ := io.ReadAll(p)
			switch p.FormName() {
			case "chat_id":
				d.Chat = string(b)
			case "caption":
				d.Caption = string(b)
			case "document":
				d.Name, d.Data = p.FileName(), b
			}
		}
		if d.Chat == "666" {
			w.WriteHeader(403)
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": 403, "description": "Forbidden: bot was blocked by the user"})
			return
		}
		f.mu.Lock()
		f.docs = append(f.docs, d)
		f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": map[string]any{"message_id": 1}})
	}))
	t.Cleanup(f.Close)
	return f
}

func (f *fakeBot) Docs() []tgDoc {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]tgDoc(nil), f.docs...)
}

func TestSchedulerCatchUpAndDelivery(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 10, 23, 9, 30, 0, 0, time.UTC)
	st := storetest.New(t, "schedule_test", store.Options{AutoRegister: true, Now: func() time.Time { return now }})
	if _, err := st.EnsureAdmin(ctx, "admin@fleet.local", "admin"); err != nil {
		t.Fatal(err)
	}
	admin, err := st.Authenticate(ctx, "admin@fleet.local", "admin")
	if err != nil {
		t.Fatal(err)
	}
	other, err := st.CreateUser(ctx, "viewer@fleet.local", "Viewer", "secret1", store.RoleViewer)
	if err != nil {
		t.Fatal(err)
	}
	dev, err := st.CreateDevice(ctx, store.DeviceInput{Name: "Truck 07", IMEI: "356307042441013"})
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := st.Authorize(ctx, dev.IMEI, "teltonika"); !ok || err != nil {
		t.Fatal(ok, err)
	}
	var ps []domain.Position
	for i := range 30 {
		ps = append(ps, domain.Position{IMEI: dev.IMEI, DeviceTime: time.Date(2026, 10, 22, 8, i, 0, 0, time.UTC),
			Latitude: 2.04 + float64(i)*0.001, Longitude: 45.3, Speed: 40, Valid: true, Satellites: 9,
			Attributes: map[string]any{"ignition": true}})
	}
	if err := st.Positions(ctx, ps); err != nil {
		t.Fatal(err)
	}

	bot := newFakeBot(t)
	smtp := mailtest.New(t, false)
	if _, err := st.UpdateSettings(ctx, func(c *store.Settings) error {
		c.TelegramBotToken, c.TelegramBotUsername = botToken, "bot"
		c.SMTP = store.SMTPSettings{Host: smtp.Host, Port: smtp.Port, From: "Fleet <fleet@example.com>", TLS: store.SMTPNone}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := st.LinkTelegram(ctx, admin.ID, 1001); err != nil {
		t.Fatal(err)
	}
	nt, err := notify.New(ctx, st, notify.Options{TelegramAPIURL: bot.URL})
	if err != nil {
		t.Fatal(err)
	}
	svc := New(st, reports.New(st, nil, nil), nt, nil)
	svc.Now = func() time.Time { return now }

	uid := admin.ID
	sc := store.ReportSchedule{Name: "Daily", ReportType: "summary", Period: "yesterday", Frequency: "daily", Hour: 7,
		Weekday: 1, MonthDay: 1, Timezone: "UTC", Format: "csv", TelegramUserIDs: []int64{admin.ID},
		Emails: []string{"ops@example.com"}, Enabled: true, CreatedBy: &uid}
	if err := Normalize(&sc); err != nil {
		t.Fatal(err)
	}
	// Server was down: the 20th, 21st, 22nd and 23rd 07:00 runs were missed.
	sc.NextRunAt = time.Date(2026, 10, 20, 7, 0, 0, 0, time.UTC)
	sc, err = st.CreateReportSchedule(ctx, sc)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.RunDue(ctx); err != nil {
		t.Fatal(err)
	}
	if err := svc.RunDue(ctx); err != nil { // nothing left
		t.Fatal(err)
	}
	runs, err := st.ReportRuns(ctx, sc.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || runs[0].Status != "ok" || runs[0].Manual || len(runs[0].Recipients) != 2 {
		t.Fatalf("runs %+v", runs)
	}
	got, _ := st.ReportSchedule(ctx, sc.ID)
	if !got.NextRunAt.Equal(time.Date(2026, 10, 24, 7, 0, 0, 0, time.UTC)) || got.LastStatus == nil ||
		*got.LastStatus != "ok" || got.LastRunAt == nil {
		t.Fatalf("schedule after run %+v", got)
	}
	// The catch-up run covers the latest missed occurrence (the 23rd → the 22nd).
	docs := bot.Docs()
	if len(docs) != 1 || docs[0].Chat != "1001" || docs[0].Name != "summary_2026-10-22_2026-10-22.csv" ||
		!strings.Contains(docs[0].Caption, "Daily: Travel summary, 2026-10-22") ||
		!strings.Contains(string(docs[0].Data), "Truck 07") {
		t.Fatalf("telegram docs %+v", docs)
	}
	msgs := smtp.Messages()
	if len(msgs) != 1 || msgs[0].To[0] != "ops@example.com" {
		t.Fatalf("emails %+v", msgs)
	}
	m, err := netmail.ReadMessage(strings.NewReader(msgs[0].Data))
	if err != nil {
		t.Fatal(err)
	}
	if mt, _, _ := mime.ParseMediaType(m.Header.Get("Content-Type")); mt != "multipart/mixed" ||
		!strings.Contains(msgs[0].Data, `filename="summary_2026-10-22_2026-10-22.csv"`) {
		t.Fatalf("email %s", msgs[0].Data)
	}

	// Manual run with a partly failing recipient list.
	sc.TelegramUserIDs = []int64{admin.ID, other.ID} // other has no linked chat
	sc.Emails = []string{"ops@example.com", "nobody@example.com"}
	smtp.RejectRcpt = "nobody"
	run := svc.Execute(ctx, sc, now, true)
	if run.Status != "error" || !run.Manual || len(run.Recipients) != 2 ||
		!strings.Contains(run.Error, "no Telegram chat is linked") || !strings.Contains(run.Error, "nobody@example.com") {
		t.Fatalf("partial run %+v", run)
	}
	// A blocked bot unlinks the chat.
	if err := st.LinkTelegram(ctx, other.ID, 666); err != nil {
		t.Fatal(err)
	}
	sc.TelegramUserIDs, sc.Emails = []int64{other.ID}, nil
	if run := svc.Execute(ctx, sc, now, true); run.Status != "error" {
		t.Fatalf("blocked %+v", run)
	}
	if chat, _ := st.TelegramChat(ctx, other.ID); chat != 0 {
		t.Fatal("blocked chat still linked")
	}
	// The owner's scope: a deactivated owner cannot send reports.
	sc.CreatedBy = &other.ID
	if _, err := st.UpdateUser(ctx, admin.ID, other.ID, store.UserPatch{Active: ptrBool(false)}); err != nil {
		t.Fatal(err)
	}
	if run := svc.Execute(ctx, sc, now, true); run.Status != "error" || !strings.Contains(run.Error, "owner") {
		t.Fatalf("deactivated owner %+v", run)
	}
	runs, _ = st.ReportRuns(ctx, sc.ID, 10)
	if len(runs) != 4 || !runs[0].Manual {
		t.Fatalf("run log %+v", runs)
	}
}

func ptrBool(b bool) *bool { return &b }
