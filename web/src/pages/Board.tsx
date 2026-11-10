import { useMemo, useState, type ReactNode } from "react";
import { C } from "../ds";
import { buildBoard, cellBtc, cellKey, spotRow, toAsk, type Ask, type Column } from "../lib/board";
import type { Offer } from "../lib/verify";
import { annualised } from "./hooks";

const usd0 = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const dayUtc = (s: number) => new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const timeUtc = (s: number) => new Date(s * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
/** How far off a column is, in the words a person would use. */
const away = (c: Column, nowS: number) => { const d = Math.floor(c.fromS / 86400) - Math.floor(nowS / 86400); return d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`; };

type View = "board" | "cards";
const LS = "coveredmarket.market.view";
const savedView = (): View | null => { try { const v = localStorage.getItem(LS); return v === "board" || v === "cards" ? v : null; } catch { return null; } };

/** The For sale tab: the same offers as a board (by strike and expiry) or as cards. It opens on cards on phones
 *  (the board is a wide table) and while there are too few offers to make a board of; the choice is remembered. */
export function ForSale({ offers, spot, cards }: { offers: Offer[]; spot: number; cards: ReactNode }) {
  const [view, setView] = useState<View>(() => savedView() ?? (window.innerWidth > 760 && offers.length >= 6 ? "board" : "cards"));
  const pick = (v: View) => { setView(v); try { localStorage.setItem(LS, v); } catch {} };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div role="group" aria-label="How to show the offers" className="cv-seg">
        {(["board", "cards"] as View[]).map((v) => <button key={v} type="button" aria-pressed={view === v} className={"cv-seg__b" + (view === v ? " cv-seg__b--on" : "")} onClick={() => pick(v)}>{v === "board" ? "Board" : "Cards"}</button>)}
      </div>
      {view === "board" ? <Board offers={offers} spot={spot} /> : cards}
    </div>
  );
}

/** Every offer for sale by strike (rows) and expiry (columns). A cell shows the cheapest premium per bitcoin and
 *  how much bitcoin is on offer there; picking it lists its offers underneath, cheapest first, each with Buy. */
export function Board({ offers, spot }: { offers: Offer[]; spot: number }) {
  const { Figure, Button } = C();
  const board = useMemo(() => buildBoard(offers.map(toAsk)), [offers]);
  const [picked, setPicked] = useState<string | null>(null);
  const deepest = Object.keys(board.cells).sort((a, b) => cellBtc(board.cells[b]) - cellBtc(board.cells[a]))[0];
  const on = picked && board.cells[picked] ? picked : deepest;
  const nowS = Date.now() / 1000;
  const line = spot > 0 ? spotRow(board.bands, board.step, spot) : -1;
  const head = (c: Column) => (c.later ? `${dayUtc(c.fromS)} and later` : dayUtc(c.fromS));
  const spotLine = (
    <div key="spot" className="cv-board__spot" role="row">
      <span>Reference price {usd0(spot)}</span><i aria-hidden="true" />{line < board.bands.length && <span>strikes below are in the money</span>}
    </div>
  );
  const [band, column] = (on ?? "0:0").split(":").map(Number);
  const asks = (on && board.cells[on]) || [];
  const total = cellBtc(asks);
  let run = 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="cv-board__scroll">
          <div className="cv-board" role="table" aria-label="Offers for sale by strike and expiry" style={{ gridTemplateColumns: `112px repeat(${board.columns.length}, minmax(132px, 1fr))` }}>
            <div className="cv-board__k" role="columnheader">Strike</div>
            {board.columns.map((c, i) => <div key={i} className="cv-board__col" role="columnheader"><b>{head(c)}</b><span>{away(c, nowS)}</span></div>)}
            {board.bands.flatMap((b, r) => [
              r === line ? spotLine : null,
              <div key={b} className="cv-board__band" role="rowheader"><b className="cv-mono">{usd0(b)}</b>{board.step > 100 && <span>to {usd0(b + board.step)}</span>}</div>,
              ...board.columns.map((_, i) => {
                const k = cellKey(b, i), a = board.cells[k];
                if (!a) return <div key={k} className="cv-board__cell cv-board__cell--none" role="cell" aria-label="No offers" />;
                const btc = cellBtc(a);
                return (
                  <button key={k} type="button" role="cell" aria-pressed={k === on} className={"cv-board__cell" + (k === on ? " cv-board__cell--on" : "")} onClick={() => setPicked(k)}
                    style={{ background: `color-mix(in srgb, var(--copper) ${Math.round(6 + 30 * (btc / board.maxBtc))}%, var(--paper-raised))` }}>
                    <Figure value={a[0].perBtc} kind="usd" tone="gilt" />
                    <span className="cv-board__sub"><span className="cv-mono">{btc.toFixed(4)}</span> BTC · {a.length} {a.length === 1 ? "offer" : "offers"}</span>
                  </button>
                );
              }),
            ])}
            {line === board.bands.length && spotLine}
          </div>
        </div>
        <span className="body-small" style={{ color: "var(--ink-muted)" }}>Each cell shows the cheapest premium per whole bitcoin and how much bitcoin is offered there; darker means more. Offers are whole contracts at the seller's price. There are no bids.</span>
      </div>

      {!!asks.length && (
        <section aria-labelledby="ladder-h" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h3 id="ladder-h" className="display-2" style={{ margin: 0, fontSize: 22, lineHeight: 1.15 }}>{usd0(band)}{board.step > 100 ? ` to ${usd0(band + board.step)}` : ""} calls, {board.columns[column].later ? `${dayUtc(board.columns[column].fromS)} and later` : dayUtc(board.columns[column].fromS)}</h3>
            <span className="body-small" style={{ color: "var(--ink-muted)" }}>{asks.length} {asks.length === 1 ? "offer" : "offers"} · <span className="cv-mono">{total.toFixed(4)}</span> BTC · cheapest first</span>
          </div>
          <div className="cv-board__scroll">
            <table className="cv-table cv-ladder">
              <thead><tr><th>Contract</th><th className="cv-num">Strike</th><th>Expires</th><th className="cv-num">Size</th><th className="cv-num">Premium</th><th className="cv-num">Per bitcoin</th><th className="cv-num">Annualised</th><th>Bitcoin up to here</th><th /></tr></thead>
              <tbody>
                {asks.map((a: Ask) => {
                  run += a.sizeBtc;
                  return (
                    <tr key={a.serial}>
                      <td><a href={`#/c/${a.serial}`} className="cv-mono" style={{ color: "var(--intaglio)", fontWeight: 600 }}>CV-{a.serial}</a></td>
                      <td className="cv-num"><Figure value={a.strike} kind="usd" size="sm" /></td>
                      <td style={{ whiteSpace: "nowrap" }}>{timeUtc(a.expiryS)}</td>
                      <td className="cv-num"><Figure value={a.sizeBtc} kind="btc" size="sm" /></td>
                      <td className="cv-num"><Figure value={a.premium} kind="usd" size="sm" tone="gilt" /></td>
                      <td className="cv-num"><Figure value={a.perBtc} kind="usd" size="sm" /></td>
                      <td className="cv-num cv-mono">{spot > 0 ? `${annualised(a.premium, a.sizeBtc, spot, a.expiryS).toFixed(1)}%` : "—"}</td>
                      <td><div className="cv-ladder__bar" title={`${run.toFixed(4)} BTC at this price or cheaper`}><i style={{ width: `${Math.round((100 * run) / total)}%` }} /></div></td>
                      <td className="cv-num"><Button size="sm" variant="primary" href={`#/buy/${a.serial}`}>Buy</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
