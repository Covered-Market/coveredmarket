/**
 * The chains' own clock, on every page: UTC time, the Bitcoin tip (height, how long since that block) and the
 * NEAR block height. Recorded footage carries verifiable timestamps, and anyone waiting for a block can see why.
 */
import { useEffect, useState } from "react";
import { btcJson, btcText } from "./lib/btc";
import { CFG, provider } from "./lib/near";

export interface Chains { btcHeight?: number; btcTime?: number; nearHeight?: number; now: number }
let state: Chains = { now: Date.now() / 1000 };
const subs = new Set<(c: Chains) => void>();
const emit = (patch: Partial<Chains>) => { state = { ...state, ...patch }; subs.forEach((f) => f(state)); };
let started = false;
function start() {
  if (started || CFG.disabled) return; started = true;
  const btc = async () => { try { const h = Number(await btcText("/blocks/tip/height")); const hash = await btcText("/blocks/tip/hash"); const b = await btcJson(`/block/${hash}`); emit({ btcHeight: h, btcTime: b.timestamp }); } catch {} };
  const near = async () => { try { const b = await provider.block({ finality: "final" }); emit({ nearHeight: Number(b.header.height) }); } catch {} };
  btc(); near();
  setInterval(btc, 30_000); setInterval(near, 5_000); setInterval(() => emit({ now: Date.now() / 1000 }), 1_000);
}
export function useChains(): Chains {
  const [c, set] = useState(state);
  useEffect(() => { start(); subs.add(set); return () => { subs.delete(set); }; }, []);
  return c;
}
export const ago = (s: number) => (s < 90 ? `${Math.max(0, Math.round(s))} s` : `${Math.round(s / 60)} min`);
const btcName = () => (CFG.mode === "mainnet" ? "Bitcoin" : CFG.mode === "local" ? "Bitcoin regtest" : "Bitcoin testnet3");

export function ChainClock() {
  const c = useChains();
  if (CFG.disabled) return null;
  const t = new Date(c.now * 1000).toISOString();
  return (
    <div className="cv-mono" style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12, color: "var(--ink-muted)", padding: "8px 0" }} aria-label="Chain clock">
      <span>{t.slice(0, 10)} {t.slice(11, 19)} UTC</span>
      <span>{btcName()} block {c.btcHeight?.toLocaleString("en-US") ?? "…"}{c.btcTime ? ` · ${ago(c.now - c.btcTime)} ago` : ""}</span>
      <span>NEAR {CFG.network} block {c.nearHeight?.toLocaleString("en-US") ?? "…"}</span>
    </div>
  );
}

/** "Waiting for N blocks" with the live tip, for steps that wait on Bitcoin. */
export function BlockWait({ blocks, what }: { blocks: number; what: string }) {
  const c = useChains();
  const avg = CFG.mode === "local" ? "mined on demand here" : "~10 min each on average";
  return (
    <span className="body-small" style={{ color: "var(--ink-muted)" }}>
      Waiting for {blocks} Bitcoin block{blocks === 1 ? "" : "s"} {what} ({avg}){c.btcTime ? ` · last block ${ago(c.now - c.btcTime)} ago, #${c.btcHeight?.toLocaleString("en-US")}` : ""}
    </span>
  );
}
