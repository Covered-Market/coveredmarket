"""Generate CoveredMarket brand assets as SVG. Text is converted to outlines with fontTools."""
import math, os
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(ROOT, 'fonts')
OUT = os.path.join(os.path.dirname(ROOT), 'assets')

PAPER = '#f2ead6'; VAULT = '#0f211b'; INK = '#132a23'; INK_V = '#ede4cc'
INTAGLIO = '#1f4f40'; INTAGLIO_V = '#4a9a7e'; DEEP = '#143a2f'
GILT = '#b88a2e'; GILT_V = '#d9b257'; COPPER = '#b3612c'; COPPER_V = '#d88a54'
MUTED = '#4f5f57'; MUTED_V = '#a7b3aa'; RULE = '#c4b894'; RULE_V = '#2f4d43'

_cache = {}
def font(name, axes):
    key = (name, tuple(sorted(axes.items())))
    if key not in _cache:
        f = TTFont(os.path.join(FONTS, name))
        _cache[key] = instancer.instantiateVariableFont(f, axes)
    return _cache[key]

def text_path(txt, name, axes, size, x=0, y=0, tracking=0):
    """Return (svg path d, width) for txt at baseline (x,y), font size px."""
    f = font(name, axes)
    gs = f.getGlyphSet(); cmap = f.getBestCmap(); upm = f['head'].unitsPerEm
    s = size / upm
    pen = SVGPathPen(gs)
    cx = x
    for ch in txt:
        g = cmap.get(ord(ch))
        if g is None:
            cx += size * 0.25; continue
        tp = TransformPen(pen, (s, 0, 0, -s, cx, y))
        gs[g].draw(tp)
        cx += gs[g].width * s + tracking * size
    return pen.getCommands(), cx - x

def name_path(name, axes, size, x=0, y=0):
    """'CoveredMarket' with the d–M kern from mark2 (the font has none)."""
    d1, w1 = text_path('Covered', name, axes, size, x, y)
    gap = mark2.DM_KERN * size
    d2, w2 = text_path('Market', name, axes, size, x + w1 + gap, y)
    return d1 + ' ' + d2, w1 + gap + w2

FRAUNCES =('Fraunces[SOFT,WONK,opsz,wght].ttf', {'wght': 500, 'opsz': 144, 'SOFT': 0, 'WONK': 0})
FRAUNCES_IT = ('Fraunces-Italic[SOFT,WONK,opsz,wght].ttf', {'wght': 400, 'opsz': 48, 'SOFT': 0, 'WONK': 0})
SANS = ('InstrumentSans[wdth,wght].ttf', {'wght': 500, 'wdth': 100})
SANS_B = ('InstrumentSans[wdth,wght].ttf', {'wght': 600, 'wdth': 100})
MONO = ('SplineSansMono[wght].ttf', {'wght': 500})

def write(path, svg):
    p = os.path.join(OUT, path); os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w') as fh: fh.write(svg)
    print(path, os.path.getsize(p))

# ---------- The mark: the Lid ----------
import lid as LID
import mark2
def mark(x=0, y=0, size=64, ink=INK, coin=None, finial=None, stroke=None, two_tone=False, detail=None, state='open'):
    """two_tone: body=`coin` colour if given else ink; lid=`finial` if given."""
    body = (coin if (two_tone and coin) else ink)
    cap = (finial if (two_tone and finial) else body)
    return LID.lid(x, y, size, body=body, cap=cap, state=state, small=(size < 28))

def svg(w, h, body, bg=None, vb=None):
    vb = vb or f'0 0 {w} {h}'
    bgr = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="{vb}">{bgr}{body}</svg>'

def wordmark(x, y, size, ink, italic=False, caps=False):
    return mark2.wordmark(x, y, size, ink, caps=caps)

