// Draws a small bouncing-ball animation through the real UI and saves
// docs/screenshot.png and docs/demo.gif for the README.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const url = process.argv[2] || 'http://localhost:4173/';
const docs = fileURLToPath(new URL('../docs/', import.meta.url));
const lang = process.env.DEMO_LANG || 'tr-TR';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: lang, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(url);
await page.click('.big-btn.primary');
await page.fill('.dialog input.input', lang.startsWith('tr') ? 'Zıplayan top' : 'Bouncing ball');
await page.click('.dialog .btn-primary');
await page.waitForSelector('.editor .viewport');
await page.waitForTimeout(400);

// Work in project coordinates: map 1280x720 project space to the viewport.
const geo = await page.evaluate(() => {
  const st = document.querySelector('.stage').getBoundingClientRect();
  return { x: st.x, y: st.y, s: st.width / 1280 };
});
const P = (x, y) => [geo.x + x * geo.s, geo.y + y * geo.s];
async function stroke(pts) {
  await page.mouse.move(...P(...pts[0]));
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...P(...p), { steps: 3 });
  await page.mouse.up();
}
const circle = (cx, cy, rx, ry, n = 40) =>
  Array.from({ length: n + 1 }, (_, i) => [cx + rx * Math.cos((i / n) * 2 * Math.PI), cy + ry * Math.sin((i / n) * 2 * Math.PI)]);
async function color(hex) {
  await page.click('.swatch-btn');
  await page.click(`.color-swatch[title="${hex}"]`);
}
async function tool(key) {
  await page.keyboard.press(key);
}
async function size(v) {
  await page.evaluate((v) => {
    const s = document.querySelector('.optionsbar input[type=range]');
    s.value = String(v);
    s.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
}
async function fillAt(x, y, hex) {
  await color(hex);
  await tool('g');
  await page.mouse.click(...P(x, y));
  await tool('b');
}

// Background layer: sky, hill, sun.
await size(10);
await color('#30a46c');
await stroke([[-10, 560], [200, 520], [420, 545], [700, 505], [980, 540], [1300, 520]]);
await fillAt(640, 680, '#8bd448');
await fillAt(640, 100, '#c9f2ff');
await color('#ffc53d');
await stroke(circle(1120, 120, 60, 60));
await fillAt(1120, 120, '#ffc53d');

// Ball layer.
await page.click('.panel-foot .icon-btn:first-child');
await page.waitForTimeout(150);
const balls = [
  [260, 150, 70, 70],
  [400, 330, 66, 74],
  [520, 470, 86, 50],
  [650, 300, 66, 74],
  [780, 170, 70, 70],
];
for (let i = 0; i < balls.length; i++) {
  if (i > 0) {
    await page.keyboard.press('d');
    await page.waitForTimeout(150);
    // Clear the ball layer on the duplicated frame.
    await page.click('.layer-row.selected .icon-btn:last-child');
    await page.locator('.popover .menu-item').nth(5).click();
    await page.waitForTimeout(100);
  }
  const [x, y, rx, ry] = balls[i];
  await size(8);
  await color('#1f2430');
  await stroke(circle(x, y, rx, ry));
  await stroke([[x - rx * 1.08, y - ry * 0.05], [x - rx * 0.4, y + ry * 0.2], [x + rx * 0.4, y + ry * 0.2], [x + rx * 1.08, y - ry * 0.05]]);
  await fillAt(x, y - ry * 0.5, '#e5484d');
  await fillAt(x, y + ry * 0.6, '#ffffff');
  await size(8);
}
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
await page.mouse.move(geo.x + 5, geo.y - 60);
await page.screenshot({ path: `${docs}screenshot.png` });
console.log('screenshot saved');

// Export GIF at 50%.
await page.click('.export-btn');
await page.locator('.format-card', { hasText: 'GIF' }).click();
await page.locator('.segmented button', { hasText: '50%' }).click();
await page.click('.dialog-body .btn-primary');
await page.waitForSelector('img.export-preview', { timeout: 60000 });
const gif = await page.evaluate(async () => {
  const img = document.querySelector('img.export-preview');
  return Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer()));
});
writeFileSync(`${docs}demo.gif`, Buffer.from(gif));
console.log('gif saved', gif.length);
await browser.close();
