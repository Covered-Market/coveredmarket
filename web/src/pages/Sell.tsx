import { useEffect, useRef, useState, type ReactNode } from "react";
import { bech32 } from "@scure/base";
import { C, dateUtc, duration, usd } from "../ds";
import { call, CFG, toSats, toUsdcUnits, view, type Wallet } from "../lib/near";
import { hex } from "../lib/derive";
import { downloadKit, makeKit, newRescueKey, storeKit, storePendingKey } from "../lib/rescue";
import { annualised, useSpotStatus, useParams } from "./hooks";
import { expiryChoices } from "../lib/expiry";
import { who } from "../lib/activity";
import { SELL_STEPS, SellSteps } from "./SellSteps";

const DRAFT = "coveredmarket.sell.draft";
const loadDraft = (): Record<string, string> => { try { return JSON.parse(sessionStorage.getItem(DRAFT) ?? "{}") ?? {}; } catch { return {}; } };

/** Whether `a` is a v0 witness address (P2WPKH or P2WSH) on this network: the only kind the contract pays back to. */
export function isRefundAddress(a: string, hrp: string) {
  try {
    const d = bech32.decode(a.trim().toLowerCase() as `${string}1${string}`);
    if (d.prefix !== hrp || d.words[0] !== 0) return false;
    const n = bech32.fromWords(d.words.slice(1)).length;
    return n === 20 || n === 32;
  } catch { return false; }
}

const Header = () => (
  <div>
    <h1 className="display-2" style={{ margin: "0 0 8px", fontSize: 48, lineHeight: 1.02 }}>Sell a call</h1>
    <p className="lede" style={{ margin: 0, color: "var(--ink-muted)" }}>Your coins stay on Bitcoin. If the buyer pays the strike at expiry, they are sold at the strike. Either way you keep the premium.</p>
  </div>
);

/** One question per screen: the heading, why it matters, the input, and Back / Continue. Enter continues. */
function Step({ title, lede, children, onBack, canGo, onGo, go = "Continue" }: { title: string; lede: ReactNode; children: ReactNode; onBack?: () => void; canGo: boolean; onGo: () => void; go?: string }) {
  const { Button } = C();
  return (
    <form className="cv-flow cv-panel" onSubmit={(e) => { e.preventDefault(); if (canGo) onGo(); }} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h2 className="display-2" style={{ margin: "0 0 6px", fontSize: 28, lineHeight: 1.1 }}>{title}</h2>
        <p className="body" style={{ margin: 0, color: "var(--ink-muted)" }}>{lede}</p>
      </div>
      {children}
      <div className="cv-flow__nav">
        {onBack ? <Button size="lg" onClick={onBack}>Back</Button> : <span />}
        <Button type="submit" variant="primary" size="lg" disabled={!canGo}>{go}</Button>
      </div>
    </form>
  );
}

/** Quick picks under a field: small buttons that fill it in. */
const Picks = ({ items }: { items: { label: string; on: boolean; pick: () => void }[] }) => {
  const { Button } = C();
  return <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{items.map((p) => <Button key={p.label} size="sm" variant={p.on ? "primary" : "quiet"} onClick={p.pick}>{p.label}</Button>)}</div>;
};

/**
 * Selling a call, as a flow: size, strike, expiry, premium, return address, then a review that creates the offer
 * (step 7, the deposit, is its own page). Anyone can fill in the terms; a wallet is needed only to confirm.
 * The step is in the URL (`#/sell?step=3`) so the browser's Back goes back a step.
 */
