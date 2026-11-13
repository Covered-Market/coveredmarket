// The agent toolkit end to end on the local stack, the way an agent uses it: the read-only smoke check, then one
// contract sold from the CLI, deposited by the demo faucet and bought over MCP, and the premium claimed from the CLI.
// Wallets are made on first use in a throwaway COVEREDMARKET_HOME. run.mjs calls this as its last step;
// `node e2e/agent.mjs` runs it alone against a running `bin/coveredmarket up`.
import { existsSync, readFileSync } from "node:fs";
import { fails, freshHome, mcp, ok } from "./agent-lib.mjs";
import { smoke } from "./agent-smoke.mjs";

const must = (cond, what) => { if (!cond) throw new Error(what); };

export async function agentRun(site, log) {
  const env = { COVEREDMARKET_HOME: freshHome() };
  await smoke(site, env);

  // Seller, from the shell.
  const sold = ok(site, ["sell", "--wallet", "seller", "--size", "0.002", "--strike", "150000", "--premium", "12"], env);
  const s = String(sold.serial);
  must(sold.deposit?.address?.startsWith("bcrt1") && sold.deposit.amount_sats === "200000", `agent sell: unexpected deposit ${JSON.stringify(sold.deposit)}`);
  must(existsSync(sold.rescue_kit), `agent sell: rescue kit not written at ${sold.rescue_kit}`);
  const kit = JSON.parse(readFileSync(sold.rescue_kit, "utf8"));
  must(kit.kind === "coveredmarket-rescue-kit" && kit.address === sold.deposit.address && kit.rescue_private_key_wif, "agent sell: rescue kit does not match the offer");
  log(`agent CLI sell: ${sold.id}, deposit ${sold.deposit.amount_sats} sats to ${sold.deposit.address}, rescue kit written`);
  ok(site, ["faucet-deposit", s, "--wallet", "seller"], env);
  const funded = ok(site, ["wait", s, "Funded", "--timeout", "240", "--wallet", "seller"], env);
  log(`agent CLI faucet-deposit + wait: ${funded.id} ${funded.state}`);

  // Buyer, over MCP.
  const m = await mcp(site, { ...env, COVEREDMARKET_WALLET: "buyer" });
  let buyer;
  try {
    const listed = await m.call("coveredmarket_list_offers", { status: "for_sale" });
    must(listed.some((o) => o.serial === sold.serial), `MCP coveredmarket_list_offers: ${sold.id} not for sale`);
    buyer = (await m.call("coveredmarket_my_account")).account;
    const bought = await m.call("coveredmarket_buy", { serial: sold.serial });
    must(bought.state === "Sold" && bought.buyer, `MCP coveredmarket_buy: ${bought.state}`);
    buyer = bought.buyer;
    let again = null;
    try { await m.call("coveredmarket_buy", { serial: sold.serial }); } catch (e) { again = e.toolError; }
    must(again && /not for sale/.test(again), `MCP coveredmarket_buy a second time should be refused; got ${again}`);
    log(`MCP coveredmarket_buy: ${sold.id} Sold to ${bought.buyer}; a second buy is refused ("${again.slice(0, 60)}…")`);
  } finally { m.close(); }

  // Back on the CLI: the offer as anyone sees it, a refused move, and the seller's premium.
  const after = ok(site, ["offer", s], env);
  must(after.state === "Sold" && after.buyer === buyer, `agent offer ${s}: ${after.state}, buyer ${after.buyer}`);
  fails(site, ["cancel", s, "--wallet", "seller"], env);
  const claimed = ok(site, ["claim", "--wallet", "seller"], env);
  must(claimed.claimed_usd === 12, `agent claim: claimed ${claimed.claimed_usd}, expected the 12 USD premium`);
  log(`agent CLI claim: seller collected the ${claimed.claimed_usd} USD premium`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const site = (process.env.WEB ?? "http://localhost").replace(/\/$/, "");
  await agentRun(site, (...a) => console.log(new Date().toISOString().slice(11, 19), ...a));
  console.log("AGENT PASSED");
}
