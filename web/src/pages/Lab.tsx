/**
 * Ideas for showing the live market on the website, side by side, to choose from (`npm run dev`, then open `/#/ideas`).
 * Loaded only by the dev server: production builds never include this file. "Live" reads the contracts on the
 * configured network; "Sample" is a made-up, busier market, to see each idea with more to show.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { describe, newestSerial } from "../lib/activity";
import { buildBoard, cellBtc, cellKey, spotRow, toAsk } from "../lib/board";
import { CFG, view } from "../lib/near";
import type { Offer } from "../lib/verify";
import { SerialRosette } from "../patterns";
import { useSpot } from "./hooks";
import "../landing.css";

type O = Offer & { signed_at_s?: string | null };

const usd0 = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const usd = (n: number) => (n >= 1000 ? usd0(n) : "$" + n.toFixed(2));
const btc = (n: number) => (n >= 10 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n >= 0.01 ? n.toFixed(3) : n.toFixed(5));
const pct = (n: number, d = 2) => n.toFixed(d) + "%";
const span = (s: number) => (s >= 172800 ? `${Math.round(s / 86400)} days` : s >= 5400 ? `${Math.round(s / 3600)} hours` : `${Math.max(1, Math.round(s / 60))} min`);
const dayUtc = (s: number) => new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : 0; };
const sizeOf = (o: O) => Number(o.size_sats) / 1e8, strikeOf = (o: O) => Number(o.strike_units) / 1e6, premOf = (o: O) => Number(o.premium_units) / 1e6;
/** The premium as a share of what the coins fetch at the strike: exact from the contract alone. */
const yieldOf = (o: O) => { const v = sizeOf(o) * strikeOf(o); return v > 0 ? (premOf(o) / v) * 100 : 0; };
const lastOf = (o: O) => Math.max(Number(o.created_s ?? 0), Number(o.committed_at_s ?? 0), Number(o.signed_at_s ?? 0));
const AT_REST = ["Funded", "Sold", "ExercisePending", "Committed", "Signed"];

/** Every contract on the configured network, refreshed every minute. */
function useLive() {
  const [offers, setOffers] = useState<O[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const top = await newestSerial(async (s) => (await view<O | null>("get_offer", { serial: s })) !== null);
        // Eight at a time: a public RPC node turns away a burst of dozens.
        const got: (O | null)[] = [];
        for (let i = 1; i <= top; i += 8) got.push(...await Promise.all(Array.from({ length: Math.min(8, top - i + 1) }, (_, k) => view<O | null>("get_offer", { serial: i + k }).catch(() => null))));
        if (alive) { setOffers(got.filter((o): o is O => !!o)); setFailed(false); }
      } catch { if (alive) setFailed(true); }
    };
    load(); const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return { offers, failed };
}

/** A week of hourly Bitcoin prices from a public market feed; a made-up walk if it cannot be read. */
function useHistory(spot: number): { points: [number, number][]; real: boolean } {
  const [h, setH] = useState<[number, number][] | null>(null);
  useEffect(() => {
    fetch("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=168").then((r) => r.json())
      .then((k: [number, string, string, string, string][]) => setH(k.map((c) => [c[0] / 1000, Number(c[4])]))).catch(() => setH([]));
  }, []);
  return useMemo(() => {
    if (h && h.length > 10) return { points: h, real: true };
    let seed = 5, p = spot; const now = Date.now() / 1000, out: [number, number][] = [];
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 168; i++) { out.unshift([now - i * 3600, p]); p *= 1 + (rnd() - 0.5) * 0.012; }
    return { points: out, real: false };
  }, [h, spot]);
}

