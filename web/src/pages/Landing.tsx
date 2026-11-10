/**
 * The public landing page. On the website (CFG.mode "site", covered.market) it carries no network band, switch
 * or contract ids, and every app link leaves for the testnet app (CFG.testnetUrl). On the local stack it is `/` of
 * the local app.
 * Product images are real captures of the app (scripts/shots). The hero shows the film (HeroFilm).
 */
import { useEffect, useState, type ReactNode } from "react";
import { CFG } from "../lib/near";
import { useSpot } from "./hooks";
import "../landing.css";

const SECURITY = "security@covered.market";
const REPO = "https://github.com/Covered-Market/coveredmarket";
/** The film for the hero: a YouTube embed link, e.g. https://www.youtube-nocookie.com/embed/<id>. Empty until it is
 *  out. The site config's `filmUrl` overrides it. */
const FILM_URL = "";
const filmUrl = () => (CFG as unknown as { filmUrl?: string }).filmUrl || FILM_URL;

/** Where links go: the testnet app on the website, this app on the local stack. Read after loadConfig() has run
 *  (module scope runs before it), so a function of CFG. */
const links = () => {
  const base = CFG.mode === "site" ? (CFG.testnetUrl ?? "") : "";
  return { app: (route: string) => `${base}/#/${route}` };
};

/** In-page anchors: the app uses the hash for routes, so section links scroll instead of changing the hash. */
function jump(e: React.MouseEvent, id: string) { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
const A = ({ to, children, className, style }: { to: string; children: ReactNode; className?: string; style?: React.CSSProperties }) => <a href={`#${to}`} onClick={(e) => jump(e, to)} className={className} style={style}>{children}</a>;

/** The film as an embedded player (FILM_URL). Before play it shows the film's poster: the plain version of
 *  brand/assets/Social/video-poster-*, since the page carries the rosette itself (.ld-seal). Pressing play swaps in
 *  the player, with its own controls and full screen. Without a film yet the play mark is decoration. */
function HeroFilm() {
  const url = filmUrl();
  const [playing, setPlaying] = useState(false);
  const play = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor" /></svg>;
  if (playing && url) return (
    <div className="ld-film">
      <iframe src={`${url}${url.includes("?") ? "&" : "?"}autoplay=1&rel=0`} title="CoveredMarket: from offer to settlement" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
    </div>
  );
  return (
    <div className="ld-film">
      <img src="/site/film/poster.png" alt="From offer to settlement: one covered call on native Bitcoin" />
      {url ? <button type="button" className="ld-play" onClick={() => setPlaying(true)} aria-label="Play the film">{play}</button> : <span className="ld-play" aria-hidden="true">{play}</span>}
    </div>
  );
}

const Kicker = ({ n, children }: { n?: string; children: ReactNode }) => <p className="ld-kicker">{n ? `Art. ${n} · ` : ""}{children}</p>;
const Frame = ({ path, src, alt }: { path: string; src: string; alt: string }) => (
  <div className="ld-frame" data-theme="paper"><div className="ld-frame-bar"><i /><i /><span>{path}</span></div><img src={src} alt={alt} loading="lazy" decoding="async" /></div>
);
const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} fill="none" stroke="var(--intaglio)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;