# Logos — the Lid in every variant
def L(name, w, h, inner, bg=None): write(f'Logos/{name}.svg', svg(w, h, inner, bg=bg))
# symbol: primary two-tone, copper colourway, one-colour, reversed (thinned 3%), small cut
L('coveredmarket-symbol', 64, 64, LID.lid(body=INTAGLIO, cap=GILT))
L('coveredmarket-symbol-copper', 64, 64, LID.lid(body=COPPER, cap=INTAGLIO))
L('coveredmarket-symbol-ink', 64, 64, LID.lid(body=INK))
L('coveredmarket-symbol-intaglio', 64, 64, LID.lid(body=INTAGLIO))
L('coveredmarket-symbol-on-vault', 64, 64, LID.lid(body=INK_V, cap=GILT_V, thin=0.03), bg=VAULT)
L('coveredmarket-symbol-reversed', 64, 64, LID.lid(body=INK_V, thin=0.03), bg=VAULT)
L('coveredmarket-symbol-small', 64, 64, LID.lid(body=INK, small=True))
L('coveredmarket-symbol-small-on-vault', 64, 64, LID.lid(body=INK_V, cap=GILT_V, small=True), bg=VAULT)
# states (for the system: stamps, timelines, motion)
for st in ('open', 'kept', 'exercised'):
    L(f'coveredmarket-symbol-state-{st}', 64, 64, LID.lid(body=INTAGLIO, cap=GILT, state=st))
# wordmarks
wm, ww = wordmark(0, 46, 56, INK); L('coveredmarket-wordmark', math.ceil(ww) + 2, 64, wm)
wm, ww = wordmark(0, 46, 56, INK_V); L('coveredmarket-wordmark-on-vault', math.ceil(ww) + 2, 64, wm, bg=VAULT)
wm, ww = wordmark(0, 36, 48, INK, caps=True); L('coveredmarket-wordmark-caps', math.ceil(ww) + 2, 48, wm)
# horizontal lockups: symbol cap-height-plus, gap = half the symbol
def lockup(body, cap, ink, bg=None, name='coveredmarket-lockup'):
    wm, ww = wordmark(84, 47, 56, ink)
    L(name, math.ceil(ww) + 88, 64, LID.lid(0, 0, 64, body=body, cap=cap, thin=(0.03 if bg else 0)) + wm, bg=bg)
lockup(INTAGLIO, GILT, INK)
lockup(INK, INK, INK, name='coveredmarket-lockup-ink')
lockup(INK_V, GILT_V, INK_V, bg=VAULT, name='coveredmarket-lockup-on-vault')
lockup(COPPER, INTAGLIO, INK, name='coveredmarket-lockup-copper')
# stacked
wm, ww = wordmark(0, 0, 40, INK); W = math.ceil(ww); H = 64 + 14 + 40
L('coveredmarket-lockup-stacked', W, H, f'<g transform="translate({W/2-32:.1f},0)">' + LID.lid(body=INTAGLIO, cap=GILT) + '</g>' + f'<g transform="translate(0,{64+14+30})">' + wm + '</g>')
wm, ww = wordmark(0, 0, 40, INK_V)
L('coveredmarket-lockup-stacked-on-vault', W, H, f'<g transform="translate({W/2-32:.1f},0)">' + LID.lid(body=INK_V, cap=GILT_V, thin=0.03) + '</g>' + f'<g transform="translate(0,{64+14+30})">' + wm + '</g>', bg=VAULT)
# seal: the lid inside a ring of outlined microtext
def seal(ink, body, cap, bg=None):
    txt = 'COVEREDMARKET · NATIVE BITCOIN · NO CUSTODIAN · '
    out = []
    rr, fs = 45.5, 6.25  # sized so the 13-letter name keeps the original ring density
    f = font(*SANS_B); gs = f.getGlyphSet(); cmap = f.getBestCmap(); upm = f['head'].unitsPerEm; sc = fs/upm
    chars = txt * 2
    adv = [ (gs[cmap[ord(c)]].width*sc if ord(c) in cmap else fs*0.3) + fs*0.14 for c in chars]
    k = 2*math.pi*rr / sum(adv); adv = [a*k for a in adv]
    ang = -math.pi/2
    for c, a in zip(chars, adv):
        mid = ang + (a/rr)/2
        if ord(c) in cmap:
            pen = SVGPathPen(gs); tp = TransformPen(pen, (sc, 0, 0, -sc, -gs[cmap[ord(c)]].width*sc/2, 0)); gs[cmap[ord(c)]].draw(tp)
            out.append(f'<path d="{pen.getCommands()}" fill="{ink}" transform="translate({64+rr*math.cos(mid):.2f},{64+rr*math.sin(mid):.2f}) rotate({math.degrees(mid)+90:.2f})"/>')
        ang += a/rr
    out.append(f'<circle cx="64" cy="64" r="54" fill="none" stroke="{ink}" stroke-width="1.2"/>')
    out.append(f'<circle cx="64" cy="64" r="37" fill="none" stroke="{ink}" stroke-width="1.2"/>')
    out.append(f'<g transform="translate(38,38) scale(0.8125)">' + LID.lid(body=body, cap=cap) + '</g>')
    return ''.join(out)
