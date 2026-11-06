import { describe, expect, it } from "vitest";
import { expiryChoices } from "./expiry";

const now = Date.UTC(2026, 10, 6, 15, 37, 12) / 1000; // Fri 6 Nov 2026 15:37:12 UTC

describe("expiry choices", () => {
  it("mainnet: 08:00 UTC days, never inside the minimum lead", () => {
    const c = expiryChoices({ min_lead_s: 86400, expiry_step_s: 86400, expiry_offset_s: 28800 }, now);
    expect(c.length).toBe(6);
    for (const { at } of c) { expect((at - 28800) % 86400).toBe(0); expect(at - now).toBeGreaterThanOrEqual(86400); }
    expect(new Date(c[0].at * 1000).toISOString()).toBe("2026-11-08T08:00:00.000Z"); // Sat 08:00 is under 24 h away
    expect(c[0].label).toBe("Sun 8 Nov");
  });
  it("testnet: minutes away, on the minute grid", () => {
    const c = expiryChoices({ min_lead_s: 300, expiry_step_s: 60, expiry_offset_s: 0 }, now);
    expect(c.map((x) => x.label).slice(0, 4)).toEqual(["in 10 min", "in 30 min", "in 2 hours", "in 24 hours"]);
    expect(c[0].at - now).toBeGreaterThanOrEqual(600);
    expect(c.map((x) => x.at % 60)).toEqual(c.map(() => 0));
    expect(c.length).toBe(5);
  });
});
