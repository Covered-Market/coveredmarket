/**
 * Testnet only: free test funds for whatever account connects (an extension wallet's account, or the hidden
 * in-browser test wallet's implicit account). Tops up a little tNEAR (which also creates an implicit account that
 * does not exist yet) and mints mock USDC. Pure decisions and rate limits live here so they are unit-tested.
 */

export const NEAR = 10n ** 24n;
export const USDC = 1_000_000n; // 6 decimals

export interface FundsPolicy {
  /** Send tNEAR when the account holds less than this (or does not exist). */ nearFloor: bigint;
  /** How much tNEAR to send. */ nearTopUp: bigint;
  /** Mint USDC when the account holds less than this. */ usdcFloor: bigint;
  /** How much USDC to mint. */ usdcMint: bigint;
}
export const defaultPolicy: FundsPolicy = { nearFloor: NEAR / 5n, nearTopUp: NEAR / 2n, usdcFloor: 10_000n * USDC, usdcMint: 100_000n * USDC };

/** 64 lowercase hex characters: an implicit account (the ed25519 public key itself). */
export const isImplicit = (id: string) => /^[0-9a-f]{64}$/.test(id);
/** A testnet account we are willing to fund: implicit, or a named account under `.testnet`. */
export function fundable(id: string): boolean {
  if (isImplicit(id)) return true;
  return id.length >= 2 && id.length <= 64 && /^(([a-z0-9]+[-_])*[a-z0-9]+\.)+testnet$/.test(id);
}

/** What to send an account, given what it holds now (null = the account does not exist yet). */
export function plan(near: bigint | null, usdc: bigint, p: FundsPolicy = defaultPolicy, canMint = true): { near: bigint; usdc: bigint } {
  return {
    near: near === null || near < p.nearFloor ? p.nearTopUp : 0n,
    usdc: canMint && usdc < p.usdcFloor ? p.usdcMint : 0n,
  };
}

/** Sliding-window limits: per client address, per account, and for the whole server per day. */
export class Limits {
  private byIp = new Map<string, number[]>();
  private byAccount = new Map<string, number>();
  private day: number[] = [];
  constructor(private perIpPerHour = 10, private accountEveryMs = 10 * 60_000, private perDay = 300) {}
  check(ip: string, account: string, now = Date.now()): string | null {
    const recent = (this.byIp.get(ip) ?? []).filter((t) => now - t < 3600_000);
    this.byIp.set(ip, recent);
    this.day = this.day.filter((t) => now - t < 86_400_000);
    if (recent.length >= this.perIpPerHour) return "too many requests from this address; try again in an hour";
    const last = this.byAccount.get(account);
    if (last !== undefined && now - last < this.accountEveryMs) return "this account was just funded; try again in a few minutes";
    if (this.day.length >= this.perDay) return "the test-funds faucet is resting for today";
    return null;
  }
  record(ip: string, account: string, now = Date.now()) {
    this.byIp.set(ip, [...(this.byIp.get(ip) ?? []), now]);
    this.byAccount.set(account, now);
    this.day.push(now);
  }
}
