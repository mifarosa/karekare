// Browser test for the reference photo and for onion skins that keep photo detail.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const url = process.argv[2] || 'http://localhost:4173/';
const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}scripts/out/`;
const photo = `${root}docs/screenshot.png`;
const photo2 = `${root}public/icons/icon-512.png`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, locale: 'en-US' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const assert = (cond, msg) => {
  if (!cond) errors.push(`ASSERT: ${msg}`);
  console.log(cond ? '  ✓' : '  ✗', msg);
};

/** Pixel stats of a canvas: opaque pixels, distinct colors, colored (non-gray) pixels, mean color. */
const stats = (selector, minAlpha = 250) =>
  page.evaluate(([sel, minAlpha]) => {
    const c = document.querySelector(sel);
    if (!c) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    let colored = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    const colors = new Set();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < minAlpha) continue;
      n++;
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
      if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 30) colored++;
      if (colors.size < 5000) colors.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    }
    return { n, colored, colors: colors.size, mean: n ? [r / n, g / n, b / n].map(Math.round) : null };
  }, [selector, minAlpha]);
// Ghosts are drawn faintly (30% by default), so only fairly opaque pixels count.
const onionStats = () => stats('.layer-canvas.onion', 60);
const refCanvas = () =>
  page.evaluate(() => {
    const c = document.querySelector('.layer-canvas.reference');
    if (!c) return null;
    const prev = c.previousElementSibling;
    return {
      hidden: c.hidden,
      display: getComputedStyle(c).display,
      opacity: Number(c.style.opacity),
      after: prev?.classList.contains('paper') ? 'paper' : prev?.classList.contains('above') ? 'above' : prev?.className,
    };
  });
const livePixels = async () => (await stats('.layer-canvas.live')).n;
const openPhotoMenu = async () => {
  // Tapping the current frame opens its menu; close anything open first.
  if (await page.isVisible('.popover')) await page.keyboard.press('Escape');
  await page.click('.toolbar .tool-btn[aria-label="Add photo"]');
  await page.waitForSelector('.popover .menu');
};
const stroke = async (x0, y0, x1, y1) => {
  const r = await page.locator('.viewport').boundingBox();
  await page.mouse.move(r.x + x0, r.y + y0);
  await page.mouse.down();
  await page.mouse.move(r.x + x1, r.y + y1, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(100);
};

await page.goto(url);
await page.click('.big-btn.primary');
await page.click('.dialog .btn-primary');
await page.waitForSelector('.editor .viewport');
await page.waitForTimeout(400);

// ---- Onion skin of a plain black line stays a clean red.
await page.keyboard.press('b');
await stroke(300, 300, 700, 340);
await page.keyboard.press('n');
await page.waitForTimeout(300);
const lineGhost = await onionStats();
// The default ink is a dark navy, so the tint is a hair lighter than pure #e5484d.
assert(
  lineGhost.n > 50 && lineGhost.mean[0] > 220 && lineGhost.mean[1] < 100 && lineGhost.mean[2] < 105,
  `a dark line's ghost is red (${lineGhost.mean})`,
);

// ---- Photos as frames: the ghost keeps the photo's detail.
await openPhotoMenu();
let chooser = page.waitForEvent('filechooser');
await page.locator('.popover .menu-item', { hasText: 'Add as new frames' }).click();
await (await chooser).setFiles([photo2, photo]);
await page.waitForSelector('.dialog');
await page.click('.dialog .btn-primary');
await page.waitForFunction(() => document.querySelectorAll('.tl-frame').length === 4, null, { timeout: 15000 });
// A blank frame after the photos to draw on; its ghost is the last photo.
await page.keyboard.press('n');
await page.waitForTimeout(800);
const tinted = await onionStats();
// A flat tint would be a single color; a one-hue ramp at 30% alpha has a few dozen.
assert(tinted.n > 100000 && tinted.colors > 30, `the photo's ghost shows detail, not a flat block (${tinted.colors} colors)`);
assert(tinted.mean[0] > tinted.mean[1] + 20, `the photo's ghost is still tinted red (${tinted.mean})`);
await page.screenshot({ path: `${out}30-onion-photo-tinted.png` });

// Real colors option in settings.
await page.click('.topbar button[aria-label="More"]');
await page.locator('.popover .menu-item', { hasText: 'Settings' }).click();
await page.waitForSelector('.dialog');
await page.locator('.dialog .segmented button', { hasText: 'Real colors' }).click();
await page.click('.dialog .dialog-actions .btn-primary');
await page.waitForTimeout(300);
const real = await onionStats();
assert(real.colors > 200 && Math.abs(real.mean[0] - real.mean[1]) < Math.abs(tinted.mean[0] - tinted.mean[1]), `"Real colors" shows the photo untinted (${real.mean})`);
await page.screenshot({ path: `${out}31-onion-photo-real.png` });
assert(
  await page.evaluate(() => JSON.parse(localStorage.getItem('karekare.settings')).onion.colored === false),
  'the ghost color choice is remembered',
);

