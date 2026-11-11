/** Reference price: median of five public tickers. Display only; never on chain. */
const SOURCES: [string, (j: any) => number][] = [
  ["https://api.coinbase.com/v2/prices/BTC-USD/spot", (j) => Number(j.data.amount)],
  ["https://api.kraken.com/0/public/Ticker?pair=XBTUSD", (j) => Number((Object.values(j.result as Record<string, { c: string[] }>)[0]!).c[0])],
  ["https://www.bitstamp.net/api/v2/ticker/btcusd/", (j) => Number(j.last)],
  ["https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", (j) => Number(j.price)],
  ["https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT", (j) => Number(j.data[0].last)],
];
export async function spotUsd(fetchFn: typeof fetch = fetch): Promise<{ price: number; sources: number }> {
  const vals = (await Promise.all(SOURCES.map(async ([u, f]) => { try { const r = await fetchFn(u, { signal: AbortSignal.timeout(4000) }); return f(await r.json()); } catch { return NaN; } }))).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (vals.length === 0) throw new Error("no price sources");
  const mid = vals.length >> 1;
  return { price: vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2, sources: vals.length };
}

/** A week of hourly closes, oldest first, as [unix seconds, USD]: the first exchange that answers. Display only. */
const HISTORY: [string, (j: any) => [number, number][]][] = [
  ["https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600", (j) => (j as number[][]).map((c) => [c[0], c[4]])],
  ["https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=3600&limit=168", (j) => (j.data.ohlc as { timestamp: string; close: string }[]).map((c) => [Number(c.timestamp), Number(c.close)])],
  ["https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=60", (j) => (Object.values(j.result as Record<string, unknown>)[0] as (string | number)[][]).map((c) => [Number(c[0]), Number(c[4])])],
];
export const HISTORY_HOURS = 168;
export async function spotHistory(fetchFn: typeof fetch = fetch): Promise<[number, number][]> {
  for (const [u, f] of HISTORY) {
    try {
      const r = await fetchFn(u, { signal: AbortSignal.timeout(6000), headers: { "user-agent": "coveredmarket-relayer" } });
      const pts = f(await r.json()).filter(([t, p]) => Number.isFinite(t) && Number.isFinite(p) && p > 0).sort((a, b) => a[0] - b[0]).slice(-HISTORY_HOURS);
      if (pts.length >= 24) return pts;
    } catch {}
  }
  throw new Error("no price history");
}
