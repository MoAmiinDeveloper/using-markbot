package teltonika

import (
	"testing"
	"time"
)

func TestSignedTemperatureIO(t *testing.T) {
	r := Record{Time: time.Now(), IO: []IOElement{NewIO(72, 4, uint64(uint32(0xFFFFFF9C))), NewIO(25, 2, 0x0960),
		NewIO(9, 2, 4000)}}
	p := r.Position("356307042441013", time.Now())
	if p.Attributes["io72"] != int64(-100) || p.Attributes["io25"] != int64(2400) || p.Attributes["io9"] != uint64(4000) {
		t.Fatalf("attributes %#v", p.Attributes)
	}
}
