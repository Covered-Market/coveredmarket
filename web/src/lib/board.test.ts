import { describe, expect, it } from "vitest";
import { buildBoard, cellKey, spotRow, strikeStep, toAsk, type Ask } from "./board";

const day = (d: number, h = 8) => Date.UTC(2026, 10, d, h) / 1000;
const ask = (serial: number, strike: number, expiryS: number, sizeBtc: number, premium: number): Ask => ({ serial, strike, expiryS, sizeBtc, premium, perBtc: premium / sizeBtc });

describe("board", () => {
  it("quotes the premium per whole bitcoin", () => {
    const a = toAsk({ serial: 7, strike_units: "80000000000", expiry_s: String(day(17)), size_sats: "50000", premium_units: "2500000" });
    expect(a).toMatchObject({ serial: 7, strike: 80000, sizeBtc: 0.0005, premium: 2.5 });
    expect(a.perBtc).toBeCloseTo(5000);
  });

  it("picks the narrowest round band that fits the rows", () => {
    expect(strikeStep(75000, 75000)).toBe(100);
    expect(strikeStep(74000, 81000)).toBe(1000);
    expect(strikeStep(74000, 92000)).toBe(2500);
    expect(strikeStep(60000, 200000)).toBe(25000);
  });

  it("lays offers out by strike band and expiry day, cheapest first", () => {
    const b = buildBoard([
      ask(1, 75000, day(12), 0.001, 2), ask(2, 75400, day(12, 20), 0.002, 3), ask(3, 79000, day(19), 0.001, 1), ask(4, 75000, day(12), 0.001, 1),
    ]);
    expect(b.step).toBe(1000);
    expect(b.bands).toEqual([79000, 78000, 77000, 76000, 75000]);
    expect(b.columns.length).toBe(2);
    expect(b.cells[cellKey(75000, 0)].map((a) => a.serial)).toEqual([4, 2, 1]); // $1,000, $1,500 and $2,000 per bitcoin
    expect(b.cells[cellKey(79000, 1)].map((a) => a.serial)).toEqual([3]);
    expect(b.maxBtc).toBeCloseTo(0.004);
  });

  it("gathers the days past the last column into it", () => {
    const b = buildBoard([11, 12, 13, 14, 15, 16, 30].map((d, i) => ask(i + 1, 80000, day(d), 0.001, 1)));
    expect(b.columns.length).toBe(5);
    expect(b.columns[4].later).toBe(true);
    expect(b.cells[cellKey(80000, 4)].length).toBe(3);
  });

  it("puts the reference price above the bands that are wholly in the money", () => {
    const bands = [80000, 78000, 76000];
    expect(spotRow(bands, 2000, 90000)).toBe(0);
    expect(spotRow(bands, 2000, 79000)).toBe(2); // 78,000 to 80,000 straddles the price and stays above the line
    expect(spotRow(bands, 2000, 78000)).toBe(2);
    expect(spotRow(bands, 2000, 77000)).toBe(3);
  });
});
