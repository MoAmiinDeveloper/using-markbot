package commands

import (
	"bufio"
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/events"
	"github.com/moamiindeveloper/fleet/server/internal/protocol/teltonika"
	"github.com/moamiindeveloper/fleet/server/internal/store"
	"github.com/moamiindeveloper/fleet/server/internal/store/storetest"
)

const imei = "356307042441013"

// gateway serves the Teltonika handler on a local TCP port.
func gateway(t *testing.T, ctx context.Context, h *teltonika.Handler, st *store.Store) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() { _ = h.HandleTCP(ctx, c, st, slog.New(slog.DiscardHandler)) }()
		}
	}()
	return ln.Addr().String()
}

// fakeDevice connects like an FMB tracker and answers Codec 12 commands.
func fakeDevice(t *testing.T, addr string, answer func(string) string) net.Conn {
	t.Helper()
	c, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	if _, err := c.Write(teltonika.EncodeIMEI(imei)); err != nil {
		t.Fatal(err)
	}
	var ok [1]byte
	if _, err := io.ReadFull(c, ok[:]); err != nil || ok[0] != 1 {
		t.Fatalf("handshake: %v %v", ok, err)
	}
	go func() {
		br := bufio.NewReader(c)
		for {
			payload, err := teltonika.ReadFrame(br, nil, 64<<10)
			if err != nil {
				return
			}
			typ, cmd, err := teltonika.DecodeCodec12(payload)
			if err != nil || typ != teltonika.Codec12Command {
				continue
			}
			if _, err := c.Write(teltonika.EncodeCodec12Response(answer(string(cmd)))); err != nil {
				return
			}
		}
	}()
	return c
}

func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(10 * time.Millisecond) {
		if cond() {
			return
		}
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestQueueSendOnConnect(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	st := storetest.New(t, "commands_test", store.Options{AutoRegister: true})
	h := teltonika.NewHandler()
	svc, err := New(ctx, st, h, events.New(st, nil, nil), nil)
	if err != nil {
		t.Fatal(err)
	}
	st.SetHooks(store.Hooks{Connected: svc.DeviceConnected})
	runDone := make(chan struct{})
	go func() { svc.Run(ctx); close(runDone) }()
	defer func() { cancel(); <-runDone }()

	dev, err := st.CreateDevice(ctx, store.DeviceInput{Name: "Truck 07", IMEI: imei})
	if err != nil {
		t.Fatal(err)
	}
	user, _ := st.CreateUser(ctx, "u@fleet.local", "U", "pw", store.RoleUser)

	// Validation and authorization.
	var ve *store.ValidationError
	if _, err := svc.Create(ctx, dev.ID, user.ID, true, "selfDestruct", ""); !errors.As(err, &ve) {
		t.Fatalf("unknown type: %v", err)
	}
	if _, err := svc.Create(ctx, dev.ID, user.ID, true, Custom, "  "); !errors.As(err, &ve) {
		t.Fatalf("empty custom: %v", err)
	}
	for _, typ := range []string{EngineStop, EngineResume, Custom} {
		if _, err := svc.Create(ctx, dev.ID, user.ID, false, typ, "getver"); !errors.Is(err, ErrForbidden) {
			t.Fatalf("%s as user: %v", typ, err)
		}
	}
	bridged, _ := st.EnsureBridgedDevice(ctx, "phone-1", "osmand", "")
	if _, err := svc.Create(ctx, bridged.ID, user.ID, true, GetInfo, ""); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("bridged: %v", err)
	}
	if _, err := svc.Create(ctx, 9999, user.ID, true, GetInfo, ""); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("unknown device: %v", err)
	}

	// Device offline: the command waits in the queue.
	c, err := svc.Create(ctx, dev.ID, user.ID, false, GetVersion, "ignored")
	if err != nil || c.Status != store.CommandQueued || c.Text != "getver" {
		t.Fatalf("create: %+v %v", c, err)
	}

	got := make(chan string, 10)
	fakeDevice(t, gateway(t, ctx, h, st), func(cmd string) string {
		got <- cmd
		if cmd == "getver" {
			return "Ver:03.29.00 Hw:FMB920"
		}
		return "DOUT1:1"
	})
	eventually(t, "queued command delivered", func() bool {
		cs, _ := st.Commands(ctx, dev.ID, 10)
		return len(cs) == 1 && cs[0].Status == store.CommandSuccess
	})
	cs, _ := st.Commands(ctx, dev.ID, 10)
	if cs[0].Response != "Ver:03.29.00 Hw:FMB920" || cs[0].CompletedAt == nil || <-got != "getver" {
		t.Fatalf("result %+v", cs[0])
	}
	if d, _ := st.Device(dev.ID); !d.Commands {
		t.Fatal("device should accept commands while connected")
	}

	// Connected: sent immediately.
	if _, err := svc.Create(ctx, dev.ID, 1, true, EngineStop, ""); err != nil {
		t.Fatal(err)
	}
	eventually(t, "engineStop success", func() bool {
		cs, _ := st.Commands(ctx, dev.ID, 1)
		return cs[0].Status == store.CommandSuccess && cs[0].Response == "DOUT1:1"
	})
	if cmd := <-got; cmd != "setdigout 1" {
		t.Fatalf("device got %q", cmd)
	}

	evs, _ := st.Events(ctx, store.EventFilter{DeviceID: dev.ID, Types: []string{store.EventCommandResult},
		From: time.Now().Add(-time.Hour), To: time.Now().Add(time.Hour), Limit: 10})
	if len(evs) != 2 || evs[1].Attributes["status"] != store.CommandSuccess ||
		evs[1].Message != `Truck 07 replied to "getver": Ver:03.29.00 Hw:FMB920` {
		t.Fatalf("commandResult events %+v", evs)
	}
}

func TestNoReplyAndExpiry(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	st := storetest.New(t, "commands_test", store.Options{AutoRegister: true})
	h := teltonika.NewHandler()
	svc, err := New(ctx, st, h, events.New(st, nil, nil), nil)
	if err != nil {
		t.Fatal(err)
	}
	st.SetHooks(store.Hooks{Connected: svc.DeviceConnected})
	dev, _ := st.CreateDevice(ctx, store.DeviceInput{Name: "A", IMEI: imei})

	c, _ := svc.Create(ctx, dev.ID, 0, true, Reboot, "")
	svc.now = func() time.Time { return time.Now().Add(QueueTTL + time.Minute) }
	svc.expire(ctx)
	cs, _ := st.Commands(ctx, dev.ID, 1)
	if cs[0].ID != c.ID || cs[0].Status != store.CommandExpired {
		t.Fatalf("after expiry %+v", cs[0])
	}

	// The device disconnects instead of answering: the command fails.
	svc.now = time.Now
	conn := fakeDevice(t, gateway(t, ctx, h, st), func(string) string { return "" })
	eventually(t, "connected", func() bool { d, _ := st.Device(dev.ID); return d.Commands })
	conn.(*net.TCPConn).CloseRead() // stop answering; the handler sees EOF and closes the session
	if _, err := svc.Create(ctx, dev.ID, 0, true, GetInfo, ""); err != nil {
		t.Fatal(err)
	}
	conn.Close()
	eventually(t, "failure or requeue", func() bool {
		cs, _ := st.Commands(ctx, dev.ID, 1)
		return cs[0].Status == store.CommandFailed || cs[0].Status == store.CommandQueued
	})
	eventually(t, "disconnected", func() bool { d, _ := st.Device(dev.ID); return !d.Commands })
}
