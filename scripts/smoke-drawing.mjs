// Browser test for drawings (image mode) and pixel art projects.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const url = process.argv[2] || 'http://localhost:4173/';
const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}scripts/out/`;

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
const visible = (sel) => page.isVisible(sel);
/** Opaque, soft-edged and total painted pixels of the live layer. */
const liveAlpha = () =>
  page.evaluate(() => {
    const c = document.querySelector('.layer-canvas.live');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let solid = 0;
    let soft = 0;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] === 255) solid++;
      else if (d[i]) soft++;
    }
    return { solid, soft, w: c.width, h: c.height };
  });
const stroke = async (pts) => {
  const r = await page.locator('.viewport').boundingBox();
  await page.mouse.move(r.x + pts[0][0], r.y + pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(r.x + x, r.y + y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
};
/** Viewport position of the center of project pixel (x, y). */
const pixelAt = (x, y) =>
  page.evaluate(([x, y]) => {
    const st = document.querySelector('.stage');
    const vp = document.querySelector('.viewport').getBoundingClientRect();
    const r = st.getBoundingClientRect();
    const z = r.width / st.offsetWidth;
    return [r.left - vp.left + (x + 0.5) * z, r.top - vp.top + (y + 0.5) * z];
  }, [x, y]);
const exportPreview = () =>
  page.evaluate(async () => {
    const img = document.querySelector('.export-preview');
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    // Pixels whose color differs from the top-left of their 16×16 block (blur would make many).
    let mixed = 0;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        const j = ((y - (y % 16)) * c.width + (x - (x % 16))) * 4;
        if (d[i] !== d[j] || d[i + 1] !== d[j + 1] || d[i + 2] !== d[j + 2]) mixed++;
      }
    return { w: c.width, h: c.height, mixed };
  });

await page.goto(url);
await page.waitForSelector('.big-btn.drawing');

// ---- A drawing.
await page.click('.big-btn.drawing');
await page.waitForSelector('.dialog');
assert((await page.textContent('.dialog h2, .dialog .dialog-title')).includes('New drawing'), 'dialog is for a new drawing');
assert(!(await page.isVisible('.dialog .opt-label:has-text("Frames per second")')), 'no speed setting for a drawing');
assert((await page.inputValue('.dialog input.input')).startsWith('My drawing'), 'drawing gets a drawing name');
await page.click('.dialog .btn-primary');
await page.waitForSelector('.editor .viewport');
await page.waitForTimeout(500);
assert(!(await visible('.timeline')) && !(await visible('.onion-btn')), 'drawing hides the timeline and onion skin');
assert((await page.textContent('.export-btn')).includes('Save image'), 'export button says "Save image"');
await stroke([[300, 300], [600, 380], [700, 250]]);
assert((await liveAlpha()).solid > 500, 'drawing works');
await page.keyboard.press('n');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
assert((await page.locator('.tl-frame').count()) === 1, 'N and Enter do nothing in a drawing');
await page.screenshot({ path: `${out}40-drawing.png` });

await page.click('.export-btn');
await page.waitForSelector('.dialog');
assert((await page.locator('.format-card').count()) === 0, 'saving a drawing skips the format choice');
await page.click('.dialog-body .btn-primary');
await page.waitForSelector('.export-preview', { timeout: 30000 });
const drawingFile = await page.textContent('.dialog-body .muted.small');
assert(/\.png/.test(drawingFile), `a drawing saves as PNG (${drawingFile})`);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// Turn into an animation and back.
await page.click('.topbar button[aria-label="More"]');
await page.locator('.popover .menu-item', { hasText: 'Turn into an animation' }).click();
await page.waitForTimeout(300);
assert((await visible('.timeline')) && (await visible('.onion-btn')), 'turning into an animation shows the timeline');
await page.keyboard.press('n');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}40b-converted.png` });
assert((await page.locator('.tl-frame').count()) === 2, 'the converted drawing can get new frames');
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
await page.click('.topbar button[aria-label="More"]');
assert(await visible('.popover .menu-item:has-text("Turn into a drawing")'), 'a one-frame animation can become a drawing');
await page.locator('.popover .menu-item', { hasText: 'Turn into a drawing' }).click();
await page.waitForTimeout(300);
assert(!(await visible('.timeline')), 'and back');
await page.waitForFunction(() => document.querySelector('.save-state')?.dataset.state === 'saved', null, { timeout: 15000 });

// Home card.
await page.click('.topbar button[aria-label="My work"]');
await page.waitForSelector('.project-card');
const card = page.locator('.project-card').first();
assert((await card.textContent()).includes('Drawing · 1280×720'), 'home card describes a drawing');
assert((await card.locator('.card-badge').count()) === 1, 'drawing card has a badge');

