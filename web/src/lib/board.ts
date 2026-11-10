/**
 * The board: every offer for sale laid out by strike (rows) and expiry (columns), the way an options chain is read.
 * Offers here are whole contracts of any size at any strike, so two things are done to make them comparable:
 * strikes are grouped into even bands, and premiums are quoted per whole bitcoin. There are no bids: a cell is a
 * stack of asks, cheapest first. Pure, so the page only draws.
 */
import type { Offer } from "./verify";

/** One offer for sale, in the units the board compares: dollars, bitcoin, and premium per whole bitcoin. */
export interface Ask { serial: number; strike: number; expiryS: number; sizeBtc: number; premium: number; perBtc: number }
/** A column: the offers expiring from `fromS` (inclusive) to `toS` (exclusive). The last one may gather everything later. */
export interface Column { fromS: number; toS: number; later: boolean }
export interface Board {
  /** Width of a strike band in dollars. */ step: number;
  /** Band floors, highest first, with no gaps between the lowest and highest strike on offer. */ bands: number[];
  columns: Column[];
  /** Asks per cell, cheapest per bitcoin first. Key: `cellKey(band, column index)`. */ cells: Record<string, Ask[]>;
  /** The most bitcoin in any one cell: what the shading is measured against. */ maxBtc: number;
}

export const cellKey = (band: number, column: number) => `${band}:${column}`;
export const cellBtc = (asks: Ask[]) => asks.reduce((s, a) => s + a.sizeBtc, 0);

export function toAsk(o: Pick<Offer, "serial" | "strike_units" | "expiry_s" | "size_sats" | "premium_units">): Ask {
  const sizeBtc = Number(o.size_sats) / 1e8, premium = Number(o.premium_units) / 1e6;
  return { serial: o.serial, strike: Number(o.strike_units) / 1e6, expiryS: Number(o.expiry_s), sizeBtc, premium, perBtc: sizeBtc > 0 ? premium / sizeBtc : 0 };
}

const STEPS = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
/** The narrowest round band width that fits the strikes from `lo` to `hi` in at most `maxRows` rows. */
export function strikeStep(lo: number, hi: number, maxRows = 8): number {
  for (const s of STEPS) if (Math.floor(hi / s) - Math.floor(lo / s) + 1 <= maxRows) return s;
  return STEPS[STEPS.length - 1];
}

const DAY = 86400;
export function buildBoard(asks: Ask[], maxRows = 8, maxColumns = 5): Board {
  if (!asks.length) return { step: 0, bands: [], columns: [], cells: {}, maxBtc: 0 };
  const strikes = asks.map((a) => a.strike), lo = Math.min(...strikes), hi = Math.max(...strikes);
  const step = strikeStep(lo, hi, maxRows);
  const bands: number[] = [];
  for (let b = Math.floor(hi / step) * step; b >= Math.floor(lo / step) * step; b -= step) bands.push(b);

  // One column per UTC day that has an expiry; past `maxColumns` days the last column gathers the rest.
  const days = [...new Set(asks.map((a) => Math.floor(a.expiryS / DAY)))].sort((a, b) => a - b);
  const columns: Column[] = days.slice(0, maxColumns).map((d) => ({ fromS: d * DAY, toS: (d + 1) * DAY, later: false }));
  if (days.length > maxColumns) columns[maxColumns - 1] = { fromS: days[maxColumns - 1] * DAY, toS: Infinity, later: true };

  const cells: Record<string, Ask[]> = {};
  for (const a of asks) {
    const band = Math.floor(a.strike / step) * step, column = columns.findIndex((c) => a.expiryS >= c.fromS && a.expiryS < c.toS);
    (cells[cellKey(band, column)] ??= []).push(a);
  }
  for (const k in cells) cells[k].sort((a, b) => a.perBtc - b.perBtc || a.serial - b.serial);
  return { step, bands, columns, cells, maxBtc: Math.max(...Object.values(cells).map(cellBtc)) };
}

/** Where the reference-price line goes: above the row at this index (`bands.length` = under the last row). Only
 *  bands wholly at or below the price sit under the line, so every strike under it is in the money. */
export function spotRow(bands: number[], step: number, spot: number): number {
  const i = bands.findIndex((b) => b + step <= spot);
  return i === -1 ? bands.length : i;
}
