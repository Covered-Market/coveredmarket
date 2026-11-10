/** Bitcoin keys for agents: a receive address, and the seller's rescue key and kit (same format as the web app's). */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { sha256 } from "@noble/hashes/sha256";
import { base58, bech32 } from "@scure/base";

export const hex = { to: (b: Uint8Array) => Buffer.from(b).toString("hex"), from: (h: string) => Uint8Array.from(Buffer.from(h, "hex")) };
const sha256d = (b: Uint8Array) => sha256(sha256(b));

export function newKey() {
  const priv = secp256k1.utils.randomSecretKey();
  return { priv, pub33: secp256k1.getPublicKey(priv, true) };
}
export const pubOf = (priv: Uint8Array) => secp256k1.getPublicKey(priv, true);

/** A P2WPKH address (bc1q / tb1q / bcrt1q) for a compressed public key. */
export function p2wpkh(pub33: Uint8Array, hrp: string): string {
  const prog = ripemd160(sha256(pub33));
  return bech32.encode(hrp, [0, ...bech32.toWords(prog)]);
}

export function toWif(priv: Uint8Array, mainnet: boolean): string {
  const body = new Uint8Array([mainnet ? 0x80 : 0xef, ...priv, 0x01]);
  return base58.encode(new Uint8Array([...body, ...sha256d(body).slice(0, 4)]));
}

export interface RescueKit {
  kind: "coveredmarket-rescue-kit"; version: 1;
  bitcoin_network: "mainnet" | "testnet3" | "regtest"; hrp: string; contract: string; near_network: string;
  serial: number; address: string; witness_script: string; unlock_s: number; unlock_utc: string; size_sats: string;
  rescue_private_key_wif: string; rescue_public_key: string; refund_address: string; explorer: string;
  how_to: string[];
}

/** The kit `bin/coveredmarket rescue` reads. Throws if `priv` is not the offer's rescue key. */
export function makeKit(
  offer: { serial: number; address: string; witness_script: string; unlock_s: string; size_sats: string; refund_address: string; rescue_pubkey: string },
  priv: Uint8Array,
  site: { mode: string; contract: string; network: string; explorerBtc: string },
): RescueKit {
  const main = site.mode === "mainnet";
  const pub = hex.to(pubOf(priv));
  if (pub !== offer.rescue_pubkey) throw new Error("this key is not the offer's rescue key");
  const unlock = Number(offer.unlock_s);
  const when = new Date(unlock * 1000);
  return {
    kind: "coveredmarket-rescue-kit", version: 1,
    bitcoin_network: main ? "mainnet" : site.mode === "local" ? "regtest" : "testnet3",
    hrp: offer.address.slice(0, offer.address.lastIndexOf("1")), contract: site.contract, near_network: site.network,
    serial: offer.serial, address: offer.address, witness_script: offer.witness_script, unlock_s: unlock,
    unlock_utc: when.toISOString(), size_sats: offer.size_sats,
    rescue_private_key_wif: toWif(priv, main), rescue_public_key: pub, refund_address: offer.refund_address,
    explorer: `${site.explorerBtc}/address/${offer.address}`,
    how_to: [
      "You only need this if NEAR or its signing network stops and your contract can no longer settle.",
      `After ${when.toUTCString()} your rescue key alone can move the coins at ${offer.address}.`,
      "Run: bin/coveredmarket rescue <this file> <your bitcoin address>  (from the CoveredMarket repository; needs only a Bitcoin node or a public Esplora API).",
      "Keep this file private: it contains a private key. Before the unlock time it can do nothing.",
    ],
  };
}
