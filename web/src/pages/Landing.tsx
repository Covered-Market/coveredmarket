/**
 * The public landing page. On the website (CFG.mode "site", covered.market) it carries no network band, switch
 * or contract ids, and every app link leaves for the testnet app (CFG.testnetUrl). On the local stack it is `/` of
 * the local app. The ticker and the market section (LiveMarket) read the configured contract.
 * The page shows no captures of the app, so it cannot fall out of step with it. The hero shows the film (HeroFilm).
 */
import { useEffect, useState, type ReactNode } from "react";
import { CFG } from "../lib/near";
import { useSpot } from "./hooks";
import { Waitlist } from "./Waitlist";
import { PriceAndStrikes, SoldCalls, Ticker, useMarket } from "./LiveMarket";
import "../landing.css";
import { Lathe, Rosette, Seam } from "../patterns"; // patterns-v1

const SECURITY = "security@covered.market";
const REPO = "https://github.com/Covered-Market/coveredmarket";
/** CoveredMarket on X. */
const X_URL = "https://x.com/covered_market";
/** The CoveredMarket Discord server (invite link). */
const DISCORD_URL = "https://discord.gg/ruAg7vQrz";
/** Footer icons: the X, Discord and GitHub marks, drawn in the footer's ink. */
const SOCIAL: [string, string, string][] = [
  ["X", X_URL, "M17.75 3h3.07l-6.71 7.67L22 21h-6.18l-4.84-6.33L5.44 21H2.37l7.18-8.2L2 3h6.33l4.38 5.79L17.75 3zm-1.08 16.17h1.7L7.4 4.73H5.58l11.09 14.44z"],
  ["Discord", DISCORD_URL, "M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.028C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.1.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.029zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"],
  ["GitHub", REPO, "M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"],
];
/** The social icons, in the header and again in the footer. */
function Social({ className }: { className: string }) {
  return <div className={className}>{SOCIAL.map(([name, href, d]) => <a key={name} href={href} target="_blank" rel="noreferrer" aria-label={`CoveredMarket on ${name}`} title={name}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} fill="currentColor" /></svg></a>)}</div>;
}
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
  const play = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l12-7z" fill="currentColor" /></svg>;
  if (playing && url) return (
    <div className="ld-film">
      <iframe src={`${url}${url.includes("?") ? "&" : "?"}autoplay=1&rel=0`} title="CoveredMarket: from offer to settlement" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
    </div>
  );
  return (
    <div className="ld-film">
      <img src="/site/film/poster.svg" alt="From offer to settlement: one covered call on native Bitcoin" />
      {url ? <button type="button" className="ld-play" onClick={() => setPlaying(true)} aria-label="Play the film">{play}</button> : <span className="ld-play" aria-hidden="true">{play}</span>}
    </div>
  );
}

const Kicker = ({ n, children }: { n?: string; children: ReactNode }) => <p className="ld-kicker">{n ? `Art. ${n} · ` : ""}{children}</p>;
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
  ["oracle", "No oracle", "No price feed decides how your call ends, so nobody can feed in a bad price to settle it. The buyer either pays the strike in the window after expiry, or the contract returns your coins when it closes."],
];

