package domain

// ScopeDeviceID lets the live hub deliver a position only to clients that
// may see its device (see hub.DeviceScoped).
func (p Position) ScopeDeviceID() int64 { return p.DeviceID }
