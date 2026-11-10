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
  btc: { outspend: async () => ({ spent: false }), output: async (id, vout) => (id === vectors.collateral_txid && vout === vectors.collateral_vout ? { address: vectors.address_regtest, value: vectors.collateral_value_sats } : null), txStatus: async (id) => (id === vectors.collateral_txid ? { confirmed: true, depth: 9 } : id === vectors.txid ? { confirmed: true, depth: 1 } : null) },
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
    const surplus = await runChecks(clients({}, "5"), good, params, 0);
    expect(surplus[3].status, "USDC sent straight to the contract (no ft_on_transfer) is a surplus, not a failure").toBe("verified");
    const short = clients({}, "5"); short.near.view = async () => ({ claimable_total: "9", escrow_total: "0", near_balance: "1" }) as any;
    expect((await runChecks(short, good, params, 0))[3].status, "owing more than it holds").toBe("failed");
    expect((await runChecks(clients(), { ...good, commitment_reason: "Expiry", committed_at_s: String(vectors.expiry_s) }, params, 0))[4].status).toBe("failed");
    expect((await runChecks(clients(), { ...good, rescue_pubkey: "02" + "44".repeat(32) }, params, 0))[1].status, "a different rescue key is a different address").toBe("failed");
    expect((await runChecks(clients(), { ...good, unlock_s: String(vectors.unlock_s - 1) }, params, 0))[1].status, "the exit must unlock exactly expiry + grace + delay").toBe("failed");
    expect((await runChecks(clients(), { ...good, commitment_sighash: "00".repeat(32) }, params, 0))[5].status).toBe("failed");
    expect((await runChecks(clients(), { ...good, signed_tx: "deadbeef" }, params, 0))[5].status).toBe("failed");
    const otherRoot = clients(); otherRoot.near.signerRootKey = async () => "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"; // a valid key, not the contract's
    expect((await runChecks(otherRoot, good, params, 0))[1].status, "a root key that is not the signer's own").toBe("failed");
    const mockSpelling = clients(); mockSpelling.near.signerRootKey = async () => "secp256k1-hex:" + vectors.root_key_hex; // how the local mock signer reports it
    expect((await runChecks(mockSpelling, good, params, 0))[1].status, "the mock signer's spelling of the same key").toBe("verified");
    const noSigner = clients(); noSigner.near.signerRootKey = async () => { throw new Error("signer unreachable"); };
    expect((await runChecks(noSigner, good, params, 0))[1].status, "never green without reading the signer").toBe("unavailable");
    const rescued = clients(); rescued.btc.outspend = async () => ({ spent: true, txid: "sweep" });
    const r = await runChecks(rescued, { ...good, state: "Rescued" }, params, 0);
    expect([r[2].status, r[6].status]).toEqual(["verified", "verified"]);
    expect((await runChecks(clients(), { ...good, state: "Rescued" }, params, 0))[2].status, "rescued but unspent on Bitcoin").toBe("failed");
    const unseen = clients(); unseen.btc.txStatus = async (id) => (id === vectors.collateral_txid ? { confirmed: true, depth: 9 } : null);
    expect((await runChecks(unseen, good, params, 0))[6].status).toBe("failed");
  });
  it("never shows verified for a state the chain or the record contradicts", async () => {
    const d = await import("./derive.js");
    const to = d.addressFromScript(d.hex.from(vectors.to_script), "Regtest");
    const good = { ...offer, commitment_to_address: to, refund_address: to };
    const at = (r: Awaited<ReturnType<typeof runChecks>>, n: number) => r[n - 1].status;
    // check 3: the recorded output must be the deposit
    const elsewhere = clients(); elsewhere.btc.output = async () => ({ address: "bcrt1qsomeoneelse", value: vectors.collateral_value_sats });
    expect(at(await runChecks(elsewhere, good, params, 0), 3), "output pays another address").toBe("failed");
    const short = clients(); short.btc.output = async () => ({ address: vectors.address_regtest, value: 1 });
    expect(at(await runChecks(short, good, params, 0), 3), "output holds another amount").toBe("failed");
    expect(at(await runChecks(clients(), { ...good, size_sats: "100000000" }, params, 0), 3), "recorded value is not the offer's size").toBe("failed");
    expect(at(await runChecks(clients(), { ...good, state: "Withdrawn" }, params, 0), 3), "settled, but the coins never moved").toBe("failed");
    const byPrior = clients(); byPrior.btc.outspend = async () => ({ spent: true, txid: "v1" });
    expect(at(await runChecks(byPrior, { ...good, state: "Committed", prior_txids: ["v1"] }, params, 0), 3), "an earlier signed version may spend it while the bump is re-signed").toBe("verified");
    // check 5: state, commitment, buyer and escrow agree
    expect(at(await runChecks(clients(), { ...good, state: "Exercised" }, params, 0), 5), "Exercised on a Withdraw commitment").toBe("failed");
    expect(at(await runChecks(clients(), { ...good, state: "Committed", commitment_reason: null }, params, 0), 5), "Committed without a commitment").toBe("failed");
    expect(at(await runChecks(clients(), { ...good, state: "Funded" }, params, 0), 5), "Funded with a commitment").toBe("failed");
    expect(at(await runChecks(clients(), { ...good, buyer: "mallory" }, params, 0), 5), "withdrawn as unsold, with a buyer").toBe("failed");
    expect(at(await runChecks(clients(), { ...offer, state: "Sold", commitment_reason: null, commitment_txid: null, signed_tx: null }, params, 0), 5), "Sold without a buyer").toBe("failed");
    expect(at(await runChecks(clients(), { ...good, escrow_units: "1" }, params, 0), 5), "escrow on a withdrawal").toBe("failed");
    // check 6: a state that needs a commitment or a signature must have it; the fee stays under the cap
    expect(at(await runChecks(clients(), { ...good, state: "Kept", commitment_txid: null }, params, 0), 6)).toBe("failed");
    expect(at(await runChecks(clients(), { ...good, signed_tx: null }, params, 0), 6), "Signed without a signed transaction").toBe("failed");
    expect(at(await runChecks(clients(), good, { ...params, max_fee_sats: 999 }, 0), 6), "fee above the cap").toBe("failed");
    // check 7: a settled offer's transaction must be confirmed deep enough
    const shallow = clients(); shallow.btc.outspend = async () => ({ spent: true, txid: vectors.txid });
    expect(at(await runChecks(shallow, { ...good, state: "Withdrawn" }, params, 0), 7), "Withdrawn on a 1-confirmation spend").toBe("failed");
    const unseen = clients(); unseen.btc.txStatus = async (id) => (id === vectors.collateral_txid ? { confirmed: true, depth: 9 } : null);
    expect(at(await runChecks(unseen, { ...good, state: "Withdrawn", signed_tx: null }, params, 0), 7), "Withdrawn, never seen on Bitcoin").toBe("failed");
  });
  it("reports unavailable when an RPC is down", async () => {
    const down = clients(); down.near.codeHash = async () => { throw new Error("rpc timeout"); };
    expect((await runChecks(down, offer, params, 0))[0]).toMatchObject({ status: "unavailable", detail: "rpc timeout" });
  });
});
