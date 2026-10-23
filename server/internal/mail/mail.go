// Package mail sends email over SMTP (STARTTLS, implicit TLS or plain) with
// optional attachments, using only the standard library.
package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"net"
	netmail "net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

// TLS modes.
const (
	StartTLS = "starttls"
	TLS      = "tls"
	None     = "none"
)

// Timeouts.
const (
	DialTimeout = 10 * time.Second
	SendTimeout = 60 * time.Second // whole conversation, incl. upload
)

// Config is the SMTP server to use.
type Config struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string // "Name <addr>" or "addr"
	TLS      string // starttls | tls | none
	// TLSConfig overrides the TLS client configuration (tests).
	TLSConfig *tls.Config
}

// Attachment is a file attached to a message.
type Attachment struct {
	Name        string
	ContentType string
	Data        []byte
}

// Message is an email.
type Message struct {
	To          []string
	Subject     string
	Text        string // plain-text body
	Attachments []Attachment
}

// ParseAddress validates a single address and returns it without a display name.
func ParseAddress(s string) (string, error) {
	a, err := netmail.ParseAddress(strings.TrimSpace(s))
	if err != nil {
		return "", err
	}
	if strings.ContainsAny(a.Address, "\r\n<>") || !strings.Contains(a.Address, "@") {
		return "", errors.New("invalid address")
	}
	return a.Address, nil
}

// Send delivers msg. It honours ctx cancellation and the timeouts above.
func Send(ctx context.Context, cfg Config, msg Message) error {
	if cfg.Host == "" {
		return errors.New("SMTP host is not set")
	}
	from, err := netmail.ParseAddress(cfg.From)
	if err != nil {
		return fmt.Errorf("invalid from address: %w", err)
	}
	if len(msg.To) == 0 {
		return errors.New("no recipients")
	}
	to := make([]string, len(msg.To))
	for i, t := range msg.To {
		if to[i], err = ParseAddress(t); err != nil {
			return fmt.Errorf("invalid recipient %q", t)
		}
	}
	port := cfg.Port
	if port == 0 {
		port = 587
	}
	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(port))
	tlsCfg := cfg.TLSConfig
	if tlsCfg == nil {
		tlsCfg = &tls.Config{ServerName: cfg.Host, MinVersion: tls.VersionTLS12}
	}

	deadline := time.Now().Add(SendTimeout)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	dialer := &net.Dialer{Timeout: DialTimeout, Deadline: deadline}
	var conn net.Conn
	if cfg.TLS == TLS {
		conn, err = (&tls.Dialer{NetDialer: dialer, Config: tlsCfg}).DialContext(ctx, "tcp", addr)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return fmt.Errorf("connect %s: %w", addr, err)
	}
	_ = conn.SetDeadline(deadline)
	stop := context.AfterFunc(ctx, func() { _ = conn.SetDeadline(time.Unix(1, 0)) })
	defer stop()

	c, err := smtp.NewClient(conn, cfg.Host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("smtp greeting: %w", err)
	}
	defer c.Close()
	if err := c.Hello(helloName()); err != nil {
		return fmt.Errorf("smtp EHLO: %w", err)
	}
	if cfg.TLS == StartTLS || cfg.TLS == "" {
		if ok, _ := c.Extension("STARTTLS"); !ok {
			return errors.New("the server does not support STARTTLS (choose tls or none)")
		}
		if err := c.StartTLS(tlsCfg); err != nil {
			return fmt.Errorf("smtp STARTTLS: %w", err)
		}
	}
	if cfg.Username != "" {
		if ok, _ := c.Extension("AUTH"); !ok {
			return errors.New("the server does not offer authentication")
		}
		// smtp.PlainAuth refuses unencrypted connections except to localhost;
		// with tls=none the admin explicitly accepted plain text.
		var auth smtp.Auth = smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
		if cfg.TLS == None {
			auth = plainAuth{cfg.Username, cfg.Password}
		}
		if err := c.Auth(auth); err != nil {
			return fmt.Errorf("smtp AUTH: %w", err)
		}
	}
	if err := c.Mail(from.Address); err != nil {
		return fmt.Errorf("smtp MAIL FROM: %w", err)
	}
	for _, t := range to {
		if err := c.Rcpt(t); err != nil {
			return fmt.Errorf("smtp RCPT TO %s: %w", t, err)
		}
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	if _, err := w.Write(Build(from, to, msg, time.Now())); err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	return c.Quit()
}

