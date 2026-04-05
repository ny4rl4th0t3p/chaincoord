package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"testing"
)

func TestTransactor_InTransaction(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		run  func(t *testing.T, db *sql.DB, txr *Transactor)
	}{
		{
			name: "commits row on success",
			run: func(t *testing.T, db *sql.DB, txr *Transactor) {
				err := txr.InTransaction(context.Background(), func(ctx context.Context) error {
					_, err := conn(ctx, db).ExecContext(ctx,
						`INSERT INTO operator_revocations (operator_address, revoke_before) VALUES ('addr1','2099-01-01T00:00:00Z')`)
					return err
				})
				if err != nil {
					t.Fatalf("InTransaction: %v", err)
				}
				var count int
				if err := db.QueryRowContext(t.Context(), `SELECT COUNT(*) FROM operator_revocations WHERE operator_address='addr1'`).Scan(&count); err != nil {
					t.Fatalf("Scan: %v", err)
				}
				if count != 1 {
					t.Errorf("expected row to be committed, got count=%d", count)
				}
			},
		},
		{
			name: "rolls back row on error",
			run: func(t *testing.T, db *sql.DB, txr *Transactor) {
				sentinel := errors.New("intentional failure")
				err := txr.InTransaction(context.Background(), func(ctx context.Context) error {
					if _, xerr := conn(ctx, db).ExecContext(ctx,
						`INSERT INTO operator_revocations (operator_address, revoke_before) VALUES ('addr2','2099-01-01T00:00:00Z')`); xerr != nil {
						t.Fatalf("ExecContext: %v", xerr)
					}
					return sentinel
				})
				if !errors.Is(err, sentinel) {
					t.Fatalf("expected sentinel error, got %v", err)
				}
				var count int
				if err := db.QueryRowContext(t.Context(), `SELECT COUNT(*) FROM operator_revocations WHERE operator_address='addr2'`).Scan(&count); err != nil {
					t.Fatalf("Scan: %v", err)
				}
				if count != 0 {
					t.Errorf("expected row to be rolled back, got count=%d", count)
				}
			},
		},
		{
			name: "nested call reuses outer transaction",
			run: func(t *testing.T, db *sql.DB, txr *Transactor) {
				// The inner call must reuse the outer tx — if it started its own,
				// the outer rollback would not undo the inner insert.
				outerErr := errors.New("outer failure")
				_ = txr.InTransaction(context.Background(), func(outerCtx context.Context) error {
					if _, xerr := conn(outerCtx, db).ExecContext(outerCtx,
						`INSERT INTO operator_revocations (operator_address, revoke_before) VALUES ('addr3','2099-01-01T00:00:00Z')`); xerr != nil {
						t.Fatalf("outer ExecContext: %v", xerr)
					}
					_ = txr.InTransaction(outerCtx, func(innerCtx context.Context) error {
						if _, xerr := conn(innerCtx, db).ExecContext(innerCtx,
							`INSERT INTO operator_revocations (operator_address, revoke_before) VALUES ('addr4','2099-01-01T00:00:00Z')`); xerr != nil {
							t.Fatalf("inner ExecContext: %v", xerr)
						}
						return nil
					})
					return outerErr
				})
				var count int
				if err := db.QueryRowContext(t.Context(), `SELECT COUNT(*) FROM operator_revocations WHERE operator_address IN ('addr3','addr4')`).Scan(&count); err != nil {
					t.Fatalf("Scan: %v", err)
				}
				if count != 0 {
					t.Errorf("expected both rows rolled back when outer tx fails, got count=%d", count)
				}
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			db := openTestDB(t)
			tc.run(t, db, NewTransactor(db))
		})
	}
}
