// The Buildings page's side list and settings panel: the standard buildings
// as pictures in groups that fold, a search, the chosen building's parts on
// top; the settings' cards fold, and the folds are remembered.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { BUILDING_PRESETS, PRESET_GROUPS } from '../src/building-presets.js';

const executablePath = process.env.SLOT_FORGE_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-webgl'] });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, offline: true });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const output = new URL('../test-results/layout/', import.meta.url);
await mkdir(output, { recursive: true });
const host = page.locator('#buildings-page');
const idle = () => page.waitForFunction(() => { const h = document.querySelector('#buildings-page'); return h && h.querySelector('.bd-message').hidden && !h.querySelector('[data-bd="save"]').disabled; });
const open = async () => {
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  await page.locator('[data-action="mode-buildings"]').first().click();
  await idle();
};
try {
  await page.goto(new URL('../dist/index.html?ui-test#track', import.meta.url).href);
  await open();
  // Every standard building a picture with its name, in its group.
  assert.equal(await host.locator('.bd-thumb').count(), BUILDING_PRESETS.length);
  assert.equal(await host.locator('.bd-thumb img').count(), BUILDING_PRESETS.length, 'each has its picture');
  assert.ok(await host.locator('.bd-thumb img').first().evaluate((img) => img.src.startsWith('data:image/webp')), 'packed into the app');
  for (const [title, ids] of PRESET_GROUPS) assert.equal(await host.locator(`details[data-bd-fold="${title}"] [data-bd-preset]`).count(), ids.length, title);
  // Chosen: marked, and the list goes back up to its parts, on top.
  const card = host.locator('[data-bd-preset="race-control"]');
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await idle();
  assert.equal(await card.getAttribute('aria-pressed'), 'true');
  await page.waitForFunction(() => document.querySelector('#buildings-page .bd-col').scrollTop === 0);
  assert.ok(Number(await host.locator('[data-bd-part-count]').textContent()) > 30);
  assert.equal(await host.locator('details[data-bd-fold="parts"] .bd-part').first().isVisible(), true);
  await host.locator('.bd-col').screenshot({ path: fileURLToPath(new URL('side.png', output)) });
  // Found by name: only those that match, their groups open; nothing found says so.
  await host.locator('[data-bd-find]').fill('gantry');
  assert.equal(await host.locator('.bd-thumb:visible').count(), BUILDING_PRESETS.filter((p) => /gantry/i.test(p.name + ' ' + p.note)).length);
  await host.locator('[data-bd-find]').fill('zeppelin hangar');
  assert.equal(await host.locator('[data-bd-none]').isVisible(), true);
  await host.locator('[data-bd-find]').fill('');
  assert.equal(await host.locator('.bd-thumb:visible').count(), BUILDING_PRESETS.length);
  // A group folded; a settings card folded, by click and by keyboard; Fold all and Open all.
  await host.locator('details[data-bd-fold="Pit buildings"] > summary').click();
  assert.equal(await host.locator('details[data-bd-fold="Pit buildings"]').evaluate((d) => d.open), false);
  await host.locator('[data-bd-card="size"] > h3').click();
  assert.equal(await host.locator('[name="width"]').isVisible(), false);
  assert.equal(await host.locator('[data-bd-card="size"] > h3').getAttribute('aria-expanded'), 'false');
  await host.locator('[data-bd-card="roof"] > h3').focus();
  await page.keyboard.press('Enter');
  assert.equal(await host.locator('[data-bd-card="roof"]').evaluate((b) => b.classList.contains('bd-shut')), true);
  await host.locator('.bd-panel').screenshot({ path: fileURLToPath(new URL('panel.png', output)) });
  // Remembered when the page comes back.
  await page.reload();
  await open();
  assert.equal(await host.locator('details[data-bd-fold="Pit buildings"]').evaluate((d) => d.open), false, 'the group stays folded');
  assert.equal(await host.locator('[name="width"]').isVisible(), false, 'the card stays folded');
  await host.locator('[data-bd-fold-all="open"]').click();
  assert.equal(await host.locator('[name="width"]').isVisible(), true);
  await host.locator('[data-bd-fold-all="shut"]').click();
  assert.equal(await host.locator('.bd-box.bd-shut').count(), await host.locator('.bd-box > h3.bd-fold-title').count());
  await host.locator('[data-bd-fold-all="open"]').click();
  assert.deepEqual(errors, []);
  console.log('PASS: standard buildings as pictures in folding groups, found by name; the chosen one marked, its parts on top; settings cards fold by click, keyboard and all at once, and stay folded.');
} finally {
  await browser.close();
}