/** A made-up month of a busier market: about 160 contracts between 0.02 and 1.5 BTC, in every state. */
function sampleMarket(spot: number, nowS: number): O[] {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const names = ["astrid", "marcus", "ola", "tomas", "ingrid", "kenji", "leila", "pavel", "sofia", "dmitri", "amara", "jonas"];
  const out: O[] = [];
  for (let i = 1; i <= 160; i++) {
    const created = Math.floor(nowS - (160 - i) * 16200 - rnd() * 7200);
    const days = [1, 3, 7, 14, 30][Math.floor(rnd() * 5)], above = 0.01 + rnd() * rnd() * 0.22;
    const strike = Math.round((spot * (1 + above)) / 250) * 250, sats = Math.round((2e6 + rnd() * rnd() * 1.5e8) / 1e5) * 1e5;
    const perBtc = spot * 0.2 * Math.sqrt(days / 365) * Math.exp(-above / (0.55 * Math.sqrt(days / 365) + 0.02)) * (0.85 + rnd() * 0.4) + spot * 0.0006;
    const expiry = (Math.floor(created / 86400) + days) * 86400 + 28800, r = rnd(), seller = names[Math.floor(rnd() * names.length)], other = names[Math.floor(rnd() * names.length)];
    const state = expiry < nowS ? (r < 0.62 ? "Kept" : r < 0.84 ? "Exercised" : "Withdrawn") : r < 0.58 ? "Sold" : "Funded";
    const sold = state !== "Funded" && state !== "Withdrawn";
    out.push({
      serial: i, seller: `${seller}.testnet`, buyer: sold ? `${other === seller ? "nadia" : other}.testnet` : null, size_sats: String(sats), strike_units: String(strike * 1e6),
      strike_total_units: String(Math.ceil((sats * strike) / 100)), premium_units: String(Math.round((perBtc * sats) / 100)), expiry_s: String(expiry), created_s: String(created),
      committed_at_s: expiry < nowS ? String(expiry + 900) : null, commitment_reason: state === "Exercised" ? "Exercise" : expiry < nowS ? "Expire" : null,
      address: `tb1q${(i * 2654435761 >>> 0).toString(36)}sample${(i * 40503).toString(36)}xq7`, collateral_txid: `${(i * 2654435761 >>> 0).toString(16)}`.padEnd(64, "0"), collateral_value_sats: String(sats), state,
    } as unknown as O);
  }
  return out;
}

function Idea({ n, group, title, where, bleed, children }: { n: string; group: string; title: string; where: string; bleed?: boolean; children: ReactNode }) {
  return (
    <section className="ld-sec" style={{ padding: "56px 0" }}>
      <div className="ld-wrap ld-stack" style={{ gap: 20 }}>
        <div>
          <p className="ld-kicker" style={{ marginBottom: 8 }}>Idea {n} · {group}</p>
          <h2 className="ld-h2" style={{ fontSize: 32, maxWidth: "none" }}>{title}</h2>
          <p className="body-small ld-muted" style={{ margin: "8px 0 0" }}>Where it would go: {where}</p>
        </div>
        {!bleed && children}
      </div>
      {bleed && <div style={{ marginTop: 20 }}>{children}</div>}
    </section>
  );
}
const Tag = () => <span className="ld-label ld-muted" style={{ fontSize: 11 }}>Testnet · test coins</span>;
const Empty = ({ children }: { children: ReactNode }) => <p className="body-small ld-muted" style={{ margin: 0, padding: "24px 0", borderTop: "1px solid var(--rule)", borderBottom: "1px solid var(--rule)" }}>{children}</p>;
const STAMP = { open: "var(--intaglio)", kept: "var(--intaglio)", exercised: "var(--copper-ink)", settled: "var(--ink-muted)", pending: "var(--gilt-ink)", refused: "var(--oxblood)" };

