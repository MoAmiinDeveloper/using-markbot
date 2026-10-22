package teltonika

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"log/slog"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
)

type fakeSink struct {
	mu        sync.Mutex
	allow     bool
	authErr   error
	posErr    error
	authCalls int
	batches   [][]domain.Position
	events    []string
}

func (s *fakeSink) Authorize(_ context.Context, imei, proto string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.authCalls++
	return s.allow && proto == "teltonika", s.authErr
}

func (s *fakeSink) Positions(_ context.Context, batch []domain.Position) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.posErr != nil {
		return s.posErr
	}
	s.batches = append(s.batches, batch)
	return nil
}

func (s *fakeSink) Connection(_ context.Context, imei string, online bool, _ string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := "offline"
	if online {
		state = "online"
	}
	s.events = append(s.events, imei+" "+state)
}

func (s *fakeSink) snapshot() (batches [][]domain.Position, events []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([][]domain.Position(nil), s.batches...), append([]string(nil), s.events...)
}

var discard = slog.New(slog.NewTextHandler(io.Discard, nil))

const testIMEI = "356307042441013"

// startTCP runs HandleTCP on one end of a pipe and returns the device end.
func startTCP(t *testing.T, h *Handler, sink domain.Sink) (net.Conn, <-chan error) {
	t.Helper()
	srv, dev := net.Pipe()
	done := make(chan error, 1)
	go func() { done <- h.HandleTCP(context.Background(), srv, sink, discard) }()
	t.Cleanup(func() { dev.Close() })
	_ = dev.SetDeadline(time.Now().Add(5 * time.Second))
	return dev, done
}

func handshake(t *testing.T, dev net.Conn, want byte) {
	t.Helper()
	if _, err := dev.Write(EncodeIMEI(testIMEI)); err != nil {
		t.Fatal(err)
	}
	var b [1]byte
	if _, err := io.ReadFull(dev, b[:]); err != nil {
		t.Fatal(err)
	}
	if b[0] != want {
		t.Fatalf("handshake reply %02X, want %02X", b[0], want)
	}
}

func readACK(t *testing.T, dev net.Conn) uint32 {
	t.Helper()
	var b [4]byte
	if _, err := io.ReadFull(dev, b[:]); err != nil {
		t.Fatalf("read ACK: %v", err)
	}
	return binary.BigEndian.Uint32(b[:])
}

func waitDone(t *testing.T, done <-chan error) error {
	t.Helper()
	select {
	case err := <-done:
		return err
	case <-time.After(5 * time.Second):
		t.Fatal("HandleTCP did not return")
		return nil
	}
}

func TestTCPSession(t *testing.T) {
	sink := &fakeSink{allow: true}
	h := NewHandler()
	dev, done := startTCP(t, h, sink)
	handshake(t, dev, 0x01)

	// Codec 8 example: 1 record.
	if _, err := dev.Write(mustHex(t, wikiCodec8)); err != nil {
		t.Fatal(err)
	}
	if n := readACK(t, dev); n != 1 {
		t.Fatalf("ACK = %d, want 1", n)
	}

	// Corrupt CRC: no ACK; the next good packet's ACK must be the next thing read.
	bad := mustHex(t, wikiCodec16)
	bad[len(bad)-1] ^= 0x55
	if _, err := dev.Write(bad); err != nil {
		t.Fatal(err)
	}
	if _, err := dev.Write(mustHex(t, wikiCodec16)); err != nil {
		t.Fatal(err)
	}
	if n := readACK(t, dev); n != 2 {
		t.Fatalf("ACK = %d, want 2", n)
	}

	dev.Close()
	if err := waitDone(t, done); err != nil {
		t.Errorf("HandleTCP = %v, want nil on EOF", err)
	}
	batches, events := sink.snapshot()
	if len(batches) != 2 || len(batches[0]) != 1 || len(batches[1]) != 2 {
		t.Fatalf("batches = %v", batches)
	}
	if p := batches[0][0]; p.IMEI != testIMEI || p.Protocol != "teltonika" || p.ServerTime.IsZero() {
		t.Errorf("position = %+v", p)
	}
	if want := []string{testIMEI + " online", testIMEI + " offline"}; len(events) != 2 || events[0] != want[0] || events[1] != want[1] {
		t.Errorf("connection events = %v", events)
	}
	if _, ok := h.Session(testIMEI); ok {
		t.Error("session still registered after disconnect")
	}
}

