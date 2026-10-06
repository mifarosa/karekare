// Renders PWA icons from public/icons/icon.svg using the preinstalled Chromium.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const svg = readFileSync(`${root}public/icons/icon.svg`, 'utf8');
// Full-bleed square variant: iOS and maskable icons get their own rounding.
const square = svg.replace('rx="116"', 'rx="0"');
const maskable = square.replace('<rect x="84"', '<g transform="translate(256 256) scale(.78) translate(-256 -256)"><rect x="84"').replace('</svg>', '</g></svg>');

const jobs = [
  { file: 'icon-192.png', size: 192, src: svg },
  { file: 'icon-512.png', size: 512, src: svg },
  { file: 'maskable-512.png', size: 512, src: maskable },
  { file: 'apple-touch-icon.png', size: 180, src: square },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const j of jobs) {
  await page.setViewportSize({ width: j.size, height: j.size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${j.src.replace('<svg ', `<svg width="${j.size}" height="${j.size}" `)}</body></html>`);
  await page.screenshot({ path: `${root}public/icons/${j.file}`, omitBackground: true });
  console.log('wrote', j.file);
}
await browser.close();
