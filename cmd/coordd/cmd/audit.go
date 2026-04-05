package cmd

import (
	"bufio"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/spf13/cobra"

	"github.com/ny4rl4th0t3p/chaincoord/pkg/canonicaljson"
)

func newAuditCmd() *cobra.Command {
	audit := &cobra.Command{
		Use:   "audit",
		Short: "Audit log utilities",
	}
	audit.AddCommand(newAuditVerifyCmd())
	return audit
}

func newAuditVerifyCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "verify",
		Short: "Verify structural integrity and Ed25519 signatures of a local JSONL audit log",
		Long: `Reads a JSONL audit log file produced by coordd and checks:
  - Every line is valid JSON with required fields (launch_id, event_name, occurred_at, payload)
  - Timestamps are monotonically non-decreasing
  - Ed25519 signatures are valid (if a public key is available)

The audit public key can be supplied via --pubkey or fetched automatically from
a running server with --server-url (uses GET /audit/pubkey).`,
		Example: `  # Verify offline with an explicit pubkey
  coordd audit verify --file audit.jsonl --pubkey <base64-ed25519-pubkey>

  # Fetch pubkey from a live server
  coordd audit verify --file audit.jsonl --server-url http://coordd:8080`,
		RunE: runAuditVerify,
	}
	cmd.Flags().String("file", "", "path to local JSONL audit log file (required)")
	cmd.Flags().String("pubkey", "", "base64 Ed25519 public key for signature verification")
	cmd.Flags().String("server-url", "", "coordd base URL — fetches audit pubkey via GET /audit/pubkey if --pubkey is omitted")
	_ = cmd.MarkFlagRequired("file")
	return cmd
}

// rawAuditEntry is the on-disk shape of each audit log line.
type rawAuditEntry struct {
	LaunchID   string          `json:"launch_id"`
	EventName  string          `json:"event_name"`
	OccurredAt time.Time       `json:"occurred_at"`
	Payload    json.RawMessage `json:"payload"`
	Signature  string          `json:"signature"`
}

func runAuditVerify(cmd *cobra.Command, _ []string) error {
	filePath, _ := cmd.Flags().GetString("file")
	pubKeyB64, _ := cmd.Flags().GetString("pubkey")
	serverURL, _ := cmd.Flags().GetString("server-url")

	pubKey, err := resolveAuditPubKey(pubKeyB64, serverURL)
	if err != nil {
		return err
	}

	f, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("opening file: %w", err)
	}
	defer f.Close()

	count, firstTime, lastTime, anomalies, err := scanAuditLog(f, pubKey)
	if err != nil {
		return fmt.Errorf("reading file: %w", err)
	}

	fmt.Printf("entries:    %d\n", count)
	if count > 0 {
		fmt.Printf("time range: %s → %s\n",
			firstTime.Format(time.RFC3339),
			lastTime.Format(time.RFC3339),
		)
	}
	if pubKey != nil {
		fmt.Println("signatures: verified (where present)")
	} else {
		fmt.Println("signatures: not checked (no pubkey provided or fetched)")
	}

	if len(anomalies) == 0 {
		fmt.Println("result:     OK — no anomalies found")
		return nil
	}
	fmt.Printf("result:     %d anomaly(ies) found\n", len(anomalies))
	for _, a := range anomalies {
		fmt.Printf("  - %s\n", a)
	}
	return fmt.Errorf("audit log has %d anomaly(ies)", len(anomalies))
}

// resolveAuditPubKey returns the Ed25519 public key to use for verification.
// Priority: explicit --pubkey flag > fetch from server > nil (skip sig checks).
func resolveAuditPubKey(pubKeyB64, serverURL string) (ed25519.PublicKey, error) {
	if pubKeyB64 != "" {
		raw, err := base64.StdEncoding.DecodeString(pubKeyB64)
		if err != nil {
			return nil, fmt.Errorf("decoding --pubkey: %w", err)
		}
		if len(raw) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("--pubkey must be a 32-byte Ed25519 public key (%d bytes given)", len(raw))
		}
		return ed25519.PublicKey(raw), nil
	}

	if serverURL != "" {
		pub, err := fetchAuditPubKey(serverURL)
		if err != nil {
			fmt.Fprintf(os.Stderr, "warning: could not fetch audit pubkey from server (%v) — signatures will not be verified\n", err)
			return nil, nil
		}
		fmt.Fprintf(os.Stderr, "info: using audit pubkey fetched from %s\n", serverURL)
		return pub, nil
	}

	return nil, nil
}

