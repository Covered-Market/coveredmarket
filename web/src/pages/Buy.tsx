import { useState } from "react";
import { btc8, C, usd } from "../ds";
import { call, CFG, type Wallet } from "../lib/near";
import { toOfferCard, useOffer, useSpot } from "./hooks";

export function Buy({ serial, wallet, onCreate }: { serial: number; wallet: Wallet | null; onCreate: () => void }) {
  const { OfferCard, Field, Button, SettlementTimeline, Notice } = C();
  const { offer } = useOffer(serial);
  const spot = useSpot()?.price ?? 0;
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  if (!offer) return <div style={{ padding: 48 }} className="body">Loading CV-{serial}…</div>;
  if (offer.state !== "Funded") return <div style={{ padding: 48 }} className="body">CV-{serial} is not for sale ({offer.state}). <a href={`#/c/${serial}`} style={{ color: "var(--intaglio)" }}>Open the certificate.</a></div>;
  const pay = async () => {
    if (!wallet) return onCreate();
    setBusy(true);
    try {
      await call(wallet, CFG.usdc, "ft_transfer_call", { receiver_id: CFG.contract, amount: offer.premium_units, msg: JSON.stringify({ serial, btc_address: addr }) }, 1n, 100);
      location.hash = `#/c/${serial}`;
    } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  };
  const strikeTotal = usd(offer.strike_total_units);
  return (
    <div style={{ padding: "32px 48px", display: "grid", gridTemplateColumns: "380px 1fr", gap: 56, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="body-small" style={{ color: "var(--ink-muted)" }}>Market / <b style={{ color: "var(--ink)" }}>CV-{serial}</b></div>
        <OfferCard offer={toOfferCard(offer, spot)} />
        <div style={{ border: "1px solid var(--rule)", background: "var(--paper-raised)", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)" }}>Proof the coins exist</div>
          <div className="body-small">{btc8(offer.collateral_value_sats ?? "0")} at <span className="cv-mono" style={{ color: "var(--copper-ink)" }}>{offer.address}</span>, proven on NEAR by the light client.</div>
          <div className="body-small">Only <span className="cv-mono">{CFG.contract}</span> can sign from that address, and only after expiry or after you pay the strike.</div>
          <Button size="sm" href={`${CFG.explorerBtc}/address/${offer.address}`}>Open on mempool.space</Button>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <h1 className="display-2" style={{ margin: "0 0 8px", fontSize: 48, lineHeight: 1.02 }}>Buy this call</h1>
          <p className="body" style={{ margin: 0, color: "var(--ink-muted)", maxWidth: 620 }}>You pay {usd(offer.premium_units)} now. For {Math.round(7200 / 60)} minutes after 08:00 UTC on the expiry day you may buy {btc8(offer.size_sats)} for {strikeTotal}, whatever the market price, by paying it. If you don't, the premium is the seller's and the coins stay hers.</p>
        </div>
        <div style={{ background: "var(--paper-raised)", border: "1px solid var(--rule)", padding: 24, display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
          <Field label="Receive coins at (if you exercise)" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="tb1q… / bc1q…" help="A Bitcoin address you control, bech32 v0. Fixed at purchase." />
          <div style={{ padding: 16, background: "var(--paper-sunk)", border: "1px solid var(--rule-strong)", display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center" }}>
            <div>
              <div className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)" }}>Pay {usd(offer.premium_units)} USDC from</div>
              <div className="figure" style={{ wordBreak: "break-all" }}>{wallet?.accountId ?? "your NEAR account"}</div>
              <div className="body-small" style={{ color: "var(--ink-muted)" }}>No USDC on NEAR yet? <a href="https://app.near-intents.org" target="_blank" rel="noreferrer" style={{ color: "var(--intaglio)" }}>Fund this account from Solana or Base with NEAR Intents</a>, then come back.</div>
            </div>
            <Button variant="primary" size="lg" disabled={busy || !addr} onClick={pay}>{wallet ? (busy ? "Paying…" : "Pay the premium") : "Create wallet"}</Button>
          </div>
          <SettlementTimeline steps={[
            { title: "Pay the premium", detail: "one USDC transfer from your account; the sale is final in that receipt", state: "now" },
            { title: "Window opens at expiry", detail: `pay ${strikeTotal} to exercise; anything else and it expires`, state: "todo" },
            { title: "Delivery", detail: "the contract signs the coins to your address; strike held in escrow until it confirms", state: "todo" },
          ]} />
          <Notice>Exercise is a payment, not a request: the coins move only after the strike has arrived and the collateral has been re-checked on Bitcoin. If delivery never confirms, you reclaim the strike after 7 days.</Notice>
        </div>
      </div>
    </div>
  );
}
