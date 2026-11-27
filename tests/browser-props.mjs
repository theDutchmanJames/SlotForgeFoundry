// Props on the Buildings page: a kit of pit props, changed and added to; props
// placed in a garage and outside it. In a fresh offline browser profile.
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
const output = new URL('../test-results/props' + (gl ? '-gl' : '') + '/', import.meta.url);
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

  // A kit of pit props: one more tool chest, then a cone added.
  await host.locator('[data-bd-preset="props-pit"]').click();
  await idle();
  await noError('pit props');
  let b = await saved();
  assert.equal(b.kind, 'props');
  assert.equal(b.items.length, 5);
  await edit('pk-count-1', 2);
  await host.locator('[data-bd-add-item]').click();
  await idle();
  b = await saved();
  assert.deepEqual([b.items[1].count, b.items.length], [2, 6]);
  assert.match(await host.locator('.bd-col').innerText(), /Tool chest 2/);
  await snap('pit-props');
  await host.locator('[data-bd-remove-item="5"]').click();
  await idle();
  assert.equal((await saved()).items.length, 5);

  // A garage with props inside and a tyre stack outside.
  await host.locator('[data-bd-preset="garage"]').click();
  await idle();
  await host.locator('[data-bd-add-prop]').click();
  await idle();
  await setting('bp-type-0').selectOption('workbench');
  await idle();
  await noError('a workbench inside');
  await host.locator('[data-bd-add-prop]').click();
  await idle();
  // Outside: its place set too before it is checked again.
  await setting('bp-storey-1').selectOption('-1');
  await setting('bp-x-1').fill('30');
  await setting('bp-y-1').fill('-26');
  await setting('bp-y-1').press('Tab');
  await idle();
  await noError('a tyre stack outside');
  b = await saved();
  assert.deepEqual(b.props.map((p) => [p.type, p.storey]), [['workbench', 0], ['tyre-stack', -1]]);
  assert.match(await host.locator('.bd-col').innerText(), /Prop 1, workbench, top/);
  await snap('garage-props');
  // One that will not fit says so.
  await setting('bp-x-0').fill('1');
  await setting('bp-x-0').press('Tab');
  await host.locator('.bd-error').waitFor({ state: 'visible' });
  assert.match(await host.locator('.bd-error').textContent(), /clear of its walls/);
  assert.deepEqual(errors, []);
  console.log('PASS: a kit of pit props changed and added to; a workbench in a garage and a tyre stack outside it; a prop that does not fit refused.');
} finally {
  await browser.close();
}
