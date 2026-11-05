import express from "express";
import { Core } from "./btc/core.js";
import { esplora, type Esplora } from "./btc/proof.js";
import { checkDelegate } from "./metatx.js";
import { nearClient } from "./near/client.js";
import { tick, type Services } from "./run.js";
import { spotUsd } from "./spot.js";

const env = (k: string, d?: string) => process.env[k] ?? d ?? (() => { throw new Error(`missing env ${k}`); })();
const cfg = {
  networkId: env("NEAR_NETWORK", "testnet"), nodeUrl: env("NEAR_RPC", "https://rpc.testnet.near.org"),
  relayerId: process.env.RELAYER_ID, relayerKey: process.env.RELAYER_KEY, covered: env("COVERED_ID", "covered.testnet"),
  usdc: env("USDC_ID", "usdc.fakes.testnet"), lightClient: process.env.LIGHT_CLIENT_ID, lightClientMock: process.env.LIGHT_CLIENT_MOCK === "1",
  btcBackend: env("BTC_BACKEND", "esplora") as "esplora" | "core",
  esplora: env("ESPLORA", "https://mempool.space/testnet4/api"),
  core: { url: env("BITCOIN_RPC", "http://bitcoind:18443"), user: env("BITCOIN_RPC_USER", "covered"), pass: env("BITCOIN_RPC_PASS", "covered") },
  port: Number(env("PORT", "8787")), tickMs: Number(env("TICK_MS", "30000")),
  fixedSpot: process.env.FIXED_SPOT_USD ? Number(process.env.FIXED_SPOT_USD) : undefined,
};

const near = await nearClient(cfg);
const core = cfg.btcBackend === "core" ? new Core(cfg.core) : null;
if (core) await core.ensureWallet();
const api: Esplora = core ?? esplora(cfg.esplora);
const app = express();
app.use(express.json({ limit: "256kb" }));
app.get("/api/health", (_req, res) => res.json({ ok: true, covered: cfg.covered, network: cfg.networkId, btc: cfg.btcBackend }));

let spot = { price: cfg.fixedSpot ?? 0, sources: cfg.fixedSpot ? 1 : 0, at: cfg.fixedSpot ? Infinity : 0 };
app.get("/api/spot", async (_req, res) => {
  if (Date.now() - spot.at > 60_000) { try { spot = { ...(await spotUsd()), at: Date.now() }; } catch {} }
  res.json(spot);
});
app.post("/api/relay", async (req, res) => {
  const d = req.body?.delegateAction;
  const v = checkDelegate({ senderId: d?.senderId, receiverId: d?.receiverId, actions: (d?.actions ?? []).map((a: any) => ({ methodName: a.functionCall?.methodName, args: JSON.parse(Buffer.from(a.functionCall?.args ?? [], "base64").toString() || "{}"), gas: BigInt(a.functionCall?.gas ?? 0), deposit: BigInt(a.functionCall?.deposit ?? 0) })) },
    { covered: cfg.covered, usdc: cfg.usdc, maxGas: 300n * 10n ** 12n, maxDepositYocto: 10n ** 24n });
  if (!v.ok) return res.status(400).json({ error: v.reason });
  try { res.json({ outcome: await near.relay(req.body) }); } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// Local stack only: create and fund NEAR accounts (the testnet helper's role) and mint mock USDC.
if (process.env.DEV_ROOT_ID && process.env.DEV_ROOT_KEY) {
  const { devAccountCreator } = await import("./near/dev.js");
  const create = devAccountCreator({ nodeUrl: cfg.nodeUrl, rootId: process.env.DEV_ROOT_ID, rootKey: process.env.DEV_ROOT_KEY, usdc: cfg.usdc });
  app.post("/api/dev/account", async (req, res) => {
    try { res.json(await create(String(req.body?.newAccountId), String(req.body?.newAccountPublicKey))); } catch (e) { res.status(400).json({ error: (e as Error).message }); }
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
  app.get("/btc/block-height/:h", h((r) => core.blockHashAt(Number(r.params.h))));
  app.get("/btc/block/:hash", h((r) => core.block(r.params.hash)));
  app.post("/btc/tx", express.text({ type: "*/*" }), h((r) => core.broadcast(String(r.body).trim())));
  // dev conveniences (regtest only): faucet and mining
  app.post("/btc/dev/send", h(async (r) => ({ txid: await core.send(r.body.address, Number(r.body.btc)) })));
  app.post("/btc/dev/mine", h(async (r) => ({ blocks: await core.mine(Number(r.body?.n ?? 1)) })));
}
app.listen(cfg.port, () => console.log(`relayer on :${cfg.port} → ${cfg.covered} (${cfg.networkId}), btc=${cfg.btcBackend}`));

const services: Services = {
  near,
  esplora: api,
  broadcast: core ? (raw) => core.broadcast(raw) : async (raw) => { const r = await fetch(`${cfg.esplora}/tx`, { method: "POST", body: raw }); if (!r.ok) throw new Error(await r.text()); return r.text(); },
  addressTxs: core ? (a) => core.addressTxs(a) : async (a) => (await fetch(`${cfg.esplora}/address/${a}/txs`)).json(),
  log: (m: string) => console.log(new Date().toISOString(), m),
  // In local/sandbox mode the light client is a mock: tell it about inclusions before proving them.
  beforeProof: cfg.lightClientMock && cfg.lightClient ? async (txid, blockHash, depth) => { await near.callAny(cfg.lightClient!, "set_included", { tx_id: txid, block_hash: blockHash, depth }); } : undefined,
};
if (cfg.relayerId) setInterval(() => tick(services).catch((e) => console.error("tick", e)), cfg.tickMs);
