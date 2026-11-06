import { useEffect, useState } from "react";
import { C } from "./ds";
import { CFG, clearWallet, createWallet, loadWallet, saveWallet, type Wallet } from "./lib/near";
import { canConnect, connectWallet, disconnectWallet, restoreConnected } from "./lib/connect";
import { Buy } from "./pages/Buy";
import { Contract } from "./pages/Contract";
import { Contracts } from "./pages/Contracts";
import { Deposit } from "./pages/Deposit";
import { Market } from "./pages/Market";
import { Sell } from "./pages/Sell";
import { Try } from "./pages/Try";
import { NetworkBand, NetworkSwitch, NotLive } from "./Network";

export function useRoute() {
  const [h, setH] = useState(location.hash || "#/market");
  useEffect(() => { const f = () => setH(location.hash || "#/market"); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  const [path, query] = h.slice(1).split("?");
  return { path, parts: path.split("/").filter(Boolean), q: new URLSearchParams(query ?? "") };
}

export function App() {
  const { parts } = useRoute();
  const [wallet, setWallet] = useState<Wallet | null>(loadWallet());
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const { TopBar, Button, Field, Notice } = C();
  useEffect(() => { if (!wallet && !CFG.disabled) restoreConnected().then((w) => { if (w) { saveWallet(w); setWallet(w); } }); }, []);
  const connect = async () => { setBusy(true); try { const w = await connectWallet(); saveWallet(w); setWallet(w); setNaming(false); } catch (e) { if (!/reject|cancel|closed/i.test(String((e as Error)?.message ?? e))) alert((e as Error).message ?? String(e)); } finally { setBusy(false); } };
  const forget = async () => { if (!confirm(wallet?.via ? `Disconnect ${wallet.viaName ?? "this wallet"}?` : "Forget this test wallet on this device? Its key is only stored here.")) return; if (wallet?.via) await disconnectWallet(); clearWallet(); setWallet(null); };
  const nav = (on: string) => [
    { label: "Market", href: "#/market", on: on === "market" },
    { label: "Sell a call", href: "#/sell", on: on === "sell" },
    { label: "My contracts", href: "#/contracts", on: on === "contracts" },
    { label: "Try it", href: "#/try", on: on === "try" },
  ];
  const page = parts[0] ?? "market";
  const content = CFG.disabled ? <NotLive /> : (() => {
    switch (page) {
      case "market": return <Market />;
      case "sell": return wallet ? <Sell wallet={wallet} /> : <NeedWallet onCreate={() => setNaming(true)} />;
      case "deposit": return <Deposit serial={Number(parts[1])} wallet={wallet} />;
      case "contracts": return wallet ? <Contracts wallet={wallet} /> : <NeedWallet onCreate={() => setNaming(true)} />;
      case "c": return <Contract serial={Number(parts[1])} wallet={wallet} />;
      case "buy": return <Buy serial={Number(parts[1])} wallet={wallet} onCreate={() => setNaming(true)} />;
      case "try": return <Try wallet={wallet} onCreate={() => setNaming(true)} />;
      default: return <Market />;
    }
  })();
  return (
    <div className="cv-root" style={{ minHeight: "100vh", background: "var(--paper)", color: "var(--ink)", fontFamily: "var(--font-sans)" }}>
      <NetworkBand />
      <TopBar items={CFG.disabled ? [] : nav(page)} href="#/market">
        <NetworkSwitch />
        {CFG.disabled ? null : wallet ? (
          <Button size="sm" onClick={forget} title={wallet.via ? `Connected with ${wallet.viaName ?? wallet.via}` : "Quick test wallet (key in this browser)"}>{wallet.accountId}{wallet.key ? " · test" : ""}</Button>
        ) : (
          <Button size="sm" variant="primary" disabled={busy} onClick={() => (canConnect() && !CFG.faucet ? connect() : setNaming(true))}>{canConnect() ? "Connect wallet" : "Create wallet"}</Button>
        )}
      </TopBar>
      {naming && !wallet && (
        <div style={{ margin: "16px 48px", padding: 20, border: "1px solid var(--rule)", background: "var(--paper-raised)", maxWidth: 620, display: "flex", flexDirection: "column", gap: 16 }}>
          {canConnect() && (
            <div>
              <div className="heading" style={{ marginBottom: 6 }}>Connect your NEAR wallet</div>
              <p className="body-small" style={{ color: "var(--ink-muted)", margin: "0 0 10px" }}>HOT, Meteor, Intear, MyNearWallet, OKX and others. Your keys stay in your wallet; you approve each action there. Wallets that support it sign gas-free through the Covered relayer.</p>
              <Button variant="primary" disabled={busy} onClick={connect}>{busy ? "Waiting for the wallet…" : "Connect wallet"}</Button>
            </div>
          )}
          {CFG.faucet && (
            <div style={{ borderTop: canConnect() ? "1px solid var(--rule)" : "none", paddingTop: canConnect() ? 16 : 0 }}>
              <div className="heading" style={{ marginBottom: 6 }}>{canConnect() ? "Or: a quick test wallet" : `A NEAR ${CFG.network} account for this device`}</div>
              <p className="body-small" style={{ color: "var(--ink-muted)", margin: "0 0 10px" }}>No wallet needed. A new {CFG.mode === "local" ? "sandbox" : "testnet"} account whose key stays in this browser, with test USDC to try things. Gas is paid by the relayer.</p>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}><Field label="Name" placeholder="astrid" value={name} onChange={(e) => setName(e.target.value)} help={`becomes ${name || "name"}.${CFG.accountSuffix || CFG.network}`} /></div>
                <Button disabled={busy || !name} onClick={async () => { setBusy(true); try { setWallet(await createWallet(name)); setNaming(false); } catch (e) { alert((e as Error).message); } finally { setBusy(false); } }}>{busy ? "Creating…" : "Create"}</Button>
              </div>
            </div>
          )}
          <div><Button variant="quiet" onClick={() => setNaming(false)}>Cancel</Button></div>
        </div>
      )}
      {content}
      <div style={{ padding: "24px 48px", borderTop: "1px solid var(--rule)", marginTop: 48 }} className="body-small">
        <Notice>Covered is unaudited hackathon software.{CFG.disabled ? null : <> Only the contract <a href={`${CFG.explorerNear}/address/${CFG.contract}`} target="_blank" rel="noreferrer"><code>{CFG.contract}</code></a> can ask NEAR's signing network to spend a deposit address; Covered the company cannot. If the signing network stopped, settlement would stop with it.</>}</Notice>
      </div>
    </div>
  );
}

function NeedWallet({ onCreate }: { onCreate: () => void }) {
  const { Button } = C();
  return (
    <div style={{ padding: "48px" }}>
      <h1 className="title" style={{ margin: "0 0 8px" }}>You need a wallet first</h1>
      <p className="body" style={{ color: "var(--ink-muted)", maxWidth: 520 }}>A NEAR account identifies you as seller or buyer. Your Bitcoin stays in your own Bitcoin wallet; this account only signs instructions.</p>
      <Button variant="primary" onClick={onCreate}>{canConnect() ? "Connect wallet" : "Create wallet"}</Button>
    </div>
  );
}
