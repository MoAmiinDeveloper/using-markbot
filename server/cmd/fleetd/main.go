// Command fleetd is the fleet tracking server: device gateway (Teltonika
// TCP/UDP), REST + WebSocket API and the web UI, in one binary.
//
// Configuration is read from the environment; see .env.example.
package main

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/moamiindeveloper/fleet/server/internal/api"
	"github.com/moamiindeveloper/fleet/server/internal/commands"
	"github.com/moamiindeveloper/fleet/server/internal/events"
	"github.com/moamiindeveloper/fleet/server/internal/gateway"
	"github.com/moamiindeveloper/fleet/server/internal/hub"
	"github.com/moamiindeveloper/fleet/server/internal/notify"
	"github.com/moamiindeveloper/fleet/server/internal/protocol/teltonika"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

type config struct {
	DatabaseURL   string
	HTTPAddr      string
	TeltonikaAddr string
	JWTSecret     string
	AdminEmail    string
	AdminPassword string
	AutoRegister  bool
	OfflineAfter  time.Duration
	WebDir        string
	CORSOrigins   string
	LogLevel      slog.Level
	LogFormat     string
	TelegramAPI   string
	VAPIDSubject  string
}

func loadConfig() (config, error) {
	c := config{
		DatabaseURL:   env("DATABASE_URL", "postgres://fleet:fleet@localhost:5432/fleet?sslmode=disable"),
		HTTPAddr:      env("HTTP_ADDR", ":8080"),
		TeltonikaAddr: env("TELTONIKA_ADDR", ":5027"),
		JWTSecret:     os.Getenv("JWT_SECRET"),
		AdminEmail:    env("ADMIN_EMAIL", "admin@fleet.local"),
		AdminPassword: env("ADMIN_PASSWORD", "admin"),
		WebDir:        env("WEB_DIR", "../web/dist"),
		CORSOrigins:   env("CORS_ORIGIN", "*"),
		LogFormat:     strings.ToLower(env("LOG_FORMAT", "text")),
		TelegramAPI:   env("TELEGRAM_API_URL", notify.DefaultTelegramAPIURL),
		VAPIDSubject:  env("VAPID_SUBJECT", notify.DefaultVAPIDSubject),
	}
	var err error
	if c.AutoRegister, err = strconv.ParseBool(env("AUTO_REGISTER", "true")); err != nil {
		return c, fmt.Errorf("AUTO_REGISTER: %w", err)
	}
	if c.OfflineAfter, err = time.ParseDuration(env("OFFLINE_AFTER", "10m")); err != nil || c.OfflineAfter <= 0 {
		return c, fmt.Errorf("OFFLINE_AFTER must be a positive duration like 10m")
	}
	if err := c.LogLevel.UnmarshalText([]byte(env("LOG_LEVEL", "info"))); err != nil {
		return c, fmt.Errorf("LOG_LEVEL: %w", err)
	}
	if c.LogFormat != "text" && c.LogFormat != "json" {
		return c, errors.New("LOG_FORMAT must be text or json")
	}
	if !strings.HasPrefix(c.VAPIDSubject, "mailto:") && !strings.HasPrefix(c.VAPIDSubject, "https://") {
		return c, errors.New("VAPID_SUBJECT must be a mailto: or https:// URL")
	}
	return c, nil
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		fmt.Fprintln(os.Stderr, "config:", err)
		os.Exit(2)
	}
	opts := &slog.HandlerOptions{Level: cfg.LogLevel}
	var handler slog.Handler = slog.NewTextHandler(os.Stderr, opts)
	if cfg.LogFormat == "json" {
		handler = slog.NewJSONHandler(os.Stderr, opts)
	}
	log := slog.New(handler)
	slog.SetDefault(log)

	if err := run(cfg, log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(cfg config, log *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := connectDB(ctx, cfg.DatabaseURL, log)
	if err != nil {
		return err
	}
	defer pool.Close()

	h := hub.New(hub.DefaultBuffer, log.With("component", "hub"))
	st, err := store.New(ctx, pool, store.Options{
		AutoRegister: cfg.AutoRegister,
		OfflineAfter: cfg.OfflineAfter,
		Publisher:    h,
		Logger:       log.With("component", "store"),
	})
	if err != nil {
		return err
	}
	if created, err := st.EnsureAdmin(ctx, cfg.AdminEmail, cfg.AdminPassword); err != nil {
		return err
	} else if created {
		log.Info("created default admin", "email", cfg.AdminEmail)
	}

	tel := teltonika.NewHandler()
	notifier, err := notify.New(ctx, st, notify.Options{
		TelegramAPIURL: cfg.TelegramAPI,
		VAPIDSubject:   cfg.VAPIDSubject,
		Logger:         log.With("component", "notify"),
	})
	if err != nil {
		return err
	}
	engine := events.New(st, notifier, log.With("component", "events"))
	cmds, err := commands.New(ctx, st, tel, engine, log.With("component", "commands"))
	if err != nil {
		return err
	}
	st.SetHooks(store.Hooks{Positions: engine.Process, Connected: cmds.DeviceConnected})

	secret := []byte(cfg.JWTSecret)
	if len(secret) == 0 {
		secret = make([]byte, 32)
		_, _ = rand.Read(secret)
		log.Warn("JWT_SECRET not set: using a random secret, sessions will not survive restarts",
			"hint", "set JWT_SECRET, e.g. from `openssl rand -hex 32`")
	}

	srv := &http.Server{
		Addr: cfg.HTTPAddr,
		Handler: api.New(st, h, api.Config{
			JWTSecret:   secret,
			CORSOrigins: cfg.CORSOrigins,
			WebDir:      cfg.WebDir,
			Notifier:    notifier,
			Commands:    cmds,
			Logger:      log.With("component", "api"),
		}),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}

	ctx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)

	go st.Run(ctx)
	bgDone := make(chan struct{}, 2)
	go func() { notifier.Run(ctx); bgDone <- struct{}{} }()
	go func() { cmds.Run(ctx); bgDone <- struct{}{} }()

	gw := gateway.New(st, log, gateway.Listener{Protocol: tel, TCPAddr: cfg.TeltonikaAddr, UDPAddr: cfg.TeltonikaAddr})
	gwDone := make(chan struct{})
	go func() {
		defer close(gwDone)
		if err := gw.Run(ctx); err != nil {
			cancel(err)
		}
	}()

	go func() {
		log.Info("http listening", "addr", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			cancel(fmt.Errorf("http: %w", err))
		}
	}()

	<-ctx.Done()
	cause := context.Cause(ctx)
	log.Info("shutting down", "reason", cause)

	h.Close() // ends WebSocket handlers, which Shutdown does not wait for
	shutdownCtx, done := context.WithTimeout(context.Background(), 15*time.Second)
	defer done()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Warn("http shutdown", "err", err)
	}
	<-gwDone
	<-bgDone
	<-bgDone

	if errors.Is(cause, context.Canceled) { // signal
		return nil
	}
	return cause
}

// connectDB opens the pool, retrying while the database starts up.
func connectDB(ctx context.Context, url string, log *slog.Logger) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("database config: %w", err)
	}
	for attempt := 1; ; attempt++ {
		pctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		err = pool.Ping(pctx)
		cancel()
		if err == nil {
			return pool, nil
		}
		if attempt == 30 || ctx.Err() != nil {
			pool.Close()
			return nil, fmt.Errorf("connect database: %w", err)
		}
		log.Warn("database not ready, retrying", "attempt", attempt, "err", err)
		select {
		case <-ctx.Done():
		case <-time.After(2 * time.Second):
		}
	}
}
