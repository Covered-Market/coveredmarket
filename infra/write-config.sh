#!/bin/sh
# Writes the web app's runtime config for one network from the environment (one .env file) to $1.
# A network without a contract (COVERED_ID empty) gets {"disabled":true}: the app then says it is not live yet.
# SITE=1 writes the website's config instead: no network at all, only where the two apps live.
#   SWITCH_HOST  the other network's app (the header switch)
#   SITE_HOST    the website, when it is separate from the apps (then `/` on an app opens the app)
#   TESTNET_HOST, MAINNET_HOST  the two apps, for the website (SITE=1)
#   FILM_URL     optional: the website hero's film, a YouTube embed link (SITE=1). Empty shows the poster only.
set -eu
out=$1
url() { case "${1:-}" in ""|:*) ;; *) printf 'https://%s' "$1" ;; esac; }
SWITCH_URL=$(url "${SWITCH_HOST:-}"); SITE_URL=$(url "${SITE_HOST:-}")
q() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
if [ "${SITE:-}" = 1 ]; then
  # rpc + contract only so the hero certificate can be read live; the page never shows them.
  printf '{"mode":"site","helper":"/api","appUrl":"%s","testnetUrl":"%s","mainnetLive":false,"rpc":"%s","contract":"%s","filmUrl":"%s"}\n' \
    "$(q "$(url "${MAINNET_HOST:-}")")" "$(q "$(url "${TESTNET_HOST:-}")")" "$(q "${WEB_NEAR_RPC:-${NEAR_RPC:-https://rpc.testnet.fastnear.com}}")" "$(q "${COVERED_ID:-}")" "$(q "${FILM_URL:-}")" > "$out"
elif [ -z "${COVERED_ID:-}" ]; then
  printf '{"mode":"%s","disabled":true,"switchUrl":"%s","siteUrl":"%s"}\n' "$(q "${MODE:-mainnet}")" "$(q "$SWITCH_URL")" "$(q "$SITE_URL")" > "$out"
else
  cat > "$out" <<JSON
{"mode":"$(q "${MODE:-testnet}")","network":"$(q "${NEAR_NETWORK:-testnet}")","rpc":"$(q "${WEB_NEAR_RPC:-${NEAR_RPC:-}}")",
 "contract":"$(q "$COVERED_ID")","usdc":"$(q "${USDC_ID:-}")","esplora":"$(q "${WEB_ESPLORA:-${ESPLORA:-}}")",
 "explorerBtc":"$(q "${EXPLORER_BTC:-https://mempool.space/testnet}")","explorerNear":"$(q "${EXPLORER_NEAR:-https://testnet.nearblocks.io}")",
 "codeHash":"$(q "${CODE_HASH:-}")","signer":"$(q "${SIGNER_ID:-v1.signer-prod.testnet}")","lightClient":"$(q "${LIGHT_CLIENT_ID:-}")",
 "minConf":${MIN_CONF:-1},"helper":"$(q "${HELPER:-/api}")","accountSuffix":"$(q "${ACCOUNT_SUFFIX:-${NEAR_NETWORK:-testnet}}")",
 "faucet":$( [ "${ACCOUNT_FAUCET:-}" = 1 ] || [ "${MODE:-}" = local ] && echo true || echo false ),
 "switchUrl":"$(q "$SWITCH_URL")","siteUrl":"$(q "$SITE_URL")"}
JSON
fi
cat "$out"
