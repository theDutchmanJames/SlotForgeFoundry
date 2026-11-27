// Inside a building on the Buildings page: a partition and stairs added,
// moved, in the kit, and taken away. In a fresh offline browser profile.
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
    await page.waitForFunction(() => { const h = document.querySelector('#buildings-page'); return h && h.querySelector('.bd-message').hidden && !h.querySelector('[data-bd="save"]').disabled; }, null, { timeout: 90000 });
  } catch {
    throw Error('Not idle: ' + (await host.locator('.bd-error').textContent()));
  }
};
const setting = (name) => host.locator('[name="' + name + '"]');
const exportZip = async () => {
  const [download] = await Promise.all([page.waitForEvent('download'), host.locator('[data-bd="export"]').click()]);
  return unzipSync(new Uint8Array(await readFile(await download.path())));
};
try {
  await page.goto(new URL('../dist/index.html?ui-test#track', import.meta.url).href);
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  await page.locator('[data-action="mode-buildings"]').first().click();
  await idle();
  // A one-storey shed has no stairs to add.
  await host.locator('[data-bd-preset="shed"]').click();
  await idle();
  assert.equal(await host.locator('[data-bd-add-stairs]').isHidden(), true);
  // The canal house: a partition across its ground floor, stairs up to the first floor.
  await host.locator('[data-bd-preset="canal-house"]').click();
  await idle();
  await host.locator('[data-bd-add-partition]').click();
  await idle();
  assert.equal(await setting('pt-x0-0').count(), 1);
  await setting('pt-dw-0').fill('24');
  await setting('pt-dw-0').press('Tab');
  await idle();
  await host.locator('[data-bd-add-stairs]').click();
  await idle();
  assert.equal(await setting('st-x-0').count(), 1);
  let zip = await exportZip();
  const names = Object.keys(zip);
  assert.ok(names.some((n) => /Partition 1/.test(n)) && names.some((n) => /Stairs 1/.test(n)), names.join(', '));
  assert.match(strFromU8(zip['README.txt']), /under the stairwell in the floor above/);
  // Stairs moved into a wall are refused.
  await setting('st-x-0').fill('1');
  await setting('st-x-0').press('Tab');
  await host.locator('.bd-error').waitFor({ state: 'visible' });
  assert.match(await host.locator('.bd-error').textContent(), /inside the walls/);
  // Both taken away.
  await host.locator('[data-bd-remove-stairs="0"]').click();
  await idle();
  await host.locator('[data-bd-remove-partition="0"]').click();
  await idle();
  zip = await exportZip();
  assert.ok(!Object.keys(zip).some((n) => /Partition|Stairs \d/.test(n)));
  assert.deepEqual(errors, []);
  console.log('PASS: no stairs in a one-storey shed; a partition with a doorway and stairs in the canal house, in the kit; stairs into a wall refused; both taken away.');
} finally {
  await browser.close();
}
