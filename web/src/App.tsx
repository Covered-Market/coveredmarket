import { useEffect, useState } from "react";
import { C } from "./ds";
import { accountHasKey, CFG, clearWallet, createWallet, loadWallet, saveWallet, type Wallet } from "./lib/near";
import { canConnect, connectWallet, disconnectWallet, restoreConnected } from "./lib/connect";
import { autoFund, getTestFunds, initTestWallet, shortAccount, testWallet, waitForAccount } from "./lib/testwallet";
import { Buy } from "./pages/Buy";
import { Contract } from "./pages/Contract";
import { Contracts } from "./pages/Contracts";
import { Deposit } from "./pages/Deposit";
import { Market } from "./pages/Market";
import { Sell } from "./pages/Sell";
import { Try } from "./pages/Try";
import { NetworkBand, NetworkSwitch, NotLive } from "./Network";
import { ChainClock } from "./ChainClock";

export function useRoute() {
  const [h, setH] = useState(location.hash || "#/market");
  useEffect(() => { const f = () => setH(location.hash || "#/market"); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  const [path, query] = h.slice(1).split("?");
  return { path, parts: path.split("/").filter(Boolean), q: new URLSearchParams(query ?? "") };
}

export function App() {
  const { parts } = useRoute();
  const [role] = useState(() => (CFG.disabled ? null : initTestWallet()));
  const [wallet, setWallet] = useState<Wallet | null>(role ? null : loadWallet());
  const [preparing, setPreparing] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const { TopBar, Button, Field, Notice } = C();
  useEffect(() => {
    if (CFG.disabled) return;
    if (role) {
      // Hidden test wallet (?testwallet=…): make sure its implicit account exists and has test funds, then use it.
      const w = testWallet(role);
      (async () => {
        setPreparing(`Preparing the ${role} test wallet…`);
        try {
          const { KeyPair } = await import("@near-js/crypto");
          const pk = KeyPair.fromString(w.key as any).getPublicKey().toString();
          const exists = await accountHasKey(w.accountId, pk);
          // Creates the implicit account on first use, and tops it up when low; a rate limit is fine once it exists.
          await getTestFunds(w.accountId).catch((e) => { if (!exists) throw e; });
          await waitForAccount((id) => accountHasKey(id, pk), w.accountId);
          setWallet(w); setPreparing(null);
        } catch (e) { setPreparing(`Test wallet unavailable: ${(e as Error).message}`); }
      })();
      return;
    }
    if (!wallet) restoreConnected().then((w) => { if (w) { saveWallet(w); setWallet(w); } });
    else if (wallet.via) autoFund(wallet.accountId);
  }, []);
  const connect = async () => {
    setBusy(true);
    try { const w = await connectWallet(); saveWallet(w); setWallet(w); setNaming(false); autoFund(w.accountId); }
    catch (e) { if (!/reject|cancel|closed/i.test(String((e as Error)?.message ?? e))) alert((e as Error).message ?? String(e)); }
    finally { setBusy(false); }
  };
  const getWallet = () => (canConnect() ? connect() : setNaming(true));
  const forget = async () => {
    if (wallet?.testRole) { if (!confirm(`Leave test mode in this tab? The ${wallet.testRole} key stays in this browser; open ?testwallet=reset to delete it.`)) return; try { sessionStorage.removeItem("coveredmarket.testwallet.role"); } catch {} setWallet(loadWallet()); return; }
    if (!confirm(wallet?.via ? `Disconnect ${wallet.viaName ?? "this wallet"}?` : "Forget this sandbox account on this device? Its key is only stored here.")) return;
    if (wallet?.via) await disconnectWallet(); clearWallet(); setWallet(null);
  };
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
      case "sell": return wallet ? <Sell wallet={wallet} /> : <NeedWallet onCreate={getWallet} />;
      case "deposit": return <Deposit serial={Number(parts[1])} wallet={wallet} />;
      case "contracts": return wallet ? <Contracts wallet={wallet} /> : <NeedWallet onCreate={getWallet} />;
      case "c": return <Contract serial={Number(parts[1])} wallet={wallet} />;
      case "buy": return <Buy serial={Number(parts[1])} wallet={wallet} onCreate={getWallet} />;
      case "try": return <Try wallet={wallet} onCreate={getWallet} />;
      default: return <Market />;
    }
  })();
  return (
    <div className="cv-root" style={{ minHeight: "100vh", background: "var(--paper)", color: "var(--ink)", fontFamily: "var(--font-sans)" }}>
      <NetworkBand />
      <TopBar items={CFG.disabled ? [] : nav(page)} href="#/market">
        <NetworkSwitch />
        {CFG.disabled ? null : wallet ? (
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            {wallet.testRole && <span title="Hidden test wallet for automated testing: key in this browser, testnet only" style={{ padding: "3px 8px", fontSize: 11, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase", background: "var(--gilt)", color: "var(--on-gilt)" }}>Test wallet · {wallet.testRole}</span>}
            <Button size="sm" onClick={forget} title={wallet.via ? `${wallet.accountId} · connected with ${wallet.viaName ?? wallet.via}` : wallet.accountId}>{shortAccount(wallet.accountId)}</Button>
          </span>
        ) : preparing ? (
          <span className="body-small" style={{ color: "var(--ink-muted)" }}>{preparing}</span>
        ) : (
          <Button size="sm" variant="primary" disabled={busy} onClick={getWallet}>{busy ? "Waiting for the wallet…" : canConnect() ? "Connect wallet" : "Create account"}</Button>
        )}
      </TopBar>
      {naming && !wallet && !canConnect() && (
        <div style={{ margin: "16px 48px", padding: 20, border: "1px solid var(--rule)", background: "var(--paper-raised)", maxWidth: 620, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div className="heading" style={{ marginBottom: 6 }}>A NEAR sandbox account for this device</div>
            <p className="body-small" style={{ color: "var(--ink-muted)", margin: "0 0 10px" }}>Wallets know mainnet and testnet, not this private sandbox, so the account's key stays in this browser. It comes with test USDC; gas is paid by the relayer.</p>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}><Field label="Name" placeholder="astrid" value={name} onChange={(e) => setName(e.target.value)} help={`becomes ${name || "name"}.${CFG.accountSuffix || CFG.network}`} /></div>
              <Button disabled={busy || !name} onClick={async () => { setBusy(true); try { setWallet(await createWallet(name)); setNaming(false); } catch (e) { alert((e as Error).message); } finally { setBusy(false); } }}>{busy ? "Creating…" : "Create"}</Button>
            </div>
          </div>
          <div><Button variant="quiet" onClick={() => setNaming(false)}>Cancel</Button></div>
        </div>
      )}
      {content}
      <div style={{ padding: "16px 48px 24px", borderTop: "1px solid var(--rule)", marginTop: 48 }} className="body-small cv-pad">
        <ChainClock />
        <Notice>CoveredMarket is unaudited hackathon software.{CFG.disabled ? null : <> Only the contract <a href={`${CFG.explorerNear}/address/${CFG.contract}`} target="_blank" rel="noreferrer"><code>{CFG.contract}</code></a> can ask NEAR's signing network to spend a deposit address; CoveredMarket the company cannot. If the signing network stopped, settlement would stop with it.</>}</Notice>
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
      <Button variant="primary" onClick={onCreate}>{canConnect() ? "Connect wallet" : "Create account"}</Button>
      {canConnect() && <p className="body-small" style={{ color: "var(--ink-muted)", maxWidth: 520, marginTop: 12 }}>No NEAR wallet yet? <a href="https://meteorwallet.app" target="_blank" rel="noreferrer">Meteor</a> is a browser extension that works on testnet and mainnet. Your Bitcoin wallet (UniSat, Xverse, Leather…) is only needed to pay a deposit.</p>}
    </div>
  );
}
