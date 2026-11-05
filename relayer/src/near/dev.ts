/** Sandbox-only helper: create `<name>.<root>` funded with NEAR and mock USDC. Never enabled outside `covered up`. */
import { Account } from "@near-js/accounts";
import { KeyPair, PublicKey } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators } from "@near-js/transactions";

export function devAccountCreator(o: { nodeUrl: string; rootId: string; rootKey: string; usdc: string }) {
  const provider = new JsonRpcProvider({ url: o.nodeUrl });
  const root = new Account(o.rootId, provider, new KeyPairSigner(KeyPair.fromString(o.rootKey as any)));
  return async (accountId: string, publicKey: string) => {
    if (!accountId.endsWith(`.${o.rootId}`)) throw new Error(`account must end with .${o.rootId}`);
    await root.signAndSendTransaction({ receiverId: accountId, actions: [actionCreators.createAccount(), actionCreators.transfer(20n * 10n ** 24n), actionCreators.addKey(PublicKey.from(publicKey), actionCreators.fullAccessKey())] });
    await root.callFunction({ contractId: o.usdc, methodName: "mint", args: { account_id: accountId, amount: "1000000000000" }, gas: 30n * 10n ** 12n });
    return { ok: true, accountId, usdc: "1000000.00" };
  };
}
