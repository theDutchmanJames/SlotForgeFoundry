// The sawtooth and the barrel vault on the Buildings page, in a fresh offline browser profile.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const executablePath = process.env.SLOT_FORGE_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-webgl'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, offline: true });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const output = new URL('../test-results/roofs/', import.meta.url);
await mkdir(output, { recursive: true });
const host = page.locator('#buildings-page');
const idle = async () => {
  try {
    await page.waitForFunction(() => { const h = document.querySelector('#buildings-page'); return h && h.querySelector('.bd-message').hidden && !h.querySelector('[data-bd="save"]').disabled; }, null, { timeout: 30000 });
  } catch {
    throw Error('Not idle: ' + (await host.locator('.bd-error').textContent()));
  }
};
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('foundry.building')));
const setting = (name) => host.locator(`[name="${name}"]`);
const edit = async (name, value) => { await setting(name).fill(String(value)); await setting(name).press('Tab'); await idle(); };
const snap = (name) => host.locator('.bd-centre').screenshot({ path: fileURLToPath(new URL(name + '.png', output)) });
const noError = async (what) => assert.equal(await host.locator('.bd-error').isVisible(), false, what + ': ' + (await host.locator('.bd-error').textContent()));
try {
  await page.goto(new URL('../dist/index.html?ui-test#track', import.meta.url).href);
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  await page.locator('[data-action="mode-buildings"]').first().click();
  await idle();

  // A sawtooth: its teeth and pitch show, the frame under the roof does not apply.
  await host.locator('[data-bd-roof="sawtooth"]').click();
  await idle();
  await noError('sawtooth');
  assert.ok(await setting('teeth').isVisible());
  assert.ok(await setting('rises').isVisible());
  await host.locator('[name="rises"]').selectOption('back');
  await idle();
  await edit('teeth', 3);
  let b = await saved();
  assert.deepEqual([b.roof, b.teeth, b.rises], ['sawtooth', 3, 'back']);
  const parts = await host.locator('.bd-col').innerText();
  assert.match(parts, /North light 1/);
  await snap('sawtooth');
  // Too many teeth for their north lights: it says so.
  await setting('teeth').fill('8');
  await setting('teeth').press('Tab');
  await host.locator('.bd-error').waitFor({ state: 'visible' });
  assert.match(await host.locator('.bd-error').textContent(), /Choose fewer teeth/);
  await edit('teeth', 3);
  await noError('back to 3 teeth');

  // A tiled roof, then a vault: plain, as a vault is plain or corrugated; only those two shown.
  await host.locator('[data-bd-roof="gable"]').click();
  await idle();
  await host.locator('[data-bd-roof-texture="tile"]').click();
  await idle();
  await host.locator('[data-bd-roof="vault"]').click();
  await idle();
  await noError('vault');
  b = await saved();
  assert.deepEqual([b.roof, b.roofTexture], ['vault', 'plain']);
  assert.equal(await host.locator('[data-bd-roof-texture="tile"]').isVisible(), false);
  assert.ok(await setting('rise').isVisible());
  await edit('rise', 55);
  await host.locator('[data-bd-roof-texture="metal"]').click();
  await idle();
  await noError('corrugated vault');
  assert.equal((await saved()).rise, 55);
  await snap('vault');
  await host.locator('[data-bd-view="plate"]').click();
  await idle();
  await snap('vault-plate');
  // Fittings on a two-sided roof: a chimney, a rooflight, gutters and downpipes.
  await host.locator('[data-bd-view="model"]').click();
  await host.locator('[data-bd-roof="gable"]').click();
  await idle();
  assert.equal(await setting('downpipes').isVisible(), false, 'no downpipes without gutters');
  await setting('hasChimney').check();
  await idle();
  assert.ok(await setting('chimneyX').isVisible(), 'the chimney has its fields');
  await edit('chimneyHeight', 20);
  await host.locator('[data-bd-add-light]').click();
  await idle();
  assert.ok(await setting('light-x-0').isVisible(), 'the rooflight has its fields');
  await setting('gutters').check();
  await idle();
  await setting('downpipes').selectOption('left');
  await idle();
  await noError('fittings');
  b = await saved();
  assert.equal(b.chimney.height, 20);
  assert.equal(b.rooflights.length, 1);
  assert.deepEqual([b.gutters, b.downpipes], [true, 'left']);
  assert.match(await host.locator('.bd-col').innerText(), /Downpipe, left/);
  await snap('fittings');
  // To a flat roof: the gutters go, the chimney and the rooflight stay.
  await host.locator('[data-bd-roof="flat"]').click();
  await idle();
  b = await saved();
  assert.deepEqual([b.gutters, b.downpipes, !!b.chimney], [false, 'none', true]);
  // The rooflight removed.
  await host.locator('[data-bd-remove-light="0"]').click();
  await idle();
  assert.equal((await saved()).rooflights.length, 0);
  assert.deepEqual(errors, []);
  console.log('PASS: a sawtooth with its north lights, a corrugated barrel vault, and a chimney, rooflight, gutters and downpipes, set on the Buildings page, checked and drawn.');
} finally {
  await browser.close();
}
