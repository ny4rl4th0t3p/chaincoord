# Audit Log

`coordd` appends an entry to a JSONL (newline-delimited JSON) file for every state-changing event. Each entry is signed with the server's Ed25519 key, making the log tamper-evident: a missing, reordered, or modified entry will fail verification.

---

## Entry format

Each line is a JSON object:

```json
{
  "launch_id":   "<uuid>",
  "event_name":  "ValidatorApproved",
  "occurred_at": "2026-04-13T10:00:00Z",
  "payload":     { ... },
  "signature":   "<base64 Ed25519 sig>"
}
```

| Field | Type | Description |
|---|---|---|
| `launch_id` | string (UUID) | The launch this event belongs to |
| `event_name` | string | Event type (see table below) |
| `occurred_at` | RFC3339 timestamp | When the event occurred |
| `payload` | object | Event-specific data |
| `signature` | string (base64) | Ed25519 signature over canonical JSON of the entry *without* the `signature` field |

Timestamps are monotonically non-decreasing within a log file. A timestamp that moves backward is flagged as an anomaly by `coordd audit verify`.

---

## Event types

| Event | Trigger |
|---|---|
| `ChainRecordPublished` | `PUBLISH_CHAIN_RECORD` proposal executed — launch moves to `PUBLISHED` |
| `WindowClosed` | `CLOSE_APPLICATION_WINDOW` proposal executed — launch moves to `WINDOW_CLOSED` |
| `GenesisPublished` | `PUBLISH_GENESIS` proposal executed — launch moves to `GENESIS_READY` |
| `GenesisTimeUpdated` | `UPDATE_GENESIS_TIME` proposal executed |
| `GenesisRevisionApproved` | `REVISE_GENESIS` proposal executed — launch reverts to `WINDOW_CLOSED` |
| `ValidatorApproved` | `APPROVE_VALIDATOR` proposal executed |
| `ValidatorRejected` | `REJECT_VALIDATOR` proposal executed |
| `ValidatorRemoved` | `REMOVE_APPROVED_VALIDATOR` proposal executed |

!!! note
    Not all proposal action types emit audit events. Actions that mutate launch state directly without a domain event (e.g. `ADD_GENESIS_ACCOUNT`, `REPLACE_COMMITTEE_MEMBER`) are recorded in the database but do not produce audit log entries in the current implementation.

---

## Signature verification

The signature covers the canonical JSON of the entry with the `signature` field omitted. Canonical JSON means:

- Keys sorted lexicographically
- No insignificant whitespace
- Timestamps serialised as RFC3339 UTC

The server's Ed25519 public key is available at `GET /audit/pubkey` on any running `coordd` instance.

---

## Offline verification with `coordd audit verify`

```bash
# Fetch the pubkey from a live server and verify
coordd audit verify \
  --file audit.jsonl \
  --server-url http://coordd:8080

# Verify with an explicit pubkey (fully offline)
coordd audit verify \
  --file audit.jsonl \
  --pubkey <base64-ed25519-pubkey>

# Structural check only (no signature verification)
coordd audit verify --file audit.jsonl
```

**What the command checks:**

1. Every line is valid JSON
2. Required fields are present (`launch_id`, `event_name`, `occurred_at`, `payload`)
3. Timestamps are monotonically non-decreasing
4. Ed25519 signatures are valid (when a public key is supplied)

**Output example:**

```
entries:    142
time range: 2026-04-01T08:00:00Z → 2026-04-13T10:00:00Z
signatures: verified (where present)
result:     OK — no anomalies found
```

Exit code is `0` on success, non-zero if any anomaly is found.

---

## Keeping the log

The audit log is append-only by design. `coordd` never modifies or truncates it. Back it up alongside your database — the two together form the complete record of a launch.

For archival purposes, the log is human-readable and requires no special tooling beyond `coordd audit verify` and a standard JSON processor (`jq`).