package store

import (
	"context"
	"fmt"
	"slices"
)

// EventAccess is the live event (no data) published whenever group
// memberships, user roles or user groups change. It is consumed by the
// WebSocket layer (which re-evaluates each client's device scope) and is not
// forwarded to browsers.
const EventAccess = "access"

// userAccess is the cached access state of one user.
type userAccess struct {
	role    string
	active  bool
	groups  []int64        // sorted
	devices map[int64]bool // devices of those groups; read-only
}

// accessSnapshot is an immutable view of users, groups and memberships. It
// is rebuilt from the database after every change and swapped atomically, so
// readers (every request, every WebSocket frame) never lock.
type accessSnapshot struct {
	users        map[int64]*userAccess
	deviceGroups map[int64][]int64 // device -> sorted group ids
	groupDevices map[int64][]int64 // group -> sorted device ids
}

var emptyScope = map[int64]bool{}

func (s *Store) accessSnap() *accessSnapshot {
	if a := s.access.Load(); a != nil {
		return a
	}
	return &accessSnapshot{}
}

// reloadAccess rebuilds the access snapshot from the database. Device
// entries whose groups changed are re-announced and EventAccess is published.
func (s *Store) reloadAccess(ctx context.Context) error {
	s.accessMu.Lock()
	defer s.accessMu.Unlock()
	next := &accessSnapshot{
		users:        map[int64]*userAccess{},
		deviceGroups: map[int64][]int64{},
		groupDevices: map[int64][]int64{},
	}
	rows, err := s.pool.Query(ctx, `SELECT id, role, active FROM users`)
	if err != nil {
		return fmt.Errorf("load users: %w", err)
	}
	for rows.Next() {
		var (
			id int64
			u  = &userAccess{devices: map[int64]bool{}}
		)
		if err := rows.Scan(&id, &u.role, &u.active); err != nil {
			rows.Close()
			return err
		}
		next.users[id] = u
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	rows, err = s.pool.Query(ctx, `SELECT group_id, device_id FROM group_devices ORDER BY group_id, device_id`)
	if err != nil {
		return fmt.Errorf("load group devices: %w", err)
	}
	for rows.Next() {
		var g, d int64
		if err := rows.Scan(&g, &d); err != nil {
			rows.Close()
			return err
		}
		next.groupDevices[g] = append(next.groupDevices[g], d)
		next.deviceGroups[d] = append(next.deviceGroups[d], g)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	rows, err = s.pool.Query(ctx, `SELECT user_id, group_id FROM user_groups ORDER BY user_id, group_id`)
	if err != nil {
		return fmt.Errorf("load user groups: %w", err)
	}
	for rows.Next() {
		var u, g int64
		if err := rows.Scan(&u, &g); err != nil {
			rows.Close()
			return err
		}
		if ua := next.users[u]; ua != nil {
			ua.groups = append(ua.groups, g)
			for _, d := range next.groupDevices[g] {
				ua.devices[d] = true
			}
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, gs := range next.deviceGroups {
		slices.Sort(gs)
	}

	prev := s.access.Swap(next)
	if prev == nil {
		return nil // initial load
	}
	// Re-announce devices whose group list changed so live clients get the
	// new groupIds (and clients that gained access get the device).
	now := s.opts.Now()
	s.mu.Lock()
	for id, e := range s.devices {
		if !slices.Equal(prev.deviceGroups[id], next.deviceGroups[id]) {
			s.announceLocked(e, now, true)
		}
	}
	s.mu.Unlock()
	s.publish(EventAccess, nil)
	return nil
}

// UserRole returns the cached role of an active user; ok is false when the
// user does not exist or is deactivated.
func (s *Store) UserRole(userID int64) (role string, ok bool) {
	u := s.accessSnap().users[userID]
	if u == nil || !u.active {
		return "", false
	}
	return u.role, true
}

// DeviceScope reports which devices a user may see: all for admins,
// otherwise the devices of the user's groups. Unknown or deactivated users
// see nothing. The returned map is shared and must not be modified.
func (s *Store) DeviceScope(userID int64) (all bool, ids map[int64]bool) {
	u := s.accessSnap().users[userID]
	switch {
	case u == nil || !u.active:
		return false, emptyScope
	case u.role == RoleAdmin:
		return true, nil
	}
	return false, u.devices
}

// CanSeeDevice reports whether a user may access a device.
func (s *Store) CanSeeDevice(userID, deviceID int64) bool {
	all, ids := s.DeviceScope(userID)
	return all || ids[deviceID]
}

// UserGroupIDs returns the groups of a user (sorted; never nil).
func (s *Store) UserGroupIDs(userID int64) []int64 {
	if u := s.accessSnap().users[userID]; u != nil && u.groups != nil {
		return slices.Clone(u.groups)
	}
	return []int64{}
}

// deviceGroupIDs returns the groups of a device (shared, never nil).
func (s *Store) deviceGroupIDs(deviceID int64) []int64 {
	if gs := s.accessSnap().deviceGroups[deviceID]; gs != nil {
		return gs
	}
	return []int64{}
}

// ScopeDeviceID lets the live hub filter events per client.
func (e Event) ScopeDeviceID() int64 { return e.DeviceID }

// ScopeDeviceID lets the live hub filter command updates per client.
func (c Command) ScopeDeviceID() int64 { return c.DeviceID }
