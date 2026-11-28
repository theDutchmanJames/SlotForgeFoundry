// Floor textures on the Buildings page: chosen for a garage and a shaped
// building, kept with it, coloured on the Colours card by texture or in a
// colour of their own; and every texture swatch has its picture.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const executablePath = process.env.SLOT_FORGE_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 }, offline: true })).newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// Run without WebGL, its own complaints aside.
page.on('console', (m) => m.type() === 'error' && !/WebGL/.test(m.text()) && errors.push(m.text()));
const bd = page.locator('#buildings-page');
const idle = () => page.waitForFunction(() => { const h = document.querySelector('#buildings-page'); return h && !h.hidden && h.querySelector('.bd-message').hidden && !h.querySelector('[data-bd="save"]').disabled; });
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('foundry.building')));
const visible = (sel) => bd.locator(sel).evaluate((el) => !el.hidden && el.offsetParent !== null);
try {
  await page.goto(new URL('../dist/index.html?ui-test', import.meta.url).href);
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  await page.locator('[data-action="mode-buildings"]').first().click();
  await idle();
  // Every swatch has its picture.
  assert.equal(await bd.locator('.bd-swatches path[d="undefined"]').count(), 0, 'a swatch without its picture');
  // A garage: floorboards, kept with it, its parts listed as before.
  await bd.locator('[data-bd-preset="garage"]').click();
  await idle();
  assert.equal((await saved()).floorTexture, 'plain');
  await bd.locator('[name="floorTexture"]').selectOption('boards');
  await idle();
  assert.equal((await saved()).floorTexture, 'boards');
  assert.match(await bd.locator('.bd-col').first().textContent(), /Base plate/);
  // Undone, it is plain again.
  await bd.locator('[data-bd="undo"]').click();
  await idle();
  assert.equal((await saved()).floorTexture, 'plain');
  assert.equal(await bd.locator('[name="floorTexture"]').inputValue(), 'plain');
  // The Colours card: the floor by its texture, or a colour of its own once unticked; the band too.
  assert.equal(await visible('[data-bd-col-auto="floor"]'), true);
  assert.equal(await bd.locator('[name="col-floor"]').isHidden(), true);
  await bd.locator('[name="col-auto"]').uncheck();
  assert.equal(await bd.locator('[name="col-floor"]').isVisible(), true);
  assert.equal(await bd.locator('[name="col-band"]').isVisible(), true, 'the band takes a colour of its own');
  assert.equal(await bd.locator('[name="col-set"]').inputValue(), 'custom');
  await bd.locator('[name="col-auto"]').check();
  assert.equal(await bd.locator('[name="col-floor"]').isHidden(), true);
  // A shaped building: flagstones, in its own select.
  await bd.locator('[data-bd-preset="footprint-l"]').click();
  await idle();
  await bd.locator('[name="fpFloorTexture"]').selectOption('flags');
  await idle();
  const b = await saved();
  assert.equal(b.kind, 'footprint');
  assert.equal(b.floorTexture, 'flags');
  // Back to a standard building: as it was drawn, plain.
  await bd.locator('[data-bd-preset="footprint-u"]').click();
  await idle();
  assert.equal(await bd.locator('[name="fpFloorTexture"]').inputValue(), 'plain');
  assert.deepEqual(errors, []);
  console.log('PASS: floor textures are chosen for a garage and a shaped building, kept, undone, and coloured by texture or a colour of their own.');
} finally {
  await browser.close();
}
