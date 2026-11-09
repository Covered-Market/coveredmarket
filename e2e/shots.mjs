// Screenshots of the deployed app, straight from its live contract (no mock-ups).
//
//   SITE=https://… node shots.mjs            the website shot list (S1–S12, S4m–S7m, S10m) → artifacts/shots/
//   SITE=https://… MODE=audit node shots.mjs every page × phone/desktop × paper/vault, full page → artifacts/audit/
//
// Optional: SELLER=<account> picks whose "My contracts" page is shown (default: the seller with the most
// different contract states). OPEN, KEPT, EXERCISED=<serial> override the contracts picked for each shot.
// No keys are used: pages that need a wallet are shown for an account id only (nothing is signed).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const SITE = (process.env.SITE ?? "https://testnet.covered.market").replace(/\/$/, "");
const MODE = process.env.MODE ?? "shots";
const OUT = process.env.OUT ?? `artifacts/${MODE}`;
mkdirSync(OUT, { recursive: true });

const cfg = await (await fetch(`${SITE}/config.json`)).json();
const faucet = await fetch(`${SITE}/api/btc-faucet`).then((r) => r.json()).catch(() => null);
if (faucet?.address) console.log(`demo faucet ${faucet.address}: ${faucet.confirmed} confirmed + ${faucet.unconfirmed} unconfirmed sats`);
async function view(method, args = {}) {
  const r = await fetch(cfg.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", account_id: cfg.contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "final" } }) });
  const j = await r.json();
  if (j.error || j.result?.error) throw new Error(JSON.stringify(j.error ?? j.result.error));
  return JSON.parse(Buffer.from(j.result.result).toString());
}

// ── what is on chain ──
const offers = [];
for (let s = 1, miss = 0; miss < 3; s++) { const o = await view("get_offer", { serial: s }); if (o) { offers.push(o); miss = 0; } else miss++; }
const by = (st) => offers.filter((o) => o.state === st);
const pick = (env, list) => (process.env[env] ? Number(process.env[env]) : list.at(-1)?.serial);
const open = pick("OPEN", by("Funded"));
const kept = pick("KEPT", by("Kept"));
const exercised = pick("EXERCISED", by("Exercised"));
const created = by("Created").at(-1)?.serial;
const sellers = Object.entries(offers.reduce((m, o) => ((m[o.seller] ??= new Set()).add(o.state), m), {})).sort((a, b) => b[1].size - a[1].size);
const seller = process.env.SELLER ?? sellers[0]?.[0];
console.log(`${offers.length} contracts on ${cfg.contract}: ${[...new Set(offers.map((o) => o.state))].join(", ")}`);
console.log(`open CV-${open} · kept CV-${kept} · exercised CV-${exercised} · created CV-${created} · seller ${seller} (${[...(sellers[0]?.[1] ?? [])].join(", ")})`);

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };
const settle = async (page) => { await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {}); }; // the app polls; don't wait forever
const browser = await chromium.launch();
const problems = [];

async function open_(route, { viewport = DESKTOP, theme = "paper", wallet = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: MODE === "audit" ? 1 : viewport.deviceScaleFactor ?? 2, isMobile: !!viewport.isMobile, hasTouch: !!viewport.hasTouch, timezoneId: "UTC", locale: "en-GB" });
  await ctx.addInitScript(([w, theme]) => {
    try { w ? localStorage.setItem("coveredmarket.wallet", JSON.stringify(w)) : localStorage.removeItem("coveredmarket.wallet"); } catch {}
    new MutationObserver(() => { if (document.body && document.body.dataset.theme !== theme) document.body.dataset.theme = theme; }).observe(document, { childList: true, subtree: true });
  }, [wallet, theme]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${SITE}/#${route}`, { waitUntil: "load" });
  await settle(page);
  await page.evaluate((t) => (document.body.dataset.theme = t), theme);
  await page.waitForFunction(() => !/Loading CV-/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2500); // spot price, Bitcoin watch, fonts
  await page.evaluate(() => document.fonts.ready);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (over > 0) problems.push(`${route} @${viewport.width}: ${over}px horizontal overflow`);
  for (const e of errors) problems.push(`${route} @${viewport.width}: console: ${e.slice(0, 200)}`);
  return { page, ctx };
}

async function shot(name, route, opts = {}, crop) {
  const { page, ctx } = await open_(route, opts);
  try {
    if (opts.before) await opts.before(page);
    const file = `${OUT}/${name}.png`;
    if (crop) { const el = typeof crop === "string" ? page.locator(crop).first() : await crop(page); await el.screenshot({ path: file }); }
    else await page.screenshot({ path: file, fullPage: !!opts.fullPage });
    console.log(`  ${name}  ${route}`);
  } catch (e) { problems.push(`${name}: ${e.message.split("\n")[0]}`); }
  await ctx.close();
}

