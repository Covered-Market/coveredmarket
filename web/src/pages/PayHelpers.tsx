/** Ways to pay a deposit without copying an address: a Bitcoin browser wallet, or (testnet) the demo faucet. */
import { useEffect, useState } from "react";
import { C } from "../ds";
import { btcTx, Ext } from "../Explorer";
import type { BtcWallet } from "../lib/btcwallets";
import { CFG } from "../lib/near";

export function PayHelpers({ serial, address, sats, wallets }: { serial: number; address: string; sats: number; wallets: BtcWallet[] }) {
  const { Button } = C();
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<{ txid: string; via: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [faucet, setFaucet] = useState<{ enabled: boolean; address: string; confirmed?: string; unconfirmed?: string; maxSats: string } | null>(null);
  useEffect(() => { if (CFG.faucet) fetch("/api/btc-faucet").then((r) => (r.ok ? r.json() : null)).then(setFaucet).catch(() => {}); }, []);
  const run = async (via: string, f: () => Promise<string>) => {
    setBusy(via); setErr(null);
    try { setSent({ txid: await f(), via }); } catch (e) { setErr(String((e as Error)?.message ?? e)); } finally { setBusy(null); }
  };
  const fromFaucet = () => run("the demo faucet", async () => {
    const r = await fetch("/api/btc-faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ serial }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `faucet ${r.status}`);
    return j.txid;
  });
  const faucetHas = faucet ? BigInt(faucet.confirmed ?? "0") + BigInt(faucet.unconfirmed ?? "0") : 0n;
  const faucetFits = faucet?.enabled && BigInt(sats) <= BigInt(faucet.maxSats);
  if (sent) return (
    <div style={{ padding: "12px 16px", border: "1px solid var(--rule)", background: "var(--paper-raised)" }} className="body-small">
      Sent by {sent.via}: <Ext href={btcTx(sent.txid)}>{sent.txid}</Ext>. The relayer proves it to the contract once it has {CFG.minConf} confirmation{CFG.minConf === 1 ? "" : "s"}.
    </div>
  );
  if (!wallets.length && !faucetFits) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px", border: "1px solid var(--rule)", background: "var(--paper-raised)" }}>
      {wallets.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)" }}>Pay with</span>
          {wallets.map((w) => (
            <Button key={w.id} size="sm" disabled={!!busy} onClick={() => run(w.name, () => w.send(address, sats))}>{busy === w.name ? "Waiting for the wallet…" : w.name}</Button>
          ))}
          {CFG.mode !== "mainnet" && wallets.some((w) => !w.checksNetwork) && <span className="body-small" style={{ color: "var(--ink-muted)" }}>In Xverse, select Bitcoin <b>testnet3</b> (“Testnet”) first.</span>}
        </div>
      )}
      {faucetFits && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Button size="sm" variant="primary" disabled={!!busy || faucetHas < BigInt(sats)} onClick={fromFaucet}>{busy === "the demo faucet" ? "Sending…" : "Send it from the demo faucet"}</Button>
          <span className="body-small" style={{ color: "var(--ink-muted)" }}>
            {faucetHas < BigInt(sats) ? <>The demo faucet is empty right now. Refill it from any testnet3 faucet: <Ext href={`${CFG.explorerBtc}/address/${faucet!.address}`} full>{faucet!.address}</Ext></> : <>Test coins with no value, from CoveredMarket's faucet ({(Number(faucetHas) / 1e8).toFixed(5)} tBTC left).</>}
          </span>
        </div>
      )}
      {err && <div className="body-small" style={{ color: "var(--oxblood)" }}>{err}</div>}
    </div>
  );
}
