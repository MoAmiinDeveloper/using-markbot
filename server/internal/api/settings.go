package api

import (
	"math"
	"net/http"
	"net/url"
	"strings"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// settingsView is the Settings contract; secrets are hidden as documented.
type settingsView struct {
	SpeedLimit           float64 `json:"speedLimit"`
	OverspeedMinDuration int     `json:"overspeedMinDuration"`
	TelegramBotToken     string  `json:"telegramBotToken"` // write-only, always ""
	TelegramConfigured   bool    `json:"telegramConfigured"`
	TelegramBotUsername  string  `json:"telegramBotUsername"`
	TraccarToken         string  `json:"traccarToken"` // admins only
}

func viewSettings(cfg store.Settings, admin bool) settingsView {
	v := settingsView{
		SpeedLimit:           cfg.SpeedLimit,
		OverspeedMinDuration: cfg.OverspeedMinDuration,
		TelegramConfigured:   cfg.TelegramBotToken != "",
		TelegramBotUsername:  cfg.TelegramBotUsername,
	}
	if admin {
		v.TraccarToken = cfg.TraccarToken
	}
	return v
}

func isAdmin(r *http.Request) bool { return principalFrom(r.Context()).Role == store.RoleAdmin }

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, viewSettings(s.store.Settings(), isAdmin(r)))
}

func (s *Server) handlePatchSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SpeedLimit           *float64 `json:"speedLimit"`
		OverspeedMinDuration *float64 `json:"overspeedMinDuration"`
		TelegramBotToken     *string  `json:"telegramBotToken"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	if v := req.SpeedLimit; v != nil && !(*v >= 1 && *v <= 500) {
		writeError(w, http.StatusBadRequest, "speedLimit must be between 1 and 500 km/h")
		return
	}
	if v := req.OverspeedMinDuration; v != nil && !(*v >= 0 && *v <= 3600 && *v == math.Trunc(*v)) {
		writeError(w, http.StatusBadRequest, "overspeedMinDuration must be a whole number of seconds between 0 and 3600")
		return
	}
	// The token is validated against Telegram first, so a bad token leaves
	// the other fields unchanged too.
	if req.TelegramBotToken != nil && strings.TrimSpace(*req.TelegramBotToken) != s.store.Settings().TelegramBotToken {
		if _, err := s.cfg.Notifier.SetTelegramToken(r.Context(), *req.TelegramBotToken); err != nil {
			s.fail(w, r, err)
			return
		}
	}
	cfg, err := s.store.UpdateSettings(r.Context(), func(cfg *store.Settings) error {
		if req.SpeedLimit != nil {
			cfg.SpeedLimit = *req.SpeedLimit
		}
		if req.OverspeedMinDuration != nil {
			cfg.OverspeedMinDuration = int(*req.OverspeedMinDuration)
		}
		return nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, viewSettings(cfg, true))
}

func (s *Server) handleRegenerateTraccarToken(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.store.UpdateSettings(r.Context(), func(cfg *store.Settings) error {
		cfg.TraccarToken = store.RandomToken(16)
		return nil
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, viewSettings(cfg, true))
}

// notificationPrefs is the NotificationPrefs contract.
type notificationPrefs struct {
	TelegramLinked bool             `json:"telegramLinked"`
	Push           pushState        `json:"push"`
	Events         store.EventPrefs `json:"events"`
}

type pushState struct {
	Enabled bool `json:"enabled"`
}

func (s *Server) writeNotificationPrefs(w http.ResponseWriter, r *http.Request) {
	st, err := s.store.NotificationState(r.Context(), principalFrom(r.Context()).UserID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, notificationPrefs{TelegramLinked: st.TelegramLinked,
		Push: pushState{Enabled: st.PushCount > 0}, Events: st.Events})
}

func (s *Server) handleGetNotifications(w http.ResponseWriter, r *http.Request) {
	s.writeNotificationPrefs(w, r)
}

func (s *Server) handlePutNotifications(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Events store.EventPrefs `json:"events"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	if req.Events == nil {
		writeError(w, http.StatusBadRequest, "events is required")
		return
	}
	if err := s.store.SetEventPrefs(r.Context(), principalFrom(r.Context()).UserID, req.Events); err != nil {
		s.fail(w, r, err)
		return
	}
	s.writeNotificationPrefs(w, r)
}

func (s *Server) handleTestNotification(w http.ResponseWriter, r *http.Request) {
	res, err := s.cfg.Notifier.SendTest(r.Context(), principalFrom(r.Context()).UserID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleTelegramLink(w http.ResponseWriter, r *http.Request) {
	link, expires, err := s.cfg.Notifier.TelegramLink(principalFrom(r.Context()).UserID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"url": link, "expiresAt": expires})
}

func (s *Server) handleTelegramUnlink(w http.ResponseWriter, r *http.Request) {
	if err := s.store.UnlinkTelegram(r.Context(), principalFrom(r.Context()).UserID); err != nil {
		s.fail(w, r, err)
		return
	}
	s.store.Publish(store.EventNotifications, nil)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleVAPIDKey(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"publicKey": s.cfg.Notifier.VAPIDPublicKey()})
}

func (s *Server) handleAddPushSubscription(w http.ResponseWriter, r *http.Request) {
	// Browser PushSubscription.toJSON().
	var req struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	u, err := url.Parse(req.Endpoint)
	switch {
	case err != nil || u.Scheme != "https" || u.Host == "" || len(req.Endpoint) > 2048:
		writeError(w, http.StatusBadRequest, "endpoint must be an https URL")
		return
	case req.Keys.P256dh == "" || req.Keys.Auth == "" || len(req.Keys.P256dh) > 256 || len(req.Keys.Auth) > 256:
		writeError(w, http.StatusBadRequest, "keys.p256dh and keys.auth are required")
		return
	}
	err = s.store.AddPushSubscription(r.Context(), principalFrom(r.Context()).UserID,
		store.PushSubscription{Endpoint: req.Endpoint, P256dh: req.Keys.P256dh, Auth: req.Keys.Auth})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"endpoint": req.Endpoint})
}

func (s *Server) handleDeletePushSubscription(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Endpoint string `json:"endpoint"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		s.fail(w, r, err)
		return
	}
	if req.Endpoint == "" {
		writeError(w, http.StatusBadRequest, "endpoint is required")
		return
	}
	if err := s.store.DeletePushSubscription(r.Context(), principalFrom(r.Context()).UserID, req.Endpoint); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
