// Package auditlog implements ports.AuditLogWriter as an append-only JSONL file.
// Each line is a JSON-encoded AuditEvent. The file is never truncated or modified.
package auditlog

import (
	"bufio"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"sync"

	"github.com/ny4rl4th0t3p/chaincoord/internal/application/ports"
	"github.com/ny4rl4th0t3p/chaincoord/pkg/canonicaljson"
)

// JSONLWriter writes audit events to an append-only JSONL file.
// A mutex serializes concurrent writes so lines are never interleaved.
type JSONLWriter struct {
	mu      sync.Mutex
	file    *os.File
	privKey ed25519.PrivateKey // nil disables signing
}

// Open opens (or creates) the JSONL audit log at path.
// The file is opened with O_APPEND so the OS guarantees atomicity of small writes.
// privKey is an Ed25519 private key used to sign each entry. Pass nil to disable
// signing (entries will have an empty Signature field).
func Open(path string, privKey ed25519.PrivateKey) (*JSONLWriter, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return nil, fmt.Errorf("audit log open %q: %w", path, err)
	}
	return &JSONLWriter{file: f, privKey: privKey}, nil
}

// PubKey returns the Ed25519 public key corresponding to the signing key.
// Returns nil if the writer was opened without a signing key.
func (w *JSONLWriter) PubKey() ed25519.PublicKey {
	if w.privKey == nil {
		return nil
	}
	return w.privKey.Public().(ed25519.PublicKey)
}

// Append serializes ev to JSON and writes a single newline-terminated line.
// If the writer was opened with a signing key, the Signature field is set to a
// base64 Ed25519 signature over the canonical JSON of the event (excluding the
// signature field itself).
func (w *JSONLWriter) Append(_ context.Context, ev ports.AuditEvent) error {
	if w.privKey != nil {
		msg, err := canonicaljson.MarshalForSigning(ev)
		if err != nil {
			return fmt.Errorf("audit log sign: canonical json: %w", err)
		}
		ev.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(w.privKey, msg))
	}

	line, err := json.Marshal(ev)
	if err != nil {
		return fmt.Errorf("audit log marshal: %w", err)
	}
	line = append(line, '\n')

	w.mu.Lock()
	defer w.mu.Unlock()

	if _, err := w.file.Write(line); err != nil {
		return fmt.Errorf("audit log write: %w", err)
	}
	return nil
}

// ReadForLaunch opens the log file read-only and returns all entries whose
// LaunchID matches. Implements ports.AuditLogReader.
func (w *JSONLWriter) ReadForLaunch(_ context.Context, launchID string) ([]ports.AuditEvent, error) {
	f, err := os.Open(w.file.Name())
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil // no events yet — not an error
		}
		return nil, fmt.Errorf("audit log read: %w", err)
	}
	defer f.Close()

	var out []ports.AuditEvent
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		var ev ports.AuditEvent
		if err := json.Unmarshal(scanner.Bytes(), &ev); err != nil {
			continue // skip malformed lines
		}
		if ev.LaunchID == launchID {
			out = append(out, ev)
		}
	}
	return out, scanner.Err()
}

// Close flushes and closes the underlying file.
func (w *JSONLWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.file.Close()
}
