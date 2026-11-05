import { useEffect, useState } from "react";
import type { Offer, Params } from "../lib/verify";
import { view } from "../lib/near";

export function useOffer(serial: number, everyMs = 10_000) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const f = () => view<Offer | null>("get_offer", { serial }).then((o) => live && setOffer(o)).catch((e) => live && setErr(String(e)));
    f(); const t = setInterval(f, everyMs);
    return () => { live = false; clearInterval(t); };
  }, [serial, everyMs]);
  return { offer, err };
}
export function useParams() {
  const [p, setP] = useState<Params | null>(null);
  useEffect(() => { view<Params>("get_params").then(setP).catch(() => {}); }, []);
  return p;
}
export function useSpot() {
  const [s, setS] = useState<{ price: number; sources: number } | null>(null);
  useEffect(() => { const f = () => fetch("/api/spot").then((r) => r.json()).then(setS).catch(() => {}); f(); const t = setInterval(f, 60_000); return () => clearInterval(t); }, []);
  return s;
}
export const annualised = (premiumUsd: number, sizeBtc: number, spot: number, expiryS: number) => {
  const days = Math.max(1, (expiryS - Date.now() / 1000) / 86400);
  return sizeBtc > 0 && spot > 0 ? (premiumUsd / (sizeBtc * spot)) * (365 / days) * 100 : 0;
};
export const toOfferCard = (o: { size_sats: string; strike_units: string; premium_units: string; expiry_s: string; address: string; seller: string; state: string }, spot: number) => ({
  strike: Number(o.strike_units) / 1e6, expiry: new Date(Number(o.expiry_s) * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
  premium: Number(o.premium_units) / 1e6, annualised: Math.round(annualised(Number(o.premium_units) / 1e6, Number(o.size_sats) / 1e8, spot, Number(o.expiry_s)) * 10) / 10,
  size: Number(o.size_sats) / 1e8, spot, vault: `${o.address.slice(0, 4)}…${o.address.slice(-4)}`, seller: o.seller, status: stampFor(o.state),
});
export const stampFor = (state: string): "open" | "kept" | "exercised" | "settled" | "pending" | "refused" =>
  state === "Kept" ? "kept" : state === "Exercised" ? "exercised" : state === "Withdrawn" || state === "Cancelled" ? "settled" : state === "Created" ? "pending" : "open";
