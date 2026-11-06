#!/bin/sh
# Writes the web app's runtime config for one network from the environment (one .env file) to $1.
# A network without a contract (COVERED_ID empty) gets {"disabled":true}: the app then says it is not live yet.
set -eu
out=$1
SWITCH_URL=""; case "${SWITCH_HOST:-}" in ""|:*) ;; *) SWITCH_URL="https://$SWITCH_HOST" ;; esac
q() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
if [ -z "${COVERED_ID:-}" ]; then
  printf '{"mode":"%s","disabled":true,"switchUrl":"%s"}\n' "$(q "${MODE:-mainnet}")" "$(q "${SWITCH_URL:-}")" > "$out"
else
  cat > "$out" <<JSON
{"mode":"$(q "${MODE:-testnet}")","network":"$(q "${NEAR_NETWORK:-testnet}")","rpc":"$(q "${WEB_NEAR_RPC:-${NEAR_RPC:-}}")",
 "contract":"$(q "$COVERED_ID")","usdc":"$(q "${USDC_ID:-}")","esplora":"$(q "${WEB_ESPLORA:-${ESPLORA:-}}")",
 "explorerBtc":"$(q "${EXPLORER_BTC:-https://mempool.space/testnet}")","explorerNear":"$(q "${EXPLORER_NEAR:-https://testnet.nearblocks.io}")",
 "codeHash":"$(q "${CODE_HASH:-}")","signer":"$(q "${SIGNER_ID:-v1.signer-prod.testnet}")","lightClient":"$(q "${LIGHT_CLIENT_ID:-}")",
 "minConf":${MIN_CONF:-1},"helper":"$(q "${HELPER:-/api}")","accountSuffix":"$(q "${ACCOUNT_SUFFIX:-${NEAR_NETWORK:-testnet}}")",
 "faucet":$( [ "${ACCOUNT_FAUCET:-}" = 1 ] || [ "${MODE:-}" = local ] && echo true || echo false ),
 "switchUrl":"$(q "${SWITCH_URL:-}")"}
JSON
fi
cat "$out"
