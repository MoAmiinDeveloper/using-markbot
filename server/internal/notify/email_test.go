package notify

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/mail"
	"github.com/moamiindeveloper/fleet/server/internal/mail/mailtest"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

func TestPhase4aDefaults(t *testing.T) {
	loud := map[string]bool{store.EventJobAssigned: true, store.EventJobLate: true, store.EventRouteDeviation: true,
		store.EventFuelDrain: true, store.EventSensorHigh: true, store.EventSensorLow: true}
	for _, typ := range []string{store.EventJobAssigned, store.EventJobStatus, store.EventJobStopArrived,
		store.EventJobLate, store.EventRouteDeviation, store.EventRouteReturn, store.EventFuelDrain, store.EventRefuel,
		store.EventSensorHigh, store.EventSensorLow} {
		c := store.DefaultChannels(typ)
		if !c.InApp || c.Telegram != loud[typ] || c.Push != loud[typ] || c.Email {
			t.Errorf("%s defaults %+v", typ, c)
		}
		found := false
		for _, n := range store.NotifyEventTypes {
			found = found || n == typ
		}
		if !found || typeTitle(typ) == typ {
			t.Errorf("%s not registered (title %q)", typ, typeTitle(typ))
		}
	}
	if c := store.DefaultChannels(store.EventOverspeed); c.Email {
		t.Error("email must default off")
	}
}

func TestEmailChannel(t *testing.T) {
	s, st, _, _ := setup(t)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	t.Cleanup(func() { cancel(); <-done })
	go func() { s.Run(ctx); close(done) }()

	if err := s.SendEmail(ctx, mail.Message{To: []string{"a@example.com"}}); !errors.Is(err, ErrEmailNotConfigured) {
		t.Fatalf("unconfigured: %v", err)
	}
	srv := mailtest.New(t, false)
	if _, err := st.UpdateSettings(ctx, func(c *store.Settings) error {
		c.SMTP = store.SMTPSettings{Host: srv.Host, Port: srv.Port, From: "fleet@example.com", TLS: store.SMTPNone}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	u, err := st.CreateUser(ctx, "ops@example.com", "Ops", "pw1234", store.RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	quiet, err := st.CreateUser(ctx, "quiet@example.com", "Quiet", "pw1234", store.RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	st0, _ := st.NotificationState(ctx, u.ID)
	if st0.Events[store.EventFuelDrain].Email || !st0.Events[store.EventFuelDrain].Telegram {
		t.Fatalf("defaults %+v", st0.Events[store.EventFuelDrain])
	}
	prefs := st0.Events
	c := prefs[store.EventFuelDrain]
	c.Email = true
	prefs[store.EventFuelDrain] = c
	if err := st.SetEventPrefs(ctx, u.ID, prefs); err != nil {
		t.Fatal(err)
	}
	rc, err := st.Recipients(ctx)
	if err != nil || len(rc) != 1 || rc[0].UserID != u.ID || rc[0].Email != "ops@example.com" {
		t.Fatalf("recipients %+v %v (quiet user %d must be excluded)", rc, err, quiet.ID)
	}
	dev, err := st.CreateDevice(ctx, store.DeviceInput{Name: "Truck 07", IMEI: "356307042441013"})
	if err != nil {
		t.Fatal(err)
	}
	ev := store.Event{ID: 5, DeviceID: dev.ID, Type: store.EventFuelDrain, Time: time.Now(), Lat: 2.04, Lng: 45.3,
		Message: "Truck 07: possible fuel drain of 20.0 L"}
	s.Notify(ev, dev.Name)
	s.Notify(store.Event{ID: 6, DeviceID: dev.ID, Type: store.EventRefuel, Time: time.Now(), Message: "refuel"}, dev.Name)
	eventually(t, "email", func() bool { return len(srv.Messages()) == 1 })
	time.Sleep(100 * time.Millisecond)
	msgs := srv.Messages()
	if len(msgs) != 1 || msgs[0].To[0] != "ops@example.com" || !strings.Contains(msgs[0].Data, "Subject: =?utf-8?q?Fuel_drain") {
		t.Fatalf("emails %+v", msgs)
	}
}
