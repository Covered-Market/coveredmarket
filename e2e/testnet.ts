// L2 on live NEAR testnet: deploys a fresh `covered` wired to the REAL MPC signer (v1.signer-prod.testnet),
// then proves, end to end:
//   1. the contract derives the same deposit address the real signer reports for it;
//   2. WITHDRAW: the real MPC signs the committed spend through the contract; signature verifies offline;
//   3. EXERCISE: buy → real-time expiry → strike paid → commit → real MPC signature → spend confirmed → claim;
//   4. the REAL Bitcoin light client (btc-client-v4.testnet, tracks testnet3) accepts the relayer's proof of a
//      real testnet3 transaction, encoded exactly as the contract encodes it, and rejects a tampered one.
// The light client and USDC used by the contract in 2–3 are throwaway mocks, because a real deposit needs
// testnet3 BTC (faucets are captcha-gated). Everything else is the live network.
import { Account } from "@near-js/accounts";
import { KeyPairEd25519 } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { readFileSync, writeFileSync } from "node:fs";
import { buildProof, esplora, lcArgsV2, txidOf } from "../relayer/src/btc/proof.ts";
import { verifySignedTx } from "../web/src/lib/bip143.ts";
import { addressFromScript, hex, p2wpkhScript, parseRootKey, scriptFromAddress } from "../web/src/lib/derive.ts";
import * as secp from "@noble/secp256k1";

const RPC = process.env.NEAR_RPC ?? "https://rpc.testnet.near.org";
const SIGNER = "v1.signer-prod.testnet";
const REAL_LC = "btc-client-v4.testnet";
const TESTNET3 = "https://mempool.space/testnet/api";
const HELPER = "https://helper.testnet.near.org/account";
const p = new JsonRpcProvider({ url: RPC });
const TGAS = 10n ** 12n;
const ts = Date.now().toString(36);
const report: Record<string, unknown> = {};
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const wasm = (n: string) => readFileSync(new URL(`../target/near/${n}/${n}.wasm`, import.meta.url));
const view = async (c: string, m: string, a: object = {}) => {
  const r: any = await p.query({ request_type: "call_function", account_id: c, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString("base64"), finality: "optimistic" });
  return JSON.parse(Buffer.from(r.result).toString() || "null");
};
const chainNow = async () => Number(BigInt((await p.block({ finality: "optimistic" })).header.timestamp_nanosec) / 1_000_000_000n);
async function until<T>(what: string, f: () => Promise<T | null | false | undefined>, ms = 180_000): Promise<T> {
  const t0 = Date.now();
  for (;;) { const v = await f(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("timed out: " + what); await sleep(3000); }
}
async function account(prefix: string) {
  const kp = KeyPairEd25519.fromRandom();
  const id = `${prefix}-${ts}.testnet`;
  const r = await fetch(HELPER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }) });
  if (!r.ok) throw new Error(`faucet ${id}: ${r.status} ${await r.text()}`);
  await sleep(2500);
  return { id, acc: new Account(id, p, new KeyPairSigner(kp)) };
}
type U = Awaited<ReturnType<typeof account>>;
const call = (u: U, contractId: string, methodName: string, args: object, deposit = 0n, gas = 300n) => u.acc.callFunction({ contractId, methodName, args, deposit, gas: gas * TGAS });
async function deploy(u: U, file: string, init: string, args: object) {
  await u.acc.deployContract(wasm(file));
  await call(u, u.id, init, args, 0n, 100n);
}
const addrFromSecret = (b: number) => addressFromScript(p2wpkhScript(secp.getPublicKey(new Uint8Array(32).fill(b), true)), "Testnet4");
/** Minimal legacy-format tx paying `value` to `script` (stands in for the seller's deposit). */
function fakeDeposit(script: Uint8Array, value: bigint, salt: number) {
  const le = (n: bigint, w: number) => { const b = new Uint8Array(w); for (let i = 0; i < w; i++) b[i] = Number((n >> BigInt(8 * i)) & 0xffn); return b; };
  const raw = new Uint8Array([...le(2n, 4), 1, ...new Uint8Array(32).fill(salt), ...le(0n, 4), 0, ...le(0xffffffffn, 4), 1, ...le(value, 8), script.length, ...script, ...le(0n, 4)]);
  const h = hex.to(raw);
  return { raw: h, txid: txidOf(h) };
}
const proofFor = (raw: string) => ({ tx_raw: raw, block_hash: "00".repeat(32), tx_index: 0, merkle_proof: [], coinbase_tx_id: "00".repeat(32), coinbase_merkle_proof: [] });

