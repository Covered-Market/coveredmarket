/** Engraved patterns for the landing page, drawn by code from the brand's guilloche formula (brand/tools/gen_assets.py).
 *  Everything here is decorative (aria-hidden) and coloured by `currentColor`, so a pattern takes ink on paper and
 *  gilt on vault from its parent. Removing this file and its call sites in Landing.tsx (marked "patterns-v1")
 *  returns the page to how it was. */
import { useMemo } from "react";

type Family = [count: number, rx: number, ry: number, off: number];
const BRAND: Family[] = [[36, 0.98, 0.3, 0.16], [24, 0.72, 0.22, 0.42]];
const REACH = 1.14;

/** One rosette in a 480 box, as in /site/rosette.svg. */
function rosettePolys(fams: Family[], steps = 120): string[] {
  const R = 236 / REACH;
  const out: string[] = [];
  for (const [count, rx, ry, off] of fams) {
    for (let k = 0; k < count; k++) {
      const a = (2 * Math.PI * k) / count;
      const pts: string[] = [];
      for (let i = 0; i < steps; i++) {
        const t = (2 * Math.PI * i) / steps;
        const ex = R * rx * Math.cos(t) + R * off, ey = R * ry * Math.sin(t);
        pts.push(`${(240 + ex * Math.cos(a) - ey * Math.sin(a)).toFixed(1)},${(240 + ex * Math.sin(a) + ey * Math.cos(a)).toFixed(1)}`);
      }
      out.push(pts.join(" "));
    }
  }
  return out;
}

export function Rosette({ fams = BRAND, sw = 0.9, className, style }: { fams?: Family[]; sw?: number; className?: string; style?: React.CSSProperties }) {
  const polys = useMemo(() => rosettePolys(fams), [fams]);
  return (
    <svg className={className} style={style} viewBox="0 0 480 480" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth={sw}>{polys.map((p, i) => <polygon key={i} points={p} />)}</g>
    </svg>
  );
}

/** A rosette unique to a serial: ring counts and offsets come from a small hash, the way a banknote's guilloche is its own. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function serialFamilies(serial: string): Family[] {
  const h = hash(serial);
  const pick = (shift: number, lo: number, hi: number) => lo + (((h >>> shift) & 0xff) / 255) * (hi - lo);
  return [
    [Math.round(pick(0, 18, 40)), 0.98, pick(8, 0.22, 0.36), pick(16, 0.08, 0.24)],
    [Math.round(pick(24, 12, 28)), pick(4, 0.6, 0.8), pick(12, 0.16, 0.28), pick(20, 0.34, 0.5)],
  ];
}
export function SerialRosette({ serial, size = 56 }: { serial: string; size?: number }) {
  const fams = useMemo(() => serialFamilies(serial), [serial]);
  return <Rosette fams={fams} sw={2.2} style={{ width: size, height: size, display: "block" }} />;
}

/** Seam medallion: a small seal sitting on the border between two sections, carrying the section's number.
 *  Always drawn on paper, so it reads the same whether the section below is paper or vault. */
export function Seam({ n }: { n: string }) {
  return (
    <div className="pt-seam" data-theme="paper" aria-hidden="true">
      <Rosette fams={[[24, 0.98, 0.3, 0.16]]} sw={2.4} className="pt-seam-ros" />
      <span className="pt-seam-n">{n}</span>
    </div>
  );
}

/** Lathe waves: parallel engraved lines that swell around one point, like the field behind a banknote portrait. */
export function Lathe({ w = 1200, h = 520, cx = 0.78, cy = 0.5, gap = 7, amp = 34 }: { w?: number; h?: number; cx?: number; cy?: number; gap?: number; amp?: number }) {
  const paths = useMemo(() => {
    const out: string[] = [];
    const X = w * cx, Y = h * cy, s2 = (Math.min(w, h) * 0.45) ** 2;
    for (let y0 = -amp; y0 <= h + amp; y0 += gap) {
      let d = "";
      for (let x = 0; x <= w; x += 6) {
        const dd = (x - X) ** 2 + (y0 - Y) ** 2;
        const b = amp * Math.exp(-dd / s2);
        const y = y0 + b * Math.sin(x / 18 + y0 / 40);
        d += `${x ? "L" : "M"}${x},${y.toFixed(1)}`;
      }
      out.push(d);
    }
    return out;
  }, [w, h, cx, cy, gap, amp]);
  return (
    <svg className="pt-lathe" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth={0.7}>{paths.map((d, i) => <path key={i} d={d} />)}</g>
    </svg>
  );
}
