// Renders tools/og.html to og.png. Needs `npm run dev` running and Playwright.
//   node tools/og.mjs [http://localhost:5173]
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(`${base}/tools/og.html`);
await page.waitForSelector('body[data-ready]');
await page.locator('#og').screenshot({ path: 'og.png' });
await browser.close();
