import { useState } from "react";
import { btc8, C, dateUtc, usd } from "../ds";
import { call, CFG, verifyClients, view, type Wallet } from "../lib/near";
import { runChecks, type CheckResult } from "../lib/verify";
import { stampFor, useOffer, useParams } from "./hooks";
import { btcAddr, btcTx, Ext, nearAcct, OnChainRecord } from "../Explorer";
import { BlockWait } from "../ChainClock";
import { downloadKit, kitFor } from "../lib/rescue";

export function Contract({ serial, wallet }: { serial: number; wallet: Wallet | null }) {
  const { Certificate, Button, Countdown, StatTile, SettlementTimeline, Notice, Figure, Stamp } = C();
  const { offer } = useOffer(serial);
  const params = useParams();
  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!offer) return <div style={{ padding: 48 }} className="body cv-pad">Loading CV-{serial}…</div>;
  const now = Date.now() / 1000;
  const expiry = Number(offer.expiry_s), grace = params?.grace_s ?? 7200;
  const isSeller = wallet?.accountId === offer.seller, isBuyer = !!wallet && wallet.accountId === offer.buyer;
  const windowOpen = now >= expiry && now < expiry + grace;
  const act = async (m: string, args: Record<string, unknown> = {}, receiver = CFG.contract, dep = 0n) => { if (!wallet) return; setBusy(true); try { await call(wallet, receiver, m, args, dep, 300); } catch (e) { alert((e as Error).message); } finally { setBusy(false); } };
  // Exercise is a payment. The contract first asks the light client to re-check the deposit and refunds the
  // strike if it cannot; the buyer may then exercise without that re-check, so a light client that does not
  // answer can never cost them the option.
  const exercise = async () => {
    if (!wallet) return;
    const pay = (skip: boolean) => call(wallet, CFG.usdc, "ft_transfer_call", { receiver_id: CFG.contract, amount: offer.strike_total_units, msg: JSON.stringify(skip ? { serial, exercise: true, skip_depth_check: true } : { serial, exercise: true }) }, 1n, 300);
    setBusy(true);
    try {
      await pay(false);
      const after = await view<{ state: string } | null>("get_offer", { serial });
      if (after?.state === "Sold" && confirm("The Bitcoin light client could not re-check the deposit just now, so your strike was returned and nothing was exercised.\n\nExercise anyway, without that re-check? Your strike then waits in escrow: it is released to the seller only when the delivery to your address confirms on Bitcoin.")) await pay(true);
    } catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  };
  const rescued = offer.state === "Rescued";
  const reclaimFrom = Number((offer as any).unlock_s ?? 0) + (params?.escrow_timeout_s ?? 604800);
  const contract = {
    serial: `CV-${serial}`, issued: dateUtc(offer.created_s ?? offer.expiry_s).split(",")[0], size: Number(offer.size_sats) / 1e8, strike: Number(offer.strike_units) / 1e6, expiry: dateUtc(offer.expiry_s),
    premium: Number(offer.premium_units) / 1e6, vault: offer.address, seller: offer.seller, buyer: offer.buyer ?? undefined, contractId: CFG.contract, status: stampFor(offer.state),
  };
  const steps = [
    { title: "Coins deposited", detail: offer.collateral_txid ? `${btc8(offer.collateral_value_sats!)} · tx ${offer.collateral_txid.slice(0, 10)}…` : "awaiting deposit", state: offer.collateral_txid ? "done" : "now" },
    { title: "Call sold", detail: offer.buyer ? `${offer.buyer} · ${usd(offer.premium_units)} credited to the seller` : "listed", state: offer.buyer ? "done" : offer.collateral_txid ? "now" : "todo" },
    { title: `Exercise window ${dateUtc(expiry).slice(0, 17)} + ${Math.round(grace / 60)} min`, detail: offer.commitment_reason === "Exercise" ? `strike ${usd(offer.strike_total_units)} paid` : now >= expiry + grace ? "closed, not exercised" : windowOpen ? "open now" : "not yet open", state: offer.commitment_reason ? "done" : windowOpen ? "now" : "todo" },
    rescued
      ? { title: "Coins taken back by the seller", detail: "through the seller's own exit on Bitcoin; any strike in escrow went back to the buyer", state: "done" }
      : { title: offer.commitment_reason === "Exercise" ? "Delivery to the buyer" : "Coins returned to the seller", detail: offer.commitment_txid ? `tx ${offer.commitment_txid.slice(0, 10)}… ${offer.signed_tx ? "signed" : "signature requested"}` : "", state: ["Kept", "Exercised", "Withdrawn"].includes(offer.state) ? "done" : offer.commitment_txid ? "now" : "todo" },
  ] as const;
  const verify = async () => { setRunning(true); try { setChecks(await runChecks(verifyClients(), offer, params as any, now)); } finally { setRunning(false); } };
  return (
    <div className="cv-split cv-pad" style={{ padding: "24px 48px 32px", display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 420px)", gap: 40, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="body-small" style={{ color: "var(--ink-muted)" }}>{location.origin}/#/c/<b style={{ color: "var(--ink)" }}>{serial}</b> · public page{isSeller ? " · you are the seller" : isBuyer ? " · you are the buyer" : ""}</div>
        <div data-cv="certificate"><Certificate contract={contract}>
          <Button onClick={verify} disabled={running}>{running ? "Checking…" : "Verify"}</Button>
          <Button onClick={() => navigator.clipboard.writeText(location.href)}>Copy link</Button>
          {isSeller && offer.state === "Funded" && <Button variant="danger" disabled={busy} onClick={() => act("withdraw", { serial })}>Withdraw coins</Button>}
          {isSeller && offer.state === "Created" && <Button href={`#/deposit/${serial}`}>Deposit instructions</Button>}
          {isSeller && (() => { let k: ReturnType<typeof kitFor> = null; try { k = kitFor(offer); } catch {} return k ? <Button onClick={() => downloadKit(k!.kit)}>Rescue kit</Button> : null; })()}
          {isBuyer && offer.state === "Sold" && windowOpen && <Button variant="primary" disabled={busy} onClick={exercise}>Exercise · pay {usd(offer.strike_total_units)}</Button>}
          {isBuyer && offer.escrow_units !== "0" && now >= reclaimFrom && <Button disabled={busy} onClick={() => act("reclaim_strike", { serial })}>Reclaim strike</Button>}
          {offer.state === "Sold" && now >= expiry + grace && <Button disabled={busy || !wallet} onClick={() => act("settle", { serial })}>Settle</Button>}
          {offer.state === "Committed" && <Button disabled={busy || !wallet} onClick={() => act("request_signature", { serial })}>Retry signature</Button>}
        </Certificate></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {offer.commitment_txid && <Button size="sm" variant="quiet" href={`${CFG.explorerBtc}/tx/${offer.commitment_txid}`}>{offer.commitment_reason === "Exercise" ? "Delivery" : "Return"} on Bitcoin ↗</Button>}
          {offer.signed_tx && <Button size="sm" variant="quiet" onClick={() => navigator.clipboard.writeText(offer.signed_tx!)}>Copy raw tx</Button>}
          <Button size="sm" variant="quiet" href={`${CFG.explorerNear}/address/${CFG.contract}`}>Contract on NEAR ↗</Button>
        </div>
        {checks && (
          <div data-cv="verify" style={{ background: "var(--paper-sunk)", border: "1px solid var(--rule-strong)", padding: "16px 18px", fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: "22px" }}>
            {checks.map((k) => (
              <div key={k.n} style={{ display: "grid", gridTemplateColumns: "18px 18px 1fr", gap: 10, color: k.status === "verified" ? "var(--intaglio)" : k.status === "failed" ? "var(--oxblood)" : "var(--ink-muted)" }}>
                <span>{k.status === "verified" ? "✓" : k.status === "failed" ? "✗" : "?"}</span><span style={{ color: "var(--ink-muted)" }}>{k.n}</span><span><b>{k.title}</b> · {k.detail}</span>
              </div>
            ))}
            <div className="body-small" style={{ marginTop: 8, color: "var(--ink-muted)", fontFamily: "var(--font-sans)" }}>
              {checks.every((k) => k.status === "verified") ? <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><Stamp status="settled" flat>verified</Stamp> 7 of 7 from Bitcoin and NEAR RPCs; nothing from CoveredMarket.</span> : checks.some((k) => k.status === "unavailable") ? "Some checks could not run: an RPC was unreachable. This is not a failure of the contract." : "A check failed. Do not rely on this contract until you understand why."}
            </div>
          </div>
        )}
      </div>
      <div className="cv-side" style={{ display: "flex", flexDirection: "column", gap: 20, paddingTop: 32, minWidth: 0 }}>
        {offer.state === "Sold" && now < expiry + grace && <Countdown totalSeconds={Math.floor(now < expiry ? expiry - Number(offer.created_s ?? expiry - 86400) : grace)} secondsLeft={Math.floor(Math.max(0, (now < expiry ? expiry : expiry + grace) - now))} label={now < expiry ? "Until the exercise window" : "Exercise window closes in"} note={dateUtc(now < expiry ? expiry : expiry + grace)} />}
        {offer.commitment_reason && !rescued && (
          <div style={{ display: "flex", alignItems: "center", gap: 16, border: "1px solid var(--rule)", background: "var(--paper-raised)", padding: 20 }}>
            <div><div className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)" }}>{offer.commitment_reason === "Exercise" ? "Delivered to the buyer" : "Returned to the seller"}</div><Figure value={Number(offer.commitment_amount_sats) / 1e8} kind="btc" size="xl" /><div className="body-small" style={{ color: "var(--ink-muted)" }}>to {offer.commitment_to_address && <Ext href={btcAddr(offer.commitment_to_address)}>{offer.commitment_to_address}</Ext>}; fee {(offer as any).commitment_fee_sats ?? params?.fee_sats ?? "—"} sats, paid from the coins</div></div>
          </div>
        )}
        <div className="cv-tiles2" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
          <StatTile label="Premium" value={Number(offer.premium_units) / 1e6} kind="usd" tone="gilt" note={offer.buyer ? "credited to the seller" : "asked"} />
          <StatTile label="Strike total" value={Number(offer.strike_total_units) / 1e6} kind="usd" note={offer.escrow_units !== "0" ? "in escrow until delivery confirms" : "paid by the buyer to exercise"} />
        </div>
        <div data-cv="timeline"><SettlementTimeline steps={steps as any} /></div>
        {offer.state === "Signed" && <BlockWait blocks={1} what={`to include the ${offer.commitment_reason === "Exercise" ? "delivery" : "return"} transaction`} />}
        <OnChainRecord rows={[
          ["Deposit address", offer.address, btcAddr],
          ["Deposit tx", offer.collateral_txid, btcTx],
          [offer.commitment_reason === "Exercise" ? "Delivery tx" : "Return tx", offer.commitment_txid, btcTx],
          ["Paid to", offer.commitment_to_address, btcAddr],
          ["Seller refund address", offer.refund_address, btcAddr],
          ["Seller's exit unlocks", (offer as any).unlock_s ? new Date(Number((offer as any).unlock_s) * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC" : null, () => btcAddr(offer.address)],
          ["Seller", offer.seller, nearAcct],
          ["Buyer", offer.buyer, nearAcct],
          ["Contract", CFG.contract, nearAcct],
          ["Signer", CFG.signer, nearAcct],
          ["Light client", CFG.lightClient, nearAcct],
        ]} />
        <Notice>Only {CFG.contract} can ask NEAR's signing network ({CFG.signer}) to spend {offer.address.slice(0, 8)}…. It does so for exactly one transaction, committed on chain before the request. CoveredMarket's servers can only relay.</Notice>
      </div>
    </div>
  );
}
