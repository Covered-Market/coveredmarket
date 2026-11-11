# CoveredMarket for agents

Sell and buy covered calls on native Bitcoin from code, a shell, or an AI agent. Three ways in, all doing the same thing:

| | Use it when | Start |
|---|---|---|
| **MCP server** | your agent speaks MCP (Claude Code, Claude Desktop, Cursor, …) | `claude mcp add coveredmarket -- <repo>/bin/coveredmarket mcp` |
| **CLI** | a shell, a cron job, a quick test. JSON on stdout | `bin/coveredmarket agent offers --status for_sale` |
| **TypeScript SDK** | your own bot | `import { CoveredMarket } from "./agent/src/client.ts"` |
| **HTTP read API** | any language, read-only | `GET https://testnet.covered.market/api/offers` |

**Testnet and the local stack only.** The toolkit keeps keys in files, so it refuses mainnet. Testnet coins and USDC have no value.

Needs Node 22. The first run of `bin/coveredmarket agent` or `bin/coveredmarket mcp` installs this folder's dependencies.

## What happens on first use

The first call that needs a wallet creates one:

1. It makes a NEAR key and a Bitcoin key and saves them in `~/.coveredmarket/<site>/wallet-<name>.json` (mode 0600).
2. On testnet, the site's test-funds endpoint creates the account (an implicit account named after the key) with a little tNEAR and 100,000 test USDC. On the local stack it makes a sandbox account.
3. The relayer pays gas for every call after that.

Use `--wallet NAME` (or `COVEREDMARKET_WALLET`) to keep separate wallets, for example a `seller` and a `buyer`. To use an account you already hold, set `NEAR_ACCOUNT_ID` and `NEAR_PRIVATE_KEY`.

When you sell, a **rescue key** is made before the offer is created, and the **rescue kit** is written to `~/.coveredmarket/<site>/kits/<contract>/CV-<n>.json`. This is the seller's Bitcoin-only exit if NEAR ever stops: `bin/coveredmarket rescue <kit> <address>` after its unlock time. Keep it.

## A full contract from the shell

```sh
# Seller: 0.001 tBTC, strike $150,000, premium $5, expiring in about 30 minutes
bin/coveredmarket agent sell --wallet seller --size 0.001 --strike 150000 --premium 5 --expires-in 30
bin/coveredmarket agent faucet-deposit 7 --wallet seller     # testnet: the demo faucet pays the deposit
bin/coveredmarket agent wait 7 Funded --wallet seller        # the relayer proves it on NEAR

# Buyer
bin/coveredmarket agent offers --status for_sale --wallet buyer
bin/coveredmarket agent buy 7 --wallet buyer                 # pays the premium; final in that receipt

# At expiry, inside the exercise window: pay the strike to take the coins, or do nothing
bin/coveredmarket agent exercise 7 --wallet buyer
bin/coveredmarket agent wait 7 Kept Exercised

# Either side: collect USDC the contract owes you
bin/coveredmarket agent claim --wallet seller
```

Every command prints JSON. Errors print `{"error": "…"}` with the contract's own reason (for example `expiry too soon`) and exit 1.

| Command | Does |
|---|---|
| `params` | size limits, the expiry grid and the next valid expiries, the exercise window, fees, contract ids |
| `offers [--status S]` | live offers; S is `for_sale`, `awaiting_deposit`, `sold` or `settling` |
| `offer N` | one offer in any state |
| `me` | this wallet: account, balances, Bitcoin address, offers, USDC claimable |
| `sell --size BTC --strike USD --premium USD [--expires-in MIN \| --expiry UNIX] [--refund ADDR]` | create an offer; prints the deposit to make and the kit's path |
| `faucet-deposit N` | testnet: the demo faucet pays the deposit (small offers, rate-limited) |
| `buy N [--btc-address ADDR]` | pay the premium. ADDR gets the coins if you exercise; the default is the wallet's own |
| `exercise N` | pay the strike inside the window |
| `cancel N`, `withdraw N`, `reclaim-strike N`, `claim`, `test-funds` | the other moves |
| `wait N STATE…` | block until the offer reaches a state (progress on stderr) |

Global options: `--site URL` (default `https://testnet.covered.market`; `http://localhost` for the local stack), `--wallet NAME`.

## The offer object

Every read (CLI, MCP, SDK and HTTP API) returns offers in one shape. Amounts are given twice: as exact strings in the contract's units and as numbers in BTC or USD.

