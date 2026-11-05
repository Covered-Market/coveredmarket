# Covered — covered calls on native Bitcoin, no custodian

A holder's coins stay at a Bitcoin address only the NEAR contract `covered.near` can sign for (Chain Signatures).
A buyer pays the premium in USDC on NEAR. In the two-hour window after expiry the buyer may pay the strike;
then the contract signs the coins to the buyer. Otherwise anyone can settle and the contract signs them back.
Spec: *Covered — Product & Technical Specification* (project doc). Brand and screens: the Covered design system and canvas.

```
contracts/covered/        the contract (Rust, near-sdk 5.30, rust-bitcoin, k256)  ── L0 tests: cargo test -p covered
contracts/mock-signer/    v1.signer stand-in with a known root scalar               ── L1 only
contracts/mock-btc-client/ light-client stand-in                                     ── L1 only
integration/              near-workspaces sandbox flows                             ── make e2e
relayer/                  proofs, settlement timer, broadcast, NEP-366 relay, spot  ── npm test
web/                      the app: market, sell, deposit, contracts, certificate+Verify, buy, try
scripts/                  regtest round trip, txoutproof converter, testnet deploy
docs/build-log/           transcripts per level
```

## Status (5 Nov 2026)

| Level | What | State |
| --- | --- | --- |
| L0 | contract state machine, BIP-143, derivation, signature acceptance, accounting; 28 tests | **green** (`cargo test -p covered`) |
| L0 | relayer proof builder (real block-170 fixture), relay policy, watcher; 10 tests | **green** (`cd relayer && npm test`) |
| L0 | browser derivation + BIP-143 + seven Verify checks, cross-checked against contract vectors; 8 tests | **green** (`cd web && npm test`) |
| L1 | sandbox flows with mocks (`integration/tests/flow.rs`) | written, compiles; needs `wasm32` std + near-sandbox (both fetched from hosts this build box cannot reach) |
| L1b | regtest round trip (`scripts/regtest.sh`) | written; needs bitcoind |
| L2–L5 | testnet, Intents, mainnet, demo | not started; `scripts/deploy-testnet.sh` is the entry point |

## Invariants to read first (`contracts/covered/src/lib.rs`, `commit_and_sign` and `accept_signature`)
1. A commitment (recipient script, unsigned tx, sighash, txid) is written once, before the first `sign`, and never replaced; retries re-request the same sighash.
2. The committed tx spends exactly the collateral outpoint to exactly one output: the seller's refund script, or the buyer's script only when `reason == Exercise`.
3. A signature is accepted only if it verifies against the derived key for the committed sighash.
4. USDC enters only via `ft_on_transfer` from the pinned token with `sender_id` as the acting party; it leaves only via `claim` / `reclaim_strike` to the owner of the balance. `get_accounting()` must equal the token balance.

## Run
```
cargo test -p covered                 # L0
cd relayer && npm i && npm test       # relayer units
cd web && npm i && npm test && npm run build
make build && make e2e                # L1 (needs wasm32 target, near-sandbox, integration/fixtures/fungible_token.wasm)
```
Relayer env: `NEAR_NETWORK NEAR_RPC RELAYER_ID RELAYER_KEY COVERED_ID USDC_ID ESPLORA PORT`.
Web env (`.env`): `VITE_NEAR_NETWORK VITE_NEAR_RPC VITE_COVERED_ID VITE_USDC_ID VITE_ESPLORA VITE_SIGNER_ID VITE_LIGHT_CLIENT_ID VITE_CODE_HASH VITE_MIN_CONF`.

## Pinned external interfaces (confirm on day 1 — spec open questions 1–2)
- `v1.signer` / `v1.signer-prod.testnet`: `sign` args format selectable at init (`sign_format` 1 or 2); response `{big_r:{affine_point}, s:{scalar}, recovery_id}`; derivation prefix is a param.
- Light client: `verify_transaction_inclusion(tx_id, tx_block_blockhash, tx_index, merkle_proof, confirmations) -> bool` (Near-One `btc-light-client-contract` argument names; the newer coinbase-proof variant is not yet wired).
- USDC: Circle's NEAR USDC, 6 decimals; set per network in `params.usdc`.

Unaudited. Not a price guarantee. The MPC threshold, the light client's honesty and our own code are the trust assumptions; the app says so on every page.
