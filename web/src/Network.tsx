/**
 * Which network you are on, impossible to miss: a band at the top of every page. CoveredMarket runs on testnet
 * only for now, so there is no switch to another network. On a network without
 * a contract the app shows `NotLive` instead.
 */
import { CFG } from "./lib/near";

// "site" never shows: the website renders only the landing page, which has no network band or switch.
const LABEL = { testnet: "Testnet", mainnet: "Mainnet", local: "Local sandbox", site: "" } as const;

export function NetworkBand() {
  if (CFG.mode === "mainnet") return null;
  const text = CFG.mode === "local"
    ? "Local sandbox — a private NEAR chain and Bitcoin regtest on this machine. Nothing here exists anywhere else."
    : "Testnet — Bitcoin testnet3 and NEAR testnet. Test coins and test USDC with no value.";
  return (
    <div role="status" style={{ background: "var(--gilt)", color: "var(--on-gilt)", padding: "6px clamp(16px, 4vw, 48px)", display: "flex", flexWrap: "wrap", gap: "4px 16px", alignItems: "center", justifyContent: "space-between", fontSize: 13, letterSpacing: 0.2 }}>
      <span><strong style={{ textTransform: "uppercase", letterSpacing: 1 }}>{LABEL[CFG.mode]}</strong> · {text.split(" — ")[1]}</span>
    </div>
  );
}

export function NotLive() {
  return (
    <div className="cv-pad" style={{ padding: "64px 48px", maxWidth: 640 }}>
      <div className="label" style={{ color: "var(--ink-muted)", marginBottom: 8 }}>Mainnet</div>
      <h1 className="title" style={{ margin: "0 0 12px" }}>Not live yet</h1>
      <p className="body" style={{ color: "var(--ink-muted)" }}>CoveredMarket on Bitcoin mainnet opens once its contract is deployed and locked. Until then everything works on testnet with test coins — same contract code, same signing network, same Bitcoin light client design.</p>
      {CFG.switchUrl && <p><a href={CFG.switchUrl} className="body" style={{ color: "var(--intaglio)", fontWeight: 600 }}>Use CoveredMarket on testnet →</a></p>}
    </div>
  );
}
