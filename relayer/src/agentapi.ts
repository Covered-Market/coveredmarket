/**
 * The read API for agents and scripts: the contract's views in plain units, with what can be done next and by whom.
 *
 *   GET /api/params               deployment rules (sizes, expiry grid, windows) and the next valid expiries
 *   GET /api/offers               live offers (awaiting deposit, for sale, sold); ?status=for_sale|awaiting_deposit|sold
 *   GET /api/offers/:serial       one offer, any state
 *   GET /api/accounts/:id         an account's offers and claimable USDC
 *
 * Pure: the routes in index.ts feed it views and the chain clock. Every amount is given both in the contract's units
 * (strings, exact) and in BTC / USD (numbers, for reading). `next_actions` names who acts (`seller`, `buyer`, `anyone`,
 * or `relayer` for steps the relayer takes on its own) and, when it is a NEAR call, the exact call to make.
 */

export interface RawParams {
  usdc: string; network: string; min_conf: number; fee_sats: number; grace_s: number; buy_cutoff_s: number; min_lead_s: number;
  escrow_timeout_s: number; min_size_sats: number; max_size_sats: number; expiry_step_s: number; expiry_offset_s: number;
  rescue_delay_s: number; fee_bump_after_s?: number; max_fee_sats?: number;
}

export interface RawOffer {
  serial: number; seller: string; buyer?: string | null; size_sats: string; strike_units: string; strike_total_units: string;
  premium_units: string; expiry_s: string; created_s: string; unlock_s: string; address: string; refund_address: string;
  buyer_address?: string | null; collateral_txid?: string | null; collateral_vout?: number | null;
  commitment_reason?: string | null; commitment_txid?: string | null; commitment_to_address?: string | null;
  commitment_amount_sats?: string | null; committed_at_s?: string | null; signed_tx?: string | null; escrow_units: string; state: string;
}

export interface Ctx { contract: string; usdc: string }

export interface Call { receiver_id: string; method: string; args: Record<string, unknown>; deposit_yocto: string; gas_tgas: number }
export interface NextAction {
  action: string;
  who: "seller" | "buyer" | "anyone" | "relayer";
  /** false: not yet (see from_s) */
  ready: boolean;
  from_s?: number; until_s?: number;
  /** The NEAR function call, when the action is one. Placeholders in angle brackets are yours to fill in. */
  call?: Call;
  note: string;
}

export const LIVE = ["Created", "Funded", "Sold", "ExercisePending", "Committed", "Signed"];
export const FINAL = ["Kept", "Exercised", "Withdrawn", "Cancelled", "Rescued"];
const LOCKED = ["Funded", "Sold", "ExercisePending", "Committed", "Signed"];

const btc = (sats: string | number) => Number(sats) / 1e8;
const usd = (units: string | number) => Number(units) / 1e6;
const utc = (s: number) => new Date(s * 1000).toISOString().replace(".000Z", "Z");
const ONE_YOCTO = "1";
/** The contract's network enum names the address format (Testnet4 = any tb1 testnet; the live deployment uses testnet3 coins). */
export function bitcoinNet(n: string) {
  return n === "Mainnet" ? { name: "mainnet", address_prefix: "bc1" } : n === "Regtest" ? { name: "regtest", address_prefix: "bcrt1" } : { name: "testnet", address_prefix: "tb1" };
}

/** The smallest valid expiry at least `leadS` from now: on the grid (every `expiry_step_s` from `expiry_offset_s`) and past `min_lead_s`. */
export function nextExpiry(p: Pick<RawParams, "expiry_step_s" | "expiry_offset_s" | "min_lead_s">, nowS: number, leadS = 0) {
  const step = Number(p.expiry_step_s), off = Number(p.expiry_offset_s);
  const earliest = nowS + Math.max(leadS, Number(p.min_lead_s)) + 60; // +60 s: room for the transaction to land
  return Math.ceil((earliest - off) / step) * step + off;
}

