/**
 * Bitcoin data from several Esplora-compatible providers (mempool.space, blockstream.info, …), in order.
 * A provider that is unreachable, times out, rate-limits (429) or errors (5xx) is skipped and the next one is
 * asked; a 4xx such as 404 is an answer and is returned as is. The last provider that answered is tried first
 * next time. None of this is trusted: everything the contract accepts is a proof checked by the light client.
 */
export type BtcFetch = (path: string, init?: RequestInit) => Promise<Response>;

export function parseBases(spec: string | string[]): string[] {
  const list = (Array.isArray(spec) ? spec : spec.split(",")).map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  if (!list.length) throw new Error("no Esplora base URL configured");
  return list;
}

export function failoverFetch(spec: string | string[], fetchFn: typeof fetch = fetch, timeoutMs = 15_000): BtcFetch & { bases: string[] } {
  const bases = parseBases(spec);
  let first = 0;
  const f = async (path: string, init?: RequestInit) => {
    let last: unknown;
    for (let k = 0; k < bases.length; k++) {
      const i = (first + k) % bases.length;
      try {
        const r = await fetchFn(bases[i] + path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        if (r.status === 429 || r.status >= 500) { last = new Error(`${bases[i]}${path}: ${r.status}`); continue; }
        first = i;
        return r;
      } catch (e) { last = e; }
    }
    throw last instanceof Error ? last : new Error(String(last));
  };
  return Object.assign(f, { bases });
}
