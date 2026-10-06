// Checks that the app loads and can open the editor with the network off.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const url = process.argv[2] || 'http://localhost:4173/';

const browser = await chromium.launch();
const context = await browser.newContext({ locale: 'en-US' });
const page = await context.newPage();
await page.goto(url);
await page.waitForSelector('.home');
await page.waitForFunction(async () => !!(await navigator.serviceWorker?.ready)?.active, null, { timeout: 15000 });
await page.waitForTimeout(1500); // let precaching finish
await context.setOffline(true);
await page.reload();
await page.waitForSelector('.home', { timeout: 10000 });
await page.click('.big-btn.primary');
await page.click('.dialog .btn-primary');
await page.waitForSelector('.editor .viewport', { timeout: 10000 });
// Workers (PNG encoder, storage, export) must load offline too.
await page.waitForTimeout(300);
const box = await page.locator('.viewport').boundingBox();
await page.mouse.move(box.x + 200, box.y + 200);
await page.mouse.down();
await page.mouse.move(box.x + 400, box.y + 260, { steps: 5 });
await page.mouse.up();
await page.waitForFunction(() => document.querySelector('.save-state')?.dataset.state === 'saved', null, { timeout: 10000 });
console.log('offline: app loaded, drew and saved');
await browser.close();
