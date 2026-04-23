# API Reference

The `coordd` HTTP API uses JSON for all request and response bodies. All endpoints that require authentication accept a JWT as a `Bearer` token in the `Authorization` header.

The machine-readable OpenAPI spec is at [`docs/api/swagger.yaml`](../../api/swagger.yaml). The interactive explorer is below.

<swagger-ui src="../../api/swagger.yaml"/>

---

## Authentication

All coordinators and validators authenticate via a two-step secp256k1 challenge–response. The public key must be provided explicitly — bech32 addresses are hashes and the server cannot recover the public key from them.

### `POST /auth/challenge`

Request a short-lived challenge nonce for the given operator address. Rate-limited to 10 requests per IP per minute and 5 requests per operator address per 5 minutes.

**Request body:**
```json
{ "operator_address": "cosmos1abc..." }
```

**Response:**
```json
{ "challenge": "<nonce-string>" }
```

### `POST /auth/verify`

Submit the signed challenge to obtain a session JWT.

**Request body:**
```json
{
  "operator_address": "cosmos1abc...",
  "challenge":        "<nonce from /auth/challenge>",
  "pubkey_b64":       "<base64 secp256k1 compressed pubkey, 33 bytes>",
  "timestamp":        "<RFC3339>",
  "nonce":            "<replay-protection nonce>",
  "signature":        "<base64 sig over canonical JSON of this object, minus nonce/pubkey/signature>"
}
```

**Response:**
```json
{ "token": "<JWT>" }
```

### `GET /auth/session`

Return the operator address and expiry of the current session token. Requires `Bearer` token.

### `DELETE /auth/session`

Revoke the current session. Requires `Bearer` token.

### `DELETE /auth/sessions/all`

Revoke all active sessions for the currently authenticated operator address. Requires `Bearer` token. Useful for signing out of all devices at once.

---

## Launches

### `POST /launch`

Create a new launch. The caller becomes the lead coordinator.

**Required fields:** `record` (chain record), `committee`, `launch_type`, `visibility`.

**Request body (abbreviated):**
```json
{
  "launch_type": "MAINNET",
  "visibility": "PUBLIC",
  "record": {
    "chain_id": "mychain-1",
    "chain_name": "My Chain",
    "bech32_prefix": "mychain",
    "binary_name": "mychaind",
    "binary_version": "v1.0.0",
    "denom": "utoken",
    "min_self_delegation": "1000000",
    "max_commission_rate": "0.20",
    "max_commission_change_rate": "0.01",
    "gentx_deadline": "2026-06-01T00:00:00Z",
    "application_window_open": "2026-05-01T00:00:00Z",
    "min_validator_count": 4
  },
  "committee": {
    "members": [
      { "address": "cosmos1abc...", "moniker": "coordinator", "pub_key_b64": "<base64>" }
    ],
    "threshold_m": 1,
    "total_n": 1,
    "lead_address": "cosmos1abc...",
    "creation_signature": "<base64 sig over committee canonical JSON>"
  }
}
```

**Response:** `201` with the created launch object.

### `GET /launches`

List launches visible to the authenticated caller. Paginated (`?page=1&per_page=20`). Supports filtering by status.

### `GET /launch/{id}`

Get a single launch by ID.

### `GET /launch/{id}/chain-hint`

Return the minimal chain metadata needed to register the network with a wallet extension (`chain_id`, `chain_name`, `bech32_prefix`, `denom`). **No authentication required** — even allowlist-gated launches expose this endpoint so validators can derive their chain address before being added to the allowlist.

**Response:**
```json
{
  "chain_id": "mychain-1",
  "chain_name": "My Chain",
  "bech32_prefix": "mychain",
  "denom": "utoken"
}
```

### `PATCH /launch/{id}`

Update mutable fields on a launch. Patchable fields: `chain_name`, `binary_version`, `binary_sha256`, `repo_url`, `repo_commit`, `genesis_time`, `min_validator_count`, `visibility`, `allowlist`, `monitor_rpc_url`.

### `POST /launch/{id}/cancel`

Cancel the launch from any non-terminal state (`DRAFT`, `PUBLISHED`, `WINDOW_OPEN`, `WINDOW_CLOSED`, `GENESIS_READY`). Lead coordinator only. No request body.

**Response:** `204 No Content`.

### `POST /launch/{id}/open-window`

Open the application window (`PUBLISHED` → `WINDOW_OPEN`). Lead coordinator only. No request body.

### `POST /launch/{id}/genesis`

Upload a genesis file. Requires `?type=initial` or `?type=final`. Body is raw bytes (`Content-Type: application/octet-stream`). Only available when `genesis_host_mode` is enabled.

### `GET /launch/{id}/genesis`

Download the current genesis file (initial or final depending on lifecycle state).

### `GET /launch/{id}/genesis/hash`

Return the SHA-256 hashes of the uploaded genesis files.

**Response:**
```json
{
  "initial_sha256": "<hex>",
  "final_sha256":   "<hex>"
}
```

### `POST /launch/{id}/committee`

Set or replace the committee on a `DRAFT` launch. The request body has the same shape as the embedded `committee` field in `POST /launch`. The `creation_signature` must be a secp256k1 signature by the lead over the canonical JSON of the committee payload.

