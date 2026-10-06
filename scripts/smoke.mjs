// End-to-end smoke test against a running preview server.
// Usage: node scripts/smoke.mjs [url]
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const url = process.argv[2] || 'http://localhost:4173/';
const out = fileURLToPath(new URL('./out/', import.meta.url));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'tr-TR', acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

const shot = (name) => page.screenshot({ path: `${out}${name}.png` });
const step = (s) => console.log('•', s);

await page.goto(url);
await page.waitForSelector('.home');
await shot('01-home');
step('home loaded');

await page.click('.big-btn.primary');
await page.waitForSelector('.dialog');
await shot('02-new-dialog');
await page.click('.dialog .btn-primary');
await page.waitForSelector('.editor .viewport');
await page.waitForTimeout(400);
step('editor opened');

const box = await page.locator('.viewport').boundingBox();
async function stroke(points) {
  await page.mouse.move(box.x + points[0][0], box.y + points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + x, box.y + y, { steps: 4 });
  await page.mouse.up();
}
function circle(cx, cy, r, n = 24) {
  return Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos((i / n) * Math.PI * 2), cy + r * Math.sin((i / n) * Math.PI * 2)]);
}

// Frame 1: a ball
await stroke(circle(400, 300, 60));
await stroke([[300, 420], [700, 420]]);
step('drew frame 1');

// Fill the ball
await page.keyboard.press('g');
await page.mouse.click(box.x + 400, box.y + 300);
await page.keyboard.press('b');
step('filled');

// Frame 2
await page.keyboard.press('n');
await page.waitForTimeout(200);
await stroke(circle(480, 240, 60));
await stroke([[300, 420], [700, 420]]);
step('drew frame 2');

// Frame 3 via duplicate + erase
await page.keyboard.press('d');
await page.waitForTimeout(200);
await page.keyboard.press('e');
await stroke([[440, 200], [520, 280]]);
await page.keyboard.press('b');
step('duplicated + erased frame 3');

// New layer and draw on it
await page.click('.panel-foot .icon-btn:first-child');
await page.waitForTimeout(200);
await stroke([[200, 150], [260, 120], [320, 160]]);
step('layer 2 drawn');

await page.waitForTimeout(600);
await shot('03-editor');

// Undo / redo
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(150);
step('undo/redo');

// Go to frame 1 and check onion/thumb rendering
await page.locator('.tl-frame').nth(0).click();
await page.waitForTimeout(300);
await shot('04-frame1');

// Play
await page.keyboard.press('Enter');
await page.waitForTimeout(700);
await shot('05-playing');
await page.keyboard.press('Enter');
step('played');

// Wait for autosave
await page.waitForFunction(() => document.querySelector('.save-state')?.getAttribute('data-state') === 'saved', null, { timeout: 10000 });
step('autosaved');

async function exportAs(label) {
  await page.click('.export-btn');
  await page.waitForSelector('.format-card');
  await page.locator('.format-card', { hasText: label }).click();
  await page.click('.dialog-body .btn-primary');
  const res = await Promise.race([
    page.waitForSelector('.export-preview, .export-file', { timeout: 60000 }).then(() => 'ok'),
    page.waitForSelector('.error-text', { timeout: 60000 }).then(async () => 'error: ' + (await page.textContent('.dialog-body'))),
  ]);
  const info = await page.textContent('.dialog-body .muted.small');
  console.log(`  export ${label}: ${res} — ${info}`);
  await shot(`06-export-${label}`);
  const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await page.click('.dialog-body .btn-primary');
  const d = await dl;
  if (d) await d.saveAs(`${out}export-${label}.${(await d.suggestedFilename()).split('.').pop()}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}
await exportAs('GIF');
await exportAs('MP4');
await exportAs('PNG');
step('exports done');

// Reload: project must persist
await page.goto(url);
await page.waitForSelector('.project-card');
await page.waitForTimeout(500);
await shot('07-home-after');
await page.click('.card-open');
await page.waitForSelector('.tl-frame');
await page.waitForTimeout(800);
const frames = await page.locator('.tl-frame').count();
const layers = await page.locator('.layer-row').count();
console.log(`  reopened: ${frames} frames, ${layers} layers`);
await shot('08-reopened');

// Mobile/tablet portrait layout
await page.setViewportSize({ width: 820, height: 1180 });
await page.waitForTimeout(400);
await shot('09-tablet-portrait');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await shot('10-phone');

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
