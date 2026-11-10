import { useEffect, useRef, useState, type ReactNode } from "react";
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

/** An empty list: what will be here, and the next step if there is one. Shared by the Market and the Portfolio. */
export function EmptyBox({ title, text, action, href }: { title: string; text: string; action?: string; href?: string }) {
  const { Button } = C();
  return (
    <div className="cv-empty">
      <div><div className="body" style={{ fontWeight: 600 }}>{title}</div><div className="body-small" style={{ color: "var(--ink-muted)" }}>{text}</div></div>
      {action && href && <Button size="sm" href={href}>{action}</Button>}
    </div>
  );
}

const EMPTY: Record<Group | "all", [string, string, string?, string?]> = {
  sale: ["Nothing for sale right now", "Offers appear here once their coins are deposited and proven.", "Sell a call", "#/sell"],
  live: ["No live contracts", "Contracts show here from creation until they settle."],
  settled: ["Nothing settled yet", "Contracts show here once their coins are returned or delivered."],
  all: ["No contracts yet", "Every contract on this network will be listed here.", "Sell a call", "#/sell"],
};

const TABS: [Group | "all", string][] = [["sale", "For sale"], ["live", "Live"], ["settled", "Settled"], ["all", "All"]];
/** Tab icons: the brand's premium, clock and kept glyphs (assets/Icons), and a list in the same 2px style. */
const TAB_ICON: Record<Group | "all", string> = {
  sale: "M12 3v18M8 7h6a2.5 2.5 0 0 1 0 5H9a2.5 2.5 0 0 0 0 5h7",
  live: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7v5l3 2",
  settled: "M5 12l5 5 9-10",
  all: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
};

/** The Market's one list: contracts in tabs by where they are in their life. The For sale tab shows the offers
 *  as cards with their Buy button (`sale`, from the open offers); the others list the latest contracts as lines
 *  that open their certificates. It opens on the first tab with something in it: For sale, Live, then All. */
export function AllContracts({ rows, sale, saleCount }: { rows: ContractRow[] | null; sale: ReactNode; saleCount: number | null }) {
  const [picked, setPicked] = useState<Group | "all" | null>(null);
  const count = (g: Group | "all") => (g === "sale" ? saleCount ?? 0 : rows ? (g === "all" ? rows.length : rows.filter((r) => r.group === g).length) : 0);
  const tab: Group | "all" = picked ?? (saleCount ? "sale" : count("live") || !rows?.length ? "live" : "all");
  const shown = rows?.filter((r) => tab === "all" || r.group === tab) ?? null;
  const empty = () => { const [t, x, a, h] = EMPTY[tab]; return <EmptyBox title={t} text={x} action={a} href={h} />; };
  return (
    <section data-cv="activity" aria-labelledby="all-h" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 id="all-h" className="display-2" style={{ margin: 0, fontSize: 28, lineHeight: 1.1 }}>Contracts</h2>
        <span className="body-small" style={{ color: "var(--ink-muted)" }}>Buy an offer that is for sale, or open any contract's certificate and verify it yourself.</span>
      </div>
      <div role="tablist" aria-label="Filter contracts" className="cv-tabs">
        {TABS.map(([g, label]) => (
          <button key={g} type="button" role="tab" aria-selected={tab === g} className={"cv-tab" + (tab === g ? " cv-tab--on" : "")} onClick={() => setPicked(g)}>
            <svg className="cv-tab__icon" viewBox="0 0 24 24" aria-hidden="true"><path d={TAB_ICON[g]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span className="cv-tab__label">{label}</span>
            <span className="cv-tab__n">{count(g)}</span>
          </button>
        ))}
      </div>
      {tab === "sale"
        ? (saleCount ? <div role="tabpanel">{sale}</div> : empty())
        : <>
            {shown === null && <div className="body-small" style={{ color: "var(--ink-muted)" }}>Reading the contract…</div>}
            {shown?.length === 0 && empty()}
            {!!shown?.length && (
              <div role="tabpanel" style={{ display: "flex", flexDirection: "column", border: "1px solid var(--rule)", background: "var(--paper-raised)" }}>
                {shown.map((r, i) => <ContractLine key={r.serial} {...r} first={i === 0} />)}
              </div>
            )}
          </>}
    </section>
  );
}
