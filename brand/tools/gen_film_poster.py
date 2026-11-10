"""The film's poster, as SVG with every letter outlined (no fonts needed to show it).

The landing page lays a play button over the centre of the poster, so the centre is kept empty: the lockup sits
top left, the title and line bottom left, the address top right. Uses gen_logos' text and lockup helpers, so the
type matches the logos exactly.

    python tools/gen_film_poster.py   ->  assets/Social/film-poster.svg and web/public/site/film/poster.svg
"""
import os
import shutil

import gen_logos as g

W, H, M = 1280, 720, 88          # canvas and the margin everything aligns to
FRAME = '#2f4d43'                 # Vault rule


def main():
    items = []
    # lockup, top left: the on-Vault colours, 48 tall
    lock = g.lockup_items(g.INK_V, g.GILT_V, g.INK_V, g.THIN)
    x0, y0, _, _ = g.bounds(lock)
    items += g.moved(lock, M - x0 * 0.75, M - y0 * 0.75, 0.75)

    # the address, top right, on the lockup's centre line
    lx0, ly0, lx1, ly1 = g.bounds(items)
    addr, aw = g.shape('COVERED.MARKET', g.font(g.SANS, {'wght': 600}), 15, 0, 0, 0.14)
    a = g.Fill(g.clean(addr), '#a7b3aa')
    ax0, ay0, ax1, ay1 = a.bounds()
    items.append(a.moved(W - M - ax1, (ly0 + ly1) / 2 - (ay0 + ay1) / 2))

    # title and line, bottom left
    title, _ = g.shape('From offer to settlement.', g.fraunces(144, 420), 76, 0, 0, -0.01)
    t = g.Fill(g.clean(title), g.INK_V)
    line, _ = g.shape('One covered call on native Bitcoin.', g.font('Fraunces-Italic-Variable.woff2', {'wght': 400, 'opsz': 48}), 30, 0, 0)
    l = g.Fill(g.clean(line), g.GILT_V)
    lb = l.bounds(); tb = t.bounds()
    line_y = H - M - lb[3]
    items.append(l.moved(M - lb[0], line_y))
    items.append(t.moved(M - tb[0], line_y + lb[1] - 22 - tb[3]))

    frame = f'<rect x="42" y="42" width="{W - 84}" height="{H - 84}" fill="none" stroke="{FRAME}" stroke-width="1.5"/>'
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
           f'<rect width="{W}" height="{H}" fill="{g.VAULT}"/>{frame}' + ''.join(i.svg() for i in items) + '</svg>')
    out = os.path.join(g.BRAND, 'assets', 'Social', 'film-poster.svg')
    with open(out, 'w') as fh:
        fh.write(svg)
    web = os.path.join(os.path.dirname(g.BRAND), 'web', 'public', 'site', 'film', 'poster.svg')
    shutil.copyfile(out, web)
    print(out, len(svg), 'bytes; copied to', web)


if __name__ == '__main__':
    main()
