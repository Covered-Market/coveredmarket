import { useState } from "react";
import { C, dateUtc, duration, usd } from "../ds";
import { call, CFG, toSats, toUsdcUnits, view, type Wallet } from "../lib/near";
import { hex } from "../lib/derive";
import { downloadKit, makeKit, newRescueKey, storeKit, storePendingKey } from "../lib/rescue";
import { annualised, useSpotStatus, useParams } from "./hooks";
import { expiryChoices } from "../lib/expiry";


/** Step 1: the terms. Anyone can fill them in and see what happens in each outcome; a wallet is needed only to continue. */
export function Sell({ wallet, onConnect }: { wallet: Wallet | null; onConnect: () => void }) {
  const { Field, Button, OfferCard, Stamp } = C();
  const spotStatus = useSpotStatus(), spot = spotStatus.spot?.price ?? 0;
  const params = useParams();
  const [size, setSize] = useState("0.01");
  const [strike, setStrike] = useState("");
  const [pick, setPick] = useState(1);
  const [premium, setPremium] = useState("");
  const [refund, setRefund] = useState("");
  const [busy, setBusy] = useState(false);
  const [rescue] = useState(newRescueKey); // made here; never leaves this browser except in the kit you download
  const s = parseFloat(size) || 0, k = parseFloat(strike) || 0, pr = parseFloat(premium) || 0;
  const choices = expiryChoices(params);
  const expiry = (choices[pick] ?? choices[0]).at;
  const ann = annualised(pr, s, spot, expiry);
  const strikeBad = k > 0 && spot > 0 && k <= spot;
  const net = params?.network ?? "Testnet4";
  const hrp = net === "Mainnet" ? "bc1" : net === "Regtest" ? "bcrt1" : "tb1";
  const submit = async () => {
    if (!wallet) { onConnect(); return; }
    // Keep the private half before the offer exists: a reload or wallet redirect must not lose it.
    if (!storePendingKey(rescue.priv) && !confirm("This browser will not store your rescue key. If anything interrupts this step, the key is gone and the offer has no rescue exit. Continue anyway?")) return;
    setBusy(true);
    try {
      const serial = await call(wallet, CFG.contract, "create_offer", { terms: { size_sats: String(toSats(s)), strike_units: String(toUsdcUnits(k)), premium_units: String(toUsdcUnits(pr)), expiry_s: String(expiry), refund_address: refund, rescue_pubkey: hex.to(rescue.pub33) } }, 10n ** 23n, 60);
      const id = typeof serial === "number" ? serial : typeof serial === "string" ? Number(serial) : (serial as any)?.status?.SuccessValue ? Number(atob((serial as any).status.SuccessValue)) : null;
      if (id) {
        // The rescue kit: everything needed to sweep the coins with only Bitcoin, after the unlock time.
        let made = false;
        for (let i = 0; i < 10 && !made; i++) { try { const o: any = await view("get_offer", { serial: id }); if (o) { const kit = makeKit(o, rescue.priv); storeKit(kit); downloadKit(kit); made = true; break; } } catch {} await new Promise((r) => setTimeout(r, 1000)); }
        if (!made) alert(`CV-${id} was created, but its rescue kit could not be made yet. The deposit page will make it from the key kept in this browser: save the kit there before you deposit.`);
      }
      location.hash = id ? `#/deposit/${id}` : "#/portfolio";
    } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="cv-split cv-pad" style={{ padding: "32px 48px", display: "grid", gridTemplateColumns: "minmax(0, 560px) minmax(0, 1fr)", gap: 56 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <div className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 8 }}>Step 1 of 3 · Terms</div>
          <h1 className="display-2" style={{ margin: "0 0 8px", fontSize: 48, lineHeight: 1.02 }}>Sell a call</h1>
          <p className="body" style={{ margin: 0, color: "var(--ink-muted)" }}>You keep the coins on Bitcoin. If at expiry the buyer pays the strike, they are sold at the strike. Either way you keep the premium.</p>
        </div>
        <Field label="Size" value={size} onChange={(e) => setSize(e.target.value)} adorn="BTC" help={`Deposited in step 2, exactly. Minimum ${Number(params?.min_size_sats ?? 100000) / 1e8} BTC.`} inputMode="decimal" />
        <Field label="Strike" value={strike} onChange={(e) => setStrike(e.target.value)} adorn="USD" invalid={strikeBad} help={strikeBad ? `Strike must be above the reference price (${usd(spot * 1e6)}).` : spot ? `Reference price ${usd(spot * 1e6)}; this is ${k ? Math.round((k / spot - 1) * 100) : 0}% above.` : spotStatus.failed ? "Reference price unavailable right now." : "Loading reference price"} inputMode="decimal" />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)" }}>Expiry</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {choices.map((c, i) => <Button key={c.at} size="sm" variant={i === pick ? "primary" : "quiet"} onClick={() => setPick(i)}>{c.label}</Button>)}
          </div>
          <span className="body-small" style={{ color: "var(--ink-muted)" }}>{dateUtc(expiry)}. The buyer may then exercise for {duration(params?.grace_s ?? 7200)} by paying the strike. No price feed decides the outcome.</span>
        </div>
        <Field label="Premium you ask" value={premium} onChange={(e) => setPremium(e.target.value)} adorn="USD" help={`${ann.toFixed(1)}% annualised on ${usd(s * spot * 1e6)} of Bitcoin. Paid in USDC on NEAR; claim any time.`} inputMode="decimal" />
        <Field label="Return coins to" value={refund} onChange={(e) => setRefund(e.target.value)} placeholder={`${hrp}q…`} help="Your own Bitcoin address (bech32, v0). Coins come back here if kept or withdrawn." />
        <div style={{ border: "1px solid var(--rule)", background: "var(--paper-raised)", padding: "12px 14px" }}>
          <div className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 4 }}>Your exit, if NEAR ever stops</div>
          <div className="body-small" style={{ color: "var(--ink-muted)" }}>
            The deposit address also lets <b>a rescue key only you hold</b> move the coins, starting {duration(params?.rescue_delay_s ?? 2592000)} after the exercise window closes, with no NEAR involved. The key was just made in this browser; continuing downloads your <b>rescue kit</b> (keep it private and safe).
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {wallet
            ? <Button variant="primary" size="lg" disabled={busy || !s || !k || !pr || !refund || strikeBad} onClick={submit}>{busy ? "Creating…" : "Continue to deposit"}</Button>
            : <Button variant="primary" size="lg" onClick={onConnect}>Connect a wallet to continue</Button>}
          <span className="body-small" style={{ color: "var(--ink-muted)" }}>{wallet ? "Nothing is deposited yet. Step 2 shows the address." : "Try the terms first: nothing is sent until you connect and continue."}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingTop: 44 }}>
        <div className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)" }}>What you are offering</div>
        <div style={{ maxWidth: 400 }}><OfferCard offer={{ strike: k, expiry: new Date(expiry * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }), premium: pr, annualised: Math.round(ann * 10) / 10, size: s, spot, vault: "to be derived", seller: wallet?.accountId ?? "you", status: "pending" }} action="Preview as a buyer" /></div>
        <div data-cv="outcomes" style={{ border: "1px solid var(--rule)", background: "var(--paper-raised)", padding: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, maxWidth: 520 }}>
          <div><div className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 6 }}>If the buyer does not pay</div><div className="body">You keep the <b>{s.toFixed(8)} BTC</b> (less the {params?.fee_sats ?? 1000}-sat network fee) and the <b>{usd(pr * 1e6)}</b>.</div><div style={{ marginTop: 8 }}><Stamp status="kept" flat /></div></div>
          <div><div className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 6 }}>If the buyer pays {usd(s * k * 1e6)}</div><div className="body">Your coins are delivered to the buyer; you receive the strike plus the <b>{usd(pr * 1e6)}</b> you already have.</div><div style={{ marginTop: 8 }}><Stamp status="exercised" flat /></div></div>
        </div>
      </div>
    </div>
  );
}
