/**
 * NEP-366 relay policy: which delegate actions the relayer will pay gas for.
 * Pure function so it is unit-tested; the HTTP layer just calls it.
 */
export interface FunctionCallAction { methodName: string; args: Record<string, unknown>; gas: bigint; deposit: bigint }
export interface DelegateActionView { senderId: string; receiverId: string; actions: FunctionCallAction[] }

export interface RelayPolicy { coveredmarket: string; usdc: string; maxGas: bigint; maxDepositYocto: bigint }

export type Verdict = { ok: true } | { ok: false; reason: string };

export function checkDelegate(d: DelegateActionView, p: RelayPolicy): Verdict {
  if (d.actions.length === 0) return { ok: false, reason: "no actions" };
  for (const a of d.actions) {
    if (a.gas > p.maxGas) return { ok: false, reason: `gas ${a.gas} over cap` };
    if (a.deposit > p.maxDepositYocto) return { ok: false, reason: `deposit ${a.deposit} over cap` };
    if (d.receiverId === p.coveredmarket) {
      if (!["create_offer", "cancel", "withdraw", "claim", "reclaim_strike", "settle", "request_signature", "confirm_deposit", "confirm_spend", "confirm_rescue", "recover"].includes(a.methodName))
        return { ok: false, reason: `method ${a.methodName} not relayed` };
    } else if (d.receiverId === p.usdc) {
      if (a.methodName !== "ft_transfer_call") return { ok: false, reason: "only ft_transfer_call on the token" };
      if (a.args["receiver_id"] !== p.coveredmarket) return { ok: false, reason: "token transfer must target the contract" };
      if (a.deposit !== 1n) return { ok: false, reason: "ft_transfer_call needs exactly 1 yocto" };
    } else {
      return { ok: false, reason: `receiver ${d.receiverId} not relayed` };
    }
  }
  return { ok: true };
}

/**
 * Who may spend the relayer's gas, and how fast. The relayer pays for every relayed call, including ones that
 * fail on chain, so an open endpoint is a way to empty its account. Sliding windows per client address and per
 * signing account, and a ceiling for the whole server per day. In memory: a restart forgets, which only loosens it.
 */
export interface RelayLimitCfg { perIpPerMin: number; perSenderPerMin: number; perDay: number }
export const defaultRelayLimits: RelayLimitCfg = { perIpPerMin: 60, perSenderPerMin: 30, perDay: 5000 };

export class RelayLimits {
  private byIp = new Map<string, number[]>();
  private bySender = new Map<string, number[]>();
  private day: number[] = [];
  private swept = 0;
  constructor(private cfg: RelayLimitCfg = defaultRelayLimits) {}
  /** Count this request if it is allowed; otherwise say why not. */
  take(ip: string, sender: string, now = Date.now()): string | null {
    if (now - this.swept > 10 * 60_000) { this.sweep(now); this.swept = now; }
    const ipRecent = (this.byIp.get(ip) ?? []).filter((t) => now - t < 60_000);
    const senderRecent = (this.bySender.get(sender) ?? []).filter((t) => now - t < 60_000);
    this.day = this.day.filter((t) => now - t < 86_400_000);
    if (ipRecent.length >= this.cfg.perIpPerMin) return "too many requests from this address; try again in a minute";
    if (senderRecent.length >= this.cfg.perSenderPerMin) return "too many requests for this account; try again in a minute";
    if (this.day.length >= this.cfg.perDay) return "the relayer has paid for its daily share of gas; send the transaction from your own wallet";
    this.byIp.set(ip, [...ipRecent, now]);
    this.bySender.set(sender, [...senderRecent, now]);
    this.day.push(now);
    return null;
  }
  /** Forget idle keys so the maps cannot grow without bound. */
  private sweep(now: number) {
    for (const m of [this.byIp, this.bySender]) for (const [k, v] of m) if (!v.some((t) => now - t < 60_000)) m.delete(k);
  }
}
