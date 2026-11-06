import express from "express";
import { Core } from "./btc/core.js";
import { failoverFetch } from "./btc/failover.js";
import { esploraFaucet, type FaucetWallet } from "./btc/faucet.js";
import { esplora, type Esplora } from "./btc/proof.js";
import { checkDelegate } from "./metatx.js";
import { decodeSignedDelegate, relayResult, viewOf } from "./near/delegate.js";
import { nearClient } from "./near/client.js";
import { tick, type Services } from "./run.js";
import { spotUsd } from "./spot.js";

const env = (k: string, d?: string) => process.env[k] ?? d ?? (() => { throw new Error(`missing env ${k}`); })();
const cfg = {
  networkId: env("NEAR_NETWORK", "testnet"), nodeUrl: env("NEAR_RPC", "https://rpc.testnet.fastnear.com"),
  relayerId: process.env.RELAYER_ID, relayerKey: process.env.RELAYER_KEY, covered: env("COVERED_ID", "covered.testnet"),
  usdc: env("USDC_ID", "usdc.fakes.testnet"), lightClient: process.env.LIGHT_CLIENT_ID, lightClientMock: process.env.LIGHT_CLIENT_MOCK === "1",
  btcBackend: env("BTC_BACKEND", "esplora") as "esplora" | "core",
  esplora: env("ESPLORA", "https://mempool.space/testnet/api,https://blockstream.info/testnet/api"),
  core: { url: env("BITCOIN_RPC", "http://bitcoind:18443"), user: env("BITCOIN_RPC_USER", "covered"), pass: env("BITCOIN_RPC_PASS", "covered") },
  port: Number(env("PORT", "8787")), tickMs: Number(env("TICK_MS", "30000")),
  fixedSpot: process.env.FIXED_SPOT_USD ? Number(process.env.FIXED_SPOT_USD) : undefined,
};

const near = await nearClient(cfg);
const core = cfg.btcBackend === "core" ? new Core(cfg.core) : null;
if (core) await core.ensureWallet();
const btcGet = failoverFetch(cfg.esplora);
const api: Esplora = core ?? esplora(cfg.esplora);
const app = express();
app.use(express.json({ limit: "256kb" }));
let relayed = 0; // meta-transactions relayed successfully since start (the e2e asserts the UI went this way)
app.get("/api/health", (_req, res) => res.json({ ok: true, covered: cfg.covered, network: cfg.networkId, btc: cfg.btcBackend, relayed }));

let spot = { price: cfg.fixedSpot ?? 0, sources: cfg.fixedSpot ? 1 : 0, at: cfg.fixedSpot ? Infinity : 0 };
app.get("/api/spot", async (_req, res) => {
  if (Date.now() - spot.at > 60_000) { try { spot = { ...(await spotUsd()), at: Date.now() }; } catch {} }
  res.json(spot);
});
app.post("/api/relay", async (req, res) => {
  let sd: any;
  try { sd = decodeSignedDelegate(String(req.body?.signedDelegate ?? "")); } catch { return res.status(400).json({ error: "signedDelegate must be base64 borsh" }); }
  const v = checkDelegate(viewOf(sd), { covered: cfg.covered, usdc: cfg.usdc, maxGas: 300n * 10n ** 12n, maxDepositYocto: 10n ** 24n });
  if (!v.ok) return res.status(400).json({ error: v.reason });
  try {
    const outcome: any = await near.relay(sd);
    const r = relayResult(outcome, sd.delegateAction.receiverId);
    const what = `${sd.delegateAction.senderId} → ${sd.delegateAction.receiverId}.${viewOf(sd).actions.map((a) => a.methodName).join(",")}`;
    if (r.ok) { relayed++; console.log(new Date().toISOString(), `relay ok ${what} → ${r.value || "(no value)"}`); }
    else console.log(new Date().toISOString(), `relay failed ${what}: ${JSON.stringify(r.failure).slice(0, 300)}`);
    res.status(r.ok ? 200 : 422).json(r);
  } catch (e) { console.error(new Date().toISOString(), "relay error", (e as Error).message); res.status(500).json({ error: (e as Error).message }); }
});

// Local stack only: create and fund NEAR accounts (the testnet helper's role) and mint mock USDC.
if (process.env.DEV_ROOT_ID && process.env.DEV_ROOT_KEY) {
  const { devAccountCreator } = await import("./near/dev.js");
  const create = devAccountCreator({ nodeUrl: cfg.nodeUrl, rootId: process.env.DEV_ROOT_ID, rootKey: process.env.DEV_ROOT_KEY, usdc: cfg.usdc });
  app.post("/api/dev/account", async (req, res) => {
    try { res.json(await create(String(req.body?.newAccountId), String(req.body?.newAccountPublicKey))); } catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });
}

