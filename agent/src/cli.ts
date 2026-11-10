#!/usr/bin/env -S npx tsx
/**
 * coveredmarket-agent: CoveredMarket from a shell, JSON on stdout. Testnet and the local stack only.
 *
 *   coveredmarket-agent params
 *   coveredmarket-agent offers [--status for_sale|awaiting_deposit|sold|settling]
 *   coveredmarket-agent offer 7
 *   coveredmarket-agent me                          # this wallet: account, balances, offers, claimable, Bitcoin address
 *   coveredmarket-agent sell --size 0.001 --strike 150000 --premium 5 [--expires-in 30] [--refund tb1q…]
 *   coveredmarket-agent faucet-deposit 7            # testnet: the demo faucet pays the deposit
 *   coveredmarket-agent buy 7 [--btc-address tb1q…]
 *   coveredmarket-agent exercise 7
 *   coveredmarket-agent cancel 7 | withdraw 7 | reclaim-strike 7 | claim | test-funds
 *   coveredmarket-agent wait 7 Funded [Sold …] [--timeout 900]
 *
 * Options: --site URL (default $COVEREDMARKET_SITE or https://testnet.covered.market), --wallet NAME (default
 * $COVEREDMARKET_WALLET or "default"). Keys live in ~/.coveredmarket (see store.ts).
 */
import { CoveredMarket, CoveredMarketError, type Status } from "./client.js";

export function parse(argv: string[]) {
  const pos: string[] = [], flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const [k, v] = a.slice(2).split("="); flags[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true"); }
    else pos.push(a);
  }
  return { cmd: pos[0] ?? "help", args: pos.slice(1), flags };
}

const HELP = `coveredmarket-agent <command> [--site URL] [--wallet NAME]
  params | offers [--status S] | offer N | me
  sell --size BTC --strike USD --premium USD [--expires-in MIN | --expiry UNIX] [--refund ADDR]
  faucet-deposit N | buy N [--btc-address ADDR] | exercise N [--skip-depth-check]
  cancel N | withdraw N | reclaim-strike N | claim | test-funds
  wait N STATE… [--timeout S]`;

async function main() {
  const { cmd, args, flags } = parse(process.argv.slice(2));
  if (cmd === "help" || flags.help) { console.log(HELP); return; }
  const cm = await CoveredMarket.connect({ site: flags.site, wallet: flags.wallet });
  const n = () => { const s = Number(String(args[0] ?? "").replace(/^CV-/i, "")); if (!Number.isInteger(s) || s < 0) throw new CoveredMarketError("which offer? give its serial, e.g. 7"); return s; };
  const num = (k: string) => { const v = Number(flags[k]); if (!Number.isFinite(v)) throw new CoveredMarketError(`--${k} must be a number`); return v; };
  let out: unknown;
  switch (cmd) {
    case "params": out = await cm.params(); break;
    case "offers": out = await cm.offers(flags.status as Status | undefined); break;
    case "offer": out = await cm.offer(n()); break;
    case "me": out = await cm.account(); break;
    case "sell": out = await cm.sell({ sizeBtc: num("size"), strikeUsd: num("strike"), premiumUsd: num("premium"), expiresInMinutes: flags["expires-in"] ? num("expires-in") : undefined, expiryS: flags.expiry ? num("expiry") : undefined, refundAddress: flags.refund }); break;
    case "faucet-deposit": out = await cm.depositFromFaucet(n()); break;
    case "buy": out = await cm.buy(n(), flags["btc-address"]); break;
    case "exercise": out = await cm.exercise(n(), { skipDepthCheck: flags["skip-depth-check"] === "true" }); break;
    case "cancel": out = await cm.cancel(n()); break;
    case "withdraw": out = await cm.withdraw(n()); break;
    case "reclaim-strike": out = await cm.reclaimStrike(n()); break;
    case "claim": out = await cm.claim(); break;
    case "test-funds": out = await cm.testFunds(); break;
    case "wait": {
      const states = args.slice(1);
      if (!states.length) throw new CoveredMarketError("wait N STATE…: e.g. wait 7 Funded");
      out = await cm.waitFor(n(), states, { timeoutS: flags.timeout ? num("timeout") : undefined, onTick: (d) => console.error(`${d.id} ${d.state}: ${d.summary}`) });
      break;
    }
    default: throw new CoveredMarketError(`unknown command ${cmd}\n${HELP}`);
  }
  console.log(JSON.stringify(out, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("cli.ts")) {
  main().catch((e) => { console.log(JSON.stringify({ error: (e as Error).message })); process.exit(1); });
}
