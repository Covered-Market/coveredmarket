import { useEffect, useState } from "react";
import { C } from "../ds";
import { view } from "../lib/near";
import type { Offer } from "../lib/verify";
import { toOfferCard, useSpot } from "./hooks";

export function Market() {
  const { OfferCard, StatTile } = C();
  const spot = useSpot();
  const [offers, setOffers] = useState<Offer[]>([]);
  useEffect(() => { const f = () => view<Offer[]>("get_offers", { from: 0, limit: 60 }).then(setOffers).catch(() => {}); f(); const t = setInterval(f, 15_000); return () => clearInterval(t); }, []);
  const forSale = offers.filter((o) => o.state === "Funded");
  const rest = offers.reduce((s, o) => s + Number(o.size_sats), 0) / 1e8;
  return (
    <div style={{ padding: "32px 48px 24px", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
        <div>
          <h1 className="display-2" style={{ margin: "0 0 8px", fontSize: 48, lineHeight: 1.02 }}>Open offers</h1>
          <p className="lede" style={{ margin: 0, color: "var(--ink-muted)" }}>Every offer is backed by coins already sitting at a Bitcoin address the contract controls.</p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <StatTile label="Bitcoin reference" value={spot?.price ?? 0} kind="usd" note={spot ? `median of ${spot.sources} tickers` : "loading"} />
          <StatTile label="At rest on Bitcoin" value={rest} kind="btc" tone="btc" note={`${offers.length} live contracts`} />
          <StatTile label="For sale" value={forSale.length} kind="plain" note="funded, unsold" />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 24 }}>
        {forSale.map((o) => <OfferCard key={o.serial} offer={toOfferCard(o, spot?.price ?? 0)} action="Buy this call" onAct={() => (location.hash = `#/buy/${o.serial}`)} />)}
        {forSale.length === 0 && <div className="body" style={{ color: "var(--ink-muted)" }}>No offers for sale right now. <a href="#/sell" style={{ color: "var(--intaglio)" }}>Sell one.</a></div>}
      </div>
    </div>
  );
}
