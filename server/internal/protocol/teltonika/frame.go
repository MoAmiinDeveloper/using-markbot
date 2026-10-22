package teltonika

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

// Framing errors.
var (
	ErrBadPreamble   = errors.New("teltonika: bad preamble")
	ErrBadCRC        = errors.New("teltonika: CRC mismatch")
	ErrFrameTooLarge = errors.New("teltonika: frame too large")
	ErrFrameTooShort = errors.New("teltonika: frame too short")
	ErrBadIMEI       = errors.New("teltonika: invalid IMEI")
)

// Codec 12 message types.
const (
	Codec12Command  byte = 0x05
	Codec12Response byte = 0x06
)

// maxIMEILen bounds the handshake length field; real IMEIs are 15 digits.
const maxIMEILen = 32

// EncodeFrame wraps a payload (codec ID .. count 2) into a TCP frame:
// 4-byte zero preamble, 4-byte length, payload, 4-byte CRC-16.
func EncodeFrame(payload []byte) []byte {
	b := make([]byte, 0, len(payload)+12)
	b = binary.BigEndian.AppendUint32(b, 0)
	b = binary.BigEndian.AppendUint32(b, uint32(len(payload)))
	b = append(b, payload...)
	return binary.BigEndian.AppendUint32(b, uint32(CRC16(payload)))
}

// ReadFrame reads one TCP frame from r and returns its payload (codec ID ..
// count 2). buf is reused when large enough; the returned slice aliases it
// and is only valid until the next call. On ErrBadCRC the payload is still
// returned and the stream stays aligned, so the caller may keep reading.
func ReadFrame(r io.Reader, buf []byte, maxSize int) ([]byte, error) {
	var hdr [8]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return nil, err
	}
	if binary.BigEndian.Uint32(hdr[:4]) != 0 {
		return nil, fmt.Errorf("%w: % X", ErrBadPreamble, hdr[:4])
	}
	n := int(binary.BigEndian.Uint32(hdr[4:]))
	switch {
	case n < 3:
		return nil, fmt.Errorf("%w: %d bytes", ErrFrameTooShort, n)
	case n > maxSize:
		return nil, fmt.Errorf("%w: %d > %d bytes", ErrFrameTooLarge, n, maxSize)
	}
	if cap(buf) < n+4 {
		buf = make([]byte, n+4)
	}
	buf = buf[:n+4]
	if _, err := io.ReadFull(r, buf); err != nil {
		if errors.Is(err, io.EOF) {
			err = io.ErrUnexpectedEOF
		}
		return nil, err
	}
	payload := buf[:n]
	if got, want := binary.BigEndian.Uint32(buf[n:]), uint32(CRC16(payload)); got != want {
		return payload, fmt.Errorf("%w: got %04X, want %04X", ErrBadCRC, got, want)
	}
	return payload, nil
}

// EncodeAVLPacket encodes records into a complete TCP AVL frame.
func EncodeAVLPacket(codec byte, recs []Record) ([]byte, error) {
	payload, err := EncodeAVLData(codec, recs)
	if err != nil {
		return nil, err
	}
	return EncodeFrame(payload), nil
}

// EncodeIMEI builds the TCP handshake message: 2-byte length + ASCII IMEI.
func EncodeIMEI(imei string) []byte {
	b := binary.BigEndian.AppendUint16(make([]byte, 0, 2+len(imei)), uint16(len(imei)))
	return append(b, imei...)
}

// validIMEI reports whether s looks like a device identifier (digits only).
func validIMEI(s []byte) bool {
	if len(s) == 0 || len(s) > maxIMEILen {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// EncodeCodec12Command builds a Codec 12 TCP frame carrying a text command
// (e.g. "getinfo", "setdigout 1") for the device.
func EncodeCodec12Command(cmd string) []byte {
	return EncodeFrame(codec12Payload(Codec12Command, []byte(cmd)))
}

// EncodeCodec12Response builds a Codec 12 response frame, as a device sends it.
func EncodeCodec12Response(text string) []byte {
	return EncodeFrame(codec12Payload(Codec12Response, []byte(text)))
}

func codec12Payload(typ byte, data []byte) []byte {
	b := make([]byte, 0, len(data)+8)
	b = append(b, Codec12, 1, typ)
	b = binary.BigEndian.AppendUint32(b, uint32(len(data)))
	b = append(b, data...)
	return append(b, 1)
}

// DecodeCodec12 decodes a Codec 12 payload (codec ID .. count 2) and
// returns the message type (Codec12Command / Codec12Response) and its text.
func DecodeCodec12(payload []byte) (typ byte, data []byte, err error) {
	r := reader{b: payload}
	if c := r.u8(); r.err == nil && c != Codec12 {
		return 0, nil, fmt.Errorf("%w 0x%02X", ErrUnsupportedCodec, c)
	}
	n1 := r.u8()
	typ = r.u8()
	data = r.bytes(int(r.u32()))
	n2 := r.u8()
	switch {
	case r.err != nil:
		return 0, nil, r.err
	case n1 != 1 || n2 != 1:
		return 0, nil, fmt.Errorf("%w: %d/%d", ErrCountMismatch, n1, n2)
	case r.off != len(payload):
		return 0, nil, ErrTrailingData
	}
	return typ, data, nil
}

// UDPHeader is the per-datagram header of Teltonika UDP AVL packets.
type UDPHeader struct {
	PacketID    uint16
	AVLPacketID uint8
	IMEI        string
}

// EncodeUDPPacket builds a UDP AVL datagram:
// length(2) packetID(2) unused(1) avlPacketID(1) imeiLen(2) IMEI AVL-data.
func EncodeUDPPacket(h UDPHeader, codec byte, recs []Record) ([]byte, error) {
	avl, err := EncodeAVLData(codec, recs)
	if err != nil {
		return nil, err
	}
	n := 2 + 1 + 1 + 2 + len(h.IMEI) + len(avl)
	if n > 0xFFFF {
		return nil, ErrFrameTooLarge
	}
	b := make([]byte, 0, n+2)
	b = binary.BigEndian.AppendUint16(b, uint16(n))
	b = binary.BigEndian.AppendUint16(b, h.PacketID)
	b = append(b, 0x01, h.AVLPacketID)
	b = binary.BigEndian.AppendUint16(b, uint16(len(h.IMEI)))
	b = append(b, h.IMEI...)
	return append(b, avl...), nil
}

// DecodeUDPPacket splits a UDP datagram into its header and AVL payload.
func DecodeUDPPacket(p []byte) (UDPHeader, []byte, error) {
	var h UDPHeader
	r := reader{b: p}
	n := int(r.u16())
	h.PacketID = r.u16()
	r.u8() // "not usable byte", 0x01
	h.AVLPacketID = r.u8()
	imei := r.take(int(r.u16()))
	if r.err != nil {
		return h, nil, r.err
	}
	if n != len(p)-2 {
		return h, nil, fmt.Errorf("%w: length field %d, datagram %d", ErrTruncated, n, len(p)-2)
	}
	if !validIMEI(imei) {
		return h, nil, ErrBadIMEI
	}
	h.IMEI = string(imei)
	return h, p[r.off:], nil
}

// EncodeUDPAck builds the server reply to a UDP AVL datagram.
func EncodeUDPAck(packetID uint16, avlPacketID, accepted uint8) []byte {
	return []byte{0x00, 0x05, byte(packetID >> 8), byte(packetID), 0x01, avlPacketID, accepted}
}
