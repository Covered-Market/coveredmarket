/** Every on-chain id the app shows links to a public explorer for the right network. */
import { CFG } from "./lib/near";

export const btcTx = (txid: string) => `${CFG.explorerBtc}/tx/${txid}`;
export const btcAddr = (a: string) => `${CFG.explorerBtc}/address/${a}`;
export const nearAcct = (a: string) => `${CFG.explorerNear}/address/${a}`;
export const nearTx = (h: string) => `${CFG.explorerNear}/txns/${h}`;

const short = (s: string) => (s.length > 20 ? `${s.slice(0, 10)}…${s.slice(-8)}` : s);

export function Ext({ href, children, full }: { href: string; children: string; full?: boolean }) {
  return <a href={href} target="_blank" rel="noreferrer" className="cv-mono" style={{ color: "var(--intaglio)", textDecoration: "underline", textUnderlineOffset: 2, ...(full ? { wordBreak: "break-all" } : { whiteSpace: "nowrap" }) }} title={children}>{full ? children : short(children)}</a>;
}

/** The public record of one contract, on both chains. */
export function OnChainRecord({ rows }: { rows: [string, string | undefined | null, (v: string) => string][] }) {
  const shown = rows.filter(([, v]) => !!v) as [string, string, (v: string) => string][];
  return (
    <div style={{ border: "1px solid var(--rule)", background: "var(--paper-raised)", padding: "14px 18px" }}>
      <div className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 8 }}>On-chain record</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "6px 16px", fontSize: 13 }}>
        {shown.map(([k, v, link]) => [<span key={k + "k"} style={{ color: "var(--ink-muted)" }}>{k}</span>, <Ext key={k + "v"} href={link(v)}>{v}</Ext>])}
      </div>
    </div>
  );
}
