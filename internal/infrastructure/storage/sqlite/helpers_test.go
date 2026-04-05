package sqlite

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestStrToTime(t *testing.T) {
	t.Parallel()

	loc, _ := time.LoadLocation("America/New_York")
	original := time.Date(2026, 3, 27, 14, 30, 0, 123456789, time.UTC)
	eastern := time.Date(2026, 3, 27, 10, 0, 0, 0, loc)

	tests := []struct {
		name    string
		input   string
		want    time.Time
		wantErr bool
	}{
		{
			name:  "roundtrips UTC timestamp",
			input: timeToStr(original),
			want:  original,
		},
		{
			name:  "normalises non-UTC input to UTC",
			input: timeToStr(eastern),
			want:  eastern.UTC(),
		},
		{
			name:    "returns error for invalid input",
			input:   "not-a-time",
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := strToTime(tc.input)
			if (err != nil) != tc.wantErr {
				t.Fatalf("strToTime(%q) error = %v, wantErr %v", tc.input, err, tc.wantErr)
			}
			if !tc.wantErr {
				if got.Location() != time.UTC {
					t.Errorf("expected UTC location, got %v", got.Location())
				}
				if !got.Equal(tc.want) {
					t.Errorf("got %v, want %v", got, tc.want)
				}
			}
		})
	}
}

func TestNullTimeToStr(t *testing.T) {
	t.Parallel()

	now := time.Now().UTC()

	tests := []struct {
		name    string
		input   *time.Time
		wantNil bool
	}{
		{
			name:    "nil input returns nil",
			input:   nil,
			wantNil: true,
		},
		{
			name:  "non-nil input roundtrips via strToTime",
			input: &now,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			result := nullTimeToStr(tc.input)
			if tc.wantNil {
				if result != nil {
					t.Errorf("expected nil, got %q", *result)
				}
				return
			}
			if result == nil {
				t.Fatal("expected non-nil result")
				return // unreachable; satisfies static analysis
			}
			decoded, err := strToTime(*result)
			if err != nil {
				t.Fatalf("strToTime: %v", err)
			}
			if !decoded.Equal(tc.input.Truncate(time.Nanosecond)) {
				t.Errorf("roundtrip mismatch: got %v, want %v", decoded, *tc.input)
			}
		})
	}
}

func TestNullStrToTime(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   *string
		wantNil bool
		wantErr bool
	}{
		{
			name:    "nil input returns nil with no error",
			input:   nil,
			wantNil: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			result, err := nullStrToTime(tc.input)
			if (err != nil) != tc.wantErr {
				t.Fatalf("nullStrToTime() error = %v, wantErr %v", err, tc.wantErr)
			}
			if tc.wantNil && result != nil {
				t.Errorf("expected nil result, got %v", result)
			}
		})
	}
}

func TestStrToUUID(t *testing.T) {
	t.Parallel()

	original := uuid.New()

	tests := []struct {
		name    string
		input   string
		want    uuid.UUID
		wantErr bool
	}{
		{
			name:  "roundtrips valid UUID",
			input: uuidToStr(original),
			want:  original,
		},
		{
			name:    "returns error for invalid input",
			input:   "not-a-uuid",
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := strToUUID(tc.input)
			if (err != nil) != tc.wantErr {
				t.Fatalf("strToUUID(%q) error = %v, wantErr %v", tc.input, err, tc.wantErr)
			}
			if !tc.wantErr && got != tc.want {
				t.Errorf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestNullUUIDToStr(t *testing.T) {
	t.Parallel()

	id := uuid.New()

	tests := []struct {
		name    string
		input   *uuid.UUID
		wantNil bool
	}{
		{
			name:    "nil input returns nil",
			input:   nil,
			wantNil: true,
		},
		{
			name:  "non-nil input roundtrips via nullStrToUUID",
			input: &id,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			result := nullUUIDToStr(tc.input)
			if tc.wantNil {
				if result != nil {
					t.Errorf("expected nil, got %q", *result)
				}
				return
			}
			if result == nil {
				t.Fatal("expected non-nil result")
			}
			decoded, err := nullStrToUUID(result)
			if err != nil {
				t.Fatalf("nullStrToUUID: %v", err)
			}
			if decoded == nil || *decoded != *tc.input {
				t.Errorf("roundtrip mismatch: got %v, want %v", decoded, *tc.input)
			}
		})
	}
}

func TestNullStrToUUID(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   *string
		wantNil bool
		wantErr bool
	}{
		{
			name:    "nil input returns nil with no error",
			input:   nil,
			wantNil: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			result, err := nullStrToUUID(tc.input)
			if (err != nil) != tc.wantErr {
				t.Fatalf("nullStrToUUID() error = %v, wantErr %v", err, tc.wantErr)
			}
			if tc.wantNil && result != nil {
				t.Errorf("expected nil result, got %v", result)
			}
		})
	}
}

func TestVersionFromFilename(t *testing.T) {
	t.Parallel()

	tests := []struct {
		input   string
		want    int
		wantErr bool
	}{
		{"migrations/0001_initial_schema.sql", 1, false},
		{"migrations/0042_add_index.sql", 42, false},
		{"migrations/1000_something.sql", 1000, false},
		{"migrations/no_number.sql", 0, true},
		{"migrations/.sql", 0, true},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			t.Parallel()
			got, err := versionFromFilename(tc.input)
			if (err != nil) != tc.wantErr {
				t.Errorf("wantErr=%v, got err=%v", tc.wantErr, err)
				return
			}
			if !tc.wantErr && got != tc.want {
				t.Errorf("got %d, want %d", got, tc.want)
			}
		})
	}
}
