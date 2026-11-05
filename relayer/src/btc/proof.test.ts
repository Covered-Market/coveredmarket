import { describe, expect, it } from "vitest";
import { buildProof, lcArgsV2, merkleRoot, txidOf, type Esplora } from "./proof.js";
import vectors from "../../../web/src/vectors.json" with { type: "json" };

// Real mainnet fixture: block 170, the first Bitcoin transaction (Satoshi → Hal Finney).
const TXID = "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16";
const RAW = "0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0200ca9a3b00000000434104ae1a62fe09c5f51b13905f07f06b99a2f7159b2225f374cd378d71302fa28414e7aab37397f554a7df5f142c21c1b7303b8a0626f1baded5c72a704f7e6cd84cac00286bee0000000043410411db93e1dcdb8a016b49840f8c53bc1eb68a382e97b1482ecad7b148a6909a5cb2e0eaddfb84ccf9744464f82e160bfa9b8b64f9d4c03f999b8643f656b412a3ac00000000";
const BLOCK = { id: "00000000d1145790a8694403d4063f323d499e655c83426834d4ce2f8dd4a2ee", height: 170, merkle_root: "7dac2c5666815c17a3b36427de37bb9d2e2c5ccec3f8633eb91a4205cb4c10ff", tx_count: 2 };
const MP = { block_height: 170, merkle: ["b1fea52486ce0c62bb442b530a3f0132b826c74e473d1f2c220bfa78111c5082"], pos: 1 };

const fake: Esplora = {
  txHex: async () => RAW,
  merkleProof: async () => MP,
  blockHashAt: async () => BLOCK.id,
  block: async () => BLOCK,
  tipHeight: async () => 900_000,
  blockTxids: async () => [MP.merkle[0], TXID],
};

describe("proof builder", () => {
  it("computes the non-witness txid", () => {
    expect(txidOf(RAW)).toBe(TXID);
  });
  it("walks the merkle branch to the block root", () => {
    expect(merkleRoot(TXID, MP.pos, MP.merkle)).toBe(BLOCK.merkle_root);
  });
  it("builds a proof the contract accepts and reports depth", async () => {
    const { proof, depth } = await buildProof(fake, TXID);
    expect(proof.block_hash).toBe(BLOCK.id);
    expect(proof.tx_index).toBe(1);
    expect(depth).toBe(900_000 - 170 + 1);
    expect(proof.coinbase_tx_id).toBe(MP.merkle[0]);
    expect(proof.coinbase_merkle_proof).toEqual([TXID]);
  });
  it("refuses a forged branch", async () => {
    const forged: Esplora = { ...fake, merkleProof: async () => ({ ...MP, merkle: ["00".repeat(32)] }) };
    await expect(buildProof(forged, TXID)).rejects.toThrow(/merkle mismatch/);
  });
  it("strips witness data before hashing", () => {
    // segwit tx: marker 00 flag 01, one input with 2 witness items
    const segwit = "02000000" + "0001" + "01" + "11".repeat(32) + "00000000" + "00" + "ffffffff" + "01" + "e803000000000000" + "16" + "0014" + "22".repeat(20) + "02" + "03" + "aabbcc" + "21" + "02" + "33".repeat(32) + "00000000";
    const legacy = "02000000" + "01" + "11".repeat(32) + "00000000" + "00" + "ffffffff" + "01" + "e803000000000000" + "16" + "0014" + "22".repeat(20) + "00000000";
    expect(txidOf(segwit)).toBe(txidOf(legacy));
  });
});

describe("light client argument encoding", () => {
  it("is byte-identical to the contract's borsh_args", () => {
    const p = vectors.lc_args_proof;
    expect(Buffer.from(lcArgsV2(p, p.confirmations)).toString("hex")).toBe(vectors.lc_args_hex);
  });
});
