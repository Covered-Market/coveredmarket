# CoveredMarket: notes for agents

Two kinds of agent read this file. Agents that **use** CoveredMarket (trade, read offers) should start with [agent/README.md](agent/README.md) or the site's `/llms.txt`. Agents that **work on this repository** should read the rest.

## Using CoveredMarket

- MCP server: `bin/coveredmarket mcp` (stdio). CLI: `bin/coveredmarket agent <command>`, with JSON on stdout. Both are testnet and local only.
- Read API on every app: `/api/params`, `/api/offers`, `/api/offers/:serial`, `/api/accounts/:id`. Every offer has a `summary` and `next_actions`.
- Browser testing without a wallet extension: `?testwallet=seller` or `?testwallet=buyer` on the testnet app.

## Working on the repository

| Path | What |
|---|---|
| `contracts/coveredmarket/` | the NEAR contract (Rust). `lib.rs` holds the state machine; `btc.rs` builds the Bitcoin transactions |
| `contracts/mock-*` | local stand-ins for the MPC signer, the light client and USDC |
| `relayer/` | the service: proofs, settlement, broadcasts, meta-tx relay, faucets, the agent read API (`src/agentapi.ts`) |
| `web/` | the website and app (React + Vite). `public/llms.txt` is served on every host |
| `agent/` | the agent toolkit: SDK (`src/client.ts`), CLI, MCP server. It imports `relayer/src/agentapi.ts`, so both describe offers the same way |
| `e2e/` | the end-to-end runs (Playwright plus API flows) |
| `infra/`, `bin/coveredmarket` | Compose stacks, cloud deploy, and the single CLI |
| `docs/` | SPEC, SECURITY-MODEL, DEVELOPING, DEPLOY |

Commands:

```sh
bin/coveredmarket test        # unit tests: contract, relayer, web, agent (Rust 1.85+, Node 22)
bin/coveredmarket up          # the whole stack in Docker → http://localhost
bin/coveredmarket e2e-stack   # end-to-end against a running `up`
cd relayer && npm test        # one package at a time: relayer, web, agent each have `npm test`
```

Rules that keep the repo consistent:

- The product is **CoveredMarket**, one word. "Covered call" and "covered calls" are the financial term; leave them alone.
- Only testnet is live. Public copy must not suggest mainnet is open or that test assets have value.
- Changing the contract changes its code hash, and every deployed certificate is checked against that hash. Put contract changes in their own PR.
- When an interface changes (contract methods, `msg` formats, `/api/*`), update `docs/SPEC.md`, `agent/README.md` and `web/public/llms.txt` in the same change.
- Plain, specific prose in docs and on the site: say what happens, with real numbers.
