/**
 * The seven Verify checks (spec §4). Each reads public RPCs only and reports
 * verified | failed | unavailable. Clients are injected so this runs offline in tests.
 */
import { buildSpend, verifySignedTx } from "./bip143.js";
import { depositAddress, hex, scriptFromAddress, type Net } from "./derive.js";

export type Status = "verified" | "failed" | "unavailable";
export interface CheckResult { n: number; title: string; status: Status; detail: string }

export interface Offer {
  serial: number; seller: string; buyer: string | null; size_sats: string; strike_units: string; strike_total_units: string; premium_units: string;
  expiry_s: string; created_s?: string; path: string; derived_pubkey: string; address: string; refund_address: string; buyer_address: string | null;
  rescue_pubkey: string; unlock_s: string; witness_script: string; commitment_fee_sats?: string | null; prior_txids?: string[];
  collateral_txid: string | null; collateral_vout: number | null; collateral_value_sats: string | null;
  commitment_reason: string | null; commitment_txid: string | null; commitment_sighash: string | null; commitment_to_address: string | null;
  commitment_amount_sats: string | null; committed_at_s: string | null; signed_tx: string | null; escrow_units: string; state: string;
}
export interface Params { signer: string; light_client: string; usdc: string; network: Net; fee_sats: number; grace_s: number; rescue_delay_s: number; mpc_root_key: string; derivation_prefix: string;
  min_conf?: number; min_size_sats?: string | number; min_lead_s?: number; expiry_step_s?: number; expiry_offset_s?: number; escrow_timeout_s?: number; max_fee_sats?: number }
export interface Accounting { claimable_total: string; escrow_total: string; near_balance: string }

export interface Clients {
  near: {
    codeHash(account: string): Promise<string>;
    accessKeys(account: string): Promise<number>;
    view<T>(method: string, args?: Record<string, unknown>): Promise<T>;
    ftBalance(token: string, account: string): Promise<string>;
  };
  btc: {
    outspend(txid: string, vout: number): Promise<{ spent: boolean; txid?: string }>;
    txStatus(txid: string): Promise<{ confirmed: boolean; depth: number } | null>;
  };
  expected: { codeHash: string; contract: string; signer: string; lightClient: string; usdc: string; minConf: number };
}

async function guard(n: number, title: string, f: () => Promise<[Status, string]>): Promise<CheckResult> {
  try { const [status, detail] = await f(); return { n, title, status, detail }; }
  catch (e) { return { n, title, status: "unavailable", detail: (e as Error).message }; }
}

