package teltonika

// crcTable is the lookup table for CRC-16/IBM (a.k.a. CRC-16/ARC):
// polynomial 0x8005 reflected (0xA001), initial value 0, no final XOR.
var crcTable = func() (t [256]uint16) {
	for i := range t {
		c := uint16(i)
		for range 8 {
			if c&1 != 0 {
				c = c>>1 ^ 0xA001
			} else {
				c >>= 1
			}
		}
		t[i] = c
	}
	return t
}()

// CRC16 computes the CRC-16/IBM checksum Teltonika uses over the
// codec ID..record-count-2 section of a TCP frame.
func CRC16(data []byte) uint16 {
	var crc uint16
	for _, b := range data {
		crc = crc>>8 ^ crcTable[byte(crc)^b]
	}
	return crc
}
