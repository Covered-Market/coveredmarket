// Read-only check of the agent CLI and MCP server against any running app: params, offers, one offer, a refused
// call, and the same reads over MCP. It makes no wallet and spends nothing, so it is safe on the live testnet app.
//   SITE=https://testnet.example.com node e2e/agent-smoke.mjs     (default http://localhost, the local stack)
// e2e/agent.mjs runs it first on the local stack; .github/workflows/agent-smoke.yml runs it on the deployed app.
import { cli, fails, freshHome, mcp, ok, TOOLS } from "./agent-lib.mjs";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const must = (cond, what) => { if (!cond) throw new Error(what); };

export async function smoke(site, env = { COVEREDMARKET_HOME: freshHome() }) {
  // A deploy may have just restarted the app.
  for (let i = 0; ; i++) {
    const h = await fetch(`${site}/api/health`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (h?.ok) break;
    if (i >= 40) throw new Error(`${site}/api/health is not ok`);
    await new Promise((r) => setTimeout(r, 3000));
  }

  const params = ok(site, ["params"], env);
  must(params.contract && params.size?.min_btc && params.expiry?.next?.length, `agent params: unexpected shape ${JSON.stringify(params).slice(0, 200)}`);
  log(`agent CLI params: contract ${params.contract}, sizes ${params.size.min_btc}–${params.size.max_btc} BTC, next expiry ${params.expiry.next[0].utc}`);

  const offers = ok(site, ["offers"], env);
  must(Array.isArray(offers), "agent offers: not a list");
  const forSale = ok(site, ["offers", "--status", "for_sale"], env);
  must(Array.isArray(forSale) && forSale.every((o) => o.state === "Funded"), "agent offers --status for_sale: not a list of Funded offers");
  for (const o of offers) must(Number.isInteger(o.serial) && o.summary && Array.isArray(o.next_actions), `offer without serial, summary or next_actions: ${JSON.stringify(o).slice(0, 200)}`);
  log(`agent CLI offers: ${offers.length} live, ${forSale.length} for sale`);
  if (offers.length) {
    const one = ok(site, ["offer", String(offers[0].serial)], env);
    must(one.serial === offers[0].serial && one.id === `CV-${one.serial}`, `agent offer ${offers[0].serial}: wrong offer`);
    log(`agent CLI offer ${one.id}: ${one.summary}`);
  }
  const refused = fails(site, ["offer", "999999999"], env);
  log(`agent CLI refuses an unknown offer: "${refused}"`);
  fails(site, ["no-such-command"], env);

  const m = await mcp(site, env);
  try {
    must(m.info?.name === "coveredmarket", `MCP server name ${m.info?.name}`);
    const names = (await m.tools()).map((t) => t.name);
    const missing = TOOLS.filter((t) => !names.includes(t));
    must(!missing.length, `MCP tools missing: ${missing.join(", ")}`);
    const p = await m.call("coveredmarket_params");
    must(p.contract === params.contract, "MCP coveredmarket_params: different contract from the CLI");
    const listed = await m.call("coveredmarket_list_offers", { status: "for_sale" });
    must(Array.isArray(listed) && listed.every((o) => o.state === "Funded"), "MCP coveredmarket_list_offers: not a list of Funded offers");
    if (offers.length) must((await m.call("coveredmarket_get_offer", { serial: offers[0].serial })).serial === offers[0].serial, "MCP coveredmarket_get_offer: wrong offer");
    let toolError = null;
    try { await m.call("coveredmarket_get_offer", { serial: 999999999 }); } catch (e) { toolError = e.toolError; }
    must(toolError, "MCP coveredmarket_get_offer of an unknown offer should report an error");
    log(`MCP: ${names.length} tools, params and ${listed.length} offers for sale match the CLI, errors come back as tool errors`);
  } finally { m.close(); }
  return { params, offers };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const site = (process.env.SITE ?? process.env.WEB ?? "http://localhost").replace(/\/$/, "");
  log(`agent smoke check against ${site}`);
  await smoke(site);
  log("AGENT SMOKE PASSED");
}
