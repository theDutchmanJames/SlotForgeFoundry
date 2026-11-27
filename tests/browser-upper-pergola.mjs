// The upper tier of a grandstand and the pergola over picnic tables, set on
// the Buildings page and in the kit. In a fresh offline browser profile.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { unzipSync, strFromU8 } from 'fflate';

const executablePath = process.env.SLOT_FORGE_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-webgl'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, offline: true, acceptDownloads: true });
const page = await context.newPage();
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
const set = async (name, value) => {
  await host.locator(`[name="${name}"]`).fill(String(value));
  await host.locator(`[name="${name}"]`).press('Tab');
};
const exportZip = async () => {
  const [download] = await Promise.all([page.waitForEvent('download'), host.locator('[data-bd="export"]').click()]);
  return unzipSync(new Uint8Array(await readFile(await download.path())));
};
try {
  await page.goto(new URL('../dist/index.html?ui-test#track', import.meta.url).href);
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  await page.locator('[data-action="mode-buildings"]').first().click();
  await idle();

  // The double-deck stand: five rows on an upper tier, made three, then none.
  await host.locator('[data-bd-preset="stand-double"]').click();
  await idle();
  assert.equal(await host.locator('[name="gUpper"]').inputValue(), '5');
  assert.match(await host.locator('[data-bd-grandstand-size]').textContent(), /5 rows and 5 more on an upper tier behind/);
  await set('gUpper', 3);
  await idle();
  assert.match(await host.locator('[data-bd-grandstand-size]').textContent(), /and 3 more on an upper tier/);
  let zip = await exportZip();
  let readme = strFromU8(zip['README.txt']);
  assert.match(readme, /an upper tier of 3 behind them/);
  assert.ok(Object.keys(zip).some((n) => /Upper tier, staircase, left\.stl$/.test(n)), 'the upper staircase in the kit: ' + Object.keys(zip).join(', '));
  // A canopy is refused with an upper tier, and the stand stays as it was.
  await host.locator('[name="gRoof"]').selectOption('canopy');
  await page.waitForFunction(() => /open to the sky/.test(document.querySelector('#buildings-page .bd-error')?.textContent ?? ''));
  await host.locator('[name="gRoof"]').selectOption('none');
  await set('gUpper', 0);
  await idle();
  assert.doesNotMatch(await host.locator('[data-bd-grandstand-size]').textContent(), /upper/);

  // The picnic pergola: in the kit; taken away, the tables alone.
  await host.locator('[data-bd-preset="picnic-pergola"]').click();
  await idle();
  assert.equal(await host.locator('[name="qPergola"]').isChecked(), true);
  zip = await exportZip();
  readme = strFromU8(zip['README.txt']);
  assert.match(readme, /Over them a pergola/);
  assert.ok(Object.keys(zip).some((n) => /Pergola roof\.stl$/.test(n)));
  await host.locator('[name="qPergola"]').uncheck();
  await idle();
  zip = await exportZip();
  assert.ok(!Object.keys(zip).some((n) => /Pergola/.test(n)), 'no pergola once taken away');

  // A building on a column: its height fields shown; on nothing, hidden (the grandstand's hint has a name of its own).
  await host.locator('[data-bd-preset="post-box"]').click();
  await idle();
  assert.equal(await host.locator('[data-bd-stand-size]').isVisible(), true);
  await host.locator('[name="standType"]').selectOption('none');
  await idle();
  assert.equal(await host.locator('[data-bd-stand-size]').isHidden(), true, 'no stand, no stand height');
  assert.deepEqual(errors, []);
  console.log('PASS: a double-deck stand with its upper tier changed, refused a canopy and taken away; a picnic pergola in the kit and taken away; a stand height hidden with no stand.');
} finally {
  await browser.close();
}
