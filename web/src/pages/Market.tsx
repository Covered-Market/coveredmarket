import { useEffect, useState } from "react";
import { C } from "../ds";
import { view } from "../lib/near";
import type { Offer } from "../lib/verify";
import { toOfferCard, useSpotStatus } from "./hooks";
import { AllContracts, useContracts } from "./AllContracts";

/** The public view, the same with or without a wallet: every recent contract in tabs by
 *  where it is in its life (offers for sale as cards you can buy). */
export function Market() {
  const { OfferCard, StatTile } = C();
  const { spot, failed: spotFailed } = useSpotStatus();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { const f = () => view<Offer[]>("get_offers", { from: 0, limit: 60 }).then((o) => { setOffers(o); setLoaded(true); }).catch(() => {}); f(); const t = setInterval(f, 15_000); return () => clearInterval(t); }, []);
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
          <StatTile label="Bitcoin reference" value={spot ? spot.price : "—"} kind="usd" note={spot ? `median of ${spot.sources} tickers` : spotFailed ? "unavailable right now" : "loading"} />
          <StatTile label="At rest on Bitcoin" value={rest} kind="btc" tone="btc" note={`${offers.length} live contracts`} />
          <StatTile label="Contracts written" value={all.newest} kind="plain" note="since launch" />
        </div>
      </div>

      <AllContracts rows={all.rows} saleCount={loaded ? forSale.length : null} sale={
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(340px, 100%), 1fr))", gap: 24 }}>
          {forSale.map((o) => <OfferCard key={o.serial} offer={toOfferCard(o, spot?.price ?? 0)} action="Buy this call" onAct={() => (location.hash = `#/buy/${o.serial}`)} />)}
        </div>
      } />
    </div>
  );
}
