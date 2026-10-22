// Package notify delivers events to users over Telegram and Web Push,
// according to each user's per-event preferences. The in-app channel is the
// WebSocket "event" broadcast done by the store.
//
// Delivery is asynchronous: Notify only enqueues into a bounded queue, so a
// slow Telegram or push service never holds up ingest. When the queue is
// full, notifications are dropped and logged.
package notify

import (
	"context"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// Defaults, overridable with Options.
const (
	DefaultQueueSize    = 1024
	DefaultWorkers      = 4
	DefaultVAPIDSubject = "mailto:admin@fleet.local"
	DefaultPollTimeout  = 25 * time.Second

	linkCodeTTL = 10 * time.Minute
	sendTimeout = 15 * time.Second
)

// EventNotifications is published when a user's linked channels change.
const EventNotifications = store.EventNotifications

// Errors returned by the service.
var (
	ErrTelegramNotConfigured = errors.New("the Telegram bot is not configured")
	ErrTelegramUnavailable   = errors.New("could not reach the Telegram API")
)

// Options configures a Service.
type Options struct {
	// TelegramAPIURL is the Bot API base URL; defaults to DefaultTelegramAPIURL.
	TelegramAPIURL string
	// TelegramPollTimeout is the getUpdates long-poll timeout.
	TelegramPollTimeout time.Duration
	// VAPIDSubject identifies the sender to push services (mailto: or https: URL).
	VAPIDSubject string
	// HTTPClient is used for Telegram and push requests.
	HTTPClient *http.Client
	QueueSize  int
	Workers    int
	Logger     *slog.Logger
}

type job struct {
	ev         store.Event
	deviceName string
}

type linkCode struct {
	userID  int64
	expires time.Time
}

// Service sends notifications and runs the Telegram bot.
type Service struct {
	st   *store.Store
	opts Options
	log  *slog.Logger
	tg   *telegramClient
	now  func() time.Time

	queue   chan job
	restart chan struct{} // token changed: restart the poller

	codesMu sync.Mutex
	codes   map[string]linkCode
}

// New creates the service and generates the VAPID keys on first start.
func New(ctx context.Context, st *store.Store, opts Options) (*Service, error) {
	if opts.TelegramAPIURL == "" {
		opts.TelegramAPIURL = DefaultTelegramAPIURL
	}
	if opts.TelegramPollTimeout <= 0 {
		opts.TelegramPollTimeout = DefaultPollTimeout
	}
	if opts.VAPIDSubject == "" {
		opts.VAPIDSubject = DefaultVAPIDSubject
	}
	if opts.HTTPClient == nil {
		opts.HTTPClient = &http.Client{}
	}
	if opts.QueueSize <= 0 {
		opts.QueueSize = DefaultQueueSize
	}
	if opts.Workers <= 0 {
		opts.Workers = DefaultWorkers
	}
	if opts.Logger == nil {
		opts.Logger = slog.New(slog.DiscardHandler)
	}
	s := &Service{
		st:      st,
		opts:    opts,
		log:     opts.Logger,
		tg:      &telegramClient{baseURL: opts.TelegramAPIURL, http: opts.HTTPClient},
		now:     time.Now,
		queue:   make(chan job, opts.QueueSize),
		restart: make(chan struct{}, 1),
		codes:   make(map[string]linkCode),
	}
	if st.Settings().VAPIDPrivateKey == "" {
		priv, pub, err := webpush.GenerateVAPIDKeys()
		if err != nil {
			return nil, fmt.Errorf("generate VAPID keys: %w", err)
		}
		if _, err := st.UpdateSettings(ctx, func(cfg *store.Settings) error {
			cfg.VAPIDPrivateKey, cfg.VAPIDPublicKey = priv, pub
			return nil
		}); err != nil {
			return nil, err
		}
	}
	return s, nil
}

// Run delivers queued notifications and polls Telegram until ctx is done.
func (s *Service) Run(ctx context.Context) {
	var wg sync.WaitGroup
	for range s.opts.Workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case j := <-s.queue:
					s.deliver(ctx, j)
				}
			}
		}()
	}
	s.runTelegram(ctx)
	wg.Wait()
}

