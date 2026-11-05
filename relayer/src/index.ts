import express from "express";
import { esplora } from "./btc/proof.js";
import { checkDelegate } from "./metatx.js";
import { nearClient } from "./near/client.js";
import { tick } from "./run.js";
import { spotUsd } from "./spot.js";

const env = (k: string, d?: string) => process.env[k] ?? d ?? (() => { throw new Error(`missing env ${k}`); })();
const cfg = {
  networkId: env("NEAR_NETWORK", "testnet"), nodeUrl: env("NEAR_RPC", "https://rpc.testnet.near.org"),
  relayerId: process.env.RELAYER_ID, relayerKey: process.env.RELAYER_KEY, covered: env("COVERED_ID", "covered.testnet"),
  usdc: env("USDC_ID", "usdc.fakes.testnet"), esplora: env("ESPLORA", "https://mempool.space/testnet4/api"), port: Number(env("PORT", "8787")),
};

const near = await nearClient(cfg);
const api = esplora(cfg.esplora);
const app = express();
app.use(express.json({ limit: "256kb" }));
app.get("/api/health", (_req, res) => res.json({ ok: true, covered: cfg.covered, network: cfg.networkId }));
let spot = { price: 0, sources: 0, at: 0 };
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
app.listen(cfg.port, () => console.log(`relayer on :${cfg.port} → ${cfg.covered} (${cfg.networkId}), esplora ${cfg.esplora}`));

const services = {
  near,
  esplora: api,
  broadcast: async (raw: string) => { const r = await fetch(`${cfg.esplora}/tx`, { method: "POST", body: raw }); if (!r.ok) throw new Error(await r.text()); return r.text(); },
  addressTxs: async (a: string) => (await fetch(`${cfg.esplora}/address/${a}/txs`)).json(),
  log: (m: string) => console.log(new Date().toISOString(), m),
};
if (cfg.relayerId) setInterval(() => tick(services).catch((e) => console.error("tick", e)), 30_000);
