"""Write components/<Comp>/preview.html and README.md for the Covered system."""
import os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'covered', 'project', 'components')

def preview(name, group, height, script, width=None, pad=24):
    w = f' width={width}' if width else ''
    return f'''<!-- @dsCard group="{group}" height={height}{w} -->
<!doctype html>
<html>
<head><meta charset="utf-8"><title>{name} — preview</title>
<style>html,body{{margin:0}} body{{background:var(--paper)}} #root{{padding:{pad}px}}</style></head>
<body>
<div id="root" class="cv-root"></div>
<script>
var C = window.Covered, h = React.createElement;
ReactDOM.createRoot(document.getElementById('root')).render({script});
</script>
</body>
</html>
'''

COMPS = {
'Mark': ('Brand', 120, """h('div', {className:'cv-row', style:{gap:32, alignItems:'center'}},
  h(C.Mark, {size:64}),
  h(C.Mark, {size:64, tone:'two-tone'}),
  h('span', {style:{color:'var(--intaglio)'}}, h(C.Mark, {size:40})),
  h('span', {style:{display:'inline-flex', alignItems:'center', gap:12}}, h(C.Mark, {size:28, tone:'two-tone'}), h('span', {style:{fontFamily:'var(--font-display)', fontSize:24, fontWeight:500, letterSpacing:'-0.01em'}}, 'Covered')))""",
"""# Mark

The Cap, drawn inline so it takes `currentColor`: a coin whose segment above the strike line is hatched, because a covered call gives away the upside above the strike. Use `tone: 'two-tone'` (copper disc, gilt strike line) on brand surfaces and in the TopBar; the single-ink form anywhere it sits in running text or at 24px and below.

- Minimum 20px. Below that, use the favicon asset (outline and chord only).
- Never recolour the disc anything but `copper`, never rotate it, never put it inside another shape. The clear space around it is half its width.
- For static files (email, documents, exports) use the SVGs under Logos, not this component."""),

'Button': ('Actions', 88, """h('div', {className:'cv-row'},
  h(C.Button, {variant:'primary'}, 'Sell this call'),
  h(C.Button, null, 'View contract'),
  h(C.Button, {variant:'danger'}, 'Withdraw offer'),
  h(C.Button, {variant:'primary', size:'sm'}, 'Buy'),
  h(C.Button, {variant:'primary', disabled:true}, 'Waiting for deposit'))""",
"""# Button

Verb first, sentence case, no exclamation marks: “Sell this call”, “Buy”, “Withdraw offer”. One **primary** (`intaglio`) per view: the action the screen exists for. **Quiet** (`rule-strong` border) for everything else. **Danger** (`oxblood`) only for leaving money on the table: withdrawing an offer, cancelling a cash-out.

- A button that moves coins names the amount: “Deposit 2.0000 BTC”, never “Confirm”.
- While a chain is being waited on, disable and change the label to what is being waited for (“Waiting for deposit”). No spinners inside buttons.
- Corners are `radius-sm` (2px): pressed into the paper, not cut from it."""),

'Stamp': ('Status', 72, """h('div', {className:'cv-row', style:{gap:20}},
  h(C.Stamp, {status:'open'}), h(C.Stamp, {status:'kept'}), h(C.Stamp, {status:'exercised'}), h(C.Stamp, {status:'settled'}), h(C.Stamp, {status:'pending'}), h(C.Stamp, {status:'refused'}),
  h(C.Stamp, {status:'kept', flat:true}, 'Kept · 2.0000 BTC returned'))""",
"""# Stamp

Every state in Covered is stamped with its word. The six statuses: **Open** (gilt, an offer awaiting a buyer or a live contract), **Kept** (intaglio, expiry passed below strike, coins returned), **Exercised** (copper, coins sold at strike), **Settled** (ink, money moved both ways), **Pending** (muted, dashed: waiting on a chain), **Refused** (oxblood, the contract said no).

- Colour never carries state alone; the word is always printed. Kept and Refused are green and red, so the icon and word do the telling.
- Rotated by default, like a hand stamp on a certificate. Use `flat` in tables and lists.
- Pass children only to extend the word with a figure: “Kept · 2.0000 BTC returned”."""),

'Figure': ('Data', 150, """h('div', {className:'cv-stack'},
  h('div', {className:'cv-row', style:{gap:32}}, h(C.Figure, {value:6000, kind:'usd', size:'xl', tone:'gilt'}), h(C.Figure, {value:2, kind:'btc', size:'xl'}), h(C.Figure, {value:'38d 04h', size:'xl'})),
  h('div', {className:'cv-row', style:{gap:32}}, h(C.Figure, {value:150000, kind:'usd'}), h(C.Figure, {value:0.25, kind:'btc'}), h(C.Figure, {value:14.2, kind:'pct', tone:'muted'}), h(C.Figure, {value:'bc1q…5mdq', size:'sm', tone:'btc'}), h(C.Figure, {value:'block 172,644,012', size:'sm', tone:'muted'})))""",
"""# Figure

Every number in the product is a Figure: Spline Sans Mono, tabular, never proportional sans. `kind` formats the value: `usd` with two decimals and a dollar sign, `btc` with four decimals and a BTC unit, `pct` with one decimal.

- Bitcoin amounts are `copper-ink`; premiums and anything earned are `gilt-ink`; everything else is `ink`. Use `muted` for context figures (spot price, block heights).
- `xl` is for the one number a screen is about. Never two `xl` figures side by side competing.
- Hashes and addresses: `size: 'sm'`, truncated in the middle with a real ellipsis character, and a copy affordance beside them. Never wrap a hash."""),

'Coin': ('Data', 100, """h('div', {className:'cv-row', style:{gap:40}}, h(C.Coin, {amount:2}), h(C.Coin, {amount:0.35}), h(C.Coin, {amount:2, size:'lg'}))""",
"""# Coin

A Bitcoin amount with its disc: copper, a gilt line across it, no ₿ glyph. Use it wherever an amount of coins is the subject (the size of an offer, a deposit, what was returned). For amounts in running text use a plain `Figure` with `kind: 'btc'`.

- The disc is decoration; the Figure carries the value and the unit. Do not put the disc without a figure.
- `lg` only in a hero position (the deposit confirmation, the certificate)."""),

'Field': ('Forms', 220, """h('div', {className:'cv-row', style:{alignItems:'flex-start', gap:24}},
  h(C.Field, {label:'Strike', defaultValue:'150000', adorn:'USD', help:'The price at which you agree to sell. Spot is $97,420.'}),
  h(C.Field, {label:'Receive premium on', defaultValue:'9xQe…7Fh2', adorn:'SOL', help:'Any chain NEAR Intents supports.'}),
  h(C.Field, {label:'Size', defaultValue:'2.5', adorn:'BTC', invalid:true, help:'You deposited 2.0000 BTC. Size cannot exceed the deposit.'}))""",
"""# Field

A recessed well (`paper-sunk`, `rule-strong` border, square corners) with an uppercase label above and a helper line below. The input is mono because what goes in is a number or an address.

- The helper line says something useful about the value (“Spot is $97,420”), not “Enter a strike”.
- Invalid: border and helper turn `oxblood` and the helper says what is wrong and what is allowed. No red asterisks, no shaking.
- `adorn` holds the unit on the right (USD, BTC, SOL), never inside the placeholder.
- Focus is the system ring: 2px `focus`, 2px offset, on the well, not the input."""),

'StatTile': ('Data', 150, """h('div', {className:'cv-row', style:{gap:16}},
  h(C.StatTile, {label:'Premium earned', value:18450, kind:'usd', tone:'gilt', note:'Since 1 Sep · 7 contracts'}),
  h(C.StatTile, {label:'Coins at rest', value:2, kind:'btc', note:'On Bitcoin, at the contract’s address'}),
  h(C.StatTile, {label:'Annualised', value:14.2, kind:'pct', note:'Across open positions'}))""",
"""# StatTile

A label, one `xl` Figure and a note, inside a `rule` border on `paper-raised`. The note gives the figure its meaning or its period; it is not optional on money figures.

- Three to four tiles in a row at most; the first is the one the person came for.
- Tiles never show deltas with arrows and green/red; a change is written as a note (“+$2,100 this month”)."""),

'OfferCard': ('Market', 420, """h('div', {className:'cv-row', style:{alignItems:'flex-start', gap:24}},
  h(C.OfferCard, {offer:{strike:150000, expiry:'31 Dec 2026', premium:6000, annualised:14.2, size:2, spot:97420, vault:'bc1q…5mdq', seller:'astrid.near'}}),
  h(C.OfferCard, {offer:{strike:120000, expiry:'28 Nov 2026', premium:1840, annualised:22.6, size:0.5, spot:97420, vault:'bc1q…k2p9', seller:'monk.near', status:'pending'}, action:'Buy this call'}))""",
"""# OfferCard

One sold call on the market. Everything a buyer needs to decide, in reading order: what it is (Call · strike), when it expires, size and strike, the spot price for context, where the coins actually are, then the premium as the big gilt figure with its annualised yield, and the action.

- Supply `offer` with real values; the card formats. `vault` is the Bitcoin address the coins sit at, truncated, because “the coins are at an address the contract controls” is the whole product.
- The status stamp is flat and top-right. An offer that is `pending` (deposit not yet confirmed) still shows, so the market feels alive, but its button should be disabled by the consumer.
- Cards sit on `paper-raised` with a `rule` border and no shadow; gap `space-5` between cards."""),

'PositionsTable': ('Market', 300, """h(C.PositionsTable, {rows:[
  {id:'CV-0037', side:'sell', size:2, strike:150000, expiry:'31 Dec 2026', premium:6000, status:'open'},
  {id:'CV-0031', side:'sell', size:1, strike:110000, expiry:'30 Oct 2026', premium:2210, status:'kept'},
  {id:'CV-0024', side:'sell', size:0.5, strike:95000, expiry:'26 Sep 2026', premium:1400, status:'exercised'},
  {id:'CV-0019', side:'buy', size:0.25, strike:105000, expiry:'29 Aug 2026', premium:610, status:'settled'},
  {id:'CV-0040', side:'sell', size:1.5, strike:160000, expiry:'29 Jan 2027', premium:3900, status:'pending'}]})""",
"""# PositionsTable

The ledger of a person’s contracts. Header row on `paper-sunk` with uppercase labels; numeric columns right-aligned; every status stamped flat.

- Row identity is the contract serial (`CV-0037`), mono, with the side written out underneath (“Sold call”). Never an icon for buy/sell.
- Sort by expiry ascending by default: the next thing that happens is at the top.
- On narrow screens collapse to a list of OfferCards rather than scrolling a table sideways."""),

'Countdown': ('Status', 130, """h('div', {className:'cv-row', style:{gap:48}},
  h(C.Countdown, {totalSeconds:60*86400, secondsLeft:38*86400+4*3600, note:'Expires 31 Dec 2026, 08:00 UTC'}),
  h(C.Countdown, {totalSeconds:3600, secondsLeft:212, label:'Buyer has to pay within'}))""",
"""# Countdown

Time to expiry (or to a settlement deadline) as a gilt arc that empties clockwise, with the figure beside it. Under 10% of the total the arc turns `oxblood`.

- Days and hours while more than a day remains (“38d 04h”); hours, minutes and seconds inside the last day.
- The note names the absolute time in UTC, always: a countdown without a date is a guess.
- Never animate per second on the market page; only on the contract’s own page."""),

'SettlementTimeline': ('Status', 330, """h(C.SettlementTimeline, {steps:[
  {title:'Coins deposited', detail:'2.0000 BTC at bc1q…5mdq, proven by the Bitcoin light client', when:'4 Nov 21:08 UTC', state:'done'},
  {title:'Call sold', detail:'Premium $6,000 paid by marcus.near from Solana, received on Base', when:'4 Nov 21:31 UTC', state:'done'},
  {title:'Expiry', detail:'31 Dec 08:00 UTC · settlement price read', when:'in 38 days', state:'now'},
  {title:'Coins returned or sold', detail:'Below $150,000: 2.0000 BTC signed back to you. Above: sold at $150,000, paid on the chain you chose.', state:'todo'}]})""",
"""# SettlementTimeline

The life of one contract as steps: deposit, sale, expiry, outcome. Each step has a title, a detail line that names amounts and addresses, and a time in mono.

- States: `done` (intaglio, tick), `now` (gilt, dot), `todo` (empty), `refused` (oxblood, cross). A refused step keeps the steps after it visible and empty, so the person sees what did not happen.
- The last step is written as the branch it is: both outcomes, in plain words, before expiry. After expiry it becomes one line with a Stamp.
- Steps are separated by dashed `rule` hairlines, like a perforated coupon strip."""),

'Notice': ('Status', 130, """h('div', {className:'cv-stack'},
  h(C.Notice, null, 'Your coins stay on Bitcoin while the call is open. The contract can sign them to the buyer only after expiry, and only if the buyer has paid the strike.'),
  h(C.Notice, {tone:'refused'}, 'Deposit refused: 1.9998 BTC received, offer size is 2.0000 BTC. Top up 0.0002 BTC or reduce the size.'))""",
"""# Notice

An inline note in the margin voice. Two tones: a plain note, prefixed “N.B.” in italic Fraunces, and a refusal in `oxblood` that states what was refused, the exact figures, and what to do.

- One or two sentences. If it needs a heading, it is a page, not a notice.
- No icons other than the N.B. and the cross. No “Oops”, no exclamation marks."""),

'TopBar': ('Navigation', 72, """h(C.TopBar, {items:[{label:'Market', on:true},{label:'My contracts'},{label:'Verify'}]}, h(C.Figure, {value:2, kind:'btc', size:'sm'}), h(C.Button, {size:'sm'}, 'astrid.near'))""", """# TopBar

The product’s one navigation bar: lockup left (two-tone Mark and the word in Fraunces), three to five links, the account on the right. The current link carries a gilt underline, `stroke-mark` thick.

- Keep the link list short: Market, My contracts, Verify. Settings live under the account.
- Children render on the right: the person’s coin balance as a small Figure and their account as a quiet small Button.
- On Vault theme nothing changes but the tokens; do not restyle the bar for dark.""", 0),

'Certificate': ('Market', 440, """h(C.Certificate, {contract:{serial:'CV-0037', issued:'4 Nov 2026', size:2, strike:150000, expiry:'31 Dec 2026, 08:00 UTC', premium:6000, vault:'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', seller:'astrid.near', buyer:'marcus.near', contractId:'covered.near', status:'open'}},
  h(C.Button, null, 'Verify on NEAR'), h(C.Button, {variant:'primary'}, 'View settlement'))""",
"""# Certificate

The option contract as a printed security, and the one object the brand is built around. A double `intaglio` plate border, guilloche braids top and bottom, the Mark top-right, a serial and issue date, the terms in a key/value column, the human sentence in italic Fraunces, the parties in the footer.

- Supply the real contract; never a placeholder serial. The Bitcoin address is printed in full here (it is the proof), elsewhere truncated.
- Children are the footer actions. At most two.
- It is the hero of the contract page, the still in the demo video, and what a person screenshots. Give it `shadow-lift` only when it is photographed on a page, never in a list.
- 720px wide by design; on narrow screens scale the whole certificate down rather than reflowing it, so it stays a certificate.""")
}

for name, spec in COMPS.items():
    group, height, script, readme = spec[0], spec[1], spec[2], spec[3]
    pad = spec[4] if len(spec) > 4 else 24
    d = os.path.join(ROOT, name); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, 'preview.html'), 'w').write(preview(name, group, height, script, pad=pad))
    open(os.path.join(d, 'README.md'), 'w').write(readme + '\n')
    print(name)