// ── accounts and contracts
const [covered, lc, usdc, seller, buyer] = [await account("cv"), await account("lc"), await account("us"), await account("sl"), await account("by")];
log("accounts", covered.id, seller.id, buyer.id);
const rootKey: string = await view(SIGNER, "public_key", { domain_id: 0 });
await deploy(lc, "mock_btc_client", "new", {});
await deploy(usdc, "mock_usdc", "new", {});
await deploy(covered, "covered", "new", { params: {
  signer: SIGNER, light_client: lc.id, usdc: usdc.id, usdc_decimals: 6, network: "Testnet4", min_conf: 1, fee_sats: 300,
  grace_s: 180, buy_cutoff_s: 0, min_lead_s: 60, escrow_timeout_s: 3600, min_size_sats: 100000, expiry_step_s: 60, expiry_offset_s: 0,
  mpc_root_key: rootKey, derivation_prefix: "near-mpc-recovery v0.1.0 epsilon derivation:", sign_format: 2, sign_deposit: "1",
}});
await call(covered, usdc.id, "storage_deposit", {}, 10n ** 22n, 30n);
await call(seller, usdc.id, "storage_deposit", {}, 10n ** 22n, 30n);
await call(usdc, usdc.id, "mint", { account_id: buyer.id, amount: "1000000000000" }, 0n, 30n);
log("deployed covered with the real signer; root key", rootKey.slice(0, 24) + "…");

async function createFunded(sizeSats: bigint, strike: string, premium: string, leadS = 60) {
  const p0 = await view(covered.id, "get_params");
  const now = await chainNow();
  const expiry = Math.ceil((now + Number(p0.min_lead_s) + leadS) / 60) * 60;
  const serial: number = Number(await call(seller, covered.id, "create_offer", { terms: { size_sats: String(sizeSats), strike_units: strike, premium_units: premium, expiry_s: String(expiry), refund_address: addrFromSecret(9) } }, 10n ** 23n, 100n));
  const o = await view(covered.id, "get_offer", { serial });
  // 1. the address the contract derived = the address the real signer derives for (covered, path)
  const live: string = await view(SIGNER, "derived_public_key", { path: o.path, predecessor: covered.id, domain_id: 0 });
  const livePk = secp.ProjectivePoint.fromHex(parseRootKey(live)).toRawBytes(true);
  if (hex.to(livePk) !== o.derived_pubkey) throw new Error(`derived key mismatch: contract ${o.derived_pubkey} vs signer ${hex.to(livePk)}`);
  if (addressFromScript(p2wpkhScript(livePk), "Testnet4") !== o.address) throw new Error("address mismatch");
  log(`CV-${serial}: deposit address ${o.address} matches the real signer's derived key`);
  const dep = fakeDeposit(scriptFromAddress(o.address, "Testnet4"), sizeSats, serial);
  await call(lc, lc.id, "set_included", { tx_id: dep.txid, block_hash: "00".repeat(32), depth: 6 }, 0n, 30n);
  await call(seller, covered.id, "confirm_deposit", { serial, proof: proofFor(dep.raw) }, 0n, 150n);
  const f = await view(covered.id, "get_offer", { serial });
  if (f.state !== "Funded") throw new Error(`CV-${serial} not funded: ${f.state}`);
  return { serial, expiry, grace: Number(p0.grace_s) };
}
/** Calls whose receipts include an MPC `sign` (yield/resume) can outlive the RPC's wait; the state is the truth. */
const signing = (u: U, m: string, a: object) => call(u, covered.id, m, a, 0n, 300n).catch((e) => log(`${m}: ${String((e as Error).message ?? e).slice(0, 240)}`));
async function signedAndValid(serial: number, label: string, by: U) {
  const o = await until(`CV-${serial} Signed by the MPC`, async () => {
    const x = await view(covered.id, "get_offer", { serial });
    if (x.state === "Signed") return x;
    if (x.state === "Committed" && x.retry_after_s && (await chainNow()) >= Number(x.retry_after_s)) { log(`CV-${serial} still Committed; re-requesting the same sighash`); await signing(by, "request_signature", { serial }); }
    return null;
  }, 420_000);
  const v = verifySignedTx(o.signed_tx, o.commitment_sighash, Buffer.from(o.derived_pubkey, "hex"));
  if (!v.ok) throw new Error(`${label}: MPC signature does not verify: ${v.reason}`);
  log(`CV-${serial} ${label}: real MPC signature verifies against the derived key; tx ${o.commitment_txid}`);
  report[label] = { serial, txid: o.commitment_txid, sighash: o.commitment_sighash, signed_tx: o.signed_tx };
  return o;
}

