/**
 * The relayer's decision function: given the open offers, chain views and the
 * clock, which contract calls and broadcasts are due. Pure, so it is tested
 * without a network; `run.ts` executes the returned actions.
 */
export interface OfferView {
  serial: number; state: string; address: string; size_sats: string; expiry_s: string;
  collateral_txid?: string | null; commitment_txid?: string | null; signed_tx?: string | null; retry_after_s?: string | null;
}
export interface Params { min_conf: number; grace_s: number }
export interface ChainView {
  /** confirmed txs paying `address` exactly `size_sats` in one output: txid and depth */
  depositsAt: Record<string, { txid: string; depth: number }[]>;
  /** depth of a txid if it is in the chain (0 = mempool, undefined = unknown) */
  depthOf: Record<string, number | undefined>;
}
export type Action =
  | { kind: "confirm_deposit"; serial: number; txid: string }
  | { kind: "settle"; serial: number }
  | { kind: "request_signature"; serial: number }
  | { kind: "broadcast"; serial: number; raw: string }
  | { kind: "confirm_spend"; serial: number; txid: string };

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
        if (nowS >= Number(o.retry_after_s ?? 0)) out.push({ kind: "request_signature", serial: o.serial });
        break;
      case "Signed": {
        const depth = chain.depthOf[o.commitment_txid ?? ""];
        if (depth === undefined && o.signed_tx) out.push({ kind: "broadcast", serial: o.serial, raw: o.signed_tx });
        else if (depth !== undefined && depth >= params.min_conf) out.push({ kind: "confirm_spend", serial: o.serial, txid: o.commitment_txid! });
        break;
      }
    }
  }
  return out;
}