export function Sell({ wallet, onConnect, step: asked = 1 }: { wallet: Wallet | null; onConnect: () => void; step?: number }) {
  const { Field, Button, OfferCard, Stamp } = C();
  const spotStatus = useSpotStatus(), spot = spotStatus.spot?.price ?? 0;
  const params = useParams();
  const draft = useState(loadDraft)[0];
  const [size, setSize] = useState(draft.size ?? "0.01");
  const [strike, setStrike] = useState(draft.strike ?? "");
  const [pick, setPick] = useState(1);
  const [premium, setPremium] = useState(draft.premium ?? "");
  const [refund, setRefund] = useState(draft.refund ?? "");
  const [busy, setBusy] = useState(false);
  const [rescue] = useState(newRescueKey); // made here; never leaves this browser except in the kit you download
  useEffect(() => { try { sessionStorage.setItem(DRAFT, JSON.stringify({ size, strike, premium, refund })); } catch {} }, [size, strike, premium, refund]);

  const s = parseFloat(size) || 0, k = parseFloat(strike) || 0, pr = parseFloat(premium) || 0;
  const minBtc = Number(params?.min_size_sats ?? 100000) / 1e8;
  const choices = expiryChoices(params);
  const expiry = (choices[pick] ?? choices[0]).at;
  const days = Math.max(1, (expiry - Date.now() / 1000) / 86400);
  const ann = annualised(pr, s, spot, expiry);
  const net = params?.network ?? "Testnet4";
  const hrp = net === "Mainnet" ? "bc" : net === "Regtest" ? "bcrt" : "tb";
  const sizeBad = s > 0 && s < minBtc, strikeBad = k > 0 && spot > 0 && k <= spot;
  const refundBad = refund.trim() !== "" && !isRefundAddress(refund, hrp);
  const valid = [s >= minBtc, k > 0 && !strikeBad, choices.length > 0, pr > 0, isRefundAddress(refund, hrp)];
  // You can be on any step whose earlier steps are all filled in.
  const reachable = valid.findIndex((v) => !v) + 1 || 6;
  const step = Math.max(1, Math.min(asked, reachable, 6));
  const go = (n: number) => { location.hash = n === 1 ? "#/sell" : `#/sell?step=${n}`; };
  const next = () => go(step + 1), back = step > 1 ? () => go(step - 1) : undefined;

  // Focus the new step's input, but not on first arrival (the page should not jump into a field uninvited).
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } document.querySelector<HTMLElement>(".cv-flow input, .cv-flow .cv-choice--on")?.focus(); }, [step]);

  const expiryDay = new Date(expiry * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const shortAddr = (a: string) => (a.length > 16 ? `${a.slice(0, 7)}…${a.slice(-4)}` : a);
  const values = [s ? `${s} BTC` : "", k ? usd(k * 1e6).replace(/\.00$/, "") : "", (choices[pick] ?? choices[0])?.label ?? "", pr ? usd(pr * 1e6) : "", refund ? shortAddr(refund.trim()) : "", ""];
  const items = SELL_STEPS.map((label, i) => ({ label, value: values[i], onClick: i < 6 && i + 1 <= reachable ? () => go(i + 1) : undefined }));

  const submit = async () => {
    if (!wallet) { onConnect(); return; }
    // Keep the private half before the offer exists: a reload or wallet redirect must not lose it.
    if (!storePendingKey(rescue.priv) && !confirm("This browser will not store your rescue key. If anything interrupts this step, the key is gone and the offer has no rescue exit. Continue anyway?")) return;
    setBusy(true);
    try {
      const serial = await call(wallet, CFG.contract, "create_offer", { terms: { size_sats: String(toSats(s)), strike_units: String(toUsdcUnits(k)), premium_units: String(toUsdcUnits(pr)), expiry_s: String(expiry), refund_address: refund.trim(), rescue_pubkey: hex.to(rescue.pub33) } }, 10n ** 23n, 60);
      const id = typeof serial === "number" ? serial : typeof serial === "string" ? Number(serial) : (serial as any)?.status?.SuccessValue ? Number(atob((serial as any).status.SuccessValue)) : null;
      if (id) {
        // The rescue kit: everything needed to sweep the coins with only Bitcoin, after the unlock time.
        let made = false;
        for (let i = 0; i < 10 && !made; i++) { try { const o: any = await view("get_offer", { serial: id }); if (o) { const kit = makeKit(o, rescue.priv); storeKit(kit); downloadKit(kit); made = true; break; } } catch {} await new Promise((r) => setTimeout(r, 1000)); }
        if (!made) alert(`CV-${id} was created, but its rescue kit could not be made yet. The deposit page will make it from the key kept in this browser: save the kit there before you deposit.`);
      }
      try { sessionStorage.removeItem(DRAFT); } catch {}
      location.hash = id ? `#/deposit/${id}` : "#/portfolio";
    } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  };

  const round = (v: number, to: number) => Math.round(v / to) * to;
  const body = (() => {
    switch (step) {
      case 1: return (
        <Step title="How much Bitcoin?" lede="The size of the call: the coins you would sell if the buyer exercises. You deposit exactly this amount after you confirm." canGo={valid[0]} onGo={next}>
          <Field id="sell-size" label="Size" value={size} onChange={(e) => setSize(e.target.value)} adorn="BTC" invalid={sizeBad} inputMode="decimal"
            help={sizeBad ? `The minimum is ${minBtc} BTC.` : s && spot ? `About ${usd(s * spot * 1e6)} at the reference price. Minimum ${minBtc} BTC.` : `Minimum ${minBtc} BTC.`} />
          <Picks items={[0.001, 0.01, 0.05, 0.1].filter((v) => v >= minBtc).map((v) => ({ label: `${v} BTC`, on: s === v, pick: () => setSize(String(v)) }))} />
        </Step>
      );
      case 2: return (
        <Step title="At what price would you sell?" lede="The strike. If Bitcoin ends above it, the buyer will likely pay it and take the coins; below it, you keep them." onBack={back} canGo={valid[1]} onGo={next}>
          <Field id="sell-strike" label="Strike" value={strike} onChange={(e) => setStrike(e.target.value)} adorn="USD" invalid={strikeBad} inputMode="decimal"
            help={strikeBad ? `The strike must be above the reference price (${usd(spot * 1e6)}).` : spot ? (k ? `${Math.round((k / spot - 1) * 100)}% above the reference price of ${usd(spot * 1e6)}.` : `The reference price is ${usd(spot * 1e6)}.`) : spotStatus.failed ? "Reference price unavailable right now." : "Loading the reference price…"} />
          {spot > 0 && <Picks items={[5, 10, 20, 30].map((p) => { const v = round(spot * (1 + p / 100), spot > 1000 ? 100 : 1); return { label: `+${p}% · ${usd(v * 1e6).replace(/\.00$/, "")}`, on: k === v, pick: () => setStrike(String(v)) }; })} />}
        </Step>
      );
      case 3: return (
        <Step title="When does it expire?" lede={<>At expiry the buyer has {duration(params?.grace_s ?? 7200)} to exercise by paying the strike. Nothing else decides the outcome: no price feed, no liquidation.</>} onBack={back} canGo={valid[2]} onGo={next}>
          <div className="cv-choices" role="radiogroup" aria-label="Expiry">
            {choices.map((c, i) => (
              <button key={c.at} type="button" role="radio" aria-checked={i === pick} className={`cv-choice${i === pick ? " cv-choice--on" : ""}`} onClick={() => setPick(i)}>
                <span className="cv-choice__main">{c.label}</span>
                <span className="cv-choice__sub">{dateUtc(c.at)}</span>
              </button>
            ))}
          </div>
        </Step>
      );
      case 4: return (
        <Step title="What premium do you ask?" lede="What the buyer pays you now, in USDC on NEAR. It is yours whatever happens; claim it any time." onBack={back} canGo={valid[3]} onGo={next}>
          <Field id="sell-premium" label="Premium" value={premium} onChange={(e) => setPremium(e.target.value)} adorn="USD" inputMode="decimal"
            help={pr && spot ? `${ann.toFixed(1)}% a year on ${usd(s * spot * 1e6)} of Bitcoin, for ${days < 2 ? "under 2 days" : `${Math.round(days)} days`}.` : "Shown as a yearly rate once you enter it."} />
          {spot > 0 && s > 0 && <Picks items={[5, 10, 20].map((a) => { const raw = (a / 100) * s * spot * (days / 365), v = raw >= 10 ? Math.round(raw) : Math.max(0.01, Math.round(raw * 100) / 100); return { label: `${a}% a year · ${usd(v * 1e6)}`, on: pr === v, pick: () => setPremium(String(v)) }; })} />}
        </Step>
      );
      case 5: return (
        <Step title="Where should the coins come back to?" lede="Your own Bitcoin address. The coins return here if the buyer does not exercise, or if you withdraw an unsold offer." onBack={back} canGo={valid[4]} onGo={next} go="Review">
          <Field id="sell-refund" label="Return coins to" value={refund} onChange={(e) => setRefund(e.target.value)} placeholder={`${hrp}1q…`} invalid={refundBad} inputMode="text"
            help={refundBad ? `Not an address the contract can pay on this network. Use a SegWit v0 address starting ${hrp}1q.` : `A SegWit v0 address starting ${hrp}1q, in a wallet you control.`} />
        </Step>
      );
      default: return (
        <div className="cv-panel" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div>
            <h2 className="display-2" style={{ margin: "0 0 6px", fontSize: 28, lineHeight: 1.1 }}>Review and confirm</h2>
            <p className="body" style={{ margin: 0, color: "var(--ink-muted)" }}>Check the terms. Once the offer is created they cannot change; to change them, cancel before you deposit and start again.</p>
          </div>
          <dl className="cv-terms">
            {[
              ["Size", `${s.toFixed(8)} BTC`, 1],
              ["Strike", `${usd(k * 1e6)} per BTC · ${usd(s * k * 1e6)} in all`, 2],
              ["Expiry", dateUtc(expiry), 3],
              ["Exercise window", `${duration(params?.grace_s ?? 7200)} after expiry`, 0],
              ["Premium", `${usd(pr * 1e6)} · ${ann.toFixed(1)}% a year`, 4],
              ["Return coins to", refund.trim(), 5],
            ].map(([l, v, n]) => (
              <div key={l as string} className="cv-terms__row">
                <dt className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)" }}>{l}</dt>
                <dd className="figure" style={{ margin: 0, wordBreak: "break-all" }}>{v}</dd>
                {n ? <Button size="sm" onClick={() => go(n as number)} aria-label={`Change ${l}`}>Change</Button> : <span />}
              </div>
            ))}
          </dl>
          <div className="cv-review-pair">
            <div data-cv="outcomes" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)" }}>What can happen</div>
              <div className="cv-outcome"><div className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 6 }}>If the buyer does not pay</div><div className="body">You keep the <b>{s.toFixed(8)} BTC</b> (less the {params?.fee_sats ?? 1000}-sat network fee) and the <b>{usd(pr * 1e6)}</b>.</div><div style={{ marginTop: 8 }}><Stamp status="kept" flat /></div></div>
              <div className="cv-outcome"><div className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 6 }}>If the buyer pays {usd(s * k * 1e6)}</div><div className="body">Your coins go to the buyer; you receive the strike plus the <b>{usd(pr * 1e6)}</b> you already have.</div><div style={{ marginTop: 8 }}><Stamp status="exercised" flat /></div></div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
              <div className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)" }}>How buyers will see it</div>
              <OfferCard offer={{ strike: k, expiry: expiryDay, premium: pr, annualised: Math.round(ann * 10) / 10, size: s, spot, vault: "made on confirm", seller: wallet ? who(wallet.accountId) : "you", status: "pending" }} action="Preview as a buyer" />
            </div>
          </div>
          <div style={{ border: "1px solid var(--gilt)", background: "var(--paper)", padding: "12px 14px" }}>
            <div className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 4 }}>Your exit, if NEAR ever stops</div>
            <div className="body-small" style={{ color: "var(--ink-muted)" }}>
              The deposit address also lets <b>a rescue key only you hold</b> move the coins, starting {duration(params?.rescue_delay_s ?? 2592000)} after the exercise window closes, with no NEAR involved. The key was made in this browser; confirming downloads your <b>rescue kit</b>. Keep it private and safe.
            </div>
          </div>
          <div className="cv-flow__nav">
            <Button size="lg" onClick={back}>Back</Button>
            {wallet
              ? <Button variant="primary" size="lg" disabled={busy} onClick={submit}>{busy ? "Creating…" : "Confirm and create offer"}</Button>
              : <Button variant="primary" size="lg" onClick={onConnect}>Connect a wallet to confirm</Button>}
          </div>
          <span className="body-small" style={{ color: "var(--ink-muted)", marginTop: -12, textAlign: "right" }}>{wallet ? "Creates the offer on NEAR and downloads your rescue kit. No coins move yet: step 7 shows the deposit address." : "Nothing is sent until you connect a wallet and confirm."}</span>
        </div>
      );
    }
  })();

  return (
    <div className="cv-pad cv-flowpage">
      <Header />
      <SellSteps current={step} items={items} />
      {body}
    </div>
  );
}
