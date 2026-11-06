/** Typed access to the Covered design-system components (window.Covered, loaded in main.tsx). */
import type * as DS from "./covered";
export const C = () => (window as unknown as { Covered: typeof DS }).Covered;
export const usd = (units: string | bigint | number, decimals = 6) => { const n = Number(units) / 10 ** decimals; return n.toLocaleString("en-US", { style: "currency", currency: "USD" }); };
export const btc8 = (sats: string | number | bigint) => (Number(sats) / 1e8).toFixed(8) + " BTC";
export const dateUtc = (s: string | number) => { const d = new Date(Number(s) * 1000); return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC"; };
export const short = (h: string | null | undefined, n = 6) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : "—");
/** A span of time in words: "90 minutes", "6 hours", "30 days". */
export const duration = (s: number) => (s >= 172800 ? `${Math.round(s / 86400)} days` : s >= 7200 ? `${Math.round(s / 3600)} hours` : s === 3600 ? "1 hour" : `${Math.round(s / 60)} minutes`);
