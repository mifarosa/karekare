// Browser test for pen pressure, touch gestures and sound.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const url = process.argv[2] || 'http://localhost:4173/';
const out = fileURLToPath(new URL('./out/', import.meta.url));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'en-US', hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const cdp = await context.newCDPSession(page);
const assert = (cond, msg) => {
  if (!cond) {
    errors.push(`ASSERT: ${msg}`);
    console.log('  ✗', msg);
  } else console.log('  ✓', msg);
};

await page.goto(url);
await page.click('.big-btn.primary');
await page.click('.dialog .btn-primary');
await page.waitForSelector('.editor .viewport');
await page.waitForTimeout(400);
const vp = await page.locator('.viewport').boundingBox();

const livePixels = () =>
  page.evaluate(() => {
    const c = document.querySelector('.layer-canvas.live');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  });
const transform = () => page.evaluate(() => document.querySelector('.stage').style.transform);

// Pen stroke with rising pressure.
async function pen(type, x, y, force, buttons = 1) {
  await cdp.send('Input.dispatchMouseEvent', {
    type,
    x: vp.x + x,
    y: vp.y + y,
    button: 'left',
    buttons,
    clickCount: 1,
    pointerType: 'pen',
    force,
  });
}
await pen('mouseMoved', 200, 300, 0, 0);
await pen('mousePressed', 200, 300, 0.1);
for (let i = 1; i <= 30; i++) await pen('mouseMoved', 200 + i * 15, 300 + Math.sin(i / 4) * 40, Math.min(1, i / 30));
await pen('mouseReleased', 650, 300, 0, 0);
await page.waitForTimeout(200);
const afterPen = await livePixels();
assert(afterPen > 500, `pen stroke drawn (${afterPen} px)`);

// One finger after a pen was used: pans instead of drawing.
const t0 = await transform();
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: vp.x + 300, y: vp.y + 500 }] });
for (let i = 1; i <= 5; i++)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: vp.x + 300 + i * 20, y: vp.y + 500 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(100);
assert((await livePixels()) === afterPen, 'finger did not draw (palm rejection)');
assert((await transform()) !== t0, 'finger panned the canvas');

// Pinch to zoom.
const zoomBefore = await page.textContent('.zoom-label');
const c = { x: vp.x + 500, y: vp.y + 350 };
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x - 40, y: c.y, id: 1 }, { x: c.x + 40, y: c.y, id: 2 }] });
for (let i = 1; i <= 6; i++)
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: c.x - 40 - i * 15, y: c.y, id: 1 }, { x: c.x + 40 + i * 15, y: c.y, id: 2 }],
  });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(100);
const zoomAfter = await page.textContent('.zoom-label');
assert(parseInt(zoomAfter) > parseInt(zoomBefore), `pinch zoomed ${zoomBefore} -> ${zoomAfter}`);

// Two-finger tap = undo.
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, id: 1 }, { x: c.x + 60, y: c.y, id: 2 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(300);
assert((await livePixels()) === 0, 'two-finger tap undid the stroke');
// Three-finger tap = redo.
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [{ x: c.x, y: c.y, id: 1 }, { x: c.x + 60, y: c.y, id: 2 }, { x: c.x + 120, y: c.y, id: 3 }],
});
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(300);
assert((await livePixels()) === afterPen, 'three-finger tap redid the stroke');
await page.screenshot({ path: `${out}11-pen.png` });

// Sound: add a wav file via the timeline sound button.
await page.click('.tl-bar .icon-btn[aria-label="Sound"]');
const chooser = page.waitForEvent('filechooser');
await page.click('.popover .menu-item');
await (await chooser).setFiles(`${out}tone.wav`);
await page.waitForSelector('.tl-wave canvas', { timeout: 5000 });
assert(true, 'waveform shown');
for (let i = 0; i < 5; i++) await page.keyboard.press('n');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}12-sound.png` });

// Video export with sound.
await page.click('.export-btn');
await page.locator('.format-card', { hasText: 'MP4' }).click();
await page.click('.dialog-body .btn-primary');
await page.waitForSelector('.export-preview, .error-text', { timeout: 60000 });
const info = await page.textContent('.dialog-body');
assert(!info.includes('failed'), `video exported: ${info.replace(/\s+/g, ' ').slice(0, 120)}`);
const videoBytes = await page.evaluate(async () => {
  const v = document.querySelector('video.export-preview');
  const b = await (await fetch(v.src)).arrayBuffer();
  return Array.from(new Uint8Array(b));
});
const fs = await import('node:fs');
fs.writeFileSync(`${out}export-sound.webm`, Buffer.from(videoBytes));

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'all good');
await browser.close();
