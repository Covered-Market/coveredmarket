/**
 * The relayer's decision function: given the open offers, chain views and the
 * clock, which contract calls and broadcasts are due. Pure, so it is tested
 * without a network; `run.ts` executes the returned actions.
 */
export interface OfferView {
  serial: number; state: string; address: string; size_sats: string; expiry_s: string;
  collateral_txid?: string | null; collateral_vout?: number | null; commitment_txid?: string | null; signed_tx?: string | null; retry_after_s?: string | null;
  prior_txids?: string[]; signed_at_s?: string | null; commitment_fee_sats?: string | null;
}
export interface Params { min_conf: number; grace_s: number; fee_bump_after_s?: number; max_fee_sats?: number }
export interface ChainView {
  /** confirmed txs paying `address` exactly `size_sats` in one output: txid and depth */
  depositsAt: Record<string, { txid: string; depth: number }[]>;
  /** depth of a txid if it is in the chain (0 = mempool, undefined = unknown) */
  depthOf: Record<string, number | undefined>;
  /** the transaction that actually spent an offer's collateral (any committed version), by serial */
  spentBy?: Record<number, { txid: string; depth: number }>;
}
export type Action =
  | { kind: "confirm_deposit"; serial: number; txid: string }
  | { kind: "settle"; serial: number }
  | { kind: "request_signature"; serial: number }
  | { kind: "broadcast"; serial: number; raw: string }
  | { kind: "confirm_spend"; serial: number; txid: string }
  | { kind: "bump_fee"; serial: number };

export function plan(offers: OfferView[], params: Params, chain: ChainView, nowS: number): Action[] {
  const out: Action[] = [];
  for (const o of offers) {
    const expiry = Number(o.expiry_s);
    switch (o.state) {
      case "Created": {
        const d = (chain.depositsAt[o.address] ?? []).find((x) => x.depth >= params.min_conf);
        if (d) out.push({ kind: "confirm_deposit", serial: o.serial, txid: d.txid });
        break;
      }
      case "Sold":
        if (nowS >= expiry + params.grace_s) out.push({ kind: "settle", serial: o.serial });
        break;
      case "Committed":
      case "Signed": {
        // Whichever committed version Bitcoin confirmed settles the offer (an earlier, lower-fee one included).
        const spent = chain.spentBy?.[o.serial];
        const versions = [o.commitment_txid, ...(o.prior_txids ?? [])];
        if (spent && versions.includes(spent.txid)) {
          if (spent.depth >= params.min_conf) out.push({ kind: "confirm_spend", serial: o.serial, txid: spent.txid });
          break;
        }
        if (o.state === "Committed") {
          if (nowS >= Number(o.retry_after_s ?? 0)) out.push({ kind: "request_signature", serial: o.serial });
          break;
        }
        const depth = chain.depthOf[o.commitment_txid ?? ""];
        if (depth === undefined && o.signed_tx) out.push({ kind: "broadcast", serial: o.serial, raw: o.signed_tx });
        else if (depth !== undefined && depth >= params.min_conf) out.push({ kind: "confirm_spend", serial: o.serial, txid: o.commitment_txid! });
        else if (depth === 0 && params.fee_bump_after_s !== undefined && nowS >= Number(o.signed_at_s ?? Infinity) + params.fee_bump_after_s && Number(o.commitment_fee_sats ?? 0) < Number(params.max_fee_sats ?? 0))
          out.push({ kind: "bump_fee", serial: o.serial }); // stuck in the mempool: re-sign with double the fee
        break;
      }
    }
  }
  return out;
}