// runTelegram (re)starts the poller whenever the bot token changes.
func (s *Service) runTelegram(ctx context.Context) {
	for {
		pctx, cancel := context.WithCancel(ctx)
		done := make(chan struct{})
		if tok := s.st.Settings().TelegramBotToken; tok != "" {
			go func() { defer close(done); s.pollTelegram(pctx, tok) }()
		} else {
			close(done)
		}
		select {
		case <-ctx.Done():
			cancel()
			<-done
			return
		case <-s.restart:
			cancel()
			<-done
		}
	}
}

// Notify queues an event for delivery. It never blocks.
func (s *Service) Notify(ev store.Event, deviceName string) {
	select {
	case s.queue <- job{ev: ev, deviceName: deviceName}:
	default:
		s.log.Warn("notify: queue full, dropping notification", "event", ev.ID, "type", ev.Type)
	}
}

// deliver sends one event to every recipient that wants it.
func (s *Service) deliver(ctx context.Context, j job) {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	rcpts, err := s.st.Recipients(ctx)
	if err != nil {
		s.log.Error("notify: load recipients", "err", err)
		return
	}
	token := s.st.Settings().TelegramBotToken
	msg := telegramText(j.ev, j.deviceName)
	payload := pushPayload(j.ev, j.deviceName)
	for _, rc := range rcpts {
		ch, ok := rc.Events[j.ev.Type]
		if !ok {
			continue // not a user-notifiable type (e.g. commandResult)
		}
		if ch.Telegram && rc.TelegramChat != 0 && token != "" {
			_ = s.sendTelegram(ctx, token, rc.TelegramChat, msg)
		}
		if ch.Push {
			for _, sub := range rc.Push {
				_ = s.sendPush(ctx, sub, payload)
			}
		}
	}
}

// sendTelegram sends a message, unlinking chats that blocked the bot.
func (s *Service) sendTelegram(ctx context.Context, token string, chatID int64, msg string) error {
	sctx, cancel := context.WithTimeout(ctx, sendTimeout)
	defer cancel()
	err := s.tg.sendMessage(sctx, token, chatID, msg)
	if err == nil {
		return nil
	}
	s.log.Warn("notify: telegram send failed", "chat", chatID, "err", err)
	if code := telegramCode(err); code == http.StatusForbidden ||
		(code == http.StatusBadRequest && strings.Contains(err.Error(), "chat not found")) {
		if users, uerr := s.st.UnlinkTelegramChat(ctx, chatID); uerr == nil && len(users) > 0 {
			s.st.Publish(EventNotifications, nil)
		}
	}
	return err
}

// SetTelegramToken validates a bot token with getMe and stores it together
// with the bot username; an empty token disables the bot.
func (s *Service) SetTelegramToken(ctx context.Context, token string) (store.Settings, error) {
	token = strings.TrimSpace(token)
	username := ""
	if token != "" {
		if strings.ContainsAny(token, "/?#% ") {
			return s.st.Settings(), &store.ValidationError{Msg: "invalid Telegram bot token"}
		}
		ctx, cancel := context.WithTimeout(ctx, sendTimeout)
		defer cancel()
		me, err := s.tg.getMe(ctx, token)
		switch code := telegramCode(err); {
		case err == nil:
			username = me.Username
		case code == http.StatusUnauthorized || code == http.StatusNotFound:
			return s.st.Settings(), &store.ValidationError{Msg: "invalid Telegram bot token"}
		default:
			s.log.Warn("telegram: getMe failed", "err", err)
			return s.st.Settings(), ErrTelegramUnavailable
		}
	}
	cfg, err := s.st.UpdateSettings(ctx, func(cfg *store.Settings) error {
		cfg.TelegramBotToken, cfg.TelegramBotUsername = token, username
		return nil
	})
	if err != nil {
		return cfg, err
	}
	select {
	case s.restart <- struct{}{}:
	default:
	}
	return cfg, nil
}

