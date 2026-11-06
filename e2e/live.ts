// A full contract on the LIVE site with real Bitcoin testnet3: everything goes through the deployed contract,
// the deployed relayer and the real MPC signer + light client. Seller and buyer are fresh visitors made through
// the site's own /api/account; the deposit comes from the site's demo faucet; both the seller's refund address
// and the buyer's delivery address are the faucet's own address, so the coins go back to it at the end.
//   SITE=https://178-62-225-161.sslip.io npx tsx live.ts
import { Account } from "@near-js/accounts";
import { KeyPairEd25519 } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { writeFileSync } from "node:fs";
import * as secp from "@noble/secp256k1";

const SITE = (process.env.SITE ?? "https://178-62-225-161.sslip.io").replace(/\/$/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const get = async (p: string, init?: RequestInit) => { const r = await fetch(SITE + p, init); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${p}: ${r.status} ${JSON.stringify(j)}`); return j; };
const cfg = await get("/config.json");
const faucet = await get("/api/btc-faucet");
log(`site ${SITE}: contract ${cfg.contract}, faucet ${faucet.address} holds ${Number(faucet.confirmed) + Number(faucet.unconfirmed)} sats`);
const p = new JsonRpcProvider({ url: cfg.rpc }, { retries: 8, wait: 1500, backoff: 1.6 });
const TGAS = 10n ** 12n;
const view = async (m: string, a: object = {}, c = cfg.contract) => {
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
const tag = Date.now().toString(36);
async function visitor(role: string) {
  const kp = KeyPairEd25519.fromRandom(), id = `live-${role}-${tag}.testnet`;
  const j = await get("/api/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }) });
  const real = j.accountId ?? id; // the site may make it as a sub-account of its relayer
  await until(`${real} exists on chain`, async () => { try { await p.query({ request_type: "view_access_key", account_id: real, public_key: kp.getPublicKey().toString(), finality: "optimistic" }); return true; } catch { return null; } }, 60_000, 2000);
  log(`${role}: ${real} with ${j.usdc} test USDC`);
  return { id: real, acc: new Account(real, p, new KeyPairSigner(kp)) };
}
type V = Awaited<ReturnType<typeof visitor>>;
const call = (v: V, contractId: string, methodName: string, args: object, deposit = 0n, gas = 300n) => v.acc.callFunction({ contractId, methodName, args, deposit, gas: gas * TGAS });
const btc = (id: string) => `${cfg.explorerBtc}/tx/${id}`;
const report: Record<string, unknown> = { site: SITE, contract: cfg.contract };

const seller = await visitor("seller"), buyer = await visitor("buyer");
// The seller's rescue key, as the Sell page makes one (kept only for this run; the exit is tested on regtest).
const rescuePub = Buffer.from(secp.getPublicKey(secp.utils.randomPrivateKey(), true)).toString("hex");
const params = await view("get_params");
const SIZE = BigInt(params.min_size_sats);
const now = await chainNow();
const expiry = Math.ceil((now + Math.max(Number(params.min_lead_s) + 60, Number(process.env.EXPIRY_IN_S ?? 1800))) / Number(params.expiry_step_s)) * Number(params.expiry_step_s);
const serial = Number(await call(seller, cfg.contract, "create_offer", { terms: { size_sats: String(SIZE), strike_units: "150000000000", premium_units: "5000000", expiry_s: String(expiry), refund_address: faucet.address, rescue_pubkey: rescuePub } }, 10n ** 23n, 100n));
const offer = await until("offer visible", async () => { try { return await view("get_offer", { serial }); } catch { return null; } }, 60_000, 3000);
log(`CV-${serial}: ${Number(SIZE) / 1e8} BTC at ${offer.address}, expiry in ${Math.round((expiry - now) / 60)} min`);

const paid = await get("/api/btc-faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ serial }) });
log(`deposit sent by the demo faucet: ${btc(paid.txid)}`);
report.deposit_tx = paid.txid;

await until(`CV-${serial} Funded (relayer proof through ${cfg.lightClient})`, async () => { const o = await view("get_offer", { serial }); return o.state === "Funded" ? o : null; }, 100 * 60_000);
log(`CV-${serial} Funded: the real light client accepted the deposit proof`);

// A slow Bitcoin block can make the deposit land too close to expiry for a sale. Then prove the other path
// instead: the seller withdraws, the real MPC network signs, the relayer broadcasts, the spend is proven.
if ((await chainNow()) > expiry - 120) {
  log(`deposit confirmed too late to sell before expiry; running the WITHDRAW path instead`);
  await call(seller, cfg.contract, "withdraw", { serial }, 0n, 300n).catch((e) => log(`  withdraw call: ${String(e).slice(0, 160)}`));
  const w = await until("withdrawal signed by the MPC network", async () => { const o = await view("get_offer", { serial }); return o.signed_tx ? o : null; }, 30 * 60_000, 15_000);
  log(`CV-${serial} return signed by ${cfg.signer}; relayer broadcasts ${btc(w.commitment_txid)}`);
  await until(`CV-${serial} Withdrawn (spend proven on NEAR)`, async () => (await view("get_offer", { serial })).state === "Withdrawn", 120 * 60_000, 30_000);
  report.serial = serial; report.return_tx = w.commitment_txid; report.path = "withdraw"; report.certificate = `${SITE}/#/c/${serial}`;
  writeFileSync(new URL("./artifacts/live-report.json", import.meta.url), JSON.stringify(report, null, 2));
  log(`certificate: ${SITE}/#/c/${serial}`);
  log("LIVE TESTNET CONTRACT PASSED (withdraw path)");
  process.exit(0);
}

const o1 = await view("get_offer", { serial });
await call(buyer, cfg.usdc, "ft_transfer_call", { receiver_id: cfg.contract, amount: o1.premium_units, msg: JSON.stringify({ serial, btc_address: faucet.address }) }, 1n, 150n);
await until("Sold", async () => (await view("get_offer", { serial })).state === "Sold", 120_000, 3000);
log(`CV-${serial} sold to ${buyer.id} for ${Number(o1.premium_units) / 1e6} USDC; waiting for expiry`);

await until("expiry", async () => (await chainNow()) >= expiry + 5, (expiry - (await chainNow())) * 1000 + 600_000, 30_000);
await call(buyer, cfg.usdc, "ft_transfer_call", { receiver_id: cfg.contract, amount: o1.strike_total_units, msg: JSON.stringify({ serial, exercise: true }) }, 1n, 300n);
const c = await until("exercise committed", async () => { const o = await view("get_offer", { serial }); return ["Committed", "Signed", "Exercised"].includes(o.state) ? o : null; }, 300_000, 5000);
log(`CV-${serial} exercised: delivery committed, tx ${c.commitment_txid} → ${c.commitment_to_address}`);

const s = await until("signed by the MPC network", async () => { const o = await view("get_offer", { serial }); return o.signed_tx ? o : null; }, 30 * 60_000, 15_000);
log(`CV-${serial} signed by ${cfg.signer}; relayer broadcasts ${btc(s.commitment_txid)}`);
report.delivery_tx = s.commitment_txid;

await until(`CV-${serial} Exercised (spend proven on NEAR)`, async () => (await view("get_offer", { serial })).state === "Exercised", 120 * 60_000, 30_000);
await call(seller, cfg.contract, "claim", {}, 0n, 100n);
const bal = await until("seller paid", async () => { const b = BigInt(await view("ft_balance_of", { account_id: seller.id }, cfg.usdc)); return b > 100_000n * 1_000_000n ? b : null; }, 120_000, 5000);
log(`CV-${serial} Exercised; delivery confirmed on Bitcoin; seller claimed, now holds ${Number(bal) / 1e6} USDC`);
log(`certificate: ${SITE}/#/c/${serial}`);
report.serial = serial; report.certificate = `${SITE}/#/c/${serial}`;
writeFileSync(new URL("./artifacts/live-report.json", import.meta.url), JSON.stringify(report, null, 2));
log("LIVE TESTNET CONTRACT PASSED");
