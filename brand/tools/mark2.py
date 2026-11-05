"""Engraved mark v2 for Covered, plus a kerned wordmark via HarfBuzz."""
import math, os
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(ROOT, 'fonts')

PAPER = '#f2ead6'; VAULT = '#0f211b'; INK = '#132a23'; INK_V = '#ede4cc'
INTAGLIO = '#1f4f40'; GILT = '#b88a2e'; GILT_V = '#d9b257'; COPPER = '#b3612c'; COPPER_V = '#d88a54'

# ---------- shaped text ----------
_inst = {}
def instance(name, axes):
    key = (name, tuple(sorted(axes.items())))
    if key not in _inst:
        f = TTFont(os.path.join(FONTS, name)); f = instancer.instantiateVariableFont(f, axes)
        buf = f.getTableData if False else None
        import io
        bio = io.BytesIO(); f.save(bio); _inst[key] = (f, bio.getvalue())
    return _inst[key]

def shaped_path(txt, name, axes, size, x=0, y=0, tracking=0.0, features=None):
    f, data = instance(name, axes)
    face = hb.Face(data); font = hb.Font(face); upm = face.upem; font.scale = (upm, upm)
    buf = hb.Buffer(); buf.add_str(txt); buf.guess_segment_properties()
    hb.shape(font, buf, features or {"kern": True, "liga": True})
    gs = f.getGlyphSet(); order = f.getGlyphOrder(); s = size / upm
    pen = SVGPathPen(gs); cx = x
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        g = order[info.codepoint]
        tp = TransformPen(pen, (s, 0, 0, -s, cx + pos.x_offset * s, y - pos.y_offset * s))
        gs[g].draw(tp)
        cx += pos.x_advance * s + tracking * size
    return pen.getCommands(), cx - x

FRAUNCES = ('Fraunces[SOFT,WONK,opsz,wght].ttf', {'wght': 480, 'opsz': 144, 'SOFT': 0, 'WONK': 0})
FRAUNCES_IT = ('Fraunces-Italic[SOFT,WONK,opsz,wght].ttf', {'wght': 400, 'opsz': 72, 'SOFT': 0, 'WONK': 0})
SANS = ('InstrumentSans[wdth,wght].ttf', {'wght': 500, 'wdth': 100})
SANS_B = ('InstrumentSans[wdth,wght].ttf', {'wght': 600, 'wdth': 100})

