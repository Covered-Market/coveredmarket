import { describe, expect, it } from "vitest";
import { defaultPolicy as p, fundable, isImplicit, Limits, NEAR, plan, USDC } from "./testfunds.js";

const hex = "3fa1".padEnd(64, "0");

describe("test funds", () => {
  it("funds implicit accounts and .testnet names only", () => {
    expect(isImplicit(hex)).toBe(true);
    expect(fundable(hex)).toBe(true);
    expect(fundable("astrid.testnet")).toBe(true);
    expect(fundable("a-b_c.sub.testnet")).toBe(true);
    expect(fundable("astrid.near")).toBe(false);
    expect(fundable("ASTRID.testnet")).toBe(false);
    expect(fundable(hex.toUpperCase())).toBe(false);
    expect(fundable("testnet")).toBe(false);
    expect(fundable("-x.testnet")).toBe(false);
  });
  it("sends tNEAR to a missing or low account and mints USDC below the floor", () => {
    expect(plan(null, 0n)).toEqual({ near: p.nearTopUp, usdc: p.usdcMint });
    expect(plan(NEAR / 10n, 0n)).toEqual({ near: p.nearTopUp, usdc: p.usdcMint });
    expect(plan(NEAR, 50_000n * USDC)).toEqual({ near: 0n, usdc: 0n });
    expect(plan(NEAR, 0n, p, false)).toEqual({ near: 0n, usdc: 0n });
  });
  it("rate-limits per address, per account and per day", () => {
    const l = new Limits(2, 60_000, 3);
    expect(l.check("ip", "a", 0)).toBeNull(); l.record("ip", "a", 0);
    expect(l.check("ip", "a", 1000)).toMatch(/just funded/);
    expect(l.check("ip", "b", 1000)).toBeNull(); l.record("ip", "b", 1000);
    expect(l.check("ip", "c", 2000)).toMatch(/too many/);
    expect(l.check("ip2", "c", 2000)).toBeNull(); l.record("ip2", "c", 2000);
    expect(l.check("ip3", "d", 3000)).toMatch(/resting/);
    expect(l.check("ip", "c2", 3600_000 + 2000)).toMatch(/resting/);
    expect(l.check("ip", "c2", 86_400_000 + 3000)).toBeNull();
  });
});
