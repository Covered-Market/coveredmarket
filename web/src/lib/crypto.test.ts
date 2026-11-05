import { describe, expect, it } from "vitest";
import vectors from "../vectors.json";
import { buildSpend, verifySignedTx } from "./bip143.js";
import { deriveAddress, derivePubkey, hex, scriptFromAddress, addressFromScript } from "./derive.js";

describe("derivation matches the contract", () => {
  it("derives the same pubkey and address", () => {
    const pk = derivePubkey(vectors.root_key_hex, vectors.prefix, vectors.predecessor, vectors.path);
    expect(hex.to(pk)).toBe(vectors.derived_pubkey);
    expect(deriveAddress(vectors.root_key_hex, vectors.prefix, vectors.predecessor, vectors.path, "Regtest")).toBe(vectors.address_regtest);
  });
  it("a different predecessor (the operator) gets a different key", () => {
    expect(hex.to(derivePubkey(vectors.root_key_hex, vectors.prefix, "covered-ops.test", vectors.path))).not.toBe(vectors.derived_pubkey);
  });
  it("bech32 round trip", () => {
    const s = scriptFromAddress(vectors.address_regtest, "Regtest");
    expect(addressFromScript(s, "Regtest")).toBe(vectors.address_regtest);
    expect(() => scriptFromAddress(vectors.address_regtest, "Mainnet")).toThrow();
  });
});

describe("BIP-143 matches the contract", () => {
  it("rebuilds the unsigned tx, txid and sighash", () => {
    const r = buildSpend({
      collateralTxid: vectors.collateral_txid, vout: vectors.collateral_vout, valueSats: BigInt(vectors.collateral_value_sats),
      collateralScript: hex.from(vectors.collateral_script), toScript: hex.from(vectors.to_script), feeSats: BigInt(vectors.fee_sats),
    });
    expect(r.unsignedHex).toBe(vectors.unsigned_tx);
    expect(r.txid).toBe(vectors.txid);
    expect(r.sighash).toBe(vectors.sighash);
  });
  it("rejects a witness with the wrong key", () => {
    const fake = "02000000" + "0001" + "01" + "11".repeat(32) + "00000000" + "00" + "ffffffff" + "01" + "e803000000000000" + "16" + "0014" + "22".repeat(20) + "02" + "03" + "aabb01" + "21" + "02" + "33".repeat(32) + "00000000";
    expect(verifySignedTx(fake, "00".repeat(32), hex.from("02" + "44".repeat(32))).ok).toBe(false);
  });
});
