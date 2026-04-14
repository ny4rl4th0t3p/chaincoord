-- Migration 0001: initial schema
-- Note: schema_migrations is managed by the migration runner, not by migrations.

CREATE TABLE launches
(
    id                         TEXT PRIMARY KEY,
    chain_id                   TEXT    NOT NULL UNIQUE,
    chain_name                 TEXT    NOT NULL DEFAULT '',
    binary_name                TEXT    NOT NULL,
    binary_version             TEXT    NOT NULL DEFAULT '',
    binary_sha256              TEXT    NOT NULL DEFAULT '',
    repo_url                   TEXT    NOT NULL DEFAULT '',
    repo_commit                TEXT    NOT NULL DEFAULT '',
    genesis_time               TEXT,
    denom                      TEXT    NOT NULL,
    min_self_delegation        TEXT    NOT NULL DEFAULT '',
    max_commission_rate        TEXT    NOT NULL DEFAULT '0',
    max_commission_change_rate TEXT    NOT NULL DEFAULT '0',
    gentx_deadline             TEXT    NOT NULL,
    application_window_open    TEXT    NOT NULL,
    min_validator_count        INTEGER NOT NULL DEFAULT 1,
    launch_type                TEXT    NOT NULL,
    visibility                 TEXT    NOT NULL,
    status                     TEXT    NOT NULL,
    initial_genesis_sha256     TEXT    NOT NULL DEFAULT '',
    final_genesis_sha256       TEXT    NOT NULL DEFAULT '',
    monitor_rpc_url            TEXT    NOT NULL DEFAULT '',
    created_at                 TEXT    NOT NULL,
    updated_at                 TEXT    NOT NULL,
    version                    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE committees
(
    id                 TEXT PRIMARY KEY,
    launch_id          TEXT    NOT NULL REFERENCES launches (id),
    threshold_m        INTEGER NOT NULL,
    total_n            INTEGER NOT NULL,
    lead_address       TEXT    NOT NULL,
    creation_signature TEXT    NOT NULL,
    created_at         TEXT    NOT NULL
);

CREATE TABLE committee_members
(
    committee_id TEXT    NOT NULL REFERENCES committees (id),
    position     INTEGER NOT NULL,
    address      TEXT    NOT NULL,
    moniker      TEXT    NOT NULL,
    pubkey_b64   TEXT    NOT NULL,
    PRIMARY KEY (committee_id, position)
);

CREATE TABLE allowlist
(
    launch_id TEXT NOT NULL REFERENCES launches (id),
    address   TEXT NOT NULL,
    PRIMARY KEY (launch_id, address)
);

CREATE TABLE join_requests
(
    id                     TEXT PRIMARY KEY,
    launch_id              TEXT    NOT NULL REFERENCES launches (id),
    operator_address       TEXT    NOT NULL,
    consensus_pubkey       TEXT    NOT NULL,
    gentx_json             TEXT    NOT NULL,
    peer_address           TEXT    NOT NULL,
    rpc_endpoint           TEXT    NOT NULL,
    memo                   TEXT    NOT NULL DEFAULT '',
    submitted_at           TEXT    NOT NULL,
    operator_signature     TEXT    NOT NULL,
    status                 TEXT    NOT NULL,
    rejection_reason       TEXT    NOT NULL DEFAULT '',
    approved_by_proposal   TEXT,
    self_delegation_amount INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_jr_launch ON join_requests (launch_id);
CREATE INDEX idx_jr_operator ON join_requests (launch_id, operator_address);
CREATE INDEX idx_jr_status ON join_requests (launch_id, status);
CREATE UNIQUE INDEX idx_jr_consensus_pubkey ON join_requests (launch_id, consensus_pubkey);

CREATE TABLE proposals
(
    id          TEXT PRIMARY KEY,
    launch_id   TEXT NOT NULL REFERENCES launches (id),
    action_type TEXT NOT NULL,
    payload     TEXT NOT NULL,
    proposed_by TEXT NOT NULL,
    proposed_at TEXT NOT NULL,
    ttl_expires TEXT NOT NULL,
    status      TEXT NOT NULL,
    executed_at TEXT
);

CREATE INDEX idx_proposals_launch ON proposals (launch_id);
CREATE INDEX idx_proposals_status ON proposals (status);

CREATE TABLE proposal_signatures
(
    proposal_id         TEXT NOT NULL REFERENCES proposals (id),
    coordinator_address TEXT NOT NULL,
    decision            TEXT NOT NULL,
    signed_at           TEXT NOT NULL,
    signature           TEXT NOT NULL,
    PRIMARY KEY (proposal_id, coordinator_address)
);

CREATE TABLE readiness_confirmations
(
    id                     TEXT PRIMARY KEY,
    launch_id              TEXT NOT NULL REFERENCES launches (id),
    join_request_id        TEXT NOT NULL REFERENCES join_requests (id),
    operator_address       TEXT NOT NULL,
    genesis_hash_confirmed TEXT NOT NULL,
    binary_hash_confirmed  TEXT NOT NULL,
    confirmed_at           TEXT NOT NULL,
    operator_signature     TEXT NOT NULL,
    invalidated_at         TEXT
);

CREATE INDEX idx_readiness_launch ON readiness_confirmations (launch_id);
CREATE INDEX idx_readiness_operator ON readiness_confirmations (launch_id, operator_address);

CREATE TABLE launch_genesis_accounts
(
    launch_id        TEXT NOT NULL REFERENCES launches (id) ON DELETE CASCADE,
    address          TEXT NOT NULL,
    amount           TEXT NOT NULL,
    vesting_schedule TEXT, -- NULL = fully liquid
    PRIMARY KEY (launch_id, address)
);

CREATE TABLE operator_revocations
(
    operator_address TEXT NOT NULL PRIMARY KEY,
    revoke_before    TEXT NOT NULL -- RFC3339; tokens with iat before this timestamp are invalid
);

CREATE TABLE challenges
(
    operator_address TEXT PRIMARY KEY,
    challenge        TEXT NOT NULL,
    expires_at       TEXT NOT NULL
);

CREATE TABLE challenge_rate_limits
(
    operator_address TEXT NOT NULL,
    requested_at     TEXT NOT NULL -- RFC3339 UTC
);

CREATE INDEX idx_crl_operator ON challenge_rate_limits (operator_address, requested_at);

CREATE TABLE nonces
(
    operator_address TEXT NOT NULL,
    nonce            TEXT NOT NULL,
    expires_at       TEXT NOT NULL,
    PRIMARY KEY (operator_address, nonce)
);

CREATE INDEX idx_nonces_expires ON nonces (expires_at);

CREATE TABLE coordinator_allowlist
(
    address  TEXT NOT NULL PRIMARY KEY,
    added_by TEXT NOT NULL,
    added_at TEXT NOT NULL
);

CREATE TABLE sessions
(
    token            TEXT PRIMARY KEY,
    operator_address TEXT NOT NULL,
    expires_at       TEXT NOT NULL -- RFC3339 UTC
);