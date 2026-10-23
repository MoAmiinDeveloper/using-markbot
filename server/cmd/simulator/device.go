package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net"
	"strings"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/protocol/teltonika"
)

const (
	dialTimeout   = 5 * time.Second
	ackTimeout    = 15 * time.Second
	maxBackoff    = 30 * time.Second
	maxBuffered   = 5000 // records kept while offline, like the device's flash
	maxPerPacket  = 50
	maxFrameBytes = 64 << 10
)

// device is one simulated tracker with its own TCP connection.
type device struct {
	cfg  config
	imei string
	rng  *rand.Rand
	log  *slog.Logger
	st   *stats

	conn    net.Conn
	br      *bufio.Reader
	pending []teltonika.Record
	buf     []byte
}

// run produces a record every interval and ships the backlog whenever
// connected, reconnecting with exponential backoff.
func (d *device) run(ctx context.Context) {
	defer d.disconnect()
	v := newVehicle(d.rng, d.cfg.lat, d.cfg.lng, time.Now())
	if d.cfg.sensors {
		v.sensors = newSensorSim(d.rng, time.Now())
	}
	tick := time.NewTicker(d.cfg.interval)
	defer tick.Stop()

	backoff := time.Second
	var nextDial time.Time
	last := time.Now()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-tick.C:
			event := v.step(now, now.Sub(last))
			last = now
			d.pending = append(d.pending, v.record(now, event))
			if over := len(d.pending) - maxBuffered; over > 0 {
				d.pending = d.pending[over:]
			}

			if d.conn == nil {
				if now.Before(nextDial) {
					continue
				}
				if err := d.connect(ctx); err != nil {
					d.st.failures.Add(1)
					d.log.Warn("connect failed", "err", err, "retry_in", backoff)
					nextDial = now.Add(backoff/2 + rand.N(backoff/2+1))
					backoff = min(2*backoff, maxBackoff)
					continue
				}
				backoff = time.Second
			}
			if err := d.flush(); err != nil {
				d.st.failures.Add(1)
				d.log.Warn("send failed, reconnecting", "err", err, "buffered", len(d.pending))
				d.disconnect()
				nextDial = now.Add(backoff)
			}
		}
	}
}

func (d *device) connect(ctx context.Context) error {
	dctx, cancel := context.WithTimeout(ctx, dialTimeout)
	defer cancel()
	conn, err := (&net.Dialer{KeepAlive: 30 * time.Second}).DialContext(dctx, "tcp", d.cfg.addr)
	if err != nil {
		return err
	}
	_ = conn.SetDeadline(time.Now().Add(ackTimeout))
	if _, err := conn.Write(teltonika.EncodeIMEI(d.imei)); err != nil {
		conn.Close()
		return err
	}
	var reply [1]byte
	if _, err := io.ReadFull(conn, reply[:]); err != nil {
		conn.Close()
		return fmt.Errorf("handshake: %w", err)
	}
	if reply[0] != 0x01 {
		conn.Close()
		return errors.New("rejected by server (device not registered?)")
	}
	d.conn, d.br = conn, bufio.NewReader(conn)
	d.st.online.Add(1)
	d.log.Debug("connected")
	return nil
}

func (d *device) disconnect() {
	if d.conn == nil {
		return
	}
	d.conn.Close()
	d.conn, d.br = nil, nil
	d.st.online.Add(-1)
}

// flush sends buffered records in packets and drops each batch once ACKed.
func (d *device) flush() error {
	for len(d.pending) > 0 {
		n := min(len(d.pending), maxPerPacket)
		pkt, err := teltonika.EncodeAVLPacket(d.cfg.codec, d.pending[:n])
		if err != nil {
			return err
		}
		_ = d.conn.SetDeadline(time.Now().Add(ackTimeout))
		if _, err := d.conn.Write(pkt); err != nil {
			return err
		}
		acked, err := d.readACK()
		if err != nil {
			return err
		}
		if acked != uint32(n) {
			return fmt.Errorf("server ACKed %d of %d records", acked, n)
		}
		d.pending = d.pending[n:]
		d.st.packets.Add(1)
		d.st.records.Add(int64(n))
	}
	d.pending = nil // release the backing array
	return nil
}

// readACK waits for the 4-byte record count, answering any Codec 12
// commands the server sends in between.
func (d *device) readACK() (uint32, error) {
	for {
		head, err := d.br.Peek(4)
		if err != nil {
			return 0, err
		}
		if binary.BigEndian.Uint32(head) != 0 { // ACK (we never send 0 records)
			var b [4]byte
			_, _ = io.ReadFull(d.br, b[:])
			return binary.BigEndian.Uint32(b[:]), nil
		}
		payload, err := teltonika.ReadFrame(d.br, d.buf, maxFrameBytes)
		if err != nil {
			return 0, err
		}
		d.buf = payload[:cap(payload)]
		typ, cmd, err := teltonika.DecodeCodec12(payload)
		if err != nil || typ != teltonika.Codec12Command {
			d.log.Warn("unexpected frame from server", "err", err)
			continue
		}
		d.log.Info("command received", "cmd", string(cmd))
		if _, err := d.conn.Write(teltonika.EncodeCodec12Response(d.answer(string(cmd)))); err != nil {
			return 0, err
		}
	}
}

// answer fakes FMB replies to a few common SMS/GPRS commands.
func (d *device) answer(cmd string) string {
	switch c := strings.TrimSpace(strings.ToLower(cmd)); {
	case c == "getver":
		return fmt.Sprintf("Ver:03.29.00_SIM GPS Ver:AXN_5.10 Hw:FMB920 Mod:21 IMEI:%s", d.imei)
	case c == "getinfo":
		return fmt.Sprintf("RTC:%s SIM GPS:1 SAT:%d", time.Now().UTC().Format("2006/1/2 15:04"), 8+d.rng.IntN(6))
	case c == "getgps":
		return "GPS:1 Sat:10"
	case strings.HasPrefix(c, "setdigout"):
		return "DOUT1:" + strings.TrimSpace(strings.TrimPrefix(c, "setdigout")) + " Timeout:INFINITY"
	case c == "cpureset":
		return "Device will reset"
	}
	return "Unknown command: " + cmd
}