const built = (): { status: "Live" | "Partly" | "Next"; name: string; what: string; id: string; d: string }[] => [
  { status: "Live", name: "Chain Signatures", what: "NEAR’s MPC network gives the contract its own Bitcoin key for every offer, derived from the contract, your account and the offer’s serial, and signs only the transaction the contract has committed to.", id: "NEAR MPC · derived keys", d: "M12 3a2 2 0 1 0 0.01 0 M5 17a2 2 0 1 0 0.01 0 M19 17a2 2 0 1 0 0.01 0 M11 6.5l-5 8.5 M13 6.5l5 8.5 M7 19h10" },
  { status: "Live", name: "Bitcoin light client", what: "A NEAR contract that tracks Bitcoin’s block headers. CoveredMarket accepts a deposit, or treats a settlement as done, only with a Merkle proof checked against it, so the contract never takes anyone’s word about Bitcoin.", id: "btc-light-client · Merkle proofs", d: "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 17l2 2 4-4 M10 7h4 M7 10v4" },
  { status: "Live", name: "A contract nobody controls", what: "NEAR accounts are governed by access keys. CoveredMarket’s contract has none after deployment, so it cannot be upgraded or drained, and Verify checks that from your browser.", id: "0 access keys · no upgrades", d: "M7 11V8a5 5 0 0 1 10 0v3 M5 11h14v10H5z M12 15v2" },
  { status: "Live", name: "Pay and act in one receipt", what: "The buyer’s USDC arrives with its instruction through NEP-141 ft_transfer_call. The premium is credited and the buyer recorded in the same receipt, with no pending state between.", id: "NEP-141 · ft_transfer_call", d: "M4 12h6 M14 12h6 M10 8l4 4-4 4 M4 6v12 M20 6v12" },
  { status: "Live", name: "Meta-transactions", what: "NEAR delegate actions let you sign while a relayer submits the transaction and pays its gas, in wallets that support them. The relayer can never act alone.", id: "NEP-366 delegate actions", d: "M4 12h13 M13 7l5 5-5 5 M4 6v12" },
];
const STATUS_COLOR = { Live: "var(--intaglio)", Partly: "var(--gilt-ink)", Next: "var(--ink-muted)" };

/** Agent friendly: the ways software uses CoveredMarket (agent/README.md). Testnet and the local stack only. */
const AGENT_WAYS = [
  { name: "MCP server", what: "Tools to sell, buy, exercise and claim for Claude, Cursor or any MCP client. Its wallet is made and funded on first use.", code: "claude mcp add coveredmarket -- bin/coveredmarket mcp", d: "M9 2v5 M15 2v5 M6 7h12v4a6 6 0 0 1-12 0z M12 17v5" },
  { name: "Command line", what: "Every move as one command, with JSON out. For scripts, scheduled jobs and quick tests.", code: "bin/coveredmarket agent offers --status for_sale", d: "M3 5h18v14H3z M7 10l3 2-3 2 M12 15h5" },
  { name: "Read API", what: "Offers, rules and accounts over plain HTTP, in BTC and USD and in exact units. No key needed.", code: "GET /api/offers?status=for_sale", d: "M8 4c-2 0-3 1-3 3v3l-2 2 2 2v3c0 2 1 3 3 3 M16 4c2 0 3 1 3 3v3l2 2-2 2v3c0 2-1 3-3 3" },
  { name: "llms.txt", what: "One page that tells a model what CoveredMarket is, how a contract runs and where to start.", code: "covered.market/llms.txt", d: "M6 3h9l3 3v15H6z M9 10h6 M9 14h6 M9 18h4" },
];
const AGENT_POINTS = [
  ["Every offer says what happens next", "Who moves, from when, and the exact call to make. Steps the relayer takes by itself are marked as such."],
  ["Keys stay with the agent", "They are kept in files on its own machine. The seller's rescue kit is saved before the offer exists."],
  ["No gas, no sign-up", "The relayer pays gas. On testnet a new wallet gets test NEAR and USDC automatically."],
];
/** What an agent reads: an offer from the read API, shortened. */
const AGENT_SAMPLE = `{
  "id": "CV-7",
  "state": "Funded",
  "summary": "Deposited and for sale.",
  "size":    { "btc": 0.001 },
  "strike":  { "usd_per_btc": 150000 },
  "premium": { "usd": 5 },
  "expiry":  { "utc": "2026-11-12T08:00:00Z" },
  "next_actions": [
    { "action": "buy", "who": "buyer",
      "call": { "method": "ft_transfer_call" } },
    { "action": "withdraw", "who": "seller" }
  ]
}`;
/** The sample with its keys in the accent ink. */
function JsonSample({ text }: { text: string }) {
  return <pre className="ld-code" tabIndex={0} aria-label="An offer as the read API returns it">{text.split(/("[a-z_]+")(?=:)/g).map((part, i) => (i % 2 ? <span key={i} className="k">{part}</span> : part))}</pre>;
}

