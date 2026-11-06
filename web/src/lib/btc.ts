/**
 * Bitcoin data for the browser from the configured Esplora providers, in order (mempool.space, then
 * blockstream.info, …): unreachable, 429 and 5xx move on to the next one; any other answer is returned.
 * Same rule as the relayer's failoverFetch. Explorer links stay on CFG.explorerBtc.
 */
import { CFG } from "./near";

let first = 0;
const bases = () => CFG.esplora.split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);

export async function btcFetch(path: string, init?: RequestInit): Promise<Response> {
  const list = bases();
  let last: unknown = new Error("no Esplora configured");
  for (let k = 0; k < list.length; k++) {
    const i = (first + k) % list.length;
    try {
      const r = await fetch(list[i] + path, { ...init, signal: AbortSignal.timeout(15_000) });
      if (r.status === 429 || r.status >= 500) { last = new Error(`${list[i]}: ${r.status}`); continue; }
      first = i;
      return r;
    } catch (e) { last = e; }
  }
  throw last;
}

export const btcJson = async <T = any>(path: string): Promise<T> => { const r = await btcFetch(path); if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); };
export const btcText = async (path: string): Promise<string> => { const r = await btcFetch(path); if (!r.ok) throw new Error(`${path}: ${r.status}`); return (await r.text()).trim(); };
/** Display name of the provider list, for the Try page. */
export const btcProviders = () => bases().map((b) => new URL(b, location.href).host).join(" → ");
