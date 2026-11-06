/**
 * Which network you are on, impossible to miss: a band on every page outside mainnet, and a two-way switch
 * in the header that jumps to the other network's site (separate contract, relayer and keys — the two never
 * mix in one session). On a network without a contract the app shows `NotLive` instead.
 */
import { CFG } from "./lib/near";

const LABEL = { testnet: "Testnet", mainnet: "Mainnet", local: "Local sandbox" } as const;

export function NetworkBand() {
  if (CFG.mode === "mainnet") return null;
  const text = CFG.mode === "local"
    ? "Local sandbox — a private NEAR chain and Bitcoin regtest on this machine. Nothing here exists anywhere else."
    : "Testnet — Bitcoin testnet3 and NEAR testnet. Test coins and test USDC with no value.";
  return (
    <div role="status" style={{ background: "var(--gilt)", color: "var(--on-gilt)", padding: "6px 48px", display: "flex", gap: 16, alignItems: "center", justifyContent: "space-between", fontSize: 13, letterSpacing: 0.2 }}>
      <span><strong style={{ textTransform: "uppercase", letterSpacing: 1 }}>{LABEL[CFG.mode]}</strong> · {text.split(" — ")[1]}</span>
      {CFG.switchUrl && <a href={CFG.switchUrl} style={{ color: "inherit", fontWeight: 600 }}>Go to mainnet →</a>}
    </div>
  );
}

export function NetworkSwitch() {
  if (!CFG.switchUrl && CFG.mode !== "mainnet") return <span className="label" style={{ color: "var(--ink-muted)" }}>{LABEL[CFG.mode]}</span>;
  const here = CFG.mode === "mainnet" ? "mainnet" : "testnet";
  const seg = (net: "testnet" | "mainnet") => {
    const on = net === here;
    const style = { padding: "4px 10px", fontSize: 12, textDecoration: "none", border: "1px solid var(--rule-strong)", background: on ? (net === "mainnet" ? "var(--intaglio)" : "var(--gilt)") : "transparent", color: on ? (net === "mainnet" ? "var(--on-intaglio)" : "var(--on-gilt)") : "var(--ink-muted)", fontWeight: on ? 600 : 400 } as const;
    return on || !CFG.switchUrl
      ? <span aria-current={on ? "true" : undefined} style={style}>{LABEL[net]}</span>
      : <a href={CFG.switchUrl} title={`Switch to ${LABEL[net]} (a separate site)`} style={style}>{LABEL[net]}</a>;
  };
  return <span role="group" aria-label="Network" style={{ display: "inline-flex", marginRight: 12 }}>{seg("testnet")}{seg("mainnet")}</span>;
}

export function NotLive() {
  return (
    <div style={{ padding: "64px 48px", maxWidth: 640 }}>
      <div className="label" style={{ color: "var(--ink-muted)", marginBottom: 8 }}>Mainnet</div>
      <h1 className="title" style={{ margin: "0 0 12px" }}>Not live yet</h1>
      <p className="body" style={{ color: "var(--ink-muted)" }}>Covered on Bitcoin mainnet opens once its contract is deployed and locked. Until then everything works on testnet with test coins — same contract code, same signing network, same Bitcoin light client design.</p>
      {CFG.switchUrl && <p><a href={CFG.switchUrl} className="body" style={{ color: "var(--intaglio)", fontWeight: 600 }}>Use Covered on testnet →</a></p>}
    </div>
  );
}
