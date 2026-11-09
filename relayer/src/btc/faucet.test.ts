import { secp256k1 } from "@noble/curves/secp256k1.js";
import * as btc from "@scure/btc-signer";
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPayment, esploraFaucet } from "./faucet.js";

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
  it("a second payment right after the first spends the first one's change, never the same input again", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "faucet-")), "k"); writeFileSync(file, Buffer.from(key).toString("hex"));
    const sent: string[] = [];
    // A lagging backend: it keeps reporting the original coin as unspent and never shows the change.
    const get = async (path: string, init?: RequestInit) => {
      if (path.endsWith("/utxo")) return new Response(JSON.stringify([utxo("11".repeat(32), 500_000)]));
      if (path === "/fee-estimates") return new Response(JSON.stringify({ "3": 2 }));
      if (path === "/tx") { const h = String(init!.body); sent.push(h); return new Response(btc.Transaction.fromRaw(Buffer.from(h, "hex")).id); }
      return new Response("", { status: 404 });
    };
    const f = esploraFaucet(file, get as any);
    const [a, b] = await Promise.all([f.pay(to, 100_000n), f.pay(to, 100_000n)]);
    expect(a).not.toBe(b);
    const ins = sent.map((h) => { const t = btc.Transaction.fromRaw(Buffer.from(h, "hex")); return Array.from({ length: t.inputsLength }, (_, i) => `${Buffer.from(t.getInput(i).txid!).toString("hex")}:${t.getInput(i).index}`); });
    expect(ins[0]).toEqual([`${"11".repeat(32)}:0`]);
    expect(ins[1].length).toBe(1);
    expect(ins[1][0].startsWith(a)).toBe(true);
  });
});
