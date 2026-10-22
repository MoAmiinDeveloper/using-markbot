// Package domain holds the protocol-agnostic types shared by the gateway
// (device-facing side) and the store/API (user-facing side).
package domain

import (
	"context"
	"time"
)

// Position is one normalized fix reported by a tracker, independent of the
// vendor protocol that produced it.
type Position struct {
	IMEI       string    `json:"imei"`
	DeviceID   int64     `json:"deviceId"` // filled in by the sink/store, 0 on the gateway side
	Protocol   string    `json:"protocol"` // e.g. "teltonika"
	DeviceTime time.Time `json:"time"`
	ServerTime time.Time `json:"serverTime"`
	Latitude   float64   `json:"lat"`
	Longitude  float64   `json:"lng"`
	Altitude   float64   `json:"altitude"`   // meters
	Speed      float64   `json:"speed"`      // km/h
	Course     float64   `json:"course"`     // degrees, 0 = north
	Satellites int       `json:"satellites"` // visible/used satellites
	Valid      bool      `json:"valid"`      // GNSS fix valid
	Priority   int       `json:"priority"`   // 0 low, 1 high, 2 panic
	EventID    int       `json:"eventId"`    // IO id that triggered the record, 0 if periodic

	// Attributes carries decoded IO values. Well-known keys (see Attr*
	// constants) are normalized across vendors; anything unmapped is stored
	// as "io<ID>" with its raw numeric value (or hex string for variable-length).
	Attributes map[string]any `json:"attributes"`
}

// Normalized attribute keys. Protocol decoders should map vendor IO ids to
// these when the meaning is known.
const (
	AttrIgnition     = "ignition"     // bool
	AttrMotion       = "motion"       // bool
	AttrPower        = "power"        // external voltage, V (float64)
	AttrBattery      = "battery"      // internal battery voltage, V (float64)
	AttrBatteryLevel = "batteryLevel" // %, int
	AttrOdometer     = "odometer"     // total distance, meters (float64)
	AttrTripOdometer = "tripOdometer" // meters (float64)
	AttrRSSI         = "rssi"         // GSM signal 0..5 (int)
	AttrGNSSStatus   = "gnssStatus"   // int
	AttrHDOP         = "hdop"         // float64
	AttrPDOP         = "pdop"         // float64
	AttrFuel         = "fuel"         // liters or % depending on source (float64)
	AttrFuelUsed     = "fuelUsed"     // liters (float64)
	AttrRPM          = "rpm"          // int
	AttrEngineTemp   = "engineTemp"   // °C (float64)
	AttrDriverID     = "driverId"     // iButton / RFID (string)
	AttrSleepMode    = "sleepMode"    // int
	AttrMovement     = AttrMotion
	AttrInputPrefix  = "in"  // in1, in2 … digital inputs (bool)
	AttrOutputPrefix = "out" // out1, out2 … digital outputs (bool)
	AttrAlarm        = "alarm" // string, e.g. "sos", "overspeed", "towing", "crash", "jamming"
)

// Sink is what the gateway hands decoded data to. The store/API layer
// implements it. Implementations must be safe for concurrent use.
type Sink interface {
	// Authorize is called once per connection after the device identifies
	// itself. Returning false makes the gateway reject the device.
	Authorize(ctx context.Context, imei, protocol string) (bool, error)

	// Positions persists a batch from one device packet. The gateway only
	// acknowledges the packet to the device after this returns nil, so data
	// is never lost: on error the device will resend.
	Positions(ctx context.Context, batch []Position) error

	// Connection reports that a device session opened (online=true) or closed.
	Connection(ctx context.Context, imei string, online bool, remoteAddr string)
}
