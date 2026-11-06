/** Execute one watcher tick against real services. */
import { buildProof, txidOf, type Esplora } from "./btc/proof.js";
import { plan, type ChainView, type OfferView } from "./watcher.js";

export interface Services {
  near: { view<T>(m: string, a?: Record<string, unknown>): Promise<T>; call(m: string, a: Record<string, unknown>): Promise<unknown>; chainNow?(): Promise<number> };
  esplora: Esplora;
  broadcast(rawHex: string): Promise<string>;
  addressTxs(address: string): Promise<{ txid: string; status: { confirmed: boolean; block_height?: number }; vout: { scriptpubkey_address: string; value: number }[] }[]>;
  log(msg: string): void;
  /** Local mode only: feed the mock light client before submitting a proof. */
  beforeProof?(txid: string, blockHash: string, depth: number): Promise<void>;
}

export async function tick(s: Services, nowArg?: number) {
  const nowS = nowArg ?? (s.near.chainNow ? await s.near.chainNow() : Math.floor(Date.now() / 1000));
  const params = await s.near.view<{ min_conf: number; grace_s: number; fee_bump_after_s?: number; max_fee_sats?: number }>("get_params");
  const open = await s.near.view<OfferView[]>("get_offers", { from: 0, limit: 200 });
  const created = await s.near.view<OfferView[]>("get_created", { from: 0, limit: 200 }).catch(() => [] as OfferView[]);
  const offers = [...created, ...open];
  const tip = await s.esplora.tipHeight();
  const chain: ChainView = { depositsAt: {}, depthOf: {}, spentBy: {} };
  for (const o of offers) {
    if (o.state === "Created") {
      const txs = await s.addressTxs(o.address);
      chain.depositsAt[o.address] = txs
        .filter((t) => t.status.confirmed && t.vout.filter((v) => v.scriptpubkey_address === o.address).length === 1 && t.vout.some((v) => v.scriptpubkey_address === o.address && v.value === Number(o.size_sats)))
        .map((t) => ({ txid: t.txid, depth: tip - (t.status.block_height ?? tip) + 1 }));
    }
    if ((o.state === "Signed" || o.state === "Committed") && o.collateral_txid && o.collateral_vout != null && s.esplora.outspend) {
      try {
        const sp = await s.esplora.outspend(o.collateral_txid, o.collateral_vout);
        if (sp.spent && sp.txid) {
          let depth = 0;
          try { const mp = await s.esplora.merkleProof(sp.txid); depth = tip - mp.block_height + 1; } catch {}
          chain.spentBy![o.serial] = { txid: sp.txid, depth };
        }
      } catch {}
    }
    if (o.state === "Signed" && o.commitment_txid) {
      try { const mp = await s.esplora.merkleProof(o.commitment_txid); chain.depthOf[o.commitment_txid] = tip - mp.block_height + 1; }
      catch { chain.depthOf[o.commitment_txid] = (await s.esplora.txHex(o.commitment_txid).then(() => 0).catch(() => undefined)); }
    }
  }
  for (const a of plan(offers, params, chain, nowS)) {
    try {
      switch (a.kind) {
        case "confirm_deposit": { const { proof, depth } = await buildProof(s.esplora, a.txid); await s.beforeProof?.(a.txid, proof.block_hash, depth); await s.near.call("confirm_deposit", { serial: a.serial, proof }); break; }
        case "confirm_spend": { const { proof, depth } = await buildProof(s.esplora, a.txid); await s.beforeProof?.(a.txid, proof.block_hash, depth); await s.near.call("confirm_spend", { serial: a.serial, proof }); break; }
        case "settle": await s.near.call("settle", { serial: a.serial }); break;
        case "request_signature": await s.near.call("request_signature", { serial: a.serial }); break;
        case "bump_fee": await s.near.call("bump_fee", { serial: a.serial }); break;
        case "broadcast": { const id = await s.broadcast(a.raw); s.log(`broadcast ${a.serial}: ${id} (${txidOf(a.raw)})`); break; }
      }
      s.log(`${a.kind} ${a.serial} ok`);
    } catch (e) { s.log(`${a.kind} ${a.serial} failed: ${(e as Error).message}`); }
  }
}
