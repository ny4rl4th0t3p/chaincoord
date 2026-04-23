#!/bin/sh
set -e

DATA_DIR="${COORD_DB_PATH%/*}"
DATA_DIR="${DATA_DIR:-/data}"

# Auto-generate Ed25519 keys on first boot.
if [ ! -f /data/audit_key ]; then
    coordd keygen > /data/audit_key
    echo "[coordd-dev] generated audit key"
fi
if [ ! -f /data/jwt_key ]; then
    coordd keygen > /data/jwt_key
    echo "[coordd-dev] generated JWT key"
fi

coordd migrate
exec coordd serve