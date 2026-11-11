import { describe, expect, it } from "vitest";
import { latestReader, newestSerial } from "./latest.js";

const offers = (top: number) => async (s: number) => (s >= 1 && s <= top ? { serial: s, v: 1 } : null);
const noPause = async () => {};
const serials = (os: { serial: number }[]) => os.map((o) => o.serial);

describe("latest offers", () => {
  it("finds the newest serial", async () => {
    for (const top of [0, 1, 2, 7, 48, 61, 1000]) expect(await newestSerial(async (s) => s >= 1 && s <= top)).toBe(top);
  });

  it("reads the newest ones, newest first, and no more than asked", async () => {
    expect(serials(await latestReader(offers(61), 48, 8, noPause)())).toEqual(Array.from({ length: 48 }, (_, i) => 61 - i));
    expect(serials(await latestReader(offers(0), 48, 8, noPause)())).toEqual([]);
  });

  it("starts the next read from the serial it found", async () => {
    let top = 30;
    const calls: number[] = [];
    const read = latestReader(async (s: number) => { calls.push(s); return s >= 1 && s <= top ? { serial: s } : null; }, 4, 8, noPause);
    await read();
    top = 32; calls.length = 0;
    expect(serials(await read())).toEqual([32, 31, 30, 29]);
    expect(Math.min(...calls)).toBeGreaterThanOrEqual(29);
  });

  it("tries a turned-away read again after a pause", async () => {
    let refusals = 2, pauses = 0;
    const read = latestReader(async (s: number) => { if (s === 4 && refusals-- > 0) throw new Error("429"); return s <= 5 ? { serial: s } : null; }, 48, 8, async () => { pauses++; });
    expect(serials(await read())).toEqual([5, 4, 3, 2, 1]);
    expect(pauses).toBe(2);
  });

  it("keeps the previous copy of an offer that still fails, and leaves out one it never had", async () => {
    let down = new Set<number>();
    const read = latestReader(async (s: number) => { if (down.has(s)) throw new Error("429"); return s <= 5 ? { serial: s, v: 1 } : null; }, 48, 8, noPause);
    // Serial 4 is never probed while looking for the newest (1, 3, 7, 5, 6), only when the offers are read.
    down = new Set([4]);
    expect(serials(await read())).toEqual([5, 3, 2, 1]);
    down = new Set();
    await read();
    down = new Set([2, 4]);
    expect(serials(await read())).toEqual([5, 4, 3, 2, 1]);
  });
});
