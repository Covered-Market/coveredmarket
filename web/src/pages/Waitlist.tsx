/**
 * The mainnet waitlist: an email field that posts to the relayer (POST /api/waitlist), which stores the address and
 * forwards it to CONTACT. The privacy notice says what is kept and why.
 */
import { useState } from "react";

export const CONTACT = "contact@covered.market";

type State = { k: "idle" } | { k: "busy" } | { k: "done" } | { k: "error"; msg: string };

export function Waitlist({ source }: { source: "landing" | "updates" }) {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState(""); // hidden from people; only bots fill it
  const [st, setSt] = useState<State>({ k: "idle" });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSt({ k: "busy" });
    try {
      const r = await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email.trim(), source, company }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `the server answered ${r.status}`);
      setSt({ k: "done" });
    } catch (err) {
      setSt({ k: "error", msg: (err as Error).message || "could not reach the server" });
    }
  };
  if (st.k === "done") return (
    <div className="wl-form wl-done" role="status">
      <p className="heading" style={{ margin: 0 }}>You are on the list.</p>
      <p className="body-small ld-muted wl-note">We will write to <strong style={{ color: "var(--ink)" }}>{email.trim()}</strong> when mainnet opens. To be taken off, write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
    </div>
  );
  return (
    <form className="wl-form" onSubmit={submit}>
      <label className="wl-field">
        <span className="ld-label ld-muted">Your email</span>
        <input type="email" required autoComplete="email" inputMode="email" placeholder="you@example.com" value={email} onChange={(e) => { setEmail(e.target.value); if (st.k === "error") setSt({ k: "idle" }); }} />
      </label>
      <input className="wl-hp" type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" value={company} onChange={(e) => setCompany(e.target.value)} />
      <button type="submit" className="ld-btn ld-btn--primary" disabled={st.k === "busy"}>{st.k === "busy" ? "Joining…" : "Join the waitlist"}</button>
      <p className="body-small ld-muted wl-note" role="status" style={st.k === "error" ? { color: "var(--oxblood)" } : undefined}>
        {st.k === "error"
          ? <>Could not join: {st.msg}. You can also write to <a href={`mailto:${CONTACT}?subject=Mainnet%20waitlist`}>{CONTACT}</a>.</>
          : <>We use your address only to tell you when mainnet opens, and delete it when you ask. See <a href="#/privacy">Privacy</a>.</>}
      </p>
    </form>
  );
}
