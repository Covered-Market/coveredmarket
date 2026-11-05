# Colour

The palette is a printer's: paper, one ink, two metals, one red. It stays small so every colour keeps its meaning.

| Means | Token | Paper | Vault |
|---|---|---|---|
| the paper | `paper`, `paper-raised`, `paper-sunk` | cream | deep green-black |
| the ink | `ink`, `ink-muted` | green-black | cream |
| the brand, the Kept state, primary actions | `intaglio`, `intaglio-deep`, `on-intaglio` | engraved green | lifted green |
| money earned, the Open state, highlights | `gilt`, `gilt-ink`, `on-gilt` | gold leaf | brighter gold |
| Bitcoin | `copper`, `copper-ink` | copper | lighter copper |
| refusal | `oxblood`, `on-oxblood` | dark red | rose |
| hairlines | `rule`, `rule-strong` | | |
| focus ring | `focus` | green | gilt |

## Rules

- Backgrounds are only the three papers. No tinted sections, no gradients, no coloured bands behind headings. Colour arrives as ink, line and stamp.
- `gilt` is a highlight, not a background: the underline of a selected tab, the arc of the Countdown, the strike line of the mark, the figure of a premium. A full gilt panel is a no.
- `copper` belongs to Bitcoin amounts only. It is not an accent for anything else.
- `oxblood` is the only red and means "the contract refused" or "you are about to give something up". Do not use it for emphasis, sale badges or negative deltas.
- Text contrast: every pair in `tokens.json` lists its ratio. Body text uses `ink`; `ink-muted` only at 14px and up; `gilt-ink` and `copper-ink` for figures, never `gilt`/`copper` as small text on Paper.
- Kept (`intaglio`) and Refused (`oxblood`) are a green and a red; they are always accompanied by the word and the icon in a Stamp, and never used as the only difference between two things.

## Themes

Paper is the default: site, documents, ads, print, the market by day. Vault is for the app at night, video, social and the OG image. The themes swap tokens, not designs: a component is never restyled per theme. When choosing, remember that photographs of the certificate read best on Vault.
