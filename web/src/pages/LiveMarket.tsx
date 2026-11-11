/**
 * The live market on the landing page: a ticker of the latest contracts, the latest sold calls as a carousel, and
 * Bitcoin's price with the strikes on offer. All three read the contract the page is configured for (testnet on
 * the website). Each one draws nothing rather than something misleading when there is nothing to show.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { describe, newestSerial, type Stamp } from "../lib/activity";
import { view } from "../lib/near";
import type { Offer } from "../lib/verify";
import { SerialRosette } from "../patterns";

type O = Offer & { signed_at_s?: string | null };
/** How many of the latest contracts the page reads. */
const LATEST = 48;

const usd0 = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const usd = (n: number) => (n >= 1000 ? usd0(n) : "$" + n.toFixed(2));
const btc = (n: number) => (n >= 10 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n >= 0.01 ? n.toFixed(3) : n.toFixed(5));
const dayUtc = (s: number) => new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const sizeOf = (o: O) => Number(o.size_sats) / 1e8, strikeOf = (o: O) => Number(o.strike_units) / 1e6, premOf = (o: O) => Number(o.premium_units) / 1e6;
const lastOf = (o: O) => Math.max(Number(o.created_s ?? 0), Number(o.committed_at_s ?? 0), Number(o.signed_at_s ?? 0));
const INK: Record<Stamp, string> = { open: "var(--intaglio)", kept: "var(--intaglio)", exercised: "var(--copper-ink)", settled: "var(--ink-muted)", pending: "var(--gilt-ink)", refused: "var(--oxblood)" };

export interface MarketData { /** null while the first read is under way. */ offers: O[] | null; failed: boolean; history: [number, number][] | null; historyFailed: boolean }

/** Marks what the page reads from the contract or the price feed, so nobody takes it for sample data. "loading" is
 *  the badge while the first read is under way; "failed" when it could not be read. */
export function Live({ state = "live", label = "Live data", title }: { state?: "live" | "loading" | "failed"; label?: string; title?: string }) {
  const tip = title ?? (state === "failed" ? "Could not be read just now" : state === "loading" ? "Reading…" : "Read from the contract on NEAR testnet, refreshed every minute");
  const [first, ...rest] = label.split(" ");
  return <span className="ld-live" data-state={state} title={tip}><i aria-hidden="true" /><span>{first}{rest.length > 0 && <span className="ld-live-x"> {rest.join(" ")}</span>}</span><span className="ld-sr"> · {tip}</span></span>;
}

/** A grey bar in the shape of text that is still loading. */
export const Skel = ({ w, h = 14, style }: { w: number | string; h?: number; style?: React.CSSProperties }) => <span className="ld-skel" aria-hidden="true" style={{ width: w, height: h, ...style }} />;

/** The latest contracts (newest first) and a week of hourly prices. Contracts refresh every minute while the tab is
 *  in view. The relayer reads them once for every visitor (/api/market/latest): a browser reading them itself makes
 *  dozens of calls to the public RPC node per visit, which turns them away. Only a relayer without that endpoint
 *  (an older one, behind a dev server) makes the page read the contract directly, eight offers at a time. */
