// Command phonetracker turns an Android phone running Termux into a Teltonika
// tracker: it reads the phone's GPS through Termux:API (`termux-location`)
// and reports it to the gateway as Codec 8E records, exactly like an FMB device.
//
//	pkg install termux-api   # plus the Termux:API app from F-Droid
//	go run ./cmd/phonetracker -addr your-server:5027 -imei 350000000000001
package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/protocol/teltonika"
)

const (
	ackTimeout   = 15 * time.Second
	maxPending   = 10_000 // records kept while offline
	maxPerPacket = 50
)

// location is the subset of `termux-location` JSON output we use.
type location struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Altitude  float64 `json:"altitude"`
	Accuracy  float64 `json:"accuracy"` // meters
	Bearing   float64 `json:"bearing"`  // degrees
	Speed     float64 `json:"speed"`    // m/s
}

// battery is the subset of `termux-battery-status` JSON output we use.
type battery struct {
	Percentage int    `json:"percentage"`
	Plugged    string `json:"plugged"` // "UNPLUGGED", "PLUGGED_AC", ...
}

type tracker struct {
	addr, imei, provider string
	log                  *slog.Logger
	conn                 net.Conn
	br                   *bufio.Reader
	pending              []teltonika.Record
	odometer             float64 // meters
	last                 *location
}

