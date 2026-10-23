package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Settings defaults.
const (
	DefaultSpeedLimit           = 100 // km/h
	DefaultOverspeedMinDuration = 20  // seconds
	DefaultCurrency             = "USD"
)

// Settings are the global, admin-editable settings plus server-generated
// secrets. They are cached in memory; the JSON tags are the database keys.
type Settings struct {
	SpeedLimit           float64 `json:"speedLimit"`           // km/h
	OverspeedMinDuration int     `json:"overspeedMinDuration"` // seconds
	TelegramBotToken     string  `json:"telegramBotToken"`
	TelegramBotUsername  string  `json:"telegramBotUsername"`
	TraccarToken         string  `json:"traccarToken"`
	VAPIDPublicKey       string  `json:"vapidPublicKey"`
	VAPIDPrivateKey      string  `json:"vapidPrivateKey"`

	// Phase 3.
	Currency         string `json:"currency"`         // ISO 4217 code for expenses
	IdleAlertMinutes int    `json:"idleAlertMinutes"` // 0 = no idle events
	HarshScoring     bool   `json:"harshScoring"`     // harsh events count in driver scores
}

// defaultSettings are the settings before anything was saved.
func defaultSettings() Settings {
	return Settings{SpeedLimit: DefaultSpeedLimit, OverspeedMinDuration: DefaultOverspeedMinDuration,
		Currency: DefaultCurrency, HarshScoring: true}
}

// RandomToken returns n random bytes, hex encoded.
func RandomToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b) // never fails on supported platforms
	return hex.EncodeToString(b)
}

// loadSettings reads the settings, applying defaults, and generates the
// Traccar token on first start.
func (s *Store) loadSettings(ctx context.Context) error {
	rows, err := s.pool.Query(ctx, `SELECT key, value FROM settings`)
	if err != nil {
		return err
	}
	kv := map[string]json.RawMessage{}
	for rows.Next() {
		var (
			k string
			v json.RawMessage
		)
		if err := rows.Scan(&k, &v); err != nil {
			rows.Close()
			return err
		}
		kv[k] = v
	}
	if err := rows.Err(); err != nil {
		return err
	}
	st := defaultSettings()
	if len(kv) > 0 {
		// Round-trip through an object so each key decodes into its field.
		obj, _ := json.Marshal(kv)
		if err := json.Unmarshal(obj, &st); err != nil {
			return fmt.Errorf("decode settings: %w", err)
		}
	}
	if st.Currency == "" {
		st.Currency = DefaultCurrency
	}
	s.settingsMu.Lock()
	s.settings = st
	s.settingsMu.Unlock()
	if st.TraccarToken == "" {
		_, err := s.UpdateSettings(ctx, func(st *Settings) error {
			st.TraccarToken = RandomToken(16)
			return nil
		})
		return err
	}
	return nil
}

// Settings returns the cached settings.
func (s *Store) Settings() Settings {
	s.settingsMu.RLock()
	defer s.settingsMu.RUnlock()
	return s.settings
}

// UpdateSettings applies fn to a copy of the settings and persists the
// result. Updates are serialized; fn may reject the change with an error.
func (s *Store) UpdateSettings(ctx context.Context, fn func(*Settings) error) (Settings, error) {
	s.settingsMu.Lock()
	defer s.settingsMu.Unlock()
	next := s.settings
	if err := fn(&next); err != nil {
		return s.settings, err
	}
	raw, err := json.Marshal(next)
	if err != nil {
		return s.settings, err
	}
	var kv map[string]json.RawMessage
	if err := json.Unmarshal(raw, &kv); err != nil {
		return s.settings, err
	}
	b := &pgx.Batch{}
	for k, v := range kv {
		b.Queue(`INSERT INTO settings (key, value) VALUES ($1, $2)
			ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, k, v)
	}
	if err := s.pool.SendBatch(ctx, b).Close(); err != nil {
		return s.settings, fmt.Errorf("save settings: %w", err)
	}
	s.settings = next
	return next, nil
}
