package teltonika

import (
	"bytes"
	"testing"
	"time"

	"github.com/moamiindeveloper/fleet/server/internal/domain"
)

// Green-driving records (event IO 253, value in IO 254) decode to the
// normalized harsh attributes; other records do not.
func TestGreenDriving(t *testing.T) {
	base := time.Date(2026, 10, 1, 8, 0, 0, 0, time.UTC)
	recs := []Record{
		{Time: base, Satellites: 9, Latitude: 25e7, Longitude: 55e7, EventID: 253,
			IO: []IOElement{NewIO(253, 1, 1), NewIO(254, 1, 123), NewIO(239, 1, 1)}},
		{Time: base.Add(time.Second), Satellites: 9, Latitude: 25e7, Longitude: 55e7, EventID: 253,
			IO: []IOElement{NewIO(253, 1, 2), NewIO(254, 1, 250)}},
		{Time: base.Add(2 * time.Second), Satellites: 9, Latitude: 25e7, Longitude: 55e7, EventID: 253,
			IO: []IOElement{NewIO(253, 1, 3)}},
		{Time: base.Add(3 * time.Second), Satellites: 9, Latitude: 25e7, Longitude: 55e7, EventID: 0, // periodic
			IO: []IOElement{NewIO(253, 1, 2), NewIO(254, 1, 99)}},
		{Time: base.Add(4 * time.Second), Satellites: 9, Latitude: 25e7, Longitude: 55e7, EventID: 253, // unknown type
			IO: []IOElement{NewIO(253, 1, 0)}},
	}
	frame, err := EncodeAVLPacket(Codec8E, recs)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := ReadFrame(bytes.NewReader(frame), nil, DefaultMaxPacketSize)
	if err != nil {
		t.Fatal(err)
	}
	_, got, err := DecodeAVL(payload)
	if err != nil {
		t.Fatal(err)
	}
	want := []struct {
		harsh any
		value any
	}{{"acceleration", 1.23}, {"braking", 2.5}, {"cornering", nil}, {nil, nil}, {nil, nil}}
	for i, w := range want {
		a := got[i].Position("1", base).Attributes
		if a[domain.AttrHarsh] != w.harsh || a[domain.AttrHarshValue] != w.value {
			t.Errorf("record %d: harsh=%v value=%v, want %v %v", i, a[domain.AttrHarsh], a[domain.AttrHarshValue], w.harsh, w.value)
		}
		if _, ok := a["io253"]; !ok { // raw IO stays available
			t.Errorf("record %d: io253 missing", i)
		}
	}
}
