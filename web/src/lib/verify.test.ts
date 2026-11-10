import { describe, expect, it } from "vitest";
import vectors from "../vectors.json";
import { runChecks, type Clients, type Offer, type Params } from "./verify.js";

const params: Params = { signer: "signer.test", light_client: "btc.test", usdc: "usdc.test", network: "Regtest", fee_sats: 1000, grace_s: 7200, rescue_delay_s: vectors.rescue_delay_s, mpc_root_key: vectors.root_key_hex, derivation_prefix: vectors.prefix };
const offer: Offer = {
  serial: 1, seller: "bob", buyer: null, size_sats: "200000000", strike_units: "150000000000", strike_total_units: "300000000000", premium_units: "6000000000",
  expiry_s: String(vectors.expiry_s), path: vectors.path, derived_pubkey: vectors.derived_pubkey, address: vectors.address_regtest, refund_address: "bcrt1q" + "q".repeat(38), buyer_address: null,
  rescue_pubkey: vectors.rescue_pubkey, unlock_s: String(vectors.unlock_s), witness_script: vectors.witness_script, commitment_fee_sats: "1000", prior_txids: [],
  collateral_txid: vectors.collateral_txid, collateral_vout: vectors.collateral_vout, collateral_value_sats: String(vectors.collateral_value_sats),
  commitment_reason: "Withdraw", commitment_txid: vectors.txid, commitment_sighash: vectors.sighash, commitment_to_address: null, commitment_amount_sats: "199999000", committed_at_s: "1800000200", signed_tx: vectors.signed_tx, escrow_units: "0", state: "Signed",
};
const clients = (over: Partial<Clients["expected"]> = {}, bal = "0"): Clients => ({
  near: { codeHash: async () => "abc", accessKeys: async () => 0, view: async () => ({ claimable_total: "0", escrow_total: "0", near_balance: "1" }) as any, ftBalance: async () => bal, signerRootKey: async () => vectors.root_key_hex },
  btc: { outspend: async () => ({ spent: false }), txStatus: async (id) => (id === vectors.collateral_txid ? { confirmed: true, depth: 9 } : id === vectors.txid ? { confirmed: true, depth: 1 } : null) },
  expected: { codeHash: "abc", contract: "coveredmarket.test", signer: "signer.test", lightClient: "btc.test", usdc: "usdc.test", minConf: 6, ...over },
});

describe("verify checks", () => {
  it("passes on consistent data", async () => {
    const d = await import("./derive.js");
    const to = d.addressFromScript(d.hex.from(vectors.to_script), "Regtest");
    const r = await runChecks(clients(), { ...offer, commitment_to_address: to, refund_address: to }, params, 1800000300);
    expect(r.map((x) => x.status)).toEqual(["verified", "verified", "verified", "verified", "verified", "verified", "verified"]);
  });
  it("flips each check to failed when tampered", async () => {
    const to = (await import("./derive.js")).addressFromScript((await import("./derive.js")).hex.from(vectors.to_script), "Regtest");
    const good = { ...offer, commitment_to_address: to, refund_address: to };
    expect((await runChecks(clients({ codeHash: "other" }), good, params, 0))[0].status).toBe("failed");
    expect((await runChecks(clients(), { ...good, path: "mallory/CV-1" }, params, 0))[1].status).toBe("failed");
    const spent = clients(); spent.btc.outspend = async () => ({ spent: true, txid: "x" });
    expect((await runChecks(spent, { ...good, state: "Funded" }, params, 0))[2].status).toBe("failed");
    expect((await runChecks(clients({}, "5"), good, params, 0))[3].status).toBe("failed");
    expect((await runChecks(clients(), { ...good, commitment_reason: "Expiry", committed_at_s: String(vectors.expiry_s) }, params, 0))[4].status).toBe("failed");
    expect((await runChecks(clients(), { ...good, rescue_pubkey: "02" + "44".repeat(32) }, params, 0))[1].status, "a different rescue key is a different address").toBe("failed");
    expect((await runChecks(clients(), { ...good, unlock_s: String(vectors.unlock_s - 1) }, params, 0))[1].status, "the exit must unlock exactly expiry + grace + delay").toBe("failed");
    expect((await runChecks(clients(), { ...good, commitment_sighash: "00".repeat(32) }, params, 0))[5].status).toBe("failed");
    expect((await runChecks(clients(), { ...good, signed_tx: "deadbeef" }, params, 0))[5].status).toBe("failed");
    const otherRoot = clients(); otherRoot.near.signerRootKey = async () => "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"; // a valid key, not the contract's
    expect((await runChecks(otherRoot, good, params, 0))[1].status, "a root key that is not the signer's own").toBe("failed");
    const noSigner = clients(); noSigner.near.signerRootKey = async () => { throw new Error("signer unreachable"); };
    expect((await runChecks(noSigner, good, params, 0))[1].status, "never green without reading the signer").toBe("unavailable");
    const rescued = clients(); rescued.btc.outspend = async () => ({ spent: true, txid: "sweep" });
    const r = await runChecks(rescued, { ...good, state: "Rescued" }, params, 0);
    expect([r[2].status, r[6].status]).toEqual(["verified", "verified"]);
    expect((await runChecks(clients(), { ...good, state: "Rescued" }, params, 0))[2].status, "rescued but unspent on Bitcoin").toBe("failed");
    const unseen = clients(); unseen.btc.txStatus = async (id) => (id === vectors.collateral_txid ? { confirmed: true, depth: 9 } : null);
    expect((await runChecks(unseen, good, params, 0))[6].status).toBe("failed");
  });
  it("reports unavailable when an RPC is down", async () => {
    const down = clients(); down.near.codeHash = async () => { throw new Error("rpc timeout"); };
    expect((await runChecks(down, offer, params, 0))[0]).toMatchObject({ status: "unavailable", detail: "rpc timeout" });
  });
});
