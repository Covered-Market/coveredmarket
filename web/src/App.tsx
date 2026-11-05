import { useEffect, useState } from "react";
import { C } from "./ds";
import { CFG, clearWallet, createWallet, loadWallet, type Wallet } from "./lib/near";
import { Buy } from "./pages/Buy";
import { Contract } from "./pages/Contract";
import { Contracts } from "./pages/Contracts";
import { Deposit } from "./pages/Deposit";
import { Market } from "./pages/Market";
import { Sell } from "./pages/Sell";
import { Try } from "./pages/Try";

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
  const nav = (on: string) => [
    { label: "Market", href: "#/market", on: on === "market" },
    { label: "Sell a call", href: "#/sell", on: on === "sell" },
    { label: "My contracts", href: "#/contracts", on: on === "contracts" },
    { label: "Try it", href: "#/try", on: on === "try" },
  ];
  const page = parts[0] ?? "market";
  const content = (() => {
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
      <TopBar items={nav(page)} href="#/market">
        {wallet ? (
          <Button size="sm" onClick={() => { if (confirm("Forget this wallet on this device?")) { clearWallet(); setWallet(null); } }}>{wallet.accountId}</Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => setNaming(true)}>Create wallet</Button>
        )}
      </TopBar>
      {naming && (
        <div style={{ margin: "16px 48px", padding: 20, border: "1px solid var(--rule)", background: "var(--paper-raised)", maxWidth: 560 }}>
          <div className="heading" style={{ marginBottom: 8 }}>A NEAR {CFG.network} account for this device</div>
          <p className="body-small" style={{ color: "var(--ink-muted)", margin: "0 0 12px" }}>The key stays in this browser. Gas is paid by the Covered relayer, so you never need NEAR. On testnet the helper funds the account.</p>
          <Field label="Name" placeholder="astrid" value={name} onChange={(e) => setName(e.target.value)} help={`becomes ${name || "name"}.${CFG.network}`} />
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Button variant="primary" disabled={busy || !name} onClick={async () => { setBusy(true); try { setWallet(await createWallet(name)); setNaming(false); } catch (e) { alert((e as Error).message); } finally { setBusy(false); } }}>{busy ? "Creating…" : "Create"}</Button>
            <Button variant="quiet" onClick={() => setNaming(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {content}
      <div style={{ padding: "24px 48px", borderTop: "1px solid var(--rule)", marginTop: 48 }} className="body-small">
        <Notice>Covered is unaudited software. Only the contract <code>{CFG.contract}</code> can ask NEAR's signing network to spend a deposit address; Covered the company cannot. If the signing network stopped, settlement would stop with it.</Notice>
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
      <Button variant="primary" onClick={onCreate}>Create wallet</Button>
    </div>
  );
}
