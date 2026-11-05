# Typography

Three faces, each with one job. All three are shipped as variable fonts under `fonts/`.

## Fraunces, the human voice

A soft, slightly wonky serif with optical sizes. It carries the sentences a person remembers: the hero line, slide titles, the italic `lede` that explains what will happen to Astrid's coins. Styles: `display-1` (88px), `display-2` (56px), `title` (32px), `lede` (22px italic). Set `font-variation-settings: "opsz"` to the style's optical size so the large sizes get the fine, high-contrast cut and the small sizes stay sturdy.

- Only one Fraunces display line per surface. It is the headline, not the body.
- Italic is the brand's single flourish. Use it for the lede and for a pull quote; never for emphasis inside UI text and never for data.
- Keep `SOFT` and `WONK` at 0. The soft axis is tempting; it makes the brand look like a bakery.

## Instrument Sans, the interface

Everything else a person reads in the product: `heading` (20px), `body` (16/24), `body-small` (14/20), `label` (12px, uppercase, tracked 0.12em), `stamp` (12px, bold, uppercase, tracked 0.16em).

- Labels and column headers are uppercase and tracked; nothing else is.
- Body copy measures 60–75 characters. The certificate's lede is narrower.

## Spline Sans Mono, the figures

Every number, amount, price, strike, date, hash, address and block height, in the product and in marketing. `figure-xl` (44px) for the one number a screen is about; `figure` (16px) in UI; `figure-small` (13px) for hashes and timestamps. Always `font-variant-numeric: tabular-nums`.

- A number set in the sans is a bug. The rule holds in slides and ads too: "$6,000" in a headline is set in mono inside the Fraunces line.
- Hashes truncate in the middle with "…" (the real character), never at the end.

## Hierarchy on a page

1. One Fraunces line.
2. One `lede` or one `figure-xl`.
3. Interface text in Instrument Sans.
4. Figures in mono wherever they appear.

Headlines left-aligned, ragged right, never centred except on the end card and app icon surfaces.
