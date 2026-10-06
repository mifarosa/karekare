// Browser test for frame drag-reordering, layer operations and .zip round trip.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const url = process.argv[2] || 'http://localhost:4173/';
const out = fileURLToPath(new URL('./out/', import.meta.url));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const assert = (cond, msg) => {
  if (!cond) errors.push(`ASSERT: ${msg}`);
  console.log(cond ? '  ✓' : '  ✗', msg);
};

await page.goto(url);
await page.click('.big-btn.primary');
await page.fill('.dialog input.input', 'Flows');
await page.click('.dialog .btn-primary');
await page.waitForSelector('.editor .viewport');
await page.waitForTimeout(300);
const vp = await page.locator('.viewport').boundingBox();
async function dot(x) {
  await page.mouse.move(vp.x + x, vp.y + 200);
  await page.mouse.down();
  await page.mouse.move(vp.x + x + 40, vp.y + 240, { steps: 4 });
  await page.mouse.up();
}
// Three frames with marks at different x positions.
await dot(150);
await page.keyboard.press('n');
await page.waitForTimeout(100);
await dot(400);
await page.keyboard.press('n');
await page.waitForTimeout(100);
await dot(650);
await page.waitForTimeout(300);

const frameIds = () => page.evaluate(() => [...document.querySelectorAll('.tl-frame')].map((f) => f.querySelector('canvas').toDataURL().length));
const before = await frameIds();

// Drag frame 3 to the first slot.
const f3 = await page.locator('.tl-frame').nth(2).boundingBox();
const f1 = await page.locator('.tl-frame').nth(0).boundingBox();
await page.mouse.move(f3.x + f3.width / 2, f3.y + f3.height / 2);
await page.mouse.down();
await page.mouse.move(f3.x + f3.width / 2 - 20, f3.y + 20, { steps: 3 });
await page.mouse.move(f1.x + 5, f1.y + 20, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(500);
const after = await frameIds();
assert(after[0] === before[2] && after[1] === before[0], 'dragged frame 3 to the start');
assert((await page.textContent('.tl-counter')).startsWith('1 /'), 'moved frame becomes current');
await page.keyboard.press('Control+z');
await page.waitForTimeout(400);
assert(JSON.stringify(await frameIds()) === JSON.stringify(before), 'undo restores frame order');

// Hold: make frame 2 last 3 ticks.
await page.locator('.tl-frame').nth(1).click();
await page.click('.tl-bar .icon-btn[aria-label="Hold longer"]');
await page.click('.tl-bar .icon-btn[aria-label="Hold longer"]');
assert((await page.textContent('.tl-hold-label')) === '×3', 'hold set to 3');

// Layers: add, rename via double click, hide, lock, delete + undo.
await page.click('.panel-foot .icon-btn[aria-label="New layer"]');
await page.waitForTimeout(200);
assert((await page.locator('.layer-row').count()) === 2, 'layer added');
await page.dblclick('.layer-row.selected .layer-name');
await page.fill('.dialog input', 'Ink');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
assert((await page.textContent('.layer-row.selected .layer-name')).includes('Ink'), 'layer renamed');
await page.click('.layer-row.selected .icon-btn:first-child');
await page.waitForTimeout(100);
await dot(300);
assert((await page.textContent('.toasts')).includes('hidden'), 'drawing on hidden layer is refused');
await page.click('.layer-row.selected .icon-btn:first-child');
await page.click('.panel-foot .icon-btn[aria-label="Delete layer"]');
await page.waitForTimeout(200);
assert((await page.locator('.layer-row').count()) === 1, 'layer deleted');
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
assert((await page.locator('.layer-row').count()) === 2, 'layer delete undone');

// Save project zip from the editor menu.
await page.waitForFunction(() => document.querySelector('.save-state')?.dataset.state === 'saved', null, { timeout: 10000 });
await page.click('.topbar .icon-btn[aria-label="More"]');
const dl = page.waitForEvent('download');
await page.locator('.popover .menu-item', { hasText: 'Save project file' }).click();
const zipPath = `${out}flows.karekare.zip`;
await (await dl).saveAs(zipPath);
assert(true, 'project zip downloaded');

// Back home and import it as a new project.
await page.click('.topbar .icon-btn[aria-label="My animations"]');
await page.waitForSelector('.home');
const cardsBefore = await page.locator('.project-card').count();
const chooser = page.waitForEvent('filechooser');
await page.locator('.big-btn', { hasText: 'Open project file' }).click();
await (await chooser).setFiles(zipPath);
await page.waitForSelector('.editor .tl-frame');
await page.waitForTimeout(600);
assert((await page.locator('.tl-frame').count()) === 3, 'imported project has 3 frames');
assert((await page.locator('.layer-row').count()) === 2, 'imported project has 2 layers');
assert((await page.textContent('.tl-frame:nth-child(2) .tl-hold'))?.includes('×3'), 'hold survived the round trip');
await page.screenshot({ path: `${out}13-imported.png` });
await page.click('.topbar .icon-btn[aria-label="My animations"]');
await page.waitForSelector('.project-card');
await page.waitForTimeout(300);
assert((await page.locator('.project-card').count()) === cardsBefore + 1, 'import added a new project');

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'all good');
await browser.close();
