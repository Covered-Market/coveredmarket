// Screenshots of the deployed app for the website, press kit and social posts.
// Every shot is a real page of the running site showing contracts that exist on chain.
//   SITE=https://178-62-225-161.sslip.io OUT=site/shots node scripts/shots/shots.mjs
// Writes <OUT>/<id>-<theme>-<device>.png and <OUT>/manifest.json (which serial and state each shot shows).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const SITE = (process.env.SITE ?? "https://178-62-225-161.sslip.io").replace(/\/$/, "");
const OUT = (process.env.OUT ?? "site/shots").replace(/\/$/, "");
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const cfg = await (await fetch(SITE + "/config.json")).json();
async function view(method, args = {}) {
  const r = await fetch(cfg.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", account_id: cfg.contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "final" } }) });
  const j = await r.json();
  if (j.error || j.result?.error) throw new Error(`${method}: ${JSON.stringify(j.error ?? j.result.error)}`);
  return JSON.parse(Buffer.from(j.result.result).toString());
}

// Every offer that exists: walk serials until a run of gaps.
const offers = [];
for (let s = 1, gap = 0; gap < 15 && s < 2000; s++) {
  const o = await view("get_offer", { serial: s }).catch(() => null);
  if (o) { offers.push(o); gap = 0; } else gap++;
}
const byState = {};
for (const o of offers) (byState[o.state] ??= []).push(o);
log(`contract ${cfg.contract}: ${offers.length} offers`, Object.fromEntries(Object.entries(byState).map(([k, v]) => [k, v.map((o) => o.serial)])));
const latest = (st) => (byState[st] ?? []).at(-1);
const pick = {
  open: latest("Funded") ?? latest("Sold"),
  sold: latest("Sold"),
  kept: latest("Kept"),
  exercised: latest("Exercised"),
  created: latest("Created"),
};
// The seller with the most contracts, for "My contracts".
const counts = {};
for (const o of offers) counts[o.seller] = (counts[o.seller] ?? 0) + 1;
const busiest = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];

const devices = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};
const plan = [
  ["market", "#/market", null],
  ["try", "#/try", null],
  ["sell", "#/sell", "wallet"],
  ["contracts", "#/contracts", "wallet"],
  ...Object.entries(pick).filter(([, o]) => o).map(([k, o]) => [`cert-${k}`, `#/c/${o.serial}`, null]),
  ...(pick.open ? [["buy", `#/buy/${pick.open.serial}`, null]] : []),
  ...(pick.created ? [["deposit", `#/deposit/${pick.created.serial}`, "wallet"]] : []),
];
const themes = { paper: ["desktop", "phone"], vault: ["desktop", "phone"] };

const browser = await chromium.launch();
const manifest = { site: SITE, contract: cfg.contract, network: cfg.network, capturedAt: new Date().toISOString(), seller: busiest, picks: Object.fromEntries(Object.entries(pick).map(([k, o]) => [k, o ? { serial: o.serial, state: o.state } : null])), offers, shots: [] };
for (const [theme, devs] of Object.entries(themes)) for (const dev of devs) {
  const ctx = await browser.newContext({ ...devices[dev], colorScheme: theme === "vault" ? "dark" : "light" });
  const page = await ctx.newPage();
  await page.goto(SITE + "/#/market");
  for (const [id, route, needs] of plan) {
    await page.evaluate((w) => w ? localStorage.setItem("covered.wallet", JSON.stringify(w)) : localStorage.removeItem("covered.wallet"),
      needs === "wallet" && busiest ? { accountId: busiest } : null);
    await page.goto(`${SITE}/${route}`); await page.reload();
    await page.evaluate((t) => document.body.setAttribute("data-theme", t), theme);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(3500);
    if (id === "sell") {
      const f = (t) => page.locator("label.cv-field", { hasText: t }).locator("input");
      await f("Size").fill("2").catch(() => {}); await f("Strike").fill("150000").catch(() => {}); await f("Premium you ask").fill("6000").catch(() => {});
      await page.waitForTimeout(800);
    }
    if (id.startsWith("cert-")) {
      const v = page.getByRole("button", { name: "Verify" });
      if (await v.count()) { await v.first().click(); await page.waitForSelector("text=/of 7|could not run/", { timeout: 90_000 }).catch(() => {}); await page.waitForTimeout(800); }
    }
    for (const full of [false, true]) {
      const file = `${id}-${theme}-${dev}${full ? "-full" : ""}.png`;
      await page.screenshot({ path: `${OUT}/${file}`, fullPage: full });
      manifest.shots.push({ file, id, route, theme, device: dev, fullPage: full });
    }
    log(`${theme} ${dev} ${id}`);
  }
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
log(`${manifest.shots.length} shots in ${OUT}`);
