import { describe, expect, it } from "vitest";
import vectors from "../../web/src/vectors.json";
import { buildRescue } from "./rescue.js";

describe("rescue tool", () => {
  it("signs the exactly same exit transaction as the contract's reference (btc.rs build_rescue, checked by libbitcoinconsensus)", () => {
    const r = buildRescue(
      [{ txid: vectors.collateral_txid, vout: vectors.collateral_vout, value: BigInt(vectors.collateral_value_sats) }],
      Uint8Array.from(Buffer.from(vectors.witness_script, "hex")), Uint8Array.from(Buffer.from(vectors.to_script, "hex")),
      BigInt(vectors.rescue_fee_sats), vectors.unlock_s, Uint8Array.from(Buffer.from(vectors.rescue_private_key, "hex")),
    );
    expect(r.raw).toBe(vectors.rescue_raw);
  });
});