L('coveredmarket-seal', 128, 128, seal(INK, INTAGLIO, GILT))
L('coveredmarket-seal-ink', 128, 128, seal(INK, INK, INK))
L('coveredmarket-seal-on-vault', 128, 128, seal(INK_V, INK_V, GILT_V), bg=VAULT)
# app icons: square (iOS masks it) and a 22%-radius rounded square; symbol at 62%
for n, size, rx in (('app-icon-1024', 1024, 0), ('app-icon-1024-rounded', 1024, 225), ('app-icon-192', 192, 0)):
    s = size / 64
    body = f'<rect width="{size}" height="{size}" rx="{rx}" fill="{VAULT}"/>'
    body += f'<g transform="translate({size*0.19:.1f},{size*0.17:.1f}) scale({size*0.62/64:.4f})">' + LID.lid(body=INK_V, cap=GILT_V) + '</g>'
    L(n, size, size, body)
L('favicon', 64, 64, LID.lid(body=INK, small=True), bg=PAPER)
L('favicon-on-vault', 64, 64, LID.lid(body=INK_V, cap=GILT_V, small=True), bg=VAULT)
# the "built on NEAR" rule: lockup + hairline + a text slot (NEAR's own mark goes to the right, supplied by NEAR)
wm, ww = wordmark(84, 47, 56, INK)
L('coveredmarket-lockup-with-partner-rule', math.ceil(ww) + 88 + 40, 64, LID.lid(0, 0, 64, body=INTAGLIO, cap=GILT) + wm + f'<line x1="{math.ceil(ww)+104}" y1="12" x2="{math.ceil(ww)+104}" y2="52" stroke="{RULE}" stroke-width="1"/>')

# ---------- Patterns ----------
def rosette(cx, cy, R, ink, rings=7, sw=0.9):
    """Classic spirograph rosette: a set of thin rotated ellipses, in two families."""
    out = []
    fams = [(36, 0.98, 0.30, 0.16), (24, 0.72, 0.22, 0.42)]
    for count, rx, ry, off in fams[:2 if rings > 4 else 1]:
        for k in range(count):
            ang = 2*math.pi*k/count
            pts = []
            for i in range(180):
                t = 2*math.pi*i/180
                ex, ey = R*rx*math.cos(t) + R*off, R*ry*math.sin(t)
                px = cx + ex*math.cos(ang) - ey*math.sin(ang)
                py = cy + ex*math.sin(ang) + ey*math.cos(ang)
                pts.append(f'{px:.1f},{py:.1f}')
            out.append(f'<polygon points="{" ".join(pts)}" fill="none" stroke="{ink}" stroke-width="{sw}"/>')
    return ''.join(out)

