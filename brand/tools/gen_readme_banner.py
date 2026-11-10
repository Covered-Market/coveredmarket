"""README banners (docs/readme/banner-paper.svg, banner-vault.svg): the X-header style, rosette from the top right.
Rasterise each SVG to a 2560x720 PNG beside it."""
import math, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
F='/Volumes/T7/Work/near-hackathon/coveredmarket/brand/fonts/'
_c={}
def font(n,ax):
    k=(n,tuple(sorted(ax.items())))
    if k not in _c: _c[k]=instancer.instantiateVariableFont(TTFont(F+n),ax)
    return _c[k]
def tp(txt,n,ax,size,x=0,y=0,tr=0):
    f=font(n,ax); gs=f.getGlyphSet(); cm=f.getBestCmap(); s=size/f['head'].unitsPerEm; pen=SVGPathPen(gs); cx=x
    for ch in txt:
        g=cm.get(ord(ch))
        if g is None: cx+=size*.25; continue
        gs[g].draw(TransformPen(pen,(s,0,0,-s,cx,y))); cx+=gs[g].width*s+tr*size
    return pen.getCommands(), cx-x
FR=('Fraunces-Variable.woff2',{'wght':500,'opsz':144,'SOFT':0,'WONK':0})
SN=('InstrumentSans-Variable.woff2',{'wght':450,'wdth':100})
W,H=2560,720
THEMES={
 'paper':dict(bg='#f2ead6',ink='#132a23',line2='#1f4f40',muted='#4f5f57',ros='#132a23',rop=.11,cap='#b88a2e',coin='#1f4f40'),
 'vault':dict(bg='#0f211b',ink='#ede4cc',line2='#d9b257',muted='#a7b3aa',ros='#d9b257',rop=.22,cap='#d9b257',coin='#ede4cc'),
}
def rosette(cx,cy,D,col,op,sw):
    k=D/480; R=236/1.14; out=[]
    for n,rx,ry,off in [(36,.98,.30,.16),(24,.72,.22,.42)]:
        for j in range(n):
            a=2*math.pi*j/n; pts=[]
            for i in range(180):
                t=2*math.pi*i/180; ex,ey=R*rx*math.cos(t)+R*off,R*ry*math.sin(t)
                pts.append(f'{cx+k*(ex*math.cos(a)-ey*math.sin(a)):.1f},{cy+k*(ex*math.sin(a)+ey*math.cos(a)):.1f}')
            out.append(f'<polygon points="{" ".join(pts)}"/>')
    return f'<g opacity="{op}" fill="none" stroke="{col}" stroke-width="{sw}">{"".join(out)}</g>'
def lid(x,y,size,body,cap):
    s=size/64; cx,cy,r=x+32*s,y+33.5*s,25*s; ch=cy-.5*r; hw=math.sqrt(r*r-(cy-ch)**2); gap=3.5*s
    return (f'<path fill="{body}" d="M{cx-hw:.2f},{ch:.2f} A{r:.2f},{r:.2f} 0 1 0 {cx+hw:.2f},{ch:.2f} Z"/>'
            f'<path fill="{cap}" d="M{cx-hw:.2f},{ch-gap:.2f} A{r:.2f},{r:.2f} 0 0 1 {cx+hw:.2f},{ch-gap:.2f} Z"/>')
for name,t in THEMES.items():
    b=f'<rect width="{W}" height="{H}" fill="{t["bg"]}"/>'
    D=1700; b+=rosette(W+.06*D,-.06*D,D,t['ros'],t['rop'],2.6)
    m=160
    # lockup: the Lid + wordmark, as on the site header
    b+=lid(m-8,82,96,t['coin'],t['cap'])
    wx=m+100; d1,w1=tp('Covered',*FR,64,wx,154); d2,_=tp('Market',*FR,64,wx+w1+.025*64,154)
    b+=f'<path fill="{t["ink"]}" d="{d1} {d2}"/>'
    # headline: two lines, the second in the accent, like the site hero
    d,_=tp('Earn on Bitcoin',*FR,150,m-6,372); b+=f'<path fill="{t["ink"]}" d="{d}"/>'
    d,_=tp('you still hold.',*FR,150,m-6,516); b+=f'<path fill="{t["line2"]}" d="{d}"/>'
    d,_=tp('Covered calls on native Bitcoin. No custodian, no bridge, no wrapper.',*SN,40,m,628); b+=f'<path fill="{t["muted"]}" d="{d}"/>'
    open(f'/Volumes/T7/Work/near-hackathon/coveredmarket/docs/readme/banner-{name}.svg','w').write(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">{b}</svg>')
    print(name)