// ── 2. WITHDRAW with the real MPC
const a = await createFunded(200_000n, "150000000000", "5000000");
await signing(seller, "withdraw", { serial: a.serial });
await signedAndValid(a.serial, "withdraw", seller);

// ── 3. EXERCISE with the real MPC, in real time
const b = await createFunded(300_000n, "100000000000", "7000000");
const to = addrFromSecret(10);
const bo = await view(covered.id, "get_offer", { serial: b.serial });
await call(buyer, usdc.id, "ft_transfer_call", { receiver_id: covered.id, amount: bo.premium_units, msg: JSON.stringify({ serial: b.serial, btc_address: to }) }, 1n, 150n);
log(`CV-${b.serial} sold; waiting for expiry in real time (${b.expiry - (await chainNow())} s)`);
await until("expiry", async () => (await chainNow()) >= b.expiry + 2, 300_000);
await call(buyer, usdc.id, "ft_transfer_call", { receiver_id: covered.id, amount: bo.strike_total_units, msg: JSON.stringify({ serial: b.serial, exercise: true }) }, 1n, 300n);
const bc = await view(covered.id, "get_offer", { serial: b.serial });
if (bc.state !== "Committed" || bc.commitment_to_address !== to) throw new Error(`exercise did not commit to the buyer: ${bc.state} ${bc.commitment_to_address}`);
await signing(buyer, "request_signature", { serial: b.serial });
const bs = await signedAndValid(b.serial, "exercise", buyer);
await call(lc, lc.id, "set_included", { tx_id: bs.commitment_txid, block_hash: "00".repeat(32), depth: 1 }, 0n, 30n);
await call(buyer, covered.id, "confirm_spend", { serial: b.serial, proof: proofFor(bs.signed_tx) }, 0n, 150n);
if ((await view(covered.id, "get_offer", { serial: b.serial })).state !== "Exercised") throw new Error("not Exercised");
await call(seller, covered.id, "claim", {}, 0n, 100n);
const bal = BigInt(await view(usdc.id, "ft_balance_of", { account_id: seller.id }));
const expect = BigInt(bo.premium_units) + BigInt(bo.strike_total_units);
if (bal !== expect) throw new Error(`seller got ${bal}, expected ${expect}`);
const acc = await view(covered.id, "get_accounting");
const held = BigInt(await view(usdc.id, "ft_balance_of", { account_id: covered.id }));
if (BigInt(acc.claimable_total) + BigInt(acc.escrow_total) !== held) throw new Error("accounting invariant broken");
log(`CV-${b.serial} Exercised; seller claimed ${Number(bal) / 1e6} USDC; accounting holds`);

// ── 4. the REAL light client accepts our proof of a real testnet3 transaction
const lcTip = Number(await view(REAL_LC, "get_last_block_height"));
const api = esplora(TESTNET3);
const height = lcTip - 8;
const blockHash = await api.blockHashAt(height);
const txids = await api.blockTxids(blockHash);
const txid = txids[Math.min(1, txids.length - 1)];
const { proof } = await buildProof(api, txid);
const args = lcArgsV2({ txid, ...proof }, 6);
const rv = async (bytes: Uint8Array) => { try { const r: any = await p.query({ request_type: "call_function", account_id: REAL_LC, method_name: "verify_transaction_inclusion_v2", args_base64: Buffer.from(bytes).toString("base64"), finality: "final" }); return Buffer.from(r.result).toString(); } catch (e) { return "error: " + String((e as Error).message).slice(0, 160); } };
const good = await rv(args);
const tampered = Uint8Array.from(args); tampered[0] ^= 1;
const bad = await rv(tampered);
log(`real light client (${REAL_LC}, tip ${lcTip}): proof of ${txid} at ${height} → ${good}; tampered → ${bad}`);
const yes = (r: string) => r === "true" || r === "\u0001";
if (!yes(good)) throw new Error("real light client rejected our proof");
if (yes(bad)) throw new Error("real light client accepted a tampered proof");
report.light_client = { lcTip, height, txid, good, bad };
report.contract = covered.id;
writeFileSync(new URL("./artifacts/testnet-report.json", import.meta.url), JSON.stringify(report, null, 2));
log("TESTNET L2 PASSED");
