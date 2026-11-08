# Imagery

CoveredMarket does not use stock photography, 3D coins, glowing charts or illustrations of people. Its pictures are of two kinds.

## 1. The product, photographed like a document

Screenshots and recordings of the real app, on Paper or Vault, at 100% zoom, with the Certificate or an OfferCard as the subject. Crop tight, keep the hairline borders intact, and let the cream or the deep green fill the frame. Where a screenshot needs a surround (an X post, a slide), place it on the Vault ground inside a `rule` hairline frame inset `space-8`, as `assets/Social/og-image-1200x630.svg` does.

## 2. Engraving

Where a picture is needed and the app isn't the subject, use engraved line work in `ink` or `gilt` on the paper: the guilloche rosette and band from `assets/Patterns/`, the hatch, the microtext. These are drawn by code from the system's own rules, so they can be regenerated at any size. Compose them the way a banknote does: a rosette bleeding off one edge at 30–45% opacity, a band as a border, microtext as a texture under a figure.

## If photography is unavoidable

Press, a launch post, a conference slide. Then:

- Still life only: physical objects that belong to the metaphor (a brass coin, an engraved plate, a folded certificate, a fountain pen, cotton paper), on cream or dark green paper, lit from one side, no props that say "crypto".
- Desaturate towards the palette: shadows pull to `intaglio-deep`, highlights to `paper`; no blue cast.
- No hands holding phones, no laptops, no people, no coins with the ₿ glyph, no gold bars, no vaults with wheels.
- Always under a `rule` hairline frame, with a caption in `body-small`.

## Charts

Charts are figures, so they are mono and hairline: a line in `intaglio` at `stroke-mark`, the strike as a dashed `gilt` horizontal, the premium region above it hatched like the mark. Axes in `rule`, labels in `label`. No fills, no area gradients, no candle colours; up and down are not coloured.

## What a picture is for

Every image in CoveredMarket answers one of two questions: *where are the coins?* or *what did the contract do?* If a picture answers neither, leave the space to the paper.