// Demo faucet for test Bitcoin: pays the deposit of one of *our* offers that is still waiting for it, exactly its
// size, capped and rate-limited. Testnet: a key generated on this server (fund its address from any testnet3
// faucet); local sandbox: the regtest miner. Never on mainnet.
if (cfg.networkId !== "mainnet" && (process.env.BTC_FAUCET ?? "1") === "1") {
  const MAX = BigInt(env("BTC_FAUCET_MAX_SATS", "200000")), PER_HOUR = Number(env("BTC_FAUCET_PER_HOUR", "3")), PER_DAY = Number(env("BTC_FAUCET_PER_DAY", "40"));
  const wallet: FaucetWallet = core
    ? { address: "regtest miner", balance: async () => ({ confirmed: 10n ** 15n, unconfirmed: 0n }), pay: async (to, sats) => { const id = await core.send(to, Number(sats) / 1e8); await core.mine(1); return id; } }
    : esploraFaucet(env("BTC_FAUCET_KEY_FILE", "/data/btc-faucet.key"), btcGet);
  console.log(`btc faucet: ${wallet.address} (max ${MAX} sats per deposit)`);
  const byIp = new Map<string, number[]>(); let day: number[] = []; const paid = new Set<number>();
  app.get("/api/btc-faucet", async (_req, res) => {
    try { const b = await wallet.balance(); res.json({ enabled: true, address: wallet.address, confirmed: String(b.confirmed), unconfirmed: String(b.unconfirmed), maxSats: String(MAX) }); }
    catch (e) { res.json({ enabled: true, address: wallet.address, error: (e as Error).message, maxSats: String(MAX) }); }
  });
  app.post("/api/btc-faucet", async (req, res) => {
    const serial = Number(req.body?.serial);
    const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
    const now = Date.now(), recent = (byIp.get(ip) ?? []).filter((t) => now - t < 3600_000); day = day.filter((t) => now - t < 86_400_000);
    if (!Number.isInteger(serial) || serial < 0) return res.status(400).json({ error: "which offer?" });
    if (recent.length >= PER_HOUR || day.length >= PER_DAY) return res.status(429).json({ error: "the demo faucet is resting; try again later or send from your own testnet wallet" });
    if (paid.has(serial)) return res.status(409).json({ error: "this deposit was already sent by the faucet" });
    try {
      const o: any = await near.view("get_offer", { serial });
      if (!o || o.state !== "Created") return res.status(409).json({ error: "this offer is not waiting for a deposit" });
      const sats = BigInt(o.size_sats);
      if (sats > MAX) return res.status(400).json({ error: `the demo faucet funds offers up to ${Number(MAX) / 1e8} BTC; make a smaller one or send from your own wallet` });
      const txs = await services.addressTxs(o.address);
      if (Array.isArray(txs) && txs.length) return res.status(409).json({ error: "something was already sent to this address" });
      paid.add(serial); byIp.set(ip, [...recent, now]); day.push(now);
      const txid = await wallet.pay(o.address, sats);
      console.log(new Date().toISOString(), `btc faucet paid CV-${serial} ${sats} sats → ${o.address}: ${txid}`);
      res.json({ ok: true, txid, sats: String(sats), address: o.address });
    } catch (e) { paid.delete(serial); console.error(new Date().toISOString(), "btc faucet", (e as Error).message); res.status(500).json({ error: (e as Error).message }); }
  });
}

