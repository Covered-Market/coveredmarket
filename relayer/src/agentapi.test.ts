import { describe, expect, it } from "vitest";
import { describeAccount, describeOffer, describeParams, nextActions, nextExpiry, statusOf, type RawOffer, type RawParams } from "./agentapi.js";

const ctx = { contract: "app.testnet", usdc: "usdc.testnet" };
// The live testnet deployment's parameters (10-minute exercise window, 1-minute expiry grid).
const p: RawParams = {
  usdc: "usdc.testnet", network: "Testnet4", min_conf: 1, fee_sats: 300, grace_s: 600, buy_cutoff_s: 0, min_lead_s: 300,
  escrow_timeout_s: 3600, min_size_sats: 100000, max_size_sats: 10000000, expiry_step_s: 60, expiry_offset_s: 0, rescue_delay_s: 21600,
};
const EXP = 1_794_320_040;
const offer = (o: Partial<RawOffer> = {}): RawOffer => ({
  serial: 7, seller: "s.testnet", buyer: null, size_sats: "100000", strike_units: "150000000000", strike_total_units: "150000000",
  premium_units: "5000000", expiry_s: String(EXP), created_s: String(EXP - 1800), unlock_s: String(EXP + 600 + 21600),
  address: "tb1qdeposit", refund_address: "tb1qrefund", escrow_units: "0", state: "Created", ...o,
});
const kinds = (o: RawOffer, now: number) => nextActions(o, p, now, ctx).map((a) => `${a.who}:${a.action}${a.ready ? "" : "(later)"}`);

describe("nextExpiry", () => {
  it("lands on the grid, past min_lead plus a minute of slack", () => {
    const t = nextExpiry(p, 1000);
    expect(t % 60).toBe(0);
    expect(t).toBeGreaterThanOrEqual(1000 + 300 + 60);
    expect(t - (1000 + 360)).toBeLessThan(60);
  });
  it("respects a daily 08:00 grid", () => {
    const t = nextExpiry({ expiry_step_s: 86400, expiry_offset_s: 28800, min_lead_s: 86400 }, Date.UTC(2026, 10, 10, 12) / 1000);
    expect(new Date(t * 1000).toISOString()).toBe("2026-11-12T08:00:00.000Z");
  });
});

describe("describeOffer", () => {
  it("converts units and names the deposit", () => {
    const d = describeOffer(offer(), p, EXP - 1000, ctx);
    expect(d.id).toBe("CV-7");
    expect(d.size.btc).toBe(0.001);
    expect(d.strike).toMatchObject({ usd_per_btc: 150000, total_usd: 150 });
    expect(d.premium.usd).toBe(5);
    expect(d.expiry.utc).toBe("2026-11-10T14:14:00Z");
    expect(d.exercise_window.closes_s).toBe(EXP + 600);
    expect(d.summary).toContain("exactly 100000 sats to tb1qdeposit");
    expect(d.final).toBe(false);
  });

  it("Created: seller deposits or cancels; the relayer proves", () => {
    expect(kinds(offer(), EXP - 1000)).toEqual(["seller:deposit", "relayer:confirm_deposit", "seller:cancel"]);
    expect(kinds(offer(), EXP + 1)).toContain("anyone:cancel");
  });

  it("Funded: the buy call is exact and final-ready", () => {
    const [buy] = nextActions(offer({ state: "Funded" }), p, EXP - 1000, ctx);
    expect(buy.action).toBe("buy");
    expect(buy.call).toEqual({
      receiver_id: "usdc.testnet", method: "ft_transfer_call", deposit_yocto: "1", gas_tgas: 100,
      args: { receiver_id: "app.testnet", amount: "5000000", msg: JSON.stringify({ serial: 7, btc_address: "<your bitcoin address>" }) },
    });
    // Past the cutoff it is no longer for sale; only withdraw remains.
    expect(kinds(offer({ state: "Funded" }), EXP)).toEqual(["seller:withdraw"]);
    expect(statusOf(describeOffer(offer({ state: "Funded" }), p, EXP, ctx), EXP)).toBeNull();
  });

  it("Sold: exercise opens at expiry, settle after the window", () => {
    const sold = offer({ state: "Sold", buyer: "b.testnet", buyer_address: "tb1qbuyer" });
    expect(kinds(sold, EXP - 10)).toEqual(["buyer:exercise(later)", "relayer:settle(later)"]);
    expect(kinds(sold, EXP + 10)).toEqual(["buyer:exercise", "relayer:settle(later)"]);
    expect(kinds(sold, EXP + 600)).toEqual(["relayer:settle"]);
    const ex = nextActions(sold, p, EXP + 10, ctx)[0];
    expect(ex.call?.args).toMatchObject({ amount: "150000000", msg: JSON.stringify({ serial: 7, exercise: true }) });
  });

  it("Committed exercise: reclaim waits for the escrow timeout; rescue after unlock", () => {
    const c = offer({ state: "Committed", commitment_reason: "Exercise", escrow_units: "150000000", buyer: "b.testnet" });
    const unlock = EXP + 600 + 21600;
    expect(kinds(c, EXP + 700)).toEqual(["relayer:request_signature", "buyer:reclaim_strike(later)"]);
    expect(kinds(c, unlock + 3600)).toEqual(["relayer:request_signature", "buyer:reclaim_strike", "seller:rescue"]);
  });

  it("final states have nothing to do", () => {
    for (const state of ["Kept", "Exercised", "Withdrawn", "Cancelled", "Rescued"]) {
      const d = describeOffer(offer({ state }), p, EXP + 99999999, ctx);
      expect(d.next_actions).toEqual([]);
      expect(d.final).toBe(true);
      expect(statusOf(d, EXP)).toBeNull();
    }
  });
});

describe("describeParams and describeAccount", () => {
  it("gives the rules and a few valid expiries", () => {
    const d = describeParams(p, 1000, ctx);
    expect(d.size.min_btc).toBe(0.001);
    expect(d.expiry.next.length).toBeGreaterThanOrEqual(3);
    for (const e of d.expiry.next) expect(e.expiry_s % 60).toBe(0);
  });
  it("offers claim only when something is owed", () => {
    expect(describeAccount("a.testnet", "0", [], ctx).next_actions).toEqual([]);
    const a = describeAccount("a.testnet", "5000000", [describeOffer(offer({ seller: "a.testnet" }), p, EXP, ctx)], ctx);
    expect(a.claimable.usd).toBe(5);
    expect(a.selling).toHaveLength(1);
    expect(a.next_actions[0].call?.method).toBe("claim");
  });
});
