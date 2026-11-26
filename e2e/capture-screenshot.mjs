// Captures docs/screenshot.png from a running stack (default: docker compose web on :5173).
// Usage: cd e2e && node capture-screenshot.mjs [baseUrl]
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(base);
await page.getByRole('textbox', { name: /find chemical compounds/i }).fill('aspirin');
await page.getByRole('button', { name: 'Search' }).click();
const img = page.getByRole('img', { name: '2D structure of Aspirin' });
await img.waitFor();
await page.waitForFunction((el) => el.complete && el.naturalWidth > 0, await img.elementHandle());
// Scroll so the search box and its result fill the view (the header is fixed, so no full-page capture).
await page.evaluate(() => {
  const el = document.querySelector('.Search-Container');
  window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 220);
});
await page.screenshot({ path: '../docs/screenshot.png' });
await browser.close();
console.log('saved docs/screenshot.png');
