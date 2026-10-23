package traccar

import (
	"errors"
	"math"
	"testing"
	"time"
)

// sample is a position forwarded by Traccar 6 with forward.type=json
// (Jackson serialization of Position and Device).
const sample = `{
  "position": {
    "id": 0,
    "attributes": {
      "priority": 0, "sat": 12, "event": 240, "ignition": true, "motion": true,
      "rssi": 4, "io21": 4, "power": 13.86, "battery": 4.09, "batteryLevel": 95,
      "distance": 12.34, "totalDistance": 98765.43, "hours": 3600000,
      "alarm": "tow", "driverUniqueId": "00000ABC", "in1": true
    },
    "deviceId": 17,
    "protocol": "teltonika",
    "serverTime": "2026-10-22T10:00:01.123+00:00",
    "deviceTime": "2026-10-22T09:59:59.000+00:00",
    "fixTime": "2026-10-22T10:00:00.000+00:00",
    "outdated": false,
    "valid": true,
    "latitude": 25.2048,
    "longitude": 55.2708,
    "altitude": 12.5,
    "speed": 27.0,
    "course": 270.0,
    "address": null,
    "accuracy": 0.0,
    "network": null,
    "geofenceIds": null
  },
  "device": {
    "id": 17, "attributes": {}, "groupId": 0, "calendarId": 0,
    "name": "Truck 07", "uniqueId": "356307042441013", "status": "online",
    "lastUpdate": "2026-10-22T10:00:01.123+00:00", "positionId": 0,
    "phone": null, "model": null, "contact": null, "category": null,
    "disabled": false, "expirationTime": null
  }
}`

func TestDecodeSample(t *testing.T) {
	f, err := Decode([]byte(sample), time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	p := f.Position
	if f.UniqueID != "356307042441013" || f.DeviceName != "Truck 07" || p.IMEI != f.UniqueID || p.Protocol != "teltonika" {
		t.Fatalf("identity %+v", f)
	}
	if !p.DeviceTime.Equal(time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC)) {
		t.Fatalf("time %v (want fixTime)", p.DeviceTime)
	}
	if p.Latitude != 25.2048 || p.Longitude != 55.2708 || p.Altitude != 12.5 || p.Course != 270 || !p.Valid {
		t.Fatalf("fix %+v", p)
	}
	if math.Abs(p.Speed-50.004) > 1e-9 {
		t.Fatalf("speed %v km/h, want 27 kn = 50.004", p.Speed)
	}
	if p.Satellites != 12 || p.EventID != 240 || p.Priority != 0 {
		t.Fatalf("fields %+v", p)
	}
	a := p.Attributes
	want := map[string]any{
		"ignition": true, "motion": true, "power": 13.86, "battery": 4.09, "batteryLevel": 95.0, "rssi": 4.0,
		"io21": 4.0, "odometer": 98765.43, "alarm": "towing", "driverId": "00000ABC", "in1": true,
	}
	for k, v := range want {
		if a[k] != v {
			t.Errorf("attributes[%s] = %#v, want %#v", k, a[k], v)
		}
	}
	for _, k := range []string{"sat", "priority", "event", "driverUniqueId"} {
		if _, ok := a[k]; ok {
			t.Errorf("attribute %s should have been mapped away", k)
		}
	}
}

func TestDecodeLenient(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		body string
		want time.Time
	}{
		// String numbers, deviceTime only, offset without colon.
		{`{"position":{"latitude":"1.5","longitude":"2.5","speed":"10","deviceTime":"2026-10-22T12:00:00.000+0200",
			"attributes":{"ignition":"true"}},"device":{"uniqueId":"abc"}}`, time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC)},
		// Epoch milliseconds.
		{`{"position":{"latitude":1,"longitude":2,"fixTime":1761127200000},"device":{"uniqueId":"abc"}}`,
			time.UnixMilli(1761127200000).UTC()},
		// No time at all: now.
		{`{"position":{"latitude":1,"longitude":2},"device":{"uniqueId":"abc"}}`, now},
	}
	for i, c := range cases {
		f, err := Decode([]byte(c.body), now)
		if err != nil {
			t.Fatalf("case %d: %v", i, err)
		}
		if !f.Position.DeviceTime.Equal(c.want) || !f.Position.Valid {
			t.Errorf("case %d: time %v valid %v", i, f.Position.DeviceTime, f.Position.Valid)
		}
	}
	f, _ := Decode([]byte(cases[0].body), now)
	if f.Position.Latitude != 1.5 || math.Abs(f.Position.Speed-18.52) > 1e-9 || f.Position.Attributes["ignition"] != true {
		t.Fatalf("lenient %+v", f.Position)
	}
}

func TestDecodeInvalid(t *testing.T) {
	for i, body := range []string{
		`not json`,
		`{"device":{"uniqueId":"abc"}}`,
		`{"position":{"latitude":1,"longitude":2},"device":{}}`,
		`{"position":{"latitude":91,"longitude":2},"device":{"uniqueId":"abc"}}`,
		`{"position":{"longitude":2},"device":{"uniqueId":"abc"}}`,
		`{"position":{"latitude":1,"longitude":2,"fixTime":"yesterday"},"device":{"uniqueId":"abc"}}`,
	} {
		if _, err := Decode([]byte(body), time.Now()); !errors.Is(err, ErrInvalid) {
			t.Errorf("case %d: err = %v", i, err)
		}
	}
}

func TestHarshAlarms(t *testing.T) {
	cases := []struct {
		alarm      string
		harsh, out any
	}{
		{"hardBraking", "braking", nil},
		{"hardAcceleration", "acceleration", nil},
		{"hardCornering", "cornering", nil},
		{"sos,hardBraking", "braking", "sos"},
		{"tow", nil, "towing"},
	}
	for _, c := range cases {
		body := `{"position":{"latitude":1,"longitude":2,"fixTime":"2026-10-22T10:00:00Z","attributes":{"alarm":"` +
			c.alarm + `"}},"device":{"uniqueId":"1"}}`
		fix, err := Decode([]byte(body), time.Now())
		if err != nil {
			t.Fatal(err)
		}
		a := fix.Position.Attributes
		if a["harsh"] != c.harsh || a["alarm"] != c.out {
			t.Errorf("%s: harsh=%v alarm=%v, want %v %v", c.alarm, a["harsh"], a["alarm"], c.harsh, c.out)
		}
		if _, ok := a["alarm"]; !ok && c.out != nil {
			t.Errorf("%s: alarm missing", c.alarm)
		}
	}
}
