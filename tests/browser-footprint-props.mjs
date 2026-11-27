// Props on a shaped building, set on the Buildings page and in its kit. In a
// fresh offline browser profile.
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
try {
  await page.goto(new URL('../dist/index.html?ui-test#track', import.meta.url).href);
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  await page.locator('[data-action="mode-buildings"]').first().click();
  await idle();
  // An L-shaped building: its Props card, a prop added inside.
  await host.locator('[data-bd-preset="footprint-l"]').click();
  await idle();
  assert.equal(await host.locator('[data-bd-card="buildingProps"]').isVisible(), true, 'the Props card for a shaped building');
  await host.locator('[data-bd-add-prop]').click();
  await idle();
  assert.equal(await host.locator('.bd-bprops [name="bp-type-0"]').count(), 1);
  // Moved into the notch of the L it is outside the walls: refused.
  const x = await setting('bp-x-0').inputValue(),
    y = await setting('bp-y-0').inputValue();
  await setting('bp-x-0').fill('190');
  await setting('bp-y-0').fill('150');
  await setting('bp-y-0').press('Tab');
  await host.locator('.bd-error').waitFor({ state: 'visible' });
  assert.match(await host.locator('.bd-error').textContent(), /clear of its walls/);
  // Put outside on the table there, it stands.
  await setting('bp-storey-0').selectOption('-1');
  await idle();
  // The kit: the prop's STL, and the notes saying where it goes.
  const [download] = await Promise.all([page.waitForEvent('download'), host.locator('[data-bd="export"]').click()]);
  const zip = unzipSync(new Uint8Array(await readFile(await download.path())));
  assert.ok(Object.keys(zip).some((n) => /Prop 1, /.test(n)), 'the prop in the kit: ' + Object.keys(zip).join(', '));
  assert.match(strFromU8(zip['README.txt']), /Glue each prop where it stands/);
  // Back inside where it was, then removed.
  await setting('bp-storey-0').selectOption('0');
  await setting('bp-x-0').fill(x);
  await setting('bp-y-0').fill(y);
  await setting('bp-y-0').press('Tab');
  await idle();
  await host.locator('[data-bd-remove-prop="0"]').click();
  await idle();
  assert.equal(await host.locator('.bd-bprops [name="bp-type-0"]').count(), 0);
  // A garage still has the card; a grandstand has not.
  await host.locator('[data-bd-preset="garage"]').click();
  await idle();
  assert.equal(await host.locator('[data-bd-card="buildingProps"]').isVisible(), true);
  await host.locator('[data-bd-preset="stand"]').click();
  await idle();
  assert.equal(await host.locator('[data-bd-card="buildingProps"]').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('PASS: a prop on an L-shaped building, refused in its notch, put outside there, in the kit, put back and removed; the card only where it belongs.');
} finally {
  await browser.close();
}