export function useMarket(): MarketData {
  const [offers, setOffers] = useState<O[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [history, setHistory] = useState<[number, number][] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const known = useRef(0);
  useEffect(() => {
    let alive = true;
    const direct = async () => {
      const top = await newestSerial(async (s) => (await view<O | null>("get_offer", { serial: s })) !== null, known.current);
      known.current = top;
      const serials = Array.from({ length: Math.min(LATEST, top) }, (_, i) => top - i), got: (O | null)[] = [];
      for (let i = 0; i < serials.length; i += 8) got.push(...await Promise.all(serials.slice(i, i + 8).map((s) => view<O | null>("get_offer", { serial: s }).catch(() => null))));
      return got.filter((o): o is O => !!o);
    };
    const load = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/market/latest", { cache: "no-store" });
        const got: O[] = r.ok ? (await r.json()).offers : r.status === 404 ? await direct() : Promise.reject(new Error(`market ${r.status}`));
        if (!Array.isArray(got)) throw new Error("market: no offers");
        if (alive) { setOffers(got); setFailed(false); }
      } catch { if (alive) setFailed(true); }
    };
    load(); const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  useEffect(() => {
    let alive = true;
    const ok = (p: unknown): p is [number, number][] => Array.isArray(p) && p.length >= 2;
    (async () => {
      try { const j = await (await fetch("/api/spot/history")).json(); if (ok(j?.points)) { if (alive) setHistory(j.points); return; } } catch {}
      // Dev server only: a relayer without the history endpoint yet. A public feed stands in, so the chart can be looked at.
      if (import.meta.env.DEV) {
        try { const k: [number, string, string, string, string][] = await (await fetch("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=168")).json(); if (alive) setHistory(k.map((c) => [c[0] / 1000, Number(c[4])])); return; } catch {}
      }
      if (alive) setHistoryFailed(true);
    })();
    return () => { alive = false; };
  }, []);
  return { offers, failed, history, historyFailed };
}

/** The latest contracts as a moving strip. It stops under the pointer, and stays still (and scrolls by hand) for
 *  people who ask for less motion. While the first read is under way it holds its place with grey stand-ins; if
 *  the read fails, or there is nothing to show, it is not drawn. */
export function Ticker({ offers, failed, href }: { offers: O[] | null; failed?: boolean; href: (route: string) => string }) {
  const rows = useMemo(() => { const now = Date.now() / 1000; return [...(offers ?? [])].sort((a, b) => lastOf(b) - lastOf(a) || b.serial - a.serial).slice(0, 14).map((o) => describe(o, now)); }, [offers]);
  const loading = offers === null && !failed;
  if (!loading && !rows.length) return null;
  return (
    <div className="ld-tick" role="region" aria-label="Latest contracts" aria-busy={loading || undefined}>
      <div className="ld-tick-live"><Live state={loading ? "loading" : "live"} /></div>
      {loading ? (
        <div className="ld-tick-view">
          <div className="ld-tick-track ld-tick-track--still">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <span key={i} className="ld-tick-item ld-tick-ph"><Skel w={46} /><Skel w={52} h={11} /><Skel w={132} /><Skel w={92} /></span>)}
          </div>
        </div>
      ) : (
      <div className="ld-tick-view ld-fade">
        <div className="ld-tick-track" style={{ animationDuration: `${rows.length * 6}s` }}>
          {[0, 1].map((k) => rows.map((r) => (
            <a key={k + "-" + r.serial} className="ld-tick-item" href={href(`c/${r.serial}`)} aria-hidden={k === 1 || undefined} tabIndex={k === 1 ? -1 : undefined}>
              <b className="ld-mono">CV-{r.serial}</b><span className="ld-tick-word" style={{ color: INK[r.stamp] }}>{r.word}</span>
              <span className="ld-mono">{btc(r.sizeBtc)} BTC at {usd0(r.strikeUsd)}</span>
              <span className="ld-muted">premium <span className="ld-mono" style={{ color: "var(--gilt-ink)" }}>{usd(r.premiumUsd)}</span></span>
              {r.when && <span className="ld-muted">{r.when}</span>}
            </a>
          )))}
        </div>
      </div>
      )}
    </div>
  );
}

/** The latest calls that found a buyer, as small certificates in a row that scrolls sideways. Each opens its
 *  public page in the app. While the first read is under way, grey certificates hold their place. */
