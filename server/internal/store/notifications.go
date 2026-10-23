package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5"
)

// EventNotifications is the live event (no data) published when a user's
// notification channels change (e.g. Telegram got linked).
const EventNotifications = "notifications"

// NotifyEventTypes are the event types users can configure notifications for.
var NotifyEventTypes = []string{EventGeofenceEnter, EventGeofenceExit, EventOverspeed, EventIgnitionOn,
	EventIgnitionOff, EventAlarm, EventHarshAcceleration, EventHarshBraking, EventHarshCornering, EventIdle,
	EventMaintenanceDue, EventDocumentExpiry}

// DefaultChannels returns the channels used for an event type the user has
// not configured: everything on, except Telegram and push for the frequent
// driver-behaviour and idle events.
func DefaultChannels(eventType string) Channels {
	switch eventType {
	case EventHarshAcceleration, EventHarshBraking, EventHarshCornering, EventIdle:
		return Channels{InApp: true}
	}
	return Channels{InApp: true, Telegram: true, Push: true}
}

// Channels selects the notification channels for one event type.
type Channels struct {
	InApp    bool `json:"inApp"`
	Telegram bool `json:"telegram"`
	Push     bool `json:"push"`
}

// EventPrefs maps event types to channels.
type EventPrefs map[string]Channels

// withDefaults returns p completed with the defaults (see DefaultChannels).
func (p EventPrefs) withDefaults() EventPrefs {
	out := make(EventPrefs, len(NotifyEventTypes))
	for _, t := range NotifyEventTypes {
		c, ok := p[t]
		if !ok {
			c = DefaultChannels(t)
		}
		out[t] = c
	}
	return out
}

// PushSubscription is a browser Web Push endpoint.
type PushSubscription struct {
	Endpoint string `json:"endpoint"`
	P256dh   string `json:"p256dh"`
	Auth     string `json:"auth"`
}

// Recipient is a user with at least one external notification channel.
type Recipient struct {
	UserID       int64
	Events       EventPrefs
	TelegramChat int64 // 0 = not linked
	Push         []PushSubscription
}

// NotificationState is a user's preferences and linked channels.
type NotificationState struct {
	Events         EventPrefs
	TelegramLinked bool
	PushCount      int
}

// NotificationState loads the preferences of a user, with defaults applied.
func (s *Store) NotificationState(ctx context.Context, userID int64) (NotificationState, error) {
	var (
		st  NotificationState
		raw []byte
	)
	err := s.pool.QueryRow(ctx, `SELECT
			(SELECT events FROM notification_prefs WHERE user_id = $1),
			EXISTS (SELECT 1 FROM telegram_links WHERE user_id = $1),
			(SELECT count(*) FROM push_subscriptions WHERE user_id = $1)`, userID).
		Scan(&raw, &st.TelegramLinked, &st.PushCount)
	if err != nil {
		return st, err
	}
	var p EventPrefs
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &p); err != nil {
			return st, fmt.Errorf("decode prefs: %w", err)
		}
	}
	st.Events = p.withDefaults()
	return st, nil
}

// SetEventPrefs replaces a user's per-event channel choices. Unknown event
// types are rejected; missing ones keep the defaults.
func (s *Store) SetEventPrefs(ctx context.Context, userID int64, p EventPrefs) error {
	for t := range p {
		if !slices.Contains(NotifyEventTypes, t) {
			return invalid("unknown event type %q", t)
		}
	}
	_, err := s.pool.Exec(ctx, `INSERT INTO notification_prefs (user_id, events) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET events = EXCLUDED.events`, userID, p.withDefaults())
	return err
}

// Recipients returns every user that has Telegram linked or a push
// subscription, with their preferences.
func (s *Store) Recipients(ctx context.Context) ([]Recipient, error) {
	rows, err := s.pool.Query(ctx, `SELECT u.id, p.events, COALESCE(t.chat_id, 0),
			COALESCE(jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth))
				FILTER (WHERE ps.id IS NOT NULL), '[]')
		FROM users u
		LEFT JOIN notification_prefs p ON p.user_id = u.id
		LEFT JOIN telegram_links t ON t.user_id = u.id
		LEFT JOIN push_subscriptions ps ON ps.user_id = u.id
		WHERE t.user_id IS NOT NULL OR ps.id IS NOT NULL
		GROUP BY u.id, p.events, t.chat_id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Recipient, error) {
		var (
			rc  Recipient
			raw []byte
		)
		if err := r.Scan(&rc.UserID, &raw, &rc.TelegramChat, &rc.Push); err != nil {
			return rc, err
		}
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &rc.Events); err != nil {
				return rc, err
			}
		}
		rc.Events = rc.Events.withDefaults()
		return rc, nil
	})
}

// TelegramChat returns the chat linked to a user, or 0.
func (s *Store) TelegramChat(ctx context.Context, userID int64) (int64, error) {
	var chat int64
	err := s.pool.QueryRow(ctx, `SELECT chat_id FROM telegram_links WHERE user_id = $1`, userID).Scan(&chat)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return chat, err
}

// LinkTelegram links a chat to a user, replacing any previous link of the user.
func (s *Store) LinkTelegram(ctx context.Context, userID, chatID int64) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO telegram_links (user_id, chat_id) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET chat_id = EXCLUDED.chat_id, created_at = now()`, userID, chatID)
	return err
}

// UnlinkTelegram removes the Telegram link of a user.
func (s *Store) UnlinkTelegram(ctx context.Context, userID int64) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM telegram_links WHERE user_id = $1`, userID)
	return err
}

// UnlinkTelegramChat removes every link to a chat (e.g. the user blocked the
// bot) and returns the affected users.
func (s *Store) UnlinkTelegramChat(ctx context.Context, chatID int64) ([]int64, error) {
	rows, err := s.pool.Query(ctx, `DELETE FROM telegram_links WHERE chat_id = $1 RETURNING user_id`, chatID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[int64])
}

// AddPushSubscription stores a subscription for a user; a known endpoint is
// moved to this user with fresh keys.
func (s *Store) AddPushSubscription(ctx context.Context, userID int64, sub PushSubscription) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
		ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
		userID, sub.Endpoint, sub.P256dh, sub.Auth)
	return err
}

// DeletePushSubscription removes a user's subscription.
func (s *Store) DeletePushSubscription(ctx context.Context, userID int64, endpoint string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`, userID, endpoint)
	return err
}

// DeletePushEndpoint removes a subscription that the push service reported gone.
func (s *Store) DeletePushEndpoint(ctx context.Context, endpoint string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE endpoint = $1`, endpoint)
	return err
}

// PushSubscriptions returns the subscriptions of a user.
func (s *Store) PushSubscriptions(ctx context.Context, userID int64) ([]PushSubscription, error) {
	rows, err := s.pool.Query(ctx, `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[PushSubscription])
}

// Publish forwards a live event to clients (used by services built on the store).
func (s *Store) Publish(msgType string, data any) { s.publish(msgType, data) }
