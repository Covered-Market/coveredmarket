# Covered — covered calls on native Bitcoin, no custodian

A Bitcoin holder sells a call. The coins stay at a Bitcoin address only the NEAR contract can sign for (Chain Signatures). The buyer pays the premium in USDC on NEAR. In the window after expiry the buyer may pay the strike; then the contract signs the coins to the buyer. Otherwise anyone can settle and the contract signs them back. Full specification: [docs/SPEC.md](docs/SPEC.md).

| | |
|---|---|
| Contract | `contracts/covered` — Rust, near-sdk 5.30, rust-bitcoin, k256 |
| Relayer | `relayer` — TypeScript: Bitcoin proofs, settlement timer, broadcast, NEP-366 gas relay, reference price |
| Web | `web` — Vite/React on the Covered design system; certificate page with the seven **Verify** checks |
| Brand | `brand` — tokens, component library, logos, patterns, fonts, brand book, generators |
| Infra | `infra` — Docker Compose (one VM), Terraform (DigitalOcean + DNS), cloud-init, GitHub Actions |
| CLI | `bin/covered` — the one entry point for local, tests and cloud |

## Quick start

### Prerequisites
- Docker 24+ with Compose v2 (that is all for the local stack)
- For tests on the host: Rust 1.85+, Node 22
- For `build`/`e2e` on the host: `rustup target add wasm32-unknown-unknown` and cargo-near (`curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.sh | sh`)
- For the cloud: Terraform 1.6+, a DigitalOcean account, a domain

### Run everything locally — one command
```
bin/covered up
```
That builds and starts, in containers: a NEAR sandbox (one validator, fast blocks), a Bitcoin regtest node, the four contracts compiled to wasm, a bootstrap that deploys `covered`, a mock signer (same interface and derivation as `v1.signer`), a mock light client and a mock USDC, creates `relayer.test.near` and two demo users with 1,000,000 USDC each, funds a regtest miner, then the relayer and the web app. Open **http://localhost**.

```
bin/covered keys                 # astrid.test.near / marcus.test.near and their keys
bin/covered btc send <addr> 0.01 # pay a deposit address on regtest and mine a block
bin/covered btc mine 6           # confirmations
bin/covered logs relayer         # watch proofs, settlement, broadcasts
bin/covered reset                # wipe chain state and start over
```

