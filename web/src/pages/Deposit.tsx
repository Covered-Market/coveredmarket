import { btcJson, btcText } from "../lib/btc";
import { btcAddr, btcTx, Ext } from "../Explorer";
import { detectBtcWallets } from "../lib/btcwallets";
import { PayHelpers } from "./PayHelpers";
import { BlockWait } from "../ChainClock";
import { useEffect, useState } from "react";
import { btc8, C } from "../ds";
import { CFG, type Wallet } from "../lib/near";
import { useOffer, useParams } from "./hooks";

export function Deposit({ serial, wallet }: { serial: number; wallet: Wallet | null }) {
  const { Button, Coin, SettlementTimeline, Notice } = C();
  const { offer } = useOffer(serial, 5000);
  const params = useParams();
  const [seen, setSeen] = useState<{ txid: string; confirmed: boolean; depth: number } | null>(null);
  useEffect(() => {
    if (!offer) return;
    const f = async () => {
      try {
        const txs: any[] = await btcJson(`/address/${offer.address}/txs`);
        const tip = Number(await btcText(`/blocks/tip/height`));
        const hit = txs.find((t) => t.vout.some((v: any) => v.scriptpubkey_address === offer.address && v.value === Number(offer.size_sats)));
        setSeen(hit ? { txid: hit.txid, confirmed: hit.status.confirmed, depth: hit.status.confirmed ? tip - hit.status.block_height + 1 : 0 } : null);
      } catch {}
    };
    f(); const t = setInterval(f, 15_000); return () => clearInterval(t);
  }, [offer?.address, offer?.size_sats]);
  if (!offer) return <div style={{ padding: 48 }} className="body">Loading CV-{serial}…</div>;
  const minConf = params ? Number((params as any).min_conf) : CFG.minConf;
  const steps = [
    { title: "Address derived by the contract", detail: `${CFG.contract} · path ${offer.path}`, state: "done" as const },
    { title: "Seen on Bitcoin", detail: seen ? `tx ${seen.txid.slice(0, 10)}…` : "waiting for your transaction", state: seen ? ("done" as const) : ("now" as const) },
    { title: `${minConf} confirmation${minConf > 1 ? "s" : ""}`, detail: seen ? `${seen.depth} so far` : "", state: seen && seen.depth >= minConf ? ("done" as const) : seen ? ("now" as const) : ("todo" as const) },
    { title: "Proven on NEAR", detail: offer.state === "Created" ? "the relayer submits the proof; anyone can" : "funded", state: offer.state !== "Created" ? ("done" as const) : seen && seen.depth >= minConf ? ("now" as const) : ("todo" as const) },
  ];
  return (
    <div className="cv-split cv-pad" style={{ padding: "32px 48px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <div className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 8 }}>Step 2 of 3 · Deposit · CV-{serial}</div>
          <h1 className="display-2" style={{ margin: "0 0 8px", fontSize: 44, lineHeight: 1.02 }}>Deposit {btc8(offer.size_sats)}</h1>
          <p className="body" style={{ margin: 0, color: "var(--ink-muted)" }}>This address was derived for CV-{serial} by the Covered contract on NEAR. Only the contract can sign from it, through Chain Signatures. Nobody holds a key.</p>
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "center", padding: 20, background: "var(--paper-sunk)", border: "1px solid var(--rule-strong)" }}>
          <img alt="QR" width={136} height={136} style={{ background: "#fff", border: "1px solid var(--rule)" }} src={`https://api.qrserver.com/v1/create-qr-code/?size=136x136&data=bitcoin:${offer.address}?amount=${(Number(offer.size_sats) / 1e8).toFixed(8)}`} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <span className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)" }}>Send exactly {btc8(offer.size_sats)} to</span>
            <span className="figure" style={{ color: "var(--copper-ink)", wordBreak: "break-all", fontSize: 15 }}>{offer.address}</span>
            <div style={{ display: "flex", gap: 8 }}><Button size="sm" onClick={() => navigator.clipboard.writeText(offer.address)}>Copy address</Button><Button size="sm" href={`bitcoin:${offer.address}?amount=${(Number(offer.size_sats) / 1e8).toFixed(8)}`}>Open in wallet</Button><Button size="sm" href={btcAddr(offer.address)}>View on explorer</Button></div>
            {seen && <span className="body-small">Seen: <Ext href={btcTx(seen.txid)}>{seen.txid}</Ext> · {seen.confirmed ? `${seen.depth} confirmation${seen.depth === 1 ? "" : "s"}` : "in the mempool"}</span>}
          </div>
        </div>
        {offer.state === "Created" && <PayHelpers serial={serial} address={offer.address} sats={Number(offer.size_sats)} wallets={detectBtcWallets()} />}
        <Notice>Send from a wallet you control, in one output, the exact amount. Any other amount is not accepted; you can recover it to {offer.refund_address} from your contracts page.</Notice>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingTop: 44 }}>
        <div className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)" }}>Watching Bitcoin</div>
        <div style={{ border: "1px solid var(--rule)", background: "var(--paper-raised)", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          <Coin amount={Number(offer.size_sats) / 1e8} size="lg" />
          <SettlementTimeline steps={steps} />
          {offer.state === "Created" && (seen && !seen.confirmed ? <BlockWait blocks={minConf} what="to include your deposit" /> : seen && seen.depth < minConf ? <BlockWait blocks={minConf - seen.depth} what="for the remaining confirmations" /> : seen ? <span className="body-small" style={{ color: "var(--ink-muted)" }}>Confirmed. The relayer submits the proof within a minute, once the light client has the block's header.</span> : null)}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Button variant="primary" size="lg" href={`#/c/${serial}`} disabled={offer.state === "Created"}>{offer.state === "Created" ? "Waiting for the proof" : "Open the certificate"}</Button>
          {wallet?.accountId !== offer.seller && <span className="body-small" style={{ color: "var(--ink-muted)" }}>You are viewing another seller's deposit page.</span>}
        </div>
      </div>
    </div>
  );
}
