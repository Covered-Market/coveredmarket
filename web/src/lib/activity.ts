/**
 * The public activity feed: the latest contracts, newest first, each described in a line. The contract has no
 * "list everything" view, but serials are dense (1, 2, 3, …) and `get_offer` answers null past the newest, so the
 * newest serial is found by galloping up from the highest live one and then bisecting. Pure apart from the probe.
 */
import type { Offer } from "./verify";

export type Stamp = "open" | "kept" | "exercised" | "settled" | "pending" | "refused";

/** Highest serial `exists` answers true for, given a serial known to exist (or 0 if none is known). */
export async function newestSerial(exists: (serial: number) => Promise<boolean>, known = 0): Promise<number> {
  let lo = known, step = 1;
  // Gallop: lo exists (or is 0), find a hi that does not.
  let hi = lo + step;
  while (await exists(hi)) { lo = hi; step *= 2; hi = lo + step; }
  // Bisect between lo (exists) and hi (does not).
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await exists(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

/** An account in full, except an implicit one (64 hex characters), which is shortened to its ends ("d70768…a6b1"). */
export function accountShort(account: string): string {
  return /^[0-9a-f]{64}$/.test(account) ? `${account.slice(0, 6)}…${account.slice(-4)}` : account;
}

/** An account as people would say it: the name before the first dot ("ola-x7k2"), or a short hash for an implicit one. */
export function who(account: string | null | undefined): string {
  if (!account) return "someone";
  if (/^[0-9a-f]{64}$/.test(account)) return `${account.slice(0, 6)}…${account.slice(-4)}`;
  return account.split(".")[0];
}

const hhmm = (s: number) => new Date(s * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

/** How long ago, in words ("just now", "12 minutes ago", "3 hours ago", "2 days ago"). */
export function ago(thenS: number, nowS: number): string {
  const d = Math.max(0, nowS - thenS);
  if (d < 90) return "just now";
  if (d < 5400) return `${Math.round(d / 60)} minutes ago`;
  if (d < 129600) return `${Math.round(d / 3600)} hours ago`;
  return `${Math.round(d / 86400)} days ago`;
}

export interface FeedRow { serial: number; stamp: Stamp; word: string; line: string; when: string; sizeBtc: number; strikeUsd: number; premiumUsd: number }

type OfferPlus = Offer & { signed_at_s?: string | null };

/** One contract as a feed line: what happened to it, and when its latest step was. */
export function describe(o: OfferPlus, nowS: number): FeedRow {
  const seller = who(o.seller), buyer = who(o.buyer), expiry = Number(o.expiry_s);
  const last = Math.max(Number(o.created_s ?? 0), Number(o.committed_at_s ?? 0), Number(o.signed_at_s ?? 0));
  const reason = o.commitment_reason;
  let stamp: Stamp, word: string, line: string;
  switch (o.state) {
    case "Created": stamp = "pending"; word = "Created"; line = `${seller} is selling; waiting for the deposit`; break;
    case "Funded": stamp = "open"; word = "For sale"; line = expiry > nowS ? `${seller} is selling; expires ${hhmm(expiry)}` : `${seller}'s offer expired unsold`; break;
    case "Sold": stamp = "open"; word = "Sold"; line = expiry > nowS ? `${seller} sold to ${buyer}; expires ${hhmm(expiry)}` : `${seller} sold to ${buyer}; exercise window open`; break;
    case "ExercisePending": stamp = "open"; word = "Exercising"; line = `${buyer} paid the strike; checking the deposit`; break;
    case "Committed":
    case "Signed":
      stamp = "open"; word = "Settling";
      line = reason === "Exercise" ? `${buyer} exercised; coins on their way to ${buyer}` : reason === "Withdraw" ? `${seller} is withdrawing; coins on their way back` : `not exercised; coins on their way back to ${seller}`;
      break;
    case "Kept": stamp = "kept"; word = "Kept"; line = `not exercised; ${seller} kept the coins and the premium`; break;
    case "Exercised": stamp = "exercised"; word = "Exercised"; line = `${buyer} paid the strike and received the coins`; break;
    case "Withdrawn": stamp = "settled"; word = "Withdrawn"; line = `${seller} took the coins back unsold`; break;
    case "Cancelled": stamp = "settled"; word = "Cancelled"; line = `${seller} cancelled before funding it`; break;
    case "Rescued": stamp = "refused"; word = "Rescued"; line = `${seller} moved the coins with the rescue key`; break;
    default: stamp = "pending"; word = o.state; line = seller;
  }
  return {
    serial: o.serial, stamp, word, line, when: last ? ago(last, nowS) : "",
    sizeBtc: Number(o.size_sats) / 1e8, strikeUsd: Number(o.strike_units) / 1e6, premiumUsd: Number(o.premium_units) / 1e6,
  };
}
