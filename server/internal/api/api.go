// Package api serves the REST + WebSocket API described in docs/API.md and,
// optionally, the built single-page web app.
package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/moamiindeveloper/fleet/server/internal/commands"
	"github.com/moamiindeveloper/fleet/server/internal/geocode"
	"github.com/moamiindeveloper/fleet/server/internal/hub"
	"github.com/moamiindeveloper/fleet/server/internal/notify"
	"github.com/moamiindeveloper/fleet/server/internal/reports"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// Config configures the HTTP API.
type Config struct {
	// JWTSecret signs access tokens (HS256). Required.
	JWTSecret []byte
	// TokenTTL is the token lifetime; defaults to 7 days.
	TokenTTL time.Duration
	// CORSOrigins is a comma-separated list of allowed browser origins, or
	// "*" for any. Empty disables CORS (same-origin only).
	CORSOrigins string
	// WebDir holds the built SPA; ignored when it does not exist.
	WebDir string
	// Notifier backs the Telegram/push endpoints and Commands the device
	// command endpoints; both are required for those routes.
	Notifier *notify.Service
	Commands *commands.Service
	Logger   *slog.Logger
	// Geocoder resolves addresses (/geocode, report addresses); when nil a
	// places-only geocoder is used. Reports defaults to an engine on the store.
	Geocoder *geocode.Service
	Reports  *reports.Engine
}

// Server holds the API dependencies.
type Server struct {
	store *store.Store
	hub   *hub.Hub
	cfg   Config
	log   *slog.Logger

	origins   []string // allowed CORS origins; ["*"] for any
	wsOrigins []string // host patterns for the WebSocket origin check
}

// New builds the HTTP handler.
func New(st *store.Store, h *hub.Hub, cfg Config) http.Handler {
	if cfg.TokenTTL <= 0 {
		cfg.TokenTTL = 7 * 24 * time.Hour
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.New(slog.DiscardHandler)
	}
	s := &Server{store: st, hub: h, cfg: cfg, log: cfg.Logger}
	s.parseOrigins(cfg.CORSOrigins)
	return s.routes()
}

func (s *Server) routes() http.Handler {
	r := chi.NewRouter()
	r.Use(s.recoverer, s.requestLogger, s.cors)
	compress := middleware.Compress(5, "application/json", "text/html", "text/css", "text/plain",
		"text/javascript", "application/javascript", "image/svg+xml")

	r.Route("/api/v1", func(r chi.Router) {
		r.NotFound(func(w http.ResponseWriter, _ *http.Request) { writeError(w, http.StatusNotFound, "not found") })
		r.MethodNotAllowed(func(w http.ResponseWriter, _ *http.Request) {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		})

		// WebSocket must not be wrapped by the gzip writer.
		r.Get("/ws", s.handleWS)

		r.Group(func(r chi.Router) {
			r.Use(compress)
			r.Get("/health", s.handleHealth)
			r.Post("/auth/login", s.handleLogin)
			r.Post("/ingest/traccar", s.handleTraccar) // authenticated by ?token=
			s.mountPublic(r)                           // Phase 3: unauthenticated share links

			r.Group(func(r chi.Router) {
				r.Use(s.authenticate)
				r.Get("/me", s.handleMe)
				r.Get("/summary", s.handleSummary)
				r.Get("/devices", s.handleListDevices)
				r.Get("/devices/{id}", s.handleGetDevice)
				r.Get("/devices/{id}/positions", s.handlePositions)
				r.Get("/devices/{id}/trips", s.handleTrips)
				r.Get("/devices/{id}/commands", s.handleListCommands)
				r.Post("/devices/{id}/commands", s.handleCreateCommand) // per-type admin check inside
				r.Get("/events", s.handleEvents)
				r.Get("/geofences", s.handleListGeofences)
				r.Get("/settings", s.handleGetSettings)
				r.Get("/me/notifications", s.handleGetNotifications)
				r.Put("/me/notifications", s.handlePutNotifications)
				r.Post("/me/notifications/test", s.handleTestNotification)
				r.Post("/me/telegram/link", s.handleTelegramLink)
				r.Delete("/me/telegram", s.handleTelegramUnlink)
				r.Get("/push/vapid-key", s.handleVAPIDKey)
				r.Post("/push/subscriptions", s.handleAddPushSubscription)
				r.Delete("/push/subscriptions", s.handleDeletePushSubscription)

				// Phase 3 modules register their own routes (incl. their own role checks).
				s.mountAnalytics(r)
				s.mountManagement(r)
				// Phase 4a modules.
				s.mountDispatch(r)
				s.mountAutomation(r)

				// Managers: only devices / geofences within their groups (checked inside).
				r.Group(func(r chi.Router) {
					r.Use(requireManager)
					r.Patch("/devices/{id}", s.handleUpdateDevice)
					r.Delete("/devices/{id}", s.handleDeleteDevice)
					r.Post("/geofences", s.handleCreateGeofence)
					r.Patch("/geofences/{id}", s.handleUpdateGeofence)
					r.Delete("/geofences/{id}", s.handleDeleteGeofence)
				})

				r.Group(func(r chi.Router) {
					r.Use(requireAdmin)
					r.Post("/devices", s.handleCreateDevice)
					r.Patch("/settings", s.handlePatchSettings)
					r.Post("/settings/traccar-token", s.handleRegenerateTraccarToken)
				})
			})
		})
	})
	r.HandleFunc("/api/*", func(w http.ResponseWriter, _ *http.Request) { writeError(w, http.StatusNotFound, "not found") })

	if st, err := os.Stat(s.cfg.WebDir); s.cfg.WebDir != "" && err == nil && st.IsDir() {
		s.log.Info("serving web app", "dir", s.cfg.WebDir)
		r.With(compress).Handle("/*", spaHandler(s.cfg.WebDir))
	} else {
		s.log.Warn("web app directory not found, serving API only", "dir", s.cfg.WebDir)
		r.Get("/", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			_, _ = w.Write([]byte("fleetd is running. API at /api/v1 (web UI not built).\n"))
		})
	}
	return r
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Ping(r.Context()); err != nil {
		s.log.Error("health: database unreachable", "err", err)
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleSummary(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.store.SummaryScoped(s.deviceScope(r)))
}

