import { describe, expect, it } from "vitest";
import { failoverFetch } from "./failover.js";

const fake = (answers: Record<string, number | "down">, calls: string[]) => (async (url: string) => {
  calls.push(url);
  const host = new URL(url).hostname;
  const a = answers[host];
  if (a === "down" || a === undefined) throw new Error("ECONNREFUSED");
  return new Response(String(a), { status: a });
}) as unknown as typeof fetch;

describe("failoverFetch", () => {
  it("uses the first provider when it answers", async () => {
    const calls: string[] = [];
    const f = failoverFetch("https://a.test/api,https://b.test/api", fake({ "a.test": 200, "b.test": 200 }, calls));
    expect((await f("/blocks/tip/height")).status).toBe(200);
    expect(calls).toEqual(["https://a.test/api/blocks/tip/height"]);
  });
  it("skips a provider that is down, rate-limited or failing, and remembers the one that answered", async () => {
    for (const bad of ["down", 429, 503] as const) {
      const calls: string[] = [];
      const f = failoverFetch(["https://a.test/api", "https://b.test/api"], fake({ "a.test": bad, "b.test": 200 }, calls));
      expect((await f("/x")).status).toBe(200);
      await f("/y");
      expect(calls).toEqual(["https://a.test/api/x", "https://b.test/api/x", "https://b.test/api/y"]);
    }
  });
  it("treats 404 as an answer, not a failure", async () => {
    const calls: string[] = [];
    const f = failoverFetch("https://a.test/api,https://b.test/api", fake({ "a.test": 404, "b.test": 200 }, calls));
    expect((await f("/tx/00")).status).toBe(404);
    expect(calls.length).toBe(1);
  });
  it("throws when every provider fails", async () => {
    const f = failoverFetch("https://a.test/api,https://b.test/api", fake({}, []));
    await expect(f("/x")).rejects.toThrow("ECONNREFUSED");
  });
});
