// Renders a thumbnail of every standard building for the Buildings page's
// Start from list: each preset as the app shows it, cropped to the building,
// its background made clear, saved small as WebP in src/assets/presets/.
// Run after `npm run build` whenever a preset changes: node scripts/preset-thumbnails.mjs [id ...]
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { BUILDING_PRESETS } from '../src/building-presets.js';

const SIZE = [176, 132]; // twice the size it shows at, for sharp screens
const only = process.argv.slice(2);
const executablePath = process.env.SLOT_FORGE_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 }, offline: true })).newPage();
page.setDefaultTimeout(60000);
const host = page.locator('#buildings-page');
const idle = () => page.waitForFunction(() => { const h = document.querySelector('#buildings-page'); return h && h.querySelector('.bd-message').hidden && !h.querySelector('[data-bd="save"]').disabled; });
const out = new URL('../src/assets/presets/', import.meta.url);
await mkdir(out, { recursive: true });
try {
  await page.goto(new URL('../dist/index.html?ui-test#track', import.meta.url).href);
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  await page.locator('[data-action="mode-buildings"]').first().click();
  await idle();
  for (const p of BUILDING_PRESETS) {
    if (only.length && !only.includes(p.id)) continue;
    await host.locator('[data-bd-preset="' + p.id + '"]').click();
    await idle();
    await page.waitForTimeout(150);
    const png = (await host.locator('.bd-model').screenshot()).toString('base64');
    // In the page: crop to what differs from the background, make the background clear, scale down.
    const webp = await page.evaluate(async ({ png, size: [W, H] }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + png;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const data = g.getImageData(0, 0, c.width, c.height);
      const d = data.data, bg = [d[0], d[1], d[2]];
      let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4, off = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
          if (off < 10) d[i + 3] = 0;
          else if (off < 30) d[i + 3] = Math.round(((off - 10) / 20) * 255);
          if (off >= 10) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        }
      g.putImageData(data, 0, 0);
      // The building in the middle, as large as fits, a little room round it.
      const w = x1 - x0 + 1, h = y1 - y0 + 1, k = Math.min((W * 0.92) / w, (H * 0.92) / h);
      const t = document.createElement('canvas');
      t.width = W;
      t.height = H;
      const tg = t.getContext('2d');
      tg.imageSmoothingQuality = 'high';
      tg.drawImage(c, x0, y0, w, h, (W - w * k) / 2, (H - h * k) / 2, w * k, h * k);
      return t.toDataURL('image/webp', 0.82);
    }, { png, size: SIZE });
    await writeFile(new URL(p.id + '.webp', out), Buffer.from(webp.split(',')[1], 'base64'));
    console.log(p.id);
  }
} finally {
  await browser.close();
}
console.log('Thumbnails written to', fileURLToPath(out));