write('Patterns/guilloche-rosette.svg', svg(480, 480, rosette(240, 240, 220, INK)))
write('Patterns/guilloche-rosette-gilt-on-vault.svg', svg(480, 480, rosette(240, 240, 220, GILT_V, sw=0.8), bg=VAULT))

def band(w, h, ink, waves=10, sw=0.7):
    """A braid: one sine at two phases per strand, mirrored, tileable over w."""
    out = []
    lam = w/6
    for i in range(waves):
        ph = math.pi*i/waves
        for sign in (1, -1):
            pts = []
            for x in range(0, w+1, 3):
                y = h/2 + sign*(h*0.40)*math.sin(2*math.pi*x/lam + ph)
                pts.append(f'{x},{y:.1f}')
            out.append(f'<polyline points="{" ".join(pts)}" fill="none" stroke="{ink}" stroke-width="{sw}"/>')
    return ''.join(out)

write('Patterns/guilloche-band.svg', svg(960, 64, band(960, 64, INK)))
write('Patterns/guilloche-band-on-vault.svg', svg(960, 64, band(960, 64, GILT_V), bg=VAULT))

def coupon_edge(w, ink):
    # a perforation: half-moon punches along a hairline, tileable at 24px pitch
    out = [f'<line x1="0" y1="12" x2="{w}" y2="12" stroke="{ink}" stroke-width="1" stroke-dasharray="6 6"/>']
    for x in range(0, w + 1, 24):
        out.append(f'<circle cx="{x}" cy="12" r="4" fill="{PAPER}" stroke="{ink}" stroke-width="1"/>')
    return ''.join(out)
write('Patterns/coupon-edge.svg', svg(480, 24, coupon_edge(480, INK)))

def hatch(size, ink, pitch=6):
    out = []
    for i in range(-size, size * 2, pitch):
        out.append(f'<line x1="{i}" y1="0" x2="{i+size}" y2="{size}" stroke="{ink}" stroke-width="0.8"/>')
    return ''.join(out)
write('Patterns/hatch.svg', svg(96, 96, hatch(96, INK)))

def microtext(w, h, ink):
    d, tw = text_path('COVEREDMARKET · INCOME ON BITCOIN YOU STILL HOLD · ', *SANS_B, 7, 0, 9, tracking=0.08)
    out = [f'<defs><path id="mt" d="{d}" fill="{ink}"/></defs>']
    reps = int(w / tw) + 2
    for row in range(int(h / 12)):
        for i in range(reps):
            out.append(f'<use href="#mt" x="{i*tw - (tw/2 if row%2 else 0):.1f}" y="{row*12}"/>')
    return ''.join(out)
def lid_tile(ink, pitch=48):
    out=[]
    for row in range(4):
        for col in range(10):
            x = col*pitch + (pitch/2 if row%2 else 0); y = row*pitch
            out.append(f'<g transform="translate({x+8},{y+8}) scale(0.5)">' + LID.lid(body=ink, state=('kept','open','exercised')[(row+col)%3]) + '</g>')
    return ''.join(out)
write('Patterns/lid-tile.svg', svg(480, 192, lid_tile(INK)))
write('Patterns/microtext.svg', svg(480, 96, microtext(480, 96, INK)))

