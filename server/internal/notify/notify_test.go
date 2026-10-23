package notify

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/store"
	"github.com/moamiindeveloper/fleet/server/internal/store/storetest"
)

const goodToken = "123456:good-token"

type sentMessage struct {
	ChatID    int64  `json:"chat_id"`
	Text      string `json:"text"`
	ParseMode string `json:"parse_mode"`
}

// fakeTelegram is a minimal Bot API: getMe, getUpdates (long poll) and sendMessage.
type fakeTelegram struct {
	*httptest.Server
	mu      sync.Mutex
	updates []map[string]any
	nextID  int
	sent    []sentMessage
	blocked map[int64]bool
}

func newFakeTelegram(t *testing.T) *fakeTelegram {
	f := &fakeTelegram{blocked: map[int64]bool{}}
	f.Server = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.Close)
	return f
}

func (f *fakeTelegram) reply(w http.ResponseWriter, code int, result any, desc string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if code != http.StatusOK {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error_code": code, "description": desc})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": result})
}

func (f *fakeTelegram) serve(w http.ResponseWriter, r *http.Request) {
	token, method, _ := strings.Cut(strings.TrimPrefix(r.URL.Path, "/bot"), "/")
	if token != goodToken {
		f.reply(w, http.StatusUnauthorized, nil, "Unauthorized")
		return
	}
	switch method {
	case "getMe":
		f.reply(w, http.StatusOK, map[string]any{"id": 1, "is_bot": true, "username": "fleet_test_bot"}, "")
	case "getUpdates":
		var req struct {
			Offset int `json:"offset"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		deadline := time.Now().Add(200 * time.Millisecond)
		for {
			f.mu.Lock()
			var out []map[string]any
			for _, u := range f.updates {
				if u["update_id"].(int) >= req.Offset {
					out = append(out, u)
				}
			}
			f.mu.Unlock()
			if len(out) > 0 || time.Now().After(deadline) {
				f.reply(w, http.StatusOK, append([]map[string]any{}, out...), "")
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	case "sendMessage":
		var m sentMessage
		_ = json.NewDecoder(r.Body).Decode(&m)
		f.mu.Lock()
		blocked := f.blocked[m.ChatID]
		if !blocked {
			f.sent = append(f.sent, m)
		}
		f.mu.Unlock()
		if blocked {
			f.reply(w, http.StatusForbidden, nil, "Forbidden: bot was blocked by the user")
			return
		}
		f.reply(w, http.StatusOK, map[string]any{"message_id": 1}, "")
	default:
		f.reply(w, http.StatusNotFound, nil, "Not Found")
	}
}

func (f *fakeTelegram) userSays(chatID int64, text string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nextID++
	f.updates = append(f.updates, map[string]any{"update_id": f.nextID,
		"message": map[string]any{"message_id": f.nextID, "text": text, "chat": map[string]any{"id": chatID, "type": "private"}}})
}

func (f *fakeTelegram) messages() []sentMessage {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]sentMessage(nil), f.sent...)
}

type recorder struct {
	mu    sync.Mutex
	types []string
}

func (r *recorder) Publish(typ string, _ any) {
	r.mu.Lock()
	r.types = append(r.types, typ)
	r.mu.Unlock()
}

func (r *recorder) count(typ string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := 0
	for _, t := range r.types {
		if t == typ {
			n++
		}
	}
	return n
}

func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(10 * time.Millisecond) {
		if cond() {
			return
		}
	}
	t.Fatalf("timed out waiting for %s", what)
}

func setup(t *testing.T) (*Service, *store.Store, *fakeTelegram, *recorder) {
	t.Helper()
	rec := &recorder{}
	st := storetest.New(t, "notify_test", store.Options{Publisher: rec})
	tg := newFakeTelegram(t)
	s, err := New(context.Background(), st, Options{TelegramAPIURL: tg.URL, TelegramPollTimeout: time.Second, Workers: 1})
	if err != nil {
		t.Fatal(err)
	}
	return s, st, tg, rec
}

func TestTelegramLinkAndNotify(t *testing.T) {
	s, st, tg, rec := setup(t)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	t.Cleanup(func() { cancel(); <-done })
	go func() { s.Run(ctx); close(done) }()

	// Admin: sees every device (non-admins only get alerts for their groups' devices).
	u, err := st.CreateUser(ctx, "driver@fleet.local", "D", "pw", store.RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.TelegramLink(u.ID); !errors.Is(err, ErrTelegramNotConfigured) {
		t.Fatalf("unconfigured link: %v", err)
	}
	var ve *store.ValidationError
	if _, err := s.SetTelegramToken(ctx, "999:bad"); !errors.As(err, &ve) {
		t.Fatalf("bad token: %v", err)
	}
	cfg, err := s.SetTelegramToken(ctx, goodToken)
	if err != nil || cfg.TelegramBotUsername != "fleet_test_bot" || st.Settings().TelegramBotToken != goodToken {
		t.Fatalf("set token: %+v %v", cfg, err)
	}

	link, expires, err := s.TelegramLink(u.ID)
	if err != nil || !strings.HasPrefix(link, "https://t.me/fleet_test_bot?start=") || time.Until(expires) < 9*time.Minute {
		t.Fatalf("link %q %v %v", link, expires, err)
	}
	code := link[strings.Index(link, "=")+1:]

	tg.userSays(77, "/start not-a-code")
	tg.userSays(4242, "/start "+code)
	eventually(t, "chat linked", func() bool { c, _ := st.TelegramChat(ctx, u.ID); return c == 4242 })
	eventually(t, "replies", func() bool { return len(tg.messages()) == 2 })
	msgs := tg.messages()
	if msgs[0].ChatID != 77 || !strings.Contains(msgs[0].Text, "expired") {
		t.Fatalf("invalid-code reply %+v", msgs[0])
	}
	if msgs[1].ChatID != 4242 || !strings.Contains(msgs[1].Text, "driver@fleet.local") || msgs[1].ParseMode != "HTML" {
		t.Fatalf("link reply %+v", msgs[1])
	}
	eventually(t, "notifications event", func() bool { return rec.count(EventNotifications) == 1 })
	// Codes are single use.
	if _, ok := s.takeLinkCode(code); ok {
		t.Fatal("code reusable")
	}

	// Overspeed disabled for Telegram: only the geofence event is delivered.
	if err := st.SetEventPrefs(ctx, u.ID, store.EventPrefs{store.EventOverspeed: {InApp: true}}); err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC)
	s.Notify(store.Event{ID: 1, DeviceID: 12, Type: store.EventOverspeed, Message: "speeding", Time: at}, "Truck")
	s.Notify(store.Event{ID: 2, DeviceID: 12, Type: store.EventCommandResult, Message: "cmd", Time: at}, "Truck")
	s.Notify(store.Event{ID: 3, DeviceID: 12, Type: store.EventGeofenceEnter, Message: "Truck <7> entered Depot",
		Time: at, Lat: 25.2048, Lng: 55.2708}, "Truck <7>")
	eventually(t, "alert", func() bool { return len(tg.messages()) == 3 })
	m := tg.messages()[2]
	for _, want := range []string{"<b>Geofence enter</b>", "Truck &lt;7&gt; entered Depot", "2026-10-22 10:00:00 UTC",
		`href="https://www.google.com/maps?q=25.204800,55.270800"`} {
		if !strings.Contains(m.Text, want) {
			t.Errorf("alert %q lacks %q", m.Text, want)
		}
	}

	res, err := s.SendTest(ctx, u.ID)
	if err != nil || !res.Telegram || res.Push != 0 {
		t.Fatalf("test notification %+v %v", res, err)
	}

	// A chat that blocked the bot is unlinked.
	tg.mu.Lock()
	tg.blocked[4242] = true
	tg.mu.Unlock()
	s.Notify(store.Event{ID: 4, DeviceID: 12, Type: store.EventAlarm, Message: "sos", Time: at}, "Truck")
	eventually(t, "unlink", func() bool { c, _ := st.TelegramChat(ctx, u.ID); return c == 0 })

	// Clearing the token disables linking.
	if _, err := s.SetTelegramToken(ctx, ""); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.TelegramLink(u.ID); !errors.Is(err, ErrTelegramNotConfigured) {
		t.Fatalf("after clear: %v", err)
	}
}

func TestQueueFullDrops(t *testing.T) {
	s, _, _, _ := setup(t)
	for i := range DefaultQueueSize + 10 { // no workers running: must not block
		s.Notify(store.Event{ID: int64(i)}, "x")
	}
	if len(s.queue) != DefaultQueueSize {
		t.Fatalf("queue len %d", len(s.queue))
	}
}

func pushKeys(t *testing.T) store.PushSubscription {
	k, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	_, _ = rand.Read(auth)
	return store.PushSubscription{P256dh: base64.RawURLEncoding.EncodeToString(k.PublicKey().Bytes()),
		Auth: base64.RawURLEncoding.EncodeToString(auth)}
}

func TestPush(t *testing.T) {
	s, st, _, _ := setup(t)
	ctx := context.Background()
	if k := s.VAPIDPublicKey(); len(k) < 80 {
		t.Fatalf("VAPID public key %q", k)
	}
	var mu sync.Mutex
	var auths []string
	push := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		auths = append(auths, r.Header.Get("Authorization"))
		mu.Unlock()
		if strings.HasSuffix(r.URL.Path, "/gone") {
			w.WriteHeader(http.StatusGone)
			return
		}
		w.WriteHeader(http.StatusCreated)
	}))
	defer push.Close()

	u, _ := st.CreateUser(ctx, "p@fleet.local", "P", "pw", store.RoleUser)
	live, gone := pushKeys(t), pushKeys(t)
	live.Endpoint, gone.Endpoint = push.URL+"/live", push.URL+"/gone"
	for _, sub := range []store.PushSubscription{live, gone} {
		if err := st.AddPushSubscription(ctx, u.ID, sub); err != nil {
			t.Fatal(err)
		}
	}
	res, err := s.SendTest(ctx, u.ID)
	if err != nil || res.Push != 1 || res.Telegram {
		t.Fatalf("result %+v %v", res, err)
	}
	subs, _ := st.PushSubscriptions(ctx, u.ID)
	if len(subs) != 1 || subs[0].Endpoint != live.Endpoint {
		t.Fatalf("subscriptions after 410: %+v", subs)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(auths) != 2 || !strings.HasPrefix(auths[0], "vapid t=") {
		t.Fatalf("authorization headers %q", auths)
	}
	jwt, _, _ := strings.Cut(strings.TrimPrefix(auths[0], "vapid t="), ",")
	parts := strings.Split(jwt, ".")
	claims, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !strings.Contains(string(claims), `"sub":"mailto:admin@fleet.local"`) {
		t.Fatalf("VAPID claims %s %v", claims, err)
	}
}