// writeJSON writes v as a JSON response.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError writes the contract's error body {"error": msg}.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// fail maps a store error to an HTTP response.
func (s *Server) fail(w http.ResponseWriter, r *http.Request, err error) {
	s.failAs(w, r, err, "device not found")
}

// failAs is fail with the message used for store.ErrNotFound.
func (s *Server) failAs(w http.ResponseWriter, r *http.Request, err error, notFound string) {
	var (
		ve *store.ValidationError
		fe *forbiddenError
	)
	switch {
	case errors.As(err, &ve):
		writeError(w, http.StatusBadRequest, ve.Msg)
	case errors.As(err, &fe):
		writeError(w, http.StatusForbidden, fe.msg)
	case errors.Is(err, errGone):
		writeError(w, http.StatusGone, err.Error())
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, notFound)
	case errors.Is(err, commands.ErrForbidden):
		writeError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, store.ErrDuplicateIMEI), errors.Is(err, commands.ErrUnsupported),
		errors.Is(err, notify.ErrTelegramNotConfigured):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, notify.ErrTelegramUnavailable):
		writeError(w, http.StatusBadGateway, err.Error())
	default:
		s.log.ErrorContext(r.Context(), "request failed", "method", r.Method, "path", r.URL.Path, "err", err)
		writeError(w, http.StatusInternalServerError, "internal server error")
	}
}

const maxBodyBytes = 1 << 20

// decodeJSON reads a JSON request body into v.
func decodeJSON(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return &store.ValidationError{Msg: "request body too large"}
		}
		return &store.ValidationError{Msg: "invalid JSON body"}
	}
	return nil
}

func (s *Server) parseOrigins(list string) {
	for _, o := range strings.Split(list, ",") {
		o = strings.TrimSpace(strings.TrimSuffix(o, "/"))
		if o == "" {
			continue
		}
		s.origins = append(s.origins, o)
		if o == "*" {
			s.wsOrigins = append(s.wsOrigins, "*")
		} else if _, host, ok := strings.Cut(o, "://"); ok {
			s.wsOrigins = append(s.wsOrigins, host)
		}
	}
}
