/** Thin NEAR access: views for anyone, calls signed by relayer.near. */
import { Account } from "@near-js/accounts";
import { KeyPair } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators } from "@near-js/transactions";

export interface NearCfg { networkId: string; nodeUrl: string; relayerId?: string; relayerKey?: string; covered: string }

export async function nearClient(cfg: NearCfg) {
  const provider = new JsonRpcProvider({ url: cfg.nodeUrl });
  const view = async <T>(method: string, args: Record<string, unknown> = {}): Promise<T> => {
    const r: any = await provider.query({ request_type: "call_function", account_id: cfg.covered, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "final" });
    return JSON.parse(Buffer.from(r.result).toString());
  };
  let account: Account | undefined;
  if (cfg.relayerId && cfg.relayerKey) account = new Account(cfg.relayerId, provider, new KeyPairSigner(KeyPair.fromString(cfg.relayerKey as any)));
  const call = async (method: string, args: Record<string, unknown>, gasTgas = 300) => {
    if (!account) throw new Error("relayer key not configured");
    return account.callFunction({ contractId: cfg.covered, methodName: method, args, gas: BigInt(gasTgas) * 10n ** 12n });
  };
  const callAny = async (contractId: string, method: string, args: Record<string, unknown>, gasTgas = 50) => {
    if (!account) throw new Error("relayer key not configured");
    return account.callFunction({ contractId, methodName: method, args, gas: BigInt(gasTgas) * 10n ** 12n });
  };
  /** Relay a signed delegate action (NEP-366) built by the user's wallet. */
  const relay = async (signedDelegate: any) => {
    if (!account) throw new Error("relayer key not configured");
    return account.signAndSendTransaction({ receiverId: signedDelegate.delegateAction.senderId, actions: [actionCreators.signedDelegate(signedDelegate)] });
  };
  return { view, call, callAny, relay, provider };
}
