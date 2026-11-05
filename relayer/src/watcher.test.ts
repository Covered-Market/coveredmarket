import { describe, expect, it } from "vitest";
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
});
