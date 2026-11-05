#!/usr/bin/env bash
# L1b: real Bitcoin regtest round trip. Needs bitcoind/bitcoin-cli, jq, python3.
# 1. funds a contract-derived address, 2. exports an inclusion proof in the contract's format,
# 3. checks a contract-signed transaction with testmempoolaccept and mines it.
set -euo pipefail
D=$(mktemp -d); CLI="bitcoin-cli -regtest -datadir=$D -rpcwait"
bitcoind -regtest -datadir="$D" -daemon -fallbackfee=0.0001 >/dev/null
trap '$CLI stop >/dev/null 2>&1 || true' EXIT
$CLI createwallet w >/dev/null; MINE=$($CLI getnewaddress); $CLI generatetoaddress 101 "$MINE" >/dev/null
ADDR=${1:?usage: regtest.sh <derived bcrt1 address> <size_btc> [signed_tx_hex]}; SIZE=${2:?}
TXID=$($CLI sendtoaddress "$ADDR" "$SIZE"); $CLI generatetoaddress 6 "$MINE" >/dev/null
RAW=$($CLI getrawtransaction "$TXID"); BLOCK=$($CLI gettransaction "$TXID" | jq -r .blockhash)
# proof in the contract's shape; merkle branch from gettxoutproof is parsed by scripts/txoutproof.py
PROOF=$($CLI gettxoutproof "[\"$TXID\"]" "$BLOCK")
python3 "$(dirname "$0")/txoutproof.py" "$PROOF" "$TXID" "$RAW" "$BLOCK" > "$D/proof.json"
echo "deposit $TXID in $BLOCK; proof:"; cat "$D/proof.json"
if [ -n "${3:-}" ]; then
  echo "testmempoolaccept:"; $CLI testmempoolaccept "[\"$3\"]"
  SPEND=$($CLI sendrawtransaction "$3"); $CLI generatetoaddress 1 "$MINE" >/dev/null
  echo "spend $SPEND mined; proof:"; python3 "$(dirname "$0")/txoutproof.py" "$($CLI gettxoutproof "[\"$SPEND\"]")" "$SPEND" "$3" "$($CLI gettransaction "$SPEND" 2>/dev/null | jq -r .blockhash || $CLI getbestblockhash)"
fi
