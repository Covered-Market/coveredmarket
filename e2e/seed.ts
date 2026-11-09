// Fills the LIVE testnet site with a realistic book, through the deployed contract and relayer exactly as visitors
// would: one seller ("maren") with offers in every state, and two buyers. Deposits come from the site's demo faucet;
// every refund and delivery address is the faucet's own, so all coins flow back to it as contracts settle.
//
//   SITE=https://… npx tsx seed.ts
//
// Leaves: three funded offers for sale (days to weeks out), one sold and running, one KEPT (nobody exercised; the
// relayer settled it on its own), one EXERCISED (strike paid, coins delivered), one waiting for its deposit.
import { Account } from "@near-js/accounts";
import { KeyPairEd25519 } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { writeFileSync, mkdirSync } from "node:fs";
import * as secp from "@noble/secp256k1";

const SITE = (process.env.SITE ?? "https://testnet.covered.market").replace(/\/$/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const get = async (p: string, init?: RequestInit) => { const r = await fetch(SITE + p, init); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${p}: ${r.status} ${JSON.stringify(j)}`); return j; };
const post = (p: string, body: object) => get(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const cfg = await get("/config.json");
const p = new JsonRpcProvider({ url: cfg.rpc }, { retries: 8, wait: 1500, backoff: 1.6 });
const TGAS = 10n ** 12n;
const view = async (m: string, a: object = {}, c = cfg.contract): Promise<any> => {
  for (let i = 0; ; i++) {
    try { const r: any = await p.query({ request_type: "call_function", account_id: c, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString("base64"), finality: "optimistic" }); return JSON.parse(Buffer.from(r.result).toString()); }
    catch (e) { if (i > 6) throw e; await sleep(2000 * (i + 1)); }
  }
};
const chainNow = async () => Number(BigInt((await p.block({ finality: "optimistic" })).header.timestamp_nanosec) / 1_000_000_000n);
async function until<T>(what: string, f: () => Promise<T | null | false | undefined>, ms: number, every = 20_000): Promise<T> {
  const t0 = Date.now(); let last = "";
  for (;;) {
    const v = await f().catch((e) => { const m = String((e as Error).message).slice(0, 160); if (m !== last) log(`  (${what}: ${m})`); last = m; return null; });
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out: " + what);
    await sleep(every);
  }
}
async function retryNonce<T>(f: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await f(); }
    catch (e) { if (i + 1 >= tries || !/InvalidNonce|nonce .*must be larger|Transaction has expired|Expired/i.test(String((e as Error)?.message ?? e))) throw e; await sleep(1500 * (i + 1)); }
  }
}
const tag = Date.now().toString(36).slice(-5);
// Test keys for this run, saved to the run's artifact (never logged), so a stopped run can't strand coins:
// the seller can still withdraw, and each deposit's rescue key can sweep it after its unlock time.
const keys: Record<string, string> = {};
const saveKeys = () => { mkdirSync(new URL("./artifacts/", import.meta.url), { recursive: true }); writeFileSync(new URL("./artifacts/keys.json", import.meta.url), JSON.stringify(keys, null, 2), { mode: 0o600 }); };
async function visitor(name: string) {
  const kp = KeyPairEd25519.fromRandom(), id = `${name}-${tag}.testnet`;
  const j = await post("/api/account", { newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() });
  const real = j.accountId ?? id;
  await until(`${real} exists`, async () => { try { await p.query({ request_type: "view_access_key", account_id: real, public_key: kp.getPublicKey().toString(), finality: "optimistic" }); return true; } catch { return null; } }, 60_000, 2000);
  log(`${name}: ${real}`);
  keys[real] = kp.toString();
  return { id: real, acc: new Account(real, p, new KeyPairSigner(kp)) };
}
type V = Awaited<ReturnType<typeof visitor>>;
const call = (v: V, contractId: string, methodName: string, args: object, deposit = 0n, gas = 300n) => retryNonce(() => v.acc.callFunction({ contractId, methodName, args, deposit, gas: gas * TGAS }));

// ── the book ──
const faucet = await get("/api/btc-faucet");
const params = await view("get_params");
const spot = Number((await get("/api/spot")).price) || 100_000;
const MIN = Number(params.min_size_sats), MAXF = Number(faucet.maxSats ?? 200000);
const have = Number(faucet.confirmed) + Number(faucet.unconfirmed);
const step = Number(params.expiry_step_s), grid = (t: number) => Math.ceil(t / step) * step;
const now = await chainNow();
const at0800 = (days: number) => { const d = new Date((now + days * 86400) * 1000); d.setUTCHours(8, 0, 0, 0); return grid(d.getTime() / 1000); };
const SHORT = Number(process.env.SHORT_EXPIRY_S ?? 2400); // the two contracts that settle during this run
const usd = (x: number) => String(Math.round(x * 1e6));
const strike = (pct: number) => Math.round((spot * (1 + pct / 100)) / 500) * 500;
// Priced like a real desk would (an annual rate on the notional), to the cent: test sizes make small premiums.
const premium = (sizeBtc: number, ratePct: number, days: number) => Math.max(0.05, Math.round(sizeBtc * spot * (ratePct / 100) * (days / 365) * 100) / 100);
type Plan = { key: string; sats: number; strikePct: number; days: number; expiry: number; apr: number; deposit: boolean };
const big = Math.min(MAXF, 200000), mid = Math.min(MAXF, 150000);
const plans: Plan[] = [
  { key: "exercised", sats: MIN, strikePct: 4, days: 0, expiry: grid(now + SHORT), apr: 18, deposit: true },
  { key: "kept", sats: MIN, strikePct: 9, days: 0, expiry: grid(now + SHORT + 120), apr: 14, deposit: true },
  { key: "sold", sats: mid, strikePct: 10, days: 7, expiry: at0800(7), apr: 12, deposit: true },
  { key: "open-a", sats: big, strikePct: 8, days: 3, expiry: at0800(3), apr: 15, deposit: true },
  { key: "open-b", sats: MIN, strikePct: 12, days: 14, expiry: at0800(14), apr: 10, deposit: true },
  { key: "open-c", sats: mid, strikePct: 6, days: 30, expiry: at0800(30), apr: 13, deposit: true },
  { key: "created", sats: MIN, strikePct: 15, days: 56, expiry: at0800(56), apr: 9, deposit: false },
];
const need = plans.filter((x) => x.deposit).reduce((s, x) => s + x.sats + 1000, 0);
log(`site ${SITE}: ${cfg.contract}; spot $${spot}; faucet ${faucet.address} holds ${have} sats, the book needs ~${need}`);
if (have < need) {
  // Shrink to the minimum size until it fits; drop the 30-day offer if even that is not enough.
  for (const x of plans) x.sats = MIN;
  const n = plans.filter((x) => x.deposit).length;
  if (have < n * (MIN + 1000)) { plans.splice(plans.findIndex((x) => x.key === "open-c"), 1); log("faucet is low: two offers for sale instead of three"); }
}

const maren = await visitor("maren"), ola = await visitor("ola"), ines = await visitor("ines");
saveKeys();
const made: Record<string, { serial: number; plan: Plan }> = {};
for (const x of plans) {
  const rescuePriv = secp.utils.randomPrivateKey();
  const rescuePub = Buffer.from(secp.getPublicKey(rescuePriv, true)).toString("hex");
  const sizeBtc = x.sats / 1e8, days = Math.max(x.days, 1);
  const terms = { size_sats: String(x.sats), strike_units: usd(strike(x.strikePct)), premium_units: usd(premium(sizeBtc, x.apr, days)), expiry_s: String(x.expiry), refund_address: faucet.address, rescue_pubkey: rescuePub };
  const serial = Number(await call(maren, cfg.contract, "create_offer", { terms }, 10n ** 23n, 100n));
  made[x.key] = { serial, plan: x };
  keys[`rescue CV-${serial}`] = Buffer.from(rescuePriv).toString("hex"); saveKeys();
  log(`CV-${serial} ${x.key}: ${sizeBtc} BTC, strike $${strike(x.strikePct)}, premium $${Number(terms.premium_units) / 1e6}, expiry ${new Date(x.expiry * 1000).toISOString().slice(0, 16)}Z`);
}
for (const x of plans.filter((y) => y.deposit)) {
  const { serial } = made[x.key];
  await until(`faucet pays CV-${serial}`, async () => { const j = await post("/api/btc-faucet", { serial }); log(`CV-${serial} deposit ${cfg.explorerBtc}/tx/${j.txid}`); return j; }, 75 * 60_000, 60_000);
}
const funded = (k: string) => until(`CV-${made[k].serial} Funded`, async () => (await view("get_offer", { serial: made[k].serial })).state === "Funded", 120 * 60_000, 20_000);
const buy = async (k: string, who: V) => {
  const o = await view("get_offer", { serial: made[k].serial });
  if (o.state !== "Funded" || (await chainNow()) > Number(o.expiry_s) - 30) { log(`CV-${o.serial} ${k}: ${o.state}, too late to buy`); return false; }
  await call(who, cfg.usdc, "ft_transfer_call", { receiver_id: cfg.contract, amount: o.premium_units, msg: JSON.stringify({ serial: o.serial, btc_address: faucet.address }) }, 1n, 150n);
  await until(`CV-${o.serial} Sold`, async () => (await view("get_offer", { serial: o.serial })).state === "Sold", 120_000, 3000);
  log(`CV-${o.serial} ${k}: sold to ${who.id}`);
  return true;
};

// The two short ones first: they must sell before expiry.
await Promise.all([funded("exercised"), funded("kept")]);
const ex = await buy("exercised", ola), kp = await buy("kept", ines);
await funded("sold"); await buy("sold", ines);

if (ex) {
  const o = await view("get_offer", { serial: made.exercised.serial });
  await until("exercise window", async () => (await chainNow()) >= Number(o.expiry_s) + 5, 3 * 3600_000, 15_000);
  await call(ola, cfg.usdc, "ft_transfer_call", { receiver_id: cfg.contract, amount: o.strike_total_units, msg: JSON.stringify({ serial: o.serial, exercise: true }) }, 1n, 300n);
  log(`CV-${o.serial} exercised by ${ola.id}: strike $${Number(o.strike_total_units) / 1e6} paid`);
}
for (const k of ["open-a", "open-b", "open-c"].filter((k) => made[k])) await funded(k);
log("three offers for sale are funded");
const final = (k: string, st: string) => until(`CV-${made[k].serial} ${st}`, async () => (await view("get_offer", { serial: made[k].serial })).state === st, 150 * 60_000, 30_000);
if (ex) await final("exercised", "Exercised");
if (kp) await final("kept", "Kept");
await call(maren, cfg.contract, "claim", {}, 0n, 100n).catch((e) => log(`claim: ${String(e).slice(0, 120)}`));

const out = Object.fromEntries(Object.entries(made).map(([k, v]) => [k, v.serial]));
mkdirSync(new URL("./artifacts/", import.meta.url), { recursive: true });
writeFileSync(new URL("./artifacts/seed.json", import.meta.url), JSON.stringify({ site: SITE, contract: cfg.contract, seller: maren.id, buyers: [ola.id, ines.id], ...out }, null, 2));
log(`seller ${maren.id}: ${JSON.stringify(out)}`);
log("SEEDED");
