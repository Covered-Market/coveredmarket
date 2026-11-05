import { describe, expect, it } from "vitest";
import { KeyPairEd25519 } from "@near-js/crypto";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators, buildDelegateAction } from "@near-js/transactions";
import { decodeSignedDelegate, encodeSignedDelegateB64, viewOf } from "./delegate.js";

describe("delegate wire format", () => {
  it("round-trips a signed delegate and exposes the policy view", async () => {
    const kp = KeyPairEd25519.fromRandom();
    const d = buildDelegateAction({ senderId: "alice.test.near", receiverId: "usdc.test.near", nonce: 5n, maxBlockHeight: 100n, publicKey: kp.getPublicKey(),
      actions: [actionCreators.functionCall("ft_transfer_call", { receiver_id: "covered.test.near", amount: "1", msg: "{}" }, 100n * 10n ** 12n, 1n)] });
    const [, sd] = await new KeyPairSigner(kp).signDelegateAction(d);
    const b64 = encodeSignedDelegateB64(sd);
    const back = decodeSignedDelegate(b64);
    expect(encodeSignedDelegateB64(back)).toBe(b64);
    const v = viewOf(back);
    expect(v).toMatchObject({ senderId: "alice.test.near", receiverId: "usdc.test.near" });
    expect(v.actions[0]).toMatchObject({ methodName: "ft_transfer_call", deposit: 1n, args: { receiver_id: "covered.test.near" } });
  });
});
