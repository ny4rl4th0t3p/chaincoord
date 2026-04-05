package sqlite

import (
	"database/sql"
	"io/fs"
	"testing"
)

func TestOpen(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		check func(t *testing.T, db *sql.DB)
	}{
		{
			name: "applies migrations on open",
			check: func(t *testing.T, db *sql.DB) {
				var count int
				if err := db.QueryRowContext(t.Context(), `SELECT COUNT(*) FROM schema_migrations`).Scan(&count); err != nil {
					t.Fatalf("schema_migrations query: %v", err)
				}
				if count == 0 {
					t.Error("expected at least one applied migration")
				}
			},
		},
		{
			name: "sets WAL or memory journal mode",
			check: func(t *testing.T, db *sql.DB) {
				// WAL mode is not available for :memory: databases — SQLite silently uses
				// "memory" journal mode instead. Both are acceptable here.
				var mode string
				if err := db.QueryRowContext(t.Context(), `PRAGMA journal_mode`).Scan(&mode); err != nil {
					t.Fatalf("journal_mode: %v", err)
				}
				if mode != "wal" && mode != "memory" {
					t.Errorf("unexpected journal mode %q", mode)
				}
			},
		},
		{
			name: "enables foreign key enforcement",
			check: func(t *testing.T, db *sql.DB) {
				var fk int
				if err := db.QueryRowContext(t.Context(), `PRAGMA foreign_keys`).Scan(&fk); err != nil {
					t.Fatalf("foreign_keys: %v", err)
				}
				if fk != 1 {
					t.Error("expected foreign keys to be ON")
				}
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			tc.check(t, openTestDB(t))
		})
	}
}

func TestRunMigrations(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		check func(t *testing.T, db *sql.DB)
	}{
		{
			name: "running twice does not create duplicate records",
			check: func(t *testing.T, db *sql.DB) {
				if err := runMigrations(db); err != nil {
					t.Fatalf("second runMigrations call: %v", err)
				}
				files, err := fs.Glob(migrationsFS, "migrations/*.sql")
				if err != nil {
					t.Fatalf("glob migrations: %v", err)
				}
				var count int
				if err := db.QueryRowContext(t.Context(), `SELECT COUNT(*) FROM schema_migrations`).Scan(&count); err != nil {
					t.Fatalf("count: %v", err)
				}
				if count != len(files) {
					t.Errorf("expected %d migration records after two runs, got %d", len(files), count)
				}
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			tc.check(t, openTestDB(t))
		})
	}
}
