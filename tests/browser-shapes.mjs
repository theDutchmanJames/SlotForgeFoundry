// Octagons, round buildings, hip and cone roofs, storeys and curved walls on
// shaped buildings, on the Buildings page in a fresh offline browser profile.
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
const output = new URL('../test-results/shapes' + (gl ? '-gl' : '') + '/', import.meta.url);
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
const choose = async (name, value) => { await setting(name).selectOption(value); await idle(); };
const edit = async (name, value) => { await setting(name).fill(String(value)); await setting(name).press('Tab'); await idle(); };
const snap = (name) => host.locator('.bd-centre').screenshot({ path: fileURLToPath(new URL(name + '.png', output)) });
const noError = async (what) => assert.equal(await host.locator('.bd-error').isVisible(), false, what + ': ' + (await host.locator('.bd-error').textContent()));
async function clearOpenings() {
  await host.locator('[data-bd-view="draw"]').click();
  await host.locator('[data-canvas-mode="wall"]').click();
  for (const id of await host.locator('[data-canvas-wall] option').evaluateAll((os) => os.map((o) => o.value))) {
    await host.locator('[data-canvas-wall]').selectOption(id);
    if (!(await host.locator('[data-opening]').count())) continue;
    await host.locator('[data-opening] > rect:not(.bd-drawing-frame)').first().click();
    await host.locator('[data-canvas-group="all"]').click();
    await host.locator('[data-canvas-delete]').click();
    await idle();
  }
  await host.locator('[data-bd-view="model"]').click();
}
try {
  await page.goto(new URL('../dist/index.html?ui-test#track', import.meta.url).href);
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  await page.locator('[data-action="mode-buildings"]').first().click();
  await idle();
  await host.locator('[data-bd-preset="footprint-l"]').click();
  await idle();
  await clearOpenings();

  // An octagon with a hip roof: a spire of eight panels.
  await choose('fpShape', 'octagon');
  await edit('fp-width', 120);
  await edit('fp-depth', 120);
  assert.equal(await setting('fp-wing').isVisible(), false, 'no wing on an octagon');
  assert.equal(await setting('fp-pitch').isVisible(), false, 'no pitch on a flat roof');
  await choose('fpRoofShape', 'hip');
  await noError('octagon hip');
  assert.ok(await setting('fp-pitch').isVisible());
  await edit('fp-pitch', 40);
  let b = await saved();
  assert.deepEqual([b.shape, b.roofShape, b.pitch], ['octagon', 'hip', 40]);
  assert.match(await host.locator('.bd-col').innerText(), /Roof panel 8/);

  // Two storeys above, the second in planks.
  await host.locator('[data-bd-fp-add-storey]').click();
  await idle();
  await edit('fp-st-height', 50);
  await host.locator('[data-bd-fp-add-storey]').click();
  await idle();
  await noError('three storeys');
  b = await saved();
  assert.equal(b.upper.length, 2);
  assert.equal(b.upper[0].height, 50);
  assert.match(await host.locator('.bd-col').innerText(), /Floor, storey 3/);
  // A window on storey 3, through Draw.
  await host.locator('[data-bd-view="draw"]').click();
  await host.locator('[data-canvas-mode="wall"]').click();
  await host.locator('[data-canvas-add="window"]').click();
  await idle();
  b = await saved();
  assert.equal(b.upper[1].openings.length, 1, 'the window on storey 3');
  assert.equal(b.openings.length, 0);
  await host.locator('[data-bd-view="model"]').click();
  await snap('octagon-tower');

  // A round building, a cone roof.
  await host.locator('[data-bd-fp-storey="0"]').click();
  await host.locator('[data-bd-fp-remove-storey]').count();
  await host.locator('[data-bd-fp-storey="1"]').click();
  await host.locator('[data-bd-fp-remove-storey]').click();
  await idle();
  assert.equal((await saved()).upper.length, 0, 'storeys removed');
  await choose('fpShape', 'round');
  await edit('fp-sides', 20);
  await noError('round');
  await snap('round-cone');

  // An L cannot take a hip roof; a curved wall on a rectangle.
  await choose('fpRoofShape', 'flat');
  await choose('fpShape', 'rectangle');
  await host.locator('[data-bd-view="draw"]').click();
  await host.locator('[data-canvas-mode="plan"]').click();
  await host.locator('[data-edge="0"]').click({ force: true });
  await host.locator('[data-outline-bulge]').fill('30');
  await host.locator('[data-outline="curve"]').click();
  await idle();
  b = await saved();
  assert.equal(b.shape, 'custom');
  assert.equal(b.points.length, 9, 'a front curved in six walls');
  await host.locator('[data-bd-view="model"]').click();
  await snap('curved-front');
  assert.deepEqual(errors, []);
  console.log('PASS: an octagon with a hip roof and three storeys, a window on the top one; a round building with a cone; a curved wall; storeys removed.');
} finally {
  await browser.close();
}
