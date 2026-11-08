import { describe, expect, it } from "vitest";
import vectors from "../vectors.json";
import { buildSpend, verifySignedTx } from "./bip143.js";
import { depositAddress, derivePubkey, hex, scriptFromAddress, addressFromScript, scriptNum } from "./derive.js";

describe("derivation matches the contract", () => {
  it("derives the same key, deposit script (with the seller's exit) and P2WSH address", () => {
    const pk = derivePubkey(vectors.root_key_hex, vectors.prefix, vectors.predecessor, vectors.path);
    expect(hex.to(pk)).toBe(vectors.derived_pubkey);
    expect(vectors.unlock_s).toBe(vectors.expiry_s + vectors.grace_s + vectors.rescue_delay_s);
    const d = depositAddress(vectors.root_key_hex, vectors.prefix, vectors.predecessor, vectors.path, hex.from(vectors.rescue_pubkey), vectors.unlock_s, "Regtest");
    expect(hex.to(d.witnessScript)).toBe(vectors.witness_script);
    expect(d.address).toBe(vectors.address_regtest);
    expect(hex.to(scriptFromAddress(d.address, "Regtest"))).toBe(vectors.collateral_script);
  });
  it("script numbers are minimal", () => {
    expect(hex.to(scriptNum(0x7f))).toBe("7f");
    expect(hex.to(scriptNum(0x80))).toBe("8000");
    expect(hex.to(scriptNum(1_800_000_000))).toBe("00d2496b");
  });
  it("a different predecessor (the operator) gets a different key", () => {
    expect(hex.to(derivePubkey(vectors.root_key_hex, vectors.prefix, "coveredmarket-ops.test", vectors.path))).not.toBe(vectors.derived_pubkey);
  });
  it("bech32 round trip", () => {
    const s = scriptFromAddress(vectors.address_regtest, "Regtest");
    expect(addressFromScript(s, "Regtest")).toBe(vectors.address_regtest);
    expect(() => scriptFromAddress(vectors.address_regtest, "Mainnet")).toThrow();
  });
});

describe("derivation matches the live testnet signer", () => {
  it("v1.signer-prod.testnet derived_public_key(probe/CV-1, covered-probe.testnet)", async () => {
    const { base58 } = await import("@scure/base");
    const want = "04" + hex.to(base58.decode("5g57Q1tvBYESE2hT4BD9dP7X7uUri9LA5XYuhMZG1LjPH73MrMnyMZhAsaXtonLXwc2TCYkAgdBj4kZNmKXK9s7M"));
    const got = derivePubkey("secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3", vectors.prefix, "covered-probe.testnet", "probe/CV-1");
    const secp = await import("@noble/secp256k1");
    expect(hex.to(secp.ProjectivePoint.fromHex(hex.to(got)).toRawBytes(false))).toBe(want);
  });
});

describe("BIP-143 matches the contract", () => {
  it("rebuilds the unsigned tx, txid and sighash", () => {
    const r = buildSpend({
      collateralTxid: vectors.collateral_txid, vout: vectors.collateral_vout, valueSats: BigInt(vectors.collateral_value_sats),
      witnessScript: hex.from(vectors.witness_script), toScript: hex.from(vectors.to_script), feeSats: BigInt(vectors.fee_sats),
    });
    expect(r.unsignedHex).toBe(vectors.unsigned_tx);
    expect(r.txid).toBe(vectors.txid);
    expect(r.sighash).toBe(vectors.sighash);
  });
  it("accepts the contract's signed settlement (MPC branch of the deposit script)", () => {
    expect(verifySignedTx(vectors.signed_tx, vectors.sighash, hex.from(vectors.derived_pubkey), hex.from(vectors.witness_script))).toEqual({ ok: true });
  });
  it("rejects it against another key, another script or another sighash", () => {
    const ws = hex.from(vectors.witness_script);
    expect(verifySignedTx(vectors.signed_tx, vectors.sighash, hex.from("02" + "44".repeat(32)), ws).ok).toBe(false);
    const other = ws.slice(); other[other.length - 3] ^= 1;
    expect(verifySignedTx(vectors.signed_tx, vectors.sighash, hex.from(vectors.derived_pubkey), other).ok).toBe(false);
    expect(verifySignedTx(vectors.signed_tx, "00".repeat(32), hex.from(vectors.derived_pubkey), ws).ok).toBe(false);
  });
});
