# Iconography

Icons are drawn in the engraving line: 24px grid, 2px stroke in `currentColor`, round caps and joins, no fills except the coin's dot. They sit next to words, never instead of them.

Set under `assets/Icons/`: `lid-open`, `lid-kept`, `lid-exercised` (the mark's three states as 24px glyphs), `coin`, `strike`, `expiry`, `premium`, `key`, `kept`, `exercised`, `refused`, `clock`, `chain`, `arrow-right`, `verify`, `wallet`.

- Status icons (`kept`, `exercised`, `refused`, plus the Stamp's open/pending/settled glyphs) are built into the `Stamp` and `SettlementTimeline` components; use those, don't place the files by hand in product UI.
- Chain and wallet logos (Bitcoin, Solana, Base, NEAR, MetaMask, Phantom) are used as their owners publish them, in single ink where their guidelines allow, at 16 or 20px beside the chain name. Never recoloured copper or gilt.
- No emoji, anywhere.
- New icons: same grid and stroke, drawn with the generator in the brand repo so they stay consistent; 2px stroke stays 2px at 24px, 1.5px at 16px.
