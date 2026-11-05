import { describe, expect, it } from "vitest";
import { branch } from "./core.js";
import { merkleRoot } from "./proof.js";

describe("merkle branch from a txid list", () => {
  it("reproduces block 170's branch", () => {
    const txids = ["b1fea52486ce0c62bb442b530a3f0132b826c74e473d1f2c220bfa78111c5082", "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16"];
    const b = branch(txids, 1);
    expect(b).toEqual([txids[0]]);
    expect(merkleRoot(txids[1], 1, b)).toBe("7dac2c5666815c17a3b36427de37bb9d2e2c5ccec3f8633eb91a4205cb4c10ff");
  });
  it("handles odd counts by duplicating the last", () => {
    const t = ["11".repeat(32), "22".repeat(32), "33".repeat(32)];
    const root = merkleRoot(t[2], 2, branch(t, 2));
    const root0 = merkleRoot(t[0], 0, branch(t, 0));
    expect(root).toBe(root0);
  });
});
