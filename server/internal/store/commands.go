package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Command statuses.
const (
	CommandQueued  = "queued"
	CommandSent    = "sent"
	CommandSuccess = "success"
	CommandFailed  = "failed"
	CommandExpired = "expired"
)

// EventCommand is the live event type published on every command status change.
const EventCommand = "command"

// Command is a text command for a device and its outcome.
type Command struct {
	ID          int64      `json:"id"`
	DeviceID    int64      `json:"deviceId"`
	UserID      int64      `json:"userId"` // 0 when the user was deleted
	Type        string     `json:"type"`
	Text        string     `json:"text"`
	Status      string     `json:"status"`
	Response    string     `json:"response"`
	CreatedAt   time.Time  `json:"createdAt"`
	CompletedAt *time.Time `json:"completedAt"`
}

const commandColumns = `id, device_id, COALESCE(user_id, 0), type, text, status, response, created_at, completed_at`

func scanCommand(row pgx.Row) (Command, error) {
	var c Command
	err := row.Scan(&c.ID, &c.DeviceID, &c.UserID, &c.Type, &c.Text, &c.Status, &c.Response, &c.CreatedAt, &c.CompletedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrNotFound
	}
	c.CreatedAt = c.CreatedAt.UTC()
	if c.CompletedAt != nil {
		t := c.CompletedAt.UTC()
		c.CompletedAt = &t
	}
	return c, err
}

func collectCommands(rows pgx.Rows, err error) ([]Command, error) {
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Command, error) { return scanCommand(r) })
	if out == nil {
		out = []Command{}
	}
	return out, err
}

// CreateCommand stores a queued command and publishes it.
func (s *Store) CreateCommand(ctx context.Context, deviceID, userID int64, typ, text string) (Command, error) {
	c, err := scanCommand(s.pool.QueryRow(ctx, `INSERT INTO commands (device_id, user_id, type, text)
		VALUES ($1, $2, $3, $4) RETURNING `+commandColumns, deviceID, nullable(userID), typ, text))
	if err != nil {
		return c, fmt.Errorf("create command: %w", err)
	}
	s.publish(EventCommand, c)
	return c, nil
}

// Commands returns the latest commands of a device, newest first.
func (s *Store) Commands(ctx context.Context, deviceID int64, limit int) ([]Command, error) {
	return collectCommands(s.pool.Query(ctx, `SELECT `+commandColumns+` FROM commands
		WHERE device_id = $1 ORDER BY id DESC LIMIT $2`, deviceID, limit))
}

// QueuedCommands returns the queued commands of a device, oldest first.
func (s *Store) QueuedCommands(ctx context.Context, deviceID int64) ([]Command, error) {
	return collectCommands(s.pool.Query(ctx, `SELECT `+commandColumns+` FROM commands
		WHERE device_id = $1 AND status = 'queued' ORDER BY id`, deviceID))
}

// TransitionCommand moves a command from status from to status to,
// recording the response; terminal statuses set completedAt. It returns
// ErrNotFound when the command is not in status from (claimed by someone
// else, expired …). The change is published.
func (s *Store) TransitionCommand(ctx context.Context, id int64, from, to, response string) (Command, error) {
	c, err := scanCommand(s.pool.QueryRow(ctx, `UPDATE commands SET status = $3, response = $4,
			completed_at = CASE WHEN $3 IN ('success', 'failed', 'expired') THEN now() END
		WHERE id = $1 AND status = $2 RETURNING `+commandColumns, id, from, to, response))
	if err != nil {
		return c, err
	}
	s.publish(EventCommand, c)
	return c, nil
}

// ExpireCommands marks commands queued before cutoff as expired and
// publishes them.
func (s *Store) ExpireCommands(ctx context.Context, cutoff time.Time) ([]Command, error) {
	cs, err := collectCommands(s.pool.Query(ctx, `UPDATE commands SET status = 'expired', completed_at = now()
		WHERE status = 'queued' AND created_at < $1 RETURNING `+commandColumns, cutoff))
	for _, c := range cs {
		s.publish(EventCommand, c)
	}
	return cs, err
}

// FailInterruptedCommands marks commands left in "sent" by a previous run
// (the reply can no longer arrive) as failed.
func (s *Store) FailInterruptedCommands(ctx context.Context) (int64, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE commands SET status = 'failed', response = 'interrupted by server restart',
		completed_at = now() WHERE status = 'sent'`)
	return tag.RowsAffected(), err
}
