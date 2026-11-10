/**
 * Terms of use and privacy notice, at `#/terms` and `#/privacy` on both the website and the app. Plain language,
 * written for what the service is today: test coins only, no accounts, no analytics. Keep it true to the code:
 * if the relayer starts logging something new, or the browser starts calling a new third party, say so here.
 */
import { useEffect, type ReactNode } from "react";
import "../landing.css";

const CONTACT = "security@covered.market";
const REPO = "https://github.com/Covered-Market/coveredmarket";
const UPDATED = "10 November 2026";

const Sec = ({ n, title, children }: { n: number; title: string; children: ReactNode }) => (
  <section className="lg-sec" aria-labelledby={`lg-${n}`}>
    <h2 id={`lg-${n}`} className="lg-h2"><span className="ld-mono ld-muted">{String(n).padStart(2, "0")}</span>{title}</h2>
    {children}
  </section>
);
const Mail = () => <a href={`mailto:${CONTACT}`}>{CONTACT}</a>;

function Terms() {
  return (
    <>
      <Sec n={1} title="What CoveredMarket is">
        <p>CoveredMarket is a website and app for selling and buying covered calls on Bitcoin. The app is an interface to an open-source smart contract on the NEAR test network, together with deposit addresses on the Bitcoin test network. A relayer we run pays network fees, hands out test funds and passes signed transactions on.</p>
        <p>By using the website or the app you agree to these terms. If you do not agree, please do not use them.</p>
      </Sec>
      <Sec n={2} title="Test coins only">
        <p>Everything runs on test networks. Test bitcoin, test NEAR and test USDC have no monetary value, cannot be exchanged for money through CoveredMarket, and may disappear if a test network is reset. Never send real bitcoin or any other asset of value to an address shown in the app. It would not be recoverable, and we could not return it.</p>
      </Sec>
      <Sec n={3} title="Your keys, your coins">
        <p>CoveredMarket never holds your coins or your keys. You connect your own wallet, you sign every transaction yourself, and only the contract’s rules decide where a deposit can go. You are responsible for your wallet, its keys and the rescue kit the app gives you for each offer. We cannot reverse a transaction, recover a lost key or move coins on your behalf.</p>
      </Sec>
      <Sec n={4} title="Experimental, unaudited software">
        <p>The contract, relayer and app have not been independently audited. They may contain bugs that lose test funds, show wrong information or stop working. We may change, pause, reset or shut down any part of the service at any time, with or without notice.</p>
      </Sec>
      <Sec n={5} title="Test funds">
        <p>Test funds from the app are free, limited in amount and rate, and given at our discretion. Do not try to get around the limits, for example with scripts or many accounts. We may refuse or stop test funds for anyone.</p>
      </Sec>
      <Sec n={6} title="Not advice, not an offer">
        <p>Nothing on the website or in the app is financial, investment, tax or legal advice, and nothing is an offer to buy or sell any security, derivative or other financial product. Figures such as premiums and annualised returns are illustrations with test coins.</p>
      </Sec>
      <Sec n={7} title="Fair use">
        <p>Please do not use CoveredMarket for anything unlawful, interfere with other people’s use of it, or attack the website, the relayer or the contract. Good-faith security research is welcome under our <a href={`${REPO}/blob/HEAD/SECURITY.md`} target="_blank" rel="noreferrer">security policy</a>, which also explains how to report what you find.</p>
      </Sec>
      <Sec n={8} title="Other services">
        <p>CoveredMarket depends on services we do not run: the NEAR and Bitcoin networks, NEAR’s signing network, wallets, RPC providers and block explorers. Their own terms apply to them, and we are not responsible for their availability or behaviour.</p>
      </Sec>
      <Sec n={9} title="Open source">
        <p>The source code is published at <a href={REPO} target="_blank" rel="noreferrer">github.com/Covered-Market/coveredmarket</a> under the licence in that repository. These terms cover your use of the website, the app and the relayer we host. The licence covers the code itself.</p>
      </Sec>
      <Sec n={10} title="No warranty, limited liability">
        <p>The service is provided “as is” and “as available”, without warranties of any kind, express or implied, including fitness for a particular purpose and non-infringement. To the fullest extent the law allows, we are not liable for any loss or damage arising from your use of, or inability to use, CoveredMarket. Nothing here limits liability that cannot be limited by law.</p>
      </Sec>
      <Sec n={11} title="Changes and contact">
        <p>We may update these terms. The date at the top shows when they last changed, and continuing to use CoveredMarket after a change means you accept it. Questions: <Mail />.</p>
      </Sec>
    </>
  );
}