// TelegramLink creates a one-time deep link that links the user's chat.
func (s *Service) TelegramLink(userID int64) (string, time.Time, error) {
	cfg := s.st.Settings()
	if cfg.TelegramBotToken == "" || cfg.TelegramBotUsername == "" {
		return "", time.Time{}, ErrTelegramNotConfigured
	}
	code := store.RandomToken(12)
	now := s.now()
	expires := now.Add(linkCodeTTL).UTC().Truncate(time.Second)
	s.codesMu.Lock()
	for c, v := range s.codes {
		if now.After(v.expires) {
			delete(s.codes, c)
		}
	}
	s.codes[code] = linkCode{userID: userID, expires: expires}
	s.codesMu.Unlock()
	return "https://t.me/" + cfg.TelegramBotUsername + "?start=" + code, expires, nil
}

// TestResult reports what a test notification reached.
type TestResult struct {
	Telegram bool `json:"telegram"` // delivered to the linked chat
	Push     int  `json:"push"`     // subscriptions that accepted the message
}

// SendTest sends a test message on every channel the user has linked.
func (s *Service) SendTest(ctx context.Context, userID int64) (TestResult, error) {
	var res TestResult
	if token := s.st.Settings().TelegramBotToken; token != "" {
		chat, err := s.st.TelegramChat(ctx, userID)
		if err != nil {
			return res, err
		}
		if chat != 0 {
			res.Telegram = s.sendTelegram(ctx, token, chat,
				"<b>FleetOS test notification</b>\nTelegram notifications are working.") == nil
		}
	}
	subs, err := s.st.PushSubscriptions(ctx, userID)
	if err != nil {
		return res, err
	}
	payload := map[string]string{"title": "FleetOS test notification", "body": "Push notifications are working.",
		"url": "/", "tag": "test"}
	for _, sub := range subs {
		if s.sendPush(ctx, sub, payload) == nil {
			res.Push++
		}
	}
	return res, nil
}

// typeTitle names an event type for message headings.
func typeTitle(t string) string {
	switch t {
	case store.EventGeofenceEnter:
		return "Geofence enter"
	case store.EventGeofenceExit:
		return "Geofence exit"
	case store.EventOverspeed:
		return "Overspeed"
	case store.EventIgnitionOn:
		return "Ignition on"
	case store.EventIgnitionOff:
		return "Ignition off"
	case store.EventAlarm:
		return "Alarm"
	case store.EventCommandResult:
		return "Command result"
	}
	return t
}

func escape(s string) string { return html.EscapeString(s) }

// telegramText renders an event as a Telegram HTML message.
func telegramText(ev store.Event, deviceName string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "<b>%s</b> · %s\n%s\n%s UTC", escape(typeTitle(ev.Type)), escape(deviceName),
		escape(ev.Message), ev.Time.UTC().Format("2006-01-02 15:04:05"))
	if ev.Lat != 0 || ev.Lng != 0 {
		fmt.Fprintf(&b, "\n<a href=\"https://www.google.com/maps?q=%.6f,%.6f\">Open in Google Maps</a>", ev.Lat, ev.Lng)
	}
	return b.String()
}

// pushPayload is the JSON the service worker reads.
func pushPayload(ev store.Event, deviceName string) map[string]string {
	return map[string]string{
		"title": typeTitle(ev.Type) + " · " + deviceName,
		"body":  ev.Message,
		"url":   fmt.Sprintf("/live?device=%d", ev.DeviceID),
		"tag":   fmt.Sprintf("event-%d", ev.ID),
	}
}