const me = seller ? { accountId: seller } : null;
const fillSell = async (page) => {
  const f = page.locator("input");
  await f.nth(0).fill("0.01");
  const spot = await page.evaluate(async () => (await (await fetch("/api/spot")).json()).price);
  await f.nth(1).fill(String(Math.ceil((spot * 1.1) / 1000) * 1000));
  await f.nth(2).fill(String(Math.round(spot * 0.01 * 0.004)));
  await f.nth(3).fill("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx");
  await page.waitForTimeout(400);
};

if (MODE === "audit") {
  const routes = [
    ["market", "/market", null], ["try", "/try", null], ["sell", "/sell", me, fillSell], ["sell-nowallet", "/sell", null],
    ["contracts", "/contracts", me], [`deposit-${open}`, `/deposit/${open}`, null], created && [`deposit-${created}`, `/deposit/${created}`, null],
    [`buy-${open}`, `/buy/${open}`, null], [`c-${open}-open`, `/c/${open}`, null], [`c-${kept}-kept`, `/c/${kept}`, null], [`c-${exercised}-exercised`, `/c/${exercised}`, null],
  ].filter((r) => r && !r[1].includes("undefined"));
  for (const [name, route, wallet, before] of routes)
    for (const [vn, vp] of [["desk", DESKTOP], ["phone", PHONE]])
      for (const theme of ["paper", "vault"]) {
        if (theme === "vault" && vn === "desk" && !["market", `c-${open}-open`].includes(name)) continue;
        await shot(`${name}.${vn}.${theme}`, route, { viewport: vp, theme, wallet, before, fullPage: true });
      }
  // Verify on a contract, desktop
  const v = open ?? exercised;
  if (v) await shot(`c-${v}-verify.desk.paper`, `/c/${v}`, { before: async (p) => { await p.getByRole("button", { name: "Verify" }).click(); await p.waitForFunction(() => /of 7|could not run|check failed/.test(document.body.innerText), null, { timeout: 90_000 }); }, fullPage: true });
} else {
  const cert = "[data-cv=certificate]";
  const verify = async (p) => { await p.getByRole("button", { name: "Verify" }).click(); await p.waitForFunction(() => /7 of 7/.test(document.body.innerText), null, { timeout: 120_000 }); };
  const list = [
    ["S1", `/c/${open}`, {}, cert],
    ["S2", "/market", { wallet: me }],
    ["S3", `/c/${open}`, { viewport: PHONE, theme: "vault" }],
    ["S3-paper", `/c/${open}`, { viewport: PHONE }],
    ["S4", "/sell", { wallet: me, before: fillSell }],
    ["S5", `/deposit/${open}`, { wallet: me }],
    ["S6", `/buy/${open}`, { wallet: { accountId: "buyer.testnet" } }],
    ["S7", `/c/${kept}`, { fullPage: true }],
    ["S8", `/c/${exercised}`, {}, cert],
    ["S9", "/contracts", { wallet: me }],
    ["S10", `/c/${open}`, { before: verify }, "[data-cv=verify]"],
    ["S11", `/c/${kept}`, {}, "[data-cv=timeline]"],
    ["S12", "/try", {}],
    ["S4m", "/sell", { wallet: me, viewport: PHONE, before: fillSell }],
    ["S5m", `/deposit/${open}`, { wallet: me, viewport: PHONE }],
    ["S6m", `/buy/${open}`, { wallet: { accountId: "buyer.testnet" }, viewport: PHONE }],
    ["S7m", `/c/${kept}`, { viewport: PHONE }],
    ["S10m", `/c/${open}`, { viewport: PHONE, before: async (p) => { await verify(p); await p.locator("[data-cv=verify]").scrollIntoViewIfNeeded(); } }, "[data-cv=verify]"],
    ["S2-vault", "/market", { wallet: me, theme: "vault" }],
    ["S10-vault", `/c/${open}`, { theme: "vault", before: verify }, "[data-cv=verify]"],
    ["S7-vault", `/c/${kept}`, { theme: "vault", fullPage: true }],
  ];
  for (const [name, route, opts, crop] of list) await shot(name, route, opts, crop);
}

await browser.close();
writeFileSync(`${OUT}/problems.txt`, problems.join("\n") + "\n");
console.log(problems.length ? `\n${problems.length} problem(s):\n${problems.join("\n")}` : "\nno problems detected");