export function SoldCalls({ offers, failed, href }: { offers: O[] | null; failed?: boolean; href: (route: string) => string }) {
  const sold = useMemo(() => (offers ?? []).filter((o) => o.buyer).sort((a, b) => b.serial - a.serial).slice(0, 10), [offers]);
  const row = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const measure = () => { const el = row.current; if (el) setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 }); };
  useEffect(() => { measure(); addEventListener("resize", measure); return () => removeEventListener("resize", measure); }, [sold.length]);
  const turn = (d: number) => row.current?.scrollBy({ left: d * Math.max(280, row.current.clientWidth * 0.8), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  const now = Date.now() / 1000;
  return (
    <div className="ld-stack" style={{ gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, minHeight: 44 }}>
        <h3 className="heading" style={{ margin: 0 }}>Latest sold calls</h3>
        {sold.length > 1 && (
          <div className="ld-car-nav">
            <button type="button" onClick={() => turn(-1)} disabled={edge.start} aria-label="Earlier sold calls"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5" /></svg></button>
            <button type="button" onClick={() => turn(1)} disabled={edge.end} aria-label="More sold calls"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5L16 12l-6.5 6.5" /></svg></button>
          </div>
        )}
      </div>
      {offers === null ? (failed
        ? <p className="body ld-muted" style={{ margin: 0, padding: "24px 0", borderTop: "1px solid var(--rule)", borderBottom: "1px solid var(--rule)" }}>The market could not be read just now.</p>
        : <div className="ld-car" aria-busy="true" aria-label="Reading the latest sold calls">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="ld-note ld-note--ph" aria-hidden="true">
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}><Skel w={44} h={44} style={{ borderRadius: 999 }} /><Skel w={64} h={16} /><Skel w={78} h={20} style={{ marginLeft: "auto" }} /></div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}><Skel w={110} h={12} style={{ margin: "2px 0" }} /><Skel w={150} h={36} /></div>
              <div className="ld-note-kv">{[0, 1, 2].map((k) => [<Skel key={k} w={70} />, <Skel key={k + "v"} w={84} style={{ justifySelf: "end" }} />])}</div>
              <Skel w={120} style={{ margin: "3px 0" }} />
            </div>
          ))}
        </div>
      ) : sold.length ? (
        <div className="ld-car ld-fade" ref={row} onScroll={measure} tabIndex={0} role="region" aria-label="Latest sold calls">
          {sold.map((o) => { const r = describe(o, now); return (
            <a key={o.serial} className="ld-note" href={href(`c/${o.serial}`)}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--gilt-ink)" }}>
                <SerialRosette serial={`CV-${o.serial}`} size={44} /><b className="ld-mono" style={{ color: "var(--ink)", fontSize: 15 }}>CV-{o.serial}</b>
                <span className="ld-stamp" style={{ marginLeft: "auto", color: INK[r.stamp] }}>{r.word}</span>
              </div>
              <div><span className="ld-label ld-muted" style={{ fontSize: 11 }}>Covered call on</span><div className="ld-mono" style={{ fontSize: 28, lineHeight: "36px", color: "var(--copper-ink)" }}>{btc(sizeOf(o))} BTC</div></div>
              <div className="ld-note-kv">
                <span className="ld-muted">Strike</span><b>{usd0(strikeOf(o))}</b>
                <span className="ld-muted">Expires</span><b>{dayUtc(Number(o.expiry_s))}</b>
                <span className="ld-muted">Premium paid</span><b style={{ color: "var(--gilt-ink)" }}>{usd(premOf(o))}</b>
              </div>
              <span className="body-small" style={{ color: "var(--intaglio)" }}>On-chain record →</span>
            </a>
          ); })}
        </div>
      ) : <p className="body ld-muted" style={{ margin: 0, padding: "24px 0", borderTop: "1px solid var(--rule)", borderBottom: "1px solid var(--rule)" }}>No call has sold yet.</p>}
    </div>
  );
}

/** The chart's place while its data is read: the same height, a faint grid and a grey band where the line goes. */
export function PriceAndStrikesLoading() {
  return (
    <figure style={{ margin: 0 }} className="ld-stack" aria-busy="true" aria-label="Reading Bitcoin’s price and the strikes on offer">
      <div className="ld-chart-ph" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <i key={i} />)}</div>
      <div className="ld-chart-ph-cap" aria-hidden="true"><Skel w={150} /><Skel w={290} /></div>
    </figure>
  );
}

/** A week of Bitcoin's price as a line, and on its right edge one mark per strike with calls for sale: longer for
 *  more bitcoin. Strikes are gathered into bands wide enough that their labels do not run into each other. */