// ---- A pixel art animation.
await page.click('.big-btn.primary');
await page.waitForSelector('.dialog');
await page.locator('.dialog .segmented button', { hasText: 'Pixel art' }).click();
assert(await visible('.dialog .size-card:has-text("32×32")'), 'pixel art offers small canvases');
await page.screenshot({ path: `${out}41-new-pixel.png` });
await page.click('.dialog .btn-primary');
await page.waitForSelector('.editor .viewport');
await page.waitForTimeout(600);
const live = await liveAlpha();
assert(live.w === 32 && live.h === 32, `canvas is 32×32 (${live.w}×${live.h})`);
assert(await visible('.pixel-grid'), 'pixel grid is shown');
assert(await visible('.pixel-chip'), 'options show the pixel pen');
assert(!(await visible('.brush-chip')), 'no brush picker chip');
await page.click('.toolbar .tool-btn[aria-label^="Brush"]');
await page.waitForTimeout(200);
assert(!(await visible('.brush-grid')), 'tapping the pen again does not open the brush picker');

// A diagonal-ish curve stays one pixel thin and hard-edged.
const a = await pixelAt(2, 2);
const b = await pixelAt(20, 9);
const c = await pixelAt(28, 28);
await stroke([a, b, c]);
let px = await liveAlpha();
assert(px.soft === 0 && px.solid > 20, `pen paints hard pixels (${px.solid} solid, ${px.soft} soft)`);
const corners = await page.evaluate(() => {
  const cv = document.querySelector('.layer-canvas.live');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const on = (x, y) => x >= 0 && y >= 0 && x < cv.width && y < cv.height && d[(y * cv.width + x) * 4 + 3] > 0;
  let n = 0;
  // An L corner: a pixel with a horizontal and a vertical neighbour that touch diagonally.
  for (let y = 0; y < cv.height; y++)
    for (let x = 0; x < cv.width; x++) {
      if (!on(x, y)) continue;
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) if (on(x + dx, y) && on(x, y + dy)) n++;
    }
  return n;
});
assert(corners === 0, `one-pixel line has no L corners (${corners})`);
await page.screenshot({ path: `${out}42-pixel.png` });

// Bigger pen, fill and text all stay hard-edged.
await page.keyboard.press(']');
await page.keyboard.press(']');
const sizeText = await page.textContent('.optionsbar .slider-value');
assert(sizeText === '3px', `] grows the pixel pen (${sizeText})`);
await stroke([await pixelAt(4, 26), await pixelAt(12, 26)]);
await page.keyboard.press('g');
const [fx, fy] = await pixelAt(28, 3);
const vr = await page.locator('.viewport').boundingBox();
await page.mouse.click(vr.x + fx, vr.y + fy);
await page.waitForTimeout(150);
await page.keyboard.press('t');
await page.waitForSelector('.placer-bar:not([hidden])');
await page.keyboard.type('Hi');
await page.click('.placer-actions .btn-primary');
await page.waitForTimeout(200);
px = await liveAlpha();
assert(px.soft === 0, `fill and text keep hard edges (${px.soft} soft pixels)`);
await page.screenshot({ path: `${out}43-pixel-more.png` });

// Export is enlarged without blur.
await page.waitForFunction(() => document.querySelector('.save-state')?.dataset.state === 'saved', null, { timeout: 15000 });
await page.click('.export-btn');
await page.waitForSelector('.format-card');
await page.locator('.format-card', { hasText: 'PNG' }).click();
assert(await visible('.dialog .segmented button.active:has-text("×16")'), 'pixel export defaults to ×16');
await page.click('.dialog-body .btn-primary');
await page.waitForSelector('.export-preview', { timeout: 30000 });
const png = await exportPreview();
assert(png.w === 512 && png.h === 512, `exported at 512×512 (${png.w}×${png.h})`);
assert(png.mixed === 0, `enlarged without blur: every pixel is a solid 16×16 square (${png.mixed} mixed)`);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// Grid toggle, reload.
await page.click('.zoom-controls .grid-btn');
assert(!(await visible('.pixel-grid')), 'grid button hides the grid');
await page.click('.zoom-controls .grid-btn');
await page.waitForFunction(() => document.querySelector('.save-state')?.dataset.state === 'saved', null, { timeout: 15000 });
await page.reload();
await page.waitForSelector('.tl-frame');
await page.waitForTimeout(800);
assert((await visible('.pixel-grid')) && (await visible('.pixel-chip')), 'pixel art survives a reload');

await page.click('.topbar button[aria-label="My work"]');
await page.waitForSelector('.project-card');
const pixCard = page.locator('.project-card').first();
assert((await pixCard.locator('.card-thumb.pixel').count()) === 1 && (await pixCard.locator('.card-badge').count()) === 1, 'pixel card is crisp and badged');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}44-home.png` });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'all good');
await browser.close();
