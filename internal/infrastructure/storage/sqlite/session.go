package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/ny4rl4th0t3p/chaincoord/internal/application/ports"
)

// SessionStore implements token validation against the sessions table.
type SessionStore struct {
	db *sql.DB
}

func NewSessionStore(db *sql.DB) *SessionStore {
	return &SessionStore{db: db}
}

// Validate checks whether token exists and is unexpired.
// If the token is expired it is deleted from the table before returning ErrUnauthorized.
func (s *SessionStore) Validate(ctx context.Context, token string) (string, error) {
	var operatorAddr, expiresAt string
	err := s.db.QueryRowContext(ctx,
		`SELECT operator_address, expires_at FROM sessions WHERE token = ?`, token).
		Scan(&operatorAddr, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ports.ErrUnauthorized
	}
	if err != nil {
		return "", fmt.Errorf("session validate: %w", err)
	}

	exp, err := strToTime(expiresAt)
	if err != nil {
		return "", fmt.Errorf("session validate: parse expiry: %w", err)
	}
	if nowUTC().After(exp) {
		_, _ = s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token = ?`, token)
		return "", ports.ErrUnauthorized
	}
	return operatorAddr, nil
}
