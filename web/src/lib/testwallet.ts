/**
 * Hidden test wallet, for automated and AI end-to-end testing on testnet. Never shown in the UI unless asked for.
 *
 *   /?testwallet=seller#/sell    this tab acts as the "seller" test wallet
 *   /?testwallet=buyer#/market   this tab acts as the "buyer" (a separate key)
 *   /?testwallet=1               a generic "tester" wallet
 *   /?testwallet=reset           forget every test key in this browser and leave test mode
 *
 * The flag may also sit in the hash query (/#/sell?testwallet=seller). The key is generated here and stays in
 * this browser's localStorage, one per role; the account is the key's implicit id, and the relayer creates and
 * funds it (tNEAR + test USDC) through /api/test-funds. Which role a tab plays is kept per tab (sessionStorage),
 * so two tabs can be seller and buyer at once. Only when the site runs on testnet with test funds on: the same
 * build serves mainnet, where this is refused at runtime and the relayer has no such endpoint.
 */
import { KeyPairEd25519 } from "@near-js/crypto";
import { CFG, type Wallet } from "./near";

const KEY = (role: string) => `covered.testwallet.${role}`;
const ROLE = "covered.testwallet.role";

export const testWalletAllowed = () => CFG.mode === "testnet" && CFG.network === "testnet" && !!CFG.faucet;

function flag(): string | null {
  const fromSearch = new URLSearchParams(location.search).get("testwallet");
  const fromHash = new URLSearchParams(location.hash.split("?")[1] ?? "").get("testwallet");
  const v = (fromSearch ?? fromHash)?.trim().toLowerCase();
  if (v === undefined || v === null) return null;
  if (v === "" || v === "1" || v === "true") return "tester";
  return v.replace(/[^a-z0-9_-]/g, "").slice(0, 24) || "tester";
}

/** Read the URL flag once at startup. Returns the role this tab plays, or null outside test mode. */
export function initTestWallet(): string | null {
  const f = flag();
  if (f === "reset") {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k?.startsWith("covered.testwallet.")) localStorage.removeItem(k); }
      sessionStorage.removeItem(ROLE);
    } catch {}
    return null;
  }
  if (!testWalletAllowed()) { try { sessionStorage.removeItem(ROLE); } catch {} return null; }
  if (f) { try { sessionStorage.setItem(ROLE, f); } catch {} return f; }
  try { return sessionStorage.getItem(ROLE); } catch { return null; }
}

export function activeTestRole(): string | null {
  if (!testWalletAllowed()) return null;
  try { return sessionStorage.getItem(ROLE); } catch { return null; }
}

const implicitId = (kp: KeyPairEd25519) => Array.from(kp.getPublicKey().data, (b) => b.toString(16).padStart(2, "0")).join("");

/** The test wallet for `role`: the stored key, or a new one. Does not touch the chain. */
export function testWallet(role: string): Wallet {
  try { const w = JSON.parse(localStorage.getItem(KEY(role)) ?? "null"); if (w?.accountId && w?.key) return { ...w, testRole: role }; } catch {}
  const kp = KeyPairEd25519.fromRandom();
  const w = { accountId: implicitId(kp), key: kp.toString() };
  try { localStorage.setItem(KEY(role), JSON.stringify(w)); } catch {}
  return { ...w, testRole: role };
}

/** Ask the relayer for test tNEAR and USDC (testnet only). Creates an implicit account that does not exist yet. */
export async function getTestFunds(accountId: string): Promise<{ near: string; usdc: string; note?: string }> {
  const r = await fetch(`${CFG.helper}/test-funds`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `test funds ${r.status}`);
  return j;
}

/** Once per account per browser: fund a freshly connected testnet account without the user asking. */
export async function autoFund(accountId: string) {
  if (!testWalletAllowed()) return;
  const k = `covered.funded.${accountId}`;
  try { if (localStorage.getItem(k)) return; } catch {}
  try { await getTestFunds(accountId); try { localStorage.setItem(k, String(Date.now())); } catch {} }
  catch (e) { console.warn("test funds", (e as Error).message); }
}

/** Wait until the account exists on chain with this key (the relayer's transfer creates it). */
export async function waitForAccount(view: (id: string) => Promise<boolean>, accountId: string, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await view(accountId)) return; await new Promise((r) => setTimeout(r, 1500)); }
  throw new Error("the test account did not appear on chain in time");
}

/** Short display form of an implicit id: 3fa1…c0d2. Named accounts are shown as they are. */
export const shortAccount = (id: string) => (/^[0-9a-f]{64}$/.test(id) ? `${id.slice(0, 4)}…${id.slice(-4)}` : id);
