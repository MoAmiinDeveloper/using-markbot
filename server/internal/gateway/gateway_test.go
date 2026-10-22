package gateway

import (
	"context"
	"encoding/binary"
	"io"
	"log/slog"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/protocol/teltonika"
)

type sink struct {
	mu        sync.Mutex
	positions int
}

func (s *sink) Authorize(context.Context, string, string) (bool, error) { return true, nil }
func (s *sink) Connection(context.Context, string, bool, string)        {}
func (s *sink) Positions(_ context.Context, b []domain.Position) error {
	s.mu.Lock()
	s.positions += len(b)
	s.mu.Unlock()
	return nil
}

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

// freeAddr returns a currently unused localhost port for network.
func freeAddr(t *testing.T, network string) string {
	t.Helper()
	if network == "udp" {
		pc, err := net.ListenPacket("udp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		defer pc.Close()
		return pc.LocalAddr().String()
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().String()
}

func dialRetry(t *testing.T, addr string) net.Conn {
	t.Helper()
	for i := 0; ; i++ {
		c, err := net.Dial("tcp", addr)
		if err == nil {
			return c
		}
		if i > 100 {
			t.Fatal(err)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func records() []teltonika.Record {
	return []teltonika.Record{{
		Time: time.Now().UTC().Truncate(time.Millisecond), Latitude: 252048000, Longitude: 552708000,
		Satellites: 10, Speed: 40, IO: []teltonika.IOElement{teltonika.NewIO(239, 1, 1)},
	}}
}

func TestServerTCPAndUDP(t *testing.T) {
	tcpAddr, udpAddr := freeAddr(t, "tcp"), freeAddr(t, "udp")
	sk := &sink{}
	srv := New(sk, quiet, Listener{Protocol: teltonika.New(), TCPAddr: tcpAddr, UDPAddr: udpAddr})
	ctx, cancel := context.WithCancel(context.Background())
	runErr := make(chan error, 1)
	go func() { runErr <- srv.Run(ctx) }()

	conn := dialRetry(t, tcpAddr)
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	if _, err := conn.Write(teltonika.EncodeIMEI("356307040000001")); err != nil {
		t.Fatal(err)
	}
	var b [4]byte
	if _, err := io.ReadFull(conn, b[:1]); err != nil || b[0] != 1 {
		t.Fatalf("handshake: %v %x", err, b[0])
	}
	pkt, _ := teltonika.EncodeAVLPacket(teltonika.Codec8E, records())
	if _, err := conn.Write(pkt); err != nil {
		t.Fatal(err)
	}
	if _, err := io.ReadFull(conn, b[:]); err != nil || binary.BigEndian.Uint32(b[:]) != 1 {
		t.Fatalf("ACK: %v % X", err, b)
	}
	if n := srv.ActiveConnections(); n != 1 {
		t.Errorf("ActiveConnections = %d, want 1", n)
	}

	uc, err := net.Dial("udp", udpAddr)
	if err != nil {
		t.Fatal(err)
	}
	defer uc.Close()
	_ = uc.SetDeadline(time.Now().Add(5 * time.Second))
	dg, _ := teltonika.EncodeUDPPacket(teltonika.UDPHeader{PacketID: 0xBEEF, AVLPacketID: 3, IMEI: "356307040000002"}, teltonika.Codec8, records())
	if _, err := uc.Write(dg); err != nil {
		t.Fatal(err)
	}
	reply := make([]byte, 16)
	n, err := uc.Read(reply)
	if err != nil || string(reply[:n]) != string(teltonika.EncodeUDPAck(0xBEEF, 3, 1)) {
		t.Fatalf("udp reply % X, %v", reply[:n], err)
	}

	cancel()
	select {
	case err := <-runErr:
		if err != nil {
			t.Fatalf("Run = %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return after cancel")
	}
	if n := srv.ActiveConnections(); n != 0 {
		t.Errorf("ActiveConnections after shutdown = %d", n)
	}
	if _, err := conn.Read(b[:]); err == nil {
		t.Error("device connection still open after shutdown")
	}
	sk.mu.Lock()
	defer sk.mu.Unlock()
	if sk.positions != 2 {
		t.Errorf("positions = %d, want 2", sk.positions)
	}
}

// panicky panics on every connection and datagram.
type panicky struct{}

func (panicky) Name() string { return "panicky" }
func (panicky) HandleTCP(context.Context, net.Conn, domain.Sink, *slog.Logger) error {
	panic("boom")
}
func (panicky) HandleUDP(context.Context, []byte, net.Addr, domain.Sink, *slog.Logger) ([]byte, error) {
	panic("boom")
}

func TestServerRecoversPanics(t *testing.T) {
	addr := freeAddr(t, "tcp")
	srv := New(&sink{}, quiet, Listener{Protocol: panicky{}, TCPAddr: addr})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go srv.Run(ctx)

	for range 3 {
		c := dialRetry(t, addr)
		_ = c.SetDeadline(time.Now().Add(5 * time.Second))
		if _, err := c.Read(make([]byte, 1)); err == nil {
			t.Fatal("expected connection to be closed after panic")
		}
		c.Close()
	}
	for i := 0; srv.ActiveConnections() != 0; i++ {
		if i > 100 {
			t.Fatalf("ActiveConnections = %d after panics", srv.ActiveConnections())
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestServerListenError(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	srv := New(&sink{}, quiet, Listener{Protocol: teltonika.New(), TCPAddr: ln.Addr().String()})
	if err := srv.Run(context.Background()); err == nil {
		t.Fatal("Run on a busy port must fail")
	}
	if err := New(&sink{}, quiet).Run(context.Background()); err == nil {
		t.Fatal("Run without listeners must fail")
	}
}
