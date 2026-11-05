/** Browser-side NEAR: views, Verify clients, and a local wallet that pays through the relayer. */
import { Account } from "@near-js/accounts";
import { KeyPair, KeyPairEd25519 } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators, buildDelegateAction } from "@near-js/transactions";
import { sha256 } from "@noble/hashes/sha256";
import { base58 } from "@scure/base";
import type { Clients } from "./verify.js";

export const CFG = {
  network: (import.meta.env.VITE_NEAR_NETWORK as string) ?? "testnet",
  rpc: (import.meta.env.VITE_NEAR_RPC as string) ?? "https://rpc.testnet.near.org",
  contract: (import.meta.env.VITE_COVERED_ID as string) ?? "covered.testnet",
  usdc: (import.meta.env.VITE_USDC_ID as string) ?? "usdc.fakes.testnet",
  esplora: (import.meta.env.VITE_ESPLORA as string) ?? "https://mempool.space/testnet4/api",
  explorerBtc: (import.meta.env.VITE_EXPLORER_BTC as string) ?? "https://mempool.space/testnet4",
  explorerNear: (import.meta.env.VITE_EXPLORER_NEAR as string) ?? "https://testnet.nearblocks.io",
  codeHash: (import.meta.env.VITE_CODE_HASH as string) ?? "",
  signer: (import.meta.env.VITE_SIGNER_ID as string) ?? "v1.signer-prod.testnet",
  lightClient: (import.meta.env.VITE_LIGHT_CLIENT_ID as string) ?? "btc-client.testnet",
  minConf: Number(import.meta.env.VITE_MIN_CONF ?? 1),
  helper: (import.meta.env.VITE_HELPER as string) ?? "https://helper.testnet.near.org",
};

export const provider = new JsonRpcProvider({ url: CFG.rpc });

export async function view<T>(method: string, args: Record<string, unknown> = {}, contract = CFG.contract): Promise<T> {
  const r: any = await provider.query({ request_type: "call_function", account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args)), finality: "final" });
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(r.result)));
}

export const verifyClients = (): Clients => ({
  near: {
    codeHash: async (a) => { const r: any = await provider.query({ request_type: "view_code", account_id: a, finality: "final" }); return base58.encode(sha256(Uint8Array.from(atob(r.code_base64), (c) => c.charCodeAt(0)))); },
    accessKeys: async (a) => { const r: any = await provider.query({ request_type: "view_access_key_list", account_id: a, finality: "final" }); return r.keys.length; },
    view: (m, args) => view(m, args),
    ftBalance: (token, account) => view<string>("ft_balance_of", { account_id: account }, token),
  },
  btc: {
    outspend: async (txid, vout) => { const r = await fetch(`${CFG.esplora}/tx/${txid}/outspend/${vout}`); if (!r.ok) throw new Error(`esplora ${r.status}`); const j = await r.json(); return { spent: j.spent, txid: j.txid }; },
    txStatus: async (txid) => { const r = await fetch(`${CFG.esplora}/tx/${txid}/status`); if (r.status === 404) return null; if (!r.ok) throw new Error(`esplora ${r.status}`); const j = await r.json(); const tip = Number(await (await fetch(`${CFG.esplora}/blocks/tip/height`)).text()); return { confirmed: j.confirmed, depth: j.confirmed ? tip - j.block_height + 1 : 0 }; },
  },
  expected: { codeHash: CFG.codeHash, contract: CFG.contract, signer: CFG.signer, lightClient: CFG.lightClient, usdc: CFG.usdc, minConf: CFG.minConf },
});

// ───────── wallet: a key in localStorage; account created by the testnet helper; gas paid by the relayer ─────────
const LS = "covered.wallet";
export interface Wallet { accountId: string; key: string }
export function loadWallet(): Wallet | null { try { return JSON.parse(localStorage.getItem(LS) ?? "null"); } catch { return null; } }
export function clearWallet() { localStorage.removeItem(LS); }

export async function createWallet(name: string): Promise<Wallet> {
  const accountId = `${name.toLowerCase().replace(/[^a-z0-9-_]/g, "")}.${CFG.network}`;
  const kp = KeyPairEd25519.fromRandom();
  const r = await fetch(`${CFG.helper}/account`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: kp.getPublicKey().toString() }) });
  if (!r.ok) throw new Error(`account creation failed: ${await r.text()}`);
  const w = { accountId, key: kp.toString() };
  localStorage.setItem(LS, JSON.stringify(w));
  return w;
}

function account(w: Wallet) { return new Account(w.accountId, provider, new KeyPairSigner(KeyPair.fromString(w.key as any))); }

/** Call a method. Tries the relayer (meta-tx, no NEAR needed); falls back to a direct transaction. */
export async function call(w: Wallet, receiverId: string, method: string, args: Record<string, unknown>, depositYocto = 0n, gasTgas = 150) {
  const gas = BigInt(gasTgas) * 10n ** 12n;
  try {
    const acc = account(w);
    const ak: any = await provider.query({ request_type: "view_access_key", account_id: w.accountId, public_key: KeyPair.fromString(w.key as any).getPublicKey().toString(), finality: "final" });
    const block = await provider.block({ finality: "final" });
    const delegate = buildDelegateAction({ senderId: w.accountId, receiverId, actions: [actionCreators.functionCall(method, args, gas, depositYocto)], nonce: BigInt(ak.nonce) + 1n, maxBlockHeight: BigInt(block.header.height) + 100n, publicKey: KeyPair.fromString(w.key as any).getPublicKey() });
    const [, signedDelegateAction] = await new KeyPairSigner(KeyPair.fromString(w.key as any)).signDelegateAction(delegate);
    void acc;
    const r = await fetch("/api/relay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(signedDelegateAction, (_k, v) => (typeof v === "bigint" ? v.toString() : v instanceof Uint8Array ? btoa(String.fromCharCode(...v)) : v)) });
    if (r.ok) return r.json();
    throw new Error(`relay ${r.status}`);
  } catch (e) {
    console.warn("relay failed, sending directly", e);
    return account(w).callFunction({ contractId: receiverId, methodName: method, args, gas, deposit: depositYocto });
  }
}

export const toUsdcUnits = (usd: number) => BigInt(Math.round(usd * 1e6));
export const toSats = (btc: number) => BigInt(Math.round(btc * 1e8));
