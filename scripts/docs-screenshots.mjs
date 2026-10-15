// Regenerates the screenshots in docs/images. Start the dev server first:
//   npm run dev -- --port 5179
//   node scripts/docs-screenshots.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const URL_ = process.env.WEBIMATION_URL || 'http://localhost:5179/';
const OUT = new URL('../docs/images/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', e => console.log('page error:', e.message));
const shot = async (name, clip) => { await page.waitForTimeout(250); await page.screenshot({ path: OUT + name, ...(clip ? { clip } : {}) }); console.log('wrote', name); };
const fresh = async () => {
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('webimation.help.seen.v1', '1'); });
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.keyboard.press('Space'); // pause the demo so shots are steady
};
const at = async seconds => { await page.evaluate(s => window.__webimationSeek?.(s), seconds); await page.waitForTimeout(150); };
const RIGHT = { x: 1120, y: 52, width: 320, height: 848 }, LEFT = { x: 0, y: 52, width: 232, height: 848 };

// First run: the help card.
await page.goto(URL_, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.goto(URL_, { waitUntil: 'networkidle' });
await shot('help.png');

await fresh();
await at(29);
await shot('overview.png');
await shot('add-panel.png', LEFT);

// Add a lower third over the stat: it stacks on layer 2.
await at(27.2);
await page.getByRole('button', { name: 'Lower third', exact: true }).click();
await page.keyboard.press('Space');
await at(30);
await page.locator('aside input.field-input').nth(0).fill('Ada Lovelace');
await page.locator('aside input.field-input').nth(1).fill('Guest · Analytical Engines');
await at(30);
await shot('content-tab.png', RIGHT);
await shot('stacked.png', { x: 232, y: 52, width: 888, height: 720 });

await page.getByRole('tab', { name: 'Style' }).click();
await shot('style-tab.png', RIGHT);
await page.getByRole('tab', { name: 'Motion' }).click();
await shot('motion-tab.png', RIGHT);
await page.getByRole('button', { name: 'More animations' }).click();
await page.waitForTimeout(1500);
await shot('animations.png');
await page.getByRole('button', { name: 'Close' }).click();
await page.getByRole('tab', { name: 'Export' }).click();
await shot('export-tab.png', RIGHT);

// Shapes and characters in Single mode.
await fresh();
await page.getByRole('button', { name: 'Single', exact: true }).click();
await page.getByRole('button', { name: 'New', exact: true }).click();
await page.getByRole('tab', { name: 'Characters' }).click();
await page.getByRole('button', { name: 'Two friends meet' }).click();
await page.keyboard.press('Space');
await page.evaluate(() => window.__webimationSingle?.(3.2));
await shot('characters.png');
await page.getByRole('tab', { name: 'Shapes' }).click();
await page.getByRole('button', { name: 'Curved arrow' }).click();
await page.keyboard.press('Space');
await page.evaluate(() => window.__webimationSingle?.(3.2));
await shot('shapes.png');

// Your own footage behind the preview (a generated test image stands in for a video).
await fresh();
await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
  const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 1920, 1080);
  g.addColorStop(0, '#30475e'); g.addColorStop(0.55, '#7a6a53'); g.addColorStop(1, '#c9a46a');
  x.fillStyle = g; x.fillRect(0, 0, 1920, 1080);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  const input = document.querySelector('input[type=file][accept^=video]'), dt = new DataTransfer();
  dt.items.add(new File([blob], 'my-shot.jpg', { type: 'image/jpeg' }));
  input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
});
await at(3);
await shot('footage.png', { x: 232, y: 52, width: 888, height: 590 });

await browser.close();
