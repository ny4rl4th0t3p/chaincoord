# Docker

The `docker/` directory contains a Docker Compose file that runs `coordd` alongside a smoke-test harness. It is primarily designed for the end-to-end smoke test, but the `coordd` service configuration is a useful reference for a containerised deployment.

---

## Prerequisites

- Docker with Compose v2 (`docker compose`)
- `make`

---

## How it is structured

| Service | Role |
|---|---|
| `coordd` | The coordination server, bound on `:8080` |
| `val1`–`val4` | Four simulated Cosmos SDK validator nodes (`gaiad`) |
| `smoke-test` | Scripted client that drives the full launch protocol |

The `val*` containers use a shared volume (`gaia-shared`) to exchange gentx files and the assembled genesis. The `coordd` container persists its database, audit log, and genesis files in a separate volume (`coordd-data`).

---

## Keys and secrets

`coordd` requires two Ed25519 keys. In the Compose setup they are mounted as [Docker secrets](https://docs.docker.com/compose/use-secrets/) so they do not appear in environment variable listings or container inspection output.

The `make smoke-test-secrets` target generates them if they do not already exist:

```bash
make smoke-test-secrets
```

This creates `docker/secrets/audit_key` and `docker/secrets/jwt_key`, each a base64-encoded 32-byte seed.

!!! warning
    The `docker/secrets/` directory is intentionally excluded from version control. Never commit secret files.

---

## Environment variables used by the `coordd` container

| Variable | Value in Compose | Description |
|---|---|---|
| `COORD_LISTEN_ADDR` | `:8080` | HTTP listen address |
| `COORD_DB_PATH` | `/data/coord.db` | SQLite database path |
| `COORD_AUDIT_LOG_PATH` | `/data/audit.jsonl` | Audit log path |
| `COORD_GENESIS_PATH` | `/data/genesis` | Genesis file storage directory |
| `COORD_LOG_LEVEL` | `info` | Log verbosity |
| `COORD_INSECURE_NO_TLS` | `true` | Suppresses the TLS warning (TLS is terminated upstream in prod) |
| `COORD_INSECURE_NO_SSRF_CHECK` | `true` | Disables SSRF check for internal Docker hostnames (`val*`) |
| `COORD_LAUNCH_POLICY` | `open` | Any authenticated address may create a launch |
| `COORD_GENESIS_HOST_MODE` | `true` | Accept raw genesis file uploads |
| `COORD_AUDIT_PRIVATE_KEY_FILE` | `/run/secrets/audit_key` | Path to audit key secret |
| `COORD_JWT_PRIVATE_KEY_FILE` | `/run/secrets/jwt_key` | Path to JWT key secret |

See [Setup & Configuration](../reference/setup.md) for the full reference.

---

## Running the smoke test

See [Smoke Test](smoke-test.md).