/**
 * Cloud first start on NEAR testnet, when .env names no contract yet (`bin/covered serve` runs it once).
 * Creates throwaway accounts with the testnet faucet helper, deploys `covered` wired to the REAL MPC signer
 * and the REAL Bitcoin light client (btc-client-v4.testnet, which follows Bitcoin testnet3) plus a mock USDC
 * anyone can mint (Circle's testnet USDC cannot be minted), deletes the contract's only key, and writes the
 * ids, the relayer key and the code hash into /env/.env. Nothing here holds funds of value.
 */
import { Account } from "@near-js/accounts";
import { KeyPair, KeyPairEd25519 } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators } from "@near-js/transactions";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ENV = "/env/.env";
const env = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
if (/^COVERED_ID=.+/m.test(env)) { console.log("contract already configured; nothing to do"); process.exit(0); }
const RPC = process.env.NEAR_RPC || "https://rpc.testnet.fastnear.com";
const HELPER = "https://helper.testnet.near.org/account";
const SIGNER = "v1.signer-prod.testnet";
const LC = "btc-client-v4.testnet";
const p = new JsonRpcProvider({ url: RPC }, { retries: 8, wait: 1500, backoff: 1.6 });
const TGAS = 10n ** 12n, NEAR = 10n ** 24n;
const tag = Date.now().toString(36);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A redeploy funds the new accounts from the existing relayer (sub-accounts of it), so only the very first
// start needs the testnet faucet — which rate-limits an IP to a handful of accounts per day.
const envVal = (k: string) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();
const funderId = envVal("RELAYER_ID"), funderKey = envVal("RELAYER_KEY");
let funder: Account | null = null;
if (funderId && funderKey) {
  const a = new Account(funderId, p, new KeyPairSigner(KeyPair.fromString(funderKey as any)));
  const bal = BigInt(((await p.query({ request_type: "view_account", account_id: funderId, finality: "final" }).catch(() => null)) as any)?.amount ?? "0");
  if (bal >= 14n * 10n ** 24n) { funder = a; console.log(`funding the new contract set from ${funderId} (${bal / 10n ** 24n} NEAR)`); }
}
async function sub(prefix: string, near: bigint) {
  const kp = KeyPairEd25519.fromRandom();
  const id = `${prefix}-${tag}.${funderId}`;
  await funder!.createAccount(id, kp.getPublicKey(), near * NEAR);
  await sleep(1500);
  return { id, kp, acc: new Account(id, p, new KeyPairSigner(kp)) };
}

async function account(prefix: string) {
  const kp = KeyPairEd25519.fromRandom();
  const id = `covered-${prefix}-${tag}.testnet`;
  for (let i = 0; ; i++) {
    const r = await fetch(HELPER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }) });
    if (r.ok) break;
    if (i > 5) throw new Error(`faucet ${id}: ${r.status} ${await r.text()}`);
    await sleep(5000 * (i + 1));
  }
  await sleep(2500);
  return { id, kp, acc: new Account(id, p, new KeyPairSigner(kp)) };
}
const wasm = (n: string) => readFileSync(`/wasm/${n}.wasm`);
const view = async (c: string, m: string, a: object = {}) => JSON.parse(Buffer.from(((await p.query({ request_type: "call_function", account_id: c, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString("base64"), finality: "optimistic" })) as any).result).toString());

let covered, usdc, relayer;
if (funder) {
  covered = await sub("app", 8n); usdc = await sub("usdc", 4n);
  relayer = { id: funderId!, kp: KeyPair.fromString(funderKey as any), acc: funder }; // the relayer stays, with its NEAR
} else {
  covered = await account("app"); usdc = await account("usdc"); relayer = await account("relayer");
  // The relayer pays everyone's gas (NEP-366); top it up from two more faucet accounts.
  for (const k of ["gas1", "gas2"]) { const g = await account(k); await g.acc.transfer({ receiverId: relayer.id, amount: 9n * NEAR }); }
}

await usdc.acc.signAndSendTransaction({ receiverId: usdc.id, actions: [actionCreators.deployContract(wasm("mock_usdc")), actionCreators.functionCall("new", {}, 100n * TGAS, 0n)] });
const rootKey: string = await view(SIGNER, "public_key", { domain_id: 0 });
// Reviewed parameters for testnet (params/testnet.json; network "Testnet4" = hrp `tb`, testnet3 and testnet4 alike).
const { _comment, ...tuned } = JSON.parse(readFileSync("/params/testnet.json", "utf8"));
const params = { ...tuned, signer: SIGNER, light_client: LC, usdc: usdc.id, mpc_root_key: rootKey };
await covered.acc.signAndSendTransaction({ receiverId: covered.id, actions: [actionCreators.deployContract(wasm("covered")), actionCreators.functionCall("new", { params }, 100n * TGAS, 0n)] });
await covered.acc.callFunction({ contractId: usdc.id, methodName: "storage_deposit", args: {}, deposit: 10n ** 22n, gas: 30n * TGAS });
// Lock: the contract keeps no key. From here on only its own code can act for it.
await covered.acc.signAndSendTransaction({ receiverId: covered.id, actions: [actionCreators.deleteKey(covered.kp.getPublicKey())] });
// Reads hit a load-balanced RPC that can trail the node that ran the transaction; wait for it to catch up.
for (let i = 0; ; i++) {
  const keys: any = await p.query({ request_type: "view_access_key_list", account_id: covered.id, finality: "final" });
  if (!keys.keys.length) break;
  if (i > 20) throw new Error("contract still has access keys");
  await sleep(2000);
}
const codeHash: string = ((await p.query({ request_type: "view_account", account_id: covered.id, finality: "final" })) as any).code_hash;
if (/^1+$/.test(codeHash)) throw new Error("contract code not visible yet");

const lines = `
# --- covered testnet bootstrap --- (generated ${new Date().toISOString()}; delete COVERED_ID to deploy a fresh set)
MODE=testnet
NEAR_NETWORK=testnet
NEAR_RPC=${RPC}
COVERED_ID=${covered.id}
USDC_ID=${usdc.id}
USDC_MINT=1
SIGNER_ID=${SIGNER}
LIGHT_CLIENT_ID=${LC}
RELAYER_ID=${relayer.id}
RELAYER_KEY=${relayer.kp.toString()}
ACCOUNT_FAUCET=1
HELPER=/api
ACCOUNT_SUFFIX=testnet
BTC_BACKEND=esplora
ESPLORA=https://mempool.space/testnet/api,https://blockstream.info/testnet/api
EXPLORER_BTC=https://mempool.space/testnet
EXPLORER_NEAR=https://testnet.nearblocks.io
MIN_CONF=1
CODE_HASH=${codeHash}
`;
const ours = new Set(lines.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split("=")[0]));
const kept = env.split("\n").filter((l) => !ours.has(l.split("=")[0]));
writeFileSync(ENV, kept.join("\n").trim() + "\n" + lines);
console.log(`testnet bootstrap: covered=${covered.id} (locked, code ${codeHash}) usdc=${usdc.id} relayer=${relayer.id}`);
