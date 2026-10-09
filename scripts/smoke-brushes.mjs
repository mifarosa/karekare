// Draws one stroke with every brush and checks picker, presets and undo.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const url = process.argv[2] || 'http://localhost:4173/';
const out = fileURLToPath(new URL('./out/', import.meta.url));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'tr-TR' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const cdp = await context.newCDPSession(page);
const assert = (cond, msg) => {
  if (!cond) errors.push(`ASSERT: ${msg}`);
  console.log(cond ? '  ✓' : '  ✗', msg);
};
const livePixels = () =>
  page.evaluate(() => {
    const c = document.querySelector('.layer-canvas.live');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  });

await page.goto(url);
await page.click('.big-btn.primary');
await page.click('.dialog .btn-primary');
await page.waitForSelector('.editor .viewport');
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));

// Map project coordinates (1280x720) to the screen.
const geo = await page.evaluate(() => {
  const r = document.querySelector('.stage').getBoundingClientRect();
  return { x: r.x, y: r.y, s: r.width / 1280 };
});
const P = (x, y) => [geo.x + x * geo.s, geo.y + y * geo.s];

async function pickBrush(i) {
  await page.click('.brush-chip');
  await page.waitForSelector('.brush-grid');
  const n = await page.locator('.brush-card').count();
  await page.locator('.brush-card').nth(i).click();
  await page.waitForTimeout(80);
  return n;
}

async function penStroke(points) {
  const send = (type, [x, y], force, buttons) =>
    cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1, pointerType: 'pen', force });
  await send('mouseMoved', points[0], 0, 0);
  await send('mousePressed', points[0], 0.2, 1);
  for (let i = 1; i < points.length; i++) await send('mouseMoved', points[i], 0.2 + 0.8 * Math.sin((i / points.length) * Math.PI), 1);
  await send('mouseReleased', points[points.length - 1], 0, 0);
}

// Open the picker once for a screenshot.
await page.click('.brush-chip');
await page.waitForSelector('.brush-grid');
await page.waitForTimeout(300);
const total = await page.locator('.brush-card').count();
assert(total === 16, `picker lists ${total} brushes`);
await page.screenshot({ path: `${out}30-brush-picker.png` });
await page.keyboard.press('Escape');

const colors = ['#e5484d', '#3e63dd', '#30a46c', '#8e4ec6'];
let px = await livePixels();
for (let i = 0; i < total; i++) {
  await pickBrush(i);
  const name = (await page.textContent('.brush-chip span')).trim();
  // A bright color per row so textures show up.
  await page.click('.swatch-btn');
  await page.click(`.color-swatch[title="${colors[Math.floor(i / 4)]}"]`);
  const col = i % 4;
  const row = Math.floor(i / 4);
  const x0 = 40 + col * 310;
  const y0 = 90 + row * 175;
  const pts = Array.from({ length: 24 }, (_, k) => P(x0 + k * 10, y0 + Math.sin(k / 3.5) * 35));
  await penStroke(pts);
  await page.waitForTimeout(60);
  const now = await livePixels();
  assert(now > px, `${name} draws (+${now - px} px)`);
  px = now;
}
await page.mouse.move(geo.x - 30, geo.y - 30);
await page.screenshot({ path: `${out}31-all-brushes.png` });

// Spray keeps painting while held still.
const sprayIndex = 9;
await pickBrush(sprayIndex);
assert((await page.textContent('.brush-chip span')).includes('Sprey'), 'spray selected');
const [sx, sy] = P(1180, 660);
await page.mouse.move(sx, sy);
await page.mouse.down();
await page.waitForTimeout(80);
const a = await livePixels();
await page.waitForTimeout(500);
const b = await livePixels();
await page.mouse.up();
assert(b > a, `spray builds up while held still (${a} -> ${b})`);

// Size is remembered per brush.
await page.evaluate(() => {
  const s = document.querySelector('.optionsbar input[type=range]');
  s.value = '120';
  s.dispatchEvent(new Event('input', { bubbles: true }));
});
await pickBrush(0);
const penSize = await page.$eval('.optionsbar input[type=range]', (e) => e.value);
await pickBrush(sprayIndex);
const spraySize = await page.$eval('.optionsbar input[type=range]', (e) => e.value);
assert(penSize !== '120' && spraySize === '120', `per-brush size memory (pen ${penSize}, spray ${spraySize})`);

// Undo removes the last stroke.
const beforeUndo = await livePixels();
await page.keyboard.press('Control+z');
await page.waitForTimeout(250);
assert((await livePixels()) < beforeUndo, 'undo removes the last stroke');

// Tapping the active brush tool opens the picker too.
await page.click('.toolbar .tool-btn >> nth=0');
assert(await page.isVisible('.brush-grid'), 'tapping the active brush tool opens the picker');
await page.keyboard.press('Escape');

// Export still works with all brushes.
await page.waitForFunction(() => document.querySelector('.save-state')?.dataset.state === 'saved', null, { timeout: 15000 });
await page.click('.export-btn');
await page.locator('.format-card', { hasText: 'GIF' }).click();
await page.click('.dialog-body .btn-primary');
await page.waitForSelector('.export-preview, .error-text', { timeout: 60000 });
assert(await page.isVisible('.export-preview'), 'GIF export works');

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'all good');
await browser.close();
