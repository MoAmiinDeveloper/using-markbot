package teltonika

import (
	"encoding/hex"
	"fmt"
	"strconv"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
)

// ioConverter turns a raw fixed-width IO value into a normalized attribute
// value. ok=false drops the attribute (e.g. empty iButton).
type ioConverter func(v uint64, size uint8) (val any, ok bool)

type ioMapping struct {
	key  string
	conv ioConverter
}

// ioTable maps Teltonika FMB/FMC IO ids to normalized attribute keys.
// Extend here; anything not listed is exported as "io<ID>".
var ioTable = map[uint16]ioMapping{
	239: {domain.AttrIgnition, asBool},
	240: {domain.AttrMotion, asBool},
	66:  {domain.AttrPower, scaled(1000)},   // external voltage, mV -> V
	67:  {domain.AttrBattery, scaled(1000)}, // internal battery, mV -> V
	113: {domain.AttrBatteryLevel, asInt},   // %
	16:  {domain.AttrOdometer, scaled(1)},   // total odometer, m
	199: {domain.AttrTripOdometer, scaled(1)},
	21:  {domain.AttrRSSI, asInt},       // GSM signal 0..5
	69:  {domain.AttrGNSSStatus, asInt}, // 0 off, 1 on with fix, 2 on no fix, 3 sleep
	181: {domain.AttrPDOP, scaled(10)},
	182: {domain.AttrHDOP, scaled(10)},
	1:   {domain.AttrInputPrefix + "1", asBool},
	2:   {domain.AttrInputPrefix + "2", asBool},
	3:   {domain.AttrInputPrefix + "3", asBool},
	4:   {domain.AttrInputPrefix + "4", asBool},
	179: {domain.AttrOutputPrefix + "1", asBool},
	180: {domain.AttrOutputPrefix + "2", asBool},
	380: {domain.AttrOutputPrefix + "3", asBool},
	381: {domain.AttrOutputPrefix + "4", asBool},
	200: {domain.AttrSleepMode, asInt},
	78:  {domain.AttrDriverID, hexNonZero}, // iButton
	85:  {domain.AttrRPM, asInt},
	89:  {domain.AttrFuel, scaled(1)},              // CAN fuel level, %
	83:  {domain.AttrFuelUsed, scaled(10)},         // CAN fuel consumed, 0.1 L units -> L
	115: {domain.AttrEngineTemp, signedScaled(10)}, // CAN engine temperature, 0.1 °C

	// Temperature probes keep their io<ID> key (sensor sources) but are
	// signed: Dallas 1-wire io72–io75 (0.1 °C), BLE io25–io28 (0.01 °C).
	72: {"io72", signedRaw}, 73: {"io73", signedRaw}, 74: {"io74", signedRaw}, 75: {"io75", signedRaw},
	25: {"io25", signedRaw}, 26: {"io26", signedRaw}, 27: {"io27", signedRaw}, 28: {"io28", signedRaw},
}

// eventAlarms maps event IO ids to alarm names. The alarm is raised only
// when the record was triggered by that IO (EventID) and its value is non-zero.
var eventAlarms = map[uint16]string{
	247: "crash",
	246: "towing",
	249: "jamming",
	252: "powerCut", // unplug
}

// Green driving: a record triggered by IO 253 (type 1 acceleration, 2 braking,
// 3 cornering) carries the measured value in IO 254 (g × 100).
const (
	ioGreenDrivingType  = 253
	ioGreenDrivingValue = 254
)

var greenDriving = map[uint64]string{1: "acceleration", 2: "braking", 3: "cornering"}

// priorityPanic is the record priority Teltonika uses for panic/SOS.
const priorityPanic = 2

func asBool(v uint64, _ uint8) (any, bool) { return v != 0, true }
func asInt(v uint64, _ uint8) (any, bool)  { return int(v), true }

// scaled divides the raw value (dividing, not multiplying by a fraction,
// keeps e.g. 12345 mV -> 12.345 V exact in float64).
func scaled(div float64) ioConverter {
	return func(v uint64, _ uint8) (any, bool) { return float64(v) / div, true }
}

func signedScaled(div float64) ioConverter {
	return func(v uint64, size uint8) (any, bool) {
		return float64(signExtend(v, size)) / div, true
	}
}

func signedRaw(v uint64, size uint8) (any, bool) { return signExtend(v, size), true }

func hexNonZero(v uint64, size uint8) (any, bool) {
	if v == 0 {
		return nil, false
	}
	return fmt.Sprintf("%0*X", int(size)*2, v), true
}

// signExtend interprets the low size bytes of v as a two's complement integer.
func signExtend(v uint64, size uint8) int64 {
	if size == 0 || size >= 8 {
		return int64(v)
	}
	shift := 64 - 8*uint(size)
	return int64(v<<shift) >> shift
}

// Position converts the record into a normalized domain.Position.
func (r *Record) Position(imei string, serverTime time.Time) domain.Position {
	attrs := make(map[string]any, len(r.IO)+1)
	for _, e := range r.IO {
		if e.Size == 0 {
			attrs["io"+strconv.Itoa(int(e.ID))] = hex.EncodeToString(e.Raw)
			continue
		}
		if m, ok := ioTable[e.ID]; ok {
			if v, ok := m.conv(e.Value, e.Size); ok {
				attrs[m.key] = v
			}
			continue
		}
		attrs["io"+strconv.Itoa(int(e.ID))] = e.Value
	}
	if alarm, ok := eventAlarms[r.EventID]; ok {
		if v, _ := r.IOValue(r.EventID); v != 0 {
			attrs[domain.AttrAlarm] = alarm
		}
	}
	if r.EventID == ioGreenDrivingType {
		v, _ := r.IOValue(ioGreenDrivingType)
		if kind, ok := greenDriving[v]; ok {
			attrs[domain.AttrHarsh] = kind
			if g, ok := r.IOValue(ioGreenDrivingValue); ok {
				attrs[domain.AttrHarshValue] = float64(g) / 100
			}
		}
	}
	if _, set := attrs[domain.AttrAlarm]; !set && r.Priority == priorityPanic {
		attrs[domain.AttrAlarm] = "sos"
	}

	lat := float64(r.Latitude) / 1e7
	lng := float64(r.Longitude) / 1e7
	return domain.Position{
		IMEI:       imei,
		Protocol:   protocolName,
		DeviceTime: r.Time,
		ServerTime: serverTime,
		Latitude:   lat,
		Longitude:  lng,
		Altitude:   float64(r.Altitude),
		Speed:      float64(r.Speed),
		Course:     float64(r.Angle),
		Satellites: int(r.Satellites),
		Valid:      r.Satellites > 0 && !(r.Latitude == 0 && r.Longitude == 0),
		Priority:   int(r.Priority),
		EventID:    int(r.EventID),
		Attributes: attrs,
	}
}

// positions converts a decoded batch.
func positions(imei string, recs []Record, now time.Time) []domain.Position {
	out := make([]domain.Position, len(recs))
	for i := range recs {
		out[i] = recs[i].Position(imei, now)
	}
	return out
}