# ---------- the engraved mark ----------
def mark(x=0, y=0, size=64, ink=INK, gilt=None, copper=None, detail='full'):
    """An engraved coin. Field line-shaded with curved engraving lines that tighten toward the rim,
    the segment above the strike cross-hatched, a milled edge, the strike as a double rule with a gilt fillet.
    detail: 'full' (>=48px), 'reduced' (24-48px), 'glyph' (<24px: solid cap, single rule, plain rim)."""
    s = size / 64.0
    cx, cy = x + 32 * s, y + 32 * s
    R = 27.2 * s                      # outer rim
    r = 25.0 * s                      # field radius (inside the milling)
    chord = cy - r * 0.40             # strike height
    half = math.sqrt(r * r - (cy - chord) ** 2)
    uid = f'm{abs(hash((x, y, size, detail))) % 100000}'
    out = [f'<defs><clipPath id="{uid}f"><circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r:.2f}"/></clipPath>'
           f'<clipPath id="{uid}c"><rect x="{cx-r:.2f}" y="{cy-r:.2f}" width="{2*r:.2f}" height="{chord-(cy-r):.2f}"/></clipPath>'
           f'<clipPath id="{uid}b"><rect x="{cx-r:.2f}" y="{chord:.2f}" width="{2*r:.2f}" height="{cy+r-chord:.2f}"/></clipPath></defs>']
    if copper:
        out.append(f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r:.2f}" fill="{copper}"/>')
    hair = max(0.45 * s, 0.5)
    if detail == 'glyph':
        # small: a solid cap, one rule, a plain ring
        out.append(f'<path d="M{cx-half:.2f},{chord:.2f} A{r:.2f},{r:.2f} 0 0 1 {cx+half:.2f},{chord:.2f} Z" fill="{ink}"/>')
        out.append(f'<line x1="{cx-half:.2f}" y1="{chord:.2f}" x2="{cx+half:.2f}" y2="{chord:.2f}" stroke="{gilt or ink}" stroke-width="{2.2*s:.2f}"/>')
        out.append(f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{R-1.2*s:.2f}" fill="none" stroke="{ink}" stroke-width="{2.4*s:.2f}"/>')
        return '<g>' + ''.join(out) + '</g>'
    # --- field: latitude lines of a sphere seen slightly from above (ellipse arcs), thin at the
    # highlight (upper left) and heavier toward the lower rim, so the coin reads as relief.
    field = []
    n = 15 if detail == 'full' else 12
    tilt = 0.28
    for i in range(n):
        t = (i + 0.5) / n
        phi = -math.pi/2 + math.pi * t               # -90..90 latitude
        yy = cy + r * math.sin(phi)
        if yy < chord + 3.5 * s: continue
        hw = r * math.cos(phi)                       # half width at that latitude
        ry = hw * tilt                               # vertical radius of the ellipse arc
        w = hair * (0.35 + 0.55 * t)                 # tone: heavier lower
        field.append(f'<path d="M{cx-hw:.2f},{yy:.2f} A{hw:.2f},{ry:.2f} 0 0 0 {cx+hw:.2f},{yy:.2f}" fill="none" stroke="{ink}" stroke-width="{w:.2f}"/>')
    if detail == 'full':
        out.append(f'<g clip-path="url(#{uid}f)"><g clip-path="url(#{uid}b)">{"".join(field)}</g></g>')
    # --- cap: cross-hatch, fine, two weights
    cap = []
    pitch = (2.1 if detail == 'full' else 3.2) * s
    k = int((2 * r) / pitch) + 8
    for i in range(-k, k):
        x0 = cx - r + i * pitch
        cap.append(f'<line x1="{x0:.2f}" y1="{chord+2:.2f}" x2="{x0 + (chord - (cy-r) + 2)*0.7:.2f}" y2="{cy-r-2:.2f}" stroke="{ink}" stroke-width="{hair*1.0:.2f}"/>')
        cap.append(f'<line x1="{x0:.2f}" y1="{cy-r-2:.2f}" x2="{x0 + (chord-(cy-r)+2)*0.7:.2f}" y2="{chord+2:.2f}" stroke="{ink}" stroke-width="{hair*0.7:.2f}"/>')
    out.append(f'<g clip-path="url(#{uid}f)"><g clip-path="url(#{uid}c)">{"".join(cap)}</g></g>')
    # --- strike: an ink rule; in two-tone a paper glint and a gilt fillet above it
    out.append(f'<line x1="{cx-half:.2f}" y1="{chord:.2f}" x2="{cx+half:.2f}" y2="{chord:.2f}" stroke="{ink}" stroke-width="{1.5*s:.2f}"/>')
    if gilt:
        out.append(f'<line x1="{cx-half+0.4*s:.2f}" y1="{chord-1.5*s:.2f}" x2="{cx+half-0.4*s:.2f}" y2="{chord-1.5*s:.2f}" stroke="{PAPER if not copper else PAPER}" stroke-width="{1.0*s:.2f}"/>')
        out.append(f'<line x1="{cx-half+0.8*s:.2f}" y1="{chord-2.7*s:.2f}" x2="{cx+half-0.8*s:.2f}" y2="{chord-2.7*s:.2f}" stroke="{gilt}" stroke-width="{1.4*s:.2f}"/>')
    else:
        out.append(f'<line x1="{cx-half+0.6*s:.2f}" y1="{chord-2.2*s:.2f}" x2="{cx+half-0.6*s:.2f}" y2="{chord-2.2*s:.2f}" stroke="{ink}" stroke-width="{hair:.2f}"/>')
    # --- rim: an inner hairline, a reeded edge of fine ticks, a heavier outer line
    out.append(f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r:.2f}" fill="none" stroke="{ink}" stroke-width="{0.9*s:.2f}"/>')
    ticks = []
    nt = 120 if detail == 'full' else 60
    for i in range(nt):
        a = 2 * math.pi * i / nt
        x1, y1 = cx + (r + 0.7*s) * math.cos(a), cy + (r + 0.7*s) * math.sin(a)
        x2, y2 = cx + (R - 0.7*s) * math.cos(a), cy + (R - 0.7*s) * math.sin(a)
        ticks.append(f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" stroke="{ink}" stroke-width="{hair:.2f}"/>')
    out.append(''.join(ticks))
    out.append(f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{R:.2f}" fill="none" stroke="{ink}" stroke-width="{1.3*s:.2f}"/>')
    return '<g>' + ''.join(out) + '</g>'

def svg(w, h, body, bg=None):
    bgr = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{bgr}{body}</svg>'

def wordmark(x, y, size, ink, caps=False):
    if caps:
        d, w = shaped_path('COVERED', *FRAUNCES, size * 0.78, x, y, tracking=0.14)
    else:
        d, w = shaped_path('Covered', *FRAUNCES, size, x, y, tracking=-0.004)
    return f'<path d="{d}" fill="{ink}"/>', w

if __name__ == '__main__':
    os.makedirs('previews', exist_ok=True)
    sheet = svg(900, 420, (
        f'<rect width="900" height="420" fill="{PAPER}"/>'
        + f'<g transform="translate(20,20) scale(4)">' + mark(ink=INK) + '</g>'
        + f'<g transform="translate(300,20) scale(4)">' + mark(ink=INTAGLIO, gilt=GILT, copper=COPPER) + '</g>'
        + f'<g transform="translate(580,20) scale(1.5)">' + mark(ink=INK, detail='reduced') + '</g>'
        + f'<g transform="translate(700,20) scale(0.75)">' + mark(ink=INK, detail='reduced') + '</g>'
        + f'<g transform="translate(760,20) scale(0.375)">' + mark(ink=INK, detail='glyph') + '</g>'
        + f'<g transform="translate(790,20) scale(0.25)">' + mark(ink=INK, detail='glyph') + '</g>'
        + f'<g transform="translate(580,150)">' + wordmark(0, 60, 64, INK)[0] + '</g>'
        + f'<g transform="translate(580,250)">' + wordmark(0, 40, 48, INK, caps=True)[0] + '</g>'
        + f'<rect x="0" y="300" width="900" height="120" fill="{VAULT}"/>'
        + f'<g transform="translate(20,314) scale(1.5)">' + mark(ink=INK_V, gilt=GILT_V, copper=COPPER_V) + '</g>'
        + f'<g transform="translate(150,314)">' + wordmark(0, 70, 72, INK_V)[0] + '</g>'
    ))
    open('previews/mark2.svg', 'w').write(sheet)
