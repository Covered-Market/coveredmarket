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
      if (!["create_offer", "cancel", "withdraw", "claim", "reclaim_strike", "settle", "request_signature", "confirm_deposit", "confirm_spend", "recover"].includes(a.methodName))
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