func TestTCPReject(t *testing.T) {
	for _, sink := range []*fakeSink{{allow: false}, {allow: true, authErr: errors.New("db down")}} {
		dev, done := startTCP(t, NewHandler(), sink)
		handshake(t, dev, 0x00)
		if err := waitDone(t, done); err == nil {
			t.Error("rejected device: want error")
		}
		if _, events := sink.snapshot(); len(events) != 0 {
			t.Errorf("rejected device reported connection events %v", events)
		}
	}
}

func TestTCPBadIMEI(t *testing.T) {
	dev, done := startTCP(t, NewHandler(), &fakeSink{allow: true})
	if _, err := dev.Write([]byte{0x00, 0x03, 'a', 'b', 'c'}); err != nil {
		t.Fatal(err)
	}
	if err := waitDone(t, done); !errors.Is(err, ErrBadIMEI) {
		t.Errorf("got %v, want ErrBadIMEI", err)
	}
}

func TestTCPSinkErrorNoACK(t *testing.T) {
	sink := &fakeSink{allow: true, posErr: errors.New("db down")}
	dev, done := startTCP(t, NewHandler(), sink)
	handshake(t, dev, 0x01)
	if _, err := dev.Write(mustHex(t, wikiCodec8)); err != nil {
		t.Fatal(err)
	}
	var b [4]byte
	if n, err := io.ReadFull(dev, b[:]); err == nil {
		t.Fatalf("got ACK % X after sink error", b[:n])
	}
	if err := waitDone(t, done); err == nil {
		t.Error("want error from HandleTCP after sink failure")
	}
	if _, events := sink.snapshot(); len(events) != 2 {
		t.Errorf("events = %v, want online+offline", events)
	}
}

func TestTCPOversizedFrame(t *testing.T) {
	dev, done := startTCP(t, NewHandler(WithMaxPacketSize(32)), &fakeSink{allow: true})
	handshake(t, dev, 0x01)
	go dev.Write(mustHex(t, wikiCodec8)) // 54-byte payload > 32
	if err := waitDone(t, done); !errors.Is(err, ErrFrameTooLarge) {
		t.Errorf("got %v, want ErrFrameTooLarge", err)
	}
}

func TestTCPIdleTimeout(t *testing.T) {
	dev, done := startTCP(t, NewHandler(WithIdleTimeout(50*time.Millisecond)), &fakeSink{allow: true})
	handshake(t, dev, 0x01)
	if err := waitDone(t, done); err == nil {
		t.Error("want idle timeout error")
	}
}

func TestTCPShutdown(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	srv, dev := net.Pipe()
	defer dev.Close()
	done := make(chan error, 1)
	go func() { done <- NewHandler().HandleTCP(ctx, srv, &fakeSink{allow: true}, discard) }()
	handshake(t, dev, 0x01)
	cancel()
	if err := waitDone(t, done); err != nil {
		t.Errorf("shutdown: got %v, want nil", err)
	}
}

