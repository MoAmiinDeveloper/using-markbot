package notify

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	webpush "github.com/SherClockHolmes/webpush-go"

	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// VAPIDPublicKey returns the application server key browsers subscribe with.
func (s *Service) VAPIDPublicKey() string { return s.st.Settings().VAPIDPublicKey }

// sendPush delivers one Web Push message; subscriptions the push service
// reports as gone (404/410) are deleted.
func (s *Service) sendPush(ctx context.Context, sub store.PushSubscription, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	cfg := s.st.Settings()
	ctx, cancel := context.WithTimeout(ctx, sendTimeout)
	defer cancel()
	resp, err := webpush.SendNotificationWithContext(ctx, body, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		HTTPClient: s.opts.HTTPClient,
		// webpush-go adds the "mailto:" prefix itself unless it is an https URL.
		Subscriber:      strings.TrimPrefix(s.opts.VAPIDSubject, "mailto:"),
		VAPIDPublicKey:  cfg.VAPIDPublicKey,
		VAPIDPrivateKey: cfg.VAPIDPrivateKey,
		TTL:             24 * 3600,
		Urgency:         webpush.UrgencyHigh,
	})
	if err != nil {
		s.log.Warn("notify: push send failed", "endpoint", endpointHost(sub.Endpoint), "err", err)
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		s.log.Info("notify: removing expired push subscription", "endpoint", endpointHost(sub.Endpoint))
		if err := s.st.DeletePushEndpoint(ctx, sub.Endpoint); err != nil {
			s.log.Error("notify: delete push subscription", "err", err)
		}
		s.st.Publish(EventNotifications, nil)
		return fmt.Errorf("push subscription gone (%d)", resp.StatusCode)
	case resp.StatusCode >= 300:
		s.log.Warn("notify: push service rejected message", "endpoint", endpointHost(sub.Endpoint), "status", resp.StatusCode)
		return fmt.Errorf("push service returned %d", resp.StatusCode)
	}
	return nil
}

// endpointHost keeps the per-subscription secret path out of logs.
func endpointHost(endpoint string) string {
	rest, _ := strings.CutPrefix(endpoint, "https://")
	host, _, _ := strings.Cut(rest, "/")
	return host
}
