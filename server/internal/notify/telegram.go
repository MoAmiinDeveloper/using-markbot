package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// DefaultTelegramAPIURL is the Telegram Bot API base URL.
const DefaultTelegramAPIURL = "https://api.telegram.org"

// telegramError is an unsuccessful Bot API reply.
type telegramError struct {
	Code        int
	Description string
}

func (e *telegramError) Error() string {
	return fmt.Sprintf("telegram: %d %s", e.Code, e.Description)
}

func telegramCode(err error) int {
	var te *telegramError
	if errors.As(err, &te) {
		return te.Code
	}
	return 0
}

// telegramClient is a minimal Bot API client.
type telegramClient struct {
	baseURL string
	http    *http.Client
}

// call invokes method with a JSON body and decodes the result into out.
func (c *telegramClient) call(ctx context.Context, token, method string, body, out any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	return c.do(ctx, token, method, "application/json", bytes.NewReader(b), out)
}

// do posts a request body to a Bot API method and decodes the result.
func (c *telegramClient) do(ctx context.Context, token, method, contentType string, body io.Reader, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		strings.TrimSuffix(c.baseURL, "/")+"/bot"+token+"/"+method, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)
	resp, err := c.http.Do(req)
	if err != nil {
		// The URL contains the token; never let it reach the logs.
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return fmt.Errorf("telegram %s: %w", method, err)
	}
	defer resp.Body.Close()
	var r struct {
		OK          bool            `json:"ok"`
		Result      json.RawMessage `json:"result"`
		ErrorCode   int             `json:"error_code"`
		Description string          `json:"description"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return &telegramError{Code: resp.StatusCode, Description: "invalid response"}
	}
	if !r.OK {
		code := r.ErrorCode
		if code == 0 {
			code = resp.StatusCode
		}
		return &telegramError{Code: code, Description: r.Description}
	}
	if out != nil {
		return json.Unmarshal(r.Result, out)
	}
	return nil
}

type tgUser struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
}

type tgUpdate struct {
	UpdateID int64 `json:"update_id"`
	Message  *struct {
		Text string `json:"text"`
		Chat struct {
			ID int64 `json:"id"`
		} `json:"chat"`
	} `json:"message"`
}

func (c *telegramClient) getMe(ctx context.Context, token string) (tgUser, error) {
	var u tgUser
	err := c.call(ctx, token, "getMe", struct{}{}, &u)
	return u, err
}

func (c *telegramClient) getUpdates(ctx context.Context, token string, offset int64, timeout time.Duration) ([]tgUpdate, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout+15*time.Second)
	defer cancel()
	var ups []tgUpdate
	err := c.call(ctx, token, "getUpdates", map[string]any{
		"offset":          offset,
		"timeout":         int(timeout.Seconds()),
		"allowed_updates": []string{"message"},
	}, &ups)
	return ups, err
}

// sendDocument uploads a file (multipart/form-data) to a chat.
func (c *telegramClient) sendDocument(ctx context.Context, token string, chatID int64, name string, data []byte, caption string) error {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("chat_id", strconv.FormatInt(chatID, 10))
	if caption != "" {
		if len([]rune(caption)) > 1024 {
			caption = string([]rune(caption)[:1024])
		}
		_ = mw.WriteField("caption", caption)
	}
	fw, err := mw.CreateFormFile("document", name)
	if err != nil {
		return err
	}
	if _, err := fw.Write(data); err != nil {
		return err
	}
	if err := mw.Close(); err != nil {
		return err
	}
	return c.do(ctx, token, "sendDocument", mw.FormDataContentType(), &body, nil)
}

func (c *telegramClient) sendMessage(ctx context.Context, token string, chatID int64, html string) error {
	return c.call(ctx, token, "sendMessage", map[string]any{
		"chat_id":                  chatID,
		"text":                     html,
		"parse_mode":               "HTML",
		"disable_web_page_preview": true,
	}, nil)
}

// pollTelegram long-polls getUpdates until ctx is cancelled or the token is
// rejected. Another poller on the same bot (409) and transient errors are
// retried with backoff.
func (s *Service) pollTelegram(ctx context.Context, token string) {
	const maxBackoff = time.Minute
	backoff := time.Second
	var offset int64
	s.log.Info("telegram: polling for updates")
	for ctx.Err() == nil {
		ups, err := s.tg.getUpdates(ctx, token, offset, s.opts.TelegramPollTimeout)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			switch code := telegramCode(err); code {
			case http.StatusUnauthorized, http.StatusNotFound:
				s.log.Error("telegram: bot token rejected, polling stopped until it is changed", "err", err)
				return
			case http.StatusConflict:
				s.log.Warn("telegram: another getUpdates poller or a webhook is active for this bot", "err", err, "retry_in", backoff)
			default:
				s.log.Warn("telegram: getUpdates failed", "err", err, "retry_in", backoff)
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
			}
			backoff = min(2*backoff, maxBackoff)
			continue
		}
		backoff = time.Second
		for _, u := range ups {
			offset = max(offset, u.UpdateID+1)
			if u.Message != nil {
				s.handleTelegramMessage(ctx, token, u.Message.Chat.ID, u.Message.Text)
			}
		}
	}
}

// handleTelegramMessage links a chat on "/start <code>".
func (s *Service) handleTelegramMessage(ctx context.Context, token string, chatID int64, text string) {
	fields := strings.Fields(text)
	if len(fields) == 0 || !strings.HasPrefix(fields[0], "/start") {
		return
	}
	reply := func(msg string) {
		if err := s.tg.sendMessage(ctx, token, chatID, msg); err != nil {
			s.log.Warn("telegram: reply failed", "chat", chatID, "err", err)
		}
	}
	if len(fields) < 2 {
		reply("Hi! To receive FleetOS alerts here, open <b>Notifications</b> in FleetOS and choose <b>Link Telegram</b>.")
		return
	}
	userID, ok := s.takeLinkCode(fields[1])
	if !ok {
		reply("This link is invalid or has expired. Please create a new one in FleetOS under <b>Notifications</b>.")
		return
	}
	if err := s.st.LinkTelegram(ctx, userID, chatID); err != nil {
		s.log.Error("telegram: link chat", "user", userID, "err", err)
		reply("Sorry, something went wrong while linking your account. Please try again.")
		return
	}
	who := "your FleetOS account"
	if u, err := s.st.UserByID(ctx, userID); err == nil {
		who = "<b>" + escape(u.Email) + "</b>"
	}
	s.log.Info("telegram: chat linked", "user", userID)
	reply("Done! This chat is now linked to " + who + ". Fleet alerts will be delivered here.")
	s.st.Publish(EventNotifications, nil)
}

// takeLinkCode consumes a link code, returning its user.
func (s *Service) takeLinkCode(code string) (int64, bool) {
	s.codesMu.Lock()
	defer s.codesMu.Unlock()
	c, ok := s.codes[code]
	delete(s.codes, code)
	if !ok || s.now().After(c.expires) {
		return 0, false
	}
	return c.userID, true
}
