import { useCallback, useEffect, useState } from "react";
import { C, dateUtc, usd } from "../ds";
import { describe, who } from "../lib/activity";
import { call, CFG, view, type Wallet } from "../lib/near";
import type { Offer, Params } from "../lib/verify";
import { ContractLine } from "./AllContracts";
import { useParams } from "./hooks";

/** Something only you can do next, with where to do it. */
export interface Todo { key: string; text: string; detail: string; href?: string; act: string }

/** Your offers and calls, the USDC owed to you, and what is waiting on you. Read once at the app level, so the
 *  Portfolio menu item can show how many things need you. */
export function usePortfolio(wallet: Wallet | null) {
  const params = useParams();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [claimable, setClaimable] = useState("0");
  const me = wallet?.accountId ?? null;
  const load = useCallback(() => {
    if (!me) { setOffers([]); setClaimable("0"); return; }
    view<Offer[]>("get_account_offers", { account: me }).then(setOffers).catch(() => {});
    view<string>("get_claimable", { account: me }).then(setClaimable).catch(() => {});
  }, [me]);
  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, [load]);
  return { me, offers, claimable, params, reload: load, todos: me ? todosFor(me, offers, params) : [] };
}

function todosFor(me: string, offers: Offer[], params: Params | null): Todo[] {
  const now = Date.now() / 1000, grace = params?.grace_s ?? 7200, timeout = params?.escrow_timeout_s ?? 604800;
  const out: Todo[] = [];
  for (const o of offers) {
    const id = `CV-${o.serial}`, exp = Number(o.expiry_s), btc = `${(Number(o.size_sats) / 1e8).toFixed(4)} BTC`;
    if (o.seller === me && o.state === "Created")
      out.push({ key: id + "d", text: `${id}: deposit ${btc} to put it on sale`, detail: "Until the coins arrive, nobody can buy it.", href: `#/deposit/${o.serial}`, act: "Deposit" });
    if (o.seller === me && o.state === "Funded" && exp <= now)
      out.push({ key: id + "w", text: `${id} expired unsold`, detail: "Withdraw your coins back to your Bitcoin address.", href: `#/c/${o.serial}`, act: "Withdraw" });
    if (o.buyer === me && o.state === "Sold" && now >= exp && now < exp + grace)
      out.push({ key: id + "x", text: `${id}: your exercise window is open`, detail: `Pay ${usd(o.strike_total_units)} before ${dateUtc(exp + grace)} to receive ${btc}; otherwise it expires.`, href: `#/c/${o.serial}`, act: "Exercise" });
    if (o.buyer === me && o.escrow_units !== "0" && now >= Number(o.unlock_s ?? 0) + timeout)
      out.push({ key: id + "r", text: `${id}: your strike can be reclaimed`, detail: "Delivery was never proven, so the strike in escrow is yours again.", href: `#/c/${o.serial}`, act: "Reclaim" });
  }
  return out;
}

/** A contract described from your side of it. */
function mine(o: Offer, me: string, nowS: number) {
  const row = describe(o, nowS), seller = o.seller === me, exp = Number(o.expiry_s), until = dateUtc(exp);
  const exercise = o.commitment_reason === "Exercise";
  const line = seller
    ? ({
        Created: "waiting for your deposit",
        Funded: exp > nowS ? `for sale; expires ${until}` : "expired unsold; withdraw your coins",
        Sold: exp > nowS ? `sold to ${who(o.buyer)}; expires ${until}` : "sold; the buyer's exercise window is open",
        ExercisePending: "the buyer paid the strike; checking the deposit",
        Committed: exercise ? "exercised; coins on their way to the buyer" : "coins on their way back to you",
        Signed: exercise ? "exercised; coins on their way to the buyer" : "coins on their way back to you",
        Kept: "not exercised; you kept the coins and the premium",
        Exercised: "exercised; you were paid the strike",
        Withdrawn: "you took the coins back unsold",
        Cancelled: "cancelled before the deposit",
        Rescued: "you moved the coins with your rescue key",
      } as Record<string, string>)[o.state]
    : ({
        Sold: exp > nowS ? `you hold this call; expires ${until}` : "your exercise window is open",
        ExercisePending: "you paid the strike; checking the deposit",
        Committed: exercise ? "exercised; coins on their way to you" : "not exercised; coins returning to the seller",
        Signed: exercise ? "exercised; coins on their way to you" : "not exercised; coins returning to the seller",
        Kept: "not exercised; the call expired",
        Exercised: "you paid the strike and received the coins",
        Rescued: "the seller used the rescue key",
      } as Record<string, string>)[o.state];
  return { ...row, line: line ?? row.line };
}

