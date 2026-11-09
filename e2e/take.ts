// Buy-and-exercise one live offer (see below). Helpers as in seed.ts.
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
async function visitor(name: string) {
  const kp = KeyPairEd25519.fromRandom(), id = `${name}-${tag}.testnet`;
  const j = await post("/api/account", { newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() });
  const real = j.accountId ?? id;
  await until(`${real} exists`, async () => { try { await p.query({ request_type: "view_access_key", account_id: real, public_key: kp.getPublicKey().toString(), finality: "optimistic" }); return true; } catch { return null; } }, 60_000, 2000);
  log(`${name}: ${real}`);
  return { id: real, acc: new Account(real, p, new KeyPairSigner(kp)) };
}
type V = Awaited<ReturnType<typeof visitor>>;
const call = (v: V, contractId: string, methodName: string, args: object, deposit = 0n, gas = 300n) => retryNonce(() => v.acc.callFunction({ contractId, methodName, args, deposit, gas: gas * TGAS }));

// ── take one offer: buy it and exercise it so its coins go back to the faucet ──
// For a funded offer whose seller can no longer act (e.g. a seed run cancelled half-way): any visitor may buy
// it before expiry and exercise it after; delivery then goes to the address given here, the faucet's own.
//   SITE=https://… SERIAL=4 npx tsx take.ts
const faucet = await get("/api/btc-faucet");
const serial = Number(process.env.SERIAL);
let o = await view("get_offer", { serial });
log(`CV-${serial}: ${o.state}, expiry ${new Date(Number(o.expiry_s) * 1000).toISOString()}`);
const buyer = await visitor("taker");
o = await until(`CV-${serial} Funded`, async () => { const x = await view("get_offer", { serial }); if (x.state !== "Created" && x.state !== "Funded") throw new Error(`state ${x.state}`); return x.state === "Funded" ? x : null; }, Math.max(0, (Number(o.expiry_s) - 45 - (await chainNow())) * 1000), 10_000);
await call(buyer, cfg.usdc, "ft_transfer_call", { receiver_id: cfg.contract, amount: o.premium_units, msg: JSON.stringify({ serial, btc_address: faucet.address }) }, 1n, 150n);
await until("Sold", async () => (await view("get_offer", { serial })).state === "Sold", 120_000, 3000);
log(`CV-${serial} bought by ${buyer.id}; delivery address ${faucet.address}`);
await until("exercise window", async () => (await chainNow()) >= Number(o.expiry_s) + 5, 3 * 3600_000, 10_000);
await call(buyer, cfg.usdc, "ft_transfer_call", { receiver_id: cfg.contract, amount: o.strike_total_units, msg: JSON.stringify({ serial, exercise: true }) }, 1n, 300n);
log(`CV-${serial} exercised`);
await until(`CV-${serial} Exercised`, async () => (await view("get_offer", { serial })).state === "Exercised", 150 * 60_000, 30_000);
log(`CV-${serial} Exercised: coins delivered to the faucet. TAKEN`);
