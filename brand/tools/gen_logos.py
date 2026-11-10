"""CoveredMarket logo set: writes every file in assets/Logos.

Replaces the Logos section of gen_assets.py and the earlier gen_screen_lockup.py. What it guarantees:
  - Text is outlined with HarfBuzz shaping, then unioned with Skia PathOps, so every wordmark is one clean
    shape: no overlapping or self-intersecting contours (Fraunces' e, r, t, k, E, K have them), which
    otherwise render with dark seams or fringes at the crossings and break in design tools.
  - Layout is measured from the real ink bounds, not font advances: each file has equal margins and the
    artwork is centred in fixed-size boxes (symbols, icons, seal).
  - Coordinates are written to 2 decimals.
  - Screen cuts (lockup-32, lockup-22) are drawn at the pixel height they are shown at, with the lid's
    chords, the baseline and the x-height on whole pixels, and a lower optical size so hairlines hold at 1x.

Usage: python gen_logos.py      (needs fonttools, brotli, uharfbuzz, skia-pathops)
"""
import io, math, os, sys
import pathops
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path

HERE = os.path.dirname(os.path.abspath(__file__))
BRAND = os.path.dirname(HERE)
FONTS = os.path.join(BRAND, 'fonts')
OUT = os.path.join(BRAND, 'assets', 'Logos')

PAPER = '#f2ead6'; VAULT = '#0f211b'; INK = '#132a23'; INK_V = '#ede4cc'
INTAGLIO = '#1f4f40'; GILT = '#b88a2e'; GILT_V = '#d9b257'; COPPER = '#b3612c'; RULE = '#c4b894'

FRAUNCES = 'Fraunces-Variable.woff2'
SANS = 'InstrumentSans-Variable.woff2'
DM_KERN = 0.025     # em; Fraunces has no d–M kern, so their serifs would touch
TRACK = -0.004      # em
THIN = 0.03         # reversed (on Vault) symbols are thinned 3%


def fmt(v):
    s = f'{v:.2f}'.rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


# ---------- shapes ----------
class Fill:
    """A filled shape held as a PathOps path, so it can be unioned, measured and moved."""
    def __init__(self, path, fill):
        self.p, self.fill = path, fill

    @classmethod
    def from_d(cls, d, fill):
        p = pathops.Path(); parse_path(d, p.getPen()); return cls(p, fill)

    def bounds(self):
        return self.p.bounds

    def moved(self, dx, dy, s=1.0):
        p = pathops.Path(); self.p.draw(TransformPen(p.getPen(), (s, 0, 0, s, dx, dy))); return Fill(p, self.fill)

    def svg(self):
        pen = SVGPathPen(None, ntos=fmt); self.p.draw(pen)
        return f'<path fill="{self.fill}" d="{pen.getCommands()}"/>'


class Ring:
    def __init__(self, cx, cy, r, w, colour):
        self.cx, self.cy, self.r, self.w, self.c = cx, cy, r, w, colour

    def bounds(self):
        e = self.r + self.w / 2; return (self.cx - e, self.cy - e, self.cx + e, self.cy + e)

    def moved(self, dx, dy, s=1.0):
        return Ring(self.cx * s + dx, self.cy * s + dy, self.r * s, self.w * s, self.c)

    def svg(self):
        return f'<circle cx="{fmt(self.cx)}" cy="{fmt(self.cy)}" r="{fmt(self.r)}" fill="none" stroke="{self.c}" stroke-width="{fmt(self.w)}"/>'


class Rule:
    def __init__(self, x, y0, y1, w, colour):
        self.x, self.y0, self.y1, self.w, self.c = x, y0, y1, w, colour

    def bounds(self):
        return (self.x - self.w / 2, self.y0, self.x + self.w / 2, self.y1)

    def moved(self, dx, dy, s=1.0):
        return Rule(self.x * s + dx, self.y0 * s + dy, self.y1 * s + dy, self.w * s, self.c)

    def svg(self):
        return f'<rect x="{fmt(self.x - self.w / 2)}" y="{fmt(self.y0)}" width="{fmt(self.w)}" height="{fmt(self.y1 - self.y0)}" fill="{self.c}"/>'


def bounds(items):
    bs = [i.bounds() for i in items]
    return (min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs))


def moved(items, dx, dy, s=1.0):
    return [i.moved(dx, dy, s) for i in items]


