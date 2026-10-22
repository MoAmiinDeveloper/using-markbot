package teltonika

import (
	"encoding/binary"
	"errors"
	"fmt"
	"time"
)

// Codec identifiers (first byte of a frame payload).
const (
	Codec8  byte = 0x08
	Codec8E byte = 0x8E
	Codec12 byte = 0x0C
	Codec16 byte = 0x10
)

// Decoding errors.
var (
	ErrUnsupportedCodec = errors.New("teltonika: unsupported codec")
	ErrTruncated        = errors.New("teltonika: truncated data")
	ErrCountMismatch    = errors.New("teltonika: record count mismatch")
	ErrTrailingData     = errors.New("teltonika: trailing data after records")
)

// IOElement is one IO property of an AVL record.
type IOElement struct {
	ID    uint16
	Size  uint8  // 1, 2, 4 or 8 for fixed-width values; 0 = variable length (Codec 8E NX)
	Value uint64 // fixed-width value, big-endian unsigned
	Raw   []byte // variable-length value (Size == 0)
}

// NewIO returns a fixed-width IO element.
func NewIO(id uint16, size uint8, value uint64) IOElement {
	return IOElement{ID: id, Size: size, Value: value}
}

// Record is one AVL record exactly as transmitted by the device.
type Record struct {
	Time       time.Time
	Priority   uint8 // 0 low, 1 high, 2 panic
	Longitude  int32 // degrees * 1e7
	Latitude   int32 // degrees * 1e7
	Altitude   int16 // meters
	Angle      uint16
	Satellites uint8
	Speed      uint16 // km/h
	EventID    uint16 // IO id that triggered the record, 0 = periodic
	Generation uint8  // Codec 16 generation type, ignored by other codecs
	IO         []IOElement
}

// IOValue returns the fixed-width value of the IO element with the given id.
func (r *Record) IOValue(id uint16) (uint64, bool) {
	for _, e := range r.IO {
		if e.ID == id && e.Size != 0 {
			return e.Value, true
		}
	}
	return 0, false
}

// gpsAndHeaderLen is timestamp(8) + priority(1) + GPS element(15).
const gpsAndHeaderLen = 24

// DecodeAVL decodes an AVL data payload (codec ID .. record count 2, i.e. a
// TCP frame without preamble, length and CRC) for Codec 8, 8E and 16.
func DecodeAVL(payload []byte) (codec byte, recs []Record, err error) {
	r := reader{b: payload}
	codec = r.u8()
	n := int(r.u8())
	if r.err != nil {
		return codec, nil, r.err
	}
	switch codec {
	case Codec8, Codec8E, Codec16:
	default:
		return codec, nil, fmt.Errorf("%w 0x%02X", ErrUnsupportedCodec, codec)
	}
	if n*gpsAndHeaderLen > len(payload) {
		return codec, nil, fmt.Errorf("%w: %d records declared in %d bytes", ErrTruncated, n, len(payload))
	}
	recs = make([]Record, n)
	for i := range recs {
		decodeRecord(&r, codec, &recs[i])
		if r.err != nil {
			return codec, nil, fmt.Errorf("record %d: %w", i, r.err)
		}
	}
	if n2 := int(r.u8()); r.err != nil {
		return codec, nil, r.err
	} else if n2 != n {
		return codec, nil, fmt.Errorf("%w: %d != %d", ErrCountMismatch, n, n2)
	}
	if r.off != len(payload) {
		return codec, nil, fmt.Errorf("%w: %d bytes", ErrTrailingData, len(payload)-r.off)
	}
	return codec, recs, nil
}

func decodeRecord(r *reader, codec byte, rec *Record) {
	rec.Time = time.UnixMilli(int64(r.u64())).UTC()
	rec.Priority = r.u8()
	rec.Longitude = int32(r.u32())
	rec.Latitude = int32(r.u32())
	rec.Altitude = int16(r.u16())
	rec.Angle = r.u16()
	rec.Satellites = r.u8()
	rec.Speed = r.u16()

	// Codec 8 uses 1-byte ids and counts; 8E 2-byte ids and counts;
	// 16 2-byte ids with 1-byte counts plus a generation type byte.
	wideID := codec != Codec8
	wideCount := codec == Codec8E
	id := func() uint16 {
		if wideID {
			return r.u16()
		}
		return uint16(r.u8())
	}
	count := func() int {
		if wideCount {
			return int(r.u16())
		}
		return int(r.u8())
	}

	rec.EventID = id()
	if codec == Codec16 {
		rec.Generation = r.u8()
	}
	total := count()
	if r.err != nil {
		return
	}
	// Each element is at least 2 bytes; cap the preallocation by what's left.
	rec.IO = make([]IOElement, 0, min(total, r.remaining()/2))
	for _, size := range [...]uint8{1, 2, 4, 8} {
		for range count() {
			e := IOElement{ID: id(), Size: size}
			e.Value = r.uN(int(size))
			if r.err != nil {
				return
			}
			rec.IO = append(rec.IO, e)
		}
	}
	if codec == Codec8E {
		for range count() {
			e := IOElement{ID: r.u16()}
			e.Raw = r.bytes(int(r.u16()))
			if r.err != nil {
				return
			}
			rec.IO = append(rec.IO, e)
		}
	}
}

