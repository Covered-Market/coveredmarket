/**
 * Bitcoin Core RPC backend. Implements the Esplora interface the proof builder
 * uses, plus the handful of Esplora routes the web app calls, so a local stack
 * needs no electrs/esplora. Address lookups use `scantxoutset`/`listunspent`
 * on a watch-only wallet named `covered` (created on start).
 */
import type { Esplora } from "./proof.js";
import { txidOf, merkleRoot } from "./proof.js";

export interface CoreCfg { url: string; user: string; pass: string; wallet?: string }

export class Core implements Esplora {
  private id = 0;
  constructor(private cfg: CoreCfg, private fetchFn: typeof fetch = fetch) {}

  async rpc<T = any>(method: string, params: unknown[] = [], wallet = false): Promise<T> {
    const url = wallet ? `${this.cfg.url}/wallet/${this.cfg.wallet ?? "covered"}` : this.cfg.url;
    const r = await this.fetchFn(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Basic " + Buffer.from(`${this.cfg.user}:${this.cfg.pass}`).toString("base64") }, body: JSON.stringify({ jsonrpc: "1.0", id: ++this.id, method, params }) });
    const j = await r.json();
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result;
  }
  /** Create the watch-only wallet once; import addresses as they are watched. */
  async ensureWallet() {
    const name = this.cfg.wallet ?? "covered";
    const list: string[] = await this.rpc("listwallets");
    if (!list.includes(name)) {
      try { await this.rpc("loadwallet", [name]); } catch { await this.rpc("createwallet", [name, true, true, "", false, true]); }
    }
  }
  private watched = new Set<string>();
  /** Watch an address; rescans from genesis the first time (regtest/testnet4 chains are small enough). */
  async watch(address: string) {
    if (this.watched.has(address)) return;
    await this.rpc("importdescriptors", [[{ desc: await this.descriptor(address), timestamp: 0, label: "covered" }]], true);
    this.watched.add(address);
  }
  private async descriptor(address: string) { const d = await this.rpc("getdescriptorinfo", [`addr(${address})`]); return d.descriptor; }

  // ---- Esplora interface ----
  async txHex(txid: string) { return this.rpc<string>("getrawtransaction", [txid]); }
  async merkleProof(txid: string) {
    const tx = await this.rpc("getrawtransaction", [txid, true]);
    if (!tx.blockhash) throw new Error("unconfirmed");
    const block = await this.rpc("getblock", [tx.blockhash, 1]);
    const txids: string[] = block.tx;
    const pos = txids.indexOf(txid);
    return { block_height: block.height, merkle: branch(txids, pos), pos };
  }
  async blockHashAt(height: number) { return this.rpc<string>("getblockhash", [height]); }
  async block(hash: string) { const b = await this.rpc("getblock", [hash, 1]); return { id: b.hash, height: b.height, merkle_root: b.merkleroot, tx_count: b.nTx }; }
  async tipHeight() { return this.rpc<number>("getblockcount"); }

  // ---- web-app routes ----
  async addressTxs(address: string) {
    await this.watch(address);
    const utxos: any[] = await this.rpc("listunspent", [0, 9999999, [address], true], true);
    const tip = await this.tipHeight();
    const byTx = new Map<string, any>();
    for (const u of utxos) {
      if (!byTx.has(u.txid)) {
        const tx = await this.rpc("getrawtransaction", [u.txid, true]);
        const confirmed = !!tx.blockhash;
        const height = confirmed ? (await this.rpc("getblockheader", [tx.blockhash])).height : undefined;
        byTx.set(u.txid, { txid: u.txid, status: { confirmed, block_height: height }, vout: tx.vout.map((v: any) => ({ scriptpubkey_address: v.scriptPubKey.address, value: Math.round(v.value * 1e8) })) });
      }
    }
    void tip;
    return [...byTx.values()];
  }
  async txStatus(txid: string) {
    try { const tx = await this.rpc("getrawtransaction", [txid, true]); const h = tx.blockhash ? (await this.rpc("getblockheader", [tx.blockhash])).height : undefined; return { confirmed: !!tx.blockhash, block_height: h }; }
    catch { return null; }
  }
  /** Esplora-style outspend. If spent, find the spending tx by scanning recent blocks (bounded; fine for regtest). */
  async outspend(txid: string, vout: number) {
    const o = await this.rpc("gettxout", [txid, vout, true]);
    if (o !== null) return { spent: false };
    const tip = await this.tipHeight();
    for (let h = tip; h >= Math.max(0, tip - 500); h--) {
      const b = await this.rpc("getblock", [await this.blockHashAt(h), 2]);
      for (const tx of b.tx) if (tx.vin.some((i: any) => i.txid === txid && i.vout === vout)) return { spent: true, txid: tx.txid };
    }
    return { spent: true };
  }
  async broadcast(raw: string) { if (!txidOf(raw)) throw new Error("bad tx"); return this.rpc<string>("sendrawtransaction", [raw]); }
  /** Regtest only: the `miner` wallet the local bootstrap creates and funds. */
  private miner<T = any>(method: string, params: unknown[] = []) { return new Core({ ...this.cfg, wallet: "miner" }, this.fetchFn).rpc<T>(method, params, true); }
  async mine(n: number) { const addr = await this.miner<string>("getnewaddress"); return this.rpc("generatetoaddress", [n, addr]); }
  async send(address: string, btc: number) { return this.miner<string>("sendtoaddress", [address, btc]); }
  async newAddress() { return this.miner<string>("getnewaddress", ["", "bech32"]); }
}

/** Merkle branch for `pos` in a block's txid list (display-order hex). */
export function branch(txids: string[], pos: number): string[] {
  const out: string[] = [];
  let level = txids.slice();
  let idx = pos;
  while (level.length > 1) {
    if (level.length % 2 === 1) level.push(level[level.length - 1]);
    const sib = level[idx ^ 1];
    out.push(sib);
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(merkleRoot(level[i], 0, [level[i + 1]]));
    level = next;
    idx >>= 1;
  }
  return out;
}