function Privacy() {
  return (
    <>
      <p className="ld-lede" style={{ margin: "0 0 8px" }}>No accounts, no analytics, no advertising and no tracking cookies. Here is everything else.</p>
      <Sec n={1} title="What our servers receive">
        <p>The website and app are static files served from DigitalOcean. Our web server does not keep access logs.</p>
        <p>The relayer receives what the app sends it to do its job: your NEAR account name, the transactions you have signed, requests for test funds, and the Bitcoin addresses and transaction ids of offers. Its logs record when a transaction was relayed or test funds were sent, with the account, addresses and amounts involved. We use these logs to run and debug the service.</p>
        <p>If you join the mainnet waitlist, the relayer also receives your email address. Section 6 says what we do with it.</p>
        <p>To stop abuse of test funds, the relayer keeps your IP address in memory for up to an hour. It is not written to the logs.</p>
      </Sec>
      <Sec n={2} title="What stays in your browser">
        <p>The app saves a few things in your browser’s local storage: which wallet you connected, the rescue kit for each offer you create (so you can download it again), and a note that test funds were already sent to your account. None of this is sent to us. Clearing this site’s data removes it, so download your rescue kits first.</p>
      </Sec>
      <Sec n={3} title="What is public on the blockchain">
        <p>Offers, contracts, deposits, payments and settlements happen on public blockchains. Your NEAR account, the terms of your offers, Bitcoin addresses and amounts are visible to anyone, permanently. Neither we nor anyone else can delete them.</p>
      </Sec>
      <Sec n={4} title="Services your browser talks to directly">
        <ul>
          <li>Your wallet, when you connect and sign.</li>
          <li>A NEAR RPC provider (FastNEAR), to read the contract and send transactions.</li>
          <li>Bitcoin block explorers (mempool.space and Blockstream), to look up deposit addresses and transactions.</li>
          <li>YouTube, through its privacy-enhanced player, only if you press play on a video.</li>
        </ul>
        <p>Each of these sees your IP address and what it is asked for, under its own privacy policy. Links to other sites, such as block explorers or X, take you to those sites.</p>
      </Sec>
      <Sec n={5} title="Sharing">
        <p>We do not sell or rent any data, and we do not share it except with the hosting provider that runs our servers, or where the law requires us to.</p>
      </Sec>
      <Sec n={6} title="Your choices">
        <p>You can use the market without connecting a wallet. You can ask us what our logs hold about your account, or ask us to delete it, at <Mail />. We cannot change or delete anything on a blockchain. If you write to us, we keep your email to answer it.</p>
        <p>If you join the mainnet waitlist, the relayer stores your email address with the time you joined and which page you used, and forwards it to our inbox. It does not store your IP address with it. We use the address only to tell you when mainnet opens, never share it, and delete it when you ask at <Mail />.</p>
      </Sec>
      <Sec n={7} title="Changes">
        <p>If we start collecting anything new, we will update this page first. The date at the top shows when it last changed.</p>
      </Sec>
    </>
  );
}

export function Legal({ doc }: { doc: "terms" | "privacy" }) {
  const title = doc === "terms" ? "Terms of use" : "Privacy";
  useEffect(() => { document.title = `${title} — CoveredMarket`; scrollTo(0, 0); }, [doc]);
  return (
    <div className="ld">
      <header className="ld-head">
        <div className="ld-wrap">
          <a href="/" aria-label="CoveredMarket home" className="ld-logo-link"><img className="ld-logo" src="/site/lockup-32.svg" alt="CoveredMarket" /></a>
        </div>
      </header>
      <main className="ld-wrap lg">
        <p className="ld-kicker">Last updated {UPDATED}</p>
        <h1 className="ld-h2" style={{ maxWidth: "none", marginBottom: 32 }}>{title}</h1>
        {doc === "terms" ? <Terms /> : <Privacy />}
      </main>
      <LegalLinks />
    </div>
  );
}

/** A plain footer row with both documents, for the app and these pages. */
export function LegalLinks({ inline }: { inline?: boolean }) {
  const links = <><a href="#/updates">Updates</a><a href="#/terms">Terms</a><a href="#/privacy">Privacy</a></>;
  if (inline) return <span className="lg-links">{links}</span>;
  return <footer className="ld-foot"><div className="ld-wrap lg-links">{links}<span className="ld-muted">CoveredMarket runs on test coins only.</span></div></footer>;
}