export default function Lab() {
  const live = useLive(), spotLive = useSpot();
  const [mode, setMode] = useState<"live" | "sample">("live");
  const now = Date.now() / 1000;
  const history = useHistory(spotLive?.price ?? 73600);
  const spot = spotLive?.price ?? history.points[history.points.length - 1][1];
  const sample = useMemo(() => sampleMarket(Math.round(spot), Math.floor(Date.now() / 1000 / 60) * 60), [Math.round(spot / 500)]);
  const offers = mode === "sample" || !live.offers ? (mode === "sample" ? sample : []) : live.offers;

  const feed = useMemo(() => [...offers].sort((a, b) => lastOf(b) - lastOf(a) || b.serial - a.serial).slice(0, 14).map((o) => describe(o, now)), [offers]);
  const open = offers.filter((o) => o.state === "Funded" && Number(o.expiry_s) > now);
  const soldOnes = offers.filter((o) => o.buyer).sort((a, b) => b.serial - a.serial);
  const resting = offers.filter((o) => AT_REST.includes(o.state)).sort((a, b) => sizeOf(b) - sizeOf(a));
  const restBtc = resting.reduce((s, o) => s + sizeOf(o), 0);
  const kept = offers.filter((o) => o.state === "Kept").length, exercised = offers.filter((o) => o.state === "Exercised").length, unsold = offers.filter((o) => o.state === "Withdrawn").length;
  const proven = offers.filter((o) => o.collateral_txid);
  const board = useMemo(() => buildBoard(open.map(toAsk), 6, 5), [offers]);
  const line = spotRow(board.bands, board.step, spot);
  const points = offers.filter((o) => sizeOf(o) > 0 && strikeOf(o) > 0 && (o.buyer || (o.state === "Funded" && Number(o.expiry_s) > now)))
    .map((o) => ({ x: (strikeOf(o) / spot - 1) * 100, y: yieldOf(o), sold: !!o.buyer, serial: o.serial }));

  return (
    <div className="ld" style={{ minHeight: "100vh" }}>
      <style>{`
        .lab-tick { border-top: 1px solid var(--rule-strong); border-bottom: 1px solid var(--rule-strong); background: var(--paper-raised); overflow: hidden; }
        .lab-track { display: flex; width: max-content; animation: lab-run 70s linear infinite; }
        .lab-tick:hover .lab-track { animation-play-state: paused; }
        .lab-item { display: inline-flex; align-items: baseline; gap: 10px; padding: 14px 28px; border-right: 1px solid var(--rule); white-space: nowrap; color: var(--ink) !important; text-decoration: none; font-size: 14px; }
        @keyframes lab-run { to { transform: translateX(-50%); } }
        @media (prefers-reduced-motion: reduce) { .lab-track { animation: none; } .lab-tick { overflow-x: auto; } }
        .lab-word { font: 700 11px/16px var(--font-sans); letter-spacing: .14em; text-transform: uppercase; }
        .lab-seg { display: inline-flex; border: 1px solid var(--rule-strong); }
        .lab-seg button { font: 600 14px/1 var(--font-sans); padding: 10px 16px; border: 0; background: transparent; color: var(--ink); cursor: pointer; }
        .lab-seg button[aria-pressed="true"] { background: var(--intaglio); color: var(--on-intaglio); }
        .lab-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .lab-stats > div { padding: 28px 24px; border-left: 1px solid var(--rule); }
        .lab-stats > div:first-child { border-left: 0; padding-left: 0; }
        .lab-big { font: 500 40px/1 var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
        .lab-note { background: var(--paper-raised); border: 1px solid var(--rule-strong); box-shadow: inset 0 0 0 5px var(--paper-raised), inset 0 0 0 6px var(--rule); padding: 26px; display: flex; flex-direction: column; gap: 16px; color: var(--ink) !important; text-decoration: none; }
        .lab-kv { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; font-size: 14px; }
        .lab-kv b { justify-self: end; font: 500 14px/20px var(--font-mono); }
        .lab-table { width: 100%; border-collapse: collapse; font-size: 14px; }
        .lab-table th { text-align: left; font: 600 11px/16px var(--font-sans); letter-spacing: .12em; text-transform: uppercase; color: var(--ink-muted); padding: 10px 12px 10px 0; border-bottom: 1px solid var(--rule-strong); }
        .lab-table td { padding: 12px 12px 12px 0; border-bottom: 1px solid var(--rule); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
        .lab-table .r { text-align: right; padding-right: 0; }
        .lab-board { display: grid; gap: 4px; font-size: 13px; }
        .lab-cell { min-height: 52px; padding: 8px 10px; border: 1px solid var(--rule); display: flex; flex-direction: column; justify-content: center; gap: 2px; font-family: var(--font-mono); }
        .lab-dots { display: flex; flex-wrap: wrap; gap: 6px; }
        .lab-dots i { width: 16px; height: 16px; border-radius: 50%; background: var(--intaglio); display: block; position: relative; }
        .lab-dots i::after { content: ""; position: absolute; left: 4.5px; top: 4px; width: 6px; height: 3.5px; border-left: 1.6px solid var(--on-intaglio); border-bottom: 1.6px solid var(--on-intaglio); transform: rotate(-45deg); }
        .lab-chart text { font: 500 11px var(--font-mono); fill: var(--ink-muted); }
        @media (max-width: 760px) { .lab-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } .lab-stats > div:nth-child(3) { border-left: 0; padding-left: 0; } .lab-big { font-size: 28px; } .lab-3 { grid-template-columns: minmax(0, 1fr) !important; } }
      `}</style>

      <header className="ld-head" style={{ position: "static" }}>
        <div className="ld-wrap" style={{ flexWrap: "wrap", padding: "16px 64px" }}>
          <img className="ld-logo" src="/site/lockup-32.svg" alt="CoveredMarket" />
          <span className="ld-label ld-muted">Live market ideas · preview only</span>
          <span style={{ marginLeft: "auto" }} className="lab-seg" role="group" aria-label="Which data to show">
            <button type="button" aria-pressed={mode === "live"} onClick={() => setMode("live")}>Live testnet</button>
            <button type="button" aria-pressed={mode === "sample"} onClick={() => setMode("sample")}>Sample market</button>
          </span>
        </div>
      </header>
      <div className="ld-wrap" style={{ padding: "20px 64px 0" }}>
        <p className="body-small ld-muted" style={{ margin: 0 }}>
          {mode === "sample" ? "Sample market: about 160 made-up contracts over a month, to see each idea with more to show. None of them exist on any chain."
            : live.failed ? "The live contracts could not be read from this server. Switch to Sample market, or open this page on the server that talks to testnet."
            : !live.offers ? "Reading the contracts from testnet…"
            : `Live testnet: ${live.offers.length} contracts on ${CFG.contract}, refreshed every minute. Bitcoin at ${usd0(spot)}.`}
        </p>
      </div>

      <Idea n="01" group="Proof the market is alive" title="A live ticker of the latest contracts" where="a thin strip under the hero, above the film" bleed>
        {feed.length ? (
          <div className="lab-tick" aria-label="Latest contracts">
            <div className="lab-track">
              {[0, 1].map((k) => feed.map((r) => (
                <a key={k + "-" + r.serial} className="lab-item" href={`#/c/${r.serial}`} aria-hidden={k === 1}>
                  <b className="ld-mono">CV-{r.serial}</b><span className="lab-word" style={{ color: STAMP[r.stamp] }}>{r.word}</span>
                  <span className="ld-mono">{btc(r.sizeBtc)} BTC at {usd0(r.strikeUsd)}</span><span className="ld-muted">premium <span className="ld-mono" style={{ color: "var(--gilt-ink)" }}>{usd(r.premiumUsd)}</span></span>
                  {r.when && <span className="ld-muted">{r.when}</span>}
                </a>
              )))}
            </div>
          </div>
        ) : <div className="ld-wrap"><Empty>No contracts to show yet.</Empty></div>}
      </Idea>

      <Idea n="02" group="Proof the market is alive" title="Four headline figures" where="right under the hero, or as a band between Why and The idea">
        <div data-theme="vault" className="ld-vault" style={{ padding: "8px 32px" }}>
          <div className="lab-stats">
            {([["Bitcoin in live contracts", btc(restBtc), "BTC", "var(--ink)"], ["Premiums paid to sellers", usd(soldOnes.reduce((s, o) => s + premOf(o), 0)), "", "var(--gilt)"], ["Contracts settled", String(kept + exercised), "", "var(--ink)"], ["Calls for sale now", String(open.length), "", "var(--ink)"]] as const).map(([label, v, unit, color]) => (
              <div key={label} className="ld-stack" style={{ gap: 12 }}>
                <span className="ld-label ld-muted" style={{ fontSize: 11 }}>{label}</span>
                <span className="lab-big" style={{ color }}>{v}{unit && <span style={{ fontSize: "0.45em", marginLeft: 8, letterSpacing: 0 }} className="ld-muted">{unit}</span>}</span>
              </div>
            ))}
          </div>
          <div style={{ borderTop: "1px solid var(--rule)", padding: "12px 0" }}><Tag /></div>
        </div>
      </Idea>

      <Idea n="03" group="Proof the market is alive" title="The latest sold calls, as certificates" where="a row of three under Why, each opening its public on-chain record">
        {soldOnes.length ? (
          <div className="ld-3 lab-3">
            {soldOnes.slice(0, 3).map((o) => { const r = describe(o, now); return (
              <a key={o.serial} className="lab-note" href={`#/c/${o.serial}`}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--gilt-ink)" }}>
                  <SerialRosette serial={`CV-${o.serial}`} size={44} /><b className="ld-mono" style={{ color: "var(--ink)", fontSize: 15 }}>CV-{o.serial}</b>
                  <span className="ld-stamp" style={{ marginLeft: "auto", color: STAMP[r.stamp] }}>{r.word}</span>
                </div>
                <div><span className="ld-label ld-muted" style={{ fontSize: 11 }}>Covered call on</span><div className="ld-mono" style={{ fontSize: 30, lineHeight: "36px", color: "var(--copper-ink)" }}>{btc(sizeOf(o))} BTC</div></div>
                <div className="lab-kv" style={{ borderTop: "1px solid var(--rule)", paddingTop: 14 }}>
                  <span className="ld-muted">Strike</span><b>{usd0(strikeOf(o))}</b>
                  <span className="ld-muted">Expires</span><b>{dayUtc(Number(o.expiry_s))}</b>
                  <span className="ld-muted">Premium paid</span><b style={{ color: "var(--gilt-ink)" }}>{usd(premOf(o))}</b>
                </div>
                <span className="body-small" style={{ color: "var(--intaglio)" }}>On-chain record →</span>
              </a>
            ); })}
          </div>
        ) : <Empty>No calls have sold yet.</Empty>}
      </Idea>

      <Idea n="04" group="What a seller could earn today" title="What calls actually sold for" where="in Returns, beside or under the calculator">
        {soldOnes.length ? (
          <div className="ld-2" style={{ gridTemplateColumns: "minmax(0, 4fr) minmax(0, 8fr)" }}>
            <div className="ld-stack" style={{ gap: 12 }}>
              <span className="ld-label ld-muted" style={{ fontSize: 11 }}>Typical premium, last {Math.min(20, soldOnes.length)} sold</span>
              <span className="lab-big" style={{ color: "var(--gilt-ink)", fontSize: 56 }}>{pct(median(soldOnes.slice(0, 20).map(yieldOf)))}</span>
              <p className="body-small ld-muted" style={{ margin: 0 }}>of the coins’ value at the strike, for a term of about {span(median(soldOnes.slice(0, 20).map((o) => Number(o.expiry_s) - Number(o.created_s ?? o.expiry_s))))}. What sold, not a forecast.</p>
              <Tag />
            </div>
            <table className="lab-table">
              <thead><tr><th>Contract</th><th>Strike</th><th>Above today</th><th>Term</th><th className="r">Premium</th><th className="r">For the term</th></tr></thead>
              <tbody>{soldOnes.slice(0, 6).map((o) => (
                <tr key={o.serial}><td><a href={`#/c/${o.serial}`}>CV-{o.serial}</a></td><td>{usd0(strikeOf(o))}</td><td>{(strikeOf(o) / spot - 1 >= 0 ? "+" : "") + pct((strikeOf(o) / spot - 1) * 100, 1)}</td><td>{span(Number(o.expiry_s) - Number(o.created_s ?? o.expiry_s))}</td><td className="r" style={{ color: "var(--gilt-ink)" }}>{usd(premOf(o))}</td><td className="r">{pct(yieldOf(o))}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty>No calls have sold yet.</Empty>}
      </Idea>

      <Idea n="05" group="What a seller could earn today" title="A small board of what is for sale" where="its own short section before Compared, with a link to the full board in the app">
        {board.bands.length ? (
          <div className="ld-stack" style={{ gap: 12 }}>
            <div className="lab-board" style={{ gridTemplateColumns: `96px repeat(${board.columns.length}, minmax(0, 1fr))` }}>
              <span />{board.columns.map((c, i) => <span key={i} className="ld-label ld-muted" style={{ fontSize: 11, padding: "0 10px 6px" }}>{c.later ? "Later" : dayUtc(c.fromS)}</span>)}
              {board.bands.map((b, row) => [
                row === line && <div key={"spot" + b} style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 12, color: "var(--copper-ink)" }}><span className="ld-label" style={{ fontSize: 11, whiteSpace: "nowrap" }}>Bitcoin today {usd0(spot)}</span><span style={{ flex: 1, borderTop: "1px dashed currentColor" }} /></div>,
                <span key={"l" + b} className="ld-mono" style={{ alignSelf: "center", fontSize: 13 }}>{usd0(b)}</span>,
                ...board.columns.map((_, col) => { const asks = board.cells[cellKey(b, col)]; const amount = asks ? cellBtc(asks) : 0; return (
                  <div key={b + ":" + col} className="lab-cell" style={{ background: asks ? `color-mix(in srgb, var(--intaglio) ${Math.round(10 + 45 * (amount / board.maxBtc))}%, var(--paper))` : "transparent" }}>
                    {asks && <><span style={{ fontWeight: 600 }}>{usd0(asks[0].perBtc)}<span className="ld-muted" style={{ fontWeight: 400 }}> /BTC</span></span><span className="ld-muted" style={{ fontSize: 12, color: "var(--ink)" }}>{btc(amount)} BTC{asks.length > 1 ? ` · ${asks.length} offers` : ""}</span></>}
                  </div>
                ); }),
              ])}
              {line === board.bands.length && <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 12, color: "var(--copper-ink)" }}><span className="ld-label" style={{ fontSize: 11, whiteSpace: "nowrap" }}>Bitcoin today {usd0(spot)}</span><span style={{ flex: 1, borderTop: "1px dashed currentColor" }} /></div>}
            </div>
            <p className="body-small ld-muted" style={{ margin: 0 }}>Rows are strikes, columns are expiry dates. Each cell shows the cheapest premium per bitcoin; darker means more bitcoin on offer. <a href="#/market">Open the full board</a>.</p>
          </div>
        ) : <Empty>Nothing is for sale right now.</Empty>}
      </Idea>

      <Idea n="06" group="What a seller could earn today" title="Premium against distance from today’s price" where="in Returns, to show the “closer strike pays more” rule with real contracts">
        {points.length > 2 ? <Curve points={points} /> : <Empty>Too few contracts to draw a curve yet.</Empty>}
      </Idea>

      <Idea n="07" group="Trust, in numbers" title="How contracts ended" where="in What you are trusting, above the table of who can sign">
        {kept + exercised ? (
          <div className="ld-stack" style={{ gap: 12 }}>
            <div style={{ display: "flex", height: 56, border: "1px solid var(--rule-strong)" }}>
              <div style={{ flex: kept, background: "var(--intaglio)", color: "var(--on-intaglio)", display: kept ? "flex" : "none", alignItems: "center", padding: "0 16px" }} className="ld-mono">{pct((kept / (kept + exercised)) * 100, 0)}</div>
              <div style={{ flex: exercised, background: "var(--copper)", color: "var(--paper)", display: exercised ? "flex" : "none", alignItems: "center", justifyContent: "flex-end", padding: "0 16px" }} className="ld-mono">{pct((exercised / (kept + exercised)) * 100, 0)}</div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
              <span className="body"><b>{kept} not exercised.</b> <span className="ld-muted">The seller kept the coins and the premium.</span></span>
              <span className="body" style={{ textAlign: "right" }}><b>{exercised} exercised.</b> <span className="ld-muted">The buyer paid the strike and got the coins.</span></span>
            </div>
            <p className="body-small ld-muted" style={{ margin: 0 }}>Every one was settled by the contract’s own signature.{unsold ? ` ${unsold} more offers were withdrawn unsold.` : ""}</p>
          </div>
        ) : <Empty>No contracts have settled yet.</Empty>}
      </Idea>

      <Idea n="08" group="Trust, in numbers" title="Every deposit, proven on Bitcoin" where="next to the Verify mention in Why, or in What you are trusting">
        {proven.length ? (
          <div className="ld-2" style={{ gridTemplateColumns: "minmax(0, 5fr) minmax(0, 7fr)", alignItems: "center" }}>
            <div className="ld-stack" style={{ gap: 12 }}>
              <span className="lab-big" style={{ fontSize: 56 }}>{proven.length}<span className="ld-muted" style={{ fontSize: "0.5em" }}> of {proven.length}</span></span>
              <p className="body" style={{ margin: 0 }}>deposits proven to the contract by a Bitcoin light client, before a single call could be sold.</p>
              <a className="body-small" href={`#/c/${proven[proven.length - 1].serial}`}>Run the seven checks yourself →</a>
            </div>
            <div className="lab-dots" aria-hidden="true">{proven.slice(-240).map((o) => <i key={o.serial} title={`CV-${o.serial}`} />)}</div>
          </div>
        ) : <Empty>No deposits yet.</Empty>}
      </Idea>

      <Idea n="09" group="Trust, in numbers" title="The coins, where they sit on Bitcoin" where="in Why, under “Custody-free”, or beside the trust table">
        {resting.length ? (
          <div className="ld-2" style={{ gridTemplateColumns: "minmax(0, 4fr) minmax(0, 8fr)" }}>
            <div className="ld-stack" style={{ gap: 12 }}>
              <span className="ld-label ld-muted" style={{ fontSize: 11 }}>At {resting.length} Bitcoin addresses right now</span>
              <span className="lab-big" style={{ color: "var(--copper-ink)", fontSize: 48 }}>{btc(restBtc)}<span style={{ fontSize: "0.45em", marginLeft: 8 }} className="ld-muted">BTC</span></span>
              <p className="body-small ld-muted" style={{ margin: 0 }}>Each contract has its own address. Look any of them up on a Bitcoin explorer; none of them is ours.</p>
              <Tag />
            </div>
            <table className="lab-table">
              <thead><tr><th>Contract</th><th>Address</th><th className="r">Holds</th><th className="r" /></tr></thead>
              <tbody>{resting.slice(0, 5).map((o) => (
                <tr key={o.serial}><td>CV-{o.serial}</td><td>{o.address.slice(0, 10)}…{o.address.slice(-6)}</td><td className="r" style={{ color: "var(--copper-ink)" }}>{btc(sizeOf(o))} BTC</td><td className="r" style={{ fontFamily: "var(--font-sans)" }}><a href={`${CFG.explorerBtc}/address/${o.address}`} target="_blank" rel="noreferrer">Explorer ↗</a></td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty>No coins are at rest in contracts right now.</Empty>}
      </Idea>

      <Idea n="10" group="Market context" title="Bitcoin’s price, and where sellers set their strikes" where="in The idea, or as the lead-in to the small board">
        <Strikes history={history.points} real={history.real} spot={spot} open={open} />
      </Idea>

      <div className="ld-wrap" style={{ padding: "8px 64px 64px" }}><p className="body-small ld-muted" style={{ margin: 0 }}>Preview only: this page is served by the dev server and is not part of the built site.</p></div>
    </div>
  );
}

/** Idea 06: one dot per contract; a line through the middle of each band of strikes. */
function Curve({ points }: { points: { x: number; y: number; sold: boolean; serial: number }[] }) {
  const W = 720, H = 300, L = 56, R = 16, T = 16, B = 40;
  const xs = points.map((p) => p.x), x0 = Math.min(0, Math.floor(Math.min(...xs))), x1 = Math.max(x0 + 1, Math.ceil(Math.max(...xs))), y1 = Math.max(...points.map((p) => p.y)) * 1.12 || 1;
  const X = (x: number) => L + ((x - x0) / (x1 - x0)) * (W - L - R), Y = (y: number) => H - B - (y / y1) * (H - T - B);
  const bins = 6, trend: [number, number][] = [];
  for (let i = 0; i < bins; i++) {
    const lo = x0 + ((x1 - x0) * i) / bins, hi = x0 + ((x1 - x0) * (i + 1)) / bins, ys = points.filter((p) => p.x >= lo && (p.x < hi || i === bins - 1)).map((p) => p.y);
    if (ys.length) trend.push([(lo + hi) / 2, median(ys)]);
  }
  const dy = y1 > 2 ? 1 : y1 > 0.5 ? 0.25 : y1 > 0.1 ? 0.05 : 0.01, dx = x1 - x0 > 12 ? 5 : x1 - x0 > 5 ? 2 : 1;
  const ticksY = Array.from({ length: Math.floor(y1 / dy) + 1 }, (_, i) => i * dy), ticksX: number[] = [];
  for (let t = Math.ceil(x0 / dx) * dx; t <= x1; t += dx) ticksX.push(t);
  return (
    <figure style={{ margin: 0 }} className="ld-stack">
      <svg className="lab-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Premium as a share of the coins’ value, against how far the strike is above today’s price" style={{ width: "100%", height: "auto", maxWidth: 860 }}>
        {ticksY.map((t) => <g key={t}><line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} stroke="var(--rule)" /><text x={L - 8} y={Y(t) + 4} textAnchor="end">{pct(t, dy < 0.1 ? 2 : dy < 1 ? 2 : 0)}</text></g>)}
        {ticksX.map((t) => <text key={t} x={X(t)} y={H - B + 18} textAnchor="middle">{t > 0 ? "+" : ""}{t}%</text>)}
        <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle">strike above today’s price</text>
        {trend.length > 1 && <polyline points={trend.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")} fill="none" stroke="var(--intaglio)" strokeWidth="2" strokeLinejoin="round" />}
        {points.map((p) => <circle key={p.serial} cx={X(p.x)} cy={Y(p.y)} r="4.5" fill={p.sold ? "var(--gilt)" : "var(--paper)"} stroke="var(--gilt-ink)" strokeWidth="1.5"><title>CV-{p.serial}</title></circle>)}
      </svg>
      <figcaption className="body-small ld-muted" style={{ display: "flex", gap: "6px 24px", flexWrap: "wrap" }}>
        <span><svg width="12" height="12" style={{ verticalAlign: -1, marginRight: 6 }}><circle cx="6" cy="6" r="4.5" fill="var(--gilt)" stroke="var(--gilt-ink)" strokeWidth="1.5" /></svg>Sold</span>
        <span><svg width="12" height="12" style={{ verticalAlign: -1, marginRight: 6 }}><circle cx="6" cy="6" r="4.5" fill="var(--paper)" stroke="var(--gilt-ink)" strokeWidth="1.5" /></svg>For sale</span>
        <span><svg width="18" height="12" style={{ verticalAlign: -1, marginRight: 6 }}><line x1="0" x2="18" y1="6" y2="6" stroke="var(--intaglio)" strokeWidth="2" /></svg>Typical</span>
        <span>Premium as a share of the coins’ value at the strike. Terms differ; longer calls pay more.</span>
      </figcaption>
    </figure>
  );
}

/** Idea 10: a week of price as a line; one mark on the right edge per strike band on offer, longer for more bitcoin. */
function Strikes({ history, real, spot, open }: { history: [number, number][]; real: boolean; spot: number; open: O[] }) {
  const W = 760, H = 300, L = 64, R = 236, T = 16, B = 32;
  const near = open.filter((o) => strikeOf(o) < spot * 1.3), prices = history.map((p) => p[1]), all = [...prices, spot, ...near.map(strikeOf)];
  const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.08 || 1, y0 = lo - pad, y1 = hi + pad;
  // Strikes are gathered into bands wide enough that their labels (about 16px tall) do not run into each other.
  const step = [250, 500, 1000, 2500, 5000, 10000].find((d) => (d / (y1 - y0)) * (H - T - B) >= 16) ?? 25000, bands = new Map<number, number>();
  for (const o of near) { const b = Math.round(strikeOf(o) / step) * step; bands.set(b, (bands.get(b) ?? 0) + sizeOf(o)); }
  const t0 = history[0][0], t1 = history[history.length - 1][0];
  const X = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R), Y = (p: number) => T + ((y1 - p) / (y1 - y0)) * (H - T - B);
  const dy = [250, 500, 1000, 2500, 5000, 10000].find((d) => (y1 - y0) / d <= 6) ?? 20000, most = Math.max(...bands.values(), 0);
  const ticks: number[] = []; for (let p = Math.ceil(y0 / dy) * dy; p <= y1; p += dy) ticks.push(p);
  const days: number[] = []; for (let d = Math.ceil(t0 / 86400) * 86400; d <= t1; d += 86400) days.push(d);
  return (
    <figure style={{ margin: 0 }} className="ld-stack">
      <svg className="lab-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bitcoin’s price over the last week, with the strikes on offer marked" style={{ width: "100%", height: "auto", maxWidth: 860 }}>
        {ticks.map((p) => <g key={p}><line x1={L} x2={W - R} y1={Y(p)} y2={Y(p)} stroke="var(--rule)" /><text x={L - 8} y={Y(p) + 4} textAnchor="end">{usd0(p)}</text></g>)}
        {days.map((d) => <text key={d} x={X(d)} y={H - B + 18} textAnchor="middle">{dayUtc(d)}</text>)}
        <polyline points={history.map(([t, p]) => `${X(t).toFixed(1)},${Y(p).toFixed(1)}`).join(" ")} fill="none" stroke="var(--ink)" strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx={X(t1)} cy={Y(prices[prices.length - 1])} r="4" fill="var(--copper)" />
        {[...bands].sort((a, b) => a[0] - b[0]).map(([b, amount]) => (
          <g key={b}>
            <line x1={L} x2={W - R} y1={Y(b)} y2={Y(b)} stroke="var(--gilt-ink)" strokeDasharray="2 5" opacity=".55" />
            <rect x={W - R + 8} y={Y(b) - 4} width={8 + 44 * (amount / most)} height="8" fill="var(--gilt)" stroke="var(--gilt-ink)" />
            <text x={W - R + 24 + 44 * (amount / most)} y={Y(b) + 4} style={{ fill: "var(--ink)" }}>{usd0(b)} · {btc(amount)} BTC</text>
          </g>
        ))}
      </svg>
      <figcaption className="body-small ld-muted">
        The line is Bitcoin’s price over the last week{real ? "" : " (made up here: the price feed could not be read)"}. Each gold mark is a strike with calls for sale now; a longer mark means more bitcoin offered there.{bands.size ? "" : " Nothing is for sale right now, so there are no marks."}
      </figcaption>
    </figure>
  );
}
