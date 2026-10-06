// Checks the "Add to Home Screen" warning on an iPad-like browser.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const url = process.argv[2] || 'http://localhost:4173/';
const out = fileURLToPath(new URL('./out/', import.meta.url));
const errors = [];
const assert = (cond, msg) => {
  if (!cond) errors.push(msg);
  console.log(cond ? '  ✓' : '  ✗', msg);
};

const browser = await chromium.launch();
const ipad = devices['iPad Pro 11 landscape'];
const context = await browser.newContext({ ...ipad, locale: 'tr-TR' });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.waitForSelector('.home');
assert(await page.isVisible('.install-banner.install-banner-warn'), 'iPad shows the home-screen warning');
assert(await page.locator('.home-header-actions .btn').first().isHidden(), 'header install button hidden while the banner shows');
await page.screenshot({ path: `${out}14-install-banner.png` });

await page.click('.install-banner .btn-primary');
await page.waitForSelector('.install-steps');
await page.waitForTimeout(300);
assert((await page.locator('.install-step').count()) === 3, 'guide shows three steps');
await page.screenshot({ path: `${out}15-install-guide.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

await page.click('.install-banner .btn:not(.btn-primary)');
assert(!(await page.isVisible('.install-banner')), '“Later” hides the banner');
assert(await page.locator('.home-header-actions .btn').first().isVisible(), 'header install button available after “Later”');
await page.reload();
await page.waitForSelector('.home');
assert(!(await page.isVisible('.install-banner')), 'banner stays hidden after reload');
// After the snooze period it comes back.
await page.evaluate(() => localStorage.setItem('karekare.installHintDismissed', String(Date.now() - 4 * 864e5)));
await page.reload();
await page.waitForSelector('.home');
assert(await page.isVisible('.install-banner'), 'banner returns after 3 days');

// Installed (standalone) apps never show it.
await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
await page.reload();
await page.waitForSelector('.home');
assert(!(await page.isVisible('.install-banner')), 'no banner when opened from the Home Screen');
assert(await page.locator('.home-header-actions .btn').first().isHidden(), 'no install button when installed');

// Phone layout.
const phone = await browser.newContext({ ...devices['iPhone 13'], locale: 'tr-TR' });
const p2 = await phone.newPage();
await p2.goto(url);
await p2.waitForSelector('.install-banner');
await p2.screenshot({ path: `${out}16-install-phone.png` });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'all good');
await browser.close();
