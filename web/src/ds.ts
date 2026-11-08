/** Typed access to the CoveredMarket design-system components (window.CoveredMarket, loaded in main.tsx). */
import type * as DS from "./coveredmarket";
export const C = () => (window as unknown as { CoveredMarket: typeof DS }).CoveredMarket;
export const usd = (units: string | bigint | number, decimals = 6) => { const n = Number(units) / 10 ** decimals; return n.toLocaleString("en-US", { style: "currency", currency: "USD" }); };
export const btc8 = (sats: string | number | bigint) => (Number(sats) / 1e8).toFixed(8) + " BTC";
export const dateUtc = (s: string | number) => { const d = new Date(Number(s) * 1000); return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC"; };
export const short = (h: string | null | undefined, n = 6) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : "—");