# ---------- text ----------
_fonts = {}
def font(name, axes):
    key = (name, tuple(sorted(axes.items())))
    if key not in _fonts:
        f = instancer.instantiateVariableFont(TTFont(os.path.join(FONTS, name)), axes)
        f.flavor = None                       # HarfBuzz reads plain sfnt, not WOFF2
        bio = io.BytesIO(); f.save(bio)
        _fonts[key] = (f, bio.getvalue())
    return _fonts[key]


def shape(txt, fnt, size, x, y, tracking=0.0):
    """Shaped glyph outlines drawn into one PathOps path. Returns (path, advance width)."""
    f, data = fnt
    face = hb.Face(data); hf = hb.Font(face); upm = face.upem; hf.scale = (upm, upm)
    buf = hb.Buffer(); buf.add_str(txt); buf.guess_segment_properties()
    hb.shape(hf, buf, {'kern': True, 'liga': True})
    gs = f.getGlyphSet(); order = f.getGlyphOrder(); s = size / upm
    p = pathops.Path(); cx = x
    n = len(buf.glyph_infos)
    for i, (info, pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
        gs[order[info.codepoint]].draw(TransformPen(p.getPen(glyphSet=gs), (s, 0, 0, -s, cx + pos.x_offset * s, y - pos.y_offset * s)))
        cx += pos.x_advance * s + (tracking * size if i < n - 1 else 0)   # no tracking after the last letter
    return p, cx - x


def clean(p):
    """Union overlapping and self-intersecting contours into one non-overlapping outline."""
    return pathops.simplify(p, fix_winding=True, keep_starting_points=False)


def fraunces(opsz=144, wght=480):
    return font(FRAUNCES, {'wght': wght, 'opsz': opsz, 'SOFT': 0, 'WONK': 0})


def wordmark(ink, size, x=0.0, baseline=0.0, opsz=144, wght=480):
    """'CoveredMarket' with the d–M pair opened. Returns (Fill, cap height)."""
    fnt = fraunces(opsz, wght)
    p1, w1 = shape('Covered', fnt, size, x, baseline, TRACK)
    p2, _ = shape('Market', fnt, size, x + w1 + (DM_KERN + TRACK) * size, baseline, TRACK)
    p1.addPath(p2)
    cap = fnt[0]['OS/2'].sCapHeight * size / fnt[0]['head'].unitsPerEm
    return Fill(clean(p1), ink), cap


def wordmark_caps(ink, size):
    p, _ = shape('COVEREDMARKET', fraunces(), size, 0, 0, 0.14)
    return Fill(clean(p), ink)


# ---------- the Lid ----------
def lid(body, cap=None, size=64.0, small=False, state='open', thin=0.0, cx=None, cy=None):
    """Coin and lid on a `size` grid (64 = the master). Same geometry as lid.py."""
    s = size / 64
    cap = cap or body
    cx = 32 * s if cx is None else cx
    cy = 33.5 * s if cy is None else cy
    r = 25 * s * (1 - thin)
    k = 0.45 if small else 0.5
    gap = {'open': 5.0 if small else 3.5, 'kept': 2.2 if small else 1.4, 'exercised': 9 if small else 7}[state] * s
    ch = cy - k * r
    hw = math.sqrt(r * r - (k * r) ** 2)
    a = f'{r:.4f}'
    return [Fill.from_d(f'M{cx-hw:.4f},{ch:.4f} A{a},{a} 0 1 0 {cx+hw:.4f},{ch:.4f} Z', body),
            Fill.from_d(f'M{cx-hw:.4f},{ch-gap:.4f} A{a},{a} 0 0 1 {cx+hw:.4f},{ch-gap:.4f} Z', cap)]


# ---------- documents ----------
def write(name, w, h, items, bg=None):
    w, h = round(w, 2), round(h, 2)
    bgr = f'<rect width="{fmt(w)}" height="{fmt(h)}" fill="{bg}"/>' if bg else ''
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{fmt(w)}" height="{fmt(h)}" viewBox="0 0 {fmt(w)} {fmt(h)}">'
           + bgr + ''.join(i.svg() for i in items) + '</svg>')
    p = os.path.join(OUT, name + '.svg')
    with open(p, 'w') as fh:
        fh.write(svg)
    print(f'{name:44s} {fmt(w):>6} x {fmt(h):<6} {len(svg):>6} bytes')


