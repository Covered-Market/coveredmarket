/**
 * Made-up offers for looking at the board while developing (`npm run dev`, then open `/?sample#/market`).
 * Loaded only by the dev server: production builds never include this file. The serials do not exist on any chain.
 */
import type { Offer } from "./verify";

export function sampleOffers(spot: number, nowS = Date.now() / 1000): Offer[] {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const base = spot > 0 ? spot : 72800;
  const at = (days: number) => (Math.floor(nowS / 86400) + days) * 86400 + 28800;
  const out: Offer[] = [];
  for (const days of [1, 3, 7, 14, 30]) {
    for (const above of [0.02, 0.04, 0.07, 0.1, 0.14, 0.2]) {
      const n = Math.max(0, Math.round(3.4 - above * 12 - Math.abs(days - 7) / 12 + rnd() * 1.6 - 0.6));
      for (let i = 0; i < n; i++) {
        const strike = Math.round((base * (1 + above + (rnd() - 0.5) * 0.012)) / 250) * 250;
        const sats = Math.round((10000 + rnd() * rnd() * 190000) / 1000) * 1000;
        // Roughly what a call that far out of the money, that long, would fetch; each seller a little off.
        const perBtc = base * 0.2 * Math.sqrt(days / 365) * Math.exp(-above / (0.55 * Math.sqrt(days / 365) + 0.02)) * (0.85 + rnd() * 0.4) + base * 0.0006;
        const serial = 900 + out.length;
        out.push({
          serial, seller: `sample-${(serial * 37) % 100}.testnet`, buyer: null, size_sats: String(sats), strike_units: String(strike * 1e6), strike_total_units: String(Math.ceil((sats * strike) / 100)),
          premium_units: String(Math.max(10000, Math.round((perBtc * sats) / 100))), expiry_s: String(at(days)), created_s: String(Math.floor(nowS - rnd() * 86400)), path: "", derived_pubkey: "",
          address: `tb1qsample${serial}xxxxxxxxxxxxxxxxxxxxxxxx${serial}`, refund_address: "", buyer_address: null, rescue_pubkey: "", unlock_s: "0", witness_script: "",
          collateral_txid: null, collateral_vout: null, collateral_value_sats: String(sats), commitment_reason: null, commitment_txid: null, commitment_sighash: null, commitment_to_address: null,
          commitment_amount_sats: null, committed_at_s: null, signed_tx: null, escrow_units: "0", state: "Funded",
        });
      }
    }
  }
  return out;
}
