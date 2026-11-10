import { describe, expect, it } from "vitest";
import { checkDelegate, RelayLimits, type RelayPolicy } from "./metatx.js";

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

describe("relay limits", () => {
  it("caps each client address and each signing account per minute, and frees them afterwards", () => {
    const l = new RelayLimits({ perIpPerMin: 3, perSenderPerMin: 2, perDay: 100 });
    expect(l.take("1.1.1.1", "alice.near", 0)).toBeNull();
    expect(l.take("1.1.1.1", "alice.near", 1)).toBeNull();
    expect(l.take("2.2.2.2", "alice.near", 2)).toMatch(/account/); // same account from another address
    expect(l.take("1.1.1.1", "bob.near", 3)).toBeNull();
    expect(l.take("1.1.1.1", "carol.near", 4)).toMatch(/address/); // many accounts from one address
    expect(l.take("1.1.1.1", "alice.near", 60_002)).toBeNull();
  });
  it("stops paying once the day's ceiling is reached, and a refused request is not counted", () => {
    const l = new RelayLimits({ perIpPerMin: 100, perSenderPerMin: 100, perDay: 2 });
    expect(l.take("a", "x", 0)).toBeNull();
    expect(l.take("b", "y", 1)).toBeNull();
    expect(l.take("c", "z", 2)).toMatch(/daily/);
    expect(l.take("c", "z", 3)).toMatch(/daily/);
    expect(l.take("c", "z", 86_400_001)).toBeNull();
  });
});