func TestCodec12Session(t *testing.T) {
	h := NewHandler()
	dev, done := startTCP(t, h, &fakeSink{allow: true})
	handshake(t, dev, 0x01)

	var sess *Session
	for i := 0; ; i++ {
		var ok bool
		if sess, ok = h.Session(testIMEI); ok {
			break
		}
		if i > 100 {
			t.Fatal("session not registered")
		}
		time.Sleep(10 * time.Millisecond)
	}

	type result struct {
		reply string
		err   error
	}
	res := make(chan result, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		r, err := sess.Send(ctx, "getinfo")
		res <- result{r, err}
	}()

	payload, err := ReadFrame(dev, nil, DefaultMaxPacketSize)
	if err != nil {
		t.Fatal(err)
	}
	typ, cmd, err := DecodeCodec12(payload)
	if err != nil || typ != Codec12Command || string(cmd) != "getinfo" {
		t.Fatalf("device got %d %q %v", typ, cmd, err)
	}
	if _, err := dev.Write(EncodeCodec12Response("RTC:2026/10/22 OK")); err != nil {
		t.Fatal(err)
	}
	if r := <-res; r.err != nil || r.reply != "RTC:2026/10/22 OK" {
		t.Fatalf("Send = %q, %v", r.reply, r.err)
	}

	// AVL data still flows after a command exchange.
	if _, err := dev.Write(mustHex(t, wikiCodec8E)); err != nil {
		t.Fatal(err)
	}
	if n := readACK(t, dev); n != 1 {
		t.Fatalf("ACK = %d", n)
	}

	// Pending command fails once the device disconnects.
	go func() {
		_, err := sess.Send(context.Background(), "cpureset")
		res <- result{"", err}
	}()
	if _, err := ReadFrame(dev, nil, DefaultMaxPacketSize); err != nil {
		t.Fatal(err)
	}
	dev.Close()
	if r := <-res; !errors.Is(r.err, ErrSessionClosed) {
		t.Errorf("Send after disconnect = %v", r.err)
	}
	waitDone(t, done)
}

func TestUDP(t *testing.T) {
	sink := &fakeSink{allow: true}
	h := NewHandler()
	pkt := mustHex(t, wikiUDPCodec)

	for range 3 {
		reply, err := h.HandleUDP(context.Background(), pkt, nil, sink, discard)
		if err != nil {
			t.Fatal(err)
		}
		if got, want := reply, []byte{0x00, 0x05, 0xCA, 0xFE, 0x01, 0x05, 0x01}; string(got) != string(want) {
			t.Fatalf("reply % X, want % X", got, want)
		}
	}
	batches, _ := sink.snapshot()
	if len(batches) != 3 || batches[0][0].IMEI != "352093086403655" || batches[0][0].Attributes[domain.AttrPower] != 23.996 {
		t.Fatalf("batches = %+v", batches)
	}
	if sink.authCalls != 1 {
		t.Errorf("Authorize called %d times, want 1 (cached)", sink.authCalls)
	}

	// Round trip through the encoder.
	recs := []Record{{Time: time.UnixMilli(1700000000000).UTC(), Satellites: 9, Latitude: 1, IO: []IOElement{NewIO(239, 1, 1)}}}
	enc, err := EncodeUDPPacket(UDPHeader{PacketID: 7, AVLPacketID: 9, IMEI: testIMEI}, Codec8E, recs)
	if err != nil {
		t.Fatal(err)
	}
	if reply, err := h.HandleUDP(context.Background(), enc, nil, sink, discard); err != nil || reply[3] != 7 || reply[5] != 9 {
		t.Fatalf("reply % X, %v", reply, err)
	}

	// Sink failure: no ACK.
	sink.mu.Lock()
	sink.posErr = errors.New("db down")
	sink.mu.Unlock()
	if reply, err := h.HandleUDP(context.Background(), pkt, nil, sink, discard); err == nil || reply != nil {
		t.Errorf("sink error: reply % X, err %v", reply, err)
	}

	// Unauthorized and malformed datagrams: no ACK.
	if reply, err := NewHandler().HandleUDP(context.Background(), pkt, nil, &fakeSink{}, discard); err == nil || reply != nil {
		t.Errorf("unauthorized: reply % X, err %v", reply, err)
	}
	if reply, err := h.HandleUDP(context.Background(), pkt[:20], nil, sink, discard); err == nil || reply != nil {
		t.Errorf("truncated: reply % X, err %v", reply, err)
	}
}