def padded(name, items, pad, bg=None, height=None, ref=None):
    """Trim to the ink and add `pad` on every side (or centre vertically in `height`).
    `ref`: measure the box from these items instead (so a thinned colourway keeps its twin's exact size)."""
    x0, y0, x1, y1 = bounds(ref or items)
    w = math.ceil((x1 - x0) + 2 * pad)                  # whole-pixel canvas; the slack is split evenly
    h = height if height else math.ceil((y1 - y0) + 2 * pad)
    write(name, w, h, moved(items, (w - (x1 - x0)) / 2 - x0, (h - (y1 - y0)) / 2 - y0), bg)


def centred(name, items, w, h, bg=None, extra=()):
    x0, y0, x1, y1 = bounds(items)
    write(name, w, h, list(extra) + moved(items, (w - (x1 - x0)) / 2 - x0, (h - (y1 - y0)) / 2 - y0), bg)


# ---------- the set ----------
def lockup_items(body, cap, ink, thin=0.0):
    """Horizontal lockup: symbol at 64, wordmark at 56 starting 20 clear of the coin, cap height centred on the symbol."""
    sym = lid(body, cap, thin=thin)
    sx0, sy0, sx1, sy1 = bounds(lid(body, cap))          # place the wordmark from the unthinned symbol
    wm, caph = wordmark(ink, 56)
    wx0 = wm.bounds()[0]
    baseline = (sy0 + sy1) / 2 + caph / 2
    return sym + [wm.moved(sx1 + 20 - wx0, baseline)]


def screen_cut(H, opsz, small, body, cap, ink, thin=0.0):
    """A lockup drawn at H px: lid chords, baseline and x-height on whole pixels."""
    s = H / 64
    r = 25 * s
    k = 0.45 if small else 0.5
    ch = round(33.5 * s - k * r)
    gap = max(2, round((5.0 if small else 3.5) * s))
    cy = ch + k * r
    cx = 32 * s
    rr = r * (1 - thin)
    hw = math.sqrt(rr * rr - (k * rr) ** 2)
    a = f'{rr:.4f}'
    sym = [Fill.from_d(f'M{cx-hw:.4f},{ch} A{a},{a} 0 1 0 {cx+hw:.4f},{ch} Z', body),
           Fill.from_d(f'M{cx-hw:.4f},{ch-gap} A{a},{a} 0 0 1 {cx+hw:.4f},{ch-gap} Z', cap)]
    f, _ = fraunces(opsz, 420)
    from fontTools.pens.boundsPen import BoundsPen
    bp = BoundsPen(f.getGlyphSet()); f.getGlyphSet()[f.getBestCmap()[ord('x')]].draw(bp)
    size = round(0.375 * H) * f['head'].unitsPerEm / bp.bounds[3]    # x-height on a whole pixel
    caph = f['OS/2'].sCapHeight * size / f['head'].unitsPerEm
    mid = ((cy - r - gap) + (cy + r)) / 2
    baseline = round(mid + caph / 2)
    wm, _ = wordmark(ink, size, 0, baseline, opsz=opsz, wght=420)
    x = round(cx + r + 20 * s - wm.bounds()[0])                        # whole-pixel origin, 20-unit gap
    items = sym + [wm.moved(x, 0)]
    left = cx - r
    w = math.ceil(bounds(items)[2] + left)                             # right margin = left margin
    return w, items


