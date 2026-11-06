/**
 * Expiry choices the contract will accept: each is the first point on its expiry grid (every `expiry_step_s`
 * from `expiry_offset_s`, e.g. 08:00 UTC daily on mainnet, any minute on testnet) at least `min_lead_s` away.
 */
export function expiryChoices(p: { min_lead_s?: number; expiry_step_s?: number; expiry_offset_s?: number } | null, nowS = Date.now() / 1000) {
  const lead = p?.min_lead_s ?? 86400, step = p?.expiry_step_s ?? 86400, off = p?.expiry_offset_s ?? 28800;
  const wanted = lead < 3600 ? [600, 1800, 7200, 86400, 7 * 86400] : [86400, 2 * 86400, 7 * 86400, 14 * 86400, 30 * 86400, 56 * 86400];
  const out: { at: number; label: string }[] = [];
  for (const w of wanted) {
    const at = Math.ceil((nowS + Math.max(w, lead) + 60 - off) / step) * step + off; // +60 s: room for the transaction to land
    if (out.some((o) => o.at === at)) continue;
    const away = at - nowS;
    const label = away < 3 * 3600 ? `in ${Math.round(away / 60)} min` : away < 86400 * 1.5 && step < 86400 ? `in ${Math.round(away / 3600)} hours` : new Date(at * 1000).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    out.push({ at, label });
  }
  return out;
}
