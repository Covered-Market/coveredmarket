import { describe, expect, it } from "vitest";
import { viewAll } from "./run.js";
import { plan, type OfferView } from "./watcher.js";

const params = { min_conf: 6, grace_s: 7200 };
const base: OfferView = { serial: 1, state: "Created", address: "bcrt1qaddr", size_sats: "200000000", expiry_s: "1000000" };

describe("watcher plan", () => {
  it("submits a deposit proof only at depth", () => {
    expect(plan([base], params, { depositsAt: { bcrt1qaddr: [{ txid: "t", depth: 5 }] }, depthOf: {} }, 0)).toEqual([]);
    expect(plan([base], params, { depositsAt: { bcrt1qaddr: [{ txid: "t", depth: 6 }] }, depthOf: {} }, 0)).toEqual([{ kind: "confirm_deposit", serial: 1, txid: "t" }]);
  });
  it("settles only after the window", () => {
    const sold = { ...base, state: "Sold" };
    expect(plan([sold], params, { depositsAt: {}, depthOf: {} }, 1000000 + 7199)).toEqual([]);
    expect(plan([sold], params, { depositsAt: {}, depthOf: {} }, 1000000 + 7200)).toEqual([{ kind: "settle", serial: 1 }]);
  });
  it("retries signatures when due, broadcasts then confirms", () => {
    const c = { ...base, state: "Committed", retry_after_s: "50" };
    expect(plan([c], params, { depositsAt: {}, depthOf: {} }, 49)).toEqual([]);
    expect(plan([c], params, { depositsAt: {}, depthOf: {} }, 50)).toEqual([{ kind: "request_signature", serial: 1 }]);
    const s = { ...base, state: "Signed", commitment_txid: "ctx", signed_tx: "beef" };
    expect(plan([s], params, { depositsAt: {}, depthOf: {} }, 0)).toEqual([{ kind: "broadcast", serial: 1, raw: "beef" }]);
    expect(plan([s], params, { depositsAt: {}, depthOf: { ctx: 0 } }, 0)).toEqual([]);
    expect(plan([s], params, { depositsAt: {}, depthOf: { ctx: 6 } }, 0)).toEqual([{ kind: "confirm_spend", serial: 1, txid: "ctx" }]);
  });
  it("proves whichever committed version confirmed, including an earlier one", () => {
    const s = { ...base, state: "Signed", commitment_txid: "v2", prior_txids: ["v1"], signed_tx: "beef", collateral_txid: "c", collateral_vout: 1 };
    expect(plan([s], params, { depositsAt: {}, depthOf: { v2: undefined }, spentBy: { 1: { txid: "v1", depth: 6 } } }, 0)).toEqual([{ kind: "confirm_spend", serial: 1, txid: "v1" }]);
    expect(plan([{ ...s, state: "Committed", retry_after_s: "0" }], params, { depositsAt: {}, depthOf: {}, spentBy: { 1: { txid: "v1", depth: 6 } } }, 0)).toEqual([{ kind: "confirm_spend", serial: 1, txid: "v1" }]);
    expect(plan([s], params, { depositsAt: {}, depthOf: {}, spentBy: { 1: { txid: "v1", depth: 2 } } }, 0)).toEqual([], "waits for depth, does not rebroadcast or bump");
  });
  it("proves the seller's rescue when the collateral was spent by something never committed", () => {
    const s = { ...base, state: "Signed", commitment_txid: "v2", prior_txids: ["v1"], signed_tx: "beef", collateral_txid: "c", collateral_vout: 1 };
    expect(plan([s], params, { depositsAt: {}, depthOf: {}, spentBy: { 1: { txid: "sweep", depth: 6 } } }, 0)).toEqual([{ kind: "confirm_rescue", serial: 1, txid: "sweep" }]);
    expect(plan([s], params, { depositsAt: {}, depthOf: {}, spentBy: { 1: { txid: "sweep", depth: 5 } } }, 0)).toEqual([], "waits for depth; nothing left to sign or broadcast");
    expect(plan([{ ...s, state: "Committed", retry_after_s: "0" }], params, { depositsAt: {}, depthOf: {}, spentBy: { 1: { txid: "sweep", depth: 6 } } }, 0)).toEqual([{ kind: "confirm_rescue", serial: 1, txid: "sweep" }]);
  });
  it("bumps the fee of a settlement stuck in the mempool, up to the cap", () => {
    const p = { ...params, fee_bump_after_s: 3600, max_fee_sats: 16000 };
    const s = { ...base, state: "Signed", commitment_txid: "v1", signed_tx: "beef", signed_at_s: "1000", commitment_fee_sats: "1000" };
    expect(plan([s], p, { depositsAt: {}, depthOf: { v1: 0 } }, 4599)).toEqual([]);
    expect(plan([s], p, { depositsAt: {}, depthOf: { v1: 0 } }, 4600)).toEqual([{ kind: "bump_fee", serial: 1 }]);
    expect(plan([{ ...s, commitment_fee_sats: "16000" }], p, { depositsAt: {}, depthOf: { v1: 0 } }, 9999)).toEqual([], "at the cap");
    expect(plan([s], p, { depositsAt: {}, depthOf: { v1: 1 } }, 9999)).toEqual([], "already in a block");
  });
  it("bumps a settlement that nodes refused or evicted, not only one stuck in the mempool", () => {
    const p = { ...params, fee_bump_after_s: 3600, max_fee_sats: 16000 };
    const s = { ...base, state: "Signed", commitment_txid: "v1", signed_tx: "beef", signed_at_s: "1000", commitment_fee_sats: "1000" };
    expect(plan([s], p, { depositsAt: {}, depthOf: {} }, 4599)).toEqual([{ kind: "broadcast", serial: 1, raw: "beef" }], "before the bump is due: only re-broadcast");
    expect(plan([s], p, { depositsAt: {}, depthOf: {} }, 4600)).toEqual([{ kind: "broadcast", serial: 1, raw: "beef" }, { kind: "bump_fee", serial: 1 }]);
    expect(plan([{ ...s, commitment_fee_sats: "16000" }], p, { depositsAt: {}, depthOf: {} }, 9999)).toEqual([{ kind: "broadcast", serial: 1, raw: "beef" }], "at the cap");
  });
});

describe("paged views", () => {
  it("reads every page, so a full first page cannot hide later offers", async () => {
    const all = Array.from({ length: 450 }, (_, i) => ({ ...base, serial: i + 1 }));
    const calls: unknown[] = [];
    const near = { view: async (_m: string, a: any) => { calls.push(a); return all.slice(a.from, a.from + a.limit); }, call: async () => null } as any;
    expect((await viewAll({ near }, "get_created")).map((o) => o.serial)).toEqual(all.map((o) => o.serial));
    expect(calls).toEqual([{ from: 0, limit: 200 }, { from: 200, limit: 200 }, { from: 400, limit: 200 }]);
  });
});
