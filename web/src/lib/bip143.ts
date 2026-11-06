/** The contract's settlement transaction, rebuilt in the browser (Verify check 6). Must match contracts/covered/src/btc.rs. */
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

/**
 * Parse the witness of a signed one-input tx and check it is the MPC branch of `witnessScript`:
 * `[DER(sig)||01, 01, witnessScript]`, the script's first key is `pubkey33`, and the signature verifies over `sighash`.
 */
export function verifySignedTx(signedHex: string, sighash: string, pubkey33: Uint8Array, witnessScript: Uint8Array): { ok: boolean; reason?: string } {
  const b = hex.from(signedHex);
  if (!(b[4] === 0 && b[5] === 1)) return { ok: false, reason: "not segwit" };
  // version(4) marker(2) nIn(1) prevout(36) scriptlen(1=0) seq(4) nOut(1) value(8) scriptlen(1) script … witness … locktime
  let o = 6 + 1 + 36 + 1 + 4 + 1 + 8;
  const sl = b[o]; o += 1 + sl;
  const nItems = b[o]; o += 1;
  if (nItems !== 3) return { ok: false, reason: "witness must be [sig, 01, witness script]" };
  const sigLen = b[o]; const sig = b.slice(o + 1, o + 1 + sigLen); o += 1 + sigLen;
  const selLen = b[o]; const sel = b.slice(o + 1, o + 1 + selLen); o += 1 + selLen;
  const wsLen = b[o]; const ws = b.slice(o + 1, o + 1 + wsLen);
  if (!(selLen === 1 && sel[0] === 1)) return { ok: false, reason: "not the MPC branch" };
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
