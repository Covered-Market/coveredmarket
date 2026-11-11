import { describe, expect, it } from "vitest";
import { spotHistory, spotUsd } from "./spot.js";

const stub = (prices: Record<string, unknown>) => (async (u: string) => {
  const host = new URL(u).hostname;
  const v = Object.entries(prices).find(([k]) => host.includes(k))?.[1];
  if (v === undefined) throw new Error("down");
  return { json: async () => v } as Response;
}) as unknown as typeof fetch;

describe("reference price", () => {
  it("takes the median of the sources that answer", async () => {
    const r = await spotUsd(stub({
      coinbase: { data: { amount: "97000" } },
      kraken: { result: { XXBTZUSD: { c: ["97100", "1"] } } },
      bitstamp: { last: "97050" },
      binance: { price: "250000" }, // an outlier does not move a median
      okx: { data: [{ last: "1" }] },
    }));
    expect(r).toEqual({ price: 97050, sources: 5 });
  });
  it("ignores failed sources and averages the middle pair", async () => {
    expect(await spotUsd(stub({ coinbase: { data: { amount: "100" } }, bitstamp: { last: "200" } }))).toEqual({ price: 150, sources: 2 });
  });
  it("fails when nothing answers", async () => {
    await expect(spotUsd(stub({}))).rejects.toThrow("no price sources");
  });
});

describe("price history", () => {
  const hours = (n: number, at: (i: number) => unknown) => Array.from({ length: n }, (_, i) => at(i));
  it("returns a week of hourly closes, oldest first, from the first source that answers", async () => {
    // Coinbase lists candles newest first: [time, low, high, open, close, volume].
    const r = await spotHistory(stub({ coinbase: hours(300, (i) => [1_700_000_000 - i * 3600, 1, 2, 3, 70_000 + i, 9]) }));
    expect(r).toHaveLength(168);
    expect(r[0][0]).toBeLessThan(r[167][0]);
    expect(r[167]).toEqual([1_700_000_000, 70_000]);
  });
  it("falls through to the next source", async () => {
    const r = await spotHistory(stub({ bitstamp: { data: { ohlc: hours(40, (i) => ({ timestamp: String(1_700_000_000 + i * 3600), close: "71000.5" })) } } }));
    expect(r).toHaveLength(40);
    expect(r[39]).toEqual([1_700_000_000 + 39 * 3600, 71000.5]);
  });
  it("fails when no source has a day of prices", async () => {
    await expect(spotHistory(stub({ coinbase: [[1_700_000_000, 1, 2, 3, 70_000, 9]] }))).rejects.toThrow("no price history");
  });
});
