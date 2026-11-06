import { describe, expect, it } from "vitest";
import { spotUsd } from "./spot.js";

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
