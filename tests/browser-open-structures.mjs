// A building's roof and front wall left out and a breach in it, a canopy and
// a stage, set on the Buildings page and in their kits. In a fresh offline
// browser profile.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { unzipSync, strFromU8 } from 'fflate';

const executablePath = process.env.SLOT_FORGE_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, offline: true, acceptDownloads: true })).newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const host = page.locator('#buildings-page');
const idle = async () => {
  try {
    await page.waitForFunction(() => { const h = document.querySelector('#buildings-page'); return h && h.querySelector('.bd-message').hidden && !h.querySelector('[data-bd="save"]').disabled; }, null, { timeout: 60000 });
  } catch {
    throw Error('Not idle: ' + (await host.locator('.bd-error').textContent()));
  }
};
const setting = (name) => host.locator('[name="' + name + '"]');
const set = async (name, value) => {
  await setting(name).fill(String(value));
  await setting(name).press('Tab');
};
const exportZip = async () => {
  const [download] = await Promise.all([page.waitForEvent('download'), host.locator('[data-bd="export"]').click()]);
  return unzipSync(new Uint8Array(await readFile(await download.path())));
};
const stls = (zip) => Object.keys(zip).filter((n) => n.endsWith('.stl'));
try {
  await page.goto(new URL('../dist/index.html?ui-test#track', import.meta.url).href);
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  await page.locator('[data-action="mode-buildings"]').first().click();
  await idle();

  // A garage with its roof left out: no roof in the kit; a breach added in its front wall.
  await host.locator('[data-bd-preset="shed"]').click();
  await idle();
  assert.equal(await host.locator('[data-bd-add-breach]').isHidden(), true, 'no breach with a roof on');
  await setting('leave-roof').check();
  await idle();
  assert.equal(await host.locator('[data-bd-add-breach]').isVisible(), true);
  let zip = await exportZip();
  assert.ok(!stls(zip).some((n) => /roof/i.test(n)), stls(zip).join(', '));
  await host.locator('[data-bd-add-breach]').click();
  await idle();
  assert.equal(await setting('br-wall-0').count(), 1);
  // Too deep, refused; then removed.
  await set('br-d-0', 500);
  await host.locator('.bd-error').waitFor({ state: 'visible' });
  assert.match(await host.locator('.bd-error').textContent(), /Breach 1 /);
  await set('br-d-0', 15);
  await idle();
  await host.locator('[data-bd-remove-breach="0"]').click();
  await idle();
  assert.equal(await setting('br-wall-0').count(), 0);

  // The room box: no front wall, no roof.
  await host.locator('[data-bd-preset="room-box"]').click();
  await idle();
  assert.equal(await setting('leave-front').isChecked(), true);
  zip = await exportZip();
  assert.ok(!stls(zip).some((n) => /front wall|roof/i.test(n)), stls(zip).join(', '));

  // The forecourt canopy: its card; made a tent with screens at the ends.
  await host.locator('[data-bd-preset="forecourt-canopy"]').click();
  await idle();
  assert.equal(await host.locator('[data-bd-card="canopy"]').isVisible(), true);
  assert.equal(await setting('cText').inputValue(), 'FUEL');
  assert.equal(await setting('cPitch').isHidden(), true);
  await setting('cRoof').selectOption('tent');
  await idle();
  assert.equal(await setting('cPitch').isVisible(), true);
  await setting('cScreens').selectOption('ends');
  await idle();
  zip = await exportZip();
  assert.ok(stls(zip).some((n) => /Tent, front/.test(n)) && stls(zip).some((n) => /Screen, left/.test(n)), stls(zip).join(', '));
  assert.match(strFromU8(zip['README.txt']), /two slopes of the tent on the rails/);

  // The rally start ramp: its stage card; the portal taken away takes its text.
  await host.locator('[data-bd-preset="rally-start-ramp"]').click();
  await idle();
  assert.equal(await host.locator('[data-bd-card="deck"]').isVisible(), true);
  assert.equal(await setting('sgText').inputValue(), 'RALLY START');
  zip = await exportZip();
  assert.ok(stls(zip).some((n) => /Header/.test(n)));
  await setting('sgPortal').uncheck();
  await idle();
  assert.equal(await setting('sgText').isHidden(), true);
  zip = await exportZip();
  assert.ok(!stls(zip).some((n) => /Header|Pier/.test(n)));
  assert.deepEqual(errors, []);
  console.log('PASS: a roof left out and a breach added, refused too deep and removed; the room box open in front; a forecourt canopy made a screened tent; a start ramp with and without its portal.');
} finally {
  await browser.close();
}
