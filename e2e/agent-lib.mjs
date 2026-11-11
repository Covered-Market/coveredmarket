// The agent toolkit as a user runs it: `bin/coveredmarket agent …` (JSON on stdout) and `bin/coveredmarket mcp`
// (an MCP server on stdio). Node built-ins only, so the read-only smoke check needs no `npm ci` in e2e/.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CM = new URL("../bin/coveredmarket", import.meta.url).pathname;

/** A fresh ~/.coveredmarket for this run, so no wallet from the machine is used or touched. */
export const freshHome = () => mkdtempSync(join(tmpdir(), "coveredmarket-agent-"));

/** Run one CLI command. Returns its exit status and parsed stdout; throws if stdout is not one JSON value. */
export function cli(site, args, env = {}) {
  const r = spawnSync(CM, ["agent", ...args, "--site", site], { env: { ...process.env, ...env }, encoding: "utf8", timeout: 900_000 });
  let out;
  try { out = JSON.parse(r.stdout); } catch { throw new Error(`agent ${args.join(" ")}: stdout is not JSON (exit ${r.status})\n${r.stdout}\n${r.stderr}`); }
  return { status: r.status, out, stderr: r.stderr };
}
/** Run one CLI command that must succeed. */
export function ok(site, args, env) {
  const r = cli(site, args, env);
  if (r.status !== 0 || r.out?.error) throw new Error(`agent ${args.join(" ")} failed (exit ${r.status}): ${r.out?.error ?? JSON.stringify(r.out)}`);
  return r.out;
}
/** Run one CLI command that must fail the documented way: exit 1 and {"error": "…"}. Returns the message. */
export function fails(site, args, env) {
  const r = cli(site, args, env);
  if (r.status !== 1 || typeof r.out?.error !== "string") throw new Error(`agent ${args.join(" ")} should fail with {"error"} and exit 1; got exit ${r.status}: ${JSON.stringify(r.out).slice(0, 300)}`);
  return r.out.error;
}

/** Start `bin/coveredmarket mcp` and speak MCP to it over stdio (newline-delimited JSON-RPC). */
export async function mcp(site, env = {}) {
  const p = spawn(CM, ["mcp"], { env: { ...process.env, COVEREDMARKET_SITE: site, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  let buf = "", stderr = "", id = 0;
  const waiting = new Map();
  p.stderr.on("data", (d) => { stderr += d; });
  p.stdout.on("data", (d) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0;) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let m;
      try { m = JSON.parse(line); } catch { for (const w of waiting.values()) w.fail(new Error(`MCP server wrote a non-JSON line to stdout: ${line.slice(0, 200)}`)); continue; }
      if (m.id != null && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.error ? w.fail(new Error(`${w.method}: ${m.error.message}`)) : w.done(m.result); }
    }
  });
  p.on("exit", (code) => { for (const w of waiting.values()) w.fail(new Error(`MCP server exited (${code}) during ${w.method}\n${stderr.slice(-2000)}`)); waiting.clear(); });
  const send = (m) => p.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
  const request = (method, params = {}, ms = 300_000) => new Promise((done, fail) => {
    const n = ++id;
    const t = setTimeout(() => { waiting.delete(n); fail(new Error(`MCP ${method}: no answer in ${ms / 1000} s\n${stderr.slice(-2000)}`)); }, ms);
    waiting.set(n, { method, done: (v) => { clearTimeout(t); done(v); }, fail: (e) => { clearTimeout(t); fail(e); } });
    send({ id: n, method, params });
  });

  // The first start may install agent/'s packages (to stderr), hence the long first timeout.
  const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "coveredmarket-e2e", version: "1" } }, 600_000);
  send({ method: "notifications/initialized" });
  return {
    info: init.serverInfo,
    instructions: init.instructions ?? "",
    tools: async () => (await request("tools/list")).tools,
    /** Call a tool. Returns its parsed JSON, or throws with the tool's message when it reports isError. */
    call: async (name, args = {}) => {
      const r = await request("tools/call", { name, arguments: args });
      const text = r.content?.[0]?.text ?? "";
      if (r.isError) { const e = new Error(`${name}: ${text}`); e.toolError = text; throw e; }
      return JSON.parse(text);
    },
    close: () => { p.stdin.end(); p.kill(); },
  };
}

export const TOOLS = [
  "coveredmarket_params", "coveredmarket_list_offers", "coveredmarket_get_offer", "coveredmarket_my_account",
  "coveredmarket_sell", "coveredmarket_faucet_deposit", "coveredmarket_buy", "coveredmarket_exercise",
  "coveredmarket_cancel", "coveredmarket_withdraw", "coveredmarket_claim", "coveredmarket_test_funds", "coveredmarket_wait_for",
];
