/**
 * Local bootstrap: deploys the four contracts to the sandbox, creates the
 * relayer and two demo users, funds a regtest wallet, and appends the
 * resulting ids and keys to /env/.env so the relayer and web pick them up.
 * Idempotent: a second run finds the marker in .env and exits.
 */
import { Account } from "@near-js/accounts";
import { KeyPair, KeyPairEd25519 } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators } from "@near-js/transactions";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";

const RPC = process.env.NEAR_RPC ?? "http://near-sandbox:3030";
const ENV = "/env/.env";
const env = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
if (env.includes("# --- covered local bootstrap ---")) { console.log("already bootstrapped"); process.exit(0); }

const validator = JSON.parse(readFileSync("/sandbox/validator_key.json", "utf8"));
const ROOT = validator.account_id as string; // test.near
const provider = new JsonRpcProvider({ url: RPC });
const rootKey = KeyPair.fromString(validator.secret_key);
const root = new Account(ROOT, provider, new KeyPairSigner(rootKey));
const NEAR = 10n ** 24n;

async function create(name: string, near: bigint, kp = KeyPairEd25519.fromRandom()) {
  const id = `${name}.${ROOT}`;
  await root.signAndSendTransaction({ receiverId: id, actions: [actionCreators.createAccount(), actionCreators.transfer(near * NEAR), actionCreators.addKey(kp.getPublicKey(), actionCreators.fullAccessKey())] });
  return { id, kp, account: new Account(id, provider, new KeyPairSigner(kp)) };
}
async function deploy(name: string, wasm: string, initMethod: string, args: Record<string, unknown>) {
  const a = await create(name, 100n);
  await a.account.signAndSendTransaction({ receiverId: a.id, actions: [actionCreators.deployContract(readFileSync(`/wasm/${wasm.replace(/-/g, "_")}.wasm`)), actionCreators.functionCall(initMethod, args, 100n * 10n ** 12n, 0n)] });
  return a;
}
const view = async (c: string, m: string, args = {}) => JSON.parse(Buffer.from(((await provider.query({ request_type: "call_function", account_id: c, method_name: m, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "final" })) as any).result).toString());

const ROOT_SCALAR = "0b".repeat(32);
const signer = await deploy("signer", "mock-signer", "new", { root_scalar_hex: ROOT_SCALAR });
const rootKeyHex: string = await view(signer.id, "root_key_hex");
const lc = await deploy("btc-client", "mock-btc-client", "new", {});
const usdc = await deploy("usdc", "mock-usdc", "new", {});
const covered = await deploy("covered", "covered", "new", { params: {
  signer: signer.id, light_client: lc.id, usdc: usdc.id, usdc_decimals: 6, network: "Regtest", min_conf: 1, fee_sats: 1000,
  grace_s: 600, buy_cutoff_s: 0, min_lead_s: 60, escrow_timeout_s: 3600, min_size_sats: 100000,
  mpc_root_key: rootKeyHex, derivation_prefix: "near-mpc-recovery v0.1.0 epsilon derivation:", sign_format: 2, sign_deposit: "50000000000000000000000",
}});
await covered.account.callFunction({ contractId: usdc.id, methodName: "storage_deposit", args: {}, gas: 30n * 10n ** 12n, deposit: 10n ** 22n });
// Local only: the contract keeps no admin key either; delete its full-access key like production.
await covered.account.signAndSendTransaction({ receiverId: covered.id, actions: [actionCreators.deleteKey(covered.kp.getPublicKey())] });
const relayer = await create("relayer", 50n);
for (const u of ["astrid", "marcus"]) { const a = await create(u, 20n); await root.callFunction({ contractId: usdc.id, methodName: "mint", args: { account_id: a.id, amount: "1000000000000" }, gas: 30n * 10n ** 12n }); appendFileSync("/config/demo-keys.txt", `${a.id} ${a.kp.toString()}\n`); }

// Regtest: a funded mining wallet so `covered btc send` works immediately.
const btc = async (m: string, p: unknown[] = [], wallet = "") => { const r = await fetch(`${process.env.BITCOIN_RPC ?? "http://bitcoind:18443"}${wallet ? "/wallet/" + wallet : ""}`, { method: "POST", headers: { authorization: "Basic " + Buffer.from("covered:covered").toString("base64") }, body: JSON.stringify({ method: m, params: p }) }); const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result; };
try { await btc("createwallet", ["covered", true, true, "", false, true]); } catch {}
try { await btc("createwallet", ["miner"]); } catch { await btc("loadwallet", ["miner"]).catch(() => {}); }
const mineTo = await btc("getnewaddress", [], "miner");
await btc("generatetoaddress", [101, mineTo]);

const lines = `
# --- covered local bootstrap --- (generated; delete this block to re-bootstrap)
MODE=local
NEAR_NETWORK=sandbox
NEAR_RPC=http://near-sandbox:3030
WEB_NEAR_RPC=http://localhost:3030
COVERED_ID=${covered.id}
USDC_ID=${usdc.id}
SIGNER_ID=${signer.id}
LIGHT_CLIENT_ID=${lc.id}
RELAYER_ID=${relayer.id}
RELAYER_KEY=${relayer.kp.toString()}
DEV_ROOT_ID=${ROOT}
DEV_ROOT_KEY=${validator.secret_key}
ESPLORA=http://relayer:8787/btc
WEB_ESPLORA=/btc
EXPLORER_BTC=http://localhost/btc
EXPLORER_NEAR=http://localhost:3030
MIN_CONF=1
HELPER=/api/dev
`;
appendFileSync(ENV, lines);
console.log(`bootstrapped: covered=${covered.id} usdc=${usdc.id} signer=${signer.id} light-client=${lc.id} relayer=${relayer.id}; demo users astrid.${ROOT}, marcus.${ROOT} (keys in the config volume: demo-keys.txt)`);
