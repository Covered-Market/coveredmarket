/** Thin NEAR access: views for anyone, calls signed by relayer.near. */
import { Account } from "@near-js/accounts";
import { KeyPair } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators } from "@near-js/transactions";

export interface NearCfg { networkId: string; nodeUrl: string; relayerId?: string; relayerKey?: string; covered: string }

/** Resend a transaction the network REJECTED (stale nonce or expired block hash: it never ran): a load-balanced RPC node a block
 *  behind can hand out the nonce the previous transaction just used. Any other error is final. */
export async function retryNonce<T>(f: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await f(); }
    catch (e) { if (i + 1 >= tries || !/InvalidNonce|nonce .*must be larger|Transaction has expired|Expired/i.test(String((e as Error)?.message ?? e))) throw e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
}

export async function nearClient(cfg: NearCfg) {
  const provider = new JsonRpcProvider({ url: cfg.nodeUrl });
  const view = async <T>(method: string, args: Record<string, unknown> = {}): Promise<T> => {
    const r: any = await provider.query({ request_type: "call_function", account_id: cfg.covered, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "optimistic" });
    return JSON.parse(Buffer.from(r.result).toString());
  };
  let account: Account | undefined;
  if (cfg.relayerId && cfg.relayerKey) account = new Account(cfg.relayerId, provider, new KeyPairSigner(KeyPair.fromString(cfg.relayerKey as any)));
  const call = async (method: string, args: Record<string, unknown>, gasTgas = 300) => {
    if (!account) throw new Error("relayer key not configured");
    return retryNonce(() => account!.callFunction({ contractId: cfg.covered, methodName: method, args, gas: BigInt(gasTgas) * 10n ** 12n }));
  };
  const callAny = async (contractId: string, method: string, args: Record<string, unknown>, gasTgas = 50) => {
    if (!account) throw new Error("relayer key not configured");
    return retryNonce(() => account!.callFunction({ contractId, methodName: method, args, gas: BigInt(gasTgas) * 10n ** 12n }));
  };
  /** Relay a signed delegate action (NEP-366) built by the user's wallet. */
  const accountExists = async (id: string) => {
    try { await provider.query({ request_type: "view_account", account_id: id, finality: "optimistic" }); return true; } catch { return false; }
  };
  const createSubAccount = async (id: string, publicKey: string, yocto: bigint) => {
    if (!account) throw new Error("relayer key not configured");
    return retryNonce(() => account!.createAccount(id, publicKey as any, yocto));
  };
  /** Native balance in yocto, or null if the account does not exist. */
  const balance = async (id: string): Promise<bigint | null> => {
    try { const r: any = await provider.query({ request_type: "view_account", account_id: id, finality: "optimistic" }); return BigInt(r.amount); } catch { return null; }
  };
  /** Send NEAR from the relayer. Sending to an implicit account that does not exist yet creates it. */
  const transfer = async (to: string, yocto: bigint) => {
    if (!account) throw new Error("relayer key not configured");
    return retryNonce(() => account!.transfer({ receiverId: to, amount: yocto }));
  };
  const relay = async (signedDelegate: any) => {
    if (!account) throw new Error("relayer key not configured");
    return retryNonce(() => account!.signAndSendTransaction({ receiverId: signedDelegate.delegateAction.senderId, actions: [actionCreators.signedDelegate(signedDelegate)], throwOnFailure: false } as any));
  };
  /** The contract's clock: latest block timestamp in seconds. Guards (window, grace) are judged against this, not wall time. */
  const chainNow = async () => Number(BigInt((await provider.block({ finality: "optimistic" })).header.timestamp_nanosec) / 1_000_000_000n);
  return { view, call, callAny, relay, createSubAccount, accountExists, balance, transfer, provider, chainNow };
}
