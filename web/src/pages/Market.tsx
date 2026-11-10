import { useEffect, useState } from "react";
import { C } from "../ds";
import { view } from "../lib/near";
import type { Offer } from "../lib/verify";
import { toOfferCard, useSpot } from "./hooks";
import { AllContracts, Lifecycle, useContracts } from "./AllContracts";

/** The public view, the same with or without a wallet: what is for sale, how a contract moves, and every recent
 *  contract by where it is in its life. */
export function Market() {
  const { OfferCard, StatTile } = C();
  const spot = useSpot();
  const [offers, setOffers] = useState<Offer[]>([]);
  useEffect(() => { const f = () => view<Offer[]>("get_offers", { from: 0, limit: 60 }).then(setOffers).catch(() => {}); f(); const t = setInterval(f, 15_000); return () => clearInterval(t); }, []);
  const now = Date.now() / 1000;
  const forSale = offers.filter((o) => o.state === "Funded" && Number(o.expiry_s) > now);
  const rest = offers.reduce((s, o) => s + Number(o.size_sats), 0) / 1e8;
  const all = useContracts(offers.reduce((m, o) => Math.max(m, o.serial), 0));
  return (
    <div className="cv-pad" style={{ padding: "32px 48px 48px", display: "flex", flexDirection: "column", gap: 40 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 560 }}>
          <h1 className="display-2" style={{ margin: "0 0 8px", fontSize: 48, lineHeight: 1.02 }}>Market</h1>
          <p className="lede" style={{ margin: 0, color: "var(--ink-muted)" }}>Covered calls on native Bitcoin. Every offer is backed by coins already at a Bitcoin address only the contract can sign for.</p>
        </div>
        <div className="cv-tiles" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <StatTile label="Bitcoin reference" value={spot?.price ?? 0} kind="usd" note={spot ? `median of ${spot.sources} tickers` : "loading"} />
          <StatTile label="At rest on Bitcoin" value={rest} kind="btc" tone="btc" note={`${offers.length} live contracts`} />
          <StatTile label="Contracts written" value={all.newest} kind="plain" note="since launch" />
        </div>
      </div>

      <section aria-labelledby="sale-h" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h2 id="sale-h" className="display-2" style={{ margin: 0, fontSize: 28, lineHeight: 1.1 }}>For sale <span className="cv-mono" style={{ fontSize: 18, color: "var(--ink-muted)" }}>{forSale.length}</span></h2>
          <span className="body-small" style={{ color: "var(--ink-muted)" }}>Buy one to own the right to the coins at the strike. You pay the premium now; the strike only if you exercise.</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(340px, 100%), 1fr))", gap: 24 }}>
          {forSale.map((o) => <OfferCard key={o.serial} offer={toOfferCard(o, spot?.price ?? 0)} action="Buy this call" onAct={() => (location.hash = `#/buy/${o.serial}`)} />)}
          {forSale.length === 0 && <div className="body" style={{ color: "var(--ink-muted)" }}>No offers for sale right now. <a href="#/sell" style={{ color: "var(--intaglio)" }}>Sell one.</a></div>}
        </div>
      </section>

      <Lifecycle />
      <AllContracts rows={all.rows} />
    </div>
  );
}
