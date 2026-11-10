import { useEffect, useRef, useState } from "react";
import { C } from "../ds";
import { describe, newestSerial, type FeedRow } from "../lib/activity";
import { view } from "../lib/near";
import type { Offer } from "../lib/verify";

/** How many of the latest contracts the Market lists. */
const LATEST = 60;

export type Group = "sale" | "live" | "settled";
/** Which tab a contract belongs to. For sale: deposited, unsold, not yet expired. Settled: final states. Live: the rest. */
export const groupOf = (o: Offer, nowS: number): Group =>
  o.state === "Funded" && Number(o.expiry_s) > nowS ? "sale"
  : ["Kept", "Exercised", "Withdrawn", "Cancelled", "Rescued"].includes(o.state) ? "settled"
  : "live";

export interface ContractRow extends FeedRow { group: Group }

/** The latest contracts, newest first, refreshed every 30 seconds. The contract has no "list everything" view, so
 *  the newest serial is found with `newestSerial` and the ones below it are read one by one. `hint` (a serial known
 *  to exist, e.g. the highest open offer) only speeds up that search. */
export function useContracts(hint: number) {
  const [rows, setRows] = useState<ContractRow[] | null>(null);
  const [newest, setNewest] = useState(0);
  const known = useRef(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const exists = async (s: number) => (await view<Offer | null>("get_offer", { serial: s })) !== null;
        const top = await newestSerial(exists, Math.max(known.current, hint));
        known.current = top;
        const serials = Array.from({ length: Math.min(LATEST, top) }, (_, i) => top - i);
        const got = await Promise.all(serials.map((s) => view<Offer | null>("get_offer", { serial: s }).catch(() => null)));
        const now = Date.now() / 1000;
        if (alive) {
          setNewest(top);
          setRows(got.filter((o): o is Offer => !!o).map((o) => ({ ...describe(o, now), group: groupOf(o, now) })));
        }
      } catch { if (alive) setRows((r) => r ?? []); }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [hint]);
  return { rows, newest };
}

/** The life of one contract, in the words the stamps use, so every status on the page reads as a step. */
export function Lifecycle() {
  const steps: [string, string][] = [
    ["Created", "A seller sets size, strike, expiry and premium. The contract derives a Bitcoin address for it."],
    ["For sale", "The seller's coins arrive at that address and are proven on NEAR. Anyone can buy the call."],
    ["Sold", "A buyer pays the premium in USDC, credited to the seller at once. The coins stay put until expiry."],
    ["Exercise window", "After expiry the buyer may pay the strike. Nothing else decides the outcome."],
    ["Kept or Exercised", "The contract signs the coins back to the seller, or to the buyer if the strike was paid."],
  ];
  return (
    <section data-cv="lifecycle" aria-labelledby="life-h" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 id="life-h" className="display-2" style={{ margin: 0, fontSize: 28, lineHeight: 1.1 }}>How a contract moves</h2>
      <ol className="cv-life" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {steps.map(([t, d], i) => (
          <li key={t}>
            <span className="cv-life__n">{i + 1}</span>
            <div><div className="body-small" style={{ fontWeight: 600 }}>{t}</div><div className="body-small" style={{ color: "var(--ink-muted)" }}>{d}</div></div>
          </li>
        ))}
      </ol>
      <p className="body-small" style={{ margin: 0, color: "var(--ink-muted)" }}>Before a buyer comes, the seller can withdraw the coins. If NEAR ever stops, the seller's own rescue key can take them back after a fixed delay.</p>
    </section>
  );
}

/** One contract as a line that opens its certificate. Shared by the Market and the Portfolio. */
export function ContractLine({ serial, line, stamp, word, sizeBtc, strikeUsd, premiumUsd, when, first }: { serial: number; line: string; stamp: FeedRow["stamp"]; word: string; sizeBtc: number; strikeUsd: number; premiumUsd: number; when?: string; first?: boolean }) {
  const { Stamp, Figure } = C();
  return (
    <a href={`#/c/${serial}`} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "4px 12px", alignItems: "center", padding: "12px 16px", borderTop: first ? "none" : "1px solid var(--rule)", color: "inherit", textDecoration: "none" }}>
      <span className="body-small" style={{ minWidth: 0 }}><b className="cv-mono">CV-{serial}</b> · {line}</span>
      <span style={{ justifySelf: "end" }}><Stamp status={stamp} flat>{word}</Stamp></span>
      <span>
        <Figure value={sizeBtc} kind="btc" size="sm" /> <span className="body-small" style={{ color: "var(--ink-muted)" }}>at</span> <Figure value={strikeUsd} kind="usd" size="sm" />
        <span className="body-small" style={{ color: "var(--ink-muted)" }}> · premium </span><Figure value={premiumUsd} kind="usd" size="sm" tone="gilt" />
      </span>
      <span className="body-small" style={{ justifySelf: "end", color: "var(--ink-muted)", whiteSpace: "nowrap" }}>{when}</span>
    </a>
  );
}

const TABS: [Group | "all", string][] = [["sale", "For sale"], ["live", "Live"], ["settled", "Settled"], ["all", "All"]];

/** Every recent contract, in tabs by where it is in its life. Each line opens its public certificate. */
export function AllContracts({ rows }: { rows: ContractRow[] | null }) {
  const [tab, setTab] = useState<Group | "all">("live");
  const shown = rows?.filter((r) => tab === "all" || r.group === tab) ?? null;
  const count = (g: Group | "all") => (rows ? (g === "all" ? rows.length : rows.filter((r) => r.group === g).length) : 0);
  return (
    <section data-cv="activity" aria-labelledby="all-h" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 id="all-h" className="display-2" style={{ margin: 0, fontSize: 28, lineHeight: 1.1 }}>All contracts</h2>
        <span className="body-small" style={{ color: "var(--ink-muted)" }}>The latest {LATEST} on this network, newest first. Each opens its certificate, which anyone can verify.</span>
      </div>
      <div role="tablist" aria-label="Filter contracts" className="cv-tabs">
        {TABS.map(([g, label]) => (
          <button key={g} type="button" role="tab" aria-selected={tab === g} className={"cv-tab" + (tab === g ? " cv-tab--on" : "")} onClick={() => setTab(g)}>
            {label} <span className="cv-tab__n">{count(g)}</span>
          </button>
        ))}
      </div>
      {shown === null && <div className="body-small" style={{ color: "var(--ink-muted)" }}>Reading the contract…</div>}
      {shown?.length === 0 && <div className="body-small" style={{ color: "var(--ink-muted)" }}>None right now.</div>}
      {!!shown?.length && (
        <div role="tabpanel" style={{ display: "flex", flexDirection: "column", border: "1px solid var(--rule)", background: "var(--paper-raised)" }}>
          {shown.map((r, i) => <ContractLine key={r.serial} {...r} first={i === 0} />)}
        </div>
      )}
    </section>
  );
}
