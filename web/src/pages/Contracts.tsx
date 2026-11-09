import { useEffect, useState } from "react";
import { C, usd } from "../ds";
import { call, CFG, view, type Wallet } from "../lib/near";
import type { Offer } from "../lib/verify";
import { stampFor } from "./hooks";

export function Contracts({ wallet }: { wallet: Wallet }) {
  const { PositionsTable, StatTile, Button, Stamp, Figure } = C();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [claimable, setClaimable] = useState("0");
  const [busy, setBusy] = useState(false);
  const load = () => { view<Offer[]>("get_account_offers", { account: wallet.accountId }).then(setOffers).catch(() => {}); view<string>("get_claimable", { account: wallet.accountId }).then(setClaimable).catch(() => {}); };
  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, [wallet.accountId]);
  const rows = offers.map((o) => ({ id: `CV-${o.serial}`, side: (o.seller === wallet.accountId ? "sell" : "buy") as "sell" | "buy", size: Number(o.size_sats) / 1e8, strike: Number(o.strike_units) / 1e6, expiry: new Date(Number(o.expiry_s) * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }), premium: Number(o.premium_units) / 1e6, status: stampFor(o.state) }));
  const rest = offers.filter((o) => ["Funded", "Sold", "ExercisePending", "Committed", "Signed"].includes(o.state) && o.seller === wallet.accountId).reduce((s, o) => s + Number(o.size_sats), 0) / 1e8;
  return (
    <div className="cv-pad" style={{ padding: "32px 48px", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
        <div>
          <h1 className="display-2" style={{ margin: "0 0 8px", fontSize: 48, lineHeight: 1.02 }}>My contracts</h1>
          <p className="lede" style={{ margin: 0, color: "var(--ink-muted)" }}>Everything you have sold or bought, and where the coins are right now.</p>
        </div>
        <div className="cv-tiles" style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
          <StatTile label="Coins at rest" value={rest} kind="btc" tone="btc" note="in live contracts" />
          <StatTile label="Claimable USDC" value={Number(claimable) / 1e6} kind="usd" tone="gilt" note="premium and strikes owed to you" />
          <Button variant="primary" disabled={busy || claimable === "0"} onClick={async () => { setBusy(true); try { await call(wallet, CFG.contract, "claim", {}, 0n, 60); load(); } catch (e) { alert((e as Error).message); } finally { setBusy(false); } }}>{busy ? "Claiming…" : `Claim ${usd(claimable)}`}</Button>
        </div>
      </div>
      <div onClick={(e) => { const t = (e.target as HTMLElement).closest("tr"); const id = t?.textContent?.match(/CV-(\d+)/)?.[1]; if (id) location.hash = `#/c/${id}`; }} data-cv="positions" className="cv-only-wide" style={{ cursor: "pointer", overflowX: "auto" }}>
        <PositionsTable rows={rows} />
      </div>
      {rows.length > 0 && <div className="cv-only-narrow" style={{ display: "flex", flexDirection: "column", border: "1px solid var(--rule)", background: "var(--paper-raised)" }}>
        {rows.map((r) => (
          <a key={r.id} href={`#/c/${r.id.slice(3)}`} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "4px 12px", padding: "12px 14px", borderTop: "1px solid var(--rule)", color: "inherit", textDecoration: "none" }}>
            <span className="body-small"><b className="cv-mono">{r.id}</b> · {r.side === "sell" ? "you sold" : "you bought"} · {r.expiry}</span>
            <span style={{ justifySelf: "end" }}><Stamp status={r.status} flat /></span>
            <span><Figure value={r.size} kind="btc" size="sm" /> <span className="body-small" style={{ color: "var(--ink-muted)" }}>at</span> <Figure value={r.strike} kind="usd" size="sm" /></span>
            <span style={{ justifySelf: "end" }}><Figure value={r.premium} kind="usd" size="sm" tone="gilt" /></span>
          </a>
        ))}
      </div>}
      {rows.length === 0 && <div className="body" style={{ color: "var(--ink-muted)" }}>Nothing yet. <a href="#/sell" style={{ color: "var(--intaglio)" }}>Sell a call</a> or <a href="#/market" style={{ color: "var(--intaglio)" }}>buy one</a>.</div>}
    </div>
  );
}
