// Command simulator emulates a fleet of Teltonika FMB trackers driving
// around a city, for demos and load testing of the gateway.
//
//	go run ./cmd/simulator -addr localhost:5027 -devices 50 -interval 1s
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/protocol/teltonika"
)

type config struct {
	addr     string
	devices  int
	interval time.Duration
	codec    byte
	lat, lng float64
	imeiBase uint64
}

// stats are fleet-wide counters, logged periodically.
type stats struct {
	online, packets, records, failures atomic.Int64
}

func main() {
	var (
		cfg      config
		codec    string
		imeiBase string
		verbose  bool
	)
	flag.StringVar(&cfg.addr, "addr", "localhost:5027", "gateway TCP address")
	flag.IntVar(&cfg.devices, "devices", 20, "number of simulated devices")
	flag.DurationVar(&cfg.interval, "interval", 2*time.Second, "time between records per device")
	flag.StringVar(&codec, "codec", "8e", "AVL codec: 8 or 8e")
	flag.Float64Var(&cfg.lat, "lat", 25.2048, "center latitude")
	flag.Float64Var(&cfg.lng, "lng", 55.2708, "center longitude")
	flag.StringVar(&imeiBase, "imei-base", "356307040000000", "IMEI of device 0; device i uses base+i")
	flag.BoolVar(&verbose, "v", false, "debug logging")
	flag.Parse()

	level := slog.LevelInfo
	if verbose {
		level = slog.LevelDebug
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level}))

	if err := cfg.parse(codec, imeiBase); err != nil {
		fmt.Fprintln(os.Stderr, "simulator:", err)
		flag.Usage()
		os.Exit(2)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	log.Info("starting fleet", "devices", cfg.devices, "addr", cfg.addr, "codec", fmt.Sprintf("0x%02X", cfg.codec),
		"interval", cfg.interval, "center", fmt.Sprintf("%.4f,%.4f", cfg.lat, cfg.lng))

	var st stats
	var wg sync.WaitGroup
	for i := range cfg.devices {
		d := &device{
			cfg:  cfg,
			imei: fmt.Sprintf("%015d", cfg.imeiBase+uint64(i)),
			rng:  rand.New(rand.NewPCG(uint64(time.Now().UnixNano()), uint64(i))),
			st:   &st,
		}
		d.log = log.With("imei", d.imei)
		wg.Add(1)
		go func() {
			defer wg.Done()
			// Stagger connects so a big fleet doesn't SYN-flood the gateway.
			delay := time.Duration(i) * cfg.interval / time.Duration(cfg.devices)
			select {
			case <-time.After(delay):
				d.run(ctx)
			case <-ctx.Done():
			}
		}()
	}

	go func() {
		t := time.NewTicker(10 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				log.Info("stats", "online", st.online.Load(), "packets_acked", st.packets.Load(),
					"records_acked", st.records.Load(), "failures", st.failures.Load())
			case <-ctx.Done():
				return
			}
		}
	}()

	wg.Wait()
	log.Info("stopped", "packets_acked", st.packets.Load(), "records_acked", st.records.Load(), "failures", st.failures.Load())
}

func (c *config) parse(codec, imeiBase string) error {
	switch codec {
	case "8":
		c.codec = teltonika.Codec8
	case "8e", "8E":
		c.codec = teltonika.Codec8E
	default:
		return fmt.Errorf("unsupported codec %q (want 8 or 8e)", codec)
	}
	base, err := strconv.ParseUint(imeiBase, 10, 64)
	if err != nil || len(imeiBase) != 15 {
		return fmt.Errorf("invalid -imei-base %q: want 15 digits", imeiBase)
	}
	c.imeiBase = base
	switch {
	case c.devices < 1:
		return fmt.Errorf("-devices must be >= 1")
	case c.interval < 10*time.Millisecond:
		return fmt.Errorf("-interval too small")
	case c.lat < -85 || c.lat > 85 || c.lng < -180 || c.lng > 180:
		return fmt.Errorf("center out of range")
	}
	return nil
}
