/** Build and locally verify a light-client inclusion proof from mempool.space (or any Esplora API). */
import { sha256 } from "@noble/hashes/sha256";
import { failoverFetch } from "./failover.js";

export interface Esplora {
  txHex(txid: string): Promise<string>;
  merkleProof(txid: string): Promise<{ block_height: number; merkle: string[]; pos: number }>;
  blockHashAt(height: number): Promise<string>;
  block(hash: string): Promise<{ id: string; height: number; merkle_root: string; tx_count: number }>;
  tipHeight(): Promise<number>;
  /** All txids of a block in order (display hex). */
  blockTxids(hash: string): Promise<string[]>;
}

/** The proof shape the contract takes (`Proof` in lib.rs). Hashes in display order. */
export interface Proof { tx_raw: string; block_hash: string; tx_index: number; merkle_proof: string[]; coinbase_tx_id: string; coinbase_merkle_proof: string[] }

export function esplora(base: string | string[], fetchFn: typeof fetch = fetch): Esplora {
  const get = failoverFetch(base, fetchFn);
  const j = async (p: string) => { const r = await get(p); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); };
  const t = async (p: string) => { const r = await get(p); if (!r.ok) throw new Error(`${p}: ${r.status}`); return (await r.text()).trim(); };
  return {
    txHex: (id) => t(`/tx/${id}/hex`),
    merkleProof: (id) => j(`/tx/${id}/merkle-proof`),
    blockHashAt: (h) => t(`/block-height/${h}`),
    block: (hash) => j(`/block/${hash}`),
    tipHeight: async () => Number(await t(`/blocks/tip/height`)),
    blockTxids: (hash) => j(`/block/${hash}/txids`),
  };
}

const hexToBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
const bytesToHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const sha256d = (b: Uint8Array): Uint8Array => sha256(sha256(b));
/** display-order hex ↔ internal byte order */
const rev = (h: string) => bytesToHex(hexToBytes(h).reverse());

/** Non-witness txid (BIP-141) of a raw transaction, display order. */
export function txidOf(rawHex: string): string {
  const raw = hexToBytes(rawHex);
  const stripped = stripWitness(raw);
  return rev(bytesToHex(sha256d(stripped)));
}

function readVarInt(b: Uint8Array, o: number): [number, number] {
  const f = b[o];
  if (f < 0xfd) return [f, o + 1];
  if (f === 0xfd) return [b[o + 1] | (b[o + 2] << 8), o + 3];
  if (f === 0xfe) return [(b[o + 1] | (b[o + 2] << 8) | (b[o + 3] << 16) | (b[o + 4] << 24)) >>> 0, o + 5];
  throw new Error("varint too large");
}

/** Remove the segwit marker/flag and witness fields so the hash is the txid, not the wtxid. */
export function stripWitness(raw: Uint8Array): Uint8Array {
  if (!(raw[4] === 0x00 && raw[5] === 0x01)) return raw;
  let o = 6;
  const [nIn, o1] = readVarInt(raw, o); o = o1;
  for (let i = 0; i < nIn; i++) { o += 36; const [l, o2] = readVarInt(raw, o); o = o2 + l + 4; }
  const [nOut, o3] = readVarInt(raw, o); o = o3;
  for (let i = 0; i < nOut; i++) { o += 8; const [l, o4] = readVarInt(raw, o); o = o4 + l; }
  const bodyEnd = o;
  for (let i = 0; i < nIn; i++) { const [n, o5] = readVarInt(raw, o); o = o5; for (let k = 0; k < n; k++) { const [l, o6] = readVarInt(raw, o); o = o6 + l; } }
  return new Uint8Array([...raw.slice(0, 4), ...raw.slice(6, bodyEnd), ...raw.slice(o, o + 4)]);
}

/** Walk a merkle branch (display-order hex) to the root (display-order hex). */
export function merkleRoot(txid: string, pos: number, branch: string[]): string {
  let h: Uint8Array = hexToBytes(rev(txid));
  let idx = pos;
  for (const sib of branch) {
    const s = hexToBytes(rev(sib));
    const buf = idx & 1 ? new Uint8Array([...s, ...h]) : new Uint8Array([...h, ...s]);
    h = sha256d(buf);
    idx >>= 1;
  }
  return rev(bytesToHex(h));
}

/** Merkle branch for `pos` in a block's txid list (display-order hex). */
export function branch(txids: string[], pos: number): string[] {
  const out: string[] = [];
  let level = txids.slice();
  let idx = pos;
  while (level.length > 1) {
    if (level.length % 2 === 1) level.push(level[level.length - 1]);
    out.push(level[idx ^ 1]);
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(merkleRoot(level[i], 0, [level[i + 1]]));
    level = next;
    idx >>= 1;
  }
  return out;
}

/** Fetch everything, verify locally against the block's merkle root, return the contract proof + depth.
 *  Includes the coinbase branch the light client's `verify_transaction_inclusion_v2` requires. */
export async function buildProof(api: Esplora, txid: string): Promise<{ proof: Proof; depth: number; height: number }> {
  const [raw, mp] = await Promise.all([api.txHex(txid), api.merkleProof(txid)]);
  if (txidOf(raw) !== txid) throw new Error("tx hex does not hash to txid");
  const blockHash = await api.blockHashAt(mp.block_height);
  const [block, tip, txids] = await Promise.all([api.block(blockHash), api.tipHeight(), api.blockTxids(blockHash)]);
  const root = merkleRoot(txid, mp.pos, mp.merkle);
  if (root !== block.merkle_root) throw new Error(`merkle mismatch: ${root} vs ${block.merkle_root}`);
  const cbBranch = branch(txids, 0);
  if (merkleRoot(txids[0], 0, cbBranch) !== block.merkle_root) throw new Error("coinbase branch does not reach the merkle root");
  return { proof: { tx_raw: raw, block_hash: blockHash, tx_index: mp.pos, merkle_proof: mp.merkle, coinbase_tx_id: txids[0], coinbase_merkle_proof: cbBranch }, depth: tip - mp.block_height + 1, height: mp.block_height };
}

/** Borsh `ProofArgsV2` for the Near-One light client — byte-identical to the contract's `ProofRef::borsh_args`. */
export function lcArgsV2(p: { txid: string; block_hash: string; tx_index: number; merkle_proof: string[]; coinbase_tx_id: string; coinbase_merkle_proof: string[] }, confirmations: number): Uint8Array {
  const h = (d: string) => hexToBytes(d).reverse();
  const u64 = (n: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
  const vec = (xs: string[]) => { const n = new Uint8Array(4); new DataView(n.buffer).setUint32(0, xs.length, true); return [n, ...xs.map(h)]; };
  const parts = [h(p.txid), h(p.block_hash), u64(p.tx_index), ...vec(p.merkle_proof), h(p.coinbase_tx_id), ...vec(p.coinbase_merkle_proof), u64(confirmations)];
  const out = new Uint8Array(parts.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of parts) { out.set(x, o); o += x.length; } return out;
}
