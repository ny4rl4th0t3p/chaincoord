package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/ny4rl4th0t3p/chaincoord/internal/application/ports"
)

const (
	challengeTTL         = 5 * time.Minute
	challengeRateWindow  = 5 * time.Minute
	challengeRateMaxReqs = 5
	challengeRandomBytes = 32 // bytes of entropy for the challenge nonce
)

// ChallengeStore implements ports.ChallengeStore for SQLite.
type ChallengeStore struct {
	db *sql.DB
}

func NewChallengeStore(db *sql.DB) *ChallengeStore {
	return &ChallengeStore{db: db}
}

func (s *ChallengeStore) Issue(ctx context.Context, operatorAddr string) (string, error) {
	now := nowUTC()

	// Per-operator rate limit: reject if too many recent requests.
	if err := s.checkRateLimit(ctx, operatorAddr, now); err != nil {
		return "", err
	}

	challenge, err := randomHex(challengeRandomBytes)
	if err != nil {
		return "", fmt.Errorf("challenge issue: generate: %w", err)
	}
	expiresAt := now.Add(challengeTTL)

	// Conditional upsert: only overwrite an existing challenge if it has expired.
	// If a valid unexpired challenge already exists the WHERE clause prevents the
	// update, rows-affected == 0, and we fall through to read the existing one.
	res, err := s.db.ExecContext(ctx, `
		INSERT INTO challenges (operator_address, challenge, expires_at)
		VALUES (?, ?, ?)
		ON CONFLICT(operator_address) DO UPDATE SET
		  challenge  = excluded.challenge,
		  expires_at = excluded.expires_at
		WHERE challenges.expires_at < ?`,
		operatorAddr, challenge, timeToStr(expiresAt), timeToStr(now))
	if err != nil {
		return "", fmt.Errorf("challenge issue: upsert: %w", err)
	}

	n, err := res.RowsAffected()
	if err != nil {
		return "", fmt.Errorf("challenge issue: rows affected: %w", err)
	}

	if n == 0 {
		// A valid unexpired challenge already exists — return it unchanged so
		// the attacker's flood request cannot disrupt an in-flight auth flow.
		var existing string
		err = s.db.QueryRowContext(ctx,
			`SELECT challenge FROM challenges WHERE operator_address = ?`, operatorAddr).
			Scan(&existing)
		if err != nil {
			return "", fmt.Errorf("challenge issue: read existing: %w", err)
		}
		// Record this attempt in the rate limit log even for idempotent returns.
		s.recordRateLimitRequest(ctx, operatorAddr, now)
		return existing, nil
	}

	s.recordRateLimitRequest(ctx, operatorAddr, now)
	return challenge, nil
}

func (s *ChallengeStore) Consume(ctx context.Context, operatorAddr string) (string, error) {
	var challenge, expiresAt string
	err := s.db.QueryRowContext(ctx,
		`SELECT challenge, expires_at FROM challenges WHERE operator_address=?`, operatorAddr).
		Scan(&challenge, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ports.ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("challenge consume: %w", err)
	}

	// Delete regardless of expiry so stale challenges don't linger.
	_, _ = s.db.ExecContext(ctx, `DELETE FROM challenges WHERE operator_address=?`, operatorAddr)

	exp, err := strToTime(expiresAt)
	if err != nil {
		return "", fmt.Errorf("challenge consume: parse expiry: %w", err)
	}
	if nowUTC().After(exp) {
		return "", ports.ErrNotFound
	}
	return challenge, nil
}

// checkRateLimit returns ErrTooManyRequests if the operator has exceeded the
// per-operator challenge request limit within the sliding window.
func (s *ChallengeStore) checkRateLimit(ctx context.Context, operatorAddr string, now time.Time) error {
	windowStart := now.Add(-challengeRateWindow)
	var count int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM challenge_rate_limits
		 WHERE operator_address = ? AND requested_at >= ?`,
		operatorAddr, timeToStr(windowStart)).Scan(&count)
	if err != nil {
		return fmt.Errorf("challenge rate limit check: %w", err)
	}
	if count >= challengeRateMaxReqs {
		return fmt.Errorf("challenge rate limit exceeded: %w", ports.ErrTooManyRequests)
	}
	return nil
}

// recordRateLimitRequest inserts a rate-limit log entry and opportunistically
// prunes expired records. Non-fatal: errors are silently ignored.
func (s *ChallengeStore) recordRateLimitRequest(ctx context.Context, operatorAddr string, now time.Time) {
	_, _ = s.db.ExecContext(ctx,
		`INSERT INTO challenge_rate_limits (operator_address, requested_at) VALUES (?, ?)`,
		operatorAddr, timeToStr(now))
	// Opportunistic cleanup of entries outside the rate window.
	cutoff := now.Add(-challengeRateWindow)
	_, _ = s.db.ExecContext(ctx,
		`DELETE FROM challenge_rate_limits WHERE requested_at < ?`, timeToStr(cutoff))
}
