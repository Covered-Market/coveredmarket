# CoveredMarket — security model

The short version of what you are trusting, what the contract guarantees, and where to read the code. The full model, with the threat table (A1–A15) and who bears which loss, is in [SPEC.md § Security model](SPEC.md#security-model). To report a problem, see [SECURITY.md](../SECURITY.md).

## The one claim

Given an honest MPC threshold in `v1.signer`, a correct `coveredmarket` contract and a Bitcoin light client that follows the real chain, **a deposit can be spent only by the one transaction the contract committed for it, and that transaction pays the seller back unless the buyer paid the strike inside the exercise window.**

## What you are trusting

| You trust | If it fails |
|---|---|
| NEAR's MPC signing network (`v1.signer`) signs only for the contract that asks, and a threshold of its nodes is honest | A colluding threshold could sign any spend from any derived address. This is the assumption every Chain Signatures product makes. |
| The Bitcoin light client (`btc-client.bridge.near`, `btc-client-v4.testnet`) follows the heaviest chain | A fake deposit could be "proven". The buyer would lose the premium; there are no coins to steal. |
| Our contract code | A bug could misdirect collateral. It is unaudited, and mainnet offers are capped at 0.01 BTC. Read it. |
| NEAR runs the code as deployed | Guaranteed by the contract having no access keys and no upgrade method. Verify check 1 shows both. |

What you are **not** trusting: us. The relayer and the website only relay proofs, pay gas and broadcast transactions that are already signed. Every contract method is public, so anyone can do those jobs.

## Guarantees

- **No third-party spend.** No person, server or key outside the MPC threshold can sign for a deposit address. The operator cannot move coins.
- **Coins return.** Unsold, the seller can withdraw. Sold and not exercised, anyone can settle after the window, and the coins go back to the seller. If NEAR or the MPC network stops, the seller's own rescue key can sweep them on Bitcoin after the timelock.
- **Exercise is payment.** A delivery to the buyer is committed only in a receipt where the buyer paid at least the full strike, inside the window. The strike then sits in escrow and moves by proof: to the seller when the delivery is proven on Bitcoin (`confirm_spend`), back to the buyer when the seller's rescue spend is proven instead (`confirm_rescue`). Without either proof the buyer can reclaim it only after the seller's exit has been open for the whole escrow timeout (`unlock + escrow_timeout`), so the buyer can never take the strike back while the seller still has no way to take the coins back.
- **Exercise does not need the light client.** By default the contract re-checks the deposit's depth and refunds the strike if the light client cannot confirm it. The buyer may instead pay with `skip_depth_check`, which commits the delivery in the payment receipt; a paused or pruned light client cannot cost the buyer the option.
- **Purchase is final.** The premium is credited to the seller in the receipt that records the buyer.
- **One spend per deposit.** A settlement is committed once, before the first signature request, and never replaced.
- **Public verifiability.** Each guarantee maps to a Verify check that reads Bitcoin and NEAR directly, with no CoveredMarket server in the loop.

## Not guaranteed

- Safety against a colluding MPC threshold or a bug in `v1.signer`.
- Timely settlement if the signer, the light client or the contract's NEAR reserve stops. The coins are not stuck forever: after a timelock (30 days past the exercise window on mainnet) the seller sweeps them with a rescue key and nothing but Bitcoin. See *the seller's exit* below.
- Atomic settlement: USDC for BTC is conditional and asynchronous. The strike waits in escrow until delivery confirms.
- A price. The reference price on screen is for display; no price feed decides an outcome.
- Privacy, or an audit.

## The seven Verify checks

Every certificate page has a **Verify** button. It reads only public Bitcoin and NEAR RPCs:

1. Deployed code hash and configuration match this repository; the contract has no access keys.
2. The deposit address derives from the contract account and the offer's path on `v1.signer`, and the root key the contract derives from is the one the signer itself reports (`public_key`).
3. The deposit is included on Bitcoin and its current state is what the contract says.
4. Payment receipts add up: what the contract holds equals what it owes.
5. State transitions happened in order and at the right times.
6. The committed transaction and its signature match the rules below.
7. The settlement transaction is confirmed on Bitcoin.

## Mainnet readiness
What stands between this code and real money, and how each is handled:

| Risk | Handling | Checked by |
|---|---|---|
| Mainnet services differ from testnet | Read-only probe of `v1.signer` (3.17), `btc-client.bridge.near` and Circle USDC: our SHA3 derivation equals the signer's own `derived_public_key`; our borsh proof of a real mainnet tx is accepted, tampered and over-deep ones refused; USDC is 6 decimals and needs 0.00125 NEAR registration | `mainnet-probe.yml` (on change + weekly) |
| The real `sign` call | `selftest_sign()`: the contract has the MPC sign a constant under a reserved path and verifies it on chain. The mainnet deploy stops before locking if it fails | `e2e/testnet.ts` against `v1.signer-prod.testnet`; `scripts/deploy-mainnet.ts` |
| NEAR or the MPC network stops | **The seller's exit.** Every deposit address is P2WSH of `IF <mpc> CHECKSIG ELSE <unlock> CLTV DROP <rescue> CHECKSIG ENDIF`. After `unlock = expiry + grace + rescue_delay` (30 days on mainnet) the seller's own rescue key sweeps the coins with nothing but Bitcoin (`bin/coveredmarket rescue kit.json <address>`). The rescue key is made in the browser and saved as a kit when the offer is created. No settlement may be committed in the last half of the rescue delay | contract tests through libbitcoinconsensus (valid at unlock, invalid one second before, wrong keys refused); TS tool pinned byte for byte to the Rust reference; `e2e-stack` sweeps a real regtest deposit (refused before unlock, accepted after) |
| Bitcoin fees spike after a settlement is signed | Settlements signal RBF. `bump_fee` (anyone, after `fee_bump_after_s`) re-signs the same input to the same single recipient with double the fee, up to `max_fee_sats`; whichever version confirms settles the offer. The relayer bumps stuck settlements automatically | contract + sandbox tests (old version still settles), relayer planner tests |
| Real USDC pays only registered accounts | an account's first `claim` registers it (NEP-145 `storage_deposit`, refunded if already registered), from a 0.00125 NEAR reserve each offer keeps; paid once per account | sandbox test with a seller who never held USDC; `e2e/testnet.ts` |
| Unaudited code | Per-deployment `max_size_sats` (0.01 BTC on mainnet) | contract test |
| Reorgs | `min_conf` per network: 3 on mainnet (deposit, exercise re-check and spend proof) | `params/mainnet.json` |

Still not engineering: an audit, and the legal question of offering options to the public.

## Invariants to read first

In `contracts/coveredmarket/src/lib.rs`: `commit_and_sign`, `accept_signature`, `ft_on_transfer`.

1. A commitment (recipient script, unsigned tx, sighash, txid) is written once, before the first `sign`, and never replaced; retries re-request the same sighash.
2. The committed tx spends exactly the collateral outpoint to exactly one output: the seller's refund script, or the buyer's script only when `reason == Exercise`. A fee bump changes only the fee (within `max_fee_sats`), never the input or the recipient.
3. A signature is accepted only if it verifies against the derived key for the committed sighash.
4. USDC enters only via `ft_on_transfer` from the pinned token with `sender_id` as the acting party; it leaves only via `claim` to the owner of the balance; escrow becomes a claimable balance only through `confirm_spend` (seller), `confirm_rescue` or `reclaim_strike` (buyer). `get_accounting()` equals the token balance.

## Pinned external interfaces

Checked against the live testnet on 5 Nov 2026.

- **Signer** `v1.signer-prod.testnet` (3.18) / `v1.signer`: `sign({request:{payload_v2:{Ecdsa:<hex>}, path, domain_id:0}})` = `sign_format 2` (the legacy `payload`/`key_version` form is `1`), 1 yoctoNEAR deposit, ≥15 Tgas (we attach 150). Response `{scheme, big_r:{affine_point}, s:{scalar}, recovery_id}`. Derivation: `derived = root + SHA3-256("near-mpc-recovery v0.1.0 epsilon derivation:" ‖ predecessor ‖ "," ‖ path)·G`. **SHA3**, not SHA-256; the live vector is a test in `derive.rs` and `crypto.test.ts`. Root key from `public_key({domain_id:0})` as `secp256k1:<base58 x‖y>`.
- **Light client** `btc-client-v4.testnet` (follows Bitcoin **testnet3**) / `btc-client.bridge.near`: `verify_transaction_inclusion_v2(ProofArgsV2) -> bool` with **borsh** arguments `{tx_id, tx_block_blockhash, tx_index: u64, merkle_proof: Vec<H256>, coinbase_tx_id, coinbase_merkle_proof, confirmations: u64}`, hashes in internal byte order. The contract (`ProofRef::borsh_args`) and the relayer (`lcArgsV2`) produce byte-identical arguments (shared test vector).
- **USDC**: Circle's NEAR USDC, 6 decimals (`17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` on mainnet). On testnet it cannot be minted, so the testnet deployment uses `mock-usdc`.