// plainAuth is PLAIN authentication without the TLS requirement.
type plainAuth struct{ user, pass string }

func (a plainAuth) Start(*smtp.ServerInfo) (string, []byte, error) {
	return "PLAIN", []byte("\x00" + a.user + "\x00" + a.pass), nil
}

func (a plainAuth) Next(_ []byte, more bool) ([]byte, error) {
	if more {
		return nil, errors.New("unexpected server challenge")
	}
	return nil, nil
}

func helloName() string {
	return "localhost"
}

func boundary() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return "fleet-" + hex.EncodeToString(b)
}

// header encodes a header value (RFC 2047 for non-ASCII).
func header(v string) string {
	v = strings.NewReplacer("\r", " ", "\n", " ").Replace(v)
	return mime.QEncoding.Encode("utf-8", v)
}

// Build renders the RFC 5322 message (CRLF line endings).
func Build(from *netmail.Address, to []string, msg Message, now time.Time) []byte {
	var b bytes.Buffer
	w := func(format string, args ...any) { fmt.Fprintf(&b, format+"\r\n", args...) }
	w("From: %s", from.String())
	w("To: %s", strings.Join(to, ", "))
	w("Subject: %s", header(msg.Subject))
	w("Date: %s", now.Format(time.RFC1123Z))
	id := make([]byte, 8)
	_, _ = rand.Read(id)
	domain := "fleet.local"
	if _, d, ok := strings.Cut(from.Address, "@"); ok {
		domain = d
	}
	w("Message-ID: <%s@%s>", hex.EncodeToString(id), domain)
	w("MIME-Version: 1.0")
	text := strings.ReplaceAll(strings.ReplaceAll(msg.Text, "\r\n", "\n"), "\n", "\r\n")
	if len(msg.Attachments) == 0 {
		w("Content-Type: text/plain; charset=utf-8")
		w("Content-Transfer-Encoding: base64")
		w("")
		writeBase64(&b, []byte(text))
		return b.Bytes()
	}
	bd := boundary()
	w("Content-Type: multipart/mixed; boundary=\"%s\"", bd)
	w("")
	w("This is a multi-part message in MIME format.")
	w("--%s", bd)
	w("Content-Type: text/plain; charset=utf-8")
	w("Content-Transfer-Encoding: base64")
	w("")
	writeBase64(&b, []byte(text))
	for _, a := range msg.Attachments {
		ct := a.ContentType
		if ct == "" {
			ct = "application/octet-stream"
		}
		name := mime.QEncoding.Encode("utf-8", strings.NewReplacer("\"", "", "\r", "", "\n", "").Replace(a.Name))
		w("--%s", bd)
		w("Content-Type: %s; name=\"%s\"", ct, name)
		w("Content-Transfer-Encoding: base64")
		w("Content-Disposition: attachment; filename=\"%s\"", name)
		w("")
		writeBase64(&b, a.Data)
	}
	w("--%s--", bd)
	return b.Bytes()
}

// writeBase64 writes data base64-encoded in 76-character lines.
func writeBase64(b *bytes.Buffer, data []byte) {
	enc := base64.StdEncoding.EncodeToString(data)
	for len(enc) > 76 {
		b.WriteString(enc[:76])
		b.WriteString("\r\n")
		enc = enc[76:]
	}
	b.WriteString(enc)
	b.WriteString("\r\n")
}