export function describeParams(p: RawParams, nowS: number, ctx: Ctx) {
  const leads = [Number(p.min_lead_s), 3600, 86400, 7 * 86400].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
  const next = [...new Set(leads.map((l) => nextExpiry(p, nowS, l)))];
  return {
    contract: ctx.contract,
    usdc: ctx.usdc,
    usdc_decimals: 6,
    bitcoin: { ...bitcoinNet(p.network), contract_enum: p.network },
    now_s: nowS,
    size: { min_sats: String(p.min_size_sats), max_sats: String(p.max_size_sats), min_btc: btc(p.min_size_sats), max_btc: btc(p.max_size_sats) },
    expiry: {
      rule: `expiry_s % ${p.expiry_step_s} == ${p.expiry_offset_s}, and at least ${p.min_lead_s} s from now`,
      step_s: Number(p.expiry_step_s), offset_s: Number(p.expiry_offset_s), min_lead_s: Number(p.min_lead_s),
      next: next.map((s) => ({ expiry_s: s, utc: utc(s) })),
    },
    exercise_window_s: Number(p.grace_s),
    buy_cutoff_s: Number(p.buy_cutoff_s),
    deposit_confirmations: Number(p.min_conf),
    bitcoin_fee_sats: Number(p.fee_sats),
    rescue_delay_s: Number(p.rescue_delay_s),
    escrow_timeout_s: Number(p.escrow_timeout_s),
    create_offer: {
      deposit_yocto: "100000000000000000000000",
      gas_tgas: 60,
      note: "Attach 0.1 NEAR for storage (the unused part is refunded). terms.strike_units is USDC units per whole BTC; rescue_pubkey is a 33-byte compressed secp256k1 key you hold: keep its private key, it is your Bitcoin-only exit.",
    },
  };
}

function summary(o: RawOffer, nowS: number, p: RawParams): string {
  const exp = Number(o.expiry_s), close = exp + Number(p.grace_s);
  switch (o.state) {
    case "Created": return `Waiting for the seller's deposit of exactly ${o.size_sats} sats to ${o.address}. Not for sale until it is proven.`;
    case "Funded": return nowS < exp - Number(p.buy_cutoff_s) ? "Deposited and for sale." : "Deposited but past its buy cutoff: it can no longer be sold. The seller can withdraw.";
    case "Sold": return nowS < exp ? "Sold. The buyer may exercise once expiry arrives." : nowS < close ? "Sold, exercise window open: the buyer may pay the strike now." : "Sold, window closed without exercise: settling back to the seller.";
    case "ExercisePending": return "The buyer paid the strike; the contract is re-checking the deposit on the light client.";
    case "Committed": return `Settlement committed (${o.commitment_reason}); waiting for the MPC signature.`;
    case "Signed": return `Settlement signed (${o.commitment_reason}); broadcast to Bitcoin, waiting for confirmation.`;
    case "Kept": return "Final: not exercised. The seller kept the coins and the premium.";
    case "Exercised": return "Final: exercised. The buyer has the coins; the seller has the strike and the premium.";
    case "Withdrawn": return "Final: withdrawn unsold. The coins went back to the seller.";
    case "Cancelled": return "Final: cancelled before any deposit.";
    case "Rescued": return "Final: the seller swept the deposit with their rescue key.";
    default: return o.state;
  }
}

export function nextActions(o: RawOffer, p: RawParams, nowS: number, ctx: Ctx): NextAction[] {
  const serial = o.serial, exp = Number(o.expiry_s), close = exp + Number(p.grace_s), cutoff = exp - Number(p.buy_cutoff_s);
  const out: NextAction[] = [];
  const self = (method: string, gas = 300): Call => ({ receiver_id: ctx.contract, method, args: { serial }, deposit_yocto: "0", gas_tgas: gas });
  const pay = (amount: string, msg: object, gas: number): Call => ({ receiver_id: ctx.usdc, method: "ft_transfer_call", args: { receiver_id: ctx.contract, amount, msg: JSON.stringify(msg) }, deposit_yocto: ONE_YOCTO, gas_tgas: gas });
  switch (o.state) {
    case "Created":
      out.push({ action: "deposit", who: "seller", ready: true, note: `Send exactly ${o.size_sats} sats to ${o.address} in one output. On testnet, POST /api/btc-faucet {"serial":${serial}} pays it from the demo faucet.` });
      out.push({ action: "confirm_deposit", who: "relayer", ready: true, note: `Automatic: the relayer proves the deposit after ${p.min_conf} confirmation(s). Anyone may.` });
      out.push({ action: "cancel", who: nowS >= exp ? "anyone" : "seller", ready: true, call: self("cancel", 30), note: "Cancel before any deposit. After expiry anyone may." });
      break;
    case "Funded":
      if (nowS < cutoff) out.push({ action: "buy", who: "buyer", ready: true, until_s: cutoff, call: pay(o.premium_units, { serial, btc_address: "<your bitcoin address>" }, 100), note: `Pay the ${usd(o.premium_units)} USDC premium. btc_address is where the coins go if you exercise: a v0 witness address (P2WPKH or P2WSH, ${bitcoinNet(p.network).address_prefix}…). The sale is final in that receipt.` });
      out.push({ action: "withdraw", who: "seller", ready: true, call: self("withdraw"), note: "Take the unsold coins back to the refund address." });
      break;
    case "Sold":
      if (nowS < close) out.push({ action: "exercise", who: "buyer", ready: nowS >= exp, from_s: exp, until_s: close, call: pay(o.strike_total_units, { serial, exercise: true }, 300), note: `Pay the ${usd(o.strike_total_units)} USDC strike inside the window to receive the coins at ${o.buyer_address}. Do nothing to let it expire.` });
      out.push({ action: "settle", who: "relayer", ready: nowS >= close, from_s: close, note: "Automatic after the window closes: the coins go back to the seller. Anyone may call settle." });
      break;
    case "ExercisePending":
      out.push({ action: "wait", who: "relayer", ready: true, note: "The contract is re-checking the deposit. If the check fails the strike is refunded and the offer returns to Sold." });
      break;
    case "Committed":
    case "Signed":
      out.push({ action: o.state === "Committed" ? "request_signature" : "broadcast_and_confirm", who: "relayer", ready: true, note: "Automatic: the relayer gets the signature, broadcasts, bumps the fee if needed and proves the spend. Anyone may." });
      if (o.commitment_reason === "Exercise" && o.escrow_units !== "0") {
        const at = Number(o.unlock_s) + Number(p.escrow_timeout_s);
        out.push({ action: "reclaim_strike", who: "buyer", ready: nowS >= at, from_s: at, call: self("reclaim_strike", 30), note: "Only if delivery never confirms: take the escrowed strike back." });
      }
      break;
  }
  if (LOCKED.includes(o.state) && nowS >= Number(o.unlock_s)) {
    out.push({ action: "rescue", who: "seller", ready: true, from_s: Number(o.unlock_s), note: "Emergency exit with Bitcoin only: bin/coveredmarket rescue <rescue kit> <your address>." });
  }
  return out;
}