```jsonc
{
  "id": "CV-7", "serial": 7, "state": "Funded", "final": false,
  "summary": "Deposited and for sale.",
  "size": { "sats": "100000", "btc": 0.001 },
  "strike": { "usd_per_btc": 150000, "total_usd": 150, "total_units": "150000000" },
  "premium": { "usd": 5, "units": "5000000" },
  "expiry": { "s": 1794320040, "utc": "2026-11-10T14:14:00Z" },
  "exercise_window": { "opens_utc": "…", "closes_utc": "…" },
  "deposit": { "address": "tb1q…", "amount_sats": "100000", "txid": "…" },
  "next_actions": [
    { "action": "buy", "who": "buyer", "ready": true,
      "call": { "receiver_id": "<usdc>", "method": "ft_transfer_call", "deposit_yocto": "1", "gas_tgas": 100,
                "args": { "receiver_id": "<contract>", "amount": "5000000", "msg": "{\"serial\":7,\"btc_address\":\"<your bitcoin address>\"}" } },
      "note": "Pay the 5 USDC premium. …" },
    { "action": "withdraw", "who": "seller", "ready": true, "call": { "method": "withdraw", … } }
  ]
}
```

`next_actions` names who moves next: `seller`, `buyer`, `anyone`, or `relayer` for steps the relayer takes by itself (proving deposits, settling, signing, broadcasting, fee bumps). `ready: false` with `from_s` means not yet. If you sign your own transactions, `call` is the exact NEAR function call to make.

## MCP

```sh
claude mcp add coveredmarket -- /path/to/coveredmarket/bin/coveredmarket mcp
# a second identity, for example a buyer:
claude mcp add coveredmarket-buyer -e COVEREDMARKET_WALLET=buyer -- /path/to/coveredmarket/bin/coveredmarket mcp
```

Other clients: run `bin/coveredmarket mcp` (stdio) with the environment variables `COVEREDMARKET_SITE`, `COVEREDMARKET_WALLET` and `COVEREDMARKET_HOME`.

Tools: `coveredmarket_params`, `coveredmarket_list_offers`, `coveredmarket_get_offer`, `coveredmarket_my_account`, `coveredmarket_sell`, `coveredmarket_faucet_deposit`, `coveredmarket_buy`, `coveredmarket_exercise`, `coveredmarket_cancel`, `coveredmarket_withdraw`, `coveredmarket_claim`, `coveredmarket_test_funds`, `coveredmarket_wait_for`. The server's instructions explain the product and the usual flows to the model.

## SDK

```ts
import { CoveredMarket } from "./agent/src/client.ts"; // run with tsx

const seller = await CoveredMarket.connect({ wallet: "seller" });
const { serial, deposit, rescue_kit } = await seller.sell({ sizeBtc: 0.001, strikeUsd: 150_000, premiumUsd: 5, expiresInMinutes: 30 });
await seller.depositFromFaucet(serial);
await seller.waitFor(serial, ["Funded"]);

const buyer = await CoveredMarket.connect({ wallet: "buyer" });
for (const o of await buyer.offers("for_sale")) if (o.premium.usd <= 10) await buyer.buy(o.serial);
```

Reads go straight to NEAR RPC, so the SDK works against any deployment. Writes are signed on your machine and sent as NEP-366 meta-transactions through the site's relayer. If the relayer can't be reached, they go as direct transactions.

## HTTP read API

Served by each app's relayer. Nothing to install, any language:

| Endpoint | Returns |
|---|---|
| `GET /api/params` | the deployment's rules and the next valid expiries |
| `GET /api/offers?status=for_sale` | live offers (`for_sale`, `awaiting_deposit`, `sold`, `settling`; omit for all live) |
| `GET /api/offers/CV-7` | one offer, any state |
| `GET /api/accounts/<account>` | an account's offers and USDC claimable |
| `GET /api/market/latest` | the 48 newest offers in any state, newest first, in the contract's raw shape (no `summary`); refreshed at most every 30 s |
| `GET /api/spot` | the reference BTC price (display only; it never decides anything) |

Writes stay with you: sign the `call` from `next_actions` with your own NEAR key, or use the SDK.

## Tests

```sh
cd agent && npm test        # keys, rescue kits, store, CLI parsing, MCP tool list
cd relayer && npm test      # the offer descriptions and next_actions (agentapi.test.ts)
```

The CLI and MCP server themselves are tested against a running app. `bin/coveredmarket e2e-stack` sells, deposits, buys and claims through them on the local stack (`e2e/agent.mjs`). `node e2e/agent-smoke.mjs` makes read-only calls against any app (`SITE=…`, default `http://localhost`); CI runs it on the deployed testnet app every 3 hours.
