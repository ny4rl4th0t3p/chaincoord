#!/usr/bin/env bash
set -euo pipefail

NUM="${VALIDATOR_NUM}"
HOME_DIR="/gaia/val${VALIDATOR_NUM}"
READY_FLAG="${HOME_DIR}/ready"

echo "==> val${VALIDATOR_NUM}: waiting for genesis-ready flag..."
while [ ! -f "${READY_FLAG}" ]; do sleep 1; done

echo "==> val${VALIDATOR_NUM}: starting gaiad..."
exec gaiad start \
  --home "${HOME_DIR}" \
  --rpc.laddr  "tcp://0.0.0.0:26657" \
  --p2p.laddr  "tcp://0.0.0.0:26656" \
  --grpc.enable=false \
  --api.enable=false \
  --minimum-gas-prices "0uatom" \
  --log_level "error"