# ---------- Icons: 24px, 2px line, round caps ----------
def icon(name, body):
    write(f'Icons/{name}.svg', f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="{INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{body}</svg>')
icon('lid-open', '<path d="M4 13a8 8 0 0 0 16 0v-1H4z"/><path d="M5 8h14"/>')
icon('lid-kept', '<circle cx="12" cy="12" r="8"/><path d="M5 10h14"/>')
icon('lid-exercised', '<path d="M4 14a8 8 0 0 0 16 0v-1H4z"/><path d="M6 5h12"/>')
icon('coin', '<circle cx="12" cy="12" r="8"/><path d="M10 8h3a2 2 0 0 1 0 4h-3zM10 12h3.5a2 2 0 0 1 0 4H10zM10 8v8M12 6v2M12 16v2"/>')
icon('strike', '<path d="M4 6h16M12 20V10M8 14l4-4 4 4"/>')
icon('expiry', '<rect x="4" y="5" width="16" height="15"/><path d="M4 10h16M8 3v4M16 3v4M12 13v4"/>')
icon('premium', '<path d="M12 3v18M8 7h6a2.5 2.5 0 0 1 0 5H9a2.5 2.5 0 0 0 0 5h7"/>')
icon('key', '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M15 12v2"/>')
icon('kept', '<path d="M5 12l5 5 9-10"/>')
icon('exercised', '<path d="M5 19L19 5M9 5h10v10"/>')
icon('refused', '<path d="M6 6l12 12M18 6L6 18"/>')
icon('clock', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')
icon('chain', '<path d="M10 14a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 0 0-5.66-5.66L11.4 6.94"/><path d="M14 10a4 4 0 0 0-5.66 0l-2.83 2.83a4 4 0 0 0 5.66 5.66l1.43-1.43"/>')
icon('arrow-right', '<path d="M5 12h14M13 6l6 6-6 6"/>')
icon('verify', '<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/><path d="M9 12l2 2 4-4"/>')
icon('wallet', '<rect x="3" y="7" width="18" height="13"/><path d="M3 10h18M16 14h2"/><path d="M6 7V5h10v2"/>')

# ---------- Social ----------
TAGLINE = 'Open to anyone. Held by no one. Earning for you.'

def tagline(x, y, size, ink, max_w=None):
    """The brand line at baseline (x, y); shrinks to fit max_w if given."""
    if max_w:
        _, w = text_path(TAGLINE, *FRAUNCES_IT, size, 0, 0)
        if w > max_w: size *= max_w / w
    d, w = text_path(TAGLINE, *FRAUNCES_IT, size, x, y)
    return f'<path d="{d}" fill="{ink}"/>', w

def social(w, h, dark=True):
    bg = VAULT if dark else PAPER
    ink = INK_V if dark else INK
    gilt = GILT_V if dark else GILT
    muted = MUTED_V if dark else MUTED
    rule = RULE_V if dark else RULE
    body = ''
    # engraved rosette bleeding off the right
    R = h * 0.78
    body += f'<g opacity="{0.42 if dark else 0.28}">' + rosette(w - R * 0.22, h * 0.5, R, gilt if dark else INK, rings=8, sw=0.9) + '</g>'
    # plate frame
    m = h * 0.08
    body += f'<rect x="{m}" y="{m}" width="{w-2*m}" height="{h-2*m}" fill="none" stroke="{rule}" stroke-width="1"/>'
    # mark + wordmark
    ms = h * 0.22
    body += f'<g transform="translate({m*1.6},{m*1.6}) scale({ms/64})">' + mark(ink=(INK_V if dark else INTAGLIO), coin=(INK_V if dark else INTAGLIO), finial=gilt, two_tone=True) + '</g>'
    wmp, ww = wordmark(m * 1.6 + ms * 1.2, m * 1.6 + ms * 0.72, ms * 0.9, ink)
    body += wmp
    # tagline bottom-left
    tp, tw = tagline(m * 1.6, h - m * 2.2, h * 0.11, ink, max_w=w - m * 3.2)
    body += tp
    # small line under
    d, _ = text_path('Non-custodial covered calls on native Bitcoin · built on NEAR', *SANS, h * 0.045, m * 1.6, h - m * 1.35, tracking=0.01)
    body += f'<path d="{d}" fill="{muted}"/>'
    return svg(w, h, body, bg=bg)

write('Social/og-image-1200x630.svg', social(1200, 630))
write('Social/x-header-1500x500.svg', social(1500, 500))
write('Social/og-image-paper-1200x630.svg', social(1200, 630, dark=False))

# avatar
body = f'<rect width="400" height="400" fill="{VAULT}"/><circle cx="200" cy="200" r="176" fill="none" stroke="{GILT_V}" stroke-width="2"/>'
body += f'<g transform="translate(72,60) scale(4)">' + mark(ink=INK_V, coin=INK_V, finial=GILT_V, two_tone=True) + '</g>'
write('Social/avatar-400.svg', svg(400, 400, body))

# video title card and end card 1920x1080
def title_card():
    w, h = 1920, 1080
    body = f'<g opacity="0.4">' + rosette(1700, 540, 700, GILT_V, rings=9, sw=1) + '</g>'
    body += f'<rect x="64" y="64" width="{w-128}" height="{h-128}" fill="none" stroke="{RULE_V}" stroke-width="1.5"/>'
    body += f'<g transform="translate(120,112) scale(1.5)">' + mark(ink=INK_V, coin=INK_V, finial=GILT_V, two_tone=True) + '</g>'
    d, _ = name_path(*FRAUNCES, 160, 120, 640)
    body += f'<path d="{d}" fill="{INK_V}"/>'
    tp, _ = tagline(124, 740, 64, GILT_V, max_w=w - 248)
    body += tp
    d, _ = text_path('BUILT AT NEAR HACKATHON', *SANS_B, 26, 124, 960, tracking=0.16)
    body += f'<path d="{d}" fill="{MUTED_V}"/>'
    return svg(w, h, body, bg=VAULT)
write('Social/video-title-card-1920x1080.svg', title_card())

def end_card():
    w, h = 1920, 1080
    body = f'<rect x="64" y="64" width="{w-128}" height="{h-128}" fill="none" stroke="{RULE_V}" stroke-width="1.5"/>'
    body += f'<g transform="translate({w/2-96},{h/2-300}) scale(3)">' + mark(ink=INK_V, coin=INK_V, finial=GILT_V, two_tone=True) + '</g>'
    d, tw = name_path(*FRAUNCES, 120, 0, 0)
    body += f'<g transform="translate({w/2-tw/2},{h/2+60})"><path d="{d}" fill="{INK_V}"/></g>'
    d, tw = text_path('Your coins never leave Bitcoin.', *FRAUNCES_IT, 44, 0, 0)
    body += f'<g transform="translate({w/2-tw/2},{h/2+130})"><path d="{d}" fill="{GILT_V}"/></g>'
    d, tw = text_path('github.com/…/coveredmarket  ·  Chain Signatures  ·  NEAR Intents  ·  built at NEAR HACKATHON', *SANS, 24, 0, 0, tracking=0.02)
    body += f'<g transform="translate({w/2-tw/2},{h-140})"><path d="{d}" fill="{MUTED_V}"/></g>'
    return svg(w, h, body, bg=VAULT)
write('Social/video-end-card-1920x1080.svg', end_card())

# square social card 1080
def square():
    w = h = 1080
    body = f'<g opacity="0.45">' + rosette(900, 200, 520, GILT_V, rings=8, sw=1) + '</g>'
    body += f'<rect x="48" y="48" width="{w-96}" height="{h-96}" fill="none" stroke="{RULE_V}" stroke-width="1.5"/>'
    body += f'<g transform="translate(96,96) scale(1.25)">' + mark(ink=INK_V, coin=INK_V, finial=GILT_V, two_tone=True) + '</g>'
    d, _ = text_path('Sell a call.', *FRAUNCES, 120, 96, 700); body += f'<path d="{d}" fill="{INK_V}"/>'
    d, _ = text_path('Keep the coins.', *FRAUNCES, 120, 96, 830); body += f'<path d="{d}" fill="{INK_V}"/>'
    d, _ = text_path('Non-custodial covered calls on native Bitcoin', *SANS, 30, 100, 930, tracking=0.01); body += f'<path d="{d}" fill="{GILT_V}"/>'
    return svg(w, h, body, bg=VAULT)
write('Social/square-card-1080.svg', square())
print('done')