// Testnet: create a wallet for a visitor through the NEAR testnet faucet helper (server-side, so no CORS and one
// place to rate-limit), then mint them mock USDC. Off unless ACCOUNT_FAUCET=1; never on mainnet.
if (process.env.ACCOUNT_FAUCET === "1" && cfg.networkId === "testnet") {
  const seen = new Map<string, number[]>();
  const HOUR = 3600_000, PER_HOUR = Number(process.env.ACCOUNT_FAUCET_PER_HOUR ?? 5);
  app.post("/api/account", async (req, res) => {
    const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
    const recent = (seen.get(ip) ?? []).filter((t) => Date.now() - t < HOUR);
    if (recent.length >= PER_HOUR) return res.status(429).json({ error: "too many new wallets from this address; try again later" });
    const id = String(req.body?.newAccountId ?? ""), pk = String(req.body?.newAccountPublicKey ?? "");
    if (!/^[a-z0-9][a-z0-9_-]{1,40}\.testnet$/.test(id) || !/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(pk)) return res.status(400).json({ error: "bad account id or key" });
    try {
      let accountId = id;
      const r = await fetch(process.env.NEAR_HELPER_URL ?? "https://helper.testnet.near.org/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: pk }) }).catch(() => null);
      if (r?.status === 409) return res.status(409).json({ error: "that name is taken" });
      if (!r?.ok) {
        // The public faucet rate-limits this server's IP. Make the account ourselves instead, as a
        // sub-account of the relayer with a little NEAR (gas is relayed anyway).
        accountId = `${id.replace(/\.testnet$/, "")}.${cfg.relayerId}`;
        if (accountId.length > 64) return res.status(400).json({ error: "name too long" });
        try { await near.createSubAccount(accountId, pk, 10n ** 23n); }
        catch (e) { return res.status(/exist/i.test(String(e)) ? 409 : 500).json({ error: /exist/i.test(String(e)) ? "that name is taken" : (e as Error).message }); }
      }
      seen.set(ip, [...recent, Date.now()]);
      if (process.env.USDC_MINT === "1") await near.callAny(cfg.usdc, "mint", { account_id: accountId, amount: String(100_000n * 1_000_000n) });
      res.json({ ok: true, accountId, usdc: process.env.USDC_MINT === "1" ? "100000" : "0" });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
}

// Esplora-compatible subset for the web app when running against Bitcoin Core.
if (core) {
  const h = (f: (req: express.Request) => Promise<unknown>) => async (req: express.Request, res: express.Response) => { try { const r = await f(req); typeof r === "string" ? res.type("text").send(r) : res.json(r); } catch (e) { res.status(404).json({ error: (e as Error).message }); } };
  app.get("/btc/address/:a/txs", h((r) => core.addressTxs(r.params.a)));
  app.get("/btc/tx/:id/status", h(async (r) => { const s = await core.txStatus(r.params.id); if (!s) throw new Error("not found"); return s; }));
  app.get("/btc/tx/:id/hex", h((r) => core.txHex(r.params.id)));
  app.get("/btc/tx/:id/merkle-proof", h((r) => core.merkleProof(r.params.id)));
  app.get("/btc/tx/:id/outspend/:v", h((r) => core.outspend(r.params.id, Number(r.params.v))));
  app.get("/btc/blocks/tip/height", h(async () => String(await core.tipHeight())));
  app.get("/btc/blocks/tip/hash", h(() => core.tipHash()));
  app.get("/btc/address/:a/utxo", h((r) => core.utxos(r.params.a)));
  app.get("/btc/fee-estimates", h(async () => ({ "1": 2, "3": 2, "6": 1 })));
  app.get("/btc/block-height/:h", h((r) => core.blockHashAt(Number(r.params.h))));
  app.get("/btc/block/:hash", h((r) => core.block(r.params.hash)));
  app.get("/btc/block/:hash/txids", h((r) => core.blockTxids(r.params.hash)));
  app.post("/btc/tx", express.text({ type: "*/*" }), h((r) => core.broadcast(String(r.body).trim())));
  // dev conveniences (regtest only): faucet and mining
  app.post("/btc/dev/send", h(async (r) => ({ txid: await core.send(r.body.address, Number(r.body.btc)) })));
  app.post("/btc/dev/mine", h(async (r) => ({ blocks: await core.mine(Number(r.body?.n ?? 1)) })));
  app.post("/btc/dev/address", h(async () => ({ address: await core.newAddress() })));
  // Regtest only: jump Bitcoin's clock forward and mine so median time past follows (tests the seller's exit).
  app.post("/btc/dev/mocktime", h(async (r) => { await core.mocktime(Number(r.body.t)); return { blocks: await core.mine(Number(r.body?.mine ?? 12)) }; }));
}
app.listen(cfg.port, () => console.log(`relayer on :${cfg.port} → ${cfg.covered} (${cfg.networkId}), btc=${cfg.btcBackend}`));

const services: Services = {
  near,
  esplora: api,
  broadcast: core ? (raw) => core.broadcast(raw) : async (raw) => { const r = await btcGet(`/tx`, { method: "POST", body: raw }); if (!r.ok) throw new Error(await r.text()); return r.text(); },
  addressTxs: core ? (a) => core.addressTxs(a) : async (a) => (await btcGet(`/address/${a}/txs`)).json(),
  log: (m: string) => console.log(new Date().toISOString(), m),
  // In local/sandbox mode the light client is a mock: tell it about inclusions before proving them.
  beforeProof: cfg.lightClientMock && cfg.lightClient ? async (txid, blockHash, depth) => { await near.callAny(cfg.lightClient!, "set_included", { tx_id: txid, block_hash: blockHash, depth }); } : undefined,
};
if (cfg.relayerId) setInterval(() => tick(services).catch((e) => console.error("tick", e)), cfg.tickMs);
