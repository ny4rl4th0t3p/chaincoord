package sqlite

import (
	"context"
	"database/sql"
	"fmt"
)

// Transactor implements ports.Transactor for SQLite.
type Transactor struct {
	db *sql.DB
}

func NewTransactor(db *sql.DB) *Transactor {
	return &Transactor{db: db}
}

// InTransaction runs fn inside a single database transaction. If fn returns an
// error the transaction is rolled back; otherwise it is committed. Nested calls
// reuse the existing transaction — the inner commit/rollback is skipped.
func (t *Transactor) InTransaction(ctx context.Context, fn func(ctx context.Context) error) error {
	// Reuse an existing transaction if one is already active.
	if _, ok := ctx.Value(txKey{}).(*sql.Tx); ok {
		return fn(ctx)
	}

	tx, err := t.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}

	txCtx := context.WithValue(ctx, txKey{}, tx)
	if err := fn(txCtx); err != nil {
		_ = tx.Rollback()
		return err
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}
