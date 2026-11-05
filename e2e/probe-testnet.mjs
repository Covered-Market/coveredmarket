// L2 probe: what do the live testnet dependencies actually accept and return?
// Prints JSON facts for: MPC signer (public_key, derived_public_key, sign response shape, gas),
// the Bitcoin light client (tip, pause state, v2 inclusion proof with borsh args), and testnet USDC.
import { Account } from "@near-js/accounts";
import { KeyPairEd25519, KeyPair } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { createHash } from "node:crypto";

const RPC = process.env.NEAR_RPC ?? "https://rpc.testnet.fastnear.com";
const SIGNER = process.env.SIGNER_ID ?? "v1.signer-prod.testnet";
const LC = process.env.LIGHT_CLIENT_ID ?? "btc-client-v4.testnet";
const ESPLORA = process.env.ESPLORA ?? "https://mempool.space/testnet/api";
const USDCS = (process.env.USDC_CANDIDATES ?? "usdc.fakes.testnet,3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af").split(",");
const p = new JsonRpcProvider({ url: RPC });
const out = {};
const show = (k, v) => { out[k] = v; console.log(`\n### ${k}\n${typeof v === "string" ? v : JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2)}`); };
const rawView = async (acc, method, argsBytes) => {
  try { const r = await p.query({ request_type: "call_function", account_id: acc, method_name: method, args_base64: Buffer.from(argsBytes).toString("base64"), finality: "final" }); return { ok: true, bytes: Buffer.from(r.result) }; }
  catch (e) { return { ok: false, error: String(e.message ?? e).slice(0, 400) }; }
};
const jview = async (acc, m, a = {}) => { const r = await rawView(acc, m, Buffer.from(JSON.stringify(a))); return r.ok ? JSON.parse(r.bytes.toString() || "null") : r; };

// ── signer views
show("signer.public_key", await jview(SIGNER, "public_key", {}));
show("signer.public_key domain 0", await jview(SIGNER, "public_key", { domain_id: 0 }));
show("signer.derived_public_key", await jview(SIGNER, "derived_public_key", { path: "probe/CV-1", predecessor: "covered-probe.testnet", domain_id: 0 }));
for (const m of ["config", "get_config", "state", "latest_key_version", "version"]) show(`signer.${m}`, await jview(SIGNER, m));

// ── light client views
show("lc.get_last_block_height", await jview(LC, "get_last_block_height"));
show("lc.pa_is_paused", await jview(LC, "pa_is_paused", { key: "ALL" }));
show("lc.acl_get_super_admins", await jview(LC, "acl_get_super_admins", { skip: 0, limit: 5 }));
const codeHash = (await p.query({ request_type: "view_account", account_id: LC, finality: "final" })).code_hash;
show("lc.code_hash", codeHash);

// ── a real testnet3 inclusion proof (btc-client-v4.testnet follows testnet3), borsh-encoded ProofArgsV2, checked by the live light client
const j = async (path) => { const r = await fetch(ESPLORA + path); if (!r.ok) throw new Error(path + " " + r.status); return r.headers.get("content-type")?.includes("json") ? r.json() : r.text(); };
const tip = Number(await j("/blocks/tip/height"));
const h = Math.min(tip - 10, Number(out["lc.get_last_block_height"]) - 10);
const bh = await j(`/block-height/${h}`);
const txids = await j(`/block/${bh}/txids`);
const branch = (ids, pos) => { const res = []; let level = ids.map((x) => Buffer.from(x, "hex").reverse()); let i = pos; const d = (b) => createHash("sha256").update(createHash("sha256").update(b).digest()).digest();
  while (level.length > 1) { if (level.length % 2) level.push(level.at(-1)); res.push(level[i ^ 1]); const nx = []; for (let k = 0; k < level.length; k += 2) nx.push(d(Buffer.concat([level[k], level[k + 1]]))); level = nx; i >>= 1; } return res; };
const pos = Math.min(1, txids.length - 1);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const vec = (arr) => Buffer.concat([Buffer.from(new Uint32Array([arr.length]).buffer), ...arr]);
const internal = (hex) => Buffer.from(hex, "hex").reverse();
const args = (conf) => Buffer.concat([internal(txids[pos]), internal(bh), u64(pos), vec(branch(txids, pos)), internal(txids[0]), vec(branch(txids, 0)), u64(conf)]);
show("lc.v2 probe tx", { height: h, block: bh, txid: txids[pos], pos, tip });
for (const conf of [1, tip - h - 2]) { const r = await rawView(LC, "verify_transaction_inclusion_v2", args(conf)); show(`lc.verify_transaction_inclusion_v2 conf=${conf}`, r.ok ? r.bytes.toString() : r); }
const bad = Buffer.from(args(1)); bad[40] ^= 1;
const rb = await rawView(LC, "verify_transaction_inclusion_v2", bad);
show("lc.verify_transaction_inclusion_v2 tampered", rb.ok ? rb.bytes.toString() : rb);
const jr = await rawView(LC, "verify_transaction_inclusion_v2", Buffer.from(JSON.stringify({ args: {} })));
show("lc.v2 with JSON args (expect error)", jr.ok ? jr.bytes.toString() : jr);

// ── USDC candidates
for (const u of USDCS) show(`usdc ${u}`, await jview(u, "ft_metadata"));

// ── a real sign() from a throwaway account
const kp = KeyPairEd25519.fromRandom();
const id = `covered-probe-${Date.now()}.testnet`;
let created = null;
for (const url of ["https://helper.testnet.near.org/account", "https://helper.nearprotocol.com/account"]) {
  try { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }) }); show(`faucet ${url}`, `${r.status} ${(await r.text()).slice(0, 200)}`); if (r.ok) { created = url; break; } } catch (e) { show(`faucet ${url}`, String(e)); }
}
if (created) {
  await new Promise((r) => setTimeout(r, 3000));
  const acc = new Account(id, p, new KeyPairSigner(KeyPair.fromString(kp.toString())));
  const payload = createHash("sha256").update("covered probe").digest();
  for (const [label, request, gas] of [
    ["payload_v2+domain_id 300T", { payload_v2: { Ecdsa: payload.toString("hex") }, path: "probe/CV-1", domain_id: 0 }, 300n],
    ["legacy payload+key_version 300T", { payload: [...payload], path: "probe/CV-1", key_version: 0 }, 300n],
    ["payload_v2 150T", { payload_v2: { Ecdsa: payload.toString("hex") }, path: "probe/CV-1", domain_id: 0 }, 150n],
  ]) {
    try {
      const r = await acc.callFunctionRaw({ contractId: SIGNER, methodName: "sign", args: { request }, deposit: 1n, gas: gas * 10n ** 12n, waitUntil: "FINAL" });
      const sv = r.status?.SuccessValue; show(`sign ${label}`, { status: sv !== undefined ? JSON.parse(Buffer.from(sv, "base64").toString()) : r.status, gas_burnt: r.transaction_outcome?.outcome?.gas_burnt, receipts: r.receipts_outcome?.map((o) => o.outcome.gas_burnt) });
    } catch (e) { show(`sign ${label}`, String(e.message ?? e).slice(0, 600)); }
  }
  show("derived for probe account", await jview(SIGNER, "derived_public_key", { path: "probe/CV-1", predecessor: id, domain_id: 0 }));
}
show("SUMMARY_JSON", JSON.stringify(out));
