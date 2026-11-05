# Logo

## The mark: the Lid

One coin, its top lifted off. The gap is the strike; the lifted segment is the upside a covered call gives away. Two filled shapes, no line work, so it survives 16px, embroidery and a one-colour stamp. It is the only thing in the system that is this plain, which is why it reads.

Colour is part of the mark. The **primary** is the intaglio coin with a gilt lid: the brand green holding the coin, gold for what you earn. On Vault it becomes the cream coin with a gilt lid, thinned 3% so it does not look heavier reversed. The **copper** colourway (copper coin, intaglio lid) is reserved for places where the coin itself is the subject: the certificate's seal, deposit confirmations, the coin icon. **One-colour** versions in `ink` or `intaglio` go everywhere else.

Files, under `assets/Logos/`:

| File | Use |
|---|---|
| `covered-symbol.svg` | Primary: intaglio coin, gilt lid, on Paper. |
| `covered-symbol-on-vault.svg` | Primary reversed: cream coin, gilt lid, thinned. |
| `covered-symbol-copper.svg` | Copper coin, intaglio lid. Only where the coin is the subject. |
| `covered-symbol-ink.svg`, `-intaglio.svg`, `-reversed.svg` | One colour: ink or intaglio on Paper; thinned cream on Vault. Print, stamps, embroidery. |
| `covered-symbol-small.svg`, `-small-on-vault.svg` | The small cut, 24px and below: a wider gap, lower lid. |
| `covered-symbol-state-open / -kept / -exercised.svg` | The lid lifted (open contract), down to a seam (kept), lifted high (exercised). For stamps, timelines and motion. |
| `covered-wordmark.svg`, `-on-vault.svg` | "Covered" in Fraunces 480 at optical size 144, kerned, as outlines. |
| `covered-wordmark-caps.svg` | "COVERED" tracked 0.14em: kickers, stamps, the certificate header. |
| `covered-lockup.svg`, `-ink`, `-copper`, `-on-vault` | Horizontal: symbol at 64, gap 20, wordmark at 56. |
| `covered-lockup-stacked.svg`, `-on-vault` | Symbol above the wordmark, for squares and the end card. |
| `covered-lockup-with-partner-rule.svg` | The lockup with a hairline to its right where a partner mark (NEAR) sits at the same cap height. |
| `covered-seal.svg`, `-ink`, `-on-vault` | The Lid inside two rings and outlined microtext: the certificate's seal and the stamp on documents. |
| `app-icon-1024.svg`, `-rounded.svg`, `app-icon-192.svg` | Vault ground, cream coin, gilt lid at 62%. The rounded version is 22% radius for stores that don't mask. |
| `favicon.svg`, `favicon-on-vault.svg` | The small cut on a ground, 16–32px. |

## Rules

- **Clear space** is half the symbol's width on every side, measured from the coin, not the lid.
- **Minimum sizes**: symbol 16px (small cut), 28px (full); lockup 96px wide; wordmark 72px wide.
- **The gap is sacred.** Never fill it, never make it a line, never let a background band run through it. The lid is lifted by a fixed amount per state; do not animate it between other positions.
- **Colour**: coin in `intaglio`, `copper`, `ink`, or cream; lid in `gilt`, `intaglio` or the coin's colour. Never the Bitcoin orange `#F7931A`, never a gradient, never an outline.
- **Do not** rotate, add a shadow, place in a circle (the seal's rings are the one exception), or redraw it. Use the files.
- **With NEAR**: the partner-rule lockup, both marks in `ink` or both reversed, NEAR's mark at the wordmark's cap height.
- **The wordmark is not a typeface**: set "Covered" in running text in the sans. Only the logo files use the outlined Fraunces.

## The lid in motion

The one animation the brand allows: when a contract's state changes, the lid moves to its new height in 180ms, ease-out, once. Open → Kept lowers it to the seam; Open → Exercised lifts it. Nothing else about the mark ever moves.
