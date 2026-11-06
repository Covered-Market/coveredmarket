# Covered — Brand Identity

**Product:** non-custodial covered calls on native Bitcoin (NEAR Chain Signatures + Intents) · **Written:** 5 Nov 2026
**Full system (tokens, components, logos, patterns, social templates, fonts):** https://claude.ai/artifact/1gormfHod4MU3fRZuTRF2m

## Idea

**A security, printed.** Covered looks like the thing it is: an option contract. References are engraved securities and bond certificates: cream paper, one green intaglio ink, a little gold leaf, guilloche borders, a serial number, a stamp that says what happened. Three checks: **engraved, exact, unhurried.** Line: *Open to anyone. Held by no one. Earning for you.*

## Logo: the Lid

One coin, its top lifted off. The gap is the strike; the lifted segment is the upside a covered call gives away. Two filled shapes, no line work: it survives 16px, one colour and embroidery. Chosen from three concepts (the Lid, a lidded C, an open lid) through a proper logo process (brief, category clichés, 16px tests, audit).

- **Primary**: intaglio coin, gilt lid. On Vault: cream coin, gilt lid, thinned 3%.
- **Copper colourway** (copper coin, intaglio lid): only where the coin itself is the subject.
- **One colour**: ink or intaglio; reversed cream.
- **States**: open (lid lifted), kept (lid down to a seam), exercised (lid lifted high). Used by stamps, timelines and the one permitted animation (the lid moving 180ms once on a state change).
- **Variants in the system**: symbol in every colourway, small cut for ≤24px, wordmark (Fraunces, kerned outlines) and a tracked caps wordmark, horizontal lockups (primary, ink, copper, on vault), stacked lockups, a partner-rule lockup for "built on NEAR", the seal (lid inside rings of outlined microtext), app icons (square, 22%-rounded, 192), favicons, a lid tile pattern, three lid state icons.

## Colour: a printer's palette

| Token | Paper (default) | Vault (night, video, social) | Means |
|---|---|---|---|
| paper / -raised / -sunk | #F2EAD6 / #FAF5E8 / #E6DCC2 | #0F211B / #163229 / #0A1713 | the paper |
| ink / ink-muted | #132A23 / #4F5F57 | #EDE4CC / #A7B3AA | text |
| intaglio | #1F4F40 | #4A9A7E | brand, the coin in the mark, primary actions, KEPT |
| gilt / gilt-ink | #B88A2E / #7A5A15 | #D9B257 / #E2C06D | the lid, money earned, OPEN |
| copper / copper-ink | #B3612C / #8A4418 | #D88A54 / #E8A26E | Bitcoin amounts |
| oxblood | #7E2432 | #D9707F | REFUSED, the only red |

No gradients, no shadows (borders instead), square corners except buttons (2px) and discs. Every status carries its word in a Stamp.

## Type: three faces, three jobs

**Fraunces** (the human sentence: display, title, italic lede) · **Instrument Sans** (interface, labels) · **Spline Sans Mono** (every figure, tabular). Real variable font files are in the system.

## Patterns

Guilloche rosette and band (drawn by code), coupon edge, hatch, lid tile, microtext. One per surface, 25–55% opacity, ink on paper or gilt on vault, never under body text.

## Voice

A careful broker's letter: plain, exact, second person, honest about trust ("signatures come from NEAR's MPC network"), no exclamation marks, no emoji, "custodian" not "trustless", every claim with its figure and UTC date.

## Components (window.Covered)

Button, Stamp, Figure, Coin, Field, StatTile, OfferCard, PositionsTable, Countdown, SettlementTimeline, Notice, TopBar, **Certificate** (the hero object: the option as a printed security), Mark (the Lid, with tone and state props). Each has a live preview and guidelines.

## Templates in the system

Avatar, X header, OG image (Vault and Paper), 1080 square, video title and end cards; layout rules for website, app, slides, ads, video and print in the brand book.

## Open

- Name check: "Covered" is a working name; domains and the NEAR account (`covered.near`) are unverified. No trademark search has been run on the mark.
- Kept (green) and Refused (red) differ by hue, so stamps always carry word + icon; a colour-blind-safe added theme is a possible later step.
- The earlier marks (the Cap, the engraved coin) are still in the system's asset store but no longer referenced; delete them from the page's Files when convenient.