// ---- Reference photo.
await page.locator('.tl-frame').nth(0).click();
await page.waitForTimeout(300);
const linePx = await livePixels();
await openPhotoMenu();
assert(await page.isVisible('.popover .menu-item:has-text("Reference photo (to trace)")'), 'photo menu offers a reference photo');
chooser = page.waitForEvent('filechooser');
await page.locator('.popover .menu-item', { hasText: 'Reference photo (to trace)' }).click();
await (await chooser).setFiles(photo);
await page.waitForSelector('.placer-bar:not([hidden]) .placer-note');
await page.screenshot({ path: `${out}32-reference-placing.png` });
await page.click('.placer-actions .btn-primary');
await page.waitForTimeout(400);
let rc = await refCanvas();
let rs = await stats('.layer-canvas.reference');
assert(rc && !rc.hidden && rc.after === 'paper' && rc.opacity === 0.5, `reference sits under the drawing at 50% (${JSON.stringify(rc)})`);
assert(rs.n > 100000 && rs.colors > 200, `reference canvas shows the photo (${rs.n} px)`);
assert((await livePixels()) === linePx, 'the layer itself is untouched');
await page.screenshot({ path: `${out}33-reference.png` });

// Undo/redo.
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
assert((await refCanvas()).hidden, 'undo removes the reference');
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(300);
assert(!(await refCanvas()).hidden, 'redo brings it back');

// R toggles it.
await page.keyboard.press('r');
await page.waitForTimeout(100);
assert((await refCanvas()).hidden, 'R hides the reference');
await page.keyboard.press('r');
await page.waitForTimeout(100);
assert(!(await refCanvas()).hidden, 'R shows it again');

// Shown on every frame, hidden during playback.
await page.locator('.tl-frame').nth(2).click();
await page.waitForTimeout(200);
assert(!(await refCanvas()).hidden, 'reference shows on other frames too');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
assert((await refCanvas()).display === 'none', 'reference is hidden while playing');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
await page.locator('.tl-frame').nth(0).click();
await page.waitForTimeout(200);

// Menu controls: opacity, above the drawing.
await openPhotoMenu();
await page.waitForTimeout(250);
await page.screenshot({ path: `${out}34-reference-menu.png` });
await page.locator('.popover .opt', { hasText: 'Opacity' }).locator('input').fill('80');
await page.locator('.popover .opt-toggle', { hasText: 'Over the drawing' }).click();
await page.waitForTimeout(100);
rc = await refCanvas();
assert(rc.opacity === 0.8 && rc.after === 'above', `opacity and "over the drawing" apply (${JSON.stringify(rc)})`);
await page.keyboard.press('Escape');

// Move: starts where the reference is; dragging moves it.
const before = await stats('.layer-canvas.reference');
await openPhotoMenu();
await page.locator('.popover .menu-item', { hasText: 'Move or resize' }).click();
await page.waitForSelector('.placer-bar:not([hidden])');
await page.waitForTimeout(150);
assert((await refCanvas()).hidden, 'the reference hides while its stand-in is moved');
const box = await page.locator('.placer-box').boundingBox();
const vp = await page.locator('.viewport').boundingBox();
const stage = await page.locator('.stage').boundingBox();
// The photo was fitted inside the canvas, centered.
assert(
  Math.abs(box.x + box.width / 2 - (stage.x + stage.width / 2)) < 3 &&
    Math.abs(box.y + box.height / 2 - (stage.y + stage.height / 2)) < 3 &&
    (Math.abs(box.width - stage.width) < 3 || Math.abs(box.height - stage.height) < 3),
  'move starts from the current position and size',
);
await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
await page.mouse.down();
await page.mouse.move(vp.x + vp.width / 2 + 120, vp.y + vp.height / 2 + 60, { steps: 6 });
await page.mouse.up();
await page.click('.placer-actions .btn-primary');
await page.waitForTimeout(300);
const after = await stats('.layer-canvas.reference');
assert(!(await refCanvas()).hidden && after.n < before.n, `the reference moved (${before.n} -> ${after.n} px on canvas)`);

// Not exported.
await page.waitForFunction(() => document.querySelector('.save-state')?.dataset.state === 'saved', null, { timeout: 15000 });
await page.click('.export-btn');
await page.waitForSelector('.format-card');
await page.locator('.format-card', { hasText: 'GIF' }).click();
await page.click('.dialog-body .btn-primary');
await page.waitForSelector('.export-preview', { timeout: 60000 });
const gif = await page.evaluate(async () => {
  const img = document.querySelector('.export-preview');
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let colored = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 30) colored++;
  return { colored, total: d.length / 4 };
});
assert(gif.colored < gif.total * 0.001, `exported frame 1 has no trace of the reference (${gif.colored} colored px)`);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// Survives a reload with its settings.
await page.reload();
await page.waitForSelector('.tl-frame');
await page.waitForTimeout(1000);
rc = await refCanvas();
rs = await stats('.layer-canvas.reference');
assert(rc && !rc.hidden && rc.opacity === 0.8 && rc.after === 'above' && rs.n === after.n, `reference survives a reload (${JSON.stringify(rc)}, ${rs?.n} px)`);

// Remove, then undo.
await openPhotoMenu();
await page.locator('.popover .menu-item', { hasText: 'Remove reference' }).click();
await page.waitForTimeout(150);
assert((await refCanvas()).hidden, 'remove hides it');
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
assert(!(await refCanvas()).hidden, 'undo restores a removed reference');

// Help lists the shortcut.
await page.click('.topbar button[aria-label="Help"]');
await page.waitForSelector('.help-table');
assert(await page.isVisible('.help-table td:has-text("Reference photo on/off")'), 'help lists the R shortcut');

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'all good');
await browser.close();
