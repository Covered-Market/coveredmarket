/**
 * The seller's exit. Each offer's deposit address also contains a branch only the seller's own rescue key can
 * use, after `unlock_s` (expiry + grace + the deployment's rescue delay), with no NEAR involved. The key is made
 * here, in the browser; the kit (a JSON file) holds everything needed to sweep the coins with nothing but
 * Bitcoin: `bin/covered rescue kit.json <address>`. Kits are also kept in this browser so they can be
 * downloaded again from the contract page.
 */
import * as secp from "@noble/secp256k1";
import { base58 } from "@scure/base";
import { hex, sha256d } from "./derive";
import { CFG } from "./near";

export interface RescueKit {
  kind: "covered-rescue-kit"; version: 1;
  bitcoin_network: "mainnet" | "testnet3" | "regtest"; hrp: string; contract: string; near_network: string;
  serial: number; address: string; witness_script: string; unlock_s: number; unlock_utc: string; size_sats: string;
  rescue_private_key_wif: string; rescue_public_key: string; refund_address: string; explorer: string;
  how_to: string[];
}

export function newRescueKey() {
  const priv = secp.utils.randomPrivateKey();
  return { priv, pub33: secp.getPublicKey(priv, true) };
}

export function toWif(priv: Uint8Array, mainnet: boolean): string {
  const body = new Uint8Array([mainnet ? 0x80 : 0xef, ...priv, 0x01]);
  return base58.encode(new Uint8Array([...body, ...sha256d(body).slice(0, 4)]));
}

export function makeKit(offer: { serial: number; address: string; witness_script: string; unlock_s: string; size_sats: string; refund_address: string; rescue_pubkey: string }, priv: Uint8Array): RescueKit {
  const main = CFG.mode === "mainnet";
  const unlock = Number(offer.unlock_s);
  const pub = hex.to(secp.getPublicKey(priv, true));
  if (pub !== offer.rescue_pubkey) throw new Error("this key is not the offer's rescue key");
  return {
    kind: "covered-rescue-kit", version: 1,
    bitcoin_network: main ? "mainnet" : CFG.mode === "local" ? "regtest" : "testnet3",
    hrp: offer.address.slice(0, offer.address.lastIndexOf("1")), contract: CFG.contract, near_network: CFG.network,
    serial: offer.serial, address: offer.address, witness_script: offer.witness_script, unlock_s: unlock,
    unlock_utc: new Date(unlock * 1000).toISOString(), size_sats: offer.size_sats,
    rescue_private_key_wif: toWif(priv, main), rescue_public_key: pub, refund_address: offer.refund_address,
    explorer: `${CFG.explorerBtc}/address/${offer.address}`,
    how_to: [
      "You only need this if NEAR or its signing network stops and your contract can no longer settle.",
      `After ${new Date(unlock * 1000).toUTCString()} your rescue key alone can move the coins at ${offer.address}.`,
      "Run: bin/covered rescue <this file> <your bitcoin address>  (from the Covered repository; needs only a Bitcoin node or a public Esplora API).",
      "Keep this file private: it contains a private key. Before the unlock time it can do nothing.",
    ],
  };
}

const key = (serial: number) => `covered.rescue.${CFG.contract}.${serial}`;
export function storeKit(kit: RescueKit) { try { localStorage.setItem(key(kit.serial), JSON.stringify({ kit, downloaded: false })); } catch {} }
export function loadKit(serial: number): { kit: RescueKit; downloaded: boolean } | null { try { return JSON.parse(localStorage.getItem(key(serial)) ?? "null"); } catch { return null; } }
export function downloadKit(kit: RescueKit) {
  const blob = new Blob([JSON.stringify(kit, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `covered-rescue-kit-CV-${kit.serial}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  try { localStorage.setItem(key(kit.serial), JSON.stringify({ kit, downloaded: true })); } catch {}
}
