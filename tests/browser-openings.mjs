// Arched and round windows, sills, lintels, shutters and doors in Draw, and
// stone and half-timbered walls, on the Buildings page in a fresh offline browser profile.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const executablePath = process.env.SLOT_FORGE_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
const gl = process.argv.includes('--gl');
const browser = await chromium.launch({ executablePath, headless: true, args: gl ? [] : ['--disable-webgl'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, offline: true });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const output = new URL('../test-results/openings' + (gl ? '-gl' : '') + '/', import.meta.url);
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
const snap = (name) => host.locator('.bd-centre').screenshot({ path: fileURLToPath(new URL(name + '.png', output)) });
const noError = async (what) => assert.equal(await host.locator('.bd-error').isVisible(), false, what + ': ' + (await host.locator('.bd-error').textContent()));
// The opening chosen in Draw: its shape, a flag, or its door.
const choose = async (key, value) => { await host.locator(`[data-opening-choice="${key}"]`).selectOption(value); await idle(); };
const flag = async (key) => { await host.locator(`[data-opening-flag="${key}"]`).check(); await idle(); };
const pick = async (i) => host.locator(`[data-opening="${i}"] > rect:not(.bd-drawing-frame):not(.bd-drawing-trim)`).first().click({ force: true });
try {
  await page.goto(new URL('../dist/index.html?ui-test#track', import.meta.url).href);
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  await page.locator('[data-action="mode-buildings"]').first().click();
  await idle();
  await host.locator('[data-bd-wall-texture="stone"]').click();
  await idle();
  await noError('stone');

  await host.locator('[data-bd-view="draw"]').click();
  await host.locator('[data-canvas-mode="wall"]').click();
  await host.locator('[data-canvas-wall]').selectOption('right');
  // An arched window with a frame and a lintel.
  await host.locator('[data-canvas-add="window"]').click();
  await idle();
  await pick(0);
  await host.locator('[data-opening-field="at"]').fill('60');
  await host.locator('[data-opening-field="at"]').press('Tab');
  await idle();
  await pick(0);
  await host.locator('[data-opening-frame]').check();
  await idle();
  await pick(0);
  await choose('shape', 'arch');
  await pick(0);
  await flag('lintel');
  await pick(0);
  await flag('ledge');
  await noError('arched window');
  let b = await saved();
  assert.deepEqual([b.openings[0].shape, b.openings[0].lintel, b.openings[0].ledge], ['arch', true, true]);
  assert.ok(await host.locator('[data-opening="0"] polygon.bd-drawing-shape').count(), 'the arch drawn in Draw');
  await snap('draw-arch');
  // A narrow square window with shutters further along.
  await host.locator('[data-canvas-add="window"]').click();
  await idle();
  b = await saved();
  const i = b.openings.length - 1;
  await pick(i);
  await host.locator('[data-opening-field="at"]').fill('130');
  await host.locator('[data-opening-field="at"]').press('Tab');
  await idle();
  await pick(i);
  await host.locator('[data-opening-field="width"]').fill('18');
  await host.locator('[data-opening-field="width"]').press('Tab');
  await idle();
  await pick(i);
  await flag('shutters');
  await noError('shutters');
  assert.equal((await saved()).openings[i].shutters, true);

  // A panelled door on the back wall.
  await host.locator('[data-canvas-wall]').selectOption('back');
  await host.locator('[data-canvas-add="door"]').click();
  await idle();
  b = await saved();
  const d = b.openings.length - 1;
  await pick(d);
  await choose('leaf', 'panels');
  await pick(d);
  await choose('shape', 'arch');
  await noError('arched panelled door');
  b = await saved();
  assert.deepEqual([b.openings[d].leaf, b.openings[d].shape], ['panels', 'arch']);

  await host.locator('[data-bd-view="model"]').click();
  await idle();
  await snap('stone-openings');
  // Half-timbered.
  await host.locator('[data-bd-wall-texture="timber"]').click();
  await idle();
  await noError('timber');
  await snap('timber-openings');
  assert.deepEqual(errors, []);
  console.log('PASS: an arched window with frame, sill and lintel; a window with shutters; an arched panelled door; stone and half-timbered walls.');
} finally {
  await browser.close();
}
