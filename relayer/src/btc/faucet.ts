/**
 * Demo faucet for testnet Bitcoin: a P2WPKH wallet whose key lives on the server (generated on first start,
 * kept in a file on a Docker volume). It only ever pays the deposit address of an offer of *our* contract that
 * is still waiting for its deposit, exactly the offer's size, capped and rate-limited. Testnet only; on mainnet
 * this module is never constructed.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import * as btc from "@scure/btc-signer";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BtcFetch } from "./failover.js";

export interface FaucetWallet { address: string; pay(to: string, sats: bigint): Promise<string>; balance(): Promise<{ confirmed: bigint; unconfirmed: bigint }> }

export function loadOrCreateKey(file: string): Uint8Array {
  if (existsSync(file)) return Uint8Array.from(Buffer.from(readFileSync(file, "utf8").trim(), "hex"));
  const k = btc.utils.randomPrivateKeyBytes();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(k).toString("hex"), { mode: 0o600 });
  return k;
}

type Utxo = { txid: string; vout: number; value: number; status: { confirmed: boolean } };

/** Build and sign a payment of exactly `sats` to `to` with change back to the faucet. Pure: no network. */
export function buildPayment(key: Uint8Array, network: typeof btc.TEST_NETWORK, utxos: Utxo[], to: string, sats: bigint, feeRate: number) {
  const pay = btc.p2wpkh(secp256k1.getPublicKey(key, true), network);
  const sel = btc.selectUTXO(
    utxos.map((u) => ({ txid: u.txid, index: u.vout, witnessUtxo: { script: pay.script, amount: BigInt(u.value) } })),
    [{ address: to, amount: sats }],
    "default",
    { changeAddress: pay.address!, feePerByte: BigInt(Math.max(1, Math.ceil(feeRate))), bip69: false, createTx: true, network },
  );
  if (!sel || !sel.tx) throw new Error("the faucet does not hold enough testnet coins right now");
  sel.tx.sign(key);
  sel.tx.finalize();
  return { hex: sel.tx.hex, txid: sel.tx.id, fee: sel.fee };
}

export function esploraFaucet(keyFile: string, get: BtcFetch, network = btc.TEST_NETWORK): FaucetWallet {
  const key = loadOrCreateKey(keyFile);
  const address = btc.getAddress("wpkh", key, network)!;
  const utxos = async (): Promise<Utxo[]> => { const r = await get(`/address/${address}/utxo`); if (!r.ok) throw new Error(`utxo ${r.status}`); return r.json(); };
  return {
    address,
    async balance() {
      const u = await utxos();
      return { confirmed: u.filter((x) => x.status.confirmed).reduce((a, x) => a + BigInt(x.value), 0n), unconfirmed: u.filter((x) => !x.status.confirmed).reduce((a, x) => a + BigInt(x.value), 0n) };
    },
    async pay(to, sats) {
      const fees = await get(`/fee-estimates`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
      const rate = Math.min(50, Math.max(1, Number((fees as any)["3"] ?? (fees as any)["6"] ?? 2)));
      const { hex } = buildPayment(key, network, await utxos(), to, sats, rate);
      const r = await get(`/tx`, { method: "POST", body: hex });
      const text = (await r.text()).trim();
      if (!r.ok) throw new Error(`broadcast refused: ${text.slice(0, 200)}`);
      return text;
    },
  };
}
