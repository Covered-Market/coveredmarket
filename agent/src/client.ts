/**
 * CoveredMarket for agents and scripts. One object per site and wallet:
 *
 *   const cm = await CoveredMarket.connect({ site: "https://testnet.covered.market", wallet: "seller" });
 *   const { serial, deposit } = await cm.sell({ sizeBtc: 0.001, strikeUsd: 150000, premiumUsd: 5 });
 *   await cm.depositFromFaucet(serial);              // testnet: the demo faucet pays the deposit
 *   await cm.waitFor(serial, ["Funded"]);
 *
 * Reads go straight to NEAR RPC, so this works against any deployment; writes are signed here and relayed (the
 * relayer pays gas). Keys stay on this machine (see store.ts). Testnet and the local stack only: on mainnet,
 * use a real NEAR wallet.
 */
import { Account } from "@near-js/accounts";
import { KeyPair, KeyPairEd25519 } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators, buildDelegateAction, encodeSignedDelegate } from "@near-js/transactions";
import {
  describeAccount, describeOffer, describeParams, nextExpiry, statusOf,
  type Described, type RawOffer, type RawParams, type Status,
} from "../../relayer/src/agentapi.js";
import { hex, makeKit, newKey, p2wpkh, pubOf } from "./btc.js";
import { Store, type WalletFile } from "./store.js";

export { statusOf, type Described, type Status };

export interface SiteConfig {
  mode: "local" | "testnet" | "mainnet" | "site"; network: string; rpc: string; contract: string; usdc: string;
  esplora: string; explorerBtc: string; explorerNear: string; helper: string; accountSuffix: string; faucet?: boolean; disabled?: boolean;
}

export interface SellTerms {
  /** Size in BTC (or sizeSats). */
  sizeBtc?: number; sizeSats?: number;
  /** Strike in USD per whole BTC. */
  strikeUsd: number;
  /** Premium in USD for the whole contract. */
  premiumUsd: number;
  /** Exact expiry (unix seconds, on the grid), or minutes from now (rounded up to the next valid expiry). Default: the earliest valid expiry. */
  expiryS?: number; expiresInMinutes?: number;
  /** Where unsold or unexercised coins go back to. Default: this wallet's own Bitcoin address. */
  refundAddress?: string;
}

export class CoveredMarketError extends Error {
  constructor(message: string, readonly detail?: unknown) { super(message); }
}

const TGAS = 10n ** 12n;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const units = (usd: number) => BigInt(Math.round(usd * 1e6));

