import { secp256k1 } from "@noble/curves/secp256k1.js";
import * as btc from "@scure/btc-signer";
import { describe, expect, it } from "vitest";
import { buildPayment } from "./faucet.js";

const key = new Uint8Array(32).fill(7);
const me = btc.getAddress("wpkh", key, btc.TEST_NETWORK)!;
const to = btc.getAddress("wpkh", new Uint8Array(32).fill(9), btc.TEST_NETWORK)!;
const utxo = (txid: string, value: number) => ({ txid, vout: 0, value, status: { confirmed: true } });

describe("faucet payment", () => {
  it("pays exactly the deposit amount to the deposit address, change back to the faucet, signed", () => {
    const { hex, fee } = buildPayment(key, btc.TEST_NETWORK, [utxo("11".repeat(32), 500_000), utxo("22".repeat(32), 30_000)], to, 200_000n, 3);
    const tx = btc.Transaction.fromRaw(Buffer.from(hex, "hex"));
    const outs = Array.from({ length: tx.outputsLength }, (_, i) => tx.getOutput(i));
    const addr = (o: any) => btc.Address(btc.TEST_NETWORK).encode(btc.OutScript.decode(o.script));
    const toOut = outs.filter((o) => addr(o) === to);
    expect(toOut.length).toBe(1);
    expect(toOut[0].amount).toBe(200_000n);
    expect(outs.filter((o) => addr(o) !== to).every((o) => addr(o) === me)).toBe(true);
    expect(fee! > 0n && fee! < 5_000n).toBe(true);
    expect(tx.isFinal).toBe(true);
    expect(secp256k1.getPublicKey(key, true).length).toBe(33);
  });
  it("refuses when the faucet cannot cover the payment", () => {
    expect(() => buildPayment(key, btc.TEST_NETWORK, [utxo("11".repeat(32), 10_000)], to, 200_000n, 3)).toThrow(/enough/);
  });
});
