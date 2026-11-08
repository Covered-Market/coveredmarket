import { describe, expect, it } from "vitest";
import { relayResult } from "./delegate.js";

const b64 = (s: string) => Buffer.from(s).toString("base64");
const r = (executor_id: string, status: object) => ({ outcome: { executor_id, status } });

describe("relayResult", () => {
  it("returns the inner call's value, not the outer delegate's", () => {
    const o = { status: { SuccessValue: "" }, receipts_outcome: [r("astrid.test.near", { SuccessValue: "" }), r("coveredmarket.test.near", { SuccessValue: b64("7") })] };
    expect(relayResult(o, "coveredmarket.test.near")).toEqual({ ok: true, value: "7" });
  });
  it("fails when the inner call fails even though the outer transaction succeeded", () => {
    const o = { status: { SuccessValue: "" }, receipts_outcome: [r("astrid.test.near", { SuccessValue: "" }), r("coveredmarket.test.near", { Failure: { ActionError: { kind: "FunctionCallError" } } })] };
    expect(relayResult(o, "coveredmarket.test.near").ok).toBe(false);
  });
  it("fails when the delegated call never ran", () => {
    expect(relayResult({ status: { SuccessValue: "" }, receipts_outcome: [r("astrid.test.near", { SuccessValue: "" })] }, "coveredmarket.test.near").ok).toBe(false);
  });
});