export function PriceAndStrikes({ history, spot, offers }: { history: [number, number][]; spot: number; offers: O[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const fit = () => setW(Math.max(300, Math.round(el.clientWidth)));
    fit(); const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const now = Date.now() / 1000, narrow = W < 560, H = narrow ? 260 : 320, L = narrow ? 52 : 64, R = narrow ? 104 : 236, T = 16, B = 32;
  const open = offers.filter((o) => o.state === "Funded" && Number(o.expiry_s) > now && strikeOf(o) < spot * 1.3 && strikeOf(o) > spot * 0.7);
  const prices = history.map((p) => p[1]), all = [...prices, spot, ...open.map(strikeOf)];
  const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.08 || 1, y0 = lo - pad, y1 = hi + pad;
  const step = [250, 500, 1000, 2500, 5000, 10000].find((d) => (d / (y1 - y0)) * (H - T - B) >= 16) ?? 25000, bands = new Map<number, number>();
  for (const o of open) { const b = Math.round(strikeOf(o) / step) * step; bands.set(b, (bands.get(b) ?? 0) + sizeOf(o)); }
  const t0 = history[0][0], t1 = history[history.length - 1][0];
  const X = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R), Y = (p: number) => T + ((y1 - p) / (y1 - y0)) * (H - T - B);
  const dy = [250, 500, 1000, 2500, 5000, 10000].find((d) => (y1 - y0) / d <= 6) ?? 20000, most = Math.max(...bands.values(), 0), bar = narrow ? 20 : 44;
  const ticks: number[] = []; for (let p = Math.ceil(y0 / dy) * dy; p <= y1; p += dy) ticks.push(p);
  const days: number[] = []; for (let d = Math.ceil(t0 / 86400) * 86400; d <= t1; d += 86400 * (narrow ? 2 : 1)) days.push(d);
  const total = [...bands.values()].reduce((s, v) => s + v, 0);
  return (
    <figure style={{ margin: 0 }} className="ld-stack ld-fade">
      <div ref={box} style={{ minWidth: 0 }}>
        <svg className="ld-chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" style={{ display: "block", maxWidth: "100%" }}
          aria-label={`Bitcoin’s price over the last week, now ${usd0(spot)}. ${bands.size ? `Calls are for sale at strikes from ${usd0(Math.min(...bands.keys()))} to ${usd0(Math.max(...bands.keys()))}, on ${btc(total)} BTC in all.` : "No calls are for sale right now."}`}>
          {ticks.map((p) => <g key={p}><line x1={L} x2={W - R} y1={Y(p)} y2={Y(p)} stroke="var(--rule)" /><text x={L - 8} y={Y(p) + 4} textAnchor="end">{usd0(p)}</text></g>)}
          {days.map((d) => <text key={d} x={X(d)} y={H - B + 18} textAnchor="middle">{dayUtc(d)}</text>)}
          <polyline points={history.map(([t, p]) => `${X(t).toFixed(1)},${Y(p).toFixed(1)}`).join(" ")} fill="none" stroke="var(--ink)" strokeWidth="1.8" strokeLinejoin="round" />
          <circle cx={X(t1)} cy={Y(prices[prices.length - 1])} r="4" fill="var(--copper)" />
          {[...bands].sort((a, b) => a[0] - b[0]).map(([b, amount]) => (
            <g key={b}>
              <line x1={L} x2={W - R} y1={Y(b)} y2={Y(b)} stroke="var(--gilt-ink)" strokeDasharray="2 5" opacity=".55" />
              <rect x={W - R + 8} y={Y(b) - 4} width={8 + bar * (amount / most)} height="8" fill="var(--gilt)" stroke="var(--gilt-ink)" />
              <text x={W - R + 24 + bar * (amount / most)} y={Y(b) + 4} style={{ fill: "var(--ink)" }}>{usd0(b)}{narrow ? "" : ` · ${btc(amount)} BTC`}</text>
            </g>
          ))}
        </svg>
      </div>
      <figcaption className="body-small ld-muted" style={{ display: "flex", flexWrap: "wrap", gap: "6px 24px" }}>
        <span><svg width="18" height="12" style={{ verticalAlign: -1, marginRight: 6 }} aria-hidden="true"><line x1="0" x2="18" y1="6" y2="6" stroke="var(--ink)" strokeWidth="1.8" /></svg>Bitcoin, last 7 days</span>
        <span><svg width="18" height="12" style={{ verticalAlign: -1, marginRight: 6 }} aria-hidden="true"><rect x="1" y="2" width="16" height="8" fill="var(--gilt)" stroke="var(--gilt-ink)" /></svg>{bands.size ? "A strike with calls for sale; longer means more bitcoin" : "No calls are for sale right now"}</span>
      </figcaption>
    </figure>
  );
}
