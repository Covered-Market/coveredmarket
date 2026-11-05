/** Chain Signatures epsilon derivation, bech32 P2WPKH, hashing. Must match contracts/covered/src/derive.rs. */
import { sha256 } from "@noble/hashes/sha256";
import { sha3_256 } from "@noble/hashes/sha3";
import { ripemd160 } from "@noble/hashes/ripemd160";
import * as secp from "@noble/secp256k1";
import { base58, bech32 } from "@scure/base";

export const DEFAULT_PREFIX = "near-mpc-recovery v0.1.0 epsilon derivation:";
export const hex = {
  to: (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""),
  from: (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16)),
};
export const sha256d = (b: Uint8Array): Uint8Array => sha256(sha256(b));
export const hash160 = (b: Uint8Array): Uint8Array => ripemd160(sha256(b));
const te = new TextEncoder();

/** SHA3-256, as the live MPC signer does (confirmed against v1.signer-prod.testnet). */
export function epsilon(prefix: string, predecessor: string, path: string): bigint {
  const h = sha3_256(te.encode(`${prefix}${predecessor},${path}`));
  return BigInt("0x" + hex.to(h));
}

/** Compressed 33-byte derived key: root + epsilon·G. */
export function derivePubkey(rootKeyHex: string, prefix: string, predecessor: string, path: string): Uint8Array {
  const root = secp.ProjectivePoint.fromHex(parseRootKey(rootKeyHex));
  const eps = epsilon(prefix, predecessor, path) % secp.CURVE.n;
  return root.add(secp.ProjectivePoint.BASE.multiply(eps)).toRawBytes(true);
}

/** Accepts hex (33/65 bytes) or the signer's `secp256k1:<base58 of 64-byte x||y>` form. */
export function parseRootKey(k: string): string {
  const body = k.replace(/^secp256k1:/, "");
  if (/^[0-9a-fA-F]+$/.test(body) && (body.length === 66 || body.length === 130)) return body;
  const b = base58.decode(body);
  return (b.length === 64 ? "04" : "") + hex.to(b);
}

export type Net = "Mainnet" | "Testnet4" | "Regtest";
const HRP: Record<Net, string> = { Mainnet: "bc", Testnet4: "tb", Regtest: "bcrt" };

export function p2wpkhScript(pubkey33: Uint8Array): Uint8Array {
  return new Uint8Array([0x00, 0x14, ...hash160(pubkey33)]);
}
export function addressFromScript(script: Uint8Array, net: Net): string {
  if (script[0] !== 0x00 || (script[1] !== 0x14 && script[1] !== 0x20)) throw new Error("not a v0 witness program");
  const words = [0, ...bech32.toWords(script.slice(2))];
  return bech32.encode(HRP[net], words, 90);
}
export function scriptFromAddress(addr: string, net: Net): Uint8Array {
  const d = bech32.decode(addr as `${string}1${string}`, 90);
  if (d.prefix !== HRP[net]) throw new Error("wrong network");
  const [v, ...rest] = d.words;
  if (v !== 0) throw new Error("only v0 witness programs");
  const prog = bech32.fromWords(rest);
  return new Uint8Array([0x00, prog.length, ...prog]);
}
export function deriveAddress(rootKeyHex: string, prefix: string, predecessor: string, path: string, net: Net): string {
  return addressFromScript(p2wpkhScript(derivePubkey(rootKeyHex, prefix, predecessor, path)), net);
}
