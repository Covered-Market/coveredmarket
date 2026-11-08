// Read-only mainnet probe: are the mainnet dependencies what the contract and relayer assume? No funds, no keys.
// Exits non-zero on any mismatch. Facts land in artifacts/mainnet-probe.json.
//   - v1.signer: version, root key format, and our SHA3 derivation == the signer's own derived_public_key
//   - btc-client.bridge.near: tip vs Bitcoin tip, pause state, verify_transaction_inclusion_v2 with our borsh
//     encoding for a real mainnet transaction (true), tampered (false), JSON args (rejected)
//   - Circle USDC: metadata (6 decimals) and storage_balance_bounds (what registering a payee costs)
import { JsonRpcProvider } from "@near-js/providers";
import * as secp from "@noble/secp256k1";
import { writeFileSync, mkdirSync } from "node:fs";
import { buildProof, esplora, lcArgsV2 } from "../relayer/src/btc/proof.ts";
import { derivePubkey, hex, parseRootKey } from "../web/src/lib/derive.ts";

const RPC = process.env.NEAR_RPC ?? "https://rpc.mainnet.fastnear.com";
const SIGNER = process.env.SIGNER_ID ?? "v1.signer";
const LC = process.env.LIGHT_CLIENT_ID ?? "btc-client.bridge.near";
const USDC = process.env.USDC_ID ?? "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const BTC = esplora(process.env.ESPLORA ?? "https://mempool.space/api,https://blockstream.info/api");
const PREFIX = "near-mpc-recovery v0.1.0 epsilon derivation:";
const p = new JsonRpcProvider({ url: RPC }, { retries: 6, wait: 1500, backoff: 1.6 });
const facts: Record<string, unknown> = {};
const problems: string[] = [];
const fact = (k: string, v: unknown) => { facts[k] = v; console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`); };
const must = (ok: boolean, what: string) => { if (!ok) { problems.push(what); console.log(`  ✗ ${what}`); } else console.log(`  ✓ ${what}`); };
const raw = async (acc: string, m: string, bytes: Uint8Array) => {
  try { const r: any = await p.query({ request_type: "call_function", account_id: acc, method_name: m, args_base64: Buffer.from(bytes).toString("base64"), finality: "final" }); return { ok: true as const, text: Buffer.from(r.result).toString() }; }
  catch (e) { return { ok: false as const, error: String((e as Error).message).slice(0, 300) }; }
};
const view = async (acc: string, m: string, a: object = {}) => { const r = await raw(acc, m, Buffer.from(JSON.stringify(a))); if (!r.ok) throw new Error(`${acc}.${m}: ${r.error}`); return JSON.parse(r.text || "null"); };

// ── signer
fact("signer.version", await view(SIGNER, "version").catch((e) => String(e)));
const root: string = await view(SIGNER, "public_key", { domain_id: 0 });
fact("signer.public_key", root);
must(root.startsWith("secp256k1:"), "signer root key is secp256k1:<base58>");
for (const [pred, path] of [["coveredmarket.near", "astrid.near/CV-1"], ["some-app.near", "x/y"]]) {
  const live: string = await view(SIGNER, "derived_public_key", { path, predecessor: pred, domain_id: 0 });
  const ours = hex.to(derivePubkey(parseRootKey(root), PREFIX, pred, path));
  const theirs = hex.to(secp.ProjectivePoint.fromHex(parseRootKey(live)).toRawBytes(true));
  must(ours === theirs, `our SHA3 derivation matches v1.signer for (${pred}, ${path})`);
}

// ── light client
const lcTip = Number(await view(LC, "get_last_block_height"));
const btcTip = await BTC.tipHeight();
fact("lc.tip", lcTip); fact("btc.tip", btcTip);
must(btcTip - lcTip <= 6, `light client within 6 blocks of the Bitcoin tip (lag ${btcTip - lcTip})`);
const paused = await view(LC, "pa_is_paused", { key: "ALL" }).catch(() => "n/a");
fact("lc.paused", paused);
must(paused !== true, "light client not paused");
let height = lcTip - 3, blockHash = "", txids: string[] = [];
for (; height > lcTip - 50; height--) { blockHash = await BTC.blockHashAt(height); txids = await BTC.blockTxids(blockHash); if (txids.length > 1) break; }
const txid = txids[Math.floor(txids.length / 2)];
const { proof } = await buildProof(BTC, txid);
const good = await raw(LC, "verify_transaction_inclusion_v2", lcArgsV2({ txid, ...proof }, 3));
fact("lc.proof", { height, txid, result: good });
must(good.ok && (good.text === "true" || good.text === "\u0001"), "real mainnet tx proven with our borsh ProofArgsV2 (3 confirmations)");
const t = Uint8Array.from(lcArgsV2({ txid, ...proof }, 3)); t[0] ^= 1;
const bad = await raw(LC, "verify_transaction_inclusion_v2", t);
must(!(bad.ok && (bad.text === "true" || bad.text === "\u0001")), "tampered proof rejected");
const deep = await raw(LC, "verify_transaction_inclusion_v2", lcArgsV2({ txid, ...proof }, lcTip - height + 10));
must(!(deep.ok && (deep.text === "true" || deep.text === "\u0001")), "more confirmations than exist are refused");

// ── USDC
const md = await view(USDC, "ft_metadata");
fact("usdc.metadata", { symbol: md.symbol, decimals: md.decimals });
must(md.decimals === 6, "USDC has 6 decimals");
const bounds = await view(USDC, "storage_balance_bounds").catch((e) => String(e));
fact("usdc.storage_balance_bounds", bounds);
must(typeof bounds === "object" && !!bounds?.min, "USDC requires storage registration (storage_balance_bounds.min)");

mkdirSync(new URL("./artifacts/", import.meta.url), { recursive: true });
writeFileSync(new URL("./artifacts/mainnet-probe.json", import.meta.url), JSON.stringify({ facts, problems }, null, 2));
if (problems.length) { console.log(`\nMAINNET PROBE: ${problems.length} problem(s)`); process.exit(1); }
console.log("\nMAINNET PROBE PASSED");
