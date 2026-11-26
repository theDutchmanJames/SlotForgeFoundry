// Lettering in the editor: a fascia sign, a roof billboard, a billboard by the
// track and words on a wall, in a fresh offline browser profile.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { unzipSync, strFromU8 } from 'fflate';

const executablePath = process.env.SLOT_FORGE_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-webgl'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, offline: true, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const output = new URL('../test-results/lettering/', import.meta.url);
await mkdir(output, { recursive: true });
const host = page.locator('#buildings-page');
const idle = async () => {
  try {
    await page.waitForFunction(() => { const h = document.querySelector('#buildings-page'); return h && h.querySelector('.bd-message').hidden && !h.querySelector('[data-bd="save"]').disabled; }, null, { timeout: 15000 });
  } catch (e) {
    throw Error('Not idle: ' + (await host.locator('.bd-message').textContent()) + ' | ' + (await host.locator('.bd-error').textContent()) + ' | save disabled ' + (await host.locator('[data-bd="save"]').isDisabled()));
  }
};
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('foundry.building')));
const setting = (name) => host.locator(`[name="${name}"]`);
const fill = async (locator, value) => { await locator.fill(String(value)); await locator.press('Tab'); await idle(); };
const snap = (name, what = '.bd-centre') => host.locator(what).screenshot({ path: fileURLToPath(new URL(name + '.png', output)) });
const noError = async (what) => assert.equal(await host.locator('.bd-error').isVisible(), false, what + ': ' + (await host.locator('.bd-error').textContent()));
try {
  await page.goto(new URL('../dist/index.html?ui-test#track', import.meta.url).href);
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  await page.locator('[data-action="mode-buildings"]').first().click();
  await idle();

  // A garage: a fascia sign with its text, and words on its left wall.
  await host.locator('[data-bd-preset="garage"]').click();
  await idle();
  await setting('sign').selectOption('fascia');
  await idle();
  await fill(setting('signWidth'), 100);
  await fill(setting('signText'), 'Pit lane');
  assert.equal((await saved()).signText, 'PIT LANE');
  await host.locator('[data-bd-wall="left"]').click();
  await host.locator('[data-bd-add-letters]').click();
  await idle();
  let b = await saved();
  assert.equal(b.lettering.length, 1);
  assert.equal(b.lettering[0].wall, 'left');
  const row = host.locator('[data-lt="0"]');
  await fill(row.locator('[name="ltText"]'), 'Team 7');
  await fill(row.locator('[name="ltHeight"]'), 12);
  await row.locator('[name="ltCut"]').check();
  await idle();
  b = await saved();
  assert.deepEqual([b.lettering[0].text, b.lettering[0].height, b.lettering[0].cut], ['TEAM 7', 12, true]);
  await noError('garage lettering');
  // A letter it has no shape for is refused, and says which.
  // Refused: Save waits until it is put right.
  await row.locator('[name="ltText"]').fill('Équipe');
  await row.locator('[name="ltText"]').press('Tab');
  await page.waitForFunction(() => /no letter for “É”/.test(document.querySelector('#buildings-page .bd-error')?.textContent ?? ''));
  assert.ok(await host.locator('[data-bd="save"]').isDisabled());
  await fill(row.locator('[name="ltText"]'), 'Team 7');
  await noError('back to Team 7');
  await host.locator('[data-bd-view="draw"]').click();
  await host.locator('[data-canvas-wall]').selectOption('left');
  assert.equal(await host.locator('.bd-drawing-letters').textContent(), 'TEAM 7');
  await snap('garage-elevation', '.bd-canvas');
  await host.locator('[data-bd-view="model"]').click();
  await snap('garage');
  const wait = page.waitForEvent('download');
  await host.locator('[data-bd="export"]').click();
  const kit = unzipSync(await readFile(await (await wait).path()));
  assert.match(strFromU8(kit['README.txt']), /“PIT LANE” stands 0\.6 mm proud/);
  assert.match(strFromU8(kit['README.txt']), /Cut lettering on the walls: “TEAM 7”/);
  // Removed again.
  await host.locator('[data-bd-remove-letters="0"]').click();
  await idle();
  assert.equal((await saved()).lettering.length, 0);

  // The container café's roof billboard, its name carved in.
  await host.locator('[data-bd-preset="stall-container"]').click();
  await idle();
  await fill(setting('signText'), 'Pit stop cafe');
  assert.equal((await saved()).signText, 'PIT STOP CAFE');
  await noError('roof billboard');
  await snap('cafe');

  // A billboard by the track.
  await host.locator('[data-bd-preset="billboard"]').click();
  await idle();
  await fill(setting('kText'), 'Foundry oil');
  assert.equal((await saved()).text, 'FOUNDRY OIL');
  await noError('billboard');
  await snap('billboard');
  assert.deepEqual(errors, []);
  console.log('PASS: sign text, wall lettering raised and cut (shown in Draw, named in the README), a carved roof billboard and a lettered billboard.');
} finally {
  await browser.close();
}
