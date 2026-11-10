/** The contract's settlement transaction, rebuilt in the browser (Verify check 6). Must match contracts/coveredmarket/src/btc.rs. */
import * as secp from "@noble/secp256k1";
import { hex, sha256d } from "./derive.js";

const le32 = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
const le64 = (n: bigint) => { const b = new Uint8Array(8); for (let i = 0; i < 8; i++) b[i] = Number((n >> BigInt(8 * i)) & 0xffn); return b; };
const varint = (n: number) => (n < 0xfd ? new Uint8Array([n]) : new Uint8Array([0xfd, n & 0xff, n >> 8]));
const cat = (...a: Uint8Array[]) => { const out = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
const revHex = (h: string) => hex.to(hex.from(h).reverse());

export interface Spend { collateralTxid: string; vout: number; valueSats: bigint; witnessScript: Uint8Array; toScript: Uint8Array; feeSats: bigint }

/** Returns the unsigned raw tx, its txid (display order) and the BIP-143 SIGHASH_ALL digest. */
export function buildSpend(s: Spend) {
  const amount = s.valueSats - s.feeSats;
  if (amount <= 546n) throw new Error("dust");
  const prevout = cat(hex.from(revHex(s.collateralTxid)), le32(s.vout));
  const sequence = le32(0xfffffffd); // signals replace-by-fee (fee bumps)
  const output = cat(le64(amount), varint(s.toScript.length), s.toScript);
  const unsigned = cat(le32(2), varint(1), prevout, varint(0), sequence, varint(1), output, le32(0));
  const txid = revHex(hex.to(sha256d(unsigned)));
  // BIP-143 for P2WSH: scriptCode is the witness script itself
  const scriptCode = cat(varint(s.witnessScript.length), s.witnessScript);
  const pre = cat(le32(2), sha256d(prevout), sha256d(sequence), prevout, scriptCode, le64(s.valueSats), sequence, sha256d(output), le32(0), le32(1));
  const sighash = hex.to(sha256d(pre));
  return { unsignedHex: hex.to(unsigned), txid, sighash, amountSats: amount };
}

/** A segwit transaction split into its non-witness serialization (what the txid commits to) and its witness stacks. */
export function parseSegwitTx(b: Uint8Array): { stripped: Uint8Array; witnesses: Uint8Array[][] } {
  let o = 0;
  const need = (n: number) => { if (n < 0 || o + n > b.length) throw new Error("truncated transaction"); };
  const take = (n: number) => { need(n); const s = b.slice(o, o + n); o += n; return s; };
  const vi = () => { need(1); const f = b[o++]; if (f < 0xfd) return f; if (f === 0xfd) { need(2); const v = b[o] | (b[o + 1] << 8); o += 2; return v; } throw new Error("oversized varint"); };
  const version = take(4);
  if (take(2).join() !== "0,1") throw new Error("not segwit");
  const bodyStart = o;
  const nIn = vi();
  for (let i = 0; i < nIn; i++) { take(36); take(vi()); take(4); }
  const nOut = vi();
  for (let i = 0; i < nOut; i++) { take(8); take(vi()); }
  const body = b.slice(bodyStart, o);
  const witnesses: Uint8Array[][] = [];
  for (let i = 0; i < nIn; i++) { const n = vi(); const items: Uint8Array[] = []; for (let j = 0; j < n; j++) items.push(take(vi())); witnesses.push(items); }
  const locktime = take(4);
  if (o !== b.length) throw new Error("trailing bytes after the locktime");
  return { stripped: cat(version, body, locktime), witnesses };
}

/**
 * Check a signed settlement end to end: its non-witness body is exactly `unsignedHex` (the transaction rebuilt
 * from the commitment: same input, same single output, same fee, same locktime), it has one input whose witness
 * is the MPC branch of `witnessScript` (`[DER(sig)||01, 01, witnessScript]`), the script's first key is `pubkey33`,
 * and the signature verifies over `sighash`.
 */
export function verifySignedTx(signedHex: string, sighash: string, pubkey33: Uint8Array, witnessScript: Uint8Array, unsignedHex: string): { ok: boolean; reason?: string } {
  let p: ReturnType<typeof parseSegwitTx>;
  try { p = parseSegwitTx(hex.from(signedHex)); } catch (e) { return { ok: false, reason: (e as Error).message }; }
  if (hex.to(p.stripped) !== unsignedHex) return { ok: false, reason: "signed transaction body differs from the committed transaction" };
  if (p.witnesses.length !== 1) return { ok: false, reason: "must spend exactly one input" };
  const w = p.witnesses[0];
  if (w.length !== 3) return { ok: false, reason: "witness must be [sig, 01, witness script]" };
  const [sig, sel, ws] = w;
  if (!(sel.length === 1 && sel[0] === 1)) return { ok: false, reason: "not the MPC branch" };
  if (hex.to(ws) !== hex.to(witnessScript)) return { ok: false, reason: "witness script is not the deposit script" };
  if (hex.to(ws.slice(2, 35)) !== hex.to(pubkey33)) return { ok: false, reason: "script key is not the derived key" };
  if (sig[sig.length - 1] !== 1) return { ok: false, reason: "sighash type must be ALL" };
  const rs = derToCompact(sig.slice(0, -1));
  if (!rs) return { ok: false, reason: "malformed DER" };
  const ok = secp.verify(rs, hex.from(sighash), pubkey33, { lowS: true });
  return ok ? { ok } : { ok: false, reason: "signature does not verify" };
}

/** Minimal DER → 64-byte compact (r || s). */
export function derToCompact(der: Uint8Array): Uint8Array | null {
  if (der[0] !== 0x30) return null;
  let o = 2;
  const read = () => { if (der[o] !== 0x02) throw new Error("int"); const l = der[o + 1]; let v = der.slice(o + 2, o + 2 + l); o += 2 + l; while (v.length > 32 && v[0] === 0) v = v.slice(1); if (v.length > 32) throw new Error("len"); const out = new Uint8Array(32); out.set(v, 32 - v.length); return out; };
  try { const r = read(); const s = read(); return new Uint8Array([...r, ...s]); } catch { return null; }
}
