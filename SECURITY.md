# Security policy

CoveredMarket holds other people's Bitcoin behind a NEAR contract. If you find a way to move coins, take USDC, or make the contract do something its rules forbid, we want to hear it first, and we pay for it.

**Status:** unaudited. Testnet is live; mainnet is not. Read the [security model](docs/SECURITY-MODEL.md) before you trust it with anything.

## Report a vulnerability

**Use GitHub's private reporting:** [Security → Report a vulnerability](https://github.com/Covered-Market/coveredmarket/security/advisories/new). Only the maintainers see it, and we can work on a fix and a CVE together in the same thread.

If you can't use GitHub, open a public issue titled **"Security contact request"** with no details, and we will reach out privately.

Please **do not** open a public issue, pull request or social post with details before a fix has shipped.

A good report has:

- what an attacker gains (coins moved, USDC taken, a settlement blocked, a forged Verify result, …);
- the commit or deployed contract (`coveredmarket-app-…testnet`, code hash) you tested against;
- steps or a test that reproduces it. A failing test against `bin/coveredmarket up` or `cargo test -p coveredmarket` is ideal;
- your NEAR account or Bitcoin address for the bounty, and the name you want in the thanks list (or "anonymous").

## What happens next

| When | What |
|---|---|
| within 72 hours | we confirm we have it and tell you who is handling it |
| within 7 days | we tell you whether we agree on impact and severity |
| as fast as we can | fix, test, and redeploy; for a deployed contract this means a new locked contract, because the old one has no key and cannot be patched |
| within 14 days of the fix shipping | bounty paid, advisory published with your credit (unless you ask us not to) |

We aim to publish within 90 days of your report. If we go quiet for more than 14 days, you may disclose.

## Bounty

Paid in USDC on NEAR or in BTC, your choice, to the address in your report. Amounts are set by **impact on the contract's guarantees**, not by how hard the bug was to find. A bug found on testnet is paid as if it had been found on mainnet.

| Severity | Examples | Reward |
|---|---|---|
| **Critical** | Anyone but the committed recipient gets a valid signature for a deposit address · the contract commits a spend to the buyer without the strike being paid · the code can be changed or a key added after deploy · USDC can leave the contract to someone who is not owed it | up to **$2,000** |
| **High** | Coins or USDC locked with no path out · a seller can sell the same coins twice · a fake deposit proof is accepted · a settlement can be forced before expiry + grace | up to **$750** |
| **Medium** | Verify shows *verified* for something that is false · the relayer or app can be made to show a wrong deposit address · a griefing attack that costs others more than it costs the attacker | up to **$250** |
| **Low** | Information leaks, UI spoofing, hardening gaps with a concrete exploit path | **$50** and a thank-you |

The first valid report of an issue gets the reward. Several reports with one root cause are one issue. Final severity is our call, and we will explain it.

### In scope

- The contract: `contracts/coveredmarket` (Rust), and any deployed copy we link from this repository.
- The Verify checks in `web/src/lib/verify.ts`: a check that passes when it should fail.
- Address derivation and Bitcoin transaction building, in Rust and TypeScript.
- The seller's exit: the rescue kit made in the browser and `bin/coveredmarket rescue`, where a flaw lets anyone but the seller sweep, or stops the seller sweeping after the unlock.
- The relayer (`relayer/`), where a bug lets it do more than relay, delay or pay gas.
- The deployed app at the testnet site, for issues that would mislead a user into losing funds.

### Out of scope

- The trust assumptions we already state: a colluding MPC threshold in `v1.signer`, a compromised Bitcoin light client, a NEAR or Bitcoin consensus failure. Report those to NEAR.
- Liveness of our own servers: the relayer and site going down, rate limits, the demo faucet running dry. Every contract method is public and works without them.
- Mock contracts used only in tests (`contracts/mock-*`) and the mock USDC on testnet.
- Reports from automated scanners with no working exploit, missing headers, or best-practice notes.
- Anything that needs a stolen device, a phished user or a malicious browser extension.

## Safe harbour

We will not take legal action against, or ask anyone to act against, research done in good faith that follows this policy:

- test on the **local stack** (`bin/coveredmarket up`) or **testnet**; do not attack contracts that hold other people's real coins;
- use your own accounts and wallets; do not touch other users' offers beyond what is needed to show the issue;
- do not degrade the service for others (no load testing, no draining the demo faucet);
- stop and report as soon as you have shown the issue.

## Thanks

People who reported issues responsibly are listed here, with their permission.

*None yet. Be the first.*
