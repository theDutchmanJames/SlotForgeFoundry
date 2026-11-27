// A building round a courtyard on the Buildings page: the courtyard's
// fields, removed and added again, drawn in Draw, in the kit. In a fresh
// offline browser profile.
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
const exportZip = async () => {
  const [download] = await Promise.all([page.waitForEvent('download'), host.locator('[data-bd="export"]').click()]);
  return unzipSync(new Uint8Array(await readFile(await download.path())));
};
try {
  await page.goto(new URL('../dist/index.html?ui-test#track', import.meta.url).href);
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  await page.locator('[data-action="mode-buildings"]').first().click();
  await idle();
  await host.locator('[data-bd-preset="footprint-court"]').click();
  await idle();
  // Its courtyard, and the walls round it among the walls.
  assert.equal(await setting('fc-w-0').inputValue(), '90');
  assert.ok((await host.locator('[data-bd-fp-finish]').textContent()).includes('Courtyard 1, wall 1'));
  // Made wider; too wide, refused.
  await setting('fc-w-0').fill('100');
  await setting('fc-w-0').press('Tab');
  await idle();
  await setting('fc-w-0').fill('200');
  await setting('fc-w-0').press('Tab');
  await host.locator('.bd-error').waitFor({ state: 'visible' });
  assert.match(await host.locator('.bd-error').textContent(), /too near a wall/);
  await setting('fc-w-0').fill('100');
  await setting('fc-w-0').press('Tab');
  await idle();
  // In the kit: the courtyard's walls, and the notes.
  let zip = await exportZip();
  assert.ok(Object.keys(zip).some((n) => /Courtyard 1, wall 1/.test(n)), Object.keys(zip).join(', '));
  assert.match(strFromU8(zip['README.txt']), /Round a courtyard, open to the sky/);
  // Draw shows it.
  await host.locator('[data-bd-view="draw"]').click();
  await host.locator('[data-canvas-mode="plan"]').click();
  assert.equal(await host.locator('.bd-drawing-court').count(), 1);
  await host.locator('[data-bd-view="model"]').click();
  // Removed, with the door and windows into it; added again in the middle.
  await host.locator('[data-bd-fp-remove-court="0"]').click();
  await idle();
  assert.equal(await setting('fc-w-0').count(), 0);
  zip = await exportZip();
  assert.ok(!Object.keys(zip).some((n) => /Courtyard/.test(n)));
  await host.locator('[data-bd-fp-add-court]').click();
  await idle();
  assert.equal(await setting('fc-w-0').count(), 1);
  // A hip roof is refused round a courtyard.
  await setting('fpRoofShape').selectOption('hip');
  await page.waitForFunction(() => /takes a flat roof/.test(document.querySelector('#buildings-page .bd-error')?.textContent ?? ''));
  await setting('fpRoofShape').selectOption('flat');
  await idle();
  // On the hip-roofed timing rotunda, an octagon, + Courtyard makes the roof flat and puts one in.
  await host.locator('[data-bd-preset="timing-rotunda"]').click();
  await idle();
  assert.equal(await setting('fpRoofShape').inputValue(), 'hip');
  await host.locator('[data-bd-fp-add-court]').click();
  await idle();
  assert.equal(await setting('fc-w-0').count(), 1, 'a courtyard in the octagon');
  assert.equal(await setting('fpRoofShape').inputValue(), 'flat');
  assert.deepEqual(errors, []);
  console.log('PASS: a building round a courtyard: on a hip-roofed octagon one added and the roof made flat; made wider, refused too wide, in the kit and in Draw; removed with its openings, added again; no hip roof round it.');
} finally {
  await browser.close();
}
