# Layouts by surface

The same system on every surface. The recipe is always: paper, one Fraunces line, figures in mono, one engraved pattern, hairline frames.

## Website (Paper)

- Page gutters `space-8`; content width 1120px; sections separated by `space-9` and, where the subject changes, a guilloche band.
- Hero: `display-1` on the left in a 7/12 column, the `lede` under it, a `Certificate` (live, the demo contract) on the right, a rosette bleeding off the top-right corner at 30%.
- Then three `StatTile`s (premium earned, coins at rest, annualised), then the story in three `OfferCard`-sized steps (deposit, sell, expiry), then "Who can see what" as a plain table, then the NEAR line.
- Footer on `paper-sunk`: lockup, repo, the honesty line.

## App (Paper by day, Vault by night)

- `TopBar`, then a content column of 1120px with `space-6` between blocks.
- Market: a grid of `OfferCard`s, three up, gap `space-5`, filters as quiet small buttons above.
- Contract page: the `Certificate` as hero with `shadow-lift`, the `Countdown` and `SettlementTimeline` beside it, `Notice`s under.
- My contracts: `PositionsTable`.
- Mobile: single column, cards full width, the certificate scaled, table collapsed to cards. Nothing is hidden on mobile; it is only stacked.

## Slides (Paper for statements, Vault for demos)

- 16:9, margins `space-8` all round, a hairline `rule` frame inset `space-5`.
- One idea per slide: a `display-2` line top-left, at most one supporting block (a certificate screenshot, a stat row, a table). Guilloche band along the bottom edge at 40%.
- Figures in mono inside the Fraunces line. Never bullet lists of more than four.
- Deck order: the line; the problem (who holds the coins today); the story (Astrid and Marcus); how it works (five boxes); only on NEAR; proof (the certificate and Verify); next.

## Social (Vault)

Templates in `assets/Social/`: avatar, X header, OG image, 1080 square, video title and end cards. Rules: Vault ground, hairline frame, the lockup top-left, a rosette at 40% off the right edge, the Fraunces line bottom-left, one muted line of facts under it. One fact per post. Screenshots of the product go inside the frame with `space-6` around them.

## Ads

Paper or Vault; a single `display-2` line; one figure in mono; the lockup; nothing else. The band or the coupon edge as the only ornament. Example: *"$6,000 for not selling."* under it in mono `2.0000 BTC · strike $150,000 · 31 Dec 2026`.

## Video

1920×1080, 60fps, the real app on Vault at 100% zoom. Title and end cards from `assets/Social/`. Captions in `body` on a `paper-sunk` strip at 90%; figures in captions in mono. No transitions beyond cuts and one stamp landing. Music low, no stings.

## Documents and print

Paper. A4 with 24mm margins, the guilloche band at the head of page one, `title` for the document title, `body` for text, a `rule` hairline table style, figures in mono. The certificate prints at 100% on A4 landscape.
