# Developing CoveredMarket

How to run the whole product on your machine, what the tests cover, and where things live. For the cloud, see [DEPLOY.md](DEPLOY.md). For the design, see [SPEC.md](SPEC.md).

## Prerequisites

- Docker 24+ with Compose v2 (that is all for the local stack)
- For tests on the host: Rust 1.85+, Node 22
- For `build`/`e2e` on the host: `rustup target add wasm32-unknown-unknown` and cargo-near (`curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/download/cargo-near-v0.23.0/cargo-near-installer.sh | sh`)
- For the cloud: Terraform 1.6+, a DigitalOcean account, a domain

## Run everything locally

```
bin/coveredmarket up
```
That builds and starts, in containers: a NEAR sandbox (one validator, fast blocks), a Bitcoin regtest node, the four contracts compiled to wasm, a bootstrap that deploys `coveredmarket`, a mock signer (same interface and derivation as `v1.signer`), a mock light client and a mock USDC, creates `relayer.test.near` and two demo users with 1,000,000 USDC each, funds a regtest miner, then the relayer and the web app. Open **http://localhost**.

```
bin/coveredmarket keys                 # astrid.test.near / marcus.test.near and their keys
bin/coveredmarket btc send <addr> 0.01 # pay a deposit address on regtest and mine a block
bin/coveredmarket btc mine 6           # confirmations
bin/coveredmarket logs relayer         # watch proofs, settlement, broadcasts
bin/coveredmarket reset                # wipe chain state and start over
```

The full life of a contract on the local stack:
1. In the app create a wallet (an account under `test.near`, funded by the bootstrap; the relayer pays gas).
2. **Sell a call**: size ≥ 0.001 BTC, strike above the fixed reference price ($97,420), expiry "tomorrow" (`min_lead` is 60 s locally; the UI's shortest preset is the next 08:00 UTC — set `expiry` by hand in a `near call` if you want it sooner).
3. Pay the deposit address with `bin/coveredmarket btc send <address> <size>`. Within one relayer tick the proof is submitted and the offer is **Funded**.
4. In a second browser profile create `marcus`, open the market, buy.
5. After expiry: exercise from Marcus's contract page (pays the strike), or wait out the 10-minute window and press **Settle** (or let the relayer do it).
6. The relayer broadcasts the signed transaction, mines are yours (`btc mine 1`), and `confirm_spend` finalises. Press **Verify** on the certificate: seven checks against the sandbox RPC and the regtest node.

Local parameters (set in `infra/local/bootstrap/bootstrap.ts`): `min_conf 1`, `fee_sats 1000`, `grace 600 s`, `buy_cutoff 0`, `min_lead 60 s`, `escrow_timeout 3600 s`.

## Tests

```
bin/coveredmarket test        # L0: contract, relayer, web and agent unit tests — no chain needed
bin/coveredmarket e2e         # L1: builds wasm and runs the sandbox flows in integration/tests/flow.rs
bin/coveredmarket up && bin/coveredmarket e2e-stack
                        # L1+: the whole product on the composed stack, see below
```
`e2e-stack` (`e2e/run.mjs`) drives two contracts through their entire life on the running stack — NEAR sandbox, Bitcoin Core regtest, the relayer, the web app — with no mocks above the chain:

- **KEPT**: create offer → real regtest deposit → relayer builds the Merkle proof and gets the offer Funded → buyer pays the premium in USDC → window closes (sandbox fast-forward) → relayer settles → signer signs → relayer broadcasts → mined → relayer proves the spend → **Kept**, coins at the seller's refund address.
- **EXERCISED**: same until expiry → buyer pays the strike inside the window → relayer requests the signature → broadcast → mined → **Exercised**, coins at the buyer's address; the seller claims premiums + strike; `claimable + escrow == token balance`.
- **UI**: market, sell, deposit, contracts, try and both certificates in Chromium; **Verify** must show 7/7 verified for each. Screenshots land in `e2e/artifacts/`.
- **Agent toolkit** (`e2e/agent.mjs`): `bin/coveredmarket agent` and `bin/coveredmarket mcp` as an agent runs them, with wallets made on first use: the read-only checks below, then an offer sold from the CLI (rescue kit written), deposited by the demo faucet, bought over MCP (a second buy is refused), and the premium claimed from the CLI.

**Agent toolkit on the deployed app** (`e2e/agent-smoke.mjs`, workflow `agent-smoke.yml`, every 3 hours and after each deploy): read-only. `params`, `offers`, one offer and a refused call through the CLI, then the tool list and the same reads over MCP. It makes no wallet and spends nothing. `SITE=https://testnet.example.com node e2e/agent-smoke.mjs` runs it by hand.

**L2 on live NEAR testnet** (`e2e/testnet.ts`, workflow `testnet.yml`, runs on `e2e/testnet*` branches and on demand): creates throwaway faucet accounts, deploys `coveredmarket` wired to the **real MPC signer**, and checks that (1) each deposit address equals what the signer's `derived_public_key` gives for the contract, (2) a withdrawal and (3) a full sell → buy → expiry → exercise → claim are signed by the **real MPC** through the contract and the signed transactions verify offline, and (4) the **real light client** accepts the relayer's proof of a real testnet3 transaction and rejects a tampered one. The deposits in (2)–(3) are proven through a mock light client, because a real deposit needs testnet BTC; everything else is the live network. Transcript and signed transactions are uploaded as the `testnet-l2` artifact.

CI: `.github/workflows/ci.yml` (unit tests, wasm, sandbox flows, images, Terraform/Compose validation) on every push and PR; `.github/workflows/stack.yml` runs `up` + `e2e-stack` on x86-64 and arm64 on every pull request (except docs-only changes), on `development`, version tags and on demand, and uploads the screenshots. Deploys happen only on version tags.

## Configuration

Everything is read from `.env` (local: written by the bootstrap; cloud: written by the testnet bootstrap on first start, or supplied as `env_file`). Keys: `MODE` (local|testnet|mainnet), `ACCOUNT_FAUCET`/`USDC_MINT` (testnet account and test-funds faucet; `TEST_FUNDS_PER_HOUR`, `TEST_FUNDS_PER_DAY` set its limits), `NEAR_NETWORK`, `NEAR_RPC`, `COVERED_ID`, `USDC_ID`, `SIGNER_ID`, `LIGHT_CLIENT_ID`, `RELAYER_ID`, `RELAYER_KEY`, `BTC_BACKEND` (esplora|core), `ESPLORA`, `EXPLORER_BTC`, `EXPLORER_NEAR`, `MIN_CONF`, `CODE_HASH`, `DOMAIN` (cloud only). The web app reads the same values from `/config.json` at load, so one image serves every environment.

## Layout

```
bin/coveredmarket                 CLI
contracts/coveredmarket           the contract           contracts/mock-*  sandbox stand-ins (signer, light client, USDC)
integration/                near-workspaces flows  relayer/          service + Dockerfile
web/                        app + Dockerfile       brand/            design system and assets
agent/                      SDK, JSON CLI and MCP server for agents (testnet/local), see agent/README.md
infra/compose.yaml          cloud stack            infra/compose.local.yaml  local overlay
infra/local/                sandbox image, contract builder image, bootstrap
infra/cloud/                Terraform, cloud-init, testnet first-start bootstrap   infra/compose.testnet.yaml  its overlay
docs/                       SPEC, SECURITY-MODEL, DEVELOPING, DEPLOY; readme/ holds README images
params/                     per-network contract parameters (local, testnet, mainnet)
scripts/                    regtest round trip, txoutproof converter, mainnet deploy, readme/ image builder
```