func main() {
	t := &tracker{}
	interval := flag.Duration("interval", 10*time.Second, "time between GPS reports")
	flag.StringVar(&t.addr, "addr", "localhost:5027", "gateway TCP address")
	flag.StringVar(&t.imei, "imei", "350000000000001", "15-digit IMEI this phone reports as")
	flag.StringVar(&t.provider, "provider", "gps", "termux-location provider: gps, network or passive")
	flag.Parse()
	t.log = slog.New(slog.NewTextHandler(os.Stderr, nil)).With("imei", t.imei)
	if len(t.imei) != 15 || strings.Trim(t.imei, "0123456789") != "" {
		fmt.Fprintln(os.Stderr, "phonetracker: -imei must be 15 digits")
		os.Exit(2)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	t.log.Info("tracking", "server", t.addr, "interval", *interval, "provider", t.provider)

	tick := time.NewTicker(*interval)
	defer tick.Stop()
	for {
		if rec, err := t.sample(ctx); err != nil {
			t.log.Warn("no location", "err", err)
		} else {
			t.pending = append(t.pending, rec)
			if len(t.pending) > maxPending {
				t.pending = t.pending[len(t.pending)-maxPending:]
			}
		}
		if err := t.send(ctx); err != nil {
			t.log.Warn("send failed, will retry", "err", err, "buffered", len(t.pending))
			t.disconnect()
		}
		select {
		case <-ctx.Done():
			t.disconnect()
			return
		case <-tick.C:
		}
	}
}

// sample reads the phone's location and battery and builds one AVL record.
func (t *tracker) sample(ctx context.Context) (teltonika.Record, error) {
	var loc location
	if err := runJSON(ctx, 60*time.Second, &loc, "termux-location", "-p", t.provider, "-r", "once"); err != nil {
		return teltonika.Record{}, err
	}
	if loc.Latitude == 0 && loc.Longitude == 0 {
		return teltonika.Record{}, errors.New("no fix yet")
	}
	var bat battery
	_ = runJSON(ctx, 10*time.Second, &bat, "termux-battery-status")

	speed := loc.Speed * 3.6
	moving := speed > 3
	if t.last != nil && moving {
		t.odometer += haversine(t.last.Latitude, t.last.Longitude, loc.Latitude, loc.Longitude)
	}
	t.last = &loc

	// Teltonika has no accuracy field; approximate HDOP (x10) from it.
	hdop := uint64(min(math.Max(loc.Accuracy/5, 0.5)*10, 500))
	sats := uint8(12)
	if t.provider != "gps" || loc.Accuracy > 50 {
		sats = 4
	}
	b2i := func(b bool) uint64 {
		if b {
			return 1
		}
		return 0
	}
	charging := bat.Plugged != "" && bat.Plugged != "UNPLUGGED"
	return teltonika.Record{
		Time:       time.Now().UTC().Truncate(time.Millisecond),
		Latitude:   int32(math.Round(loc.Latitude * 1e7)),
		Longitude:  int32(math.Round(loc.Longitude * 1e7)),
		Altitude:   int16(loc.Altitude),
		Angle:      uint16(loc.Bearing) % 360,
		Satellites: sats,
		Speed:      uint16(math.Round(speed)),
		IO: []teltonika.IOElement{
			teltonika.NewIO(239, 1, b2i(charging)), // ignition := phone charging (e.g. car charger)
			teltonika.NewIO(240, 1, b2i(moving)),
			teltonika.NewIO(69, 1, 1),
			teltonika.NewIO(113, 1, uint64(max(bat.Percentage, 0))),
			teltonika.NewIO(182, 2, hdop),
			teltonika.NewIO(16, 4, uint64(t.odometer)),
		},
	}, nil
}

// send connects if needed and flushes buffered records, dropping each batch
// only after the server ACKs it.
func (t *tracker) send(ctx context.Context) error {
	if len(t.pending) == 0 {
		return nil
	}
	if t.conn == nil {
		if err := t.connect(ctx); err != nil {
			return err
		}
	}
	for len(t.pending) > 0 {
		n := min(len(t.pending), maxPerPacket)
		pkt, err := teltonika.EncodeAVLPacket(teltonika.Codec8E, t.pending[:n])
		if err != nil {
			return err
		}
		_ = t.conn.SetDeadline(time.Now().Add(ackTimeout))
		if _, err := t.conn.Write(pkt); err != nil {
			return err
		}
		acked, err := t.readACK()
		if err != nil {
			return err
		}
		if acked != uint32(n) {
			return fmt.Errorf("server ACKed %d of %d records", acked, n)
		}
		t.pending = t.pending[n:]
		t.log.Info("sent", "records", n)
	}
	t.pending = nil
	return nil
}

func (t *tracker) connect(ctx context.Context) error {
	dctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	conn, err := (&net.Dialer{KeepAlive: 30 * time.Second}).DialContext(dctx, "tcp", t.addr)
	if err != nil {
		return err
	}
	_ = conn.SetDeadline(time.Now().Add(ackTimeout))
	var reply [1]byte
	if _, err := conn.Write(teltonika.EncodeIMEI(t.imei)); err == nil {
		_, err = io.ReadFull(conn, reply[:])
	}
	if err != nil || reply[0] != 0x01 {
		conn.Close()
		if err == nil {
			err = errors.New("rejected by server (register the IMEI or enable AUTO_REGISTER)")
		}
		return err
	}
	t.conn, t.br = conn, bufio.NewReader(conn)
	t.log.Info("connected")
	return nil
}

func (t *tracker) disconnect() {
	if t.conn != nil {
		t.conn.Close()
		t.conn, t.br = nil, nil
	}
}

// readACK waits for the 4-byte record count, answering Codec 12 commands
// sent by the server in between.
func (t *tracker) readACK() (uint32, error) {
	var buf []byte
	for {
		head, err := t.br.Peek(4)
		if err != nil {
			return 0, err
		}
		if binary.BigEndian.Uint32(head) != 0 {
			var b [4]byte
			_, _ = io.ReadFull(t.br, b[:])
			return binary.BigEndian.Uint32(b[:]), nil
		}
		payload, err := teltonika.ReadFrame(t.br, buf, 64<<10)
		if err != nil {
			return 0, err
		}
		buf = payload[:cap(payload)]
		if typ, cmd, err := teltonika.DecodeCodec12(payload); err == nil && typ == teltonika.Codec12Command {
			t.log.Info("command received", "cmd", string(cmd))
			reply := "Phone tracker: command not supported: " + string(cmd)
			if _, err := t.conn.Write(teltonika.EncodeCodec12Response(reply)); err != nil {
				return 0, err
			}
		}
	}
}

func runJSON(ctx context.Context, timeout time.Duration, v any, name string, args ...string) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	// termux-* are shell wrappers around a helper that may outlive the
	// killed wrapper and keep stdout open; don't wait on it forever.
	cmd.WaitDelay = 2 * time.Second
	out, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("%s: %w (is the Termux:API app installed and location permission granted?)", name, err)
	}
	return json.Unmarshal(out, v)
}

func haversine(lat1, lng1, lat2, lng2 float64) float64 {
	const r = 6_371_000
	rad := math.Pi / 180
	dLat, dLng := (lat2-lat1)*rad, (lng2-lng1)*rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * r * math.Asin(math.Sqrt(a))
}
