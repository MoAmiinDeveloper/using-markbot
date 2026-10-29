package api

import (
	"context"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

func TestDeviceRegistration(t *testing.T) {
	e := newEnv(t, "")
	body := map[string]any{"name": "Truck 1", "imei": "356307042441013", "icon": "truck",
		"details": map[string]any{
			"vehicle": map[string]any{"vin": "1hgcm82633a004352", "make": "Isuzu", "model": "NPR", "year": 2019, "fuelType": "Diesel"},
			"sim":     map[string]any{"iccid": "8925201234567890123", "operator": "Somtel", "installDate": "2026-10-01"},
			"owner":   map[string]any{"name": "Ahmed Ali", "phone": "+252 63 4000000", "email": "ahmed@example.com"},
		}}
	var d store.Device
	e.do("POST", "/api/v1/devices", e.token, body, 201, &d)
	if d.Icon != "truck" || d.Details.Vehicle.VIN != "1HGCM82633A004352" || d.Details.Vehicle.FuelType != "diesel" ||
		d.Details.Owner.Name != "Ahmed Ali" || d.Details.SIM.Operator != "Somtel" {
		t.Fatalf("device %+v", d)
	}
	for _, bad := range []map[string]any{
		{"icon": "rocket"},
		{"details": map[string]any{"vehicle": map[string]any{"vin": "OOO"}}},
		{"details": map[string]any{"owner": map[string]any{"email": "nope"}}},
		{"details": map[string]any{"sim": map[string]any{"installDate": "01/10/2026"}}},
		{"details": map[string]any{"vehicle": map[string]any{"year": 1800}}},
	} {
		e.do("PATCH", "/api/v1/devices/"+itoa(d.ID), e.token, bad, 400, nil)
	}
	// PATCH without details keeps them; icon can be cleared.
	e.do("PATCH", "/api/v1/devices/"+itoa(d.ID), e.token, map[string]any{"icon": "", "plate": "SL-1"}, 200, &d)
	if d.Icon != "" || d.Details.Owner.Email != "ahmed@example.com" || d.Plate != "SL-1" {
		t.Fatalf("patched %+v", d)
	}
	var got store.Device
	e.do("GET", "/api/v1/devices/"+itoa(d.ID), e.token, nil, 200, &got)
	if got.Details.Vehicle.Make != "Isuzu" {
		t.Fatalf("get %+v", got.Details)
	}
}

func TestParametersAndCustomEvents(t *testing.T) {
	e := newEnv(t, "")
	ctx := context.Background()
	var d store.Device
	e.do("POST", "/api/v1/devices", e.token, map[string]any{"name": "Van", "imei": "356307042441013"}, 201, &d)

	var mapped, calc store.ParamDef
	e.do("POST", "/api/v1/params", e.token, map[string]any{"key": "io9", "name": "Fuel sensor", "unit": "mV"}, 201, &mapped)
	e.do("POST", "/api/v1/params", e.token, map[string]any{"key": "io9", "name": "Again"}, 409, nil)
	e.do("POST", "/api/v1/params", e.token, map[string]any{"kind": "calculated", "key": "speed", "name": "x", "expression": "1"}, 400, nil)
	e.do("POST", "/api/v1/params", e.token, map[string]any{"kind": "calculated", "key": "fuelL", "name": "Fuel", "expression": "io9 / "}, 400, nil)
	e.do("POST", "/api/v1/params", e.token, map[string]any{"kind": "calculated", "key": "fuelL", "name": "Fuel",
		"expression": "io9 / 1000 * 2.5", "unit": "L", "decimals": 1}, 201, &calc)
	// A device-specific definition overrides the global one with the same key.
	e.do("POST", "/api/v1/params", e.token, map[string]any{"deviceId": d.ID, "kind": "calculated", "key": "lowFuel",
		"name": "Low fuel", "expression": "fuelL < 12 && ignition"}, 201, nil)

	var list []store.ParamDef
	e.do("GET", "/api/v1/params?deviceId="+itoa(d.ID), e.token, nil, 200, &list)
	if len(list) != 3 {
		t.Fatalf("params %+v", list)
	}

	var ce store.CustomEvent
	e.do("POST", "/api/v1/custom-events", e.token, map[string]any{"name": "Low fuel", "condition": "lowFuel",
		"message": "{device} fuel {fuelL} L", "severity": "critical", "notifyEnd": true, "deviceIds": []int64{d.ID}}, 201, &ce)
	e.do("POST", "/api/v1/custom-events", e.token, map[string]any{"name": "Bad", "condition": "speed = 3"}, 400, nil)

	base := time.Now().UTC().Truncate(time.Second).Add(-10 * time.Minute)
	pos := func(i int, io9 int, ign bool) domain.Position {
		return domain.Position{IMEI: d.IMEI, Protocol: "teltonika", DeviceTime: base.Add(time.Duration(i) * time.Minute),
			Latitude: 9.56, Longitude: 44.06, Valid: true, Attributes: map[string]any{"io9": uint64(io9), "ignition": ign}}
	}
	for i, p := range []domain.Position{pos(0, 6000, true), pos(1, 4000, true), pos(2, 4000, true), pos(3, 6000, true)} {
		if err := e.store.Positions(ctx, []domain.Position{p}); err != nil {
			t.Fatal(i, err)
		}
	}
	var ps []domain.Position
	e.do("GET", "/api/v1/devices/"+itoa(d.ID)+"/positions?from="+base.Add(-time.Minute).Format(time.RFC3339), e.token, nil, 200, &ps)
	if len(ps) != 4 || ps[1].Attributes["fuelL"] != 10.0 || ps[1].Attributes["lowFuel"] != true || ps[0].Attributes["lowFuel"] != false {
		t.Fatalf("calculated attributes %+v", ps)
	}

	var evs []store.Event
	e.do("GET", "/api/v1/events?deviceId="+itoa(d.ID)+"&type=custom", e.token, nil, 200, &evs)
	if len(evs) != 2 {
		t.Fatalf("custom events %+v", evs)
	}
	start, end := evs[1], evs[0] // newest first
	if start.Message != "Van fuel 10 L" || start.Attributes["phase"] != "start" || start.Attributes["severity"] != "critical" ||
		end.Attributes["phase"] != "end" {
		t.Fatalf("start %+v end %+v", start, end)
	}

	var res store.ParamTestResult
	e.do("POST", "/api/v1/params/test", e.token, map[string]any{"expression": "fuelL * 2", "deviceId": d.ID}, 200, &res)
	if res.Value != 30.0 || res.Error != "" {
		t.Fatalf("test %+v", res)
	}
	e.do("POST", "/api/v1/params/test", e.token, map[string]any{"expression": "io77 + 1", "deviceId": d.ID}, 200, &res)
	if !res.Missing {
		t.Fatalf("missing %+v", res)
	}

	// Managers: only definitions for their devices.
	var g store.Group
	e.do("POST", "/api/v1/groups", e.token, map[string]any{"name": "G", "deviceIds": []int64{d.ID}}, 201, &g)
	e.do("POST", "/api/v1/users", e.token, map[string]any{"email": "m@b.co", "password": "123456", "role": "manager",
		"groupIds": []int64{g.ID}}, 201, nil)
	var login struct{ Token string }
	e.do("POST", "/api/v1/auth/login", "", map[string]string{"email": "m@b.co", "password": "123456"}, 200, &login)
	e.do("POST", "/api/v1/params", login.Token, map[string]any{"key": "io10", "name": "x"}, 403, nil)
	e.do("POST", "/api/v1/params", login.Token, map[string]any{"deviceId": d.ID, "key": "io10", "name": "x"}, 201, nil)
	e.do("PUT", "/api/v1/params/"+itoa(calc.ID), login.Token, map[string]any{"key": "fuelL", "name": "y", "kind": "calculated", "expression": "1"}, 403, nil)
	e.do("POST", "/api/v1/custom-events", login.Token, map[string]any{"name": "All", "condition": "speed > 1"}, 403, nil)
	e.do("DELETE", "/api/v1/custom-events/"+itoa(ce.ID), login.Token, nil, 204, nil)
	e.do("DELETE", "/api/v1/params/"+itoa(mapped.ID), e.token, nil, 204, nil)
}