export function describeOffer(o: RawOffer, p: RawParams, nowS: number, ctx: Ctx) {
  const exp = Number(o.expiry_s), close = exp + Number(p.grace_s);
  return {
    serial: o.serial,
    id: `CV-${o.serial}`,
    state: o.state,
    final: FINAL.includes(o.state),
    summary: summary(o, nowS, p),
    seller: o.seller,
    buyer: o.buyer ?? null,
    size: { sats: o.size_sats, btc: btc(o.size_sats) },
    strike: { usd_per_btc: usd(o.strike_units), units_per_btc: o.strike_units, total_usd: usd(o.strike_total_units), total_units: o.strike_total_units },
    premium: { usd: usd(o.premium_units), units: o.premium_units },
    expiry: { s: exp, utc: utc(exp) },
    exercise_window: { opens_s: exp, closes_s: close, opens_utc: utc(exp), closes_utc: utc(close) },
    buy_until_s: exp - Number(p.buy_cutoff_s),
    deposit: { address: o.address, amount_sats: o.size_sats, txid: o.collateral_txid ?? null, vout: o.collateral_vout ?? null },
    refund_address: o.refund_address,
    buyer_address: o.buyer_address ?? null,
    settlement: o.commitment_txid
      ? { reason: o.commitment_reason, txid: o.commitment_txid, to_address: o.commitment_to_address, amount_sats: o.commitment_amount_sats, signed: !!o.signed_tx }
      : null,
    rescue_unlock: { s: Number(o.unlock_s), utc: utc(Number(o.unlock_s)) },
    certificate: `/#/c/${o.serial}`,
    next_actions: nextActions(o, p, nowS, ctx),
  };
}

export type Described = ReturnType<typeof describeOffer>;

export type Status = "awaiting_deposit" | "for_sale" | "sold" | "settling";
export function statusOf(d: Described, nowS: number): Status | null {
  if (d.state === "Created") return "awaiting_deposit";
  if (d.state === "Funded") return nowS < d.buy_until_s ? "for_sale" : null;
  if (d.state === "Sold") return "sold";
  if (LIVE.includes(d.state)) return "settling";
  return null;
}

export function describeAccount(account: string, claimableUnits: string, offers: Described[], ctx: Ctx) {
  const actions: NextAction[] = claimableUnits !== "0"
    ? [{ action: "claim", who: "anyone", ready: true, call: { receiver_id: ctx.contract, method: "claim", args: {}, deposit_yocto: "0", gas_tgas: 60 }, note: `Pay out ${usd(claimableUnits)} USDC to ${account} (call it as that account).` }]
    : [];
  return {
    account,
    claimable: { usd: usd(claimableUnits), units: claimableUnits },
    selling: offers.filter((o) => o.seller === account),
    buying: offers.filter((o) => o.buyer === account),
    next_actions: actions,
  };
}