// Marks are one SVG each, drawn on a 28-unit grid: "yes" is a solid disc; "no" and "part" are a ring with the same
// stroke weight as their glyph, so the two read as one line. The stroke is rescaled so it lands at 2px at any size.
const MARK = {
  yes: { word: "Yes", color: "var(--intaglio)", glyph: "var(--on-intaglio)", d: "M9 14.5l3.4 3.4L19 11", solid: true },
  no: { word: "No", color: "var(--oxblood)", glyph: "var(--oxblood)", d: "M10.5 10.5l7 7M17.5 10.5l-7 7", solid: false },
  part: { word: "Partly", color: "var(--gilt-ink)", glyph: "var(--gilt-ink)", d: "M9.5 14h9", solid: false },
};
type M = keyof typeof MARK;
const COMPARE: [string, [M, string], [M, string], [M, string], [M, string]][] = [
  ["Coins stay on Bitcoin", ["yes", "At their own address"], ["no", "Deposited to the exchange"], ["no", "Deposited to the exchange"], ["no", "Wrapped BTC on another chain"]],
  ["No custodian holds them", ["yes", "Only the contract, or your rescue key"], ["no", ""], ["no", ""], ["part", "Vault is yours; the wrapper is not"]],
  ["You set strike and expiry", ["yes", "Any strike, any day"], ["part", "Listed strikes and dates"], ["part", "Offered prices; Tue and Fri"], ["no", "The vault picks"]],
  ["You set the price", ["yes", "You ask, a buyer accepts"], ["yes", "Limit orders"], ["no", "Rate is quoted"], ["no", "Sold at auction"]],
  ["Paid up front", ["yes", "When the call sells"], ["yes", "When the order fills"], ["no", "Paid at settlement"], ["part", "Accrues in the vault"]],
  ["No sign-up or ID check", ["yes", "A NEAR wallet"], ["no", "ID for every user"], ["no", "Exchange account"], ["yes", "A wallet"]],
  ["Check it yourself on chain", ["yes", "In your browser"], ["no", ""], ["no", ""], ["yes", ""]],
];
const Mark = ({ m, small }: { m: M; small?: boolean }) => {
  const k = MARK[m], size = small ? 24 : 28, sw = (2 * 28) / size;
  return (
    <svg className="ld-mark" width={size} height={size} viewBox="0 0 28 28" role="img" aria-label={k.word}>
      {k.solid ? <circle cx="14" cy="14" r="14" fill={k.color} /> : <circle cx="14" cy="14" r={14 - sw / 2} fill="none" stroke={k.color} strokeWidth={sw} />}
      <path d={k.d} fill="none" stroke={k.glyph} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};
const CMP_COLS = ["CoveredMarket", "Deribit", "Binance Dual Investment", "DeFi call vaults"];
/** A comparison mark; its note shows as a tooltip on hover or focus (desktop), and is read with the mark by screen readers. */
const CmpCell = ({ m, note, ours, end }: { m: M; note: string; ours: boolean; end?: boolean }) => (
  <div role="cell" className={ours ? "ours" : ""} data-theme={ours ? "vault" : undefined}>
    <span className={note ? "ld-tipped" + (end ? " ld-tipped--end" : "") : undefined} tabIndex={note ? 0 : undefined}>
      <Mark m={m} />
      {note && <><span className="ld-sr">: {note}</span><span className="ld-tip" data-theme={ours ? "vault" : "paper"} aria-hidden="true">{note}</span></>}
    </span>
  </div>
);
/** Phone: four marks per row; tapping a mark with a note shows it in a line under the row. */
function ComparePhone() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="ld-cmp-phone" style={{ flexDirection: "column", borderTop: "1px solid var(--rule-strong)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4, padding: "12px 0", borderBottom: "1px solid var(--rule)" }}>
        {["CoveredMarket", "Deribit", "Binance Dual", "DeFi vaults"].map((h, i) => <span key={h} className="ld-word" data-theme={i === 0 ? "vault" : undefined} style={{ fontSize: 10, textAlign: "center", padding: "6px 2px", background: i === 0 ? "var(--paper)" : undefined, color: i === 0 ? "var(--ink)" : "var(--ink-muted)" }}>{h === "CoveredMarket" ? <>Covered<wbr />Market</> : h}</span>)}
      </div>
      {COMPARE.map(([row, ...cells]) => {
        const shown = cells.findIndex((_, i) => open === row + i);
        return (
          <div key={row} style={{ padding: "14px 0", borderBottom: "1px solid var(--rule)", display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="body-small" style={{ fontWeight: 600 }}>{row}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4 }}>
              {cells.map(([m, note], i) => {
                const k = row + i, on = open === k, style = { background: i === 0 ? "var(--paper)" : undefined, padding: "8px 2px", display: "flex", justifyContent: "center" } as const;
                return note
                  ? <button key={i} type="button" className={"ld-cmp-tap" + (on ? " on" : "")} data-theme={i === 0 ? "vault" : undefined} style={style} aria-expanded={on} aria-label={`${CMP_COLS[i]}: ${MARK[m].word}. ${note}`} onClick={() => setOpen(on ? null : k)}><Mark m={m} small /></button>
                  : <div key={i} data-theme={i === 0 ? "vault" : undefined} style={style}><Mark m={m} small /></div>;
              })}
            </div>
            {shown >= 0 && <p className="body-small" role="status" style={{ margin: 0 }}><strong>{CMP_COLS[shown]}</strong> <span className="ld-muted">· {cells[shown][1]}</span></p>}
          </div>
        );
      })}
      <p className="body-small ld-muted" style={{ margin: "8px 0 0" }}>Tap a mark for details. Binance Dual: Binance Dual Investment. DeFi vaults: Thetanuts, StakeDAO and others.</p>
    </div>
  );
}

const BENEFITS = [
  ["key", "Custody-free", "Your coins never leave Bitcoin. Only the contract can sign for their address, and a rescue key only you hold is your way out: no exchange, no bridge, no wrapped token, no owner key."],
  ["kept", "No margin, no liquidation", "Your coins cover the call in full, so a price spike cannot close you out. The premium is yours whatever happens."],
  ["wallet", "No sign-up form", "A NEAR wallet is your account: no form, no ID check, no account with us."],
  ["verify", "Fully verifiable", "Seven checks run in your browser against NEAR and Bitcoin directly. None of them ask us."],
];

const built = (): { status: "Live" | "Partly" | "Next"; name: string; what: string; id: string; d: string }[] => [
  { status: "Live", name: "Chain Signatures", what: "NEAR’s MPC network gives the contract its own Bitcoin key for every offer, derived from the contract, your account and the offer’s serial, and signs only the transaction the contract has committed to.", id: "NEAR MPC · derived keys", d: "M12 3a2 2 0 1 0 0.01 0 M5 17a2 2 0 1 0 0.01 0 M19 17a2 2 0 1 0 0.01 0 M11 6.5l-5 8.5 M13 6.5l5 8.5 M7 19h10" },
  { status: "Live", name: "A contract nobody controls", what: "NEAR accounts are governed by access keys. CoveredMarket’s contract has none after deployment, so it cannot be upgraded or drained, and Verify checks that from your browser.", id: "0 access keys · no upgrades", d: "M7 11V8a5 5 0 0 1 10 0v3 M5 11h14v10H5z M12 15v2" },
  { status: "Live", name: "Pay and act in one receipt", what: "The buyer’s USDC arrives with its instruction through NEP-141 ft_transfer_call. The premium is credited and the buyer recorded in the same receipt, with no pending state between.", id: "NEP-141 · ft_transfer_call", d: "M4 12h6 M14 12h6 M10 8l4 4-4 4 M4 6v12 M20 6v12" },
  { status: "Live", name: "Meta-transactions", what: "NEAR delegate actions let you sign while a relayer submits the transaction and pays its gas, in wallets that support them. The relayer can never act alone.", id: "NEP-366 delegate actions", d: "M4 12h13 M13 7l5 5-5 5 M4 6v12" },
];
const STATUS_COLOR = { Live: "var(--intaglio)", Partly: "var(--gilt-ink)", Next: "var(--ink-muted)" };

const STEPS = [
  { n: "01", title: "Choose your terms", text: "Size, strike, expiry and the premium you ask. Before you commit, the page says in words what happens in each outcome.", tech: "Meta-transactions · NEP-366", path: "covered · /sell", img: "/site/shots/step-sell.webp", alt: "The sell form: 2 BTC, strike $150,000, premium $6,000" },
  { n: "02", title: "Deposit to your contract’s own address", text: "A Bitcoin address is derived for this one contract. Only the contract can ask for a signature for it; a rescue key only you hold is the way out if NEAR ever stops. Your deposit is proven on NEAR by a Bitcoin light client.", tech: "Chain Signatures · Bitcoin light client", path: "covered · /c/1 · on-chain record", img: "/site/shots/step-deposit.webp", alt: "The on-chain record of CV-1: deposit address, deposit transaction, refund address, contract, signer and light client" },
  { n: "03", title: "Get paid when it sells", text: "A buyer pays the premium in USDC on NEAR. It is credited to you in the same transaction that records the buyer. Claim it any time.", tech: "USDC on NEAR", path: "covered · /contracts", img: "/site/shots/step-sold2.webp", alt: "My contracts: 0.0010 BTC at rest in live contracts and $5.00 of premium ready to claim" },
  { n: "04", title: "At expiry, the contract signs", text: "After expiry the buyer has a short exercise window to pay the strike. If they do, the contract signs the coins to them; if not, it signs them back to your address.", tech: "Chain Signatures", path: "covered · /c/1", img: "/site/shots/step-cert.webp", alt: "The certificate of CV-1: 0.0010 BTC, strike $150,000, expires 6 Nov 2026, 11:07 UTC" },
];

const FAQ = [
  ["What is a covered call?", "You sell someone the right to buy your coins at a price you set, on a date you set. They pay you for that right now. You keep the payment whatever happens."],
  ["Where are my coins during the contract?", "On Bitcoin, at an address derived for your contract alone. You can look it up on any explorer. Only the contract can ask for a signature for it."],
  ["Can I get my coins back early?", "Before a buyer takes the call, yes: withdraw the offer. Once it has sold, the coins stay until expiry."],
  ["What if Bitcoin goes far above the strike?", "Your coins are sold at the strike. You keep the premium but not the rise above the strike."],
  ["Do I need NEAR?", "A little. Creating an offer attaches 0.1 NEAR for storage, and most of it comes back. If your wallet supports gasless signing, a relayer pays the gas; otherwise you pay it. On testnet, connecting a wallet sends you test NEAR."],
  ["What if NEAR stops working?", "Your coins are not stuck. Their address also accepts a rescue key that only you hold, saved in the rescue kit you download when you sell. After a fixed delay past expiry, it moves the coins back to you with Bitcoin alone."],
  ["What does CoveredMarket charge?", "Nothing. It runs on test coins only."],
  ["Has the contract been audited?", "Not yet, which is one reason it runs on test coins only."],
];

function Payoff() {
  const [price, setPrice] = useState(131200);
  const K = 150000, size = 2, prem = 6000;
  const X = (p: number) => 56 + ((p - 90000) / 120000) * 444, Y = (v: number) => 260 - ((v - 180000) / (426000 - 180000)) * 240;
  const val = (p: number) => Math.min(p, K) * size + prem, cap = Y(K * size + prem);
  const fmt = (n: number) => "$" + n.toLocaleString("en-US");
  return (
    <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <svg viewBox="0 0 520 300" role="img" aria-label="What Astrid has on 31 December, by Bitcoin price" style={{ width: "100%", height: "auto" }}>
        <defs><pattern id="ld-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink-muted)" strokeWidth="1" /></pattern></defs>
        <line x1="56" y1="260" x2="500" y2="260" stroke="var(--rule-strong)" />
        <line x1="56" y1="20" x2="56" y2="260" stroke="var(--rule-strong)" />
        <polygon points={`${X(K)},${cap} ${X(210000)},${Y(210000 * size + prem)} ${X(210000)},${cap}`} fill="url(#ld-hatch)" opacity="0.5" />
        <line x1={X(K)} y1="20" x2={X(K)} y2="260" stroke="var(--gilt)" strokeWidth="1.5" strokeDasharray="5 4" />
        <polyline points={[90000, K, 210000].map((p) => `${X(p)},${Y(val(p))}`).join(" ")} fill="none" stroke="var(--intaglio)" strokeWidth="2" />
        <line x1={X(price)} y1="20" x2={X(price)} y2="260" stroke="var(--ink)" />
        <circle cx={X(price)} cy={Y(val(price))} r="5" fill="var(--paper)" stroke="var(--ink)" strokeWidth="2" />
        <text x={X(K)} y="14" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="12" fill="var(--gilt-ink)">strike $150,000</text>
        <text x="490" y={cap - 30} textAnchor="end" fontFamily="var(--font-sans)" fontSize="12" fill="var(--ink-muted)">rise given up</text>
        <text x="60" y="280" fontFamily="var(--font-mono)" fontSize="12" fill="var(--ink-muted)">$90,000</text>
        <text x="500" y="280" textAnchor="end" fontFamily="var(--font-mono)" fontSize="12" fill="var(--ink-muted)">$210,000</text>
        <text x="278" y="296" textAnchor="middle" fontFamily="var(--font-sans)" fontSize="12" fill="var(--ink-muted)">Bitcoin on 31 Dec 2026</text>
      </svg>
      <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="ld-label ld-muted">If Bitcoin is at <span className="ld-mono" style={{ color: "var(--ink)", letterSpacing: 0 }}>{fmt(price)}</span> on 31 Dec 2026</span>
        <input className="ld-range" type="range" min={90000} max={210000} step={1000} value={price} onChange={(e) => setPrice(Number(e.target.value))} aria-valuetext={fmt(price)} />
      </label>
      <p className="ld-lede" style={{ fontSize: 19 }}>{price < K ? "Below the strike. Astrid gets her 2.0000 BTC back and keeps the $6,000." : "Above the strike. Astrid sells at $150,000 a coin: $300,000, plus the $6,000 she already has."}</p>
    </figure>
  );
}

function Calculator() {
  const spot = useSpot();
  const S = spot?.price ?? 76078;
  const [size, setSize] = useState(1), [prem, setPrem] = useState(1500), [days, setDays] = useState(30);
  const term = (prem / (size * S)) * 100, ann = (term * 365) / days;
  const pct = (v: number) => v.toFixed(v < 10 ? 2 : 1) + "%";
  return (
    <div className="ld-calc">
      <p className="ld-label ld-muted" style={{ margin: 0 }}>Work out a call</p>
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span style={{ display: "flex", justifyContent: "space-between" }}><span className="ld-label ld-muted">Coins</span><span className="ld-mono" style={{ color: "var(--copper-ink)" }}>{size.toFixed(1)} BTC</span></span><input className="ld-range" style={{ accentColor: "var(--gilt)" }} type="range" min={0.1} max={5} step={0.1} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-valuetext={`${size.toFixed(1)} BTC`} /></label>
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span style={{ display: "flex", justifyContent: "space-between" }}><span className="ld-label ld-muted">Premium you ask</span><span className="ld-mono" style={{ color: "var(--gilt-ink)" }}>${prem.toLocaleString("en-US")}</span></span><input className="ld-range" style={{ accentColor: "var(--gilt)" }} type="range" min={50} max={10000} step={50} value={prem} onChange={(e) => setPrem(Number(e.target.value))} aria-valuetext={`$${prem}`} /></label>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}><span className="ld-label ld-muted">Expiry</span>
        <div role="group" aria-label="Days to expiry" className="ld-row" style={{ gap: 8 }}>{[7, 14, 30, 56].map((n) => <button key={n} type="button" className="ld-chip" aria-pressed={n === days} onClick={() => setDays(n)}>{n} days</button>)}</div>
      </div>
      <div style={{ borderTop: "1px solid var(--rule-strong)", paddingTop: 20, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
        <div><div className="ld-label ld-muted">For the term</div><div className="ld-big" style={{ color: "var(--gilt-ink)" }}>{pct(term)}</div></div>
        <div><div className="ld-label ld-muted">Annualised</div><div className="ld-big">{pct(ann)}</div></div>
      </div>
      <p className="body-small ld-muted" style={{ margin: 0 }}>At a Bitcoin price of <span className="ld-mono">${Math.round(S).toLocaleString("en-US")}</span>{spot ? " (live reference, median of " + spot.sources + " tickers)" : " (reference, 6 Nov 2026)"}. Annualised assumes you sell a call like this every time one ends, which is not guaranteed.</p>
    </div>
  );
}

export function Landing() {
  const { app } = links();
  const [menu, setMenu] = useState(false);
  useEffect(() => { document.title = "CoveredMarket — earn on Bitcoin you still hold"; const id = location.hash.slice(1); if (id && !id.startsWith("/")) setTimeout(() => document.getElementById(id)?.scrollIntoView(), 50); }, []);
  const nav: [string, string][] = [["how", "How it works"], ["returns", "Returns"], ["compare", "Compare"], ["trust", "Trust"], ["stack", "Built with"], ["faq", "FAQ"]];
  return (
    <div className="ld">
      <img className="ld-seal" src="/site/rosette.svg" alt="" aria-hidden="true" />
      <header className="ld-head">
        <div className="ld-wrap">
          <a href="/" aria-label="CoveredMarket home" className="ld-logo-link"><img className="ld-logo" src="/site/lockup-32.svg" alt="CoveredMarket" /></a>
          <nav className="ld-nav" aria-label="Sections">{nav.map(([id, l]) => <A key={id} to={id}>{l}</A>)}</nav>
          <div className="ld-head-right">
            <a className="ld-btn ld-btn--primary" style={{ minHeight: 44, padding: "10px 16px", fontSize: 15 }} href={app("market")}>Open the app</a>
            <button type="button" className="ld-btn ld-btn--quiet ld-menu" style={{ minHeight: 44, padding: "10px 12px", fontSize: 15 }} aria-expanded={menu} aria-label="Menu" onClick={() => setMenu(!menu)}><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg></button>
          </div>
        </div>
        {menu && <div className="ld-wrap"><nav className="ld-drawer" aria-label="Sections">{nav.map(([id, l]) => <a key={id} href={`#${id}`} onClick={(e) => { setMenu(false); jump(e, id); }}>{l}</a>)}</nav></div>}
      </header>

      <main>
        {/* hero */}
        <section className="ld-hero" aria-labelledby="hero-h">
          <div className="ld-wrap ld-hero-grid">
            <div className="ld-stack" style={{ minWidth: 0 }}>
              <p className="ld-kicker" style={{ margin: 0 }}>Covered calls on native Bitcoin</p>
              <h1 id="hero-h" className="ld-h1"><span>Earn on Bitcoin</span><span style={{ color: "var(--intaglio)" }}>you still hold.</span></h1>
              <p className="ld-hero-lede">Sell covered calls on coins that never leave Bitcoin. A NEAR contract signs for them, a rescue key only you hold is your way out, and the premium is yours whatever happens.</p>
            </div>
            <figure id="film" className="ld-hero-film">
              <HeroFilm />
              <figcaption className="body-small ld-muted">Astrid sells a call on her Bitcoin, Marcus buys it, and the contract settles on Bitcoin.</figcaption>
            </figure>
          </div>
        </section>

        {/* benefits */}
        <section id="why" className="ld-sec ld-vault" data-theme="vault" aria-labelledby="why-h">
          <div className="ld-wrap ld-stack" style={{ gap: 40 }}>
            <div><Kicker n="01">Why CoveredMarket</Kicker><h2 id="why-h" className="ld-h2">Everything an exchange offers, except the exchange.</h2></div>
            <div className="ld-4">
              {BENEFITS.map(([icon, t, x]) => (
                <div className="ld-benefit" key={t}><span className="ld-disc"><span className="ld-glyph" aria-hidden="true" style={{ ["--glyph" as string]: `url(/site/icons/${icon}.svg)` }} /></span><h3 className="heading" style={{ margin: 0 }}>{t}</h3><p className="body-small ld-muted" style={{ margin: 0 }}>{x}</p></div>
              ))}
            </div>
          </div>
        </section>

        {/* story */}
        <section className="ld-sec" style={{ borderTop: "1px solid var(--rule)" }} aria-labelledby="story-h">
          <div className="ld-wrap">
            <div className="ld-2" style={{ alignItems: "center" }}>
              <div className="ld-stack" style={{ gap: 16, maxWidth: "60ch" }}>
                <div style={{ marginBottom: 16 }}><Kicker n="02">The idea</Kicker><h2 id="story-h" className="ld-h2">You sell the rise above a price you choose.</h2></div>
                <p className="body" style={{ margin: 0 }}>Astrid holds <span className="ld-mono" style={{ color: "var(--copper-ink)" }}>2.0000 BTC</span> she has no plan to sell this year. She offers a buyer the right to buy them at <span className="ld-mono">$150,000</span> on <span className="ld-mono">31 Dec 2026</span>. Marcus takes it and pays her <span className="ld-mono" style={{ color: "var(--gilt-ink)" }}>$6,000</span> now.</p>
                <p className="body" style={{ margin: 0 }}>If Bitcoin ends below <span className="ld-mono">$150,000</span>, the contract signs her coins back to her. If it ends above, her coins are sold to Marcus at <span className="ld-mono">$150,000</span>. Either way the <span className="ld-mono" style={{ color: "var(--gilt-ink)" }}>$6,000</span> is hers.</p>
                <p className="body-small ld-muted" style={{ margin: 0, paddingTop: 8, borderTop: "1px solid var(--rule)" }}>The trade-off: if Bitcoin rises far past the strike, she gives up the rise above it. That is what the premium pays for. Her coins cannot be withdrawn during the term.</p>
              </div>
              <Payoff />
            </div>
          </div>
        </section>

        {/* returns */}
        <section id="returns" className="ld-sec ld-vault" data-theme="vault" aria-labelledby="returns-h">
          <div className="ld-wrap ld-2">
            <div className="ld-stack" style={{ gap: 20 }}>
              <div><Kicker n="03">Returns</Kicker><h2 id="returns-h" className="ld-h2">Your return is the premium you ask for.</h2></div>
              <p className="body ld-muted" style={{ margin: 0, maxWidth: "52ch" }}>There is no pool and no promised rate. You name a price for your call; a buyer pays it or does not. What decides the premium:</p>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", borderTop: "1px solid var(--rule)" }}>
                {[["Strike.", "Closer to today’s price pays more, and is more likely to be sold."], ["Time.", "A longer call pays more; a short one can be sold again sooner."], ["Volatility.", "When Bitcoin swings, buyers pay more for the upside."]].map(([b, t]) => <li key={b} className="body-small" style={{ padding: "12px 0", borderBottom: "1px solid var(--rule)" }}><strong>{b}</strong> <span className="ld-muted">{t}</span></li>)}
              </ul>
              <p className="body-small ld-muted" style={{ margin: 0 }}>Nothing here is a forecast or advice.</p>
            </div>
            <Calculator />
          </div>
        </section>
        <div aria-hidden="true" style={{ height: 16, backgroundImage: "url(/site/coupon-edge.svg)", backgroundRepeat: "repeat-x", backgroundPosition: "center", opacity: 0.6 }} />

        {/* how it works */}
        <section id="how" className="ld-sec" aria-labelledby="how-h">
          <div className="ld-wrap ld-stack" style={{ gap: 40 }}>
            <div><Kicker n="04">How it works</Kicker><h2 id="how-h" className="ld-h2">Four steps. Your coins move twice.</h2></div>
            {STEPS.map((s) => (
              <div className="ld-step" key={s.n}>
                <div className="ld-stack" style={{ gap: 12 }}>
                  <div className="ld-mono" style={{ color: "var(--gilt-ink)" }}>{s.n}</div>
                  <h3 className="heading" style={{ margin: 0 }}>{s.title}</h3>
                  <p className="body ld-muted" style={{ margin: 0 }}>{s.text}</p>
                  <div className="ld-label" style={{ color: "var(--intaglio)" }}>{s.tech}</div>
                </div>
                <div className="ld-shotplate" data-theme="vault"><Frame path={s.path} src={s.img} alt={s.alt} /></div>
              </div>
            ))}
          </div>
        </section>

        {/* built with */}
        <section id="stack" className="ld-sec ld-raised" style={{ borderTop: "1px solid var(--rule)", position: "relative", overflow: "hidden" }} aria-labelledby="stack-h">
          <div className="ld-wrap ld-stack" style={{ gap: 32, position: "relative" }}>
            <div className="ld-2" style={{ alignItems: "end", gap: "24px 48px" }}>
              <div><Kicker n="05">Built with</Kicker><h2 id="stack-h" className="ld-h2" style={{ maxWidth: "16ch" }}>Built on NEAR. Settled on Bitcoin.</h2></div>
              <p className="ld-lede" style={{ maxWidth: "40ch" }}>CoveredMarket is one contract and a thin relayer. What makes it possible is NEAR: a contract that can hold a Bitcoin key without anyone holding it.</p>
            </div>
            <div className="ld-3 ld-built">
              {built().map((t) => (
                <article className="ld-tech" key={t.name}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <span className="ld-disc" style={{ width: 48, height: 48 }}><Icon d={t.d} /></span>
                    <span className="ld-stamp" style={{ color: STATUS_COLOR[t.status], borderStyle: t.status === "Next" ? "dashed" : "solid" }}>{t.status}</span>
                  </div>
                  <h3 className="heading" style={{ margin: 0 }}>{t.name}</h3>
                  <p className="body-small ld-muted" style={{ margin: 0 }}>{t.what}</p>
                  <div className="ld-tech-id">{t.id}</div>
                </article>
              ))}
            </div>
            <p className="body-small ld-muted" style={{ margin: 0, maxWidth: "90ch" }}>Also on chain: Bitcoin deposits and settlements are proven to the contract through a Bitcoin light client on NEAR, and every certificate can be checked in the browser.</p>
          </div>
        </section>

        {/* compare */}
        <section id="compare" className="ld-sec" aria-labelledby="compare-h">
          <div className="ld-wrap ld-stack" style={{ gap: 32 }}>
            <div><Kicker n="06">Compared</Kicker><h2 id="compare-h" className="ld-h2">Other ways to earn on Bitcoin, side by side.</h2></div>
            <div className="ld-cmp-desk" role="table" aria-label="CoveredMarket compared with other ways to earn on Bitcoin">
              <div className="ld-table">
                <div className="rh ch" role="columnheader" />
                <div className="ch ours" role="columnheader" data-theme="vault"><img src="/site/lockup-22-on-vault.svg" alt="CoveredMarket" style={{ height: 22 }} /><span className="body-small ld-muted">Native Bitcoin, NEAR contract</span></div>
                {[["Deribit", "Options exchange"], ["Binance Dual Investment", "Exchange earn product"], ["DeFi call vaults", "Thetanuts, StakeDAO and others"]].map(([n, k]) => <div key={n} className="ch" role="columnheader"><span className="heading" style={{ fontSize: 15 }}>{n}</span><span className="body-small ld-muted">{k}</span></div>)}
                {COMPARE.map(([row, ...cells]) => [
                  <div key={row} className="rh body" role="rowheader">{row}</div>,
                  ...cells.map(([m, note], i) => <CmpCell key={row + i} m={m} note={note} ours={i === 0} end={i === cells.length - 1} />),
                ])}
              </div>
            </div>
            <ComparePhone />
            <p className="body-small ld-muted" style={{ margin: 0, maxWidth: "90ch" }}>Sources: Deribit requires ID verification for all users (<a href="https://malaysia.news.yahoo.com/crypto-options-exchange-deribit-require-174321313.html" target="_blank" rel="noreferrer">2020</a>); Binance Dual Investment pays rewards at settlement, Tuesdays and Fridays for BTC (<a href="https://www.binance.com/en/support/faq/09911be9f5754c34806bd3ab4a427e0e" target="_blank" rel="noreferrer">Binance FAQ</a>); DeFi call vaults run on wrapped BTC and pick strikes by algorithm (<a href="https://www.spark.money/tools/bitcoin-structured-product-comparison" target="_blank" rel="noreferrer">Spark</a>). Checked 6 Nov 2026. Names are trademarks of their owners.</p>
          </div>
        </section>

        <img src="/site/band.svg" alt="" aria-hidden="true" style={{ display: "block", width: "100%", height: 40, objectFit: "cover", opacity: 0.45 }} />

        {/* trust */}
        <section id="trust" className="ld-sec" style={{ borderTop: "none" }} aria-labelledby="trust-h">
          <div className="ld-wrap ld-stack" style={{ gap: 32 }}>
            <div><Kicker n="07">What you are trusting</Kicker><h2 id="trust-h" className="ld-h2" style={{ maxWidth: "16ch" }}>No custodian. Here is who can sign.</h2></div>
            <div className="ld-trust" role="table" aria-label="Who can and cannot act on your coins">
              <div className="ld-label ld-muted hd">Party</div><div className="ld-label hd" style={{ color: "var(--intaglio)" }}>Can</div><div className="ld-label hd" style={{ color: "var(--oxblood)" }}>Cannot</div>
              {[["The contract", "Sign your coins after expiry, only to the address its terms name.", "Be upgraded. It has no owner key after deployment."], ["NEAR’s MPC network", "Produce the signatures the contract asks for.", "Sign on its own. No single node holds the key."], ["The CoveredMarket team", "Run the relayer that pays gas and this site.", "Move your coins or change a contract’s terms."], ["You, the seller", "Withdraw before the call sells; claim your premium any time; reclaim the coins with your rescue key if NEAR ever stops.", "Withdraw coins during the term. They return or are sold at expiry."]].map(([w, c, n]) => [
                <div key={w} className="heading">{w}</div>,
                <div key={w + "c"} className="body"><span className="ld-label ph" style={{ color: "var(--intaglio)" }}>Can</span>{c}</div>,
                <div key={w + "n"} className="body"><span className="ld-label ph" style={{ color: "var(--oxblood)" }}>Cannot</span>{n}</div>,
              ])}
            </div>
          </div>
        </section>

        {/* faq */}
        <section id="faq" className="ld-sec" style={{ borderTop: "1px solid var(--rule)" }} aria-labelledby="faq-h">
          <div className="ld-wrap ld-2">
            <div><Kicker n="08">Questions</Kicker><h2 id="faq-h" className="ld-h2">What people ask first.</h2></div>
            <div className="ld-faq">{FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p className="body">{a}</p></details>)}</div>
          </div>
        </section>

        {/* security */}
        <section id="security" className="ld-sunk" style={{ borderTop: "1px solid var(--rule)", padding: "96px 0" }} aria-labelledby="security-h">
          <div className="ld-wrap">
            <div className="ld-notice">
              <img className="ld-bandimg" src="/site/band.svg" alt="" aria-hidden="true" style={{ top: 12 }} />
              <img className="ld-bandimg" src="/site/band.svg" alt="" aria-hidden="true" style={{ bottom: 12 }} />
              <div style={{ display: "flex", justifyContent: "space-between", gap: 24, borderBottom: "1px solid var(--rule-strong)", paddingBottom: 24 }}>
                <div className="ld-stack" style={{ gap: 16 }}>
                  <p className="ld-kicker" style={{ color: "var(--intaglio)", margin: 0 }}>Art. 09 · Security notice</p>
                  <h2 id="security-h" className="ld-h2" style={{ maxWidth: "16ch" }}>Found a flaw? Tell us before anyone else.</h2>
                  <p className="ld-lede" style={{ maxWidth: "46ch" }}>CoveredMarket keeps people’s Bitcoin behind a contract. If you find a way to move, freeze or misprice those coins, we want to hear it first, and we pay for it.</p>
                </div>
                <img className="ld-hide-phone" src="/site/seal.svg" alt="CoveredMarket seal" style={{ width: 132, height: 132, flexShrink: 0, opacity: 0.9 }} />
              </div>
              <div>
                <p className="ld-label ld-muted" style={{ margin: "0 0 8px" }}>Rewards, by what the flaw could do</p>
                <div className="ld-bounty">
                  {[["Critical", "var(--oxblood)", "up to $2,000", "A valid signature for a deposit address to anyone but the committed recipient, a spend to the buyer without the strike paid, code or keys changed after deploy, or USDC paid to someone not owed it."], ["High", "var(--copper-ink)", "up to $750", "Coins or USDC locked with no way out, the same coins sold twice, a fake deposit proof accepted, or a settlement forced before expiry and the exercise window."], ["Medium", "var(--gilt-ink)", "up to $250", "Verify showing verified for something false, the app or relayer showing a wrong deposit address, or griefing that costs others more than the attacker."]].map(([sev, col, amt, what]) => [
                    <div key={sev} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}><span className="ld-stamp" style={{ color: col, display: "inline-block", transform: "none" }}>{sev}</span><span className="ld-mono" style={{ fontSize: 13 }}>{amt}</span></div>,
                    <div key={sev + "w"} className="body">{what}</div>,
                  ])}
                </div>
                <p className="body-small ld-muted" style={{ margin: "12px 0 0" }}>Paid in USDC on NEAR or in BTC, your choice, within 14 days of the fix shipping. The first valid report of a flaw is the one rewarded. <a href={`${REPO}/blob/HEAD/SECURITY.md`} target="_blank" rel="noreferrer">Full policy</a>.</p>
              </div>
              <div className="ld-row" style={{ borderTop: "1px solid var(--rule-strong)", paddingTop: 24, gap: "16px 24px" }}>
                <a className="ld-btn ld-btn--primary" href={`mailto:${SECURITY}?subject=Vulnerability%20report`}>Report a vulnerability</a>
                <span className="ld-mono ld-muted" style={{ fontSize: 13 }}>{SECURITY}</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="ld-foot">
        <div className="ld-wrap ld-stack" style={{ gap: 32 }}>
          <div className="ld-foot-grid">
            <div className="ld-stack" style={{ gap: 12 }}><img src="/site/lockup-32.svg" alt="CoveredMarket" style={{ height: 32, alignSelf: "flex-start" }} /><p className="ld-lede" style={{ fontSize: 18 }}>Earn on Bitcoin you still hold.</p></div>
            <nav aria-label="Product"><span className="ld-label ld-muted">Product</span><a href={app("market")}>Market</a><a href={app("sell")}>Sell a call</a><A to="faq">FAQ</A></nav>
            <nav aria-label="Trust"><span className="ld-label ld-muted">Trust</span><A to="trust">Who can sign</A><A to="security">Report a vulnerability</A><A to="compare">Compared</A></nav>
            <nav aria-label="Build"><span className="ld-label ld-muted">Build</span><A to="stack">Built with</A><a href={REPO} target="_blank" rel="noreferrer">Source code</a><a href={`${REPO}/blob/HEAD/docs/SECURITY-MODEL.md`} target="_blank" rel="noreferrer">Security model</a><a href={`mailto:${SECURITY}`}>{SECURITY}</a></nav>
          </div>
          <p className="body-small ld-muted" style={{ margin: 0, borderTop: "1px solid var(--rule)", paddingTop: 16 }}>CoveredMarket is unaudited software and runs on test coins only. Built on NEAR.</p>
        </div>
      </footer>
    </div>
  );
}