/** A contract panic or relayer refusal in one readable line. */
export function reason(failure: unknown): string {
  const s = typeof failure === "string" ? failure : JSON.stringify(failure);
  const m = s.match(/Smart contract panicked: ([^"\\]+)/) ?? s.match(/"ExecutionError":"([^"]+)"/);
  return m ? m[1] : s.slice(0, 300);
}

export class CoveredMarket {
  private paramsCache?: { at: number; v: RawParams };
  private constructor(
    readonly site: string,
    readonly config: SiteConfig,
    readonly provider: JsonRpcProvider,
    readonly store: Store,
    readonly walletName: string,
    private w: WalletFile | null,
  ) {}

  static async connect(o: { site?: string; wallet?: string; home?: string } = {}) {
    const site = (o.site ?? process.env.COVEREDMARKET_SITE ?? "https://testnet.covered.market").replace(/\/$/, "");
    const r = await fetch(`${site}/config.json`, { signal: AbortSignal.timeout(20_000) }).catch((e) => { throw new CoveredMarketError(`cannot reach ${site}: ${(e as Error).message}`); });
    if (!r.ok) throw new CoveredMarketError(`${site}/config.json: HTTP ${r.status}`);
    const config = (await r.json()) as SiteConfig;
    if (config.mode === "site") throw new CoveredMarketError(`${site} is the website, not an app. Use the testnet app: https://testnet.covered.market`);
    if (config.disabled) throw new CoveredMarketError(`${site} has no contract yet`);
    if (config.mode === "mainnet" || config.network === "mainnet") throw new CoveredMarketError("this toolkit holds keys in files and is for testnet and the local stack only; on mainnet use a NEAR wallet");
    const rpc = /^https?:/.test(config.rpc) ? config.rpc : new URL(config.rpc, site).toString();
    const store = new Store(site, o.home);
    const name = o.wallet ?? process.env.COVEREDMARKET_WALLET ?? "default";
    return new CoveredMarket(site, config, new JsonRpcProvider({ url: rpc }), store, name, store.loadWallet(name));
  }

  get hrp() { return this.config.mode === "local" ? "bcrt" : "tb"; }
  // The relayer's API is at /api on every app, as the web app calls it. (config.helper is the account helper's base,
  // /api/dev on the local stack, not the API's.)
  private api(path: string) { return `${this.site}/api${path}`; }
  private async post(path: string, body: unknown) {
    const r = await fetch(this.api(path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new CoveredMarketError(j.error ?? `${path}: HTTP ${r.status}`, j);
    return j;
  }

  // ───────── reads ─────────

  async view<T>(method: string, args: Record<string, unknown> = {}, contract = this.config.contract): Promise<T> {
    for (let i = 0; ; i++) {
      try {
        const r: any = await this.provider.query({ request_type: "call_function", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "optimistic" });
        return JSON.parse(Buffer.from(r.result).toString());
      } catch (e) { if (i >= 3 || /panicked|MethodNotFound/.test(String(e))) throw e; await sleep(1000 * (i + 1)); }
    }
  }
  async now() { return Number(BigInt((await this.provider.block({ finality: "optimistic" })).header.timestamp_nanosec) / 1_000_000_000n); }
  async rawParams() {
    if (!this.paramsCache || Date.now() - this.paramsCache.at > 60_000) this.paramsCache = { at: Date.now(), v: await this.view<RawParams>("get_params") };
    return this.paramsCache.v;
  }
  private get ctx() { return { contract: this.config.contract, usdc: this.config.usdc }; }

  /** The deployment's rules: size limits, expiry grid and the next valid expiries, windows, fees. */
  async params() { return describeParams(await this.rawParams(), await this.now(), this.ctx); }

  async rawOffer(serial: number) { return this.view<RawOffer | null>("get_offer", { serial }); }
  async offer(serial: number): Promise<Described> {
    const [o, p, t] = await Promise.all([this.rawOffer(serial), this.rawParams(), this.now()]);
    if (!o) throw new CoveredMarketError(`no offer CV-${serial}`);
    return describeOffer(o, p, t, this.ctx);
  }
  /** Live offers, optionally only one status: awaiting_deposit, for_sale, sold, settling. */
  async offers(status?: Status) {
    const page = async (m: string) => { const all: RawOffer[] = []; for (let i = 0; i < 50; i++) { const got = await this.view<RawOffer[]>(m, { from: i * 200, limit: 200 }); all.push(...got); if (got.length < 200) break; } return all; };
    const [p, t, created, open] = await Promise.all([this.rawParams(), this.now(), page("get_created"), page("get_offers")]);
    return [...created, ...open].sort((a, b) => a.serial - b.serial).map((o) => describeOffer(o, p, t, this.ctx))
      .filter((d) => (status ? statusOf(d, t) === status : statusOf(d, t) !== null));
  }
  /** An account's offers (selling and buying), claimable USDC and balances. Default: this wallet. */
  async account(id?: string) {
    const who = id ?? (await this.wallet()).accountId;
    const [p, t, offers, claimable] = await Promise.all([this.rawParams(), this.now(), this.view<RawOffer[]>("get_account_offers", { account: who }), this.view<string>("get_claimable", { account: who })]);
    const d = describeAccount(who, String(claimable), offers.map((o) => describeOffer(o, p, t, this.ctx)), this.ctx);
    const balances = await this.balances(who);
    return { ...d, balances, ...(id ? {} : { bitcoin_address: this.btcAddress() }) };
  }
  async balances(id: string) {
    let near: number | null = null;
    try { const r: any = await this.provider.query({ request_type: "view_account", account_id: id, finality: "optimistic" }); near = Number(BigInt(r.amount) / 10n ** 18n) / 1e6; } catch {}
    const usdc = await this.view<string>("ft_balance_of", { account_id: id }, this.config.usdc).catch(() => "0");
    return { near, usdc: Number(usdc) / 1e6, usdc_units: String(usdc) };
  }

  // ───────── wallet ─────────

  /** This wallet: loaded from its file, or made and funded on first use (testnet test funds; local sandbox account). */
  async wallet(): Promise<WalletFile> {
    if (this.w) return this.w;
    const envId = process.env.NEAR_ACCOUNT_ID, envKey = process.env.NEAR_PRIVATE_KEY;
    const btcKey = hex.to(newKey().priv);
    let w: WalletFile;
    if (envId && envKey) {
      w = { accountId: envId, nearKey: envKey, btcKey, pendingRescue: {}, created: new Date().toISOString() };
    } else if (this.config.mode === "testnet") {
      if (!this.config.faucet) throw new CoveredMarketError("this site has no test funds: set NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY for an account you hold");
      const kp = KeyPairEd25519.fromRandom();
      w = { accountId: hex.to(kp.getPublicKey().data), nearKey: kp.toString(), btcKey, pendingRescue: {}, created: new Date().toISOString() };
      this.store.saveWallet(this.walletName, w); // the key is on disk before anything is funded
      await this.post("/test-funds", { accountId: w.accountId });
      await this.waitForAccount(w.accountId);
    } else {
      const kp = KeyPairEd25519.fromRandom();
      const name = `${this.walletName.toLowerCase().replace(/[^a-z0-9-]/g, "")}-${Date.now().toString(36)}`;
      const j = await this.post("/dev/account", { newAccountId: `${name}.${this.config.accountSuffix || this.config.network}`, newAccountPublicKey: kp.getPublicKey().toString() });
      w = { accountId: j.accountId, nearKey: kp.toString(), btcKey, pendingRescue: {}, created: new Date().toISOString() };
    }
    this.store.saveWallet(this.walletName, w);
    this.w = w;
    return w;
  }
  private async waitForAccount(id: string, ms = 90_000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { await this.provider.query({ request_type: "view_account", account_id: id, finality: "optimistic" }); return; } catch {}
      await sleep(1500);
    }
    throw new CoveredMarketError(`account ${id} did not appear on chain in time`);
  }
  /** This wallet's own Bitcoin receive address (P2WPKH), the default refund and delivery address. */
  btcAddress() {
    if (!this.w) throw new CoveredMarketError("no wallet yet");
    return p2wpkh(pubOf(hex.from(this.w.btcKey)), this.hrp);
  }
  /** Testnet: top up tNEAR and test USDC (rate-limited by the site). */
  async testFunds() {
    if (this.config.mode !== "testnet") throw new CoveredMarketError("test funds exist on testnet only (local accounts start funded)");
    return this.post("/test-funds", { accountId: (await this.wallet()).accountId });
  }

  // ───────── writes ─────────

  /** Call a method as this wallet. Gas through the relayer (NEP-366); a direct transaction if the relayer is unreachable. */
  async call(receiverId: string, method: string, args: Record<string, unknown>, depositYocto = 0n, gasTgas = 150): Promise<any> {
    const w = await this.wallet();
    const kp = KeyPair.fromString(w.nearKey as any);
    const gas = BigInt(gasTgas) * TGAS;
    let relayed: Response | null = null;
    for (let attempt = 0; ; attempt++) {
      try {
        // The nonce at "optimistic": the previous call has just executed, and "final" can still show the old nonce.
        const ak: any = await this.provider.query({ request_type: "view_access_key", account_id: w.accountId, public_key: kp.getPublicKey().toString(), finality: "optimistic" });
        const block = await this.provider.block({ finality: "final" });
        const delegate = buildDelegateAction({ senderId: w.accountId, receiverId, actions: [actionCreators.functionCall(method, args, gas, depositYocto)], nonce: BigInt(ak.nonce) + 1n, maxBlockHeight: BigInt(block.header.height) + 100n, publicKey: kp.getPublicKey() });
        const [, signed] = await new KeyPairSigner(kp).signDelegateAction(delegate);
        relayed = await fetch(this.api("/relay"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedDelegate: Buffer.from(encodeSignedDelegate(signed)).toString("base64") }), signal: AbortSignal.timeout(120_000) });
      } catch { relayed = null; }
      // A stale nonce means the call was rejected before it ran, so it is safe to sign again with a fresh one.
      if (relayed?.status === 422 && attempt < 2) {
        const body = await relayed.clone().text().catch(() => "");
        if (body.includes("DelegateActionInvalidNonce")) { await sleep(1500); continue; }
      }
      break;
    }
    if (relayed) {
      const j: any = await relayed.json().catch(() => ({}));
      if (relayed.ok) return j.value !== undefined && j.value !== "" ? JSON.parse(j.value) : null;
      if (relayed.status === 422) throw new CoveredMarketError(`${method} failed: ${reason(j.failure)}`, j.failure); // it ran and failed: do not resend
      if (relayed.status === 400) throw new CoveredMarketError(`relayer refused ${method}: ${j.error}`, j);
    }
    const acct = new Account(w.accountId, this.provider, new KeyPairSigner(kp));
    try { return await acct.callFunction({ contractId: receiverId, methodName: method, args, gas, deposit: depositYocto }); }
    catch (e) { throw new CoveredMarketError(`${method} failed: ${reason(String((e as Error).message ?? e))}`); }
  }

  /**
   * Create an offer to sell a call. Makes the rescue key first and writes the rescue kit after, so the seller always
   * holds a Bitcoin-only exit. Returns the deposit to make: exactly `deposit.amount_sats` to `deposit.address`.
   */
  async sell(t: SellTerms) {
    const [p, now, w] = await Promise.all([this.rawParams(), this.now(), this.wallet()]);
    const sizeSats = t.sizeSats ?? Math.round((t.sizeBtc ?? 0) * 1e8);
    if (!(sizeSats >= p.min_size_sats && sizeSats <= p.max_size_sats)) throw new CoveredMarketError(`size must be ${p.min_size_sats}–${p.max_size_sats} sats (${p.min_size_sats / 1e8}–${p.max_size_sats / 1e8} BTC)`);
    if (!(t.strikeUsd > 0 && t.premiumUsd > 0)) throw new CoveredMarketError("strikeUsd and premiumUsd must be > 0");
    const expiry = t.expiryS ?? nextExpiry(p, now, (t.expiresInMinutes ?? 0) * 60);
    if (expiry % p.expiry_step_s !== p.expiry_offset_s || expiry < now + p.min_lead_s) throw new CoveredMarketError(`expiry ${expiry} is not valid: ${describeParams(p, now, this.ctx).expiry.rule}`);
    const refund = t.refundAddress ?? this.btcAddress();
    const rescue = newKey();
    const pub = hex.to(rescue.pub33);
    w.pendingRescue[pub] = hex.to(rescue.priv);
    this.store.saveWallet(this.walletName, w); // before the offer exists: a crash still leaves the key to make the kit
    const terms = { size_sats: String(sizeSats), strike_units: String(units(t.strikeUsd)), premium_units: String(units(t.premiumUsd)), expiry_s: String(expiry), refund_address: refund, rescue_pubkey: pub };
    const v = await this.call(this.config.contract, "create_offer", { terms }, 10n ** 23n, 60);
    let serial = typeof v === "number" ? v : NaN;
    if (!Number.isFinite(serial)) {
      const mine = await this.view<RawOffer[]>("get_account_offers", { account: w.accountId });
      serial = mine.filter((o: any) => o.rescue_pubkey === pub).map((o) => o.serial).pop() ?? NaN;
      if (!Number.isFinite(serial)) throw new CoveredMarketError("create_offer ran but the new offer was not found; the rescue key is kept in the wallet file");
    }
    const kit = await this.writeKit(serial);
    const offer = await this.offer(serial);
    return { serial, id: `CV-${serial}`, deposit: { address: offer.deposit.address, amount_sats: offer.deposit.amount_sats }, rescue_kit: kit, offer };
  }
  /** Write the rescue kit for one of this wallet's offers from its pending key. Returns the kit's path. */
  async writeKit(serial: number) {
    const w = await this.wallet();
    if (this.store.hasKit(this.config.contract, serial)) return this.store.kitPath(this.config.contract, serial);
    const o: any = await this.rawOffer(serial);
    const priv = o && w.pendingRescue[o.rescue_pubkey];
    if (!priv) throw new CoveredMarketError(`no rescue key for CV-${serial} in this wallet`);
    const path = this.store.saveKit(this.config.contract, serial, makeKit(o, hex.from(priv), this.config));
    delete w.pendingRescue[o.rescue_pubkey];
    this.store.saveWallet(this.walletName, w);
    return path;
  }

  /** Testnet and local: have the site's demo faucet pay an offer's deposit. */
  async depositFromFaucet(serial: number) {
    if (this.config.mode === "mainnet") throw new CoveredMarketError("no faucet on mainnet");
    return this.post("/btc-faucet", { serial });
  }

  /** Buy a for-sale offer: pays the premium in USDC. The coins go to `btcAddress` if you later exercise (default: this wallet's). */
  async buy(serial: number, btcAddress?: string) {
    const d = await this.offer(serial), t = await this.now();
    if (statusOf(d, t) !== "for_sale") throw new CoveredMarketError(`CV-${serial} is not for sale (${d.summary})`);
    const w = await this.wallet();
    const to = btcAddress ?? this.btcAddress();
    await this.call(this.config.usdc, "ft_transfer_call", { receiver_id: this.config.contract, amount: d.premium.units, msg: JSON.stringify({ serial, btc_address: to }) }, 1n, 100);
    const after = await this.offer(serial);
    if (after.buyer !== w.accountId) throw new CoveredMarketError(`the premium was returned and CV-${serial} was not bought (${after.summary})`);
    return after;
  }

  /** Exercise inside the window: pays the strike; the coins are delivered to the address given at purchase. */
  async exercise(serial: number, o: { skipDepthCheck?: boolean } = {}) {
    const d = await this.offer(serial);
    const w = await this.wallet();
    if (d.state !== "Sold" || d.buyer !== w.accountId) throw new CoveredMarketError(`CV-${serial} is not exercisable by ${w.accountId} (${d.summary})`);
    const t = await this.now();
    if (t < d.exercise_window.opens_s || t >= d.exercise_window.closes_s) throw new CoveredMarketError(`the exercise window is ${d.exercise_window.opens_utc} to ${d.exercise_window.closes_utc}`);
    const msg = o.skipDepthCheck ? { serial, exercise: true, skip_depth_check: true } : { serial, exercise: true };
    await this.call(this.config.usdc, "ft_transfer_call", { receiver_id: this.config.contract, amount: d.strike.total_units, msg: JSON.stringify(msg) }, 1n, 300);
    return this.offer(serial);
  }

  async cancel(serial: number) { await this.call(this.config.contract, "cancel", { serial }, 0n, 30); return this.offer(serial); }
  async withdraw(serial: number) { await this.call(this.config.contract, "withdraw", { serial }, 0n, 300); return this.offer(serial); }
  async reclaimStrike(serial: number) { await this.call(this.config.contract, "reclaim_strike", { serial }, 0n, 30); return this.offer(serial); }
  /** Pay out everything the contract owes this wallet (premiums, strikes) in USDC. */
  async claim() {
    const w = await this.wallet();
    const owed = await this.view<string>("get_claimable", { account: w.accountId });
    if (String(owed) === "0") return { claimed_usd: 0 };
    await this.call(this.config.contract, "claim", {}, 0n, 60);
    return { claimed_usd: Number(owed) / 1e6, claimed_units: String(owed) };
  }

  /** Poll until the offer reaches one of `states` (e.g. ["Funded"], ["Kept", "Exercised"]). */
  async waitFor(serial: number, states: string[], o: { timeoutS?: number; everyS?: number; onTick?: (d: Described) => void } = {}) {
    const t0 = Date.now(), timeout = (o.timeoutS ?? 900) * 1000;
    for (;;) {
      const d = await this.offer(serial);
      o.onTick?.(d);
      if (states.includes(d.state)) return d;
      if (d.final) throw new CoveredMarketError(`CV-${serial} ended ${d.state}, not ${states.join(" or ")}`);
      if (Date.now() - t0 > timeout) throw new CoveredMarketError(`timed out waiting for CV-${serial} to reach ${states.join(" or ")} (now ${d.state}: ${d.summary})`);
      await sleep((o.everyS ?? 15) * 1000);
    }
  }
}
