/**
 * Deploy CoveredMarket to NEAR mainnet and lock it. Real money: run it deliberately, read every line it prints.
 *
 *   cargo near build non-reproducible-wasm --manifest-path contracts/coveredmarket/Cargo.toml
 *   DEPLOYER_ID=you.near DEPLOYER_KEY=ed25519:… npx tsx scripts/deploy-mainnet.ts
 *
 * 1. Read-only preflight (the same facts as e2e/probe-mainnet.ts): signer derivation, light client lag, USDC.
 * 2. Create `coveredmarket.<deployer>` (6 NEAR) and `coveredmarket-relayer.<deployer>` (RELAYER_NEAR, default 5), deploy,
 *    init with params/mainnet.json + the live signer root key, register the contract with USDC.
 * 3. selftest_sign: the contract asks the real MPC to sign and verifies the answer on chain. If that fails the
 *    script STOPS with the contract's key still present, so nothing is locked half-working.
 * 4. Delete the contract's only key; check it has none; write .env.mainnet (ids, relayer key, code hash).
 */
import { Account } from "@near-js/accounts";
import { KeyPair, KeyPairEd25519 } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators } from "@near-js/transactions";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const RPC = process.env.NEAR_RPC ?? "https://rpc.mainnet.fastnear.com";
const SIGNER = "v1.signer", LC = "btc-client.bridge.near", USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const NEAR = 10n ** 24n, TGAS = 10n ** 12n;
const deployerId = process.env.DEPLOYER_ID, deployerKey = process.env.DEPLOYER_KEY;
if (!deployerId || !deployerKey) { console.error("set DEPLOYER_ID and DEPLOYER_KEY (a funded mainnet account)"); process.exit(2); }
const wasmPath = new URL("../target/near/coveredmarket/coveredmarket.wasm", import.meta.url);
if (!existsSync(wasmPath)) { console.error("build the wasm first (see the header)"); process.exit(2); }
const p = new JsonRpcProvider({ url: RPC }, { retries: 6, wait: 1500, backoff: 1.6 });
const view = async (c: string, m: string, a: object = {}) => JSON.parse(Buffer.from(((await p.query({ request_type: "call_function", account_id: c, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString("base64"), finality: "final" })) as any).result).toString() || "null");
const step = (s: string) => console.log(`\n── ${s}`);

step("preflight");
const root: string = await view(SIGNER, "public_key", { domain_id: 0 });
const lcTip = Number(await view(LC, "get_last_block_height"));
const md = await view(USDC, "ft_metadata");
console.log({ signer_version: await view(SIGNER, "version").catch(() => "?"), root, light_client_tip: lcTip, usdc: md.symbol, decimals: md.decimals });
if (md.decimals !== 6) throw new Error("USDC decimals changed");

const deployer = new Account(deployerId, p, new KeyPairSigner(KeyPair.fromString(deployerKey as any)));
const covId = process.env.CONTRACT_ID ?? `coveredmarket.${deployerId}`, relId = `coveredmarket-relayer.${deployerId}`;
const covKey = KeyPairEd25519.fromRandom(), relKey = KeyPairEd25519.fromRandom();

step(`create ${covId} and ${relId}`);
await deployer.createAccount(covId, covKey.getPublicKey(), 6n * NEAR);
await deployer.createAccount(relId, relKey.getPublicKey(), BigInt(process.env.RELAYER_NEAR ?? "5") * NEAR);
const cov = new Account(covId, p, new KeyPairSigner(covKey));

step("deploy and init");
const { _comment, ...tuned } = JSON.parse(readFileSync(new URL("../params/mainnet.json", import.meta.url), "utf8"));
const params = { ...tuned, signer: SIGNER, light_client: LC, usdc: USDC, mpc_root_key: root };
console.log(params);
await cov.signAndSendTransaction({ receiverId: covId, actions: [actionCreators.deployContract(readFileSync(wasmPath)), actionCreators.functionCall("new", { params }, 100n * TGAS, 0n)] });
await cov.callFunction({ contractId: USDC, methodName: "storage_deposit", args: { account_id: covId, registration_only: true }, deposit: 1_250_000_000_000_000_000_000n, gas: 30n * TGAS });

step("selftest_sign against the real MPC");
const ok = await deployer.callFunction({ contractId: covId, methodName: "selftest_sign", args: {}, gas: 300n * TGAS });
if (ok !== true) { console.error(`selftest_sign returned ${JSON.stringify(ok)}. STOPPING: ${covId} keeps its key so it can be fixed or deleted.`); process.exit(1); }
console.log("signature from v1.signer verified by the contract");

step("lock: delete the contract's only key");
await cov.signAndSendTransaction({ receiverId: covId, actions: [actionCreators.deleteKey(covKey.getPublicKey())] });
const keys: any = await p.query({ request_type: "view_access_key_list", account_id: covId, finality: "final" });
if (keys.keys.length) throw new Error("contract still has keys");
const codeHash = ((await p.query({ request_type: "view_account", account_id: covId, finality: "final" })) as any).code_hash;

writeFileSync(".env.mainnet", `# written by scripts/deploy-mainnet.ts ${new Date().toISOString()}
MODE=mainnet
NEAR_NETWORK=mainnet
NEAR_RPC=${RPC}
COVERED_ID=${covId}
USDC_ID=${USDC}
SIGNER_ID=${SIGNER}
LIGHT_CLIENT_ID=${LC}
RELAYER_ID=${relId}
RELAYER_KEY=${relKey.toString()}
ACCOUNT_SUFFIX=near
BTC_BACKEND=esplora
BTC_FAUCET=0
ESPLORA=https://mempool.space/api,https://blockstream.info/api
EXPLORER_BTC=https://mempool.space
EXPLORER_NEAR=https://nearblocks.io
MIN_CONF=${params.min_conf}
CODE_HASH=${codeHash}
`, { mode: 0o600 });
console.log(`\nlocked: ${covId}, code ${codeHash}. Copy .env.mainnet to /opt/covered/ on the VM and redeploy; the mainnet site goes live.`);
