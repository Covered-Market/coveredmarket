import { describe, expect, it } from "vitest";
import { checkDelegate, type RelayPolicy } from "./metatx.js";

const p: RelayPolicy = { coveredmarket: "coveredmarket.near", usdc: "usdc.near", maxGas: 300_000_000_000_000n, maxDepositYocto: 10n ** 24n };
const call = (receiverId: string, methodName: string, args = {}, deposit = 0n, gas = 100_000_000_000_000n) =>
  ({ senderId: "alice.near", receiverId, actions: [{ methodName, args, gas, deposit }] });

describe("relay policy", () => {
  it("relays contract methods and token transfers to the contract", () => {
    expect(checkDelegate(call("coveredmarket.near", "claim"), p)).toEqual({ ok: true });
    expect(checkDelegate(call("usdc.near", "ft_transfer_call", { receiver_id: "coveredmarket.near", amount: "1", msg: "{}" }, 1n), p)).toEqual({ ok: true });
  });
  it("refuses other receivers, methods, targets and gas", () => {
    expect(checkDelegate(call("evil.near", "claim"), p).ok).toBe(false);
    expect(checkDelegate(call("coveredmarket.near", "new"), p).ok).toBe(false);
    expect(checkDelegate(call("usdc.near", "ft_transfer", { receiver_id: "coveredmarket.near" }, 1n), p).ok).toBe(false);
    expect(checkDelegate(call("usdc.near", "ft_transfer_call", { receiver_id: "bob.near" }, 1n), p).ok).toBe(false);
    expect(checkDelegate(call("coveredmarket.near", "claim", {}, 0n, 10n ** 15n), p).ok).toBe(false);
    expect(checkDelegate({ senderId: "a", receiverId: "coveredmarket.near", actions: [] }, p).ok).toBe(false);
  });
});
