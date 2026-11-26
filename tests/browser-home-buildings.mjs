// Home: Start a new building, from a standard one or from scratch, and the
// buildings saved in the Library; each opens the Buildings page on it.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const executablePath = process.env.SLOT_FORGE_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 }, offline: true })).newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const output = new URL('../test-results/home/', import.meta.url);
await mkdir(output, { recursive: true });
const home = page.locator('#home');
const bd = page.locator('#buildings-page');
const idle = () => page.waitForFunction(() => { const h = document.querySelector('#buildings-page'); return h && !h.hidden && h.querySelector('.bd-message').hidden && !h.querySelector('[data-bd="save"]').disabled; });
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('foundry.building')));
const goHome = async () => {
  await page.locator('[data-action="mode-home"]').first().click();
  await home.locator('[data-home="buildings"]').waitFor();
};
try {
  await page.goto(new URL('../dist/index.html?ui-test', import.meta.url).href);
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  await goHome();
  assert.match(await home.textContent(), /Start a new building/);
  assert.equal(await home.locator('.home-build img').count(), 6, 'six pictures');
  assert.match(await home.textContent(), /Buildings you save on the Buildings page appear here/);
  await home.screenshot({ path: fileURLToPath(new URL('home.png', output)) });
  // A picture: the Buildings page on that building, its card marked.
  await home.locator('[data-home="building"][data-preset="race-control"]').click();
  await idle();
  assert.equal(await page.locator('[data-action="mode-buildings"]').first().getAttribute('aria-pressed'), 'true');
  assert.equal((await saved()).upper.length, 3, 'the race control tower');
  assert.equal(await bd.locator('[data-bd-preset="race-control"]').getAttribute('aria-pressed'), 'true');
  // From scratch: a shape to draw.
  await goHome();
  await home.locator('[data-home="building"][data-preset="footprint-l"]').click();
  await idle();
  assert.equal((await saved()).kind, 'footprint');
  // Saved, it is on Home, and opens from there.
  await bd.locator('[name="buildingName"]').fill('Home test shed');
  await bd.locator('[data-bd="save"]').click();
  await idle();
  await bd.locator('[data-bd-preset="garage"]').click();
  await idle();
  await goHome();
  await home.locator('.home-row', { hasText: 'Home test shed' }).locator('[data-home="open-building"]').click();
  await idle();
  assert.equal((await saved()).kind, 'footprint');
  assert.equal(await bd.locator('[name="buildingName"]').inputValue(), 'Home test shed');
  // All of them: the Buildings page as it was.
  await goHome();
  await home.locator('[data-home="buildings"]').click();
  await idle();
  assert.equal((await saved()).kind, 'footprint');
  assert.deepEqual(errors, []);
  console.log('PASS: Home starts a new building from a standard one, from scratch or from the Library, each on the Buildings page.');
} finally {
  await browser.close();
}
