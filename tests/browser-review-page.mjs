// The Buildings page keeps what is being typed, and its fields follow what a
// button changed: a walkway's length and towers, a straight grandstand's
// length, a garage's band height, a vault's rise, a grandstand made curved
// and straight again, a gantry's type. In a fresh offline browser profile.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { unzipSync } from 'fflate';

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
// A standard building, its group open or not.
const preset = async (id) => {
  await host.locator('[data-bd-preset="' + id + '"]').evaluate((el) => el.click());
  await idle();
};
const error = () => host.locator('.bd-error');
// Types part of a value, pauses past the rebuild, and checks it is still there.
const keepsTyped = async (name, partial) => {
  await setting(name).fill(String(partial));
  await page.waitForTimeout(600);
  assert.equal(await setting(name).inputValue(), String(partial), name + ' kept what was typed');
};
try {
  await page.goto(new URL('../dist/index.html?ui-test#track', import.meta.url).href);
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  await page.locator('[data-action="mode-buildings"]').first().click();
  await idle();

  // A walkway: a half-typed length stays; towers ticked that cannot be stay ticked, their fields in view.
  await preset('walkway-towers');
  await keepsTyped('wLength', 9);
  await error().waitFor({ state: 'visible' });
  await set('wLength', 120);
  await idle();
  await setting('wTowers').uncheck();
  await idle();
  await set('wWidth', 55);
  await idle();
  await setting('wTowers').check();
  await error().waitFor({ state: 'visible' });
  await page.waitForTimeout(600);
  assert.equal(await setting('wTowers').isChecked(), true, 'the towers stay ticked');
  assert.equal(await host.locator('[data-bd-towers]').isVisible(), true, 'the tower fields stay in view');
  await set('wTowerDepth', 70);
  await idle();
  assert.equal(await setting('wTowers').isChecked(), true);
  // Its kit: the towers' parts ("Left tower: base plate") in files that unzip on Windows.
  const [download] = await Promise.all([page.waitForEvent('download'), host.locator('[data-bd="export"]').click()]);
  const names = Object.keys(unzipSync(new Uint8Array(await readFile(await download.path()))));
  assert.ok(names.some((n) => /^\d\d Left tower- /.test(n)), names.join(', '));
  for (const n of names) assert.doesNotMatch(n, /[\\/:*?"<>|]|[. ]$/, n);

  // A straight grandstand: a half-typed length stays.
  await preset('stand');
  await keepsTyped('gLength', 9);
  await set('gLength', 240);
  await idle();

  // A grandstand made curved, then straight: no frames, stairs or railings left behind in its fields.
  await preset('stand-raised');
  assert.notEqual(await setting('gRaised').inputValue(), '0');
  await host.locator('[data-bd-stand-shape="curved"]').click();
  await idle();
  await host.locator('[data-bd-stand-shape="straight"]').click();
  await idle();
  assert.equal(await setting('gRaised').inputValue(), '0');
  assert.equal(await setting('gUpper').inputValue(), '0');
  assert.equal(await setting('gStairs').inputValue(), 'none');
  assert.equal(await setting('gRailings').isChecked(), false);
  assert.equal(await setting('gLength').isDisabled(), false);
  // The next edit builds without them.
  await set('gRows', 4);
  await idle();
  assert.equal(await setting('gRaised').inputValue(), '0');
  assert.equal(await host.locator('.bd-parts').textContent().then((t) => /stair|railing|frame/i.test(t)), false, await host.locator('.bd-parts').textContent());

  // A half gantry with a box sign made a start gantry: its sign unticked.
  await preset('gantry-sign');
  assert.equal(await setting('tSign').isChecked(), true);
  await host.locator('[data-bd-gantry-type="start"]').click();
  await idle();
  assert.equal(await setting('tSign').isChecked(), false);

  // A garage: a half-typed band height stays.
  await preset('garage');
  await setting('fw-lowerTexture').selectOption('brick');
  await idle();
  await keepsTyped('fw-lowerHeight', 3);
  await error().waitFor({ state: 'visible' });
  await set('fw-lowerHeight', 25);
  await idle();
  assert.equal(await setting('fw-lowerHeight').inputValue(), '25');

  // A vault on a narrow garage: its rise shown as clamped, so the next edit builds.
  await preset('garage');
  await set('doorWidth', 45);
  await idle();
  await set('width', 70);
  await idle();
  await set('depth', 70);
  await idle();
  const rise = Number(await setting('rise').inputValue());
  assert.ok(rise > 35, 'rise ' + rise);
  await host.locator('[data-bd-roof="vault"]').click();
  await idle();
  assert.equal(await setting('rise').inputValue(), '35');
  await set('height', 80);
  await idle();
  assert.equal(await error().isHidden(), true);

  assert.deepEqual(errors, []);
  console.log('PASS: half-typed values stay (walkway length, towers ticked, grandstand length, band height); a vault\'s rise, a grandstand curved and straight again, and a gantry\'s type show in their fields.');
} finally {
  await browser.close();
}
