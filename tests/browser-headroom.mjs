// Over the track in the Track Planner: the finish-line bridge across a
// straight stands on its legs beside the road, with room for the cars under
// it; on low legs it is too low. In a fresh offline browser profile.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const executablePath = process.env.SLOT_FORGE_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, offline: true })).newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const host = page.locator('#buildings-page');
const idleB = async () => {
  try {
    await page.waitForFunction(() => { const h = document.querySelector('#buildings-page'); return h && h.querySelector('.bd-message')?.hidden && !h.querySelector('[data-bd="save"]').disabled; }, null, { timeout: 60000 });
  } catch {
    throw Error('Not idle: ' + (await host.locator('.bd-error').textContent()));
  }
};
const panel = page.locator('#track-planner'),
  cmd = (k) => panel.locator('[data-pl="' + k + '"]'),
  field = (k) => panel.locator('[data-pl-field="' + k + '"]');
const idle = () => page.waitForFunction(() => !document.querySelector('#track-planner').hasAttribute('aria-busy'));
// Saves the finish-line bridge in the Library under a name, its legs this high.
const save = async (name, legs) => {
  await page.locator('[data-action="mode-buildings"]').first().click();
  await idleB();
  await host.locator('[data-bd-preset="finish-bridge"]').click();
  await idleB();
  await host.locator('[name="standHeight"]').fill(String(legs));
  await host.locator('[name="standHeight"]').press('Tab');
  await idleB();
  await host.locator('[name="buildingName"]').fill(name);
  await host.locator('[data-bd="save"]').click();
  await idleB();
};
// Places a saved building across the straights: their road runs along x, 0 to 400, 200 mm wide.
const across = async (name) => {
  await panel.locator('.pl-homes [data-home]').filter({ hasText: name }).click();
  await idle();
  await field('homeX').fill('200');
  await field('homeY').fill('0');
  await field('homeA').fill('90');
  await cmd('b-place').click();
  await idle();
  return panel.locator('.pl-home-place');
};
try {
  await page.goto(new URL('../dist/index.html?ui-test#track', import.meta.url).href);
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  await save('High finish', 139);
  await save('Low finish', 50);
  await page.locator('[data-action="mode-planner"]').first().click();
  await panel.waitFor();
  await cmd('new').click();
  await idle();
  await field('pack').selectOption({ label: 'SlotForge Basic' });
  for (let i = 0; i < 2; i++) {
    await panel.getByRole('button', { name: /^Full straight/ }).click();
    await idle();
  }
  // High: over the track, its legs beside it, room for the cars; no doorstep to level.
  let place = await across('High finish');
  assert.match(await place.locator('summary').textContent(), /Over the track/);
  assert.match(await place.locator('[data-pl-headroom]').textContent(), /129 mm clear above the road/);
  assert.equal(await panel.locator('.pl-home-height').count(), 0);
  await cmd('remove').click();
  await idle();
  // Low: too low for the cars.
  place = await across('Low finish');
  assert.match(await place.locator('summary').textContent(), /Too low for the cars/);
  assert.match(await place.locator('[data-pl-headroom]').textContent(), /only 40 mm above the road; a 1:32 car needs 50 mm/);
  // Turned along the road, its legs stand on it.
  await field('homeA').fill('0');
  await cmd('b-place').click();
  await idle();
  assert.match(await panel.locator('.pl-home-place summary').textContent(), /On the track/);
  assert.deepEqual(errors, []);
  console.log('PASS: a finish-line bridge across a straight with room for the cars; on low legs too low; turned along it, on the track.');
} finally {
  await browser.close();
}
