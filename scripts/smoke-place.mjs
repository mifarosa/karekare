// Browser test for placing text and photos, and photos as new frames.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const url = process.argv[2] || 'http://localhost:4173/';
const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}scripts/out/`;
const photos = [`${root}docs/screenshot.png`, `${root}public/icons/icon-512.png`, `${root}docs/demo.gif`];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, locale: 'en-US', hasTouch: true });
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
const boxRect = () => page.evaluate(() => {
  const r = document.querySelector('.placer-box').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
});
const frameCount = () => page.locator('.tl-frame').count();

await page.goto(url);
await page.click('.big-btn.primary');
await page.click('.dialog .btn-primary');
await page.waitForSelector('.editor .viewport');
await page.waitForTimeout(400);

// ---- Text
await page.click('.toolbar .tool-btn[aria-label="Add text"]');
await page.waitForSelector('.placer-bar:not([hidden])');
assert(await page.evaluate(() => document.activeElement?.classList.contains('placer-text')), 'text input is focused');
await page.keyboard.type('Kare Kare');
await page.waitForTimeout(100);
const b0 = await boxRect();
// Move by dragging anywhere on the canvas.
await page.mouse.move(b0.cx, b0.cy);
await page.mouse.down();
await page.mouse.move(b0.cx - 150, b0.cy - 100, { steps: 6 });
await page.mouse.up();
const b1 = await boxRect();
assert(Math.abs(b1.cx - (b0.cx - 150)) < 2 && Math.abs(b1.cy - (b0.cy - 100)) < 2, 'drag moves the text');
// Resize from the bottom-right corner.
const br = await page.locator('.ph-br').boundingBox();
await page.mouse.move(br.x + br.width / 2, br.y + br.height / 2);
await page.mouse.down();
await page.mouse.move(br.x + 120, br.y + 40, { steps: 6 });
await page.mouse.up();
const b2 = await boxRect();
assert(b2.w > b1.w * 1.3, `corner handle resizes (${Math.round(b1.w)} -> ${Math.round(b2.w)})`);
// Rotate with the top handle.
const rot = await page.locator('.ph-rotate').boundingBox();
await page.mouse.move(rot.x + rot.width / 2, rot.y + rot.height / 2);
await page.mouse.down();
await page.mouse.move(rot.x + 140, rot.y + 40, { steps: 8 });
await page.mouse.up();
const transform = await page.evaluate(() => document.querySelector('.placer-box').style.transform);
assert(/rotate\((?!0rad)/.test(transform), `rotate handle turns the text (${transform.match(/rotate\([^)]*\)/)?.[0]})`);
await page.screenshot({ path: `${out}20-place-text.png` });
assert((await livePixels()) === 0, 'nothing is drawn before placing');
await page.click('.placer-actions .btn-primary');
await page.waitForTimeout(150);
const textPx = await livePixels();
assert(textPx > 1000 && (await page.isHidden('.placer-bar')), `"Place" draws the text into the layer (${textPx} px)`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(250);
assert((await livePixels()) === 0, 'undo removes the placed text');
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(250);
assert((await livePixels()) === textPx, 'redo brings it back');

// Escape cancels; undo while placing cancels too.
await page.keyboard.press('t');
await page.waitForSelector('.placer-bar:not([hidden])');
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
assert((await page.isHidden('.placer-bar')) && (await livePixels()) === textPx, 'Escape cancels placing');

// ---- Photo on this frame, resized with a two-finger pinch.
await page.click('.toolbar .tool-btn[aria-label="Add photo"]');
let chooser = page.waitForEvent('filechooser');
await page.locator('.popover .menu-item', { hasText: 'Place on this frame' }).click();
await (await chooser).setFiles(photos[1]);
await page.waitForSelector('.placer-bar:not([hidden])');
const p0 = await boxRect();
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [{ x: p0.cx - 30, y: p0.cy, id: 1 }, { x: p0.cx + 30, y: p0.cy, id: 2 }],
});
for (let i = 1; i <= 6; i++)
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: p0.cx - 30 - i * 8, y: p0.cy - i * 4, id: 1 }, { x: p0.cx + 30 + i * 8, y: p0.cy + i * 4, id: 2 }],
  });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
const p1 = await boxRect();
assert(p1.w > p0.w * 1.2, `two-finger pinch resizes the photo (${Math.round(p0.w)} -> ${Math.round(p1.w)})`);
await page.screenshot({ path: `${out}21-place-photo.png` });
// Tapping another frame first places it (auto-commit on navigation).
await page.keyboard.press('n');
await page.waitForTimeout(300);
assert(await page.isHidden('.placer-bar'), 'adding a frame finishes placing');
await page.locator('.tl-frame').nth(0).click();
await page.waitForTimeout(300);
assert((await livePixels()) > textPx + 1000, 'the photo landed on frame 1 with the text');

// ---- Photos as new frames (one undo step).
const before = await frameCount();
await page.click('.toolbar .tool-btn[aria-label="Add photo"]');
chooser = page.waitForEvent('filechooser');
await page.locator('.popover .menu-item', { hasText: 'Add as new frames' }).click();
await (await chooser).setFiles(photos);
await page.waitForSelector('.dialog');
await page.screenshot({ path: `${out}22-photo-frames-dialog.png` });
await page.locator('.dialog .segmented button', { hasText: 'Show the whole photo' }).click();
await page.click('.dialog .btn-primary');
await page.waitForFunction((n) => document.querySelectorAll('.tl-frame').length === n, before + 3, { timeout: 15000 });
assert(true, `3 photos became 3 new frames (${before} -> ${before + 3})`);
assert((await page.textContent('.tl-counter')).startsWith(`${1 + 3} /`), 'the last new frame is selected');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}23-photo-frames.png` });
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
assert((await frameCount()) === before, 'one undo removes all imported frames');
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(300);

// Saved and restored after reload.
await page.waitForFunction(() => document.querySelector('.save-state')?.dataset.state === 'saved', null, { timeout: 15000 });
// The editor URL reopens the project directly.
await page.reload();
await page.waitForSelector('.tl-frame');
await page.waitForTimeout(800);
assert((await frameCount()) === before + 3, 'photo frames survive a reload');
await page.screenshot({ path: `${out}24-reloaded.png` });

// ---- Phone layout of the placing bar.
const phone = await (await browser.newContext({ ...devices['iPhone 13'], locale: 'tr-TR' })).newPage();
await phone.goto(url);
await phone.click('.big-btn.primary');
await phone.click('.dialog .btn-primary');
await phone.waitForSelector('.editor .viewport');
await phone.waitForTimeout(400);
await phone.click('.toolbar .tool-btn[aria-label="Yazı ekle"]');
await phone.waitForSelector('.placer-bar:not([hidden])');
await phone.screenshot({ path: `${out}25-place-phone.png` });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'all good');
await browser.close();
