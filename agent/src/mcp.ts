#!/usr/bin/env -S npx tsx
/**
 * CoveredMarket as an MCP server (stdio). Add it to an MCP client, for example Claude Code:
 *
 *   claude mcp add coveredmarket -- npx tsx /path/to/coveredmarket/agent/src/mcp.ts
 *
 * Env: COVEREDMARKET_SITE (default https://testnet.covered.market), COVEREDMARKET_WALLET (default "default"),
 * COVEREDMARKET_HOME (default ~/.coveredmarket). Testnet and the local stack only. Every tool returns JSON.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CoveredMarket, type Status } from "./client.js";

const serial = z.number().int().nonnegative().describe("The offer's serial: 7 for CV-7");

export function server(connect: () => Promise<CoveredMarket>) {
  let cm: Promise<CoveredMarket> | null = null;
  const get = () => (cm ??= connect().catch((e) => { cm = null; throw e; }));
  const s = new McpServer({ name: "coveredmarket", version: "0.1.0" }, {
    instructions:
      "CoveredMarket: covered calls on native Bitcoin, settled by a NEAR contract. A seller locks BTC at a contract-controlled address and is paid a USDC premium up front; " +
      "at expiry the buyer may pay the strike inside a short window to receive the coins, otherwise they return to the seller. No price feed decides the outcome. " +
      "This server runs on TESTNET (test coins, no value). Units: sizes in BTC, prices in USD. Every offer comes back with `summary` and `next_actions` (who acts next, and when). " +
      "Typical seller flow: coveredmarket_sell → coveredmarket_faucet_deposit → coveredmarket_wait_for Funded. Buyer flow: coveredmarket_list_offers status=for_sale → coveredmarket_buy → at expiry, coveredmarket_exercise if worth it. " +
      "Then coveredmarket_claim collects USDC owed. The relayer settles, signs and proves on its own.",
  });
  const ok = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
  const run = <A>(f: (c: CoveredMarket, a: A) => Promise<unknown>) => async (a: A) => {
    try { return ok(await f(await get(), a)); }
    catch (e) { return { isError: true, content: [{ type: "text" as const, text: (e as Error).message }] }; }
  };
  const read = { readOnlyHint: true, openWorldHint: true };
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

  s.registerTool("coveredmarket_params", { title: "Deployment rules", description: "Size limits, the expiry grid and the next valid expiries, the exercise window, fees and contract ids.", inputSchema: {}, annotations: read }, run((c) => c.params()));
  s.registerTool("coveredmarket_list_offers", { title: "List offers", description: "Live offers with plain-unit terms, a summary and next actions. status: for_sale (buyable now), awaiting_deposit, sold, settling. Omit for all live offers.", inputSchema: { status: z.enum(["for_sale", "awaiting_deposit", "sold", "settling"]).optional() }, annotations: read }, run((c, a: { status?: Status }) => c.offers(a.status)));
  s.registerTool("coveredmarket_get_offer", { title: "Get offer", description: "One offer in any state, including settled ones, with its deposit, settlement and next actions.", inputSchema: { serial }, annotations: read }, run((c, a: { serial: number }) => c.offer(a.serial)));
  s.registerTool("coveredmarket_my_account", { title: "My account", description: "This wallet: NEAR account, balances, its own Bitcoin address, offers sold and bought, and USDC claimable. Creates and funds a testnet wallet on first use.", inputSchema: {}, annotations: read }, run((c) => c.account()));
  s.registerTool("coveredmarket_sell", {
    title: "Sell a covered call",
    description: "Create an offer. Returns the Bitcoin deposit to make (exactly amount_sats to address) and the path of the rescue kit written on this machine. The offer is for sale only once the deposit is proven.",
    inputSchema: {
      size_btc: z.number().positive().describe("BTC to lock, e.g. 0.001"),
      strike_usd: z.number().positive().describe("Strike price in USD per whole BTC"),
      premium_usd: z.number().positive().describe("Premium in USD for the whole contract, paid to the seller when bought"),
      expires_in_minutes: z.number().positive().optional().describe("Rounded up to the next valid expiry. Default: the earliest allowed"),
      refund_address: z.string().optional().describe("Where coins return if unsold or not exercised. Default: this wallet's Bitcoin address"),
    },
    annotations: write,
  }, run((c, a: { size_btc: number; strike_usd: number; premium_usd: number; expires_in_minutes?: number; refund_address?: string }) =>
    c.sell({ sizeBtc: a.size_btc, strikeUsd: a.strike_usd, premiumUsd: a.premium_usd, expiresInMinutes: a.expires_in_minutes, refundAddress: a.refund_address })));
  s.registerTool("coveredmarket_faucet_deposit", { title: "Deposit from the faucet", description: "Testnet: the site's demo faucet pays an offer's deposit (small offers only, rate-limited). Then wait for Funded.", inputSchema: { serial }, annotations: write }, run((c, a: { serial: number }) => c.depositFromFaucet(a.serial)));
  s.registerTool("coveredmarket_buy", { title: "Buy a call", description: "Pay the premium for a for-sale offer. Final once it succeeds. btc_address receives the coins if you exercise (default: this wallet's).", inputSchema: { serial, btc_address: z.string().optional() }, annotations: write }, run((c, a: { serial: number; btc_address?: string }) => c.buy(a.serial, a.btc_address)));
  s.registerTool("coveredmarket_exercise", { title: "Exercise", description: "Inside the exercise window, pay the strike to receive the coins. Only the buyer can. Do nothing to let it expire.", inputSchema: { serial }, annotations: write }, run((c, a: { serial: number }) => c.exercise(a.serial)));
  s.registerTool("coveredmarket_cancel", { title: "Cancel", description: "Cancel an offer before any deposit.", inputSchema: { serial }, annotations: write }, run((c, a: { serial: number }) => c.cancel(a.serial)));
  s.registerTool("coveredmarket_withdraw", { title: "Withdraw", description: "Seller: take an unsold, deposited offer's coins back to the refund address.", inputSchema: { serial }, annotations: write }, run((c, a: { serial: number }) => c.withdraw(a.serial)));
  s.registerTool("coveredmarket_claim", { title: "Claim USDC", description: "Pay out every premium and strike the contract owes this wallet.", inputSchema: {}, annotations: write }, run((c) => c.claim()));
  s.registerTool("coveredmarket_test_funds", { title: "Test funds", description: "Testnet: top up this wallet's tNEAR and test USDC.", inputSchema: {}, annotations: write }, run((c) => c.testFunds()));
  s.registerTool("coveredmarket_wait_for", {
    title: "Wait for a state",
    description: "Block until an offer reaches one of the given states, e.g. [\"Funded\"] after a deposit or [\"Kept\",\"Exercised\"] after expiry. States: Created, Funded, Sold, ExercisePending, Committed, Signed, Kept, Exercised, Withdrawn, Cancelled, Rescued.",
    inputSchema: { serial, states: z.array(z.string()).min(1), timeout_s: z.number().positive().max(1800).optional().describe("Default 600") },
    annotations: read,
  }, run((c, a: { serial: number; states: string[]; timeout_s?: number }) => c.waitFor(a.serial, a.states, { timeoutS: a.timeout_s ?? 600 })));
  return s;
}

if (process.argv[1]?.endsWith("mcp.ts") || process.argv[1]?.endsWith("coveredmarket-mcp")) {
  await server(() => CoveredMarket.connect()).connect(new StdioServerTransport());
}
