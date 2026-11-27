// The kit download's extras: a 3MF and the footprint sheets with the STLs;
// the fit test set and downloaded. In a fresh offline browser profile.
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
    await page.waitForFunction(() => { const h = document.querySelector('#buildings-page'); return h && h.querySelector('.bd-message').hidden && !h.querySelector('[data-bd="save"]').disabled; }, null, { timeout: 30000 });
  } catch {
    throw Error('Not idle: ' + (await host.locator('.bd-error').textContent()));
  }
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

  // A brick hut's kit: its STLs, one 3MF with all of them, its footprint on a sheet.
  await host.locator('[data-bd-preset="hut-brick"]').click();
  await idle();
  let zip = await exportZip();
  const names = Object.keys(zip);
  const stls = names.filter((n) => n.endsWith('.stl'));
  assert.ok(names.includes('README.txt'));
  const threeMf = names.find((n) => n.endsWith('.3mf'));
  assert.ok(threeMf, 'a 3MF in the kit: ' + names.join(', '));
  const model = strFromU8(unzipSync(zip[threeMf])['3D/3dmodel.model']);
  assert.equal((model.match(/<object /g) ?? []).length, stls.length, 'an object in the 3MF for each STL');
  assert.ok(names.includes('footprint 1.svg'), 'the footprint sheet');
  assert.match(strFromU8(zip['README.txt']), /Also in the kit\n- Brick hut\.3mf: every part as it prints/);
  assert.match(strFromU8(zip['footprint 1.svg']), /Brick hut · footprint, full size/i);
  assert.match(await page.locator('body').innerText(), /one 3MF on \d+ plates?, the footprint on 1 A4 sheet/);

  // The fit test: three grooves round the clearance set, two parts.
  await host.locator('[data-bd-preset="fit-test"]').click();
  await idle();
  assert.match(await host.locator('[data-bd-fit-tries]').textContent(), /0.1, 0.2, 0.3 mm/);
  await host.locator('[name="ftPlay"]').fill('0.3');
  await host.locator('[name="ftPlay"]').press('Tab');
  await idle();
  assert.match(await host.locator('[data-bd-fit-tries]').textContent(), /0.2, 0.3, 0.4 mm/);
  zip = await exportZip();
  assert.equal(Object.keys(zip).filter((n) => n.endsWith('.stl')).length, 2);
  assert.match(strFromU8(zip['README.txt']), /a clearance of 0.2, 0.3 and 0.4 mm each side/);
  assert.deepEqual(errors, []);
  console.log('PASS: a kit with its 3MF and footprint sheet; the fit test set to 0.3 mm and downloaded.');
} finally {
  await browser.close();
}
