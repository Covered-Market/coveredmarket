/**
 * Bring your own NEAR wallet (HOT, Meteor, Intear, MyNearWallet, OKX, Nightly, …) through NEAR Connect.
 * Wallets run in a sandboxed iframe; we only ever see the account id and what the user signs.
 * Gas: a wallet that can sign delegate actions (NEP-366) goes through the Covered relayer and needs no NEAR;
 * any other wallet sends the transaction itself and pays a little gas.
 */
import { NearConnector, type NearWalletBase } from "@hot-labs/near-connect";
import { CFG, outcomeValue, relaySigned, type Wallet } from "./near";

let instance: NearConnector | null = null;
const net = () => (CFG.network === "mainnet" ? "mainnet" : "testnet") as "mainnet" | "testnet";
export const canConnect = () => CFG.mode !== "local"; // wallets know mainnet and testnet, not our sandbox

export function connector() {
  return (instance ??= new NearConnector({ network: net(), providers: { [net()]: [CFG.rpc] }, features: { [net()]: true }, footerBranding: null }));
}

export async function connectWallet(): Promise<Wallet> {
  const w = await connector().connect();
  const [a] = await w.getAccounts({ network: net() });
  if (!a) throw new Error("the wallet returned no account");
  return { accountId: a.accountId, via: w.manifest.id, viaName: w.manifest.name };
}

export async function restoreConnected(): Promise<Wallet | null> {
  if (!canConnect()) return null;
  try {
    const { wallet, accounts } = await connector().getConnectedWallet();
    return accounts[0] ? { accountId: accounts[0].accountId, via: wallet.manifest.id, viaName: wallet.manifest.name } : null;
  } catch { return null; }
}

export async function disconnectWallet() { try { await connector().disconnect(); } catch {} }

export async function callConnected(w: Wallet, receiverId: string, methodName: string, args: Record<string, unknown>, deposit: bigint, gas: bigint) {
  const wallet: NearWalletBase = await connector().wallet(w.via);
  const action = { type: "FunctionCall", params: { methodName, args, gas: gas.toString(), deposit: deposit.toString() } } as any;
  if (wallet.manifest.features?.signDelegateActions) {
    try {
      const { signedDelegateActions } = await wallet.signDelegateActions({ network: net(), signerId: w.accountId, delegateActions: [{ receiverId, actions: [action] }] });
      return await relaySigned(signedDelegateActions[0]);
    } catch (e) {
      if ((e as any).final) throw e; // it ran on chain and failed: do not send it again
      console.warn("gasless relay unavailable for this wallet, sending directly", e);
    }
  }
  const outcome = await wallet.signAndSendTransaction({ network: net(), signerId: w.accountId, receiverId, actions: [action] });
  return outcomeValue(outcome, receiverId);
}
