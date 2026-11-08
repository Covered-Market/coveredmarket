/**
 * The seller's exit, with nothing but Bitcoin: sweep an offer's deposit with the rescue key from its kit,
 * once Bitcoin's median time past has reached the kit's `unlock_s`. No NEAR, no CoveredMarket server.
 *
 *   bin/coveredmarket rescue kit.json <your-bitcoin-address> [--fee-rate 5] [--esplora https://mempool.space/api] [--broadcast]
 *
 * Without --broadcast it prints the signed transaction for you to inspect or broadcast elsewhere.
 * Mirrors contracts/coveredmarket/src/btc.rs `build_rescue` / `finalize_rescue` (a test pins them byte for byte).
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha256";
import { base58, bech32 } from "@scure/base";
import { readFileSync } from "node:fs";
import { failoverFetch } from "./btc/failover.js";

const hx = { to: (b: Uint8Array) => Buffer.from(b).toString("hex"), from: (h: string) => Uint8Array.from(Buffer.from(h, "hex")) };
const d2 = (b: Uint8Array) => sha256(sha256(b));
const cat = (...a: Uint8Array[]) => Uint8Array.from(Buffer.concat(a.map((x) => Buffer.from(x))));
const le32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return Uint8Array.from(b); };
const le64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return Uint8Array.from(b); };
const varint = (n: number) => (n < 0xfd ? Uint8Array.of(n) : Uint8Array.of(0xfd, n & 0xff, n >> 8));
const push = (b: Uint8Array) => cat(varint(b.length), b);
const rev = (h: string) => hx.from(h).reverse();

export function scriptFromAddress(addr: string, hrp: string): Uint8Array {
  const d = bech32.decode(addr as `${string}1${string}`, 90);
  if (d.prefix !== hrp) throw new Error(`address is not for this network (${hrp})`);
  const [v, ...rest] = d.words;
  if (v !== 0) throw new Error("only v0 witness addresses (bc1q… / tb1q… / bcrt1q…)");
  const prog = bech32.fromWords(rest);
  return Uint8Array.from([0x00, prog.length, ...prog]);
}
export function wifToKey(wif: string): Uint8Array {
  const b = base58.decode(wif);
  const body = b.slice(0, -4);
  if (hx.to(d2(body).slice(0, 4)) !== hx.to(b.slice(-4))) throw new Error("bad WIF checksum");
  return body.slice(1, 33);
}

export interface Utxo { txid: string; vout: number; value: bigint }
/** Build and sign the exit transaction for one or more deposit outputs. */
export function buildRescue(utxos: Utxo[], witnessScript: Uint8Array, toScript: Uint8Array, feeSats: bigint, unlockS: number, priv: Uint8Array) {
  const total = utxos.reduce((a, u) => a + u.value, 0n);
  const amount = total - feeSats;
  if (amount <= 546n) throw new Error("nothing left after the fee");
  const seq = le32(0xfffffffd);
  const prevouts = utxos.map((u) => cat(rev(u.txid), le32(u.vout)));
  const output = cat(le64(amount), push(toScript));
  const hashPrevouts = d2(cat(...prevouts)), hashSequence = d2(cat(...utxos.map(() => seq))), hashOutputs = d2(output);
  const witnesses = utxos.map((u, i) => {
    const pre = cat(le32(2), hashPrevouts, hashSequence, prevouts[i], push(witnessScript), le64(u.value), seq, hashOutputs, le32(unlockS), le32(1));
    const sig = secp256k1.sign(d2(pre), priv, { lowS: true, prehash: false, format: "der" } as any) as unknown as Uint8Array;
    const der = sig instanceof Uint8Array ? sig : (sig as any).toDERRawBytes();
    return cat(Uint8Array.of(3), push(cat(der, Uint8Array.of(1))), Uint8Array.of(0), push(witnessScript));
  });
  const ins = prevouts.map((p) => cat(p, Uint8Array.of(0), seq));
  const raw = cat(le32(2), Uint8Array.of(0, 1), varint(utxos.length), ...ins, Uint8Array.of(1), output, ...witnesses, le32(unlockS));
  const txid = hx.to(d2(cat(le32(2), varint(utxos.length), ...ins, Uint8Array.of(1), output, le32(unlockS))).reverse());
  return { raw: hx.to(raw), txid, amount };
}

async function main(argv: string[]) {
  const [kitPath, to, ...rest] = argv;
  if (!kitPath || !to) { console.error("usage: rescue <kit.json> <your-bitcoin-address> [--fee-rate N] [--esplora URL[,URL]] [--broadcast]"); process.exit(2); }
  const opt = (k: string) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
  const kit = JSON.parse(readFileSync(kitPath === "-" ? 0 : kitPath, "utf8"));
  if (kit.kind !== "coveredmarket-rescue-kit") throw new Error("not a CoveredMarket rescue kit");
  const defaults: Record<string, string> = { mainnet: "https://mempool.space/api,https://blockstream.info/api", testnet3: "https://mempool.space/testnet/api,https://blockstream.info/testnet/api", regtest: "http://localhost:8787/btc" };
  const get = failoverFetch(opt("--esplora") ?? defaults[kit.bitcoin_network]);
  const ws = hx.from(kit.witness_script);
  const priv = wifToKey(kit.rescue_private_key_wif);
  if (hx.to(secp256k1.getPublicKey(priv, true)) !== kit.rescue_public_key) throw new Error("kit key does not match its public key");
  const utxos: Utxo[] = (await (await get(`/address/${kit.address}/utxo`)).json()).filter((u: any) => u.status?.confirmed).map((u: any) => ({ txid: u.txid, vout: u.vout, value: BigInt(u.value) }));
  if (!utxos.length) { console.log(`nothing confirmed at ${kit.address} (already settled or swept?)`); return; }
  const tipHash = (await (await get(`/blocks/tip/hash`)).text()).trim();
  const mtp = Number((await (await get(`/block/${tipHash}`)).json()).mediantime ?? 0);
  if (mtp && mtp < kit.unlock_s) console.log(`note: Bitcoin's median time past is ${new Date(mtp * 1000).toISOString()}; the exit unlocks at ${kit.unlock_utc}. Nodes will refuse it until then.`);
  const rate = BigInt(opt("--fee-rate") ?? (await (await get(`/fee-estimates`)).json().catch(() => ({})))["6"] ?? 5);
  const vbytes = BigInt(11 + 41 * utxos.length + 31 + Math.ceil((utxos.length * (1 + 73 + 1 + 1 + ws.length)) / 4));
  const fee = rate * vbytes;
  const r = buildRescue(utxos, ws, scriptFromAddress(to, kit.hrp), fee, kit.unlock_s, priv);
  console.log(`sweeping ${utxos.length} output(s), ${r.amount} sats to ${to} (fee ${fee})\ntxid ${r.txid}\n${r.raw}`);
  if (rest.includes("--broadcast")) {
    const b = await get(`/tx`, { method: "POST", body: r.raw });
    console.log(b.ok ? `broadcast: ${(await b.text()).trim()}` : `refused: ${(await b.text()).slice(0, 300)}`);
    if (!b.ok) process.exit(1);
  }
}
if (process.argv[1]?.endsWith("rescue.ts") || process.argv[1]?.endsWith("rescue.js")) main(process.argv.slice(2)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