def main():
    os.makedirs(OUT, exist_ok=True)

    # symbols: artwork centred in the 64 box
    for name, body, cap, bg, small, thin in (
        ('coveredmarket-symbol', INTAGLIO, GILT, None, False, 0),
        ('coveredmarket-symbol-copper', COPPER, INTAGLIO, None, False, 0),
        ('coveredmarket-symbol-ink', INK, None, None, False, 0),
        ('coveredmarket-symbol-intaglio', INTAGLIO, None, None, False, 0),
        ('coveredmarket-symbol-on-vault', INK_V, GILT_V, VAULT, False, THIN),
        ('coveredmarket-symbol-reversed', INK_V, None, VAULT, False, THIN),
        ('coveredmarket-symbol-small', INK, None, None, True, 0),
        ('coveredmarket-symbol-small-on-vault', INK_V, GILT_V, VAULT, True, THIN),
        ('favicon', INK, None, PAPER, True, 0),
        ('favicon-on-vault', INK_V, GILT_V, VAULT, True, THIN),
    ):
        centred(name, lid(body, cap, small=small, thin=thin), 64, 64, bg)

    # states: the coin stays put across all three (they animate into each other); centred on the open state
    ox0, oy0, ox1, oy1 = bounds(lid(INTAGLIO, GILT))
    dy = (64 - (oy1 - oy0)) / 2 - oy0
    for st in ('open', 'kept', 'exercised'):
        write(f'coveredmarket-symbol-state-{st}', 64, 64, moved(lid(INTAGLIO, GILT, state=st), 0, dy))

    # wordmarks: equal margins all round
    wm, _ = wordmark(INK, 56)
    PAD_WM = (64 - (wm.bounds()[3] - wm.bounds()[1])) / 2
    padded('coveredmarket-wordmark', [wm], PAD_WM)
    padded('coveredmarket-wordmark-on-vault', [wordmark(INK_V, 56)[0]], PAD_WM, bg=VAULT)
    caps = wordmark_caps(INK, 48 * 0.78)
    padded('coveredmarket-wordmark-caps', [caps], (48 - (caps.bounds()[3] - caps.bounds()[1])) / 2)

    # horizontal lockups: 64 tall, the symbol's own top/bottom space repeated left and right
    sb = bounds(lid(INTAGLIO, GILT))
    PAD = (64 - (sb[3] - sb[1])) / 2
    for name, body, cap, ink, bg, thin in (
        ('coveredmarket-lockup', INTAGLIO, GILT, INK, None, 0),
        ('coveredmarket-lockup-ink', INK, INK, INK, None, 0),
        ('coveredmarket-lockup-copper', COPPER, INTAGLIO, INK, None, 0),
        ('coveredmarket-lockup-on-vault', INK_V, GILT_V, INK_V, VAULT, THIN),
    ):
        padded(name, lockup_items(body, cap, ink, thin), PAD, bg, height=64, ref=lockup_items(body, cap, ink))

    # partner rule: a hairline 20 clear of the wordmark, 40 tall on the symbol's centre; NEAR's mark sits 20 beyond
    items = lockup_items(INTAGLIO, GILT, INK)
    x0, y0, x1, y1 = bounds(items)
    mid = (sb[1] + sb[3]) / 2
    items.append(Rule(x1 + 20, mid - 20, mid + 20, 1, RULE))
    x0, _, x1, _ = bounds(items)
    write('coveredmarket-lockup-with-partner-rule', math.ceil((x1 - x0) + PAD + 20), 64, moved(items, PAD - x0, 0))

    # stacked: symbol centred over the wordmark's ink, 14 between them, equal margins
    for name, body, cap, ink, bg, thin in (
        ('coveredmarket-lockup-stacked', INTAGLIO, GILT, INK, None, 0),
        ('coveredmarket-lockup-stacked-on-vault', INK_V, GILT_V, INK_V, VAULT, THIN),
    ):
        s0 = bounds(lid(body, cap))
        wm, _ = wordmark(ink, 40)
        w0 = wm.bounds()
        wm = wm.moved(((s0[0] + s0[2]) / 2) - (w0[0] + w0[2]) / 2, s0[3] + 14 - w0[1])
        padded(name, lid(body, cap, thin=thin) + [wm], 12, bg, ref=lid(body, cap) + [wm])

    # seal: lettering kerned and centred in the band between the rings; the symbol centred inside
    for name, ink, body, cap, bg, thin in (
        ('coveredmarket-seal', INK, INTAGLIO, GILT, None, 0),
        ('coveredmarket-seal-ink', INK, INK, INK, None, 0),
        ('coveredmarket-seal-on-vault', INK_V, INK_V, GILT_V, VAULT, THIN),
    ):
        C, R_OUT, R_IN, SW = 64, 54, 37, 1.2
        fs = 6.25
        sans = font(SANS, {'wght': 600, 'wdth': 100})
        f, _ = sans
        upm = f['head'].unitsPerEm
        caph = f['OS/2'].sCapHeight * fs / upm
        band_mid = ((R_OUT - SW / 2) + (R_IN + SW / 2)) / 2
        rb = band_mid - caph / 2                                       # baseline radius: caps centred in the band
        run = 'COVEREDMARKET · NATIVE BITCOIN · NO CUSTODIAN · '
        # lay the run out flat with kerning and tracking, then bend it: x along the baseline becomes angle
        p, wrun = shape(run, sans, fs, 0, 0, 0.14)
        reps = 2
        k = (2 * math.pi * rb) / (wrun * reps + 0.14 * fs * reps)
        _, wname = shape('COVEREDMARKET', sans, fs, 0, 0, 0.14)
        start = -wname / 2                                             # the name centred at 12 o'clock
        items = []
        for rep in range(reps):
            # split per glyph so each letter is rotated upright on the circle (bending outlines would distort them)
            fnt_f, data = sans
            face = hb.Face(data); hf = hb.Font(face); hf.scale = (upm, upm)
            buf = hb.Buffer(); buf.add_str(run); buf.guess_segment_properties(); hb.shape(hf, buf, {'kern': True})
            gs = fnt_f.getGlyphSet(); order = fnt_f.getGlyphOrder(); s = fs / upm
            x = rep * (wrun + 0.14 * fs)
            for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
                g = gs[order[info.codepoint]]
                adv = pos.x_advance * s
                gp = pathops.Path(); g.draw(TransformPen(gp.getPen(glyphSet=gs), (s, 0, 0, -s, -adv / 2, 0)))
                if len(list(gp.contours)):
                    a = -math.pi / 2 + (start + x + adv / 2) * k / rb
                    rot = a + math.pi / 2
                    c, sn = math.cos(rot), math.sin(rot)
                    px, py = C + rb * math.cos(a), C + rb * math.sin(a)
                    out = pathops.Path(); gp.draw(TransformPen(out.getPen(), (c, sn, -sn, c, px, py)))
                    items.append(Fill(clean(out), ink))
                x += adv + 0.14 * fs
        # merge lettering into one path
        letters = pathops.Path()
        for it in items: letters.addPath(it.p)
        sym = lid(body, cap, thin=thin)
        sx0, sy0, sx1, sy1 = bounds(lid(body, cap))
        scale = 0.8125
        sym = moved(sym, C - (sx0 + sx1) / 2 * scale, C - (sy0 + sy1) / 2 * scale, scale)
        write(name, 128, 128, [Ring(C, C, R_OUT, SW, ink), Ring(C, C, R_IN, SW, ink), Fill(letters, ink)] + sym, bg)

    # app icons: Vault ground, cream coin, gilt lid; the symbol box at 62% of the icon, artwork centred
    for name, size, rx in (('app-icon-1024', 1024, 0), ('app-icon-1024-rounded', 1024, 225), ('app-icon-192', 192, 0)):
        sym = lid(INK_V, GILT_V, size=size * 0.62, thin=THIN)
        x0, y0, x1, y1 = bounds(sym)
        ground = f'<rect width="{size}" height="{size}" rx="{rx}" fill="{VAULT}"/>'
        items = moved(sym, (size - (x1 - x0)) / 2 - x0, (size - (y1 - y0)) / 2 - y0)

        class Raw:
            def svg(self): return ground
        write(name, size, size, [Raw()] + items)

    # screen cuts
    for H, opsz, small in ((32, 48, False), (22, 32, True)):
        for suffix, body, cap, ink, bg, thin in (('', INTAGLIO, GILT, INK, None, 0), ('-on-vault', INK_V, GILT_V, INK_V, VAULT, THIN)):
            w, items = screen_cut(H, opsz, small, body, cap, ink, thin)
            write(f'coveredmarket-lockup-{H}{suffix}', w, H, items, bg)

    embed_topbar()


def embed_topbar():
    """The components bundle's TopBar shows coveredmarket-lockup-32 inline (it is never on Vault); keep that copy in step."""
    import re, json
    svg = open(os.path.join(OUT, 'coveredmarket-lockup-32.svg')).read().strip()
    svg = svg.replace('<svg ', '<svg aria-hidden="true" focusable="false" ', 1)
    js = os.path.join(BRAND, 'components', 'bundle.js')
    src = open(js).read()
    line = '  var LOCKUP_32 = ' + json.dumps(svg) + ';  // generated by tools/gen_logos.py'
    src, n = re.subn(r'^  var LOCKUP_32 = .*$', lambda m: line, src, count=1, flags=re.M)
    if n != 1:
        raise SystemExit('bundle.js: no "var LOCKUP_32 =" line to update')
    open(js, 'w').write(src)


if __name__ == '__main__':
    main()
