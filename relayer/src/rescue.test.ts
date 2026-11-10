import { describe, expect, it } from "vitest";
import vectors from "../../web/src/vectors.json";
import { bech32 } from "@scure/base";
import { buildRescue, feeRateSatVb, scriptFromAddress } from "./rescue.js";

describe("rescue tool", () => {
  it("signs the exactly same exit transaction as the contract's reference (btc.rs build_rescue, checked by libbitcoinconsensus)", () => {
    const r = buildRescue(
      [{ txid: vectors.collateral_txid, vout: vectors.collateral_vout, value: BigInt(vectors.collateral_value_sats) }],
      Uint8Array.from(Buffer.from(vectors.witness_script, "hex")), Uint8Array.from(Buffer.from(vectors.to_script, "hex")),
      BigInt(vectors.rescue_fee_sats), vectors.unlock_s, Uint8Array.from(Buffer.from(vectors.rescue_private_key, "hex")),
    );
    expect(r.raw).toBe(vectors.rescue_raw);
  });
  it("takes Esplora's decimal fee estimates (rounded up) instead of crashing on BigInt(float)", () => {
    expect(feeRateSatVb(undefined, { "6": 1.003, "1": 4.2 })).toBe(2n);
    expect(feeRateSatVb(undefined, { "6": 0.4 })).toBe(1n);
    expect(feeRateSatVb(undefined, {})).toBe(5n);
    expect(feeRateSatVb(undefined, { "6": "garbage" })).toBe(5n);
    expect(feeRateSatVb("2.5", { "6": 99 })).toBe(3n);
    expect(() => feeRateSatVb("abc", {})).toThrow(/--fee-rate/);
  });
  it("refuses v0 addresses whose program is not 20 or 32 bytes (coins sent there are unspendable)", () => {
    const enc = (n: number) => bech32.encode("bcrt", [0, ...bech32.toWords(new Uint8Array(n).fill(7))], 90);
    expect(scriptFromAddress(enc(20), "bcrt").length).toBe(22);
    expect(scriptFromAddress(enc(32), "bcrt").length).toBe(34);
    for (const n of [2, 19, 21, 31, 33, 40]) expect(() => scriptFromAddress(enc(n), "bcrt"), `${n} bytes`).toThrow(/20 or 32 bytes/);
  });
});
