import { useState } from "react";
import { btcProviders } from "../lib/btc";
import { C } from "../ds";
import { CFG, type Wallet } from "../lib/near";
import { getTestFunds, testWalletAllowed } from "../lib/testwallet";

export function Try({ wallet, onCreate }: { wallet: Wallet | null; onCreate: () => void }) {
  const { Button, Stamp, Notice } = C();
  const [funds, setFunds] = useState<{ busy?: boolean; msg?: string }>({});
  const topUp = async () => {
    if (!wallet) return;
    setFunds({ busy: true });
    try {
      const r = await getTestFunds(wallet.accountId);
      const got = [BigInt(r.usdc) ? `${Number(BigInt(r.usdc) / 1_000_000n).toLocaleString()} test USDC` : "", BigInt(r.near) ? `${Number(BigInt(r.near) / 10n ** 21n) / 1000} tNEAR` : ""].filter(Boolean);
      setFunds({ msg: got.length ? `Sent ${got.join(" and ")}.` : "You already have enough test funds." });
    } catch (e) { setFunds({ msg: (e as Error).message }); }
  };
  const steps = [
    { n: 1, title: "Connect a wallet", detail: `Connect your NEAR wallet, set to testnet (Meteor, Intear, Nightly and others). Any account works, named or implicit. You get 100,000 test USDC and a little tNEAR automatically; gas is paid by the relayer.`, time: "1 min" },
    { n: 2, title: "Sell a call", detail: "Pick a size (0.001 tBTC is fine), a strike above the reference, the shortest expiry. The contract derives your deposit address.", time: "1 min" },
    { n: 3, title: "Deposit testnet coins", detail: "Press “Send it from the demo faucet” on the deposit page, or pay from your own testnet3 wallet (UniSat, Leather, OKX, Xverse buttons appear when installed). Watch the light client prove it.", time: "10–30 min" },
    { n: 4, title: "Buy it yourself", detail: "Switch to a second testnet account in your wallet (or a second browser profile) and buy the call with test USDC.", time: "1 min" },
    { n: 5, title: "Watch it settle", detail: "At expiry, exercise by paying the strike or let the window pass. Open the Bitcoin transaction the contract signed.", time: "1 min" },
  ];
  const live = [
    ["Contract", CFG.contract, "live"], ["Chain Signatures", CFG.signer, "live"], ["Bitcoin light client", CFG.lightClient, "live"],
    ["USDC", CFG.usdc, "live"], ["Bitcoin data", btcProviders(), "live"], ["Reference price", "median of 5 tickers, display only", "live"],
  ];
  return (
    <div className="cv-split cv-pad" style={{ padding: "32px 48px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <div className="label" style={{ textTransform: "uppercase", color: "var(--gilt-ink)", marginBottom: 8 }}>For judges · no real funds</div>
          <h1 className="display-2" style={{ margin: "0 0 8px", fontSize: 48, lineHeight: 1.02 }}>Sell a call on testnet Bitcoin</h1>
          <p className="body" style={{ margin: 0, color: "var(--ink-muted)" }}>The same contract on NEAR {CFG.network} and Bitcoin testnet4, with short expiries and a one-confirmation light client so you see the whole life of a contract in one sitting.</p>
        </div>
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {steps.map((s) => (
            <li key={s.n} style={{ display: "grid", gridTemplateColumns: "36px 1fr auto", gap: 14, padding: "14px 0", borderTop: "1px solid var(--rule)" }}>
              <span style={{ width: 28, height: 28, borderRadius: 999, background: "var(--intaglio)", color: "var(--on-intaglio)", display: "grid", placeItems: "center", fontFamily: "var(--font-mono)", fontSize: 13 }}>{s.n}</span>
              <div><div className="body" style={{ fontWeight: 600 }}>{s.title}</div><div className="body-small" style={{ color: "var(--ink-muted)" }}>{s.detail}</div></div>
              <span className="figure-small" style={{ color: "var(--ink-muted)" }}>{s.time}</span>
            </li>
          ))}
        </ol>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {wallet ? <Button variant="primary" size="lg" href="#/sell">Start · sell a call</Button> : <Button variant="primary" size="lg" onClick={onCreate}>Start · connect a wallet</Button>}
          {wallet && testWalletAllowed() && <Button size="lg" disabled={funds.busy} onClick={topUp}>{funds.busy ? "Sending…" : "Get test funds"}</Button>}
          <Button size="lg" href="https://coinfaucet.eu/en/btc-testnet/">testnet3 faucet</Button>
          <Button size="lg" href="https://github.com/[TEAM]/coveredmarket">Read the contract</Button>
        </div>
        {funds.msg && <div className="body-small" role="status" style={{ color: "var(--ink-muted)" }}>{funds.msg}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 40 }}>
        <div className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)" }}>What is live, where</div>
        <div style={{ border: "1px solid var(--rule)", background: "var(--paper-raised)" }}>
          {live.map(([what, where, word]) => (
            <div key={what} style={{ display: "grid", gridTemplateColumns: "170px 1fr auto", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--rule)", alignItems: "center" }}>
              <span className="body-small" style={{ fontWeight: 600 }}>{what}</span><span className="figure-small" style={{ color: "var(--ink-muted)", wordBreak: "break-all" }}>{where}</span><Stamp status="open" flat>{word}</Stamp>
            </div>
          ))}
        </div>
        <Notice>Everything on this page can be checked without us: the Verify button on any certificate reads Bitcoin and NEAR directly. Mainnet, if deployed, uses 0.001 BTC contracts and is linked from the README.</Notice>
      </div>
    </div>
  );
}
