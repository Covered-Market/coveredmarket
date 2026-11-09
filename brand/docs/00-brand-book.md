**CoveredMarket** sells covered calls on native Bitcoin without a custodian: a holder's coins stay on Bitcoin at an address only a NEAR contract can sign for, a buyer pays a premium from any chain, and at expiry the contract either returns the coins or sells them at the strike. The line: *Earn on Bitcoin you still hold.*

## The idea: a security, printed

CoveredMarket looks like the thing it is: an option contract. Not a trading terminal, not a crypto launch page. The references are engraved securities and bond certificates: cream paper, one green intaglio ink, a little gold leaf, guilloche borders that are hard to forge, a serial number, a stamp that says what happened. Three words to check every design against: **engraved, exact, unhurried.**

- *Engraved*: value lives in line, not in glow. Hairlines, hatching, braids. No gradients, no blur, no 3D.
- *Exact*: every figure is mono and tabular; every date carries UTC; every address is printed. The page never rounds what the contract doesn't.
- *Unhurried*: a certificate doesn't flash. Nothing blinks, counts up or celebrates. The only motion is a stamp landing.

If a surface could belong to a neon perp DEX or to a generic fintech, it is wrong.

## How to use this system

- Read `tokens.json` for every colour, type style, spacing step, radius, shadow and stroke; use them by name (`var(--intaglio)`, class `figure`). Never a raw hex or px in product code.
- Build product UI from `components/bundle.js` (`window.CoveredMarket`): `Certificate` is the hero object, `OfferCard` and `PositionsTable` the market, `Stamp` and `SettlementTimeline` the state, `Figure` every number. Each component's README says what the consumer supplies.
- Take logos, patterns, icons and social templates from `assets/`, never redraw them. The mark is *the Lid*: one coin, its top lifted off.
- Default theme is **Paper** (site, documents, print, ads). Use **Vault** for the trading app at night, video and social where cream would glare. Both are the same tokens; never style for one theme by hand.
- Copy is written in the voice under *Voice and tone*: plain, exact, second person, no hype.

## Content fundamentals

- **Second person, present tense.** "Your coins stay on Bitcoin." Not "users' assets remain…".
- **Say what happens, with the figure.** "If Bitcoin ends above $150,000, your 2.0000 BTC are sold at $150,000 and you keep the $6,000." Never "your position is exercised".
- **Sentence case** everywhere, including buttons and headings. Uppercase only in `label` and `stamp` styles.
- **No exclamation marks, no emoji, no "🚀", no "gm".** No "unlock", "supercharge", "seamless", "trustless". The word for what we don't do is *custodian*: "no custodian", not "trustless".
- **Name the trust honestly.** "The contract can sign your coins only after expiry" and "signatures come from NEAR's MPC network" are both true; "nobody can touch your coins" is not. Write the first.
- Numbers: USD with two decimals and thousands separators, BTC with four decimals, dates as `31 Dec 2026, 08:00 UTC`, hashes truncated `bc1q…5mdq` except on the certificate.

## Visual foundations, in one place

- **Ground** `paper`; sheets and cards `paper-raised` with a `rule` hairline; wells `paper-sunk`. Depth comes from borders, never shadows (`shadow-lift` only on a modal or a photographed certificate).
- **Ink** for text; `ink-muted` for secondary; `intaglio` for the brand, primary actions and the Kept state; `gilt`/`gilt-ink` for money earned and the Open state; `copper`/`copper-ink` for Bitcoin amounts; `oxblood` for refusals, the only red.
- **Type**: Fraunces for the human sentence (display styles and the italic `lede`), Instrument Sans for interface, Spline Sans Mono for every figure. Three faces, three jobs; never swap them.
- **Spacing** on the 4px scale; cards padded `space-5`, sections `space-7`, page gutters `space-8`.
- **Corners** square (`radius-0`) except buttons (`radius-sm`) and discs (`radius-coin`).
- **Strokes** `stroke-hair` for rules and guilloche, `stroke-mark` for the mark and focus rings, `stroke-plate` for stamps and the certificate border.
- **Focus** is a 2px solid `focus` ring offset 2px, on every control, in both themes.
- **States** always carry their word (Stamp). Kept (green) and Refused (red) differ by hue, so the icon and word are mandatory.
- **Motion**: 120ms linear for hover; the Stamp "lands" in 180ms (scale 1.15 → 1, rotate -4° → -1.5°) once; the Countdown arc moves only on the contract page; nothing loops.

The sections that follow go deeper on the logo, colour, type, imagery, patterns, voice, layouts per surface, motion and icons.
