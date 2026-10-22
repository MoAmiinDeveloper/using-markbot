package teltonika

import (
	"bytes"
	"encoding/hex"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
)

// Example packets from the Teltonika wiki ("Teltonika Data Sending Protocols").
const (
	wikiCodec8   = "000000000000003608010000016B40D8EA30010000000000000000000000000000000105021503010101425E0F01F10000601A014E0000000000000000010000C7CF"
	wikiCodec8E  = "000000000000004A8E010000016B412CEE000100000000000000000000000000000000010005000100010100010011001D00010010015E2C880002000B000000003544C87A000E000000001DD7E06A00000100002994"
	wikiCodec16  = "000000000000005F10020000016BDBC7833000000000000000000000000000000000000B05040200010000030002000B00270042563A00000000016BDBC7871800000000000000000000000000000000000B05040200010000030002000B00260042563A00000200005FB3"
	wikiGetinfo  = "000000000000000F0C010500000007676574696E666F0100004312"
	wikiUDPCodec = "003DCAFE0105000F33353230393330383634303336353508010000016B4F815B30010000000000000000000000000000000103021503010101425DBC000001"
)

func mustHex(t testing.TB, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// readPayload parses a full TCP frame from hex.
func readPayload(t *testing.T, s string) []byte {
	t.Helper()
	p, err := ReadFrame(bytes.NewReader(mustHex(t, s)), nil, DefaultMaxPacketSize)
	if err != nil {
		t.Fatalf("ReadFrame: %v", err)
	}
	return p
}

func TestCRC16(t *testing.T) {
	if got := CRC16([]byte("123456789")); got != 0xBB3D {
		t.Errorf("CRC16 check value = %04X, want BB3D", got)
	}
	frame := mustHex(t, wikiCodec8)
	if got := CRC16(frame[8 : len(frame)-4]); got != 0xC7CF {
		t.Errorf("CRC16(codec8 example) = %04X, want C7CF", got)
	}
}

func TestReadFrameBadCRC(t *testing.T) {
	frame := mustHex(t, wikiCodec8)
	frame[len(frame)-1] ^= 0xFF
	p, err := ReadFrame(bytes.NewReader(frame), nil, DefaultMaxPacketSize)
	if !errors.Is(err, ErrBadCRC) || p == nil {
		t.Fatalf("got %v, %v; want payload + ErrBadCRC", p, err)
	}
}

func TestReadFrameGuards(t *testing.T) {
	frame := mustHex(t, wikiCodec8)
	if _, err := ReadFrame(bytes.NewReader(frame), nil, 16); !errors.Is(err, ErrFrameTooLarge) {
		t.Errorf("max size: got %v", err)
	}
	bad := append([]byte{1}, frame[1:]...)
	if _, err := ReadFrame(bytes.NewReader(bad), nil, DefaultMaxPacketSize); !errors.Is(err, ErrBadPreamble) {
		t.Errorf("preamble: got %v", err)
	}
	if _, err := ReadFrame(bytes.NewReader(frame[:20]), nil, DefaultMaxPacketSize); err == nil {
		t.Error("truncated frame accepted")
	}
}

func TestDecodeCodec8Example(t *testing.T) {
	codec, recs, err := DecodeAVL(readPayload(t, wikiCodec8))
	if err != nil {
		t.Fatal(err)
	}
	if codec != Codec8 || len(recs) != 1 {
		t.Fatalf("codec %02X, %d records", codec, len(recs))
	}
	r := recs[0]
	if want := time.Date(2019, 6, 10, 10, 4, 46, 0, time.UTC); !r.Time.Equal(want) {
		t.Errorf("time = %v, want %v", r.Time, want)
	}
	if r.Priority != 1 || r.EventID != 1 || r.Satellites != 0 {
		t.Errorf("priority %d event %d sats %d", r.Priority, r.EventID, r.Satellites)
	}
	want := []IOElement{
		{ID: 21, Size: 1, Value: 3},
		{ID: 1, Size: 1, Value: 1},
		{ID: 66, Size: 2, Value: 0x5E0F},
		{ID: 241, Size: 4, Value: 0x601A},
		{ID: 78, Size: 8, Value: 0},
	}
	if !reflect.DeepEqual(r.IO, want) {
		t.Errorf("IO = %+v\nwant %+v", r.IO, want)
	}

	p := r.Position("352093086403655", time.Now())
	if p.Valid {
		t.Error("position without satellites must be invalid")
	}
	if p.Attributes[domain.AttrRSSI] != 3 || p.Attributes["in1"] != true ||
		p.Attributes[domain.AttrPower] != 24.079 || p.Attributes["io241"] != uint64(0x601A) {
		t.Errorf("attributes = %v", p.Attributes)
	}
	if _, ok := p.Attributes[domain.AttrDriverID]; ok {
		t.Error("zero iButton must be omitted")
	}
}

func TestDecodeCodec8EExample(t *testing.T) {
	codec, recs, err := DecodeAVL(readPayload(t, wikiCodec8E))
	if err != nil {
		t.Fatal(err)
	}
	if codec != Codec8E || len(recs) != 1 {
		t.Fatalf("codec %02X, %d records", codec, len(recs))
	}
	r := recs[0]
	if r.Time.UnixMilli() != 0x16B412CEE00 || r.Priority != 1 || r.EventID != 1 {
		t.Errorf("header: %+v", r)
	}
	want := []IOElement{
		{ID: 1, Size: 1, Value: 1},
		{ID: 0x11, Size: 2, Value: 0x1D},
		{ID: 0x10, Size: 4, Value: 0x015E2C88},
		{ID: 0x0B, Size: 8, Value: 0x3544C87A},
		{ID: 0x0E, Size: 8, Value: 0x1DD7E06A},
	}
	if !reflect.DeepEqual(r.IO, want) {
		t.Errorf("IO = %+v\nwant %+v", r.IO, want)
	}
	p := r.Position("x", time.Now())
	if p.Attributes[domain.AttrOdometer] != float64(0x015E2C88) {
		t.Errorf("odometer = %v", p.Attributes[domain.AttrOdometer])
	}
}

func TestDecodeCodec16Example(t *testing.T) {
	codec, recs, err := DecodeAVL(readPayload(t, wikiCodec16))
	if err != nil {
		t.Fatal(err)
	}
	if codec != Codec16 || len(recs) != 2 {
		t.Fatalf("codec %02X, %d records", codec, len(recs))
	}
	for i, wantOdo := range []uint64{0x27, 0x26} {
		r := recs[i]
		if r.EventID != 0x0B || r.Generation != 5 {
			t.Errorf("rec %d: event %d generation %d", i, r.EventID, r.Generation)
		}
		want := []IOElement{
			{ID: 1, Size: 1, Value: 0},
			{ID: 3, Size: 1, Value: 0},
			{ID: 0x0B, Size: 2, Value: wantOdo},
			{ID: 0x42, Size: 2, Value: 0x563A},
		}
		if !reflect.DeepEqual(r.IO, want) {
			t.Errorf("rec %d IO = %+v\nwant %+v", i, r.IO, want)
		}
	}
	if d := recs[1].Time.Sub(recs[0].Time); d != time.Second {
		t.Errorf("record spacing = %v", d)
	}
}

func TestCodec12(t *testing.T) {
	if got := hex.EncodeToString(EncodeCodec12Command("getinfo")); !strings.EqualFold(got, wikiGetinfo) {
		t.Errorf("EncodeCodec12Command = %s, want %s", got, wikiGetinfo)
	}
	text := "INI:2019/7/22 7:22 RTC:2019/7/22 7:53 RST:2 ERR:1 SR:0 BR:0 CF:0 FG:0 FL:0 TU:0/0 UT:0 SMS:0 NOGPS:0:30 GPS:1 SAT:0 RS:3 RF:65 SF:1 MD:0"
	typ, data, err := DecodeCodec12(readPayload(t, hex.EncodeToString(EncodeCodec12Response(text))))
	if err != nil || typ != Codec12Response || string(data) != text {
		t.Fatalf("DecodeCodec12 = %d %q %v", typ, data, err)
	}
}

func TestRoundTrip(t *testing.T) {
	base := time.Date(2026, 1, 2, 3, 4, 5, 678e6, time.UTC)
	mk := func(withNX, wide bool) []Record {
		io := []IOElement{
			NewIO(239, 1, 1), NewIO(240, 1, 1), NewIO(21, 1, 4),
			NewIO(66, 2, 13800), NewIO(115, 2, 0xFF9C), // -10.0 °C
			NewIO(16, 4, 123456789), NewIO(78, 8, 0x01A2B3C4D5E6F701),
		}
		if wide {
			io = append(io, NewIO(380, 1, 1))
		}
		if withNX {
			io = append(io, IOElement{ID: 385, Raw: []byte{0xDE, 0xAD, 0xBE, 0xEF}})
		}
		return []Record{
			{Time: base, Priority: 0, Longitude: 552708000, Latitude: 252048000, Altitude: 12, Angle: 270,
				Satellites: 11, Speed: 87, EventID: 239, Generation: 3, IO: io},
			{Time: base.Add(time.Second), Priority: 2, Longitude: -1234567890, Latitude: -334567890, Altitude: -15,
				Satellites: 5, Speed: 0, IO: []IOElement{}},
		}
	}
	cases := []struct {
		codec byte
		recs  []Record
	}{
		{Codec8, mk(false, false)},
		{Codec8E, mk(true, true)},
		{Codec16, mk(false, true)},
	}
	for _, c := range cases {
		frame, err := EncodeAVLPacket(c.codec, c.recs)
		if err != nil {
			t.Fatalf("codec %02X encode: %v", c.codec, err)
		}
		payload, err := ReadFrame(bytes.NewReader(frame), nil, DefaultMaxPacketSize)
		if err != nil {
			t.Fatal(err)
		}
		codec, got, err := DecodeAVL(payload)
		if err != nil || codec != c.codec {
			t.Fatalf("codec %02X decode: %v", c.codec, err)
		}
		if c.codec != Codec16 {
			for i := range c.recs {
				c.recs[i].Generation = 0
			}
		}
		// Encoder groups by size; compare as sets via Position attributes
		// and by sorted element count.
		for i := range got {
			if len(got[i].IO) != len(c.recs[i].IO) {
				t.Fatalf("codec %02X rec %d: %d IO, want %d", c.codec, i, len(got[i].IO), len(c.recs[i].IO))
			}
			gp, wp := got[i].Position("1", base), c.recs[i].Position("1", base)
			if !reflect.DeepEqual(gp, wp) {
				t.Errorf("codec %02X rec %d:\n got %+v\nwant %+v", c.codec, i, gp, wp)
			}
		}
	}

	p := cases[0].recs[0].Position("1", base)
	if p.Latitude != 25.2048 || p.Longitude != 55.2708 || !p.Valid {
		t.Errorf("coords %v,%v valid=%v", p.Latitude, p.Longitude, p.Valid)
	}
	if p.Attributes[domain.AttrEngineTemp] != -10.0 || p.Attributes[domain.AttrDriverID] != "01A2B3C4D5E6F701" ||
		p.Attributes[domain.AttrIgnition] != true || p.Attributes[domain.AttrPower] != 13.8 {
		t.Errorf("attributes = %v", p.Attributes)
	}
	p2 := cases[1].recs[1].Position("1", base)
	if p2.Latitude != -33.456789 || p2.Longitude != -123.456789 || p2.Attributes[domain.AttrAlarm] != "sos" {
		t.Errorf("negative coords / sos: %+v", p2)
	}
	if nx := cases[1].recs[0].Position("1", base).Attributes["io385"]; nx != "deadbeef" {
		t.Errorf("NX attribute = %v", nx)
	}

	if _, err := EncodeAVLPacket(Codec8, []Record{{IO: []IOElement{NewIO(300, 1, 1)}}}); err == nil {
		t.Error("Codec 8 accepted a 2-byte IO id")
	}
	if _, err := EncodeAVLPacket(Codec8, []Record{{IO: []IOElement{NewIO(1, 1, 300)}}}); err == nil {
		t.Error("overflowing value accepted")
	}
}

func TestEventAlarms(t *testing.T) {
	cases := []struct {
		rec  Record
		want any
	}{
		{Record{EventID: 247, IO: []IOElement{NewIO(247, 1, 1)}}, "crash"},
		{Record{EventID: 246, IO: []IOElement{NewIO(246, 1, 1)}}, "towing"},
		{Record{EventID: 249, IO: []IOElement{NewIO(249, 1, 1)}}, "jamming"},
		{Record{EventID: 249, IO: []IOElement{NewIO(249, 1, 0)}}, nil}, // jamming ended
		{Record{EventID: 252, IO: []IOElement{NewIO(252, 1, 1)}}, "powerCut"},
		{Record{EventID: 0, IO: []IOElement{NewIO(252, 1, 1)}}, nil}, // periodic record
		{Record{Priority: 2, EventID: 2, IO: []IOElement{NewIO(2, 1, 1)}}, "sos"},
		{Record{Priority: 2, EventID: 247, IO: []IOElement{NewIO(247, 1, 1)}}, "crash"},
	}
	for i, c := range cases {
		if got := c.rec.Position("1", time.Time{}).Attributes[domain.AttrAlarm]; got != c.want {
			t.Errorf("case %d: alarm = %v, want %v", i, got, c.want)
		}
	}
}

// Every truncation of a valid packet must fail cleanly, never panic.
func TestDecodeTruncated(t *testing.T) {
	for _, s := range []string{wikiCodec8, wikiCodec8E, wikiCodec16} {
		payload := readPayload(t, s)
		for n := range len(payload) {
			if _, _, err := DecodeAVL(payload[:n]); err == nil {
				t.Errorf("%02X: truncated to %d decoded without error", payload[0], n)
			}
		}
		if _, _, err := DecodeAVL(append(payload[:len(payload):len(payload)], 0)); !errors.Is(err, ErrTrailingData) {
			t.Errorf("%02X: trailing byte: %v", payload[0], err)
		}
	}
	if _, _, err := DecodeAVL([]byte{0x99, 1, 1}); !errors.Is(err, ErrUnsupportedCodec) {
		t.Errorf("unknown codec: %v", err)
	}
}

func FuzzDecodeAVL(f *testing.F) {
	for _, s := range []string{wikiCodec8, wikiCodec8E, wikiCodec16} {
		b, _ := hex.DecodeString(s)
		f.Add(b[8 : len(b)-4])
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		_, recs, err := DecodeAVL(data)
		if err == nil {
			for i := range recs {
				recs[i].Position("1", time.Time{})
			}
		}
	})
}
