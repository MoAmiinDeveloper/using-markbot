// Package mailtest is a tiny in-process SMTP server for tests: EHLO,
// optional STARTTLS (self-signed certificate), AUTH PLAIN, MAIL, RCPT, DATA.
package mailtest

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"math/big"
	"net"
	"net/textproto"
	"strings"
	"sync"
	"testing"
	"time"
)

// Message is a received email.
type Message struct {
	From string
	To   []string
	Data string // raw message (CRLF line endings, dot-unstuffed)
	Auth string // "user:pass" when authenticated
	TLS  bool   // delivered over TLS
}

// Server is a fake SMTP server.
type Server struct {
	Addr      string
	Host      string
	Port      int
	ClientTLS *tls.Config // trusts the server certificate (STARTTLS mode)

	ln       net.Listener
	starttls *tls.Config
	mu       sync.Mutex
	msgs     []Message
	// RejectRcpt makes RCPT TO fail for addresses containing it.
	RejectRcpt string
}

// New starts a server; withTLS enables STARTTLS. It stops at test cleanup.
func New(t testing.TB, withTLS bool) *Server {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{ln: ln, Addr: ln.Addr().String(), Host: "127.0.0.1", Port: ln.Addr().(*net.TCPAddr).Port}
	if withTLS {
		cert, pool := selfSigned(t)
		s.starttls = &tls.Config{Certificates: []tls.Certificate{cert}}
		s.ClientTLS = &tls.Config{RootCAs: pool, ServerName: "127.0.0.1"}
	}
	go s.serve()
	t.Cleanup(func() { ln.Close() })
	return s
}

// Messages returns the received messages.
func (s *Server) Messages() []Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Message(nil), s.msgs...)
}

func (s *Server) serve() {
	for {
		c, err := s.ln.Accept()
		if err != nil {
			return
		}
		go s.handle(c)
	}
}

func (s *Server) handle(c net.Conn) {
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(30 * time.Second))
	tp := textproto.NewConn(c)
	var (
		m      Message
		secure bool
	)
	reply := func(code int, msg string) { _ = tp.PrintfLine("%d %s", code, msg) }
	reply(220, "fake ESMTP ready")
	for {
		line, err := tp.ReadLine()
		if err != nil {
			return
		}
		cmd, arg, _ := strings.Cut(line, " ")
		switch strings.ToUpper(cmd) {
		case "EHLO", "HELO":
			lines := []string{"250-fake greets you", "250-8BITMIME"}
			if s.starttls != nil && !secure {
				lines = append(lines, "250-STARTTLS")
			}
			lines = append(lines, "250 AUTH PLAIN")
			for _, l := range lines {
				_ = tp.PrintfLine("%s", l)
			}
		case "STARTTLS":
			if s.starttls == nil {
				reply(502, "no TLS")
				continue
			}
			reply(220, "go ahead")
			tc := tls.Server(c, s.starttls)
			if err := tc.Handshake(); err != nil {
				return
			}
			c, secure = tc, true
			tp = textproto.NewConn(tc)
		case "AUTH":
			parts := strings.Fields(arg)
			if len(parts) != 2 || parts[0] != "PLAIN" {
				reply(504, "PLAIN only")
				continue
			}
			b, _ := base64.StdEncoding.DecodeString(parts[1])
			f := strings.Split(string(b), "\x00")
			if len(f) != 3 || f[2] == "wrong" {
				reply(535, "authentication failed")
				continue
			}
			m.Auth = f[1] + ":" + f[2]
			reply(235, "ok")
		case "MAIL":
			_, addr, _ := strings.Cut(arg, ":")
			addr, _, _ = strings.Cut(strings.TrimSpace(addr), " ") // drop BODY=… parameters
			m.From = strings.Trim(addr, "<> ")
			reply(250, "ok")
		case "RCPT":
			_, addr, _ := strings.Cut(arg, ":")
			to := strings.Trim(addr, "<> ")
			if s.RejectRcpt != "" && strings.Contains(to, s.RejectRcpt) {
				reply(550, "no such user")
				continue
			}
			m.To = append(m.To, to)
			reply(250, "ok")
		case "DATA":
			reply(354, "end with .")
			lines, err := tp.ReadDotLines()
			if err != nil {
				return
			}
			m.Data = strings.Join(lines, "\r\n")
			m.TLS = secure
			s.mu.Lock()
			s.msgs = append(s.msgs, m)
			s.mu.Unlock()
			m = Message{Auth: m.Auth}
			reply(250, "queued")
		case "RSET", "NOOP":
			reply(250, "ok")
		case "QUIT":
			reply(221, "bye")
			return
		default:
			reply(500, "unknown command")
		}
	}
}

func selfSigned(t testing.TB) (tls.Certificate, *x509.CertPool) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "fake smtp"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, KeyUsage: x509.KeyUsageDigitalSignature,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, IsCA: true, BasicConstraintsValid: true}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, _ := x509.ParseCertificate(der)
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, pool
}
