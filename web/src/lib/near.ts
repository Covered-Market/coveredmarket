/** Browser-side NEAR: views, Verify clients, and a local wallet that pays through the relayer. */
import { Account } from "@near-js/accounts";
import { KeyPair, KeyPairEd25519 } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators, buildDelegateAction, encodeSignedDelegate } from "@near-js/transactions";
import { sha256 } from "@noble/hashes/sha256";
import { base58 } from "@scure/base";
import type { Clients } from "./verify.js";

/** Runtime configuration, served as /config.json by the web container (written by `covered up` / the cloud bootstrap). */
export interface Config { network: string; rpc: string; contract: string; usdc: string; esplora: string; explorerBtc: string; explorerNear: string; codeHash: string; signer: string; lightClient: string; minConf: number; helper: string; accountSuffix: string; mode: "local" | "testnet" | "mainnet" }
const defaults: Config = { network: "testnet", rpc: "https://rpc.testnet.fastnear.com", contract: "covered.testnet", usdc: "usdc.fakes.testnet", esplora: "https://mempool.space/testnet/api", explorerBtc: "https://mempool.space/testnet", explorerNear: "https://testnet.nearblocks.io", codeHash: "", signer: "v1.signer-prod.testnet", lightClient: "btc-client-v4.testnet", minConf: 1, helper: "/api", accountSuffix: "testnet", mode: "testnet" };
export const CFG: Config = { ...defaults, ...((window as any).COVERED_CONFIG ?? {}) };
export async function loadConfig() {
  try { const r = await fetch("/config.json", { cache: "no-store" }); if (r.ok) Object.assign(CFG, await r.json()); } catch {}
}

export let provider = new JsonRpcProvider({ url: CFG.rpc });
export function reconnect() { provider = new JsonRpcProvider({ url: CFG.rpc }); }

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
  const accountId = `${name.toLowerCase().replace(/[^a-z0-9-_]/g, "")}.${CFG.accountSuffix || CFG.network}`;
  const kp = KeyPairEd25519.fromRandom();
  const url = CFG.mode === "local" ? "/api/dev/account" : `${CFG.helper}/account`;
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: kp.getPublicKey().toString() }) });
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
    const bytes = encodeSignedDelegate(signedDelegateAction);
    const r = await fetch("/api/relay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedDelegate: btoa(String.fromCharCode(...bytes)) }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j.value !== undefined && j.value !== "" ? JSON.parse(j.value) : j;
    if (r.status === 422) throw Object.assign(new Error(`transaction failed: ${JSON.stringify(j.failure)}`), { final: true });
    throw new Error(`relay ${r.status}: ${j.error ?? ""}`);
  } catch (e) {
    if ((e as any).final) throw e; // the relayed transaction ran and failed: do not resend it
    console.warn("relay unavailable, sending directly", e);
    return account(w).callFunction({ contractId: receiverId, methodName: method, args, gas, deposit: depositYocto });
  }
}

export const toUsdcUnits = (usd: number) => BigInt(Math.round(usd * 1e6));
export const toSats = (btc: number) => BigInt(Math.round(btc * 1e8));