const FAQ = [
  ["What is a covered call?", "You sell someone the right to buy your coins at a price you set, on a date you set. They pay you for that right now. You keep the payment whatever happens."],
  ["Where are my coins during the contract?", "On Bitcoin, at an address derived for your contract alone. You can look it up on any explorer. Only the contract can ask for a signature for it."],
  ["Can I get my coins back early?", "Before a buyer takes the call, yes: withdraw the offer. Once it has sold, the coins stay until expiry."],
  ["What if Bitcoin goes far above the strike?", "Your coins are sold at the strike. You keep the premium but not the rise above the strike."],
  ["Do I need NEAR?", "A little. Creating an offer attaches 0.1 NEAR for storage, and most of it comes back. If your wallet supports gasless signing, a relayer pays the gas; otherwise you pay it. On testnet, connecting a wallet sends you test NEAR."],
  ["What if NEAR stops working?", "Your coins are not stuck. Their address also accepts a rescue key that only you hold, saved in the rescue kit you download when you sell. After a fixed delay past expiry, it moves the coins back to you with Bitcoin alone."],
  ["What does CoveredMarket charge?", "Nothing. It runs on test coins only."],
  ["Can an AI agent use CoveredMarket?", "Yes. On testnet there is an MCP server, a command line and a read API, and an agent gets its own funded test wallet the first time it acts. Browser agents can add ?testwallet=seller to the app’s address instead of connecting a wallet."],
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
  const market = useMarket(), spot = useSpot();
  useEffect(() => { document.title = "CoveredMarket — earn on Bitcoin you still hold"; const id = location.hash.slice(1); if (id && !id.startsWith("/")) setTimeout(() => document.getElementById(id)?.scrollIntoView(), 50); }, []);
  return (
    <div className="ld">
      <img className="ld-seal" src="/site/rosette.svg" alt="" aria-hidden="true" />
      <header className="ld-head">
        <div className="ld-wrap">
          <a href="/" aria-label="CoveredMarket home" className="ld-logo-link"><img className="ld-logo" src="/site/lockup-32.svg" alt="CoveredMarket" /></a>
          <div className="ld-head-right">
            <Social className="ld-social ld-social--head" />
            <a className="ld-btn ld-btn--primary" style={{ minHeight: 44, padding: "10px 16px", fontSize: 15 }} href={app("market")}>Open the app</a>
          </div>
        </div>
      </header>

      <main>
        {/* hero */}
        <section className="ld-hero" aria-labelledby="hero-h">
          <div className="ld-wrap ld-hero-grid">
            <div className="ld-stack" style={{ minWidth: 0 }}>
              <h1 id="hero-h" className="ld-h1"><span>Earn on Bitcoin</span><span style={{ color: "var(--intaglio)" }}>you still hold.</span></h1>
              <p className="ld-hero-lede">Get paid up front on Bitcoin you plan to hold. No exchange or custodian ever holds your coins, and the payment is yours whatever happens.</p>
            </div>
            <img className="ld-hero-seal" src="/site/seal.svg" alt="" aria-hidden="true" />
          </div>
        </section>

        <Ticker offers={market.offers} href={app} />

        {/* the film, on its own row */}
        <section id="film" className="ld-film-row" aria-label="The film">
          <div className="ld-wrap"><figure className="ld-hero-film"><HeroFilm /></figure></div>
        </section>

        {/* benefits */}
        <section id="why" className="ld-sec ld-vault pt-host" data-theme="vault" aria-labelledby="why-h">
          <Rosette className="pt-gilt" sw={1} />{/* patterns-v1 */}
          <div className="ld-wrap ld-stack" style={{ gap: 40 }}>
            <div><Kicker n="01">Why CoveredMarket</Kicker><h2 id="why-h" className="ld-h2">Everything an exchange offers, except the exchange.</h2></div>
            <div className="ld-4 ld-5">
              {BENEFITS.map(([icon, t, x]) => (
                <div className="ld-benefit" key={t}><span className="ld-disc"><span className="ld-glyph" aria-hidden="true" style={{ ["--glyph" as string]: `url(/site/icons/${icon}.svg)` }} /></span><h3 className="heading" style={{ margin: 0 }}>{t}</h3><p className="body-small ld-muted" style={{ margin: 0 }}>{x}</p></div>
              ))}
            </div>
          </div>
        </section>

        {/* story */}
        <section className="ld-sec pt-seamed" style={{ borderTop: "1px solid var(--rule)" }} aria-labelledby="story-h">
          <Seam n="02" />{/* patterns-v1 */}
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
        <section id="returns" className="ld-sec ld-vault pt-seamed" data-theme="vault" aria-labelledby="returns-h">
          <Seam n="03" />{/* patterns-v1 */}
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

        {/* the market, live */}
        <section id="market" className="ld-sec pt-seamed" aria-labelledby="market-h">
          <Seam n="04" />{/* patterns-v1 */}
          <div className="ld-wrap ld-stack" style={{ gap: 40 }}>
            <div><Kicker n="04">The market</Kicker><h2 id="market-h" className="ld-h2">Where sellers are setting their strikes.</h2></div>
            {market.history && spot && market.offers && <PriceAndStrikes history={market.history} spot={spot.price} offers={market.offers} />}
            {market.offers ? <SoldCalls offers={market.offers} href={app} />
              : <p className="body ld-muted" style={{ margin: 0 }}>{market.failed ? "The market could not be read just now." : "Reading the market…"}</p>}
            <div><a className="ld-btn ld-btn--quiet" href={app("market")}>See every call for sale</a></div>
          </div>
        </section>

        {/* built with */}
        <section id="stack" className="ld-sec ld-raised" style={{ borderTop: "1px solid var(--rule)", position: "relative", overflow: "visible" }} aria-labelledby="stack-h">
          <Seam n="05" />{/* patterns-v1: overflow was "hidden"; visible lets the seal sit on the seam */}
          <div className="ld-wrap ld-stack" style={{ gap: 32, position: "relative" }}>
            <div><Kicker n="05">Built with</Kicker><h2 id="stack-h" className="ld-h2" style={{ maxWidth: "16ch" }}>Built on NEAR. Settled on Bitcoin.</h2></div>
            <div className="ld-3 ld-built ld-built--5">
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
          </div>
        </section>

        {/* compare */}
        <section id="compare" className="ld-sec pt-seamed" aria-labelledby="compare-h">
          <Seam n="06" />{/* patterns-v1 */}
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

        {/* trust */}
        <section id="trust" className="ld-sec pt-seamed" aria-labelledby="trust-h">
          <Seam n="07" />{/* patterns-v1 */}
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

        {/* agent friendly */}
        <section id="agents" className="ld-sec ld-vault pt-seamed" data-theme="vault" aria-labelledby="agents-h">
          <Seam n="08" />{/* patterns-v1 */}
          <div className="ld-wrap ld-stack" style={{ gap: 48 }}>
            <div className="ld-2">
              <div className="ld-stack" style={{ gap: 24 }}>
                <div><Kicker n="08">Agent friendly</Kicker><h2 id="agents-h" className="ld-h2">Built for agents as well as people.</h2></div>
                <p className="ld-lede" style={{ maxWidth: "44ch" }}>Anything you can do here, an AI agent or a script can do too: read the market, sell a call, buy one, exercise it and claim. On testnet it gets its own funded wallet the first time it acts.</p>
                <ul className="ld-agent-points">
                  {AGENT_POINTS.map(([t, d]) => <li key={t}><span className="heading">{t}</span><span className="body ld-muted">{d}</span></li>)}
                </ul>
                <div className="ld-row">
                  <a className="ld-btn ld-btn--primary" href={`${REPO}/blob/HEAD/agent/README.md`} target="_blank" rel="noreferrer">Read the agent guide</a>
                  <a className="ld-btn ld-btn--quiet" href="/llms.txt">Open llms.txt</a>
                </div>
              </div>
              <div className="ld-frame" data-theme="paper">
                <div className="ld-frame-bar"><i /><i /><span>GET /api/offers/CV-7</span></div>
                <JsonSample text={AGENT_SAMPLE} />
              </div>
            </div>
            <div className="ld-3 ld-built">
              {AGENT_WAYS.map((w) => (
                <article className="ld-tech" key={w.name}>
                  <span className="ld-disc" style={{ width: 48, height: 48 }}><Icon d={w.d} /></span>
                  <h3 className="heading" style={{ margin: 0 }}>{w.name}</h3>
                  <p className="body-small ld-muted" style={{ margin: 0 }}>{w.what}</p>
                  <div className="ld-tech-id">{w.code}</div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* faq: the section clips its rosette, so its seal sits in a zero-height holder above it */}
        <div className="pt-seamed" aria-hidden="true"><Seam n="09" /></div>{/* patterns-v1 */}
        <section id="faq" className="ld-sec pt-host" style={{ borderTop: "1px solid var(--rule)" }} aria-labelledby="faq-h">
          <Rosette className="pt-echo" />{/* patterns-v1 */}
          <div className="ld-wrap ld-2">
            <div><Kicker n="09">Questions</Kicker><h2 id="faq-h" className="ld-h2">Frequently Asked Questions</h2></div>
            <div className="ld-faq">{FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p className="body">{a}</p></details>)}</div>
          </div>
        </section>

        {/* security: clips its lathe waves, so its seal sits above it too */}
        <div className="pt-seamed" aria-hidden="true"><Seam n="10" /></div>{/* patterns-v1 */}
        <section id="security" className="ld-sunk pt-host" style={{ borderTop: "1px solid var(--rule)", padding: "96px 0" }} aria-labelledby="security-h">
          <Lathe />{/* patterns-v1 */}
          <div className="ld-wrap">
            <div className="ld-notice">
              <img className="ld-bandimg" src="/site/band.svg" alt="" aria-hidden="true" style={{ top: 12 }} />
              <img className="ld-bandimg" src="/site/band.svg" alt="" aria-hidden="true" style={{ bottom: 12 }} />
              <div style={{ display: "flex", justifyContent: "space-between", gap: 24, borderBottom: "1px solid var(--rule-strong)", paddingBottom: 24 }}>
                <div className="ld-stack" style={{ gap: 16 }}>
                  <p className="ld-kicker" style={{ color: "var(--intaglio)", margin: 0 }}>Art. 10 · Security notice</p>
                  <h2 id="security-h" className="ld-h2" style={{ maxWidth: "16ch" }}>Found a flaw? Tell us before anyone else.</h2>
                  <p className="ld-lede" style={{ maxWidth: "46ch" }}>CoveredMarket keeps people’s Bitcoin behind a contract. If you find a way to move, freeze or misprice those coins, we want to hear it first.</p>
                  <p className="body" style={{ margin: 0, maxWidth: "52ch" }}><span className="ld-stamp" style={{ color: "var(--oxblood)", display: "inline-block", transform: "none", marginRight: 10 }}>Not yet live</span>Our bug bounty opens after our upcoming audits, and not before January 2027.</p>
                </div>
                <img className="ld-hide-phone" src="/site/seal.svg" alt="CoveredMarket seal" style={{ width: 132, height: 132, flexShrink: 0, opacity: 0.9 }} />
              </div>
              <div>
                <p className="ld-label ld-muted" style={{ margin: "0 0 8px" }}>Planned rewards once the bounty opens, by what the flaw could do</p>
                <div className="ld-bounty">
                  {[["Critical", "var(--oxblood)", "up to $2,000", "A valid signature for a deposit address to anyone but the committed recipient, a spend to the buyer without the strike paid, code or keys changed after deploy, or USDC paid to someone not owed it."], ["High", "var(--copper-ink)", "up to $750", "Coins or USDC locked with no way out, the same coins sold twice, a fake deposit proof accepted, or a settlement forced before expiry and the exercise window."], ["Medium", "var(--gilt-ink)", "up to $250", "Verify showing verified for something false, the app or relayer showing a wrong deposit address, or griefing that costs others more than the attacker."]].map(([sev, col, amt, what]) => [
                    <div key={sev} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}><span className="ld-stamp" style={{ color: col, display: "inline-block", transform: "none" }}>{sev}</span><span className="ld-mono" style={{ fontSize: 13 }}>{amt}</span></div>,
                    <div key={sev + "w"} className="body">{what}</div>,
                  ])}
                </div>
              </div>
              <div className="ld-row" style={{ borderTop: "1px solid var(--rule-strong)", paddingTop: 24, gap: "16px 24px" }}>
                <a className="ld-btn ld-btn--primary" href={`mailto:${SECURITY}?subject=Vulnerability%20report`}>Report a vulnerability</a>
                <span className="ld-mono ld-muted" style={{ fontSize: 13 }}>{SECURITY}</span>
                <a className="body-small" href={`${REPO}/blob/HEAD/SECURITY.md`} target="_blank" rel="noreferrer">Full policy</a>
              </div>
            </div>
          </div>
        </section>

        {/* mainnet waitlist */}
        <section id="waitlist" className="ld-sec pt-seamed" style={{ borderTop: "1px solid var(--rule)" }} aria-labelledby="waitlist-h">
          <Seam n="11" />{/* patterns-v1 */}
          <div className="ld-wrap ld-2">
            <div className="ld-stack" style={{ gap: 16 }}>
              <div><Kicker n="11">Mainnet</Kicker><h2 id="waitlist-h" className="ld-h2">Hear when real bitcoin can earn.</h2></div>
              <p className="ld-lede" style={{ maxWidth: "46ch" }}>CoveredMarket runs on test coins only for now. Leave your email and we will write once, when mainnet opens.</p>
              <p className="body-small ld-muted" style={{ margin: 0 }}>Until then, follow along in <a href="#/updates">Updates</a>.</p>
            </div>
            <Waitlist source="landing" />
          </div>
        </section>
      </main>

      <footer className="ld-foot">
        <div className="ld-wrap ld-stack" style={{ gap: 32 }}>
          <div className="ld-foot-grid">
            <div className="ld-stack" style={{ gap: 12 }}><img src="/site/lockup-32.svg" alt="CoveredMarket" style={{ height: 32, alignSelf: "flex-start" }} /><p className="ld-lede" style={{ fontSize: 18 }}>Earn on Bitcoin you still hold.</p></div>
            <nav aria-label="Product"><span className="ld-label ld-muted">Product</span><a href={app("market")}>Market</a><a href={app("sell")}>Sell a call</a><A to="faq">FAQ</A><A to="waitlist">Mainnet waitlist</A><a href="#/updates">Updates</a></nav>
            <nav aria-label="Trust"><span className="ld-label ld-muted">Trust</span><A to="trust">Who can sign</A><A to="security">Report a vulnerability</A><A to="compare">Compared</A></nav>
            <nav aria-label="Build"><span className="ld-label ld-muted">Build</span><A to="stack">Built with</A><A to="agents">For agents</A><a href={REPO} target="_blank" rel="noreferrer">Source code</a><a href={`${REPO}/blob/HEAD/docs/SECURITY-MODEL.md`} target="_blank" rel="noreferrer">Security model</a><a href={`mailto:${SECURITY}`}>{SECURITY}</a></nav>
          </div>
          <div className="ld-foot-base">
            <p className="body-small ld-muted" style={{ margin: 0 }}>CoveredMarket is unaudited software and runs on test coins only. Built on NEAR. <span className="lg-links" style={{ display: "inline-flex", marginLeft: 12 }}><a href="#/terms">Terms</a><a href="#/privacy">Privacy</a></span></p>
            <Social className="ld-social" />
          </div>
        </div>
      </footer>
    </div>
  );
}
