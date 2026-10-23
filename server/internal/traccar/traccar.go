// Package traccar maps Traccar's JSON position forwarding payload
// (forward.type=json) to normalized positions, so devices connected to a
// Traccar server can be bridged into the fleet.
//
// Traccar posts {"position": Position, "device": Device} using its own model
// classes: speed is in knots, times are ISO 8601 strings, and IO values live
// in position.attributes with Traccar's key names.
package traccar

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
)

// KnotsToKmh converts Traccar speeds to km/h.
const KnotsToKmh = 1.852

// Payload is the forwarded body.
type Payload struct {
	Position *Position `json:"position"`
	Device   *Device   `json:"device"`
}

// Position is the subset of Traccar's Position model we use. Numbers and
// times are decoded leniently because forwarders and versions differ.
type Position struct {
	Protocol   string          `json:"protocol"`
	ServerTime json.RawMessage `json:"serverTime"`
	DeviceTime json.RawMessage `json:"deviceTime"`
	FixTime    json.RawMessage `json:"fixTime"`
	Valid      *bool           `json:"valid"`
	Latitude   json.Number     `json:"latitude"`
	Longitude  json.Number     `json:"longitude"`
	Altitude   json.Number     `json:"altitude"`
	Speed      json.Number     `json:"speed"` // knots
	Course     json.Number     `json:"course"`
	Attributes map[string]any  `json:"attributes"`
}

// Device is the subset of Traccar's Device model we use.
type Device struct {
	Name     string `json:"name"`
	UniqueID string `json:"uniqueId"`
}

// Fix is a decoded payload.
type Fix struct {
	UniqueID   string
	DeviceName string
	Position   domain.Position // IMEI = UniqueID, DeviceID unset
}

// ErrInvalid wraps every decoding error.
var ErrInvalid = errors.New("invalid Traccar payload")

func invalidf(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

// Decode parses a forwarded body. now is used when the payload has no time.
func Decode(body []byte, now time.Time) (Fix, error) {
	var p Payload
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	if err := dec.Decode(&p); err != nil {
		return Fix{}, invalidf("%v", err)
	}
	if p.Position == nil {
		return Fix{}, invalidf("position is missing")
	}
	if p.Device == nil || strings.TrimSpace(p.Device.UniqueID) == "" {
		return Fix{}, invalidf("device.uniqueId is missing")
	}
	pos := p.Position
	lat, err1 := number(pos.Latitude)
	lng, err2 := number(pos.Longitude)
	if err1 != nil || err2 != nil || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		return Fix{}, invalidf("latitude/longitude missing or out of range")
	}
	t, err := firstTime(pos.FixTime, pos.DeviceTime, pos.ServerTime)
	if err != nil {
		return Fix{}, err
	}
	if t.IsZero() {
		t = now
	}
	alt, _ := number(pos.Altitude)
	speed, _ := number(pos.Speed)
	course, _ := number(pos.Course)

	out := domain.Position{
		IMEI:       strings.TrimSpace(p.Device.UniqueID),
		Protocol:   strings.ToLower(strings.TrimSpace(pos.Protocol)),
		DeviceTime: t.UTC(),
		Latitude:   lat,
		Longitude:  lng,
		Altitude:   alt,
		Speed:      math.Max(0, speed*KnotsToKmh),
		Course:     course,
		Valid:      pos.Valid == nil || *pos.Valid,
	}
	out.Attributes, out.Satellites, out.Priority, out.EventID = mapAttributes(pos.Attributes)
	return Fix{UniqueID: out.IMEI, DeviceName: p.Device.Name, Position: out}, nil
}

// renamed maps Traccar attribute keys to normalized keys where they differ.
var renamed = map[string]string{
	"driverUniqueId": domain.AttrDriverID,
	"coolantTemp":    domain.AttrEngineTemp,
	"tripOdometer":   domain.AttrTripOdometer,
}

// alarms maps Traccar alarm names to ours; unknown names pass through.
var alarms = map[string]string{
	"tow":      "towing",
	"accident": "crash",
}

