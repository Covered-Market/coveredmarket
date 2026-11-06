// End-to-end run of the product against `bin/covered up`:
//   1. KEPT: create → deposit on regtest → relayer proves it → buy → window passes → relayer settles,
//      mock MPC signs, relayer broadcasts → mined → relayer confirms → seller claims.
//   2. EXERCISED: same until expiry → buyer pays the strike in the window → relayer requests the
//      signature → broadcast → mined → confirmed → seller claims premium + strike.
//   3. UI: market, sell, deposit, contracts and both certificates in Chromium; press Verify on each
//      and require 7/7 verified. Screenshots go to e2e/artifacts/.
import { Account } from "@near-js/accounts";
import { KeyPairEd25519, KeyPair } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const WEB = process.env.WEB ?? "http://localhost";
const RPC = process.env.RPC ?? "http://localhost:3030";
const ART = new URL("./artifacts/", import.meta.url).pathname;
mkdirSync(ART, { recursive: true });
const provider = new JsonRpcProvider({ url: RPC });
const TGAS = 10n ** 12n, NEAR = 10n ** 24n;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (path, body) => { const r = await fetch(WEB + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }); const t = await r.text(); if (!r.ok) throw new Error(`${path}: ${r.status} ${t}`); try { return JSON.parse(t); } catch { return t; } };
const cfg = await (await fetch(WEB + "/config.json")).json();
log("config", cfg.contract, cfg.usdc, cfg.mode);
const view = async (method, args = {}, contract = cfg.contract) => {
  const r = await provider.query({ request_type: "call_function", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "optimistic" });
  return JSON.parse(Buffer.from(r.result).toString());
};
const chainNow = async () => Number(BigInt((await provider.block({ finality: "optimistic" })).header.timestamp_nanosec) / 1_000_000_000n);
async function until(what, f, ms = 120_000) {
  const t0 = Date.now();
  for (;;) { const v = await f(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(2000); }
}
async function fastForwardTo(t) {
  for (let i = 0; i < 40; i++) {
    const now = await chainNow();
    if (now >= t) return now;
    await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sandbox_fast_forward", params: { delta_height: Math.max(5, Math.min(t - now, 2000)) } }) });
    await sleep(500);
  }
  throw new Error("fast-forward did not reach " + t);
}
async function user(name) {
  const kp = KeyPairEd25519.fromRandom();
  const id = `${name}${Date.now() % 100000}.${cfg.accountSuffix}`;
  await post("/api/dev/account", { newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() });
  return { id, key: kp.toString(), acc: new Account(id, provider, new KeyPairSigner(KeyPair.fromString(kp.toString()))) };
}
const call = (u, contractId, methodName, args, deposit = 0n, gas = 300n) => u.acc.callFunction({ contractId, methodName, args, deposit, gas: gas * TGAS });
const usdc = (n) => String(BigInt(Math.round(n * 1e6)));
const offer = (s) => view("get_offer", { serial: s });
const btcStatus = async (txid) => { const r = await fetch(`${WEB}/btc/tx/${txid}/status`); return r.ok ? r.json() : null; };

async function createAndFund(seller, { sizeBtc, strike, premium }) {
  const p = await view("get_params");
  const now = await chainNow();
  const expiry = Math.ceil((now + Number(p.min_lead_s) + 90) / Number(p.expiry_step_s)) * Number(p.expiry_step_s) + Number(p.expiry_offset_s);
  const refund = (await post("/btc/dev/address")).address;
  const serial = Number(await call(seller, cfg.contract, "create_offer", { terms: { size_sats: String(Math.round(sizeBtc * 1e8)), strike_units: usdc(strike), premium_units: usdc(premium), expiry_s: String(expiry), refund_address: refund } }, NEAR / 10n, 100n));
  const o = await offer(serial);
  log(`CV-${serial} created, deposit ${sizeBtc} BTC to ${o.address}, expiry ${expiry}`);
  await post("/btc/dev/send", { address: o.address, btc: sizeBtc });
  await post("/btc/dev/mine", { n: 1 });
  await until(`CV-${serial} Funded (relayer proves the deposit)`, async () => (await offer(serial)).state === "Funded");
  log(`CV-${serial} Funded by the relayer's proof`);
  return { serial, expiry, refund, grace: Number(p.grace_s) };
}
async function buy(buyer, serial) {
  const o = await offer(serial);
  const to = (await post("/btc/dev/address")).address;
  await call(buyer, cfg.usdc, "ft_transfer_call", { receiver_id: cfg.contract, amount: o.premium_units, msg: JSON.stringify({ serial, btc_address: to }) }, 1n, 150n);
  const after = await offer(serial);
  if (after.state !== "Sold" || after.buyer !== buyer.id) throw new Error(`buy failed: ${after.state}`);
  log(`CV-${serial} Sold to ${buyer.id}`);
  return to;
}
async function settleOnBitcoin(serial, finalState) {
  const signed = await until(`CV-${serial} Signed`, async () => { const o = await offer(serial); return o.state === "Signed" ? o : null; }, 180_000);
  log(`CV-${serial} signed by the MPC stand-in, tx ${signed.commitment_txid}`);
  await until(`CV-${serial} broadcast by the relayer`, async () => (await btcStatus(signed.commitment_txid)) !== null, 120_000);
  await post("/btc/dev/mine", { n: 1 });
  await until(`CV-${serial} ${finalState}`, async () => (await offer(serial)).state === finalState, 120_000);
  log(`CV-${serial} ${finalState}: spend confirmed on regtest and proven on NEAR`);
  return signed;
}

// ── users
const astrid = await user("astrid"), marcus = await user("marcus");
log("users", astrid.id, marcus.id);

// ── 1. KEPT
const k = await createAndFund(astrid, { sizeBtc: 0.01, strike: 150000, premium: 60 });
await buy(marcus, k.serial);
if ((await view("get_claimable", { account: astrid.id })) !== usdc(60)) throw new Error("premium not credited");
await fastForwardTo(k.expiry + k.grace + 5);
log("window closed; waiting for the relayer to settle");
const ks = await settleOnBitcoin(k.serial, "Kept");
if (ks.commitment_to_address !== k.refund) throw new Error("KEPT did not pay the seller's refund address");

// ── 2. EXERCISED
const x = await createAndFund(astrid, { sizeBtc: 0.02, strike: 100000, premium: 40 });
const buyerAddr = await buy(marcus, x.serial);
await fastForwardTo(x.expiry + 5);
const xo = await offer(x.serial);
await call(marcus, cfg.usdc, "ft_transfer_call", { receiver_id: cfg.contract, amount: xo.strike_total_units, msg: JSON.stringify({ serial: x.serial, exercise: true }) }, 1n, 300n);
log(`CV-${x.serial} strike ${Number(xo.strike_total_units) / 1e6} USDC paid; state ${(await offer(x.serial)).state}`);
const xs = await settleOnBitcoin(x.serial, "Exercised");
if (xs.commitment_to_address !== buyerAddr) throw new Error("EXERCISED did not pay the buyer");

// ── claims and accounting
const owed = BigInt(await view("get_claimable", { account: astrid.id }));
const expect = BigInt(usdc(60)) + BigInt(usdc(40)) + BigInt(xo.strike_total_units);
if (owed !== expect) throw new Error(`claimable ${owed} != ${expect}`);
await call(astrid, cfg.contract, "claim", {}, 0n, 100n);
const bal = BigInt(await view("ft_balance_of", { account_id: astrid.id }, cfg.usdc));
log(`seller claimed; USDC balance ${Number(bal) / 1e6}`);
const acc = await view("get_accounting");
const held = BigInt(await view("ft_balance_of", { account_id: cfg.contract }, cfg.usdc));
if (BigInt(acc.claimable_total) + BigInt(acc.escrow_total) !== held) throw new Error("accounting invariant broken");
log("accounting invariant holds:", held, "=", acc.claimable_total, "+", acc.escrow_total);

// ── 3. UI and Verify
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(WEB + "/#/market");
await page.evaluate((w) => localStorage.setItem("covered.wallet", JSON.stringify(w)), { accountId: astrid.id, key: astrid.key });
for (const [route, name] of [["#/market", "market"], ["#/sell", "sell"], [`#/deposit/${k.serial}`, "deposit"], ["#/contracts", "contracts"], ["#/try", "try"]]) {
  await page.goto(`${WEB}/${route}`); await page.reload(); await page.waitForTimeout(2500);
  await page.screenshot({ path: `${ART}${name}.png`, fullPage: true });
}
// A transaction from the UI goes through the gas relayer (NEP-366), not the direct-call fallback.
const consoleWarn = [];
page.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") consoleWarn.push(m.text()); });
page.on("dialog", (d) => { errors.push("dialog: " + d.message()); d.dismiss(); });
const relayedBefore = (await (await fetch(`${WEB}/api/health`)).json()).relayed;
const refund = (await (await fetch(`${WEB}/btc/dev/address`, { method: "POST" })).json()).address;
const offersBefore = (await view("get_account_offers", { account: astrid.id })).length;
await page.goto(`${WEB}/#/sell`); await page.reload(); await page.waitForTimeout(1500);
const field = (t) => page.locator("label.cv-field", { hasText: t }).locator("input");
await field("Size").fill("0.002"); await field("Strike").fill("150000"); await field("Premium you ask").fill("25"); await field("Return coins to").fill(refund);
await page.getByRole("button", { name: "Continue to deposit" }).click();
try { await until("UI offer on chain and deposit page shown", async () => /#\/deposit\/\d+/.test(page.url()), 60_000); }
catch (e) { await page.screenshot({ path: `${ART}sell-failed.png`, fullPage: true }); throw new Error(`${e.message}; url ${page.url()}; console: ${consoleWarn.join(" | ")}; errors: ${errors.join(" | ")}`); }
const relayedAfter = (await (await fetch(`${WEB}/api/health`)).json()).relayed;
if (relayedAfter !== relayedBefore + 1) throw new Error(`UI create_offer did not go through the relayer (relayed ${relayedBefore} → ${relayedAfter}); console: ${consoleWarn.join(" | ")}`);
if (consoleWarn.some((w) => w.includes("relay unavailable"))) throw new Error("UI fell back to a direct call");
if ((await view("get_account_offers", { account: astrid.id })).length !== offersBefore + 1) throw new Error("UI offer not on chain");
await page.screenshot({ path: `${ART}sell-relayed.png`, fullPage: true });
log(`UI sell → create_offer relayed as a meta-transaction (relayer count ${relayedBefore} → ${relayedAfter}); now ${page.url().split("#")[1]}`);

for (const [s, name] of [[k.serial, "kept"], [x.serial, "exercised"]]) {
  await page.goto(`${WEB}/#/c/${s}`); await page.reload(); await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForSelector("text=/7 of 7|A check failed|could not run/", { timeout: 60_000 });
  await page.screenshot({ path: `${ART}certificate-${name}.png`, fullPage: true });
  const text = await page.innerText("body");
  const lines = text.split("\n").filter((l) => /^(✓|✗|\?)$/.test(l.trim()) || /Deployed code|Address derivation|Collateral|Payment receipts|State transitions|Committed transaction|Bitcoin confirmation/.test(l));
  if (!text.includes("7 of 7")) { console.log(lines.join("\n")); throw new Error(`Verify not 7/7 for CV-${s}`); }
  log(`CV-${s} Verify: 7 of 7 verified in the browser`);
}
await browser.close();
if (errors.length) { console.log("page errors:", errors); throw new Error("UI raised errors"); }
log("E2E PASSED");
