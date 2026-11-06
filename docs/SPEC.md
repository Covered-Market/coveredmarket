# Covered — Product & Technical Specification

Nov 5, 2026 · @Bedeho

## Summary

Covered lets a Bitcoin holder sell a covered call on coins that never leave Bitcoin: the coins sit at a Bitcoin address only a NEAR smart contract can sign for, a buyer pays the premium from any chain, and at expiry the contract signs the coins back to the holder (KEPT) or to the buyer once the buyer has paid the strike (EXERCISED). There is no custodian, no wrapped BTC, no bridge contract holding funds, and no admin key after deploy.

The product exists because the alternative today is Deribit, Binance or OKX: the holder hands coins to an exchange to earn 10–20% annualised on a position they could otherwise hold in cold storage. Covered keeps the yield and removes the counterparty.

What makes it possible is one NEAR primitive: **Chain Signatures** (`v1.signer`), which gives a NEAR contract a deterministic secp256k1 key per `(contract, path)` and signs arbitrary hashes with it only when that contract asks. Around it: the **Bitcoin light client on NEAR** (Near-One's `btc-light-client-contract`) proves deposits; **NEAR Intents (1Click)** moves premium and strike across chains; **meta-transactions** mean neither party needs NEAR for gas.

Claims an engineer should try to falsify, in the order they matter:

1. No account other than `covered.near` can obtain a signature that spends the collateral outpoint; a signature obtained by another account for the same path string is for a different key and cannot spend it (section 9, A1).
2. The contract commits the spend (recipient script, unsigned transaction, sighash) to state before it ever asks for a signature, and from then on only ever requests that one sighash for that outpoint. It never authorises two conflicting spends (section 6).
3. A deposit is accepted only with an inclusion proof against a header the light client holds at depth ≥ 6, and collateral depth is re-checked before a strike is accepted (section 7).
4. Exercise never depends on a price feed: the buyer exercises by paying the strike inside the window `[expiry, expiry + 2h)` measured by NEAR block time. A reference price is displayed and never changes eligibility (section 8).
5. Premium and strike are pull payments: USDC is credited to a per-account claimable balance inside the receipt that accepts it, and the strike is held until the buyer’s Bitcoin transaction is confirmed or a 7-day timeout refunds it (section 8).

Scope of this version: one product, a European covered call with a two-hour exercise window after expiry, cash strike in USDC on NEAR, physical delivery of BTC; P2WPKH deposit and settlement; premium and strike paid as direct NEAR USDC transfers (cross-chain funding of the buyer’s NEAR account via 1Click is a convenience in front of that, not a protocol step); seller paid on NEAR. Mandatory result is the full flow on NEAR testnet + Bitcoin testnet4; mainnet with 0.001 BTC per contract and strikes under $50 only if every gate in section 12 passes. Everything under non-goals in section 3 is deliberately out. Bitcoin DLC-based options (Atomic Finance, 10101) are the nearest prior art; section 11 says what differs.

## Problem and use cases

The problem is narrow and real: long-term Bitcoin holders have an asset that pays nothing, and the only way to earn option premium on it is to give the coins to an exchange. Covered calls are the most conservative options strategy there is (the seller caps upside, never adds downside beyond holding), yet on-chain they do not exist for native Bitcoin.

| Actor | Who they are | Today | Why today is worse | What Covered gives them |
| --- | --- | --- | --- | --- |
| **Holder / seller** (Astrid) | Owns BTC in self-custody, wants income, will not hand coins to an exchange | Deribit, OKX, Binance covered-call products, or nothing | Full custodial counterparty risk on 100% of the position to earn 10–20% a year; KYC; withdrawal limits; exchange insolvency history | Coins stay on Bitcoin at an address only the contract can sign for; premium arrives in any asset on any chain |
| **Buyer** (Marcus) | Trader or fund that wants leveraged upside for a fixed premium | Same exchanges, or OTC desks | Must hold margin on the exchange; the seller’s collateral is an exchange IOU, not coins; OTC needs trust and settlement risk | Sees the exact UTXO backing the call before paying; pays from Solana, Base or anywhere Intents reaches; exercise is a payment, not a request |
| **Market maker** | Sells many calls across strikes and expiries | Exchange order books | Capital must sit on the exchange; cannot run a book from cold storage | One deposit address per contract, batched settlement, no capital on a venue |
| **Verifier / judge / auditor** | Anyone who wants to check a claim | Trust the exchange’s statement | Nothing to verify; proof of reserves is periodic and voluntary | Every step is on a public chain and the `Verify` page recomputes it in the browser (section 4) |

### Use case 1 — sell a call and keep the coins (primary path)

1. Astrid picks size 2.00000000 BTC, strike $150,000, expiry 25 Dec 2026 08:00 UTC, premium $6,000.
2. The contract derives a deposit address for `(astrid.near, CV-0037)`; she sends 2 BTC from her own wallet.
3. The relayer submits the Bitcoin inclusion proof; the contract marks the offer `Funded` and lists it.
4. Marcus, from his NEAR account (funded from Solana through 1Click if he likes), sends $6,000 USDC to the contract with `msg = {serial, btc_address}`. In that same receipt the contract records him as buyer and credits $6,000 to Astrid’s claimable balance. The purchase is final at that moment; she claims whenever she wants.
5. At expiry Bitcoin is $131,200 (below strike). Marcus does nothing during the two-hour window. After it closes, anyone calls `settle`; the contract commits the return transaction, requests the signature, and the coins go back to Astrid’s own address.

### Use case 2 — exercise

Same as above until expiry. At 08:00 UTC Bitcoin is $168,000. Within the window Marcus sends $300,000 USDC to the contract with `msg = {serial, exercise: true}` from the same NEAR account that bought. The contract re-checks that the collateral is still at depth ≥ 6, moves to `StrikePaid`, holds the strike in escrow, commits the delivery transaction to his Bitcoin address and requests the signature. When `confirm_spend` proves the Bitcoin transaction, the strike is released to Astrid’s claimable balance. If no confirmation arrives within 7 days, Marcus can reclaim the strike.

### Use case 3 — nobody buys

Astrid lists at $6,000; no buyer appears. In `Funded` she may call `withdraw` at any time and the contract signs the coins back to her, less the Bitcoin fee.

### Use case 4 — the operator misbehaves

Covered’s server is down, malicious or seized. Nothing changes: settlement can be triggered by anyone, the Bitcoin transaction can be broadcast by anyone, and the MPC answers only `covered.near`. The only loss is convenience (the relayer normally submits proofs and pays gas). The operator page in the design canvas records this being tried and refused.

### Use case 5 — the judge tries it

Six-minute flow on NEAR testnet + Bitcoin testnet4 with a 10-minute expiry, funded by a faucet. The point is that the judge sees a real Bitcoin transaction signed by a contract, not a video of one.

## Requirements

Each requirement has an id so tests (section 13) can cite it. MUST items are needed for the demo to be honest; SHOULD items are built if time allows; non-goals are out even if they look easy.

### Functional

| Id | Requirement | Level |
| --- | --- | --- |
| F1 | A seller can create an offer `(size_sats, strike_usdc_units, expiry_unix, premium_usdc_units, refund_btc_script)` and receive a unique P2WPKH deposit address derived by the contract | MUST |
| F2 | The contract accepts a deposit only with a valid inclusion proof for a transaction with one output paying exactly `size_sats` to the derived script, at ≥ `min_conf` confirmations on the light client; the collateral outpoint is recorded | MUST |
| F3 | A funded, unsold offer can be withdrawn by the seller; the contract commits and signs a return transaction to the refund script | MUST |
| F4 | A buyer purchases by `usdc.ft_transfer_call(covered.near, premium, msg{serial, btc_script})` from their own NEAR account; in that receipt the contract records `buyer = sender`, credits the premium to the seller’s claimable balance and refunds any excess. The sale is final when the receipt succeeds | MUST |
| F5 | Inside `[expiry, expiry + grace)` by block timestamp, the buyer exercises by `ft_transfer_call` of `strike_total` from the buyer account with `msg{serial, exercise}`; the contract re-verifies collateral depth, escrows the strike, commits and signs delivery to the buyer’s script | MUST |
| F6 | At or after `expiry + grace`, anyone can call `settle(serial)`; if not exercised the contract commits and signs the return transaction to the seller | MUST |
| F7 | Every spend the contract authorises is committed to state (recipient script, unsigned tx, sighash) before the first signature request, and only that sighash is ever requested for that outpoint | MUST |
| F8 | The signed transaction hex is readable by anyone via `get_signed_tx(serial)`; `confirm_spend(serial, proof)` finalises the contract and releases escrow | MUST |
| F9 | `claim()` pays out an account’s claimable USDC; `reclaim_strike(serial)` refunds the buyer after `escrow_timeout` without a confirmed spend | MUST |
| F10 | A public page per contract shows the certificate and `Verify`, seven checks against public RPCs each reporting verified / failed / unavailable | MUST |
| F11 | The buyer’s frontend offers 1Click to fund the buyer’s NEAR account with USDC from Solana or Base before paying | SHOULD |
| F12 | A reference settlement price (median of five public tickers at expiry) is displayed on the certificate; it never affects state | SHOULD |
| F13 | Meta-transactions via a relayer so sellers and buyers need no NEAR balance for `create_offer`, `claim` and `ft_transfer_call` | SHOULD |
| F14 | `recover(serial, proof)` returns a non-matching deposit to the seller, only while `Created` or after the contract is final | SHOULD |
| F15 | P2WSH deposit script `MPC key OR (seller key after CSV expiry + 7 days)` so the seller has a Bitcoin-native exit if NEAR or the MPC stops | COULD (stretch, section 12 L3) |
| F16 | Cross-chain seller payout via 1Click from the seller’s own NEAR account after `claim` (frontend convenience) | COULD |

### Non-functional

| Id | Requirement |
| --- | --- |
| N1 | No full-access key on `covered.near` after deployment; the code contains no upgrade, pause, owner or key-adding method, and the reproducible code hash is published |
| N2 | USDC held by the contract is exactly the sum of claimable balances plus strikes in escrow; an accounting view exposes both and `Verify` checks it against the token balance |
| N3 | All amounts are integers: satoshis, USDC smallest units (6 decimals). Checked arithmetic everywhere; no floats in the crate |
| N4 | Every state transition emits a NEP-297 event; the indexer is built from events; `Verify` reads state, not events |
| N5 | Settlement cannot be blocked by any single party: `settle` is permissionless and the signature request is retried with the same committed sighash if the MPC times out |
| N6 | Gas: every method fits in 300 Tgas including the cross-contract calls |
| N7 | The frontend works without the operator’s backend for reading state (direct RPC) |
| N8 | The whole flow runs on NEAR sandbox + Bitcoin regtest with a mocked signer in CI |
| N9 | No state change happens in a callback that could not also be reached by a direct call with the same guards; callbacks only record results of the one promise they belong to (`#[private]`) |

### Non-goals for 14 November

- Puts, American-style exercise, cash settlement, partial fills, order books, margin, bids.
- Price-triggered settlement of any kind. The reference price is display only.
- Payment delivery into the contract by an intermediary (1Click `customRecipientMsg`, solver-originated `ft_transfer_call`). The contract only accepts payments whose `sender_id` is the buyer.
- Cross-chain seller payouts inside the protocol. The seller claims USDC on NEAR and may swap it onward themselves.
- Any token other than Circle’s USDC on NEAR (`17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`, 6 decimals; testnet: `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`, to be confirmed on day 1).
- Taproot or multisig deposit scripts in the MUST set; the CSV exit (F15) is the only stretch.
- Confidential terms. Confidential Intents is mainnet-only; named in the pitch as an extension.
- Fee bumping of settlement transactions; the fee parameter is immutable and set generously.
- Mobile app; the phone screen is the responsive web app.
- An audit. The docs and the demo say so.

## Product specification

The app is one web frontend with three roles decided by wallet, plus a public layer that needs no wallet. High-fidelity screens are on the [design canvas](https://claude.ai/artifact/4az4t9r5WgTNMnXLEpy5ES); components and tokens come from the [Covered design system](https://claude.ai/artifact/1gormfHod4MU3fRZuTRF2m). The spec below is what each screen must do, not how it looks.

### Routes and screens

| Route | Role | Shows | Actions | Reads from |
| --- | --- | --- | --- | --- |
| `/market` | anyone | All offers in `Funded`; spot, total BTC at rest, 30-day premium | Open an offer | indexer, falls back to `get_offers` view |
| `/sell` | seller | Terms form: size, strike, expiry (fixed Fridays 08:00 UTC), premium; live annualised yield and both outcomes in words | `create_offer` (meta-tx) | spot from indexer |
| `/sell/deposit/:serial` | seller | Derived address, QR, exact amount, proof progress (mempool → 1 conf → 6 conf → proven) | Copy, open in wallet; `List the offer` enabled when `Funded` | contract `get_offer`, mempool.space API |
| `/sell/listed/:serial` | seller | Certificate (status pending), payout routing, bids | Change payout route, accept bid, `withdraw` | contract |
| `/contracts` | seller or buyer | PositionsTable of own contracts, filters by status | Open | indexer |
| `/c/:serial` | anyone | Certificate, countdown, timeline, Verify | Verify, print, share; role-specific buttons when a wallet matches seller or buyer | contract + public RPCs |
| `/c/:serial` as buyer | buyer | Spot slider “if Bitcoin were at…”, Exercise button active when `now < expiry + grace` | `exercise` via 1Click or direct `ft_transfer_call` | contract |
| `/buy/:serial` | buyer | Offer, proof the coins exist, pay-from chooser, 1Click deposit address with countdown | Pay with wallet, submit tx hash | 1Click quote + status |
| `/try` | judges | Testnet flow, faucet, what-is-live table | Start | testnet contract |
| `/ops` | operator (internal) | Relayer queue, proofs pending, MPC requests, broadcast status | Retry broadcast, re-submit proof | relayer DB |

### Contract states as the user sees them

| Contract state | Stamp word | Seller sees | Buyer sees |
| --- | --- | --- | --- |
| `Created` | pending | Deposit instructions | not listed |
| `Funded` | open (listed) | Withdraw | Buy |
| `Sold` (before expiry) | open | Countdown; premium claimable | Countdown; window opens at expiry |
| `Sold` (window open, `expiry ≤ now < expiry + grace`) | open | Waiting | Exercise now (pay strike) |
| `StrikePaid` → `Committed{to: buyer}` | exercised | Strike in escrow until delivery confirms | Coins incoming; raw tx available |
| `Committed{to: seller}` | open | Signature requested; raw tx available | Expired worthless |
| `Signed` | open / exercised | Broadcast; waiting for confirmation | same |
| `Kept` | kept | Return tx id; premium claimable | Expired worthless |
| `Exercised` | exercised | Strike and premium claimable | Bitcoin tx id |
| `Withdrawn` / `Cancelled` | settled | Return tx id | never saw it |

### Formats and copy rules (enforced in the design system, repeated here for the contract’s views)

- BTC: eight decimals wherever a user must send or will receive an exact amount (`2.00000000 BTC`, `1.99999120 BTC`); four decimals only in market lists where sizes are whole multiples of 0.0001. Satoshis in APIs. USD: two decimals with thousands separators. Percentages: one decimal.
- Dates: `25 Dec 2026, 08:00 UTC`; unix seconds in APIs. Expiry is any day at 08:00 UTC, at least 24 h after creation (demo deployments use shorter, disclosed parameters; section 12).
- Addresses and hashes: full on the certificate, in deposit instructions and in Verify; truncated `bc1q…5mdq` elsewhere.
- Outcomes are written as sentences with the figures: “If Bitcoin is above $150,000 at 08:00 UTC on 25 Dec and the buyer pays $300,000 within two hours, your 2.00000000 BTC are delivered to the buyer, less the 880-sat network fee, and you keep the $6,000.”
- Trust is named, not hidden: “Only the Covered contract can ask NEAR’s signing network to spend this address. Covered the company cannot. If the signing network stopped, settlement would stop with it.”

### Annualised yield (display only, never in the contract)

```latex
\text{annualised} = \frac{\text{premium}}{\text{size} \times \text{spot}} \times \frac{365}{\text{days to expiry}}
```

### Serials

`CV-` followed by a zero-padded counter from contract storage. Serials are the public identifier; the derivation path is `<seller_account>/<serial>`, so the same seller cannot reuse an address and two sellers cannot collide.

### The seven Verify checks

Each check reports **verified**, **failed** or **unavailable** (RPC unreachable); a page with any `unavailable` says so instead of showing green.

| # | Check | Reads | Verified when |
| --- | --- | --- | --- |
| 1 | Deployed code and configuration | NEAR `view_code` hash, `view_access_key_list`, `get_params` | code hash equals the README’s reproducible build hash; access key list empty; `params.signer`, `params.light_client`, `params.usdc` equal the published ids |
| 2 | Address derivation | `get_offer`, `v1.signer.public_key` (root) | browser derives `(covered.near, <seller>/CV-<n>)` → P2WPKH and it equals `offer.address` |
| 3 | Collateral inclusion and current status | Bitcoin RPC `gettxout`/mempool.space outspends; light client tip | deposit tx is in the main chain at depth ≥ 6 and the outpoint is unspent (before settlement) or spent by exactly the committed tx (after) |
| 4 | Payment receipts and authorisation | NEAR receipts for the `ft_transfer_call` that set `buyer`, `claimable`, `escrow` | `sender_id == offer.buyer`, amounts ≥ premium / strike, `get_accounting()` equals the USDC balance of `covered.near` |
| 5 | State transitions and timestamps | NEP-297 events with block timestamps | each transition’s guard holds for the block it happened in (window, grace, timeout) |
| 6 | Committed transaction and signature | `get_commitment(serial)`, `get_signed_tx(serial)` | browser rebuilds the unsigned tx from offer fields, its sighash equals the committed one, the witness signature verifies against the derived key |
| 7 | Bitcoin confirmation | Bitcoin RPC | the signed tx id is in the main chain, pays the committed script the committed amount |

## Architecture overview

One contract on NEAR owns the whole state machine; everything Covered itself runs sits outside the trust boundary and can be replaced by anyone running the open-source relayer.

&#91;embedded content: Covered architecture · 11 components, one trust boundary\]

The seller’s coins go straight to Bitcoin (left edge) and the buyer’s money goes straight to Solana or Base (right edge); neither passes through a Covered server. The relayer only forwards meta-transactions and Bitcoin proofs to `covered.near`, which alone can ask `v1.signer` for a signature on a path it owns and `btc-light-client` whether a deposit is real. Premium and strike reach the contract as NEP-141 transfers from `intents.near` after solvers fill the buyer’s 1Click order.

### Components

| Component | Runs where | Trust | Replaceable by |
| --- | --- | --- | --- |
| `covered.near` (Rust, near-sdk) | NEAR mainnet / `covered.testnet` | Trusted code; no owner key | Nothing; it is the product |
| `v1.signer` / `v1.signer-prod.testnet` | NEAR MPC network | Threshold of the participant set published in the contract | Nothing; NEAR-operated |
| `btc-light-client` | NEAR | Bitcoin proof-of-work plus honest relayers submitting headers | Anyone can relay headers; we run our own instance if no public one is live (section 12, L2) |
| `intents.near` + 1Click API | NEAR + chaindefuser.com | Solvers are untrusted: a fill either lands as `ft_on_transfer` or the buyer is refunded by the 1Click deadline | Direct `ft_transfer_call` of USDC on NEAR, no 1Click |
| Relayer + indexer (TypeScript, Postgres) | Covered’s server | Untrusted | Any node running the repo’s `relayer/`; the contract works without it |
| Frontend (static) | Any CDN | Untrusted; reads RPCs directly | A local build |
| Price attestation (OutLayer WASM in TDX) | OutLayer workers | Trusted only for the convenience path (section 8); never for exercise | Waiting out the grace window |

### Trust boundary, in one sentence each

- **Bitcoin consensus**: 6 confirmations before a deposit counts; a deeper reorg is the only way to fake a deposit.
- **NEAR consensus**: the contract executes as written; final after 2 blocks.
- **MPC threshold**: a colluding threshold of `v1.signer` participants could sign anything for any path. This is the largest single assumption and the demo says so.
- **Our code**: a bug in `covered.near` can lock or misdirect coins of open contracts. There is no admin fix; the mitigation is the test plan and small demo amounts.

## Infrastructure and data flows

Every piece of information has exactly one writer; everything else reads it. The table below is the contract between the pieces: if two of them disagree about a fact, the writer in this table is right and the other is a cache.

### Who writes what, who reads it

| Information | Written by | Written where | Read by | Read how |
| --- | --- | --- | --- | --- |
| Offer terms, state, serial | `covered.near` | NEAR state + NEP-297 events | Frontend, indexer, `Verify` | RPC `view` calls (`get_offer`, `get_offers`); indexer tails events |
| Derived public key / deposit address | `v1.signer` (derivation), cached by `covered.near` | NEAR state | Seller’s wallet (as a QR), `Verify` (recomputed locally) | `get_address(serial)`; browser recomputes from `(covered.near, path)` and the MPC root key |
| Bitcoin headers | Bitcoin miners; relayed by the header relayer | `btc-light-client` state | `covered.near` (inclusion), relayer (depth) | cross-contract call; `get_last_block_header` view |
| Deposit transaction and merkle proof | Seller’s wallet (tx); relayer builds the proof | Bitcoin chain; proof passed as call args | `covered.near` | `confirm_deposit(serial, proof)`; proof from a Bitcoin Core node (`gettxoutproof`) or mempool.space `/tx/:id/merkle-proof` |
| Buyer identity, buyer Bitcoin address | Buyer, inside `msg` of the USDC transfer | NEAR state via `ft_on_transfer` | `covered.near`, frontend | event `sold` |
| Premium / strike payment | Solvers via `intents.near` → `usdc.ft_transfer_call` | USDC contract balances, then forwarded | `covered.near` (callback), seller’s wallet | `ft_on_transfer`; 1Click `/v0/status` for the buyer’s progress |
| 1Click quote and deposit address | 1Click API | 1Click’s own database | Buyer’s browser only | `POST /v0/quote` directly from the browser; the relayer never sees it |
| Signature `(big_r, s, recovery_id)` | `v1.signer` MPC | Promise result into `covered.near` callback | `covered.near` | yield/resume callback; stored as `signed_tx` |
| Signed Bitcoin transaction hex | `covered.near` | NEAR state | Relayer (broadcast), anyone (`/c/:serial`) | `get_signed_tx(serial)` |
| Spend confirmation | Bitcoin chain; proof by relayer | NEAR state via `confirm_spend` | Frontend, `Verify` | event `spend_confirmed` |
| Settlement price attestation | OutLayer enclave | Passed as call arg to `settle` | `covered.near` | signature + WASM hash check; stored for display |
| Spot price on `/market` and `/sell` | Indexer (median of 5 public tickers, 60 s cache) | Indexer DB | Frontend | `GET /api/spot`; display only, never on chain |
| Mempool status (0-conf) | mempool.space | — | Frontend | WebSocket `track-address` |
| Relayer queue (proofs pending, broadcasts, retries) | Relayer | Postgres | `/ops` page | internal API |

### Operator infrastructure (what we run)

| Piece | Runs on | Needs | Secrets held |
| --- | --- | --- | --- |
| Frontend | Static hosting (Vercel/Cloudflare Pages) | NEAR RPC URL, mempool.space URL, 1Click base URL, contract ids | None |
| Relayer | One VM or container (Node 20), Postgres 15 | NEAR RPC (FastNEAR or near.org), Bitcoin Core node, mempool.space fallback | A **full-access key on `relayer.near`** (needed to sign the outer transaction of a NEP-366 meta-transaction) with a small NEAR balance; no key of any kind on `covered.near`. Direct calls (`confirm_*`, `settle`, `request_signature`) are sent from the same account |
| Header relayer (if we deploy the light client ourselves) | Same VM | Bitcoin Core node (`getblockheader`) | A function-call key on `relayer.near` scoped to our light-client instance’s `submit_blocks` |
| Indexer | Same VM | NEAR RPC polling or a NEAR Lake stream; Postgres | None |
| Bitcoin Core node | Same VM, pruned is fine for mainnet (`getblock` serves proofs while the block is retained; `gettxoutproof` needs `-txindex` or the block hash hint); testnet4 and regtest full | Disk: 10 GB pruned mainnet, 2 GB testnet4 | RPC credentials, local only |
| Meta-transaction relay | Part of the relayer | Validates each `DelegateAction`: receiver is `covered.near`, or `params.usdc` with method `ft_transfer_call` and receiver arg `covered.near`; gas cap; per-account rate limit | Same relayer key |
| Reference price | Part of the indexer; OutLayer attestation as stretch | Five exchange endpoints | None |
| Monitoring | Uptime check on relayer; alerts when the light-client tip lags by more than 3 blocks, when any contract sits in `Committed` for more than 30 minutes, or when the contract’s NEAR balance is under 1 NEAR | — | — |

If the operator disappears: the frontend keeps working from any static host; anyone can run `relayer/` with their own function-call key; the contract needs no operator at all.

### What each person needs locally

| Role | Needs | Does not need |
| --- | --- | --- |
| Seller | A browser; a Bitcoin wallet that can send to a `bc1q` address (any modern wallet); a NEAR account for identity, created in-browser with a passkey if they have none; a wallet on the chain where they want the premium (or just the NEAR account) | NEAR tokens for gas (meta-tx); a Bitcoin node; any Covered software |
| Buyer | A browser; a wallet with USDC on Solana, Base or NEAR; a Bitcoin receive address they control (only used if they exercise); a NEAR account for identity, created in-browser | NEAR for gas; to understand Intents; to trust Covered’s server |
| Verifier / judge | A browser; nothing else. `Verify` talks to public RPCs. Optionally the repo and a NEAR key to call `settle` themselves | An account anywhere |
| Judge on `/try` | A browser with a passkey; the faucet gives a testnet4 wallet (in-browser, keys shown for export) and testnet USDC | Any install |
| Developer | Rust 1.80+, `cargo-near`, Docker (regtest + sandbox), Node 20, `near-cli-rs`; a testnet account; for L2 a funded testnet4 wallet; for L4 \~0.01 BTC and \~$50 USDC on a team wallet | Mainnet access before L4 |

### Gaps still open in this inventory

- A public NEAR Lake or FastNEAR event stream for the indexer vs. plain RPC polling: polling is enough for now (one block every \~0.6 s, our event volume is tiny).
- mempool.space rate limits for the frontend’s 0-conf tracking: the free tier is enough for a demo; the relayer uses our own node.
- 1Click JWT to remove the 0.1% fee: request it on day 4 or accept the fee.

## Contract design

`covered.near` is a single Rust contract (near-sdk 5.x) with no owner. Its job is to be a state machine whose only side effects are two cross-contract calls: `verify_transaction_inclusion` on the light client and `sign` on `v1.signer`. Everything else (listing, matching, indexing) is off-chain and advisory.

### State machine

| From | Event (method, caller) | Guard | To | Side effect |
| --- | --- | --- | --- | --- |
| — | `create_offer(terms)` by seller | strike > 0, `expiry ≥ now + min_lead`, expiry at 08:00 UTC, `size_sats ≥ min_size`, premium > 0 | `Created` | serial allocated; derived key fetched via `derived_public_key` and cached in a `#[private]` callback; P2WPKH script stored |
| `Created` | `confirm_deposit(serial, proof)` by anyone | light client confirms the tx at depth ≥ `min_conf`; exactly one output pays `size_sats` to the stored script; outpoint not already recorded by any offer | `Funded` | `collateral = Outpoint{txid, vout, value}` stored; event `funded` |
| `Created` | `recover(serial, proof)` by seller | proof of a tx paying the stored script any other amount; offer not funded | `Created` (unchanged) + a `Recovery` record | a separate commitment for that outpoint to the refund script; signed; the offer itself stays `Created` |
| `Created` | `cancel(serial)` by seller | no collateral recorded | `Cancelled` | storage refunded; later deposits to the address are recoverable via `recover` on the cancelled serial |
| `Funded` | `withdraw(serial)` by seller | — | `Committed{to: seller, reason: Withdraw}` | commitment built and stored; signature requested |
| `Funded` | `ft_on_transfer(sender, amount, msg{serial, btc_script})` from USDC | `amount ≥ premium`; `now < expiry − buy_cutoff`; `btc_script` is P2WPKH or P2WSH for this network | `Sold` | `buyer = sender`, `buyer_script` stored, `claimable[seller] += premium`, excess returned. Final in this receipt |
| `Sold` | `ft_on_transfer(sender, amount, msg{serial, exercise})` from USDC | `sender == buyer`; `amount ≥ strike_total`; `expiry ≤ now < expiry + grace`; no settlement committed | `ExercisePending` | `escrow[serial] = strike_total`, excess returned; a promise re-checks collateral depth on the light client |
| `ExercisePending` | depth callback (`#[private]`) | depth ≥ `min_conf` | `Committed{to: buyer, reason: Exercise}` | commitment built; the signature is requested by anyone via `request_signature` in its own transaction (a `sign` call does not fit inside the token's call chain) |
| `ExercisePending` | depth callback | depth < `min_conf` or unavailable | `Sold` | escrow moved to `claimable[buyer]` (refund); event `exercise_refused` |
| `Sold` | `settle(serial)` by anyone | `now ≥ expiry + grace` and state is exactly `Sold` | `Committed{to: seller, reason: Expiry}` | commitment built; signature requested |
| `Committed` | `request_signature(serial)` by anyone | `now ≥ retry_after` | `Committed` | re-requests the **same** committed sighash; never rebuilds |
| `Committed` | sign callback (`#[private]`) | signature verifies against derived key for the committed sighash | `Signed` | witness assembled; `signed_tx` stored; event `signed` |
| `Committed` | sign callback failed or returned a non-verifying signature | — | `Committed` | `retry_after = now + 10 min`; nothing else changes |
| `Signed` | late or duplicate sign callback | — | `Signed` | ignored |
| `Signed` | `confirm_spend(serial, proof)` by anyone | light client confirms a tx whose id equals the committed txid | `Kept` / `Exercised` / `Withdrawn` | `Exercised`: `claimable[seller] += escrow`, escrow cleared. Final |
| `Committed{to: buyer}` or `Signed` (exercise) | `reclaim_strike(serial)` by buyer | `now ≥ committed_at + escrow_timeout` and no `confirm_spend` | same state, escrow cleared | `claimable[buyer] += escrow`. The commitment stands: if the tx later confirms the buyer has the coins and the seller has lost the strike; this is the one residual the buyer-loss table in section 9 names |

Parameters: `grace` = 2 h (the exercise window, `[expiry, expiry + grace)`), `buy_cutoff` = 1 h, `min_lead` = 24 h, `escrow_timeout` = 7 days, `min_conf` = 6. Demo deployments on testnet use `grace` = 10 min, `buy_cutoff` = 0, `min_lead` = 5 min, `min_conf` = 1 and print these on the certificate. The window exists so that no price feed decides the outcome: in the money, the buyer pays; out of the money, the buyer does nothing. The two hours are optionality the buyer gets for free and the premium should reflect it; the frontend says so. The only time that matters is the NEAR block timestamp of the receipt that executes `ft_on_transfer`, not when the buyer clicked or sent on another chain.

### Storage

```
Contract {
  next_serial: u64,
  offers: LookupMap<u64, Offer>,
  by_account: LookupMap<AccountId, Vector<u64>>,
  open: UnorderedSet<u64>,                 // Funded + Sold, for get_offers
  outpoints: LookupSet<Outpoint>,          // every outpoint ever committed; prevents double use
  claimable: LookupMap<AccountId, u128>,   // USDC owed, pull payment
  escrow_total: u128,                      // sum of Offer.escrow, for the accounting view
  recoveries: LookupMap<(u64, Outpoint), Commitment>,
  params: Params,                          // immutable after init
}
Params { signer, light_client, usdc: AccountId, network: Mainnet|Testnet4|Regtest,
         min_conf: u8, fee_sats: u64, grace_s, buy_cutoff_s, min_lead_s, escrow_timeout_s: u64,
         min_size_sats: u64, mpc_root_key: String }
Offer {
  serial: u64, seller: AccountId, buyer: Option<AccountId>,
  size_sats: u64, strike_units: u128,      // USDC units per whole BTC
  premium_units: u128, expiry_s: u64,
  path: String,                            // "<seller>/CV-<serial>"
  derived_pubkey: [u8;33], script_pubkey: Vec<u8>,
  refund_script: Vec<u8>, buyer_script: Option<Vec<u8>>,
  collateral: Option<Outpoint>,
  commitment: Option<Commitment>,          // set once, never replaced
  escrow: u128, committed_at: Option<u64>, retry_after: Option<u64>,
  state: State,
}
Commitment { to_script: Vec<u8>, amount_sats: u64, unsigned_tx: Vec<u8>, sighash: [u8;32],
             txid: [u8;32], signed_tx: Option<Vec<u8>>, reason: Withdraw|Expiry|Exercise|Recovery }
```

`strike_total = size_sats × strike_units / 100_000_000`, computed with `u128` checked arithmetic and rounded **up** to the next USDC unit, so the buyer never underpays by rounding. The transaction fee is borne by whoever receives the coins (the output is `collateral.value − fee_sats`); the strike is computed on the gross `size_sats`. Both facts are printed on the certificate.

### Methods

| Method | Kind | Gas budget | Notes |
| --- | --- | --- | --- |
| `new(params)` | init, once | — | The deployer then deletes its full-access key; the code has no method that adds keys, deploys code or changes params |
| `create_offer(terms) -> serial` | call, payable (storage) | 30 Tgas + 1 view promise | `derived_public_key(path, covered.near)` on the signer; address stored in the `#[private]` callback; offer unusable until then |
| `confirm_deposit(serial, proof)` / `confirm_spend(serial, proof)` / `recover(serial, proof)` | call | 60 Tgas + light client promise | proof per section 7; the contract parses the raw tx and computes the non-witness txid itself |
| `withdraw(serial)` / `settle(serial)` | call | 120 Tgas + sign promise | build commitment, store it, then `sign`; the callback only records the result |
| `request_signature(serial)` | call | 100 Tgas + sign promise | retry with the stored sighash |
| `ft_on_transfer(sender_id, amount, msg)` | callback from USDC | 60 Tgas (+ 30 Tgas light-client promise for exercise) | `predecessor == params.usdc`; returns unused amount; all state written before any promise |
| `claim()` | call | 30 Tgas | `usdc.ft_transfer(predecessor, claimable)`; balance zeroed first, restored in the callback on failure |
| `reclaim_strike(serial)` | call | 10 Tgas | moves escrow to `claimable[buyer]` after timeout |
| `fund()` | payable | — | anyone tops up the NEAR used for `sign` deposits |
| `get_offer`, `get_offers`, `get_commitment`, `get_signed_tx`, `get_address`, `get_accounting`, `get_params` | view | — | what the frontend and `Verify` read |

### Key derivation

The MPC root public key is fixed per network. For a NEAR account `A` and path `p`, the derived secp256k1 public key is `root + H("near-mpc-recovery v0.1.0 epsilon derivation:" || A || "," || p) · G` (the epsilon scheme used by `chainsig.js`; confirm the exact prefix string against the signer contract version at build time). The contract computes it once via the signer’s `derived_public_key` view and stores it; `Verify` recomputes it in the browser from `A = covered.near` and `p = <seller>/CV-<serial>` and must get the same address. That recomputation is what proves no one else can have the key.

### Bitcoin transaction built by the contract

One input: the collateral outpoint. One output: `collateral.value − fee_sats` to the committed script. `fee_sats` is an immutable param (plan: 1,000 sats mainnet, covering \~9 sat/vB at 110 vB; 300 sats testnet4). Sighash is BIP-143 `SIGHASH_ALL` over the collateral’s `scriptCode` and value. The MPC returns `(big_r, s, recovery_id)`; the contract verifies the signature against `derived_pubkey` for the committed sighash before accepting it, normalises `s` to low-S, DER-encodes, appends `0x01`, assembles the witness `[sig, derived_pubkey]` and stores the final hex. The txid stored in the commitment is the non-witness double-SHA256, computed before signing, so `confirm_spend` can match it. No change output, no RBF flag, `nLockTime = 0`, version 2. The recipient script may be P2WPKH or P2WSH (both 1-output shapes are 110 vB or 121 vB; `fee_sats` covers either).

### Events (NEP-297, standard `covered`, version `1.0.0`)

`offer_created`, `funded`, `sold`, `strike_paid`, `signature_requested`, `signed`, `spend_confirmed`, `cancelled`, each carrying `serial` and the fields that changed. The indexer and `Verify` consume only these.

## Bitcoin specifics

The Bitcoin side is deliberately the simplest shape that works: one P2WPKH address per contract, one UTXO in, one UTXO out, no scripts beyond a single key. Every complication below is handled by refusing it rather than supporting it.

| Topic | Decision | Why |
| --- | --- | --- |
| Address type | P2WPKH (`bc1q…`) from the compressed MPC-derived key: `OP_0 <hash160(pubkey)>`. Stretch F15: P2WSH `<mpc_key> CHECKSIG` OR `<seller_key> CHECKSIG` with `CSV expiry+7d`, giving the seller a unilateral exit | Smallest vsize, BIP-143 sighash is simple in-contract, every wallet can send to it |
| Deposit matching | The proven transaction must have exactly one output paying the stored script with `value == size_sats`; that outpoint becomes `collateral` and is added to the global `outpoints` set | A second offer can never reuse the same outpoint; overpayment and underpayment are not accepted |
| Wrong amount or extra deposits | `recover(serial, proof)` signs that specific outpoint back to `refund_script` as a separate `Recovery` commitment, allowed only while the offer is `Created`/`Cancelled` or after it is final; never while `Funded`, `Sold` or `Committed` | A recovery can never race a sale: funding and recovery are mutually exclusive by state, and a recovered outpoint is in `outpoints`, so it can never later be accepted as collateral |
| Inclusion is not “unspent” | A Merkle proof shows inclusion only. Before accepting a strike the contract re-checks depth on the light client; `Verify` check 3 additionally queries the outpoint’s spend status from a Bitcoin node | Spells out what the proof does and does not establish |
| Confirmations | `min_conf = 6` mainnet, 1 testnet/regtest; `confirm_spend` uses the same | Standard; reorg deeper than `min_conf` is the accepted residual |
| Reorgs | If the collateral tx leaves the main chain after `Funded`, a buyer who then exercises is protected by the depth re-check (refused, strike refunded). A buyer who already paid is protected by escrow: the delivery tx cannot confirm, so after `escrow_timeout` the strike is reclaimable. The premium is not protected: it was final at purchase. The light-client tip is checked for staleness (`tip_time > now − 4 h`) before any depth answer is trusted | Names who bears which loss; the buyer-loss table in section 9 |
| Fee | `fee_sats` immutable param, chosen generously at deploy (1,000 sats mainnet). The recipient bears it. If the mempool floor exceeds it the recipient can CPFP the output they own; `/c/:serial` shows the raw tx and the output index for that | No fee oracle; one policy, not two |
| Dust | `min_size_sats = 100,000`, so output after fee ≥ 99,000 sats, far above dust | Removes the edge class |
| Light client proof interface | Pinned to Near-One `btc-light-client-contract` at a tagged revision and code hash recorded in the README; proof arguments follow its `btc-types` (`tx_id`, `tx_block_blockhash`, `tx_index`, `merkle_proof`, `confirmations`, and the coinbase proof the newer method requires). The contract computes the non-witness txid from `tx_raw` (BIP-141) and passes it; it parses outputs itself | Uses the upstream interface as it is, not a guessed `(height, root)` |
| Light client trust | The upstream code has pause, upgrade and relayer-management controls and a flag that can skip PoW checks. Whichever instance we use, `Verify` check 1 shows its account, code hash and whether the skip-PoW flag is set; if we deploy it ourselves the admin key is deleted after init and the checkpoint block is published | Makes the light client an explicit trust assumption rather than an invisible one |
| Sighash | BIP-143: `hashPrevouts`, `hashSequence`, outpoint, `scriptCode = 1976a914{hash160}88ac`, value, sequence `0xffffffff`, `hashOutputs`, locktime 0, hashtype 1, double-SHA256 | Computed in-contract with `bitcoin` crate primitives (no-std) |
| Networks | `Regtest` (L1), `Testnet4` (L2–L3), `Mainnet` (L5) selected at init | Same code at every level |
| Broadcast | Relayer broadcasts to a Bitcoin Core node and mempool.space; `/c/:serial` offers “copy raw tx” | Liveness never depends on the operator |

### What the seller sees while waiting

`mempool` (0 conf, from mempool.space WebSocket) → `1–5 confirmations` → `proven on NEAR` (event `funded`). Average wait 60 minutes on mainnet; the judge flow on testnet4 uses `min_conf = 1` and the faucet, so under 15 minutes.

## Payments and settlement

Money reaches the contract in exactly one way: a NEP-141 `ft_transfer_call` of USDC on NEAR whose `msg` names the serial. Everything cross-chain is NEAR Intents delivering that transfer; the contract never knows or cares which chain the buyer started on.

### Premium

1. The buyer has USDC in their own NEAR account. If it is on Solana or Base, the frontend offers 1Click with `destinationAsset = nep141:<usdc>`, `recipientType = DESTINATION_CHAIN`, `recipient = <buyer NEAR account>`; this is a swap into the buyer’s wallet and the contract never sees it ([1Click API](https://docs.near-intents.org/near-intents/1click-api)).
2. The buyer calls `usdc.ft_transfer_call(covered.near, premium, msg = {"serial":37,"btc_script":"0014…"})` from that account (through the relayer as a meta-transaction if they hold no NEAR).
3. `covered.near.ft_on_transfer` runs inside the token contract’s receipt: checks `predecessor == params.usdc`, serial is `Funded`, `amount ≥ premium`, `now < expiry − buy_cutoff`; writes `buyer = sender_id`, `buyer_script`, `claimable[seller] += premium`; returns `amount − premium` so the token contract refunds any excess. No promise is created. The purchase is final when this receipt succeeds.
4. The seller calls `claim()` whenever they like; the contract zeroes the balance, calls `usdc.ft_transfer(seller, amount)`, and restores the balance in a `#[private]` callback if the transfer failed (for example, missing storage deposit on the token).

Why not deliver straight from Intents into the contract: `recipientType = INTENTS` credits an account inside Intents, not a NEAR contract, and `customRecipientMsg` on a withdrawal to NEAR arrives from the Intents contract, so `sender_id` would be an intermediary, not the buyer. An account name inside `msg` is not authorisation. Requiring `sender_id == buyer` for both purchase and exercise is the whole identity model, and it costs the buyer one extra click.

### Strike (exercise)

Inside the window `expiry ≤ block_timestamp < expiry + grace`, the buyer calls `ft_transfer_call(covered.near, strike_total, msg = {"serial":37,"exercise":true})` from the buyer account. `ft_on_transfer` checks `sender_id == buyer`, the window, `amount ≥ strike_total` and that no commitment exists; it sets `escrow = strike_total`, state `ExercisePending`, returns the excess, and then (as the only promise this method ever makes) asks the light client for the collateral’s current depth. The `#[private]` callback either commits delivery to `buyer_script` and requests the signature, or, if depth is insufficient or the light client is stale, moves the escrow to `claimable[buyer]` and returns the state to `Sold`. A late payment (receipt executes at or after `expiry + grace`) is refused in full by the same guard; the tokens never leave the buyer. Paying is exercising; there is no other exercise path.

### Seller payout

| What the seller receives | When it becomes claimable | How |
| --- | --- | --- |
| Premium | In the purchase receipt | `claimable[seller] += premium` |
| Strike | When `confirm_spend` proves the delivery transaction | `claimable[seller] += escrow` |
| Nothing else | — | There is no payout to any other chain inside the protocol; the seller may swap claimed USDC onward with 1Click from their own account (F16) |

The contract therefore does hold USDC: exactly `sum(claimable) + sum(escrow)`, exposed by `get_accounting()` and compared with the token balance by `Verify` check 4. It holds no USDC that belongs to nobody, and it has no `withdraw_fees`, no treasury and no method that moves USDC except `claim` and `reclaim_strike`, each to the account that owns the balance.

### Settlement without an oracle

After `expiry + grace`, `settle(serial)` is permissionless and, for an un-exercised `Sold` offer, always commits the return to the seller. Nothing about the price enters the contract. The buyer’s right is exactly the window; no third party can shorten it.

### Attested price, convenience only

The certificate shows a reference price at expiry (median of Coinbase, Kraken, Bitstamp, Binance, OKX at the expiry minute, fetched by the indexer and, as a stretch, attested by an OutLayer enclave so the number on the page is checkable). It is display only. An earlier draft let a below-strike attestation settle before the window closed; that was removed because it let a third party extinguish the buyer’s right, which is an oracle dependency however it is dressed.

### Gas and who pays it

Seller and buyer transactions can go through the relayer as NEP-366 meta-transactions: the user signs a `DelegateAction` (for example a `FunctionCall` on `usdc` or on `covered.near`), and `relayer.near` wraps it in a transaction it pays for. That needs a full-access key on `relayer.near` itself (a function-call key cannot sign a `Delegate` action); the relayer holds that key and a small NEAR balance, and nothing on `covered.near`. The relayer accepts only delegate actions whose receiver is `covered.near` or `params.usdc` with `ft_transfer_call` to `covered.near`. `settle`, `confirm_deposit`, `confirm_spend` and `request_signature` are called by the relayer on a timer and by anyone from `/c/:serial`. The NEAR attached to `sign` comes from the contract’s balance; `fund()` lets anyone top it up and `Verify` check 1 shows the balance, because an empty reserve is a liveness failure.

## Security model

The guarantee Covered makes is narrow and checkable, and it is conditional: **given an honest `v1.signer` threshold, a correct `covered.near` and a light client that tracks the real Bitcoin chain, the collateral outpoint can be spent only by the one transaction the contract committed for it, and that commitment is to the seller’s refund script unless the buyer paid the strike inside the exercise window.** Everything below is either a reason that holds or a reason it might not.

### Trust assumptions

| Assumption | What breaks if false | Residual risk accepted |
| --- | --- | --- |
| `v1.signer` only signs for `(predecessor, path)` when that predecessor calls it, and a threshold of its participants is honest | A colluding threshold can sign any spend from any derived address: total loss across all open contracts | Yes; it is NEAR’s stated model and the same assumption every Chain Signatures product makes. Stated on the certificate page |
| NEAR executes `covered.near` as deployed and the code hash never changes | Terms or signing rules could change under users | Guaranteed by deleting the full-access key; `Verify` check 2 |
| The Bitcoin light client’s main chain is the real heaviest chain at depth ≥ 6 | A fake deposit could be “proven”, selling a call backed by nothing; buyer loses the premium, nothing more (no coins to steal) | Yes; a 6-block Bitcoin reorg or a captured light client with no honest relayer |
| USDC on NEAR is the token contract we pinned | A fake token could “pay” a premium or strike | None; the contract checks `predecessor == params.usdc` |
| Intents solvers deliver or 1Click refunds by the deadline | Buyer’s money is stuck or late; no effect on coins | Buyer-side risk only, bounded by 1Click’s refund rules |
| Our contract is correct | Coins of open contracts locked or misdirected | Mitigated by section 13; not eliminated; demo amounts are small |

### Guarantees (hold under the assumptions above)

- **G1 No third-party spend.** No person, server or key outside the MPC threshold can produce a valid signature for the collateral address. The operator cannot move coins. (The seller cannot either, once deposited, until the contract signs; “self-custody” is not the claim. F15 would add a seller-only exit after a timelock.)
- **G2 Coins return, conditionally.** From `Funded` the seller can withdraw; from `Sold` without exercise, anyone can settle after the window. Both depend on the signer and the light client being live and on the contract’s NEAR reserve for the sign deposit. No action by the buyer or the operator can prevent them.
- **G3 Exercise is payment.** A delivery commitment to the buyer is created only in a receipt where `sender_id == buyer`, `amount ≥ strike_total`, the window is open, and a depth re-check succeeded.
- **G4 Purchase is final.** The premium is credited to the seller in the same receipt that records the buyer; there is no pending state between them.
- **G5 One spend per outpoint.** A commitment is written before the first signature request and never replaced; every retry requests the same sighash; the contract never authorises two conflicting spends of the same outpoint, and a recovered or settled outpoint can never become collateral.
- **G6 Public verifiability.** Each guarantee maps to a `Verify` check that reads Bitcoin and NEAR directly; no Covered endpoint is in the loop. Observable facts (empty key list, code hash, balances) are distinguished from code-enforced properties (no upgrade method, invariants) and from external assumptions (MPC, light client).

### Non-guarantees (said out loud in the product)

- Not safe against MPC threshold collusion or a critical bug in `v1.signer`; a contract bug can misdirect all active collateral, and the absence of a USDC treasury does not limit that.
- Not live if the signer, the light client or the contract’s NEAR reserve stops; there is no independent Bitcoin refund path in the MUST scope (F15 is the stretch that adds one).
- Not atomic: USDC for BTC is a conditional, asynchronous settlement. The strike sits in escrow until delivery confirms or 7 days pass.
- Not a price guarantee; the reference price is display only.
- Not private (section 10). Not audited.
- An empty access-key list and a code hash show immutability only together with the code containing no self-upgrade or key-adding method; `Verify` check 1 shows both and the reviewer must read the code for the second.

### Threat model and mitigations

| Id | Attacker | Attack | Mitigation | Evidence |
| --- | --- | --- | --- | --- |
| A1 | Operator | Call `v1.signer.sign` with the seller’s path string | The derived key depends on the predecessor; the operator gets a signature for a different key that cannot spend the collateral | L2 test: obtain such a signature and show the Bitcoin node rejects the spend |
| A2 | Operator | Call `settle` early | `now ≥ expiry + grace` guard; no price path exists | Operator terminal |
| A3 | Operator | Redeploy or add a key | No full-access key; no method that deploys or adds keys | Operator terminal + code review |
| A4 | Operator | Withhold proofs, refuse to relay or broadcast | All methods permissionless; raw tx exposed by view | `/try` without the relayer |
| A5 | Buyer | Exercise without paying | Only `ft_on_transfer` with `amount ≥ strike_total` moves to `ExercisePending` | L1 |
| A6 | Buyer | Exercise after the window via a late receipt | Guard on `block_timestamp` in the receipt; refused in full | L1 boundary test |
| A7 | Seller | Withdraw after selling | `withdraw` only in `Funded` | L1 |
| A8 | Seller | Withdraw, time out, then sell the “same” collateral | Commitment is written before the signature request and the state is `Committed`, not `Funded`; a retry re-requests the same sighash | L1 interleaving test |
| A9 | Anyone | Fake deposit proof | Merkle root must match a light-client header at depth ≥ `min_conf`; txid is non-witness | L1 forged branch |
| A10 | Anyone | Replay a signature on another tx | Signature commits to one sighash; the contract verifies it against the derived key before storing | Cryptographic + L0 |
| A11 | Anyone | Dust or wrong-amount deposits | Exact-amount rule; `recover` only outside `Funded`/`Sold`/`Committed` | L1 |
| A12 | Anyone | Reuse a recovered outpoint as collateral | Global `outpoints` set | L1 |
| A13 | MPC | Timeout, failure, duplicate or stale callback | `retry_after`; same sighash; callbacks `#[private]`; `Signed` ignores further callbacks | L1 with mock signer `fail_next` and `delay` |
| A14 | Bitcoin | Reorg removes collateral after `Sold` | Depth re-check before exercise; escrow with timeout after; premium loss remains (table below) | L1 regtest `invalidateblock` |
| A15 | Buyer | Pay strike from an account that is not the buyer | `sender_id == buyer` | L1 |

### Who bears which residual loss

| Event | Seller | Buyer |
| --- | --- | --- |
| Collateral reorged out before exercise | keeps coins (back in own wallet), keeps premium | loses premium |
| Collateral reorged out after strike paid | keeps coins, keeps premium; strike never released | strike refundable after 7 days; loses premium |
| Delivery tx never confirms (fee floor, signer down) | keeps premium; strike never released; coins stuck until signer returns | strike refundable after 7 days; loses premium; if the tx confirms after reclaim, buyer has both coins and strike and the seller bears it |
| Signer or light client permanently down | coins locked (F15 would return them after the timelock) | strike refundable; premium lost |
| MPC threshold compromised | can lose all collateral | nothing beyond premium |

### Bitcoin-side invariants the contract enforces

1. A commitment, once written, is immutable; `sign` is only ever called with `commitment.sighash`.
2. Input set of the committed tx = `{collateral}` exactly (or the one recovery outpoint for a `Recovery` commitment).
3. Output set = one output, `script = commitment.to_script`, where `to_script` is `refund_script` unless `reason == Exercise`, in which case `buyer_script`; `value = outpoint.value − fee_sats > 546`.
4. The sighash is recomputed from these fields when the commitment is created; no method accepts a caller-supplied sighash, script or amount for a settlement.

These are the four lines a reviewer should read first in `settlement.rs`.

## Privacy

Covered is public by default, and the site should say so rather than imply otherwise: verifiability and privacy pull in opposite directions, and for now verifiability wins.

| Data | Visible to | Where | Could it be hidden later |
| --- | --- | --- | --- |
| Terms (size, strike, expiry, premium) | Everyone | NEAR state and events | Yes: commit the terms hash on chain and reveal only to the buyer; settlement then needs the reveal (Confidential Intents or OutLayer secret-lock) |
| Deposit address and UTXO | Everyone | Bitcoin + NEAR | No: the coins must be publicly provable to be worth anything to a buyer |
| Seller NEAR account ↔ Bitcoin address link | Everyone | derivation path in events | Partly: use a per-contract subaccount or a hashed path salt so the seller’s main account is not in the path |
| Buyer identity | Everyone (NEAR account); the Solana/Base source address is visible on 1Click/Intents explorers | NEAR + Intents | Partly: Intents already breaks the direct chain link; a fresh NEAR account per purchase is cheap |
| Payout destination | Everyone, as an Intents deposit address and the Base receipt | Intents explorer | Partly, same as above |
| Exercise decision | Everyone, at exercise time | NEAR | Inherent |
| Settlement price | Everyone | NEAR | Inherent |
| Operator logs (IP, wallet, timing) | Operator only | Relayer DB | Minimised: the relayer stores tx hashes and serials, no IPs; the frontend talks to RPCs directly for reads |

### What Confidential Intents would add, and would not

Add: hidden premium and strike amounts in the Intents leg, and the possibility of a sealed-bid market (bids encrypted to the enclave, revealed only to the seller). Not add: hidden collateral; the BTC UTXO stays public, because its being public is the product. It is mainnet-only and `intents.far` has no testnet, so it is explicitly future work and mentioned once in the demo as such.

### Data handling for the demo

No analytics on the frontend. The relayer keeps `serial, txid, status, timestamps` and nothing about people. Testnet accounts used by judges are created with passkeys in the browser; we never see a key.

## Feasibility and risk register

The build is feasible in nine days because the hard parts are small: the contract is one state machine plus \~1,000 lines of Bitcoin serialisation, and every external dependency has a fallback that keeps the demo honest. The schedule risk is in integration with services we do not run, so those are tested first (L2 on day 2, not day 7).

Effort estimate, two engineers plus one on frontend:

| Workstream | Days | Confidence |
| --- | --- | --- |
| Contract: state machine, storage, events, views | 1.5 | High: standard near-sdk |
| Contract: P2WPKH derivation, BIP-143 sighash, tx assembly, DER/low-S | 1.5 | High: `bitcoin` crate is no-std; tested against Bitcoin Core on regtest |
| Light client proof parsing + call | 1 | Medium: depends on the deployed contract’s API; fallback is our own deployment |
| Signer integration (`derived_public_key`, `sign`, callback, retry) | 1 | Medium: 0.05 NEAR deposit, yield/resume timing, one signature per UTXO (we have one) |
| USDC `ft_on_transfer` + payout forwarding + 1Click | 1 | Medium: `customRecipientMsg` is experimental; fallback is two-step |
| Relayer + indexer (TypeScript) | 1.5 | High |
| Frontend from the design system | 2 | High: components exist |
| Attested price (OutLayer) | 1 | Low: dropped if it slips; nothing else depends on it |
| Testnet end-to-end, mainnet dry run, demo recording | 1.5 | Medium |

| Risk | Likelihood | Impact | Mitigation / fallback | Decide by |
| --- | --- | --- | --- | --- |
| No public Bitcoin light client on NEAR mainnet, or its API differs from assumptions | Medium | High | Deploy Near-One’s contract ourselves and run its relayer; cost \~0.5 day; the `Verify` page names which instance it trusts | Day 1 |
| `v1.signer` signing latency or failures on testnet | Medium | Medium | Retry logic; demo pre-signs the settlement off-camera if needed, with the on-chain request shown | Day 3 |
| `customRecipientMsg` unreliable | Medium | Low | Two-step buyer flow | Day 4 |
| Bitcoin testnet4 faucet dry or slow blocks | Medium | Medium | Keep a funded testnet4 wallet; signet as alternate; regtest for CI | Day 1 |
| Mainnet Bitcoin confirmations slow during recording | High | Low | Fund the mainnet demo contract two days before recording; the film shows the recorded wait compressed | Day 7 |
| Fee spike on mainnet above `fee_sats_per_vb` | Low | Low | 8 sat/vB plus CPFP by recipient | — |
| Gas limit exceeded on `settle` (sighash + sign promise) | Low | Medium | Sighash is cheap; measured in L1 with `near-workspaces` gas reports | Day 2 |
| OutLayer attestation not ready | High | Low | Drop; grace-window settlement is the primary path anyway | Day 5 |
| Name/trademark conflict on “Covered” | Unknown | Low | Not checked; rename is a find-and-replace in tokens.json | — |

### Utility check against the selection criteria

- Real problem, worse today: covered calls on BTC are offered by custodial venues (Deribit, OKX, Binance) and, non-custodially, by DLC products (Atomic Finance ran DLC covered calls; 10101 and Lendasat use DLCs for loans). DLCs need an oracle to attest the price, both parties online and interactive at setup, and cash settlement in BTC; they cannot take a premium from Solana. Covered needs no oracle at settlement, the seller is non-interactive after the deposit, delivery is physical, and the buyer pays from any chain via their NEAR account. That is the difference, not “only way”.
- Tech is the hard part: without a contract-held Bitcoin key with on-chain policy there is no non-interactive, oracle-free version; Chain Signatures is the production system that provides that today.
- Buyer motivation (the weaker side): a buyer gets identifiable collateral they can verify before paying, a window to exercise after seeing the expiry price, and no venue account. They accept manual exercise, full strike funding, a 7-day worst-case settlement delay, no resale, and MPC risk. The first buyers are therefore people who already want physical BTC at a known price (treasuries, miners hedging), not retail speculators. Who quotes executable premiums is open (section 14, #11).
- Payoff, stated plainly: the seller keeps all downside of holding BTC, caps the upside at the strike, and earns the premium; this implementation adds MPC and contract risk on top. “Annualised premium” is a yield on the strike decision, not an expected return; the “10–20%” figure is removed from the pitch unless sourced from Deribit’s own term structure on the recording day.
- Differentiation visible in the demo: the explorer page and the operator refusals.
- Who pays: sellers, as basis points of premium (not implemented; zero fee for now).

## Build plan

Six levels, each with its own harness and a gate that must pass before the next starts. Real assets appear on day 7 at the earliest and never exceed 0.01 BTC or $50 of USDC.

&#91;embedded content: Build levels L0–L5 with their gates\]

Each gate is a test that runs in CI (L0–L1) or a scripted checklist with a recorded transcript (L2–L5). A level is not done until its gate is green and the transcript is in `docs/build-log/`.

### L0 — Pure Rust, no chain (days 1–2)

What is built: the contract crate with the state machine, storage, events, Bitcoin serialisation (`btc.rs`: P2WPKH script, BIP-143 sighash, tx assembly, DER/low-S), merkle branch verification, and a `Signer` trait with a `MockSigner` that holds a real secp256k1 key.

Harness: `cargo test` with unit and property tests; `bitcoin` crate as the oracle for serialisation; fixture transactions generated once from Bitcoin Core regtest (`getrawtransaction`, `gettxoutproof`) and checked in.

Gate: for 200 random (value, fee, recipient) cases the contract’s sighash and final tx hex equal those produced by `bitcoin::sighash::SighashCache` signed with the same mock key, and Bitcoin Core’s `testmempoolaccept` on regtest returns `allowed: true` for 20 of them.

### L1 — NEAR sandbox + Bitcoin regtest (days 2–3)

What is built: deploy to `near-workspaces` sandbox with three stand-in contracts we write: `mock-signer` (same interface as `v1.signer`: `derived_public_key`, `sign` returning `(big_r, s, recovery_id)` from a known key, with a `fail_next` switch), `mock-light-client` (accepts headers submitted by the test, answers inclusion at a configurable depth) and a stock NEP-141 `mock-usdc`. A Bitcoin Core regtest node runs in Docker; the test mines blocks, sends deposits, extracts proofs and broadcasts the contract’s signed transactions.

Harness: Rust integration tests (`tests/flow.rs`) and a `make e2e` target; gas reports from workspaces for every method.

Gate: the three full flows (KEPT, EXERCISED, WITHDRAWN) run end to end on regtest with the signed tx accepted and mined by Core; every attack test in section 9 (A5–A9, A13) is red-then-green; `settle` under 300 Tgas.

### L2 — NEAR testnet + Bitcoin testnet4 (days 3–5)

> **Pinned on 5 Nov 2026 (live probe):** the public testnet light client `btc-client-v4.testnet` follows Bitcoin **testnet3**, not testnet4, so L2 runs on testnet3 (same `tb1` addresses; network variant `Testnet4` = hrp `tb`). Its method is `verify_transaction_inclusion_v2` with **borsh** `ProofArgsV2`, which adds the coinbase txid and its Merkle branch. The signer's epsilon is **SHA3-256** of the prefix, predecessor, comma and path; `sign` takes `payload_v2`/`domain_id` with a 1 yoctoNEAR deposit. Open questions 1–2 are closed by these; `e2e/testnet.ts` checks each against the live network.

What changes: real `v1.signer-prod.testnet`; the Bitcoin light client either the public testnet instance or our own deployment of Near-One’s contract with its relayer pointed at testnet4; relayer and indexer deployed; frontend wired to testnet.

Harness: `scripts/testnet-flow.ts` drives the whole flow from a funded testnet4 wallet with `min_conf = 1` and a 10-minute expiry; transcripts saved.

Gate: a testnet4 transaction signed by the MPC at the contract’s request confirms on testnet4 for KEPT and for EXERCISED; the derived address computed in the browser matches the contract’s; `Verify` passes all seven checks against testnet RPCs.

### L3 — Intents and payouts (days 5–6)

What changes: the buyer funds their NEAR account with USDC from Solana devnet (or mainnet with $5 if testnet routing is unavailable, decided day 5) through 1Click, then pays directly; meta-transactions through the relayer; reference price on the certificate; the P2WSH CSV exit (F15) if the core gates passed on day 4.

Gate: a premium paid from a Phantom wallet lands as `ft_on_transfer` and the seller receives USDC on the chosen chain; a short-delivery case is refunded and leaves the state `Funded`.

### L4 — Mainnet dry run (days 7–8)

What changes: deploy `covered.near` with the mainnet params, delete the full-access key on camera, fund the signer deposit balance. Run one contract with 0.001 BTC, strike $40,000 (strike total $40) and a $5 premium through KEPT, and one through EXERCISED, between team wallets. Aggregate cap for the whole level: 0.01 BTC and $100 USDC. Mainnet happens only if every L0–L3 gate passed; otherwise the submission is testnet-only and says so.

Gate: both Bitcoin mainnet transactions confirmed; `Verify` green on mainnet; `view_access_key_list` empty; transcripts and explorer links saved for the film.

### L5 — Demo (days 8–9)

Record the film against the real mainnet contract (the CV-0037 numbers in the brief are placeholders; the recording uses the real serials and 0.001 BTC), rehearse the `/try` judge flow on testnet twice from a clean browser, write the README with the verification steps, submit by 14 Nov 23:59 UTC.

### Repository layout

```
covered/
  contracts/covered/        near-sdk Rust, no-std bitcoin
  contracts/mock-signer/    L1 only
  contracts/mock-btc-client/ L1 only
  relayer/                  TypeScript: header relay, proofs, meta-tx, broadcast, indexer
  web/                      frontend from the design system
  scripts/                  regtest, testnet4, mainnet runbooks
  docs/build-log/           transcripts per level
```

## Test plan

Tests are organised by level so that a failure tells you which assumption broke. Each test names the requirement or attack it covers; a requirement without a test is a bug in this document.

### L0 — unit and property tests (`cargo test`, under 30 s)

| Test | Covers | Method |
| --- | --- | --- |
| `p2wpkh_address_from_pubkey` | F1 | 20 vectors from BIP-173/350 plus `bitcoin` crate |
| `sighash_matches_bitcoin_crate` (proptest, 200 cases) | F7, invariant 4 | compare to `SighashCache::p2wpkh_signature_hash` |
| `final_tx_matches_bitcoin_crate` (proptest) | F7 | sign with mock key both ways; byte-equal hex |
| `low_s_and_der` | F7 | signatures with high S are normalised; DER round-trips |
| `merkle_branch_valid` / `merkle_branch_forged` | F2, A9 | real `gettxoutproof` fixtures and mutated branches |
| `deposit_output_exact_match` | F2, A11 | over, under, two outputs, wrong script all refused |
| `state_machine_transitions` (table-driven) | section 6 | every `(state, event)` pair; illegal pairs panic with the named error |
| `boundary_expiry_grace` | A6 | timestamps `expiry+grace−1`, `expiry+grace`, `expiry+grace+1` |
| `fee_and_dust` | invariant 3 | sizes at the 100,000-sat minimum |
| `events_emitted` | N4 | every transition emits exactly one NEP-297 event with the serial |
| `no_floats_in_crate` | N3 | `grep -c f64` in CI equals 0 |

### L1 — sandbox integration (`make e2e`, under 5 min, Docker: regtest + sandbox)

| Test | Covers |
| --- | --- |
| `flow_kept`: create → deposit on regtest → proof → buy → time-travel past window → settle → broadcast → mined → confirm\_spend | F1–F8, G2 |
| `flow_exercised`: buyer pays strike in the window → depth re-check → commit → sign → mined → confirm\_spend releases escrow → seller claims | F5, F9, G3 |
| `flow_withdrawn`, `flow_recover_wrong_amount`, `flow_cancel_then_late_deposit` | F3, F14 |
| `claim_fails_restores_balance`: token transfer to an account without storage deposit | F9 |
| **Interleavings** (the high-value set): `withdraw_timeout_then_buy_refused` (A8); `exercise_during_pending_settle_refused`; `settle_and_exercise_same_block_order_independent`; `delayed_signature_after_retry_ignored_or_identical`; `recover_overlaps_funding_refused`; `recovered_outpoint_resubmitted_refused` (A12); `collateral_reorged_before_exercise_refunds_strike` and `after_strike_escrow_reclaimable` (A14); `claim_callback_fails_then_succeeds` | section 9 |
| `attack_*`: A5, A6 boundary, A7, A9, A10, A11, A13 (`fail_next`, `delay`, duplicate callback), A15 | section 9 |
| `accounting_invariant`: after every step, `get_accounting()` equals the mock USDC balance of the contract | N2 |
| `gas_budget`: every method’s burnt gas asserted under 300 Tgas | N6 |
| `derived_address_in_browser`: the TypeScript derivation equals the contract’s address for 50 paths | G6, Verify check 2 |
| `verify_checks_offline`: the seven checks run against sandbox RPCs and each is flipped to `failed` once by tampering | F10 |

### L2–L3 — testnet checklists (scripted, transcripts committed)

1. Real MPC: `derived_public_key` matches local derivation; `sign` returns within 60 s; signature verifies against the derived key; testnet4 accepts the tx.
2. Light client: header relay keeps within 2 blocks of testnet4 tip for 24 h; a proof at depth 1, 6 and 100 is accepted; a proof against a stale fork is refused.
3. Intents: 1Click quote → Phantom deposit → `ft_on_transfer` observed in NEAR explorer; status endpoint reaches `SUCCESS`; refund path exercised once with an expired deadline.
4. Meta-transactions: a fresh NEAR account with zero balance creates an offer and buys through the relayer.
5. Verify page: all seven checks green against testnet; each check turned red once by editing the expected value, to prove the page is not decorative.

### Chaos (L2, one afternoon)

- Kill the relayer mid-flow; settle and broadcast from a second machine with only the repo and a NEAR key.
- Submit the same proof twice; call `settle` three times; broadcast the signed tx twice. Nothing changes after the first success.
- Reorg on regtest (`invalidateblock`) after `Funded` to confirm the contract state is wrong-but-harmless as section 7 claims.

### L4–L5 — mainnet and rehearsal

- Two real contracts (KEPT, EXERCISED) at 0.001 BTC with full transcripts.
- `near view-state covered.near` and `view_access_key_list` saved as evidence.
- The judge flow rehearsed twice from a clean browser profile, timed; target under 6 minutes excluding Bitcoin confirmation.
- Film reviewed by someone outside the team for any claim not backed by a transcript.

### Review checklist for the contract (before L4 deploy)

- [ ] Invariants 1–4 in `settlement.rs` are the only place a sighash is built
- [ ] Every method that moves state checks `predecessor` or `signer` as the table in section 6 says
- [ ] `ft_on_transfer` returns the full amount on every error path
- [ ] No method takes a Bitcoin script or amount from the caller except `create_offer` (refund script) and `ft_on_transfer` (buyer script)
- [ ] Params immutable after `new`; no `set_*` methods
- [ ] Storage cost paid by the caller of `create_offer`; no unbounded vectors readable in one view
- [ ] `cargo near build --reproducible` hash recorded in the README and shown on `Verify`

## Open questions and decisions

Each item has an owner-less default so work never blocks; the default stands unless someone overrides it by the date.

| # | Question | Default if unanswered | Decide by |
| --- | --- | --- | --- |
| 1 | Which Bitcoin light client instance on NEAR mainnet/testnet, at which revision and code hash, with which admin controls set, and the exact proof arguments of its current (non-deprecated) inclusion method | Deploy our own instance from a pinned upstream revision on testnet day 1; publish checkpoint, code hash, and delete the admin key; `Verify` shows the flags | Day 1 |
| 2 | Exact `sign` argument shape for the current `v1.signer` version (`payload` vs `payload_v2`, `key_version` vs `domain_id`), the epsilon derivation prefix, and the required deposit | Copy from `chainsig.js` and the signer contract source at build time; pin versions in the README | Day 1 |
| 3 | Exercise window length: 2 h is unpriced optionality | 2 h, printed on the certificate and named in the sell form’s help text | Day 2 |
| 4 | Escrow timeout: 7 days | 7 days | Day 2 |
| 5 | USDC: Circle’s NEAR USDC `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` (6 decimals) and its testnet counterpart | Pin both ids and decimals in `params`; `Verify` check 1 shows them | Day 1 |
| 6 | Does 1Click route USDC from Solana devnet to a NEAR testnet account? | If not, buyers on testnet pay from a faucet-funded NEAR account; the 1Click step is demonstrated on mainnet with $5 | Day 5 |
| 7 | Is the P2WSH CSV exit (F15) worth the day? | Build it only if all core gates passed by day 4 | Day 4 |
| 8 | Buyer NEAR identity for a Solana-native user: passkey account created in the browser, funded via 1Click | Passkey account; `sender_id` is that account | Day 3 |
| 9 | `fee_sats` for mainnet | 1,000 sats; re-read mempool.space on day 7 and raise if the 1-hour floor exceeds 8 sat/vB | Day 7 |
| 10 | Name and trademark check for “Covered” | Unchecked; rename is a tokens.json change | — |
| 11 | Who quotes executable premiums at launch, and the fee model | Sellers quote; zero fee; mention once | — |

### Sources

- [NEAR Chain Signatures implementation](https://docs.near.org/chain-abstraction/chain-signatures/implementation): signer ids `v1.signer` / `v1.signer-prod.testnet`, one signature per UTXO, `deriveAddressAndPublicKey`.
- [NEAR Intents 1Click API](https://docs.near-intents.org/near-intents/1click-api): quote fields, `recipientType`, statuses, `customRecipientMsg` warning, 0.1% fee without JWT.
- [Omni Bridge implementation details](https://docs.near.org/chain-abstraction/omnibridge/implementation-details): Bitcoin requires full transaction signing; light-client trust model.
- [Near-One/btc-light-client-contract](https://github.com/Near-One/btc-light-client-contract): contract, relayer and merkle tools.
- [Covered design canvas](https://claude.ai/artifact/4az4t9r5WgTNMnXLEpy5ES) and [design system](https://claude.ai/artifact/1gormfHod4MU3fRZuTRF2m); project docs *Covered — Demo Brief* and *Covered — Brand Identity*.


## Addendum — mainnet hardening (6 Nov 2026)

These changes supersede the corresponding parts above where they differ.

**Deposit address.** P2WSH of `OP_IF <mpc_key> OP_CHECKSIG OP_ELSE <unlock_s> OP_CHECKLOCKTIMEVERIFY OP_DROP <rescue_key> OP_CHECKSIG OP_ENDIF`, with `unlock_s = expiry + grace + rescue_delay_s` (an absolute time, fixed per offer). The MPC branch is the only one the contract uses; its witness is `[sig, 0x01, witness_script]` and the BIP-143 scriptCode is the witness script. The rescue branch is the seller's exit if NEAR or the signing network stops: after `unlock_s` the seller's rescue key, generated in the browser and saved as a rescue kit at creation, sweeps the coins with only Bitcoin. `commit` is refused once `now + rescue_delay_s/2 >= unlock_s`, so a settlement always has half the delay to confirm before the exit opens; a buyer who paid the strike and was never delivered recovers it with `reclaim_strike`. Verify check 2 re-derives the full script.

**Fees.** Settlements signal RBF (sequence 0xfffffffd). `bump_fee(serial)` — anyone, once a signed settlement is unproven `fee_bump_after_s` after its last signature — rebuilds the same spend (same outpoint, same single recipient) with double the fee, up to `max_fee_sats`, and requests a new signature. Earlier versions stay valid; `confirm_spend` accepts any version (invariant G5 now reads: the commitment's outpoint and recipient are written once; only the fee may rise, within the cap).

**USDC.** `claim` calls `storage_deposit(account, registration_only)` on the token before `ft_transfer`, paid from a `usdc_storage_deposit` reserve (0.00125 NEAR) charged at `create_offer`.

**Caps and depth.** `max_size_sats` per deployment; `min_conf` 3 on mainnet. All parameters per network live in `params/*.json`.

**Signing check.** `selftest_sign()` signs a constant under the reserved path `covered/selftest` and verifies it against the derived key on chain; the mainnet deploy aborts before deleting the key if it fails.