The full life of a contract on the local stack:
1. In the app create a wallet (an account under `test.near`, funded by the bootstrap; the relayer pays gas).
2. **Sell a call**: size ≥ 0.001 BTC, strike above the fixed reference price ($97,420), expiry "tomorrow" (`min_lead` is 60 s locally; the UI's shortest preset is the next 08:00 UTC — set `expiry` by hand in a `near call` if you want it sooner).
3. Pay the deposit address with `bin/covered btc send <address> <size>`. Within one relayer tick the proof is submitted and the offer is **Funded**.
4. In a second browser profile create `marcus`, open the market, buy.
5. After expiry: exercise from Marcus's contract page (pays the strike), or wait out the 10-minute window and press **Settle** (or let the relayer do it).
6. The relayer broadcasts the signed transaction, mines are yours (`btc mine 1`), and `confirm_spend` finalises. Press **Verify** on the certificate: seven checks against the sandbox RPC and the regtest node.

Local parameters (set in `infra/local/bootstrap/bootstrap.ts`): `min_conf 1`, `fee_sats 1000`, `grace 600 s`, `buy_cutoff 0`, `min_lead 60 s`, `escrow_timeout 3600 s`.

### Tests
```
bin/covered test        # L0: contract (30), relayer (14), web (9) — no chain needed
bin/covered e2e         # L1: builds wasm and runs the sandbox flows in integration/tests/flow.rs
bin/covered up && bin/covered e2e-stack
                        # L1+: the whole product on the composed stack, see below
```
`e2e-stack` (`e2e/run.mjs`) drives two contracts through their entire life on the running stack — NEAR sandbox, Bitcoin Core regtest, the relayer, the web app — with no mocks above the chain:

- **KEPT**: create offer → real regtest deposit → relayer builds the Merkle proof and gets the offer Funded → buyer pays the premium in USDC → window closes (sandbox fast-forward) → relayer settles → signer signs → relayer broadcasts → mined → relayer proves the spend → **Kept**, coins at the seller's refund address.
- **EXERCISED**: same until expiry → buyer pays the strike inside the window → relayer requests the signature → broadcast → mined → **Exercised**, coins at the buyer's address; the seller claims premiums + strike; `claimable + escrow == token balance`.
- **UI**: market, sell, deposit, contracts, try and both certificates in Chromium; **Verify** must show 7/7 verified for each. Screenshots land in `e2e/artifacts/`.

**L2 on live NEAR testnet** (`e2e/testnet.ts`, workflow `testnet.yml`, runs on `e2e/testnet*` branches and on demand): creates throwaway faucet accounts, deploys `covered` wired to the **real MPC signer**, and checks that (1) each deposit address equals what the signer's `derived_public_key` gives for the contract, (2) a withdrawal and (3) a full sell → buy → expiry → exercise → claim are signed by the **real MPC** through the contract and the signed transactions verify offline, and (4) the **real light client** accepts the relayer's proof of a real testnet3 transaction and rejects a tampered one. The deposits in (2)–(3) are proven through a mock light client, because a real deposit needs testnet BTC; everything else is the live network. Transcript and signed transactions are uploaded as the `testnet-l2` artifact.

CI: `.github/workflows/ci.yml` (unit tests, wasm, sandbox flows, images, Terraform/Compose validation) on every push and PR; `.github/workflows/stack.yml` runs `up` + `e2e-stack` on `main`, version tags and on demand, and uploads the screenshots. Deploys happen only on version tags.

### Deploy to the cloud — one command after one file
The production shape is deliberately the simplest thing: **one VM, two containers** (`web` = Caddy serving the static app with automatic TLS and proxying `/api` and `/btc`; `relayer`), plus a tiny `config` job that turns `.env` into the app's `config.json`. Bitcoin data comes from a public Esplora (mempool.space) and NEAR from a public RPC; no node of our own is needed for testnet or mainnet.

1. Buy the domain. At the registrar, point its nameservers at `ns1.digitalocean.com`, `ns2.digitalocean.com`, `ns3.digitalocean.com` (Terraform creates the zone and the A/CNAME records).
2. In DigitalOcean: create an API token and upload your laptop's SSH key (note its name).
3. Generate a deploy key for CI: `ssh-keygen -t ed25519 -f deploy_key -N ""`.
4. `cp infra/cloud/terraform.tfvars.example infra/cloud/terraform.tfvars` and fill it in: token, domain, SSH key name, repo URL, the deploy public key, and the production `.env` block (contract ids, relayer account + key, Esplora URL — see `.env.example`).
5. `bin/covered provision`. Terraform creates the droplet, DNS and firewall; cloud-init installs Docker, clones the repo, writes `/opt/covered/.env` and runs `docker compose up`. Caddy obtains the certificate as soon as DNS resolves. `terraform output url` is your site.
6. Redeploys: `bin/covered deploy` (ssh, pull, `compose up --build`), or push a version tag (`git tag v0.1.0 && git push --tags`) with repository secrets `DEPLOY_HOST` (the IP) and `DEPLOY_SSH_KEY` (the deploy private key) and CI deploys that tag. Merges to `main` only run CI; branches → PR → `main` → tag.
7. `bin/covered destroy` removes everything.

Deploying the **contract** to testnet/mainnet is a separate, deliberate step (`scripts/deploy-testnet.sh`): build, deploy with init params, then delete the full-access key on camera and put the code hash in `.env` as `CODE_HASH` so Verify check 1 can confirm it.

## Configuration
Everything is read from `.env` (local: appended by the bootstrap; cloud: written by cloud-init from `terraform.tfvars`). Keys: `MODE` (local|testnet|mainnet), `NEAR_NETWORK`, `NEAR_RPC`, `COVERED_ID`, `USDC_ID`, `SIGNER_ID`, `LIGHT_CLIENT_ID`, `RELAYER_ID`, `RELAYER_KEY`, `BTC_BACKEND` (esplora|core), `ESPLORA`, `EXPLORER_BTC`, `EXPLORER_NEAR`, `MIN_CONF`, `CODE_HASH`, `DOMAIN` (cloud only). The web app reads the same values from `/config.json` at load, so one image serves every environment.

## Layout
```
bin/covered                 CLI
contracts/covered           the contract           contracts/mock-*  sandbox stand-ins (signer, light client, USDC)
integration/                near-workspaces flows  relayer/          service + Dockerfile
web/                        app + Dockerfile       brand/            design system and assets
infra/compose.yaml          cloud stack            infra/compose.local.yaml  local overlay
infra/local/                sandbox image, contract builder image, bootstrap
infra/cloud/                Terraform + cloud-init docs/SPEC.md      the specification
scripts/                    regtest round trip, txoutproof converter, testnet contract deploy
```

## Invariants to read first (`contracts/covered/src/lib.rs`: `commit_and_sign`, `accept_signature`, `ft_on_transfer`)
1. A commitment (recipient script, unsigned tx, sighash, txid) is written once, before the first `sign`, and never replaced; retries re-request the same sighash.
2. The committed tx spends exactly the collateral outpoint to exactly one output: the seller's refund script, or the buyer's script only when `reason == Exercise`.
3. A signature is accepted only if it verifies against the derived key for the committed sighash.
4. USDC enters only via `ft_on_transfer` from the pinned token with `sender_id` as the acting party; it leaves only via `claim` / `reclaim_strike` to the owner of the balance. `get_accounting()` equals the token balance.

## Pinned external interfaces (checked against the live testnet, 5 Nov 2026)
- **Signer** `v1.signer-prod.testnet` (3.18) / `v1.signer`: `sign({request:{payload_v2:{Ecdsa:<hex>}, path, domain_id:0}})` = `sign_format 2` (the legacy `payload`/`key_version` form is `1`), 1 yoctoNEAR deposit, ≥15 Tgas (we attach 150). Response `{scheme, big_r:{affine_point}, s:{scalar}, recovery_id}`. Derivation: `derived = root + SHA3-256("near-mpc-recovery v0.1.0 epsilon derivation:" ‖ predecessor ‖ "," ‖ path)·G` — **SHA3**, not SHA-256; the live vector is a test in `derive.rs` and `crypto.test.ts`. Root key from `public_key({domain_id:0})` as `secp256k1:<base58 x‖y>`.
- **Light client** `btc-client-v4.testnet` (follows Bitcoin **testnet3**) / `btc-client.bridge.near`: `verify_transaction_inclusion_v2(ProofArgsV2) -> bool` with **borsh** arguments `{tx_id, tx_block_blockhash, tx_index: u64, merkle_proof: Vec<H256>, coinbase_tx_id, coinbase_merkle_proof, confirmations: u64}`, hashes in internal byte order. The contract (`ProofRef::borsh_args`) and the relayer (`lcArgsV2`) produce byte-identical arguments (shared test vector).
- **USDC**: Circle's NEAR USDC, 6 decimals (`17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` on mainnet). On testnet it cannot be minted, so the testnet deployment uses `mock-usdc`.

Unaudited. Not a price guarantee. The MPC threshold, the light client's honesty and our own code are the trust assumptions, and the app says so on every page.
