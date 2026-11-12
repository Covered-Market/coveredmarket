import { describe as group, expect, it } from "vitest";
import { accountShort, ago, describe, newestSerial, who } from "./activity";
import type { Offer } from "./verify";

group("newestSerial", () => {
  const probe = (top: number) => { const asked: number[] = []; return { asked, exists: async (s: number) => { asked.push(s); return s >= 1 && s <= top; } }; };
  it("finds the newest serial from any head start, in few calls", async () => {
    for (const top of [0, 1, 2, 7, 64, 213, 5000]) for (const known of [0, Math.floor(top / 2), top]) {
      const p = probe(top);
      expect(await newestSerial(p.exists, known)).toBe(top);
      expect(p.asked.length).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(top + 2)) + 2);
    }
  });
  it("asks one question when nothing is newer than the hint", async () => {
    const p = probe(40);
    expect(await newestSerial(p.exists, 40)).toBe(40);
    expect(p.asked).toEqual([41]);
  });
});

group("who", () => {
  it("shows the name before the first dot, or a short hash for an implicit account", () => {
    expect(who("ola-x7k2.testnet")).toBe("ola-x7k2");
    expect(who("maren-ab12.covered-relayer-mw4qlyb3.testnet")).toBe("maren-ab12");
    expect(who("a".repeat(64))).toBe("aaaaaa…aaaa");
    expect(who(null)).toBe("someone");
  });
});

group("ago", () => {
  it("says how long ago in words", () => {
    expect(ago(1000, 1030)).toBe("just now");
    expect(ago(0, 12 * 60)).toBe("12 minutes ago");
    expect(ago(0, 3 * 3600)).toBe("3 hours ago");
    expect(ago(0, 2 * 86400)).toBe("2 days ago");
    expect(ago(100, 50)).toBe("just now");
  });
});

group("describe", () => {
  const NOW = Date.UTC(2026, 10, 10, 12) / 1000;
  const o = (x: Partial<Offer> & { signed_at_s?: string }): Offer => ({
    serial: 7, seller: "maren-ab12.testnet", buyer: "ola-x7k2.testnet", size_sats: "150000", strike_units: "76500000000", strike_total_units: "114750000",
    premium_units: "820000", expiry_s: String(NOW + 3600), created_s: String(NOW - 600), state: "Funded", commitment_reason: null, committed_at_s: null,
    escrow_units: "0", ...x,
  } as Offer);
  it("says what happened to each contract, with a stamp", () => {
    const cases: [Partial<Offer>, string, string, RegExp][] = [
      [{ state: "Created" }, "pending", "Created", /maren-ab12 is selling; waiting for the deposit/],
      [{ state: "Funded" }, "open", "For sale", /maren-ab12 is selling; expires 10 Nov, 13:00 UTC/],
      [{ state: "Funded", expiry_s: String(NOW - 60) }, "open", "For sale", /expired unsold/],
      [{ state: "Sold" }, "open", "Sold", /maren-ab12 sold to ola-x7k2; expires/],
      [{ state: "Sold", expiry_s: String(NOW - 60) }, "open", "Sold", /exercise window open/],
      [{ state: "Signed", commitment_reason: "Exercise" }, "open", "Settling", /ola-x7k2 exercised; coins on their way to ola-x7k2/],
      [{ state: "Committed", commitment_reason: "Withdraw" }, "open", "Settling", /maren-ab12 is withdrawing/],
      [{ state: "Signed", commitment_reason: "Expiry" }, "open", "Settling", /not exercised; coins on their way back to maren-ab12/],
      [{ state: "Kept" }, "kept", "Kept", /maren-ab12 kept the coins and the premium/],
      [{ state: "Exercised" }, "exercised", "Exercised", /ola-x7k2 paid the strike and received the coins/],
      [{ state: "Withdrawn" }, "settled", "Withdrawn", /took the coins back unsold/],
      [{ state: "Cancelled", buyer: null }, "settled", "Cancelled", /maren-ab12 cancelled before funding it/],
      [{ state: "Rescued" }, "refused", "Rescued", /rescue key/],
    ];
    for (const [x, stamp, word, line] of cases) {
      const r = describe(o(x), NOW);
      expect(r.stamp, x.state).toBe(stamp);
      expect(r.word).toBe(word);
      expect(r.line).toMatch(line);
    }
  });
  it("carries the figures and dates the latest step", () => {
    const r = describe(o({ state: "Exercised", created_s: String(NOW - 5 * 3600), committed_at_s: String(NOW - 3 * 3600), signed_at_s: String(NOW - 2 * 3600) }), NOW);
    expect(r).toMatchObject({ serial: 7, sizeBtc: 0.0015, strikeUsd: 76_500, premiumUsd: 0.82, when: "2 hours ago" });
    expect(describe(o({ created_s: undefined }), NOW).when).toBe("");
  });
});

group("accountShort", () => {
  it("shortens an implicit account to its ends and leaves a named one whole", () => {
    expect(accountShort("d707684f37f903ccab3249302589230eecd3af347fb5503fcd42c1c1c412a6b1")).toBe("d70768…a6b1");
    expect(accountShort("imani-rce8.coveredmarket-relayer-mwallj7x.testnet")).toBe("imani-rce8.coveredmarket-relayer-mwallj7x.testnet");
  });
});