// EncodeAVLData encodes records into an AVL data payload (codec ID ..
// record count 2). It is the inverse of DecodeAVL.
func EncodeAVLData(codec byte, recs []Record) ([]byte, error) {
	switch codec {
	case Codec8, Codec8E, Codec16:
	default:
		return nil, fmt.Errorf("%w 0x%02X", ErrUnsupportedCodec, codec)
	}
	if len(recs) == 0 || len(recs) > 255 {
		return nil, fmt.Errorf("teltonika: record count %d out of range 1..255", len(recs))
	}
	b := make([]byte, 0, 2+len(recs)*64+1)
	b = append(b, codec, byte(len(recs)))
	for i := range recs {
		var err error
		if b, err = appendRecord(b, codec, &recs[i]); err != nil {
			return nil, fmt.Errorf("record %d: %w", i, err)
		}
	}
	return append(b, byte(len(recs))), nil
}

func appendRecord(b []byte, codec byte, rec *Record) ([]byte, error) {
	be := binary.BigEndian
	b = be.AppendUint64(b, uint64(rec.Time.UnixMilli()))
	b = append(b, rec.Priority)
	b = be.AppendUint32(b, uint32(rec.Longitude))
	b = be.AppendUint32(b, uint32(rec.Latitude))
	b = be.AppendUint16(b, uint16(rec.Altitude))
	b = be.AppendUint16(b, rec.Angle)
	b = append(b, rec.Satellites)
	b = be.AppendUint16(b, rec.Speed)

	appendID := func(b []byte, id uint16) ([]byte, error) {
		if codec == Codec8 {
			if id > 0xFF {
				return b, fmt.Errorf("IO id %d does not fit Codec 8", id)
			}
			return append(b, byte(id)), nil
		}
		return be.AppendUint16(b, id), nil
	}
	appendCount := func(b []byte, n int) ([]byte, error) {
		if codec == Codec8E {
			if n > 0xFFFF {
				return b, fmt.Errorf("IO count %d too large", n)
			}
			return be.AppendUint16(b, uint16(n)), nil
		}
		if n > 0xFF {
			return b, fmt.Errorf("IO count %d too large for codec 0x%02X", n, codec)
		}
		return append(b, byte(n)), nil
	}

	var err error
	if b, err = appendID(b, rec.EventID); err != nil {
		return b, err
	}
	if codec == Codec16 {
		b = append(b, rec.Generation)
	}
	if b, err = appendCount(b, len(rec.IO)); err != nil {
		return b, err
	}
	for _, size := range [...]uint8{1, 2, 4, 8} {
		n := 0
		for _, e := range rec.IO {
			if e.Size == size {
				n++
			}
		}
		if b, err = appendCount(b, n); err != nil {
			return b, err
		}
		for _, e := range rec.IO {
			if e.Size != size {
				continue
			}
			if size < 8 && e.Value>>(8*uint(size)) != 0 {
				return b, fmt.Errorf("IO %d value %d overflows %d bytes", e.ID, e.Value, size)
			}
			if b, err = appendID(b, e.ID); err != nil {
				return b, err
			}
			for s := int(size) - 1; s >= 0; s-- {
				b = append(b, byte(e.Value>>(8*uint(s))))
			}
		}
	}
	nx := 0
	for _, e := range rec.IO {
		switch e.Size {
		case 1, 2, 4, 8:
		case 0:
			nx++
		default:
			return b, fmt.Errorf("IO %d has invalid size %d", e.ID, e.Size)
		}
	}
	if codec != Codec8E {
		if nx > 0 {
			return b, fmt.Errorf("variable-length IO requires Codec 8E")
		}
		return b, nil
	}
	b = be.AppendUint16(b, uint16(nx))
	for _, e := range rec.IO {
		if e.Size != 0 {
			continue
		}
		if len(e.Raw) > 0xFFFF {
			return b, fmt.Errorf("IO %d value too long", e.ID)
		}
		b = be.AppendUint16(b, e.ID)
		b = be.AppendUint16(b, uint16(len(e.Raw)))
		b = append(b, e.Raw...)
	}
	return b, nil
}

// reader is a big-endian byte reader with a sticky error.
type reader struct {
	b   []byte
	off int
	err error
}

func (r *reader) remaining() int { return len(r.b) - r.off }

func (r *reader) take(n int) []byte {
	if r.err != nil {
		return nil
	}
	if n < 0 || r.remaining() < n {
		r.err = ErrTruncated
		return nil
	}
	p := r.b[r.off : r.off+n]
	r.off += n
	return p
}

func (r *reader) u8() uint8 {
	if p := r.take(1); p != nil {
		return p[0]
	}
	return 0
}

func (r *reader) u16() uint16 {
	if p := r.take(2); p != nil {
		return binary.BigEndian.Uint16(p)
	}
	return 0
}

func (r *reader) u32() uint32 {
	if p := r.take(4); p != nil {
		return binary.BigEndian.Uint32(p)
	}
	return 0
}

func (r *reader) u64() uint64 {
	if p := r.take(8); p != nil {
		return binary.BigEndian.Uint64(p)
	}
	return 0
}

// uN reads an n-byte (1..8) big-endian unsigned integer.
func (r *reader) uN(n int) uint64 {
	var v uint64
	for _, c := range r.take(n) {
		v = v<<8 | uint64(c)
	}
	return v
}

// bytes returns a copy of the next n bytes.
func (r *reader) bytes(n int) []byte {
	p := r.take(n)
	if p == nil {
		return nil
	}
	return append([]byte(nil), p...)
}
