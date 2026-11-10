import { describe, expect, it } from "vitest";
import { branch, Core } from "./core.js";
import { merkleRoot } from "./proof.js";

describe("esplora-style tx from Bitcoin Core", () => {
  it("gives each output's address and value in sats, as Verify check 3 reads them", async () => {
    const answers: Record<string, unknown> = {
      getrawtransaction: { txid: "aa".repeat(32), blockhash: "bb".repeat(32), vout: [
        { value: 0.0007, scriptPubKey: { hex: "0014" + "11".repeat(20), address: "bcrt1qchange" } },
        { value: 0.01, scriptPubKey: { hex: "0020" + "22".repeat(32), address: "bcrt1qdeposit" } },
      ] },
      getblockheader: { height: 106 },
    };
    const fake = (async (_u: string, init: any) => { const { method } = JSON.parse(init.body); return new Response(JSON.stringify({ result: answers[method], error: null })); }) as typeof fetch;
    const t = await new Core({ url: "http://core", user: "u", pass: "p" }, fake).tx("aa".repeat(32));
    expect(t.status).toEqual({ confirmed: true, block_height: 106 });
    expect(t.vout[1]).toMatchObject({ scriptpubkey_address: "bcrt1qdeposit", value: 1_000_000 });
    expect(t.vout[0].value).toBe(70_000);
  });
});

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
