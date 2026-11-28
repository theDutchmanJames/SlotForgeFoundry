// The rally group on the Buildings page: each piece started from Start from
// shows its own card and its parts, and a change on its card makes it again.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { chromium } from 'playwright-core';

const executablePath = process.env.SLOT_FORGE_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 }, offline: true })).newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/WebGL/.test(m.text()) && errors.push(m.text()));
const bd = page.locator('#buildings-page');
const idle = () => page.waitForFunction(() => { const h = document.querySelector('#buildings-page'); return h && !h.hidden && h.querySelector('.bd-message').hidden && !h.querySelector('[data-bd="save"]').disabled; });
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('foundry.building')));
const parts = () => bd.locator('[data-bd-part]').count();
const card = (kind) => bd.locator('[data-bd-rally="' + kind + '"]');
try {
  await page.goto(new URL('../dist/index.html?ui-test', import.meta.url).href);
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  await page.locator('[data-action="mode-buildings"]').first().click();
  await idle();
  // The group, with the service tent and the start ramp in it.
  assert.match(await bd.textContent(), /Rally/);
  for (const id of ['rally-timing-caravan', 'rally-stone-wall', 'rally-hunting-tower', 'rally-arch-house', 'rally-tunnel-portal', 'rally-rock-gallery', 'rally-level-crossing', 'rally-start-ramp', 'rally-service-tent']) assert.equal(await bd.locator('[data-bd-preset="' + id + '"] img').count(), 1, id + ' has its picture');
  // The caravan: its card alone, its eleven parts; longer.
  await bd.locator('[data-bd-preset="rally-timing-caravan"]').click();
  await idle();
  assert.equal(await card('caravan').isVisible(), true);
  assert.equal(await card('stonewall').isVisible(), false);
  assert.equal(await bd.locator('[data-bd-card="garage"]').isVisible(), false, 'not a garage’s cards');
  assert.equal(await parts(), 11);
  assert.equal(await bd.locator('[name="rk-caravan-text"]').inputValue(), 'TIMING');
  await bd.locator('[name="rk-caravan-length"]').fill('120');
  await bd.locator('[name="rk-caravan-length"]').dispatchEvent('change');
  await idle();
  assert.equal((await saved()).length, 120);
  // A setting out of its limits says so and keeps the caravan as it was.
  await bd.locator('[name="rk-caravan-height"]').fill('20');
  await bd.locator('[name="rk-caravan-height"]').dispatchEvent('change');
  await page.waitForFunction(() => !document.querySelector('#buildings-page .bd-error').hidden);
  assert.match(await bd.locator('.bd-error').textContent(), /Height must be between 44 and 75/);
  assert.equal(await bd.locator('[data-bd="save"]').isDisabled(), true, 'not saved as it is');
  await bd.locator('[name="rk-caravan-height"]').fill('56');
  await bd.locator('[name="rk-caravan-height"]').dispatchEvent('change');
  await idle();
  // The wall: no gate, so no gate part.
  await bd.locator('[data-bd-preset="rally-stone-wall"]').click();
  await idle();
  assert.equal(await card('stonewall').isVisible(), true);
  assert.equal(await bd.locator('[data-bd-part="gate"]').count(), 1);
  await bd.locator('[name="rk-stonewall-gate"]').selectOption('none');
  await idle();
  assert.equal((await saved()).gate, 'none');
  assert.equal(await bd.locator('[data-bd-part="gate"]').count(), 0);
  // The tower: without its ladder, one part fewer.
  await bd.locator('[data-bd-preset="rally-hunting-tower"]').click();
  await idle();
  assert.equal(await parts(), 7);
  await bd.locator('[name="rk-huntingtower-ladder"]').uncheck();
  await idle();
  assert.equal(await parts(), 6);
  assert.equal((await saved()).ladder, false);
  // Undone, the ladder is back.
  await bd.locator('[data-bd="undo"]').click();
  await idle();
  assert.equal(await bd.locator('[name="rk-huntingtower-ladder"]').isChecked(), true);
  assert.equal(await parts(), 7);
  // The drive-through pieces: each its own card; a change on it makes it again.
  for (const [id, kind, name, value, count] of [['rally-arch-house', 'archhouse', 'balcony', false, 12], ['rally-tunnel-portal', 'tunnelportal', 'house', 'none', 4], ['rally-rock-gallery', 'rockgallery', 'length', '100', 4], ['rally-level-crossing', 'levelcrossing', 'cottage', false, 8]]) {
    await bd.locator('[data-bd-preset="' + id + '"]').click();
    await idle();
    assert.equal(await card(kind).isVisible(), true, kind);
    const field = bd.locator('[name="rk-' + kind + '-' + name + '"]');
    if (value === false) await field.uncheck();
    else if ((await field.evaluate((e) => e.tagName)) === 'SELECT') await field.selectOption(value);
    else {
      await field.fill(value);
      await field.dispatchEvent('change');
    }
    await idle();
    assert.equal(await parts(), count, kind + ' parts');
  }
  // Back to the tower for its kit.
  await bd.locator('[data-bd-preset="rally-hunting-tower"]').click();
  await idle();
  // Its kit: a part file for each part, the notes of a hunting tower kit with their colours, a 3MF.
  const [download] = await Promise.all([page.waitForEvent('download'), bd.locator('[data-bd="export"]').click()]);
  const zip = unzipSync(new Uint8Array(await readFile(await download.path())));
  const names = Object.keys(zip);
  assert.ok(names.filter((n) => /\.stl$/i.test(n)).length >= 7, names.join(', '));
  assert.ok(names.some((n) => /\.3mf$/i.test(n)), '3MF');
  const readme = strFromU8(zip[names.find((n) => /README/i.test(n))]);
  assert.match(readme, /hunting tower kit/);
  assert.match(readme, /Colours/);
  assert.deepEqual(errors, []);
  console.log('PASS: the rally group: a timing caravan, a dry-stone wall, a hunting tower and the four drive-through pieces, each on its own card, changed, undone, its limits kept.');
} finally {
  await browser.close();
}
