// README images: the banner (both themes) and product shots cropped from the scripted captures of the
// deployed app (scripts/shots/shots.mjs on the site/shots branch). Nothing here is a mock-up.
//
//   git fetch origin site/shots && git worktree add /tmp/shots origin/site/shots
//   SHOTS=/tmp/shots/site/shots node scripts/readme/build.mjs
//
// Needs Playwright (cd e2e && npm ci). Set CHROME=/path/to/chrome to use an installed browser.
// Then shrink the PNGs with any quantiser (e.g. pngquant --skip-if-larger --ext .png docs/readme/*.png).
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { chromium } = createRequire(resolve(root, "e2e/package.json"))("playwright");
const OUT = resolve(root, "docs/readme");
const SHOTS = resolve(process.env.SHOTS ?? resolve(root, "site/shots"));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

// 1. Banner, 1280×360 at 2×.
for (const theme of ["paper", "vault"]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 360 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(resolve(root, "scripts/readme/banner.html")).href + `?theme=${theme}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/banner-${theme}.png` });
  await page.close();
  console.log(`banner-${theme}.png`);
}

// GitHub social preview (Settings → General → Social preview), 1280×640, from the brand's OG image.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  const svg = readFileSync(resolve(root, "brand/assets/Social/og-image-1200x630.svg")).toString("base64");
  await page.setContent(`<body style="margin:0;background:#0f211b;display:grid;place-items:center;height:640px">
    <img style="height:640px" src="data:image/svg+xml;base64,${svg}"></body>`);
  await page.waitForLoadState("load");
  await page.screenshot({ path: `${OUT}/social-preview.png` });
  await page.close();
  console.log("social-preview.png");
}

// 2. Product shots: [output, source, crop {x, y, w, h} in source pixels, output width].
const shots = [
  ["shot-certificate-paper", "cert-sold-paper-desktop-full", { x: 0, y: 0, w: 2880, h: 1960 }, 1600],
  ["shot-certificate-vault", "cert-sold-vault-desktop-full", { x: 0, y: 0, w: 2880, h: 1960 }, 1600],
  ["shot-sell", "sell-paper-desktop", { x: 0, y: 0, w: 2880, h: 1800 }, 1200],
  ["shot-try", "try-paper-desktop", { x: 0, y: 0, w: 2880, h: 1800 }, 1200],
];
for (const [name, src, c, width] of shots) {
  const file = `${SHOTS}/${src}.png`;
  if (!existsSync(file)) { console.log(`skip ${name}: no ${file}`); continue; }
  const s = width / c.w, height = Math.round(c.h * s);
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;overflow:hidden"><img src="data:image/png;base64,${readFileSync(file).toString("base64")}"
    style="position:absolute;left:${-c.x * s}px;top:${-c.y * s}px;width:${2880 * s}px;image-rendering:auto"></body>`);
  await page.waitForLoadState("load");
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.close();
  console.log(`${name}.png ${width}×${height}`);
}
await browser.close();
