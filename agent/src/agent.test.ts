import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scriptFromAddress, wifToKey } from "../../relayer/src/rescue.js";
import { hex, makeKit, newKey, p2wpkh, toWif } from "./btc.js";
import { parse } from "./cli.js";
import { reason } from "./client.js";
import { server } from "./mcp.js";
import { Store } from "./store.js";

describe("bitcoin keys", () => {
  it("P2WPKH matches BIP-173", () => {
    const g = hex.from("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798");
    expect(p2wpkh(g, "bc")).toBe("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
    expect(p2wpkh(g, "tb")).toBe("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx");
  });
  it("WIF round-trips through the rescue tool's parser", () => {
    const { priv } = newKey();
    expect(hex.to(wifToKey(toWif(priv, false)))).toBe(hex.to(priv));
    const one = new Uint8Array(32); one[31] = 1;
    expect(toWif(one, false)).toBe("cMahea7zqjxrtgAbB7LSGbcQUr1uX1ojuat9jZodMN87JcbXMTcA");
  });
  it("makes a kit the rescue tool can use, and refuses a wrong key", () => {
    const k = newKey();
    const offer = { serial: 3, address: "tb1qvg92h8xuugmf96lm9ne2z4z34g5w78urjua95ajdlc5kc64tnzwswlc945", witness_script: "63", unlock_s: "1794342240", size_sats: "100000", refund_address: "tb1qr4ecpxecfr6qkjqec6s024qe8k28hfn47s0nna", rescue_pubkey: hex.to(k.pub33) };
    const site = { mode: "testnet", contract: "app.testnet", network: "testnet", explorerBtc: "https://mempool.space/testnet" };
    const kit = makeKit(offer, k.priv, site);
    expect(kit).toMatchObject({ kind: "coveredmarket-rescue-kit", version: 1, bitcoin_network: "testnet3", hrp: "tb", serial: 3, unlock_utc: "2026-11-10T20:24:00.000Z" });
    expect(hex.to(wifToKey(kit.rescue_private_key_wif))).toBe(hex.to(k.priv));
    expect(() => scriptFromAddress(kit.refund_address, kit.hrp)).not.toThrow();
    expect(() => makeKit(offer, newKey().priv, site)).toThrow(/not the offer's rescue key/);
  });
});

describe("store", () => {
  it("keeps keys per site host, private to the user", () => {
    const home = mkdtempSync(join(tmpdir(), "cm-agent-"));
    const s = new Store("https://testnet.covered.market", home);
    s.saveWallet("seller", { accountId: "a", nearKey: "ed25519:x", btcKey: "00", pendingRescue: {}, created: "now" });
    expect(s.loadWallet("seller")?.accountId).toBe("a");
    expect(s.loadWallet("buyer")).toBeNull();
    expect(statSync(s.walletPath("seller")).mode & 0o777).toBe(0o600);
    expect(s.walletPath("seller")).toContain(join(home, "testnet.covered.market"));
    const kit = s.saveKit("app.testnet", 4, { k: 1 });
    expect(statSync(kit).mode & 0o777).toBe(0o600);
    expect(s.hasKit("app.testnet", 4)).toBe(true);
  });
});

describe("cli and errors", () => {
  it("parses commands and flags", () => {
    expect(parse(["sell", "--size", "0.001", "--strike=150000", "--premium", "5", "--wallet", "s"])).toEqual({ cmd: "sell", args: [], flags: { size: "0.001", strike: "150000", premium: "5", wallet: "s" } });
    expect(parse(["wait", "7", "Kept", "Exercised", "--timeout", "60"])).toMatchObject({ cmd: "wait", args: ["7", "Kept", "Exercised"], flags: { timeout: "60" } });
  });
  it("turns a contract panic into its message", () => {
    expect(reason({ ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: expiry too soon" } } } })).toBe("expiry too soon");
    expect(reason("plain")).toBe("plain");
  });
});

describe("mcp server", () => {
  it("lists every tool without connecting to a site", async () => {
    const s = server(() => Promise.reject(new Error("offline")));
    const [a, b] = InMemoryTransport.createLinkedPair();
    await s.connect(a);
    const c = new Client({ name: "test", version: "0" });
    await c.connect(b);
    const tools = (await c.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(["coveredmarket_params", "coveredmarket_list_offers", "coveredmarket_sell", "coveredmarket_buy", "coveredmarket_exercise", "coveredmarket_claim", "coveredmarket_wait_for"]));
    const r: any = await c.callTool({ name: "coveredmarket_params", arguments: {} });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("offline");
    await c.close();
  });
});
