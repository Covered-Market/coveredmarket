import { describe, expect, it, vi } from "vitest";
import { retryNonce } from "./client.js";

describe("retryNonce", () => {
  it("resends only transactions rejected for their nonce", async () => {
    vi.useFakeTimers();
    let n = 0;
    const p = retryNonce(async () => { if (n++ < 2) throw new Error("Transaction nonce 5 must be larger than nonce of the used access key 5"); return "ok"; });
    await vi.runAllTimersAsync();
    expect(await p).toBe("ok");
    expect(n).toBe(3);
    let k = 0;
    const q = retryNonce(async () => { if (k++ < 1) throw new Error("Transaction has expired"); return "ok"; });
    await vi.runAllTimersAsync();
    expect(await q).toBe("ok");
    let m = 0;
    await expect(retryNonce(async () => { m++; throw new Error("Smart contract panicked: only seller"); })).rejects.toThrow("only seller");
    expect(m).toBe(1);
    vi.useRealTimers();
  });
});
