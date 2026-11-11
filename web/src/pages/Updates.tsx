/**
 * Updates: what changed, newest first, at `#/updates` on both the website and the app. Written for people using
 * CoveredMarket, not for developers: one entry per day that changed something they can see or rely on. Add new
 * entries at the top of UPDATES.
 */
import { useEffect } from "react";
import { LegalLinks } from "./Legal";
import { Waitlist } from "./Waitlist";
import "../landing.css";

const REPO = "https://github.com/Covered-Market/coveredmarket";

const UPDATES: { date: string; title: string; items: string[] }[] = [
  {
    date: "10 Nov 2026", title: "Market and Portfolio, terms and privacy",
    items: [
      "The app is now two places: Market, for every open offer, and Portfolio, for what is yours. Selling a call is an action from either.",
      "Empty states say what to do next instead of showing a blank table.",
      "Terms of use and a privacy notice, linked from every footer. The privacy notice lists exactly what the relayer logs and which services your browser calls.",
      "A mainnet waitlist and this page.",
    ],
  },
  {
    date: "9 Nov 2026", title: "covered.market and the testnet app",
    items: [
      "The website and the app now live apart: covered.market is the website, and the testnet app has its own address. A mainnet app will get its own when it opens.",
      "A new landing page: the film, the idea in one example, a returns calculator, a side-by-side comparison and who can sign for your coins.",
    ],
  },
  {
    date: "8 Nov 2026", title: "Covered is now CoveredMarket",
    items: ["The product takes the name of its domain, covered.market."],
  },
  {
    date: "7 Nov 2026", title: "Your own testnet wallet",
    items: [
      "Connect a NEAR testnet wallet and the app sends you free test NEAR and test USDC to try it.",
      "The source code is published under the MIT licence.",
    ],
  },
  {
    date: "6 Nov 2026", title: "A way out that needs only Bitcoin",
    items: [
      "Every deposit address now has a rescue branch: a key only the seller holds, usable after a fixed delay past expiry, so coins come back even if NEAR stops. The app gives you a rescue kit when you sell.",
      "Settlement transactions can be re-signed with a higher fee if Bitcoin is busy.",
      "A security policy with private reporting. A bug bounty follows after the audits, not before January 2027.",
      "Steadier transactions when a NEAR RPC node lags or hands out a stale nonce.",
    ],
  },
];

export function Updates() {
  useEffect(() => { document.title = "Updates — CoveredMarket"; scrollTo(0, 0); }, []);
  return (
    <div className="ld">
      <header className="ld-head">
        <div className="ld-wrap">
          <a href="/" aria-label="CoveredMarket home" className="ld-logo-link"><img className="ld-logo" src="/site/lockup-32.svg" alt="CoveredMarket" /></a>
        </div>
      </header>
      <main className="ld-wrap lg">
        <p className="ld-kicker">Changelog</p>
        <h1 className="ld-h2" style={{ maxWidth: "none", marginBottom: 12 }}>Updates</h1>
        <p className="ld-lede" style={{ margin: "0 0 32px" }}>What changed in CoveredMarket, newest first. Every change is in the <a href={`${REPO}/commits`} target="_blank" rel="noreferrer">source history</a>.</p>
        {UPDATES.map((u) => (
          <section key={u.date} className="lg-sec up-entry" aria-label={`${u.date}: ${u.title}`}>
            <p className="ld-mono ld-muted up-date"><time>{u.date}</time></p>
            <div>
              <h2 className="lg-h2">{u.title}</h2>
              <ul>{u.items.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          </section>
        ))}
        <section id="waitlist" className="lg-sec" aria-labelledby="up-wl">
          <h2 id="up-wl" className="lg-h2">Mainnet waitlist</h2>
          <p>CoveredMarket runs on test coins only for now. Leave your email and we will write once, when mainnet opens.</p>
          <Waitlist source="updates" />
        </section>
      </main>
      <LegalLinks />
    </div>
  );
}