export async function runChecks(c: Clients, offer: Offer, params: Params, nowS: number): Promise<CheckResult[]> {
  const net = params.network;
  const out: CheckResult[] = [];

  out.push(await guard(1, "Deployed code and configuration", async () => {
    const [hash, keys] = await Promise.all([c.near.codeHash(c.expected.contract), c.near.accessKeys(c.expected.contract)]);
    const cfgOk = params.signer === c.expected.signer && params.light_client === c.expected.lightClient && params.usdc === c.expected.usdc;
    const ok = hash === c.expected.codeHash && keys === 0 && cfgOk;
    return [ok ? "verified" : "failed", `code ${hash.slice(0, 10)}… ${hash === c.expected.codeHash ? "matches" : "differs from"} README; ${keys} access keys; signer/light client/USDC ${cfgOk ? "as published" : "DIFFER"}`];
  }));

  out.push(await guard(2, "Address derivation and the seller's exit", async () => {
    const unlock = Number(offer.expiry_s) + params.grace_s + params.rescue_delay_s;
    const d = depositAddress(params.mpc_root_key, params.derivation_prefix, c.expected.contract, offer.path, hex.from(offer.rescue_pubkey), unlock, net);
    const ok = hex.to(d.mpc33) === offer.derived_pubkey && d.address === offer.address && hex.to(d.witnessScript) === offer.witness_script && Number(offer.unlock_s) === unlock;
    const when = new Date(unlock * 1000).toISOString().slice(0, 16).replace("T", " ");
    return [ok ? "verified" : "failed", `${c.expected.contract} + ${offer.path} → ${d.address}; only that MPC key can spend it, or the seller's own rescue key after ${when} UTC`];
  }));

  out.push(await guard(3, "Collateral inclusion and current status", async () => {
    if (!offer.collateral_txid) return ["failed", "no collateral recorded"];
    const st = await c.btc.txStatus(offer.collateral_txid);
    if (!st || !st.confirmed) return ["failed", "deposit transaction not confirmed on Bitcoin"];
    const sp = await c.btc.outspend(offer.collateral_txid, offer.collateral_vout!);
    const final = ["Kept", "Exercised", "Withdrawn"].includes(offer.state) || offer.state === "Signed";
    if (!final && sp.spent) return ["failed", `collateral already spent by ${sp.txid}`];
    const versions = [offer.commitment_txid, ...(offer.prior_txids ?? [])];
    if (final && sp.spent && !versions.includes(sp.txid ?? null)) return ["failed", `collateral spent by ${sp.txid}, not a committed version`];
    return [st.depth >= c.expected.minConf ? "verified" : "failed", `${offer.collateral_value_sats} sats at depth ${st.depth}; ${sp.spent ? "spent by the committed tx" : "unspent"}`];
  }));

  out.push(await guard(4, "Payment receipts and accounting", async () => {
    const [acc, bal] = await Promise.all([c.near.view<Accounting>("get_accounting"), c.near.ftBalance(params.usdc, c.expected.contract)]);
    const sum = BigInt(acc.claimable_total) + BigInt(acc.escrow_total);
    const ok = sum === BigInt(bal);
    const sold = offer.buyer ? `buyer ${offer.buyer}; premium ${offer.premium_units} credited to seller` : "not sold";
    return [ok ? "verified" : "failed", `${sold}; contract holds ${bal} = claimable ${acc.claimable_total} + escrow ${acc.escrow_total}${ok ? "" : " (MISMATCH)"}`];
  }));

  out.push(await guard(5, "State transitions and timestamps", async () => {
    const expiry = Number(offer.expiry_s);
    if (offer.commitment_reason === "Expiry") {
      const t = Number(offer.committed_at_s);
      return [t >= expiry + params.grace_s ? "verified" : "failed", `settled ${utc(t)}, after the window closed ${utc(expiry + params.grace_s)}`];
    }
    if (offer.commitment_reason === "Exercise") {
      const t = Number(offer.committed_at_s);
      return [t >= expiry && t < expiry + params.grace_s ? "verified" : "failed", `exercised ${utc(t)}, inside the window ${utc(expiry)} – ${utc(expiry + params.grace_s).slice(11)}`];
    }
    if (offer.state === "Sold") return ["verified", nowS < expiry ? "open; window not yet open" : nowS < expiry + params.grace_s ? "exercise window open" : "window closed; awaiting settle"];
    return ["verified", `state ${offer.state}`];
  }));

  out.push(await guard(6, "Committed transaction and signature", async () => {
    if (!offer.commitment_txid) return ["verified", "nothing committed yet"];
    const toScript = scriptFromAddress(offer.commitment_to_address!, net);
    const expectedTo = offer.commitment_reason === "Exercise" ? offer.buyer_address : offer.refund_address;
    if (offer.commitment_to_address !== expectedTo) return ["failed", `commitment pays ${offer.commitment_to_address}, expected ${expectedTo}`];
    const ws = hex.from(offer.witness_script);
    const fee = BigInt(offer.commitment_fee_sats ?? params.fee_sats);
    const r = buildSpend({ collateralTxid: offer.collateral_txid!, vout: offer.collateral_vout!, valueSats: BigInt(offer.collateral_value_sats!), witnessScript: ws, toScript, feeSats: fee });
    if (r.txid !== offer.commitment_txid || r.sighash !== offer.commitment_sighash) return ["failed", "rebuilt transaction differs from the commitment"];
    if (!offer.signed_tx) return ["verified", `rebuilt ${r.txid.slice(0, 12)}…; not signed yet`];
    const v = verifySignedTx(offer.signed_tx, r.sighash, hex.from(offer.derived_pubkey), ws);
    const bumped = offer.prior_txids?.length ? `; fee raised ${offer.prior_txids.length}× to ${fee} sats` : "";
    return [v.ok ? "verified" : "failed", v.ok ? `signature verifies against the derived key; pays ${r.amountSats} sats${bumped}` : v.reason!];
  }));

  out.push(await guard(7, "Bitcoin confirmation", async () => {
    if (!offer.commitment_txid) return ["verified", "no settlement yet"];
    let st = await c.btc.txStatus(offer.commitment_txid);
    for (const prior of offer.prior_txids ?? []) { if (st?.confirmed) break; const p = await c.btc.txStatus(prior); if (p?.confirmed) st = p; }
    if (!st) return [offer.signed_tx ? "failed" : "verified", offer.signed_tx ? "signed but not seen on Bitcoin; broadcast it" : "not signed yet"];
    return [st.confirmed ? "verified" : "failed", st.confirmed ? `confirmed at depth ${st.depth}` : "in mempool"];
  }));
  return out;
}

const utc = (t: number) => new Date(t * 1000).toISOString().slice(0, 19).replace("T", " ") + " UTC";
