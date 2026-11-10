// README images: the banner (both themes) and the GitHub social preview.
//
//   node scripts/readme/build.mjs
//
// Needs Playwright (cd e2e && npm ci). Set CHROME=/path/to/chrome to use an installed browser.
// Then shrink the PNGs with any quantiser (e.g. pngquant --skip-if-larger --ext .png docs/readme/*.png).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { chromium } = createRequire(resolve(root, "e2e/package.json"))("playwright");
const OUT = resolve(root, "docs/readme");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

// Banner, 1280×360 at 2×.
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

await browser.close();
