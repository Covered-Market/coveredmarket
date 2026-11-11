/**
 * The latest contracts, newest first, for the website's live market. The relayer reads them once and every visitor
 * shares the result: a browser reading them itself makes dozens of calls to the public RPC node per visit, the node
 * answers 429 without CORS headers, and the NEAR client retries what looks like a network failure a dozen times.
 */

/** The newest serial for which `exists` holds, given that serials are handed out 1, 2, 3, … and `known` exists (or is 0). */
export async function newestSerial(exists: (serial: number) => Promise<boolean>, known = 0): Promise<number> {
  let lo = known, step = 1, hi = lo + step;
  while (await exists(hi)) { lo = hi; step *= 2; hi = lo + step; }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await exists(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A reader of the `max` newest offers, `batch` at a time. The public RPC node turns away a burst (429), so a failed
 *  read is tried twice more after a pause, and an offer that still fails keeps the copy from the previous read rather
 *  than dropping out of the list. Later reads start looking for the newest serial from the one found last time. */
export function latestReader<O>(get: (serial: number) => Promise<O | null>, max = 48, batch = 8, pause = sleep) {
  let known = 0, last = new Map<number, O>();
  const read = async (s: number): Promise<O | null> => {
    for (let i = 0; ; i++) {
      try { return await get(s); } catch (e) { if (i >= 2) throw e; await pause(1000 * (i + 1)); }
    }
  };
  return async (): Promise<O[]> => {
    known = await newestSerial(async (s) => (await read(s)) !== null, known);
    const serials = Array.from({ length: Math.min(max, known) }, (_, i) => known - i), got = new Map<number, O>();
    for (let i = 0; i < serials.length; i += batch) {
      await Promise.all(serials.slice(i, i + batch).map(async (s) => {
        const o = await read(s).catch(() => last.get(s) ?? null);
        if (o) got.set(s, o);
      }));
    }
    last = got;
    return serials.flatMap((s) => (got.has(s) ? [got.get(s)!] : []));
  };
}
