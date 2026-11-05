"""The Lid: Covered's mark. One coin, its top lifted off. Geometry on a 64 grid, scaled by size."""
import math

PAPER = '#f2ead6'; VAULT = '#0f211b'; INK = '#132a23'; INK_V = '#ede4cc'
INTAGLIO = '#1f4f40'; INTAGLIO_V = '#4a9a7e'; GILT = '#b88a2e'; GILT_V = '#d9b257'
COPPER = '#b3612c'; COPPER_V = '#d88a54'; DEEP = '#143a2f'

def lid(x=0, y=0, size=64, body=INK, cap=None, state='open', small=False, thin=0.0):
    """state: 'open' (lid lifted, the default), 'kept' (lid down, a seam), 'exercised' (lid lifted high).
    small: a cut for 24px and below (bigger gap, lower chord). thin: shrink by this fraction (reversed versions)."""
    s = size / 64.0
    cap = cap or body
    cx, cy, r = x + 32 * s, y + 33.5 * s, 25 * s * (1 - thin)
    k = 0.45 if small else 0.5          # chord height as a fraction of r
    gap = (5.0 if small else 3.5) * s
    if state == 'kept': gap = (2.2 if small else 1.4) * s
    if state == 'exercised': gap = (9 if small else 7) * s
    ch = cy - k * r
    hw = math.sqrt(r * r - (cy - ch) ** 2)
    body_d = f'M{cx-hw:.2f},{ch:.2f} A{r:.2f},{r:.2f} 0 1 0 {cx+hw:.2f},{ch:.2f} Z'
    lid_d = f'M{cx-hw:.2f},{ch-gap:.2f} A{r:.2f},{r:.2f} 0 0 1 {cx+hw:.2f},{ch-gap:.2f} Z'
    return f'<path fill="{body}" d="{body_d}"/><path fill="{cap}" d="{lid_d}"/>'

def svg(w, h, inner, bg=None, title='Covered'):
    bgr = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{title}">{bgr}{inner}</svg>'

if __name__ == '__main__':
    import os
    os.makedirs('previews', exist_ok=True)
    rows = []
    # colourways on paper
    ways = [('ink', INK, None), ('intaglio', INTAGLIO, None), ('intaglio + gilt lid', INTAGLIO, GILT), ('copper + intaglio lid', COPPER, INTAGLIO), ('copper + gilt lid', COPPER, GILT), ('intaglio + copper lid', INTAGLIO, COPPER)]
    cells = ''
    for i, (n, b, c) in enumerate(ways):
        cells += f'<g transform="translate({20+i*150},20) scale(2)">' + lid(body=b, cap=c) + '</g>'
    # on vault
    waysv = [('cream', INK_V, None), ('gilt lid', INK_V, GILT_V), ('copper + gilt', COPPER_V, GILT_V), ('green + gilt', INTAGLIO_V, GILT_V), ('copper + cream', COPPER_V, INK_V), ('thin cream', INK_V, None)]
    cellsv = ''
    for i, (n, b, c) in enumerate(waysv):
        cellsv += f'<g transform="translate({20+i*150},190) scale(2)">' + lid(body=b, cap=c, thin=(0.03 if n=='thin cream' else 0)) + '</g>'
    # states
    st = ''
    for i, s_ in enumerate(('open', 'kept', 'exercised')):
        st += f'<g transform="translate({20+i*110},360) scale(1.5)">' + lid(body=INTAGLIO, cap=GILT, state=s_) + '</g>'
    # small cuts
    sm = ''
    for i, (sz, small) in enumerate(((48, False), (32, False), (24, True), (16, True), (16, False))):
        sm += f'<g transform="translate({420+i*60},380)">' + lid(size=sz, body=INK, small=small) + '</g>'
    sheet = f'<svg xmlns="http://www.w3.org/2000/svg" width="920" height="480"><rect width="920" height="170" fill="{PAPER}"/><rect y="170" width="920" height="170" fill="{VAULT}"/><rect y="340" width="920" height="140" fill="{PAPER}"/>{cells}{cellsv}{st}{sm}</svg>'
    open('previews/lid-colour.svg', 'w').write(sheet)