const List = ({ title, note, items, me, now }: { title: string; note?: string; items: Offer[]; me: string; now: number }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
      <h3 className="label" style={{ margin: 0, textTransform: "uppercase", color: "var(--ink-muted)" }}>{title} <span className="cv-mono">{items.length}</span></h3>
      {note && <span className="body-small" style={{ color: "var(--ink-muted)" }}>{note}</span>}
    </div>
    {items.length > 0 && (
      <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--rule)", background: "var(--paper-raised)" }}>
        {items.map((o, i) => <ContractLine key={o.serial} {...mine(o, me, now)} first={i === 0} />)}
      </div>
    )}
  </div>
);

export function Portfolio({ wallet, data, onConnect }: { wallet: Wallet | null; data: ReturnType<typeof usePortfolio>; onConnect: () => void }) {
  const { StatTile, Button } = C();
  const [busy, setBusy] = useState(false);
  const head = (lede: string) => (
    <div style={{ maxWidth: 560 }}>
      <h1 className="display-2" style={{ margin: "0 0 8px", fontSize: 48, lineHeight: 1.02 }}>Portfolio</h1>
      <p className="lede" style={{ margin: 0, color: "var(--ink-muted)" }}>{lede}</p>
    </div>
  );

  if (!wallet || !data.me) {
    const parts: [string, string][] = [
      ["What needs you", "A deposit to make, an exercise window open on a call you bought, USDC to claim."],
      ["Calls you sell", "Each offer from deposit to settlement, and where your coins are right now."],
      ["Calls you bought", "What you hold, when each expires, and what you would pay to exercise."],
    ];
    return (
      <div className="cv-pad" style={{ padding: "32px 48px 48px", display: "flex", flexDirection: "column", gap: 28 }}>
        {head("Your side of the market: the calls you sell and the calls you buy. Connect a NEAR wallet to see yours.")}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", border: "1px solid var(--rule)", background: "var(--paper-raised)" }}>
          {parts.map(([t, d], i) => (
            <div key={t} style={{ padding: "16px 18px", borderLeft: i ? "1px solid var(--rule)" : "none" }}>
              <div className="body" style={{ fontWeight: 600, marginBottom: 4 }}>{t}</div>
              <div className="body-small" style={{ color: "var(--ink-muted)" }}>{d}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Button variant="primary" onClick={onConnect}>Connect wallet</Button>
          <a href="#/market" className="body" style={{ color: "var(--intaglio)" }}>Browse the market without one</a>
        </div>
        <p className="body-small" style={{ margin: 0, color: "var(--ink-muted)", maxWidth: 560 }}>A NEAR account identifies you as seller or buyer. Your Bitcoin stays in your own Bitcoin wallet; this account only signs instructions. No NEAR wallet yet? <a href="https://meteorwallet.app" target="_blank" rel="noreferrer">Meteor</a> is a browser extension that works on testnet.</p>
      </div>
    );
  }

  const me = data.me, now = Date.now() / 1000;
  const selling = data.offers.filter((o) => o.seller === me), bought = data.offers.filter((o) => o.buyer === me && o.seller !== me);
  const final = ["Kept", "Exercised", "Withdrawn", "Cancelled", "Rescued"];
  const rest = selling.filter((o) => ["Funded", "Sold", "ExercisePending", "Committed", "Signed"].includes(o.state)).reduce((s, o) => s + Number(o.size_sats), 0) / 1e8;
  const owed = Number(data.claimable) / 1e6;
  const claim = async () => { setBusy(true); try { await call(wallet, CFG.contract, "claim", {}, 0n, 60); data.reload(); } catch (e) { alert((e as Error).message); } finally { setBusy(false); } };
  const todos = data.todos;
  const nothing = selling.length === 0 && bought.length === 0;

  return (
    <div className="cv-pad" style={{ padding: "32px 48px 48px", display: "flex", flexDirection: "column", gap: 32 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
        {head("The calls you sell and the calls you buy, what is waiting on you, and where your coins are right now.")}
        <div className="cv-tiles" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <StatTile label="Coins at rest" value={rest} kind="btc" tone="btc" note="in your live contracts" />
          <StatTile label="Claimable USDC" value={owed} kind="usd" tone="gilt" note="premiums and strikes owed to you" />
        </div>
      </div>

      <section data-cv="needs-you" aria-labelledby="todo-h" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 id="todo-h" className="display-2" style={{ margin: 0, fontSize: 28, lineHeight: 1.1 }}>Needs you <span className="cv-mono" style={{ fontSize: 18, color: "var(--ink-muted)" }}>{todos.length + (owed > 0 ? 1 : 0)}</span></h2>
        {todos.length === 0 && owed === 0
          ? <div className="body-small" style={{ color: "var(--ink-muted)" }}>Nothing right now. Deposits, exercise windows and USDC to claim show up here.</div>
          : <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--gilt)", background: "var(--paper-raised)" }}>
              {owed > 0 && (
                <div className="cv-todo">
                  <div><div className="body" style={{ fontWeight: 600 }}>{usd(data.claimable)} to claim</div><div className="body-small" style={{ color: "var(--ink-muted)" }}>Premiums and strikes owed to you, held by the contract until you claim them.</div></div>
                  <Button variant="primary" size="sm" disabled={busy} onClick={claim}>{busy ? "Claiming…" : "Claim"}</Button>
                </div>
              )}
              {todos.map((t) => (
                <div className="cv-todo" key={t.key}>
                  <div><div className="body" style={{ fontWeight: 600 }}>{t.text}</div><div className="body-small" style={{ color: "var(--ink-muted)" }}>{t.detail}</div></div>
                  <Button size="sm" variant="primary" href={t.href}>{t.act}</Button>
                </div>
              ))}
            </div>}
      </section>

      {nothing ? (
        <div className="body" style={{ color: "var(--ink-muted)" }}>No contracts yet. <a href="#/sell" style={{ color: "var(--intaglio)" }}>Sell a call</a> or <a href="#/market" style={{ color: "var(--intaglio)" }}>buy one on the market</a>.</div>
      ) : (
        <div className="cv-split" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 32, alignItems: "start" }}>
          <section aria-labelledby="sell-h" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <h2 id="sell-h" className="display-2" style={{ margin: 0, fontSize: 28, lineHeight: 1.1 }}>Selling</h2>
            {selling.length === 0 ? <div className="body-small" style={{ color: "var(--ink-muted)" }}>You have not sold a call. <a href="#/sell" style={{ color: "var(--intaglio)" }}>Sell one</a>: you keep your coins on Bitcoin and earn the premium.</div> : <>
              <List title="Awaiting deposit" items={selling.filter((o) => o.state === "Created")} me={me} now={now} />
              <List title="For sale" items={selling.filter((o) => o.state === "Funded")} me={me} now={now} />
              <List title="Sold, live" note="coins locked until expiry" items={selling.filter((o) => !final.includes(o.state) && !["Created", "Funded"].includes(o.state))} me={me} now={now} />
              <List title="Settled" items={selling.filter((o) => final.includes(o.state))} me={me} now={now} />
            </>}
          </section>
          <section aria-labelledby="bought-h" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <h2 id="bought-h" className="display-2" style={{ margin: 0, fontSize: 28, lineHeight: 1.1 }}>Bought</h2>
            {bought.length === 0 ? <div className="body-small" style={{ color: "var(--ink-muted)" }}>You have not bought a call. <a href="#/market" style={{ color: "var(--intaglio)" }}>See what is for sale</a>: you pay the premium now and the strike only if you exercise.</div> : <>
              <List title="Live" items={bought.filter((o) => !final.includes(o.state))} me={me} now={now} />
              <List title="Settled" items={bought.filter((o) => final.includes(o.state))} me={me} now={now} />
            </>}
          </section>
        </div>
      )}
    </div>
  );
}
