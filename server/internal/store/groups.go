package store

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

const defaultGroupColor = "#ffd700"

// Group is a named set of devices; users see the devices of their groups.
type Group struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	Color     string    `json:"color"`
	DeviceIDs []int64   `json:"deviceIds"`
	CreatedAt time.Time `json:"createdAt"`
}

// GroupInput is the body of POST /groups.
type GroupInput struct {
	Name      string  `json:"name"`
	Color     string  `json:"color"`
	DeviceIDs []int64 `json:"deviceIds"`
}

// GroupPatch is a partial group update.
type GroupPatch struct {
	Name      *string  `json:"name"`
	Color     *string  `json:"color"`
	DeviceIDs *[]int64 `json:"deviceIds"`
}

func normalizeGroup(name, color string) (string, string, error) {
	name, color = strings.TrimSpace(name), strings.TrimSpace(color)
	if color == "" {
		color = defaultGroupColor
	}
	switch {
	case name == "":
		return name, color, invalid("name is required")
	case utf8.RuneCountInString(name) > 100:
		return name, color, invalid("name must be at most 100 characters")
	case !hexColor.MatchString(color):
		return name, color, invalid("color must be a hex color like #ffd700")
	}
	return name, strings.ToLower(color), nil
}

// Groups returns all groups ordered by name.
func (s *Store) Groups(ctx context.Context) ([]Group, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, name, color, created_at FROM groups ORDER BY lower(name), id`)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Group, error) {
		var g Group
		err := r.Scan(&g.ID, &g.Name, &g.Color, &g.CreatedAt)
		g.CreatedAt = g.CreatedAt.UTC()
		g.DeviceIDs = s.groupDeviceIDs(g.ID)
		return g, err
	})
	if out == nil {
		out = []Group{}
	}
	return out, err
}

// Group returns one group or ErrNotFound.
func (s *Store) Group(ctx context.Context, id int64) (Group, error) {
	var g Group
	err := s.pool.QueryRow(ctx, `SELECT id, name, color, created_at FROM groups WHERE id = $1`, id).
		Scan(&g.ID, &g.Name, &g.Color, &g.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return g, ErrNotFound
	}
	g.CreatedAt = g.CreatedAt.UTC()
	g.DeviceIDs = s.groupDeviceIDs(g.ID)
	return g, err
}

func (s *Store) groupDeviceIDs(id int64) []int64 {
	if ds := s.accessSnap().groupDevices[id]; ds != nil {
		return append([]int64(nil), ds...)
	}
	return []int64{}
}

func setGroupDevices(ctx context.Context, tx pgx.Tx, groupID int64, devices []int64) error {
	if _, err := tx.Exec(ctx, `DELETE FROM group_devices WHERE group_id = $1`, groupID); err != nil {
		return err
	}
	if len(devices) == 0 {
		return nil
	}
	tag, err := tx.Exec(ctx, `INSERT INTO group_devices (group_id, device_id)
		SELECT $1, d.id FROM devices d WHERE d.id = ANY($2) ON CONFLICT DO NOTHING`, groupID, devices)
	if err != nil {
		return err
	}
	if int(tag.RowsAffected()) != len(uniqueIDs(devices)) {
		return invalid("unknown device in deviceIds")
	}
	return nil
}

// CreateGroup inserts a group with its devices.
func (s *Store) CreateGroup(ctx context.Context, in GroupInput) (Group, error) {
	name, color, err := normalizeGroup(in.Name, in.Color)
	if err != nil {
		return Group{}, err
	}
	var id int64
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO groups (name, color) VALUES ($1, $2) RETURNING id`, name, color).Scan(&id); err != nil {
			return err
		}
		return setGroupDevices(ctx, tx, id, in.DeviceIDs)
	})
	if err != nil {
		return Group{}, err
	}
	if err := s.reloadAccess(ctx); err != nil {
		return Group{}, err
	}
	return s.Group(ctx, id)
}

// UpdateGroup applies a partial update.
func (s *Store) UpdateGroup(ctx context.Context, id int64, p GroupPatch) (Group, error) {
	cur, err := s.Group(ctx, id)
	if err != nil {
		return Group{}, err
	}
	name, color := cur.Name, cur.Color
	if p.Name != nil {
		name = *p.Name
	}
	if p.Color != nil {
		color = *p.Color
	}
	if name, color, err = normalizeGroup(name, color); err != nil {
		return Group{}, err
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE groups SET name = $2, color = $3 WHERE id = $1`, id, name, color)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		if p.DeviceIDs != nil {
			return setGroupDevices(ctx, tx, id, *p.DeviceIDs)
		}
		return nil
	})
	if err != nil {
		return Group{}, err
	}
	if err := s.reloadAccess(ctx); err != nil {
		return Group{}, err
	}
	return s.Group(ctx, id)
}

// DeleteGroup removes a group (devices and users are kept).
func (s *Store) DeleteGroup(ctx context.Context, id int64) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM groups WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return s.reloadAccess(ctx)
}

// SetDeviceGroups replaces the groups a device belongs to.
func (s *Store) SetDeviceGroups(ctx context.Context, deviceID int64, groups []int64) error {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM group_devices WHERE device_id = $1`, deviceID); err != nil {
			return err
		}
		if len(groups) == 0 {
			return nil
		}
		tag, err := tx.Exec(ctx, `INSERT INTO group_devices (group_id, device_id)
			SELECT g.id, $1 FROM groups g WHERE g.id = ANY($2) ON CONFLICT DO NOTHING`, deviceID, groups)
		if err != nil {
			return err
		}
		if int(tag.RowsAffected()) != len(uniqueIDs(groups)) {
			return invalid("unknown group in groupIds")
		}
		return nil
	})
	if err != nil {
		return err
	}
	return s.reloadAccess(ctx)
}
