# Patterns

The engraved textures, all under `assets/Patterns/`, all single-ink SVGs drawn by code. They are what makes a CoveredMarket surface look like a security rather than a web page.

| Pattern | File | Where |
|---|---|---|
| Guilloche rosette | `guilloche-rosette.svg`, `-gilt-on-vault` | The hero ornament. One per surface, large, bleeding off a corner or an edge, at 25–45% opacity, behind nothing that must be read. Site hero, OG image, title card, the back of the certificate. |
| Guilloche band | `guilloche-band.svg`, `-on-vault` | A braided border. Across the top and bottom of the Certificate (where the component draws its own), as a section divider on the site, along the bottom of a slide. Tile horizontally. |
| Coupon edge | `coupon-edge.svg` | A perforated line with half-moon punches at a 24px pitch. Between a contract and its actions, between a summary and its detail: anywhere something "tears off". |
| Hatch | `hatch.svg` | Diagonal engraving at a 6px pitch. Fills the "upside above strike" in charts, the cap of the mark, a disabled region. Tiles. |
| Lid tile | `lid-tile.svg` | The mark repeated at 32px on a 48px pitch, alternating its three states. Endpapers, the back of the certificate, loading states, merchandise. Ink only, never two-tone. |
| Microtext | `microtext.svg` | The tagline repeated at 7px as a texture, as on a banknote. Under a hero figure, inside a wide margin, on the slide's background at low opacity. Never where it could be mistaken for copy. |

## Rules

- One pattern per surface. A rosette and a band together only on the Certificate and the title card.
- Patterns are ink on paper or gilt on vault. Never copper, never oxblood, never two colours in one pattern.
- Pattern opacity sits between 25% and 55%; below 25% it is dirt, above 55% it fights the type.
- Never place body text over a pattern. Headlines may cross a rosette's outer rings at the opacities above; figures never do.
- Lines are `stroke-hair` at 1× and scale with the artwork: a rosette at 2000px keeps 1px lines, which is what makes it look engraved.
- The patterns are generated from `scripts` in the brand repo, not edited by hand. To change density or size, regenerate.
