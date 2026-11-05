#!/usr/bin/env bash
# L2: deploy covered to NEAR testnet and lock it. Needs cargo-near, near-cli-rs, a funded testnet account.
# Pinned 5 Nov 2026 against the live network: btc-client-v4.testnet follows Bitcoin testnet3 (addresses are `tb1…`,
# network variant `Testnet4` = hrp `tb`); v1.signer-prod.testnet takes payload_v2/domain_id (sign_format 2) and a
# 1 yoctoNEAR deposit. USDC_ID: Circle's testnet USDC cannot be minted, so judges' /try uses our mock-usdc.
set -euo pipefail
ACC=${COVERED_ID:-covered.testnet}; SIGNER=${SIGNER_ID:-v1.signer-prod.testnet}; LC=${LIGHT_CLIENT_ID:-btc-client-v4.testnet}; USDC=${USDC_ID:?set USDC_ID}
ROOT=$(near contract call-function as-read-only "$SIGNER" public_key json-args '{}' network-config testnet now | tail -1 | tr -d '"')
cargo near build non-reproducible-wasm --manifest-path contracts/covered/Cargo.toml
WASM=target/near/covered/covered.wasm
near contract deploy "$ACC" use-file "$WASM" with-init-call new json-args "{\"params\":{
  \"signer\":\"$SIGNER\",\"light_client\":\"$LC\",\"usdc\":\"$USDC\",\"usdc_decimals\":6,\"network\":\"Testnet4\",
  \"min_conf\":1,\"fee_sats\":300,\"grace_s\":600,\"buy_cutoff_s\":0,\"min_lead_s\":300,\"escrow_timeout_s\":3600,
  \"min_size_sats\":100000,\"expiry_step_s\":60,\"expiry_offset_s\":0,\"mpc_root_key\":\"$ROOT\",\"derivation_prefix\":\"near-mpc-recovery v0.1.0 epsilon derivation:\",
  \"sign_format\":2,\"sign_deposit\":\"1\"}}" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send
echo "code hash: $(sha256sum "$WASM" | cut -d' ' -f1 | xxd -r -p | base58 2>/dev/null || sha256sum "$WASM")"
echo "Now, on camera: near account delete-keys $ACC public-keys <full-access key> network-config testnet"
echo "Then: near account view-account-summary $ACC network-config testnet now   # must show no access keys"