// harshAlarms maps Traccar driver-behaviour alarms to domain.AttrHarsh values.
var harshAlarms = map[string]string{
	"hardAcceleration": "acceleration",
	"hardBraking":      "braking",
	"hardCornering":    "cornering",
}

// mapAttributes normalizes Traccar attributes. sat, priority and event move
// to position fields; totalDistance stands in for a missing odometer.
func mapAttributes(in map[string]any) (attrs map[string]any, sat, priority, event int) {
	attrs = make(map[string]any, len(in))
	for k, v := range in {
		if n, ok := v.(json.Number); ok {
			v = numberValue(n)
		}
		switch k {
		case "sat":
			sat = asInt(v)
			continue
		case "priority":
			priority = asInt(v)
			continue
		case "event":
			event = asInt(v)
			continue
		case domain.AttrAlarm:
			if s, ok := v.(string); ok {
				var kept []string
				for _, a := range strings.Split(s, ",") {
					a = strings.TrimSpace(a)
					if h, ok := harshAlarms[a]; ok {
						// Driver behaviour is not a device alarm: it becomes
						// the normalized harsh attribute (first one wins).
						if _, set := attrs[domain.AttrHarsh]; !set {
							attrs[domain.AttrHarsh] = h
						}
						continue
					}
					if m, ok := alarms[a]; ok {
						a = m
					}
					if a != "" {
						kept = append(kept, a)
					}
				}
				if len(kept) == 0 {
					continue
				}
				v = strings.Join(kept, ",")
			}
		case domain.AttrIgnition, domain.AttrMotion:
			v = asBool(v)
		}
		if nk, ok := renamed[k]; ok {
			k = nk
		}
		attrs[k] = v
	}
	if _, ok := attrs[domain.AttrOdometer]; !ok {
		if td, ok := attrs["totalDistance"].(float64); ok {
			attrs[domain.AttrOdometer] = td
		}
	}
	return attrs, sat, priority, event
}

// numberValue decodes a number as float64, like attributes elsewhere.
func numberValue(n json.Number) any {
	f, _ := n.Float64()
	return f
}

func asInt(v any) int {
	switch x := v.(type) {
	case float64:
		return int(x)
	case string:
		i, _ := strconv.Atoi(x)
		return i
	}
	return 0
}

func asBool(v any) any {
	switch x := v.(type) {
	case string:
		if b, err := strconv.ParseBool(x); err == nil {
			return b
		}
	case float64:
		return x != 0
	}
	return v
}

// number accepts JSON numbers and numeric strings.
func number(n json.Number) (float64, error) {
	if n == "" {
		return 0, errors.New("missing")
	}
	f, err := strconv.ParseFloat(strings.TrimSpace(string(n)), 64)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
		return 0, errors.New("not a number")
	}
	return f, nil
}

// timeLayouts are the formats Traccar versions use (Jackson ISO 8601 with
// or without colon in the offset, or a plain RFC 3339 string).
var timeLayouts = []string{
	time.RFC3339Nano,
	"2006-01-02T15:04:05.000-0700",
	"2006-01-02T15:04:05-0700",
	"2006-01-02T15:04:05.000Z0700",
	"2006-01-02 15:04:05",
}

// firstTime returns the first non-empty time among raws (ISO strings or
// epoch milliseconds); zero when all are empty.
func firstTime(raws ...json.RawMessage) (time.Time, error) {
	for _, raw := range raws {
		s := strings.TrimSpace(string(raw))
		if s == "" || s == "null" {
			continue
		}
		if ms, err := strconv.ParseInt(s, 10, 64); err == nil {
			return time.UnixMilli(ms).UTC(), nil
		}
		var str string
		if err := json.Unmarshal(raw, &str); err != nil {
			return time.Time{}, invalidf("bad time %s", s)
		}
		for _, l := range timeLayouts {
			if t, err := time.Parse(l, str); err == nil {
				return t.UTC(), nil
			}
		}
		return time.Time{}, invalidf("bad time %q", str)
	}
	return time.Time{}, nil
}
