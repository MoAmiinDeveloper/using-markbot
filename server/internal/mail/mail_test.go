package mail_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"mime"
	"mime/multipart"
	"net"
	netmail "net/mail"
	"strings"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/mail"
	"github.com/moamiindeveloper/fleet/server/internal/mail/mailtest"
)

// parse decodes a received message into its text body and attachments.
func parse(t *testing.T, raw string) (*netmail.Message, string, map[string][]byte) {
	t.Helper()
	msg, err := netmail.ReadMessage(strings.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	mt, params, err := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{}
	var text string
	if !strings.HasPrefix(mt, "multipart/") {
		b, _ := io.ReadAll(msg.Body)
		return msg, decodeB64(t, b), files
	}
	mr := multipart.NewReader(msg.Body, params["boundary"])
	for {
		p, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		// multipart.Reader decodes quoted-printable only; decode base64 here.
		b, _ := io.ReadAll(p)
		if p.Header.Get("Content-Transfer-Encoding") != "base64" {
			t.Fatalf("part not base64: %v", p.Header)
		}
		body := decodeB64(t, b)
		if name := p.FileName(); name != "" {
			files[name] = []byte(body)
		} else {
			text = body
		}
	}
	return msg, text, files
}

func decodeB64(t *testing.T, b []byte) string {
	t.Helper()
	for _, l := range strings.Split(string(b), "\r\n") {
		if len(l) > 76 {
			t.Fatalf("base64 line too long: %d", len(l))
		}
	}
	clean := strings.NewReplacer("\r", "", "\n", "").Replace(string(b))
	dec, err := base64.StdEncoding.DecodeString(clean)
	if err != nil {
		t.Fatal(err)
	}
	return string(dec)
}

func TestSendWithAttachmentSTARTTLS(t *testing.T) {
	srv := mailtest.New(t, true)
	pdf := bytes.Repeat([]byte("%PDF-1.4 binary \x00\xff data "), 200)
	cfg := mail.Config{Host: srv.Host, Port: srv.Port, Username: "fleet", Password: "s3cret",
		From: "Somtel Fleet <fleet@example.com>", TLS: mail.StartTLS, TLSConfig: srv.ClientTLS}
	err := mail.Send(context.Background(), cfg, mail.Message{To: []string{"ops@example.com", "Boss <boss@example.com>"},
		Subject: "Daily summary – Mogadishu", Text: "Hello\nreport attached",
		Attachments: []mail.Attachment{{Name: "summary_2026-10-22.pdf", ContentType: "application/pdf", Data: pdf}}})
	if err != nil {
		t.Fatal(err)
	}
	msgs := srv.Messages()
	if len(msgs) != 1 {
		t.Fatalf("%d messages", len(msgs))
	}
	m := msgs[0]
	if !m.TLS || m.Auth != "fleet:s3cret" || m.From != "fleet@example.com" ||
		strings.Join(m.To, ",") != "ops@example.com,boss@example.com" {
		t.Fatalf("envelope %+v", m)
	}
	hdr, text, files := parse(t, m.Data)
	subj, _ := new(mime.WordDecoder).DecodeHeader(hdr.Header.Get("Subject"))
	if subj != "Daily summary – Mogadishu" || !strings.Contains(hdr.Header.Get("From"), "fleet@example.com") {
		t.Fatalf("headers %v", hdr.Header)
	}
	if text != "Hello\r\nreport attached" {
		t.Fatalf("text %q", text)
	}
	if !bytes.Equal(files["summary_2026-10-22.pdf"], pdf) {
		t.Fatalf("attachment mismatch (%d files)", len(files))
	}
}

func TestSendPlainAndErrors(t *testing.T) {
	srv := mailtest.New(t, false)
	ctx := context.Background()
	cfg := mail.Config{Host: srv.Host, Port: srv.Port, From: "fleet@example.com", TLS: mail.None}
	if err := mail.Send(ctx, cfg, mail.Message{To: []string{"a@example.com"}, Subject: "hi", Text: "x"}); err != nil {
		t.Fatal(err)
	}
	if m := srv.Messages(); len(m) != 1 || m[0].TLS || m[0].Auth != "" {
		t.Fatalf("%+v", m)
	}
	// Auth over a plain connection is allowed when tls=none.
	cfg.Username, cfg.Password = "u", "p"
	if err := mail.Send(ctx, cfg, mail.Message{To: []string{"a@example.com"}, Subject: "hi"}); err != nil {
		t.Fatal(err)
	}
	cfg.Password = "wrong"
	if err := mail.Send(ctx, cfg, mail.Message{To: []string{"a@example.com"}}); err == nil || !strings.Contains(err.Error(), "AUTH") {
		t.Fatalf("bad password: %v", err)
	}
	// STARTTLS required but not offered.
	cfg = mail.Config{Host: srv.Host, Port: srv.Port, From: "fleet@example.com", TLS: mail.StartTLS}
	if err := mail.Send(ctx, cfg, mail.Message{To: []string{"a@example.com"}}); err == nil || !strings.Contains(err.Error(), "STARTTLS") {
		t.Fatalf("starttls: %v", err)
	}
	srv.RejectRcpt = "nobody"
	cfg.TLS = mail.None
	if err := mail.Send(ctx, cfg, mail.Message{To: []string{"nobody@example.com"}}); err == nil {
		t.Fatal("rejected recipient accepted")
	}
	if err := mail.Send(ctx, cfg, mail.Message{To: []string{"not an address"}}); err == nil {
		t.Fatal("bad recipient accepted")
	}
	// Unreachable server fails fast.
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	addr := ln.Addr().(*net.TCPAddr)
	ln.Close()
	start := time.Now()
	cfg.Port = addr.Port
	if err := mail.Send(ctx, cfg, mail.Message{To: []string{"a@example.com"}}); err == nil || time.Since(start) > 5*time.Second {
		t.Fatalf("unreachable: %v", err)
	}
	// A server that never answers is cut off by the context deadline.
	silent, _ := net.Listen("tcp", "127.0.0.1:0")
	defer silent.Close()
	go func() {
		c, err := silent.Accept()
		if err == nil {
			time.Sleep(3 * time.Second)
			c.Close()
		}
	}()
	cfg.Port = silent.Addr().(*net.TCPAddr).Port
	tctx, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
	defer cancel()
	start = time.Now()
	if err := mail.Send(tctx, cfg, mail.Message{To: []string{"a@example.com"}}); err == nil || time.Since(start) > 2*time.Second {
		t.Fatalf("silent server: %v after %v", err, time.Since(start))
	}
}