### `GET /launch/{id}/dashboard`

Return the readiness dashboard for a launch: the list of approved validators and their readiness confirmation status.

**Response:**
```json
{
  "validators": [
    {
      "operator_address": "cosmos1...",
      "join_request_id": "<uuid>",
      "peer_address": "<node-id>@host:26656",
      "readiness": {
        "confirmed": true,
        "genesis_hash_confirmed": "<sha256 hex>",
        "binary_hash_confirmed": "<sha256 hex>"
      }
    }
  ]
}
```

### `GET /launch/{id}/gentxs`

Return all approved gentxs for the launch. Used by the coordinator to assemble the final genesis.

**Response:**
```json
{
  "gentxs": [
    { "join_request_id": "<uuid>", "operator_address": "cosmos1...", "gentx": { ... } }
  ]
}
```

### `GET /launch/{id}/peers`

Return the peer addresses of all approved validators. Accepts `?format=text` to get a comma-separated string suitable for `persistent_peers` in CometBFT `config.toml`.

---

## Proposals

### `POST /launch/{id}/proposal`

Raise a new proposal. The proposer's signature counts as the first SIGN.

**Request body:**
```json
{
  "coordinator_address": "cosmos1abc...",
  "action_type": "APPROVE_VALIDATOR",
  "payload": { ... },
  "nonce": "<uuid>",
  "timestamp": "<RFC3339>",
  "signature": "<base64>"
}
```

**Response:** `201` with the proposal object, including its current status. If M=1, the status will already be `EXECUTED`.

### `GET /launch/{id}/proposal`

List proposals for a launch. Paginated. Filterable by status and action type.

### `GET /launch/{id}/proposal/{pid}`

Get a single proposal by ID.

### `POST /launch/{id}/proposal/{pid}/sign`

Submit a SIGN or VETO decision on a pending proposal.

**Request body:**
```json
{
  "coordinator_address": "cosmos1abc...",
  "decision": "SIGN",
  "nonce": "<uuid>",
  "timestamp": "<RFC3339>",
  "signature": "<base64>"
}
```

---

## Join Requests

### `POST /launch/{id}/join`

Submit a validator join request. Launch must be in `WINDOW_OPEN` status.

**Request body:**
```json
{
  "operator_address": "cosmos1...",
  "chain_id": "mychain-1",
  "consensus_pubkey": "<base64 Ed25519 consensus pubkey>",
  "gentx": { ... },
  "peer_address": "<node-id>@host:26656",
  "rpc_endpoint": "http://host:26657",
  "memo": "",
  "pubkey_b64": "<base64 secp256k1 operator pubkey>",
  "nonce": "<uuid>",
  "timestamp": "<RFC3339>",
  "signature": "<base64>"
}
```

**Response:** `201` with the join request object.

### `GET /launch/{id}/join`

List join requests for a launch. Paginated. Filterable by status.

### `GET /launch/{id}/join/{jrid}`

Get a single join request by ID.

---

## Readiness

### `POST /launch/{id}/ready`

Submit a validator readiness confirmation. The validator attests they have the correct genesis file and binary. Launch must be in `GENESIS_READY` status.

**Request body:**
```json
{
  "operator_address": "cosmos1...",
  "genesis_hash_confirmed": "<sha256 hex>",
  "binary_hash_confirmed": "<sha256 hex>",
  "pubkey_b64": "<base64 secp256k1 operator pubkey>",
  "nonce": "<uuid>",
  "timestamp": "<RFC3339>",
  "signature": "<base64>"
}
```

### `GET /launch/{id}/audit`

Return the audit log entries for a launch. No authentication required.

**Response:**
```json
{
  "entries": [
    {
      "launch_id": "<uuid>",
      "event_name": "LaunchCreated",
      "occurred_at": "2026-05-01T00:00:00Z",
      "payload": { ... },
      "signature": "<base64 Ed25519 sig>"
    }
  ]
}
```

---

## Audit

### `GET /audit/pubkey`

Return the server's Ed25519 public key for offline audit log signature verification. No authentication required.

**Response:**
```json
{ "pub_key_b64": "<base64 Ed25519 public key>" }
```

---

## Admin

Admin endpoints require the caller's address to be in `COORD_ADMIN_ADDRESSES`.

### `GET /admin/coordinators`

List all addresses on the coordinator allowlist. Paginated.

### `POST /admin/coordinators`

Add an address to the coordinator allowlist. Idempotent.

**Request body:**
```json
{ "address": "cosmos1abc..." }
```

### `DELETE /admin/coordinators/{address}`

Remove an address from the coordinator allowlist.

### `DELETE /admin/sessions/{address}`

Revoke all active sessions for an operator address.

---

## Server-Sent Events

### `GET /launch/{id}/events`

Subscribe to real-time events for a launch via Server-Sent Events (SSE). Events are emitted on every state change and proposal execution. No authentication required.

---

## Health

### `GET /healthz`

Returns `{"status":"ok"}` when the server is up. Used by Docker health checks and load balancer probes. No authentication required.

---

## Error format

All errors use a consistent envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "chain_id is required",
    "request_id": "<uuid>"
  }
}
```

`request_id` is included in every response and can be used to correlate with server logs.