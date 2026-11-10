/**
 * The seven Verify checks (spec §4). Each reads public RPCs only and reports
 * verified | failed | unavailable. Clients are injected so this runs offline in tests.
 */
import { buildSpend, verifySignedTx } from "./bip143.js";
import { depositAddress, hex, rootKeyCompressed, scriptFromAddress, type Net } from "./derive.js";

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
    /** The signer's own root public key, read from the signer contract (not from our contract). */
    signerRootKey(signer: string): Promise<string>;
  };
  btc: {
    outspend(txid: string, vout: number): Promise<{ spent: boolean; txid?: string }>;
    txStatus(txid: string): Promise<{ confirmed: boolean; depth: number } | null>;
    /** One output of a transaction as Bitcoin has it (null if the tx or the output does not exist). */
    output(txid: string, vout: number): Promise<{ address?: string; value: number } | null>;
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
    // The contract derives addresses from the root key it was initialised with. That key must be the
    // signer's own: with any other root, whoever knows its private half could spend every deposit.
    const live = await c.near.signerRootKey(params.signer);
    if (rootKeyCompressed(live) !== rootKeyCompressed(params.mpc_root_key)) return ["failed", `the contract's root key is not ${params.signer}'s: deposit addresses would not belong to the signing network`];
    const d = depositAddress(params.mpc_root_key, params.derivation_prefix, c.expected.contract, offer.path, hex.from(offer.rescue_pubkey), unlock, net);
    const ok = hex.to(d.mpc33) === offer.derived_pubkey && d.address === offer.address && hex.to(d.witnessScript) === offer.witness_script && Number(offer.unlock_s) === unlock;
    const when = new Date(unlock * 1000).toISOString().slice(0, 16).replace("T", " ");
    return [ok ? "verified" : "failed", `${c.expected.contract} + ${offer.path} → ${d.address}; only that MPC key can spend it, or the seller's own rescue key after ${when} UTC`];
  }));

  out.push(await guard(3, "Collateral inclusion and current status", async () => {
    if (!offer.collateral_txid) return ["failed", "no collateral recorded"];
    const st = await c.btc.txStatus(offer.collateral_txid);
    if (!st || !st.confirmed) return ["failed", "deposit transaction not confirmed on Bitcoin"];
    // The recorded output must be the deposit itself: the offer's address, exactly the offer's size.
    const outp = await c.btc.output(offer.collateral_txid, offer.collateral_vout!);
    if (!outp) return ["failed", `${offer.collateral_txid}:${offer.collateral_vout} does not exist on Bitcoin`];
    if (outp.address !== offer.address) return ["failed", `the recorded output pays ${outp.address ?? "a non-address script"}, not the deposit address`];
    if (String(outp.value) !== offer.collateral_value_sats || offer.collateral_value_sats !== offer.size_sats) return ["failed", `the recorded output holds ${outp.value} sats; the offer is for ${offer.size_sats}`];
    const sp = await c.btc.outspend(offer.collateral_txid, offer.collateral_vout!);
    const versions = [offer.commitment_txid, ...(offer.prior_txids ?? [])].filter(Boolean);
    const byVersion = sp.spent && versions.includes(sp.txid ?? "");
    if (offer.state === "Rescued") {
      const own = sp.spent && !byVersion;
      return [own ? "verified" : "failed", own ? `spent by ${sp.txid}, the seller's rescue exit; no committed settlement can confirm` : "recorded as rescued, but Bitcoin does not show a rescue spend"];
    }
    if (SETTLED.includes(offer.state)) {
      // The contract says the coins moved: Bitcoin must show them moved, by a committed version.
      if (!sp.spent) return ["failed", `recorded as ${offer.state}, but the collateral is still unspent on Bitcoin`];
      if (!byVersion) return ["failed", `collateral spent by ${sp.txid}, not a committed version`];
    } else if (offer.state === "Committed" || offer.state === "Signed") {
      // A version may already be on its way (a fee bump keeps earlier versions valid); nothing else may spend it.
      if (sp.spent && !byVersion) return ["failed", `collateral spent by ${sp.txid}, not a committed version`];
    } else if (sp.spent) return ["failed", `collateral already spent by ${sp.txid} while the offer is ${offer.state}`];
    return [st.depth >= c.expected.minConf ? "verified" : "failed", `${offer.collateral_value_sats} sats at ${offer.address}, depth ${st.depth}; ${sp.spent ? "spent by the committed tx" : "unspent"}`];
  }));

  out.push(await guard(4, "Payment receipts and accounting", async () => {
    const [acc, bal] = await Promise.all([c.near.view<Accounting>("get_accounting"), c.near.ftBalance(params.usdc, c.expected.contract)]);
    const sum = BigInt(acc.claimable_total) + BigInt(acc.escrow_total);
    const held = BigInt(bal);
    // The guarantee is that every unit owed is held. Anyone can `ft_transfer` USDC to the contract without
    // `ft_on_transfer`, so the balance may exceed what is owed; that surplus is nobody's and harms no one.
    const ok = held >= sum;
    const sold = offer.buyer ? `buyer ${offer.buyer}; premium ${offer.premium_units} credited to seller` : "not sold";
    const surplus = held > sum ? `; ${held - sum} more was sent to it directly and is owed to no one` : "";
    return [ok ? "verified" : "failed", `${sold}; contract holds ${bal}, owes claimable ${acc.claimable_total} + escrow ${acc.escrow_total}${ok ? surplus : " (SHORT)"}`];
  }));

  out.push(await guard(5, "State transitions and timestamps", async () => {
    const expiry = Number(offer.expiry_s);
    const reason = offer.commitment_reason;
    // What the state says must agree with the commitment, the buyer and the escrow.
    if (NEEDS_COMMITMENT.includes(offer.state) && !reason) return ["failed", `state ${offer.state} without a commitment`];
    if (NO_COMMITMENT.includes(offer.state) && reason) return ["failed", `state ${offer.state} with a ${reason} commitment`];
    const finalFor: Record<string, string> = { Kept: "Expiry", Exercised: "Exercise", Withdrawn: "Withdraw" };
    if (finalFor[offer.state] && finalFor[offer.state] !== reason) return ["failed", `state ${offer.state} but the commitment is for ${reason}`];
    if ((reason === "Exercise" || reason === "Expiry" || ["Sold", "ExercisePending"].includes(offer.state)) && !offer.buyer) return ["failed", "sold, but no buyer recorded"];
    if ((reason === "Withdraw" || ["Created", "Funded"].includes(offer.state)) && offer.buyer) return ["failed", `a buyer is recorded, but the offer is ${reason === "Withdraw" ? "withdrawn as unsold" : offer.state}`];
    const escrow = BigInt(offer.escrow_units);
    const escrowOk = reason === "Exercise" && (offer.state === "Committed" || offer.state === "Signed")
      ? escrow === 0n || escrow === BigInt(offer.strike_total_units) // 0 once reclaimed after the timeout
      : offer.state === "ExercisePending" ? escrow === BigInt(offer.strike_total_units) : escrow === 0n;
    if (!escrowOk) return ["failed", `escrow of ${offer.escrow_units} does not fit state ${offer.state}`];
    if (reason === "Expiry") {
      const t = Number(offer.committed_at_s);
      return [t >= expiry + params.grace_s ? "verified" : "failed", `settled ${utc(t)}, after the window closed ${utc(expiry + params.grace_s)}`];
    }
    if (reason === "Exercise") {
      const t = Number(offer.committed_at_s);
      return [t >= expiry && t < expiry + params.grace_s ? "verified" : "failed", `exercised ${utc(t)}, inside the window ${utc(expiry)} – ${utc(expiry + params.grace_s).slice(11)}`];
    }
    if (offer.state === "Sold") return ["verified", nowS < expiry ? "open; window not yet open" : nowS < expiry + params.grace_s ? "exercise window open" : "window closed; awaiting settle"];
    return ["verified", `state ${offer.state}`];
  }));

  out.push(await guard(6, "Committed transaction and signature", async () => {
    if (!offer.commitment_txid) return NEEDS_COMMITMENT.includes(offer.state) ? ["failed", `state ${offer.state}, but no committed transaction`] : ["verified", "nothing committed yet"];
    const expectedTo = offer.commitment_reason === "Exercise" ? offer.buyer_address : offer.refund_address;
    if (!expectedTo || offer.commitment_to_address !== expectedTo) return ["failed", `commitment pays ${offer.commitment_to_address}, expected ${expectedTo}`];
    const toScript = scriptFromAddress(offer.commitment_to_address, net);
    const ws = hex.from(offer.witness_script);
    const fee = BigInt(offer.commitment_fee_sats ?? params.fee_sats);
    if (params.max_fee_sats !== undefined && fee > BigInt(params.max_fee_sats)) return ["failed", `fee ${fee} sats is above the contract's cap of ${params.max_fee_sats}`];
    const r = buildSpend({ collateralTxid: offer.collateral_txid!, vout: offer.collateral_vout!, valueSats: BigInt(offer.collateral_value_sats!), witnessScript: ws, toScript, feeSats: fee });
    if (r.txid !== offer.commitment_txid || r.sighash !== offer.commitment_sighash) return ["failed", "rebuilt transaction differs from the commitment"];
    if (!offer.signed_tx) return SIGNED.includes(offer.state) ? ["failed", `state ${offer.state}, but no signed transaction`] : ["verified", `rebuilt ${r.txid.slice(0, 12)}…; not signed yet`];
    const v = verifySignedTx(offer.signed_tx, r.sighash, hex.from(offer.derived_pubkey), ws, r.unsignedHex);
    const bumped = offer.prior_txids?.length ? `; fee raised ${offer.prior_txids.length}× to ${fee} sats` : "";
    return [v.ok ? "verified" : "failed", v.ok ? `signature verifies against the derived key; pays ${r.amountSats} sats${bumped}` : v.reason!];
  }));

  out.push(await guard(7, "Bitcoin confirmation", async () => {
    if (offer.state === "Rescued") return ["verified", "no settlement: the seller's rescue spent the coins on Bitcoin (check 3)"];
    if (!offer.commitment_txid) return NEEDS_COMMITMENT.includes(offer.state) ? ["failed", `state ${offer.state}, but no committed transaction`] : ["verified", "no settlement yet"];
    let st = await c.btc.txStatus(offer.commitment_txid);
    for (const prior of offer.prior_txids ?? []) { if (st?.confirmed) break; const p = await c.btc.txStatus(prior); if (p?.confirmed) st = p; }
    if (SETTLED.includes(offer.state)) {
      // The contract finalised the offer on a proof: that proof's transaction must be buried as deep as it requires.
      if (!st?.confirmed) return ["failed", `recorded as ${offer.state}, but no committed version is confirmed on Bitcoin`];
      return [st.depth >= c.expected.minConf ? "verified" : "failed", `confirmed at depth ${st.depth}`];
    }
    if (!st) return [offer.signed_tx ? "failed" : "verified", offer.signed_tx ? "signed but not seen on Bitcoin; broadcast it" : "not signed yet"];
    return [st.confirmed ? "verified" : "failed", st.confirmed ? `confirmed at depth ${st.depth}` : "in mempool"];
  }));
  return out;
}

/** Final states reached only by proving a committed settlement on Bitcoin. */
const SETTLED = ["Kept", "Exercised", "Withdrawn"];
/** States that exist only after the contract has signed a committed settlement. */
const SIGNED = ["Signed", ...SETTLED];
/** States that exist only once a settlement has been committed. */
const NEEDS_COMMITMENT = ["Committed", ...SIGNED];
/** States in which no settlement can have been committed. */
const NO_COMMITMENT = ["Created", "Funded", "Sold", "ExercisePending", "Cancelled"];

const utc = (t: number) => new Date(t * 1000).toISOString().slice(0, 19).replace("T", " ") + " UTC";