// fetchAuditPubKey calls GET /audit/pubkey on the given server and returns the key.
func fetchAuditPubKey(serverURL string) (ed25519.PublicKey, error) {
	resp, err := http.Get(serverURL + "/audit/pubkey") //nolint:noctx // simple CLI fetch, no context needed
	if err != nil {
		return nil, fmt.Errorf("GET /audit/pubkey: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET /audit/pubkey: server returned %d", resp.StatusCode)
	}
	var body struct {
		PubKeyB64 string `json:"pub_key_b64"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("decoding /audit/pubkey response: %w", err)
	}
	raw, err := base64.StdEncoding.DecodeString(body.PubKeyB64)
	if err != nil {
		return nil, fmt.Errorf("decoding pubkey from server: %w", err)
	}
	if len(raw) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("server returned a key of unexpected size %d", len(raw))
	}
	return ed25519.PublicKey(raw), nil
}

// scanAuditLog reads the JSONL file and returns entry count, time range, and anomalies.
func scanAuditLog(f *os.File, pubKey ed25519.PublicKey) (count int, firstTime, lastTime time.Time, anomalies []string, err error) {
	scanner := bufio.NewScanner(f)
	var lineNum int
	var prevTime time.Time

	for scanner.Scan() {
		lineNum++
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var entry rawAuditEntry
		if jsonErr := json.Unmarshal(line, &entry); jsonErr != nil {
			anomalies = append(anomalies, fmt.Sprintf("line %d: invalid JSON: %v", lineNum, jsonErr))
			continue
		}

		if missing := missingAuditEntryFields(entry); len(missing) > 0 {
			anomalies = append(anomalies, fmt.Sprintf("line %d: missing required fields: %v", lineNum, missing))
			continue
		}

		if !prevTime.IsZero() && entry.OccurredAt.Before(prevTime) {
			anomalies = append(anomalies, fmt.Sprintf(
				"line %d: timestamp %s is before previous entry %s",
				lineNum, entry.OccurredAt.Format(time.RFC3339), prevTime.Format(time.RFC3339),
			))
		}

		anomalies = append(anomalies, checkAuditEntrySignature(entry, lineNum, pubKey)...)

		if count == 0 {
			firstTime = entry.OccurredAt
		}
		lastTime = entry.OccurredAt
		prevTime = entry.OccurredAt
		count++
	}
	return count, firstTime, lastTime, anomalies, scanner.Err()
}

func missingAuditEntryFields(entry rawAuditEntry) []string {
	var missing []string
	if entry.LaunchID == "" {
		missing = append(missing, "launch_id")
	}
	if entry.EventName == "" {
		missing = append(missing, "event_name")
	}
	if entry.OccurredAt.IsZero() {
		missing = append(missing, "occurred_at")
	}
	if len(entry.Payload) == 0 {
		missing = append(missing, "payload")
	}
	return missing
}

func checkAuditEntrySignature(entry rawAuditEntry, lineNum int, pubKey ed25519.PublicKey) []string {
	if pubKey == nil || entry.Signature == "" {
		return nil
	}
	sigBytes, err := base64.StdEncoding.DecodeString(entry.Signature)
	if err != nil {
		return []string{fmt.Sprintf("line %d: invalid signature encoding: %v", lineNum, err)}
	}
	// Reproduce canonical signed bytes: entry without the signature field.
	noSig := rawAuditEntry{
		LaunchID:   entry.LaunchID,
		EventName:  entry.EventName,
		OccurredAt: entry.OccurredAt,
		Payload:    entry.Payload,
	}
	msg, merr := canonicaljson.MarshalForSigning(noSig)
	if merr != nil {
		return []string{fmt.Sprintf("line %d: re-marshaling for sig verify: %v", lineNum, merr)}
	}
	if !ed25519.Verify(pubKey, msg, sigBytes) {
		return []string{fmt.Sprintf("line %d: signature verification FAILED", lineNum)}
	}
	return nil
}
