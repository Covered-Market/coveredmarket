# Deploying CoveredMarket

One VM, two containers, a real TLS certificate, and on testnet a contract that deploys and locks itself on first start. For running locally, see [DEVELOPING.md](DEVELOPING.md).

## The shape

The production shape is deliberately the simplest thing: **one VM, two containers** (`web` = Caddy serving the static app with automatic TLS and proxying `/api` and `/btc`; `relayer`), plus a tiny `config` job that turns `.env` into the app's `config.json`. Bitcoin data comes from a public Esplora (mempool.space) and NEAR from a public RPC (FastNEAR); no node of our own.

## What you need

A DigitalOcean API token and a deploy key. **No domain needed** — without one the site is served at `https://<ip-with-dashes>.sslip.io` with a real certificate. **No contract setup needed on testnet** — on its first start the VM creates throwaway faucet accounts, builds the wasm, deploys `coveredmarket` against the real MPC signer (`v1.signer-prod.testnet`) and the real Bitcoin light client (`btc-client-v4.testnet`, Bitcoin testnet3), deploys a mock USDC anyone can mint, **deletes the contract's only key**, and writes everything (ids, relayer key, code hash) into the VM's `.env`. Visitors connect their own testnet wallet and get 100,000 test USDC and 0.5 tNEAR from `/api/test-funds` (rate-limited per address, per account and per day). `/api/account` (named accounts via the faucet helper) stays for `e2e/live.ts`.

## Deploy

From GitHub (nothing to install):
```
ssh-keygen -t ed25519 -f deploy_key -N ""
gh secret set DO_TOKEN                      # paste the DigitalOcean token
gh secret set DEPLOY_SSH_KEY < deploy_key
gh workflow run cloud.yml -f action=apply   # ~15 min the first time (wasm build on the VM); the URL is in the run summary
```
From your laptop (Terraform 1.6+): `cp infra/cloud/terraform.tfvars.example infra/cloud/terraform.tfvars`, fill in `do_token` and `deploy_pubkey`, then `bin/coveredmarket provision`.

## Run it

- **Redeploy:** `gh workflow run cloud.yml -f action=deploy`, push a tag `v*`, or `bin/coveredmarket deploy` — ships the committed tree over ssh (`git archive`, so the repo can stay private) and runs `bin/coveredmarket serve` on the VM. The VM's `.env`, and so the deployed contract, is kept.
- **Two networks, one VM:** the primary site (testnet) is on the domain itself, mainnet on `mainnet.<domain>` (`terraform output mainnet_url`). Each has its own contract, relayer and Bitcoin data source; a gold band marks every non-mainnet page and a switch in the header jumps between the two sites. Mainnet shows "not live yet" until `/opt/covered/.env.mainnet` names a contract (`MODE=mainnet`, `NEAR_NETWORK=mainnet`, `COVERED_ID`, `USDC_ID`, `SIGNER_ID=v1.signer`, `LIGHT_CLIENT_ID=btc-client.bridge.near`, `RELAYER_ID`/`RELAYER_KEY`, `ESPLORA=https://mempool.space/api,https://blockstream.info/api`, `EXPLORER_BTC=https://mempool.space`, `EXPLORER_NEAR=https://nearblocks.io`); the next deploy then starts its relayer.
- **Wallets:** "Connect wallet" uses NEAR Connect (`@hot-labs/near-connect`: HOT, Meteor, Intear, MyNearWallet, OKX, Nightly, …). Wallets that sign NEP-366 delegate actions go through the relayer and need no NEAR; others send the transaction themselves. Connect is the only wallet a person sees, on every network. Any account works, named or implicit; on testnet a connected account is funded automatically once, and *Get test funds* on the Try page tops it up. NEAR Connect already lists only wallets that support the site's network. For automated testing, `?testwallet=<role>` on testnet uses a hidden in-browser key (see the README); the same image serves mainnet, so the guard is at runtime: the web app refuses browser-held keys there and the relayer has no test-funds endpoint. The local sandbox keeps an in-browser account form, since no wallet knows the sandbox.
- **Paying a deposit:** QR / address as before, plus one-click buttons for Bitcoin browser wallets that are installed (UniSat, OKX, Leather, Xverse), and on testnet **"Send it from the demo faucet"**: the relayer holds a testnet3 key (generated on first start in the `relayer_data` volume; address at `GET /api/btc-faucet`) and pays the exact deposit of one of our own offers, at most `BTC_FAUCET_MAX_SATS` (0.002 BTC), 3 per IP per hour, 40 per day. Refill it from any testnet3 faucet. Locally the regtest miner plays the faucet. Never enabled on mainnet.
- **Bitcoin data:** `ESPLORA` takes a comma-separated list of Esplora-compatible providers; the relayer and the app use the first that answers and move on when one is down, rate-limited or failing. Nothing they say is trusted — every claim reaches the contract as a proof the light client checks.
- **Add or change the domain later:** point its nameservers at `ns1/ns2/ns3.digitalocean.com`, then `gh workflow run cloud.yml -f action=apply -f domain=example.com` (or set `domain` in tfvars and `bin/coveredmarket provision`). Terraform only adds the DNS zone and records — the VM is kept (`ignore_changes`) — and the deploy step restarts Caddy on the new name, which fetches a certificate as soon as DNS resolves. Old sslip.io links stop working; nothing else changes.
- **Fresh contracts:** delete `COVERED_ID` from `/opt/covered/.env` on the VM and redeploy.
- **Tear down:** `gh workflow run cloud.yml -f action=destroy` or `bin/coveredmarket destroy`.

## State and rehearsal

CI keeps the Terraform state as the `tfstate` artifact of the `cloud` workflow (no secrets in it). Use either the workflow or your laptop for a given deployment, not both. `testnet.yml`'s `cloud-rehearsal` job runs the VM's exact start-up (`bin/coveredmarket serve`) on a clean runner against live testnet and creates a visitor wallet through it.

## The contract

Testnet: the VM deploys and locks its own on first start (above); `gh workflow run cloud.yml -f action=reset-contract` swaps in a fresh one after a contract change (the demo faucet's key and coins are kept). Mainnet: `scripts/deploy-mainnet.ts` with a funded account — read-only preflight, deploy with the reviewed `params/mainnet.json`, **`selftest_sign` against the real MPC before anything is locked** (it stops with the key still present if the signature does not verify), then delete the key and write `.env.mainnet`. Parameters for every network live in `params/{local,testnet,mainnet}.json`; every deployer and the sandbox tests read them.
