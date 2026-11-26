// Wall finishes and framed windows in the editor: connected sections, a shaped
// footprint and an ordinary building, in a fresh offline browser profile.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { unzipSync, strFromU8 } from 'fflate';
import { readFile } from 'node:fs/promises';

const executablePath = process.env.SLOT_FORGE_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-webgl'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, offline: true, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const output = new URL('../test-results/shell-finish/', import.meta.url);
await mkdir(output, { recursive: true });
const host = page.locator('#buildings-page');
const idle = () => page.waitForFunction(() => { const h = document.querySelector('#buildings-page'); return h && h.querySelector('.bd-message').hidden && !h.querySelector('[data-bd="save"]').disabled; });
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('foundry.building')));
const setting = (name) => host.locator(`[name="${name}"]`);
const choose = async (name, value) => { await setting(name).selectOption(value); await idle(); };
const edit = async (name, value) => { await setting(name).fill(String(value)); await setting(name).press('Tab'); await idle(); };
const snap = (name) => host.locator('.bd-centre').screenshot({ path: fileURLToPath(new URL(name + '.png', output)) });
const noError = async (what) => assert.equal(await host.locator('.bd-error').isVisible(), false, what + ': ' + (await host.locator('.bd-error').textContent()));
try {
  await page.goto(new URL('../dist/index.html?ui-test#track', import.meta.url).href);
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  await page.locator('[data-action="mode-buildings"]').first().click();
  await idle();

  // Connected sections: the hall in brick with a planked front and a band of blocks.
  await host.locator('[data-bd-preset="connected"]').click();
  await idle();
  await host.locator('[data-bd-section="0"]').click();
  await idle();
  await choose('cs-wallTexture', 'brick');
  await choose('cs-wall-front', 'planks');
  await choose('cs-lowerTexture', 'block');
  assert.ok(await host.locator('[data-bd-sections] [data-bd-lower]').isVisible(), 'the band height shows with a band');
  await edit('cs-lowerHeight', 16);
  await edit('cs-textureScale', 120);
  let b = await saved();
  assert.deepEqual([b.sections[0].wallTexture, b.sections[0].wallTextures, b.sections[0].lowerTexture, b.sections[0].lowerHeight, b.textureScale], ['brick', { front: 'planks' }, 'block', 16, 120]);
  await noError('connected finish');
  // A framed window with panes, in Draw.
  await host.locator('[data-bd-view="draw"]').click();
  await host.locator('[data-canvas-mode="wall"]').click();
  await host.locator('[data-canvas-wall]').selectOption('front');
  await host.locator('[data-canvas-add="window"]').click();
  await idle();
  await host.locator('[data-opening="0"] > rect').last().click();
  // Hard by the corner there is no room for a frame: it says so, and keeps the window as it was.
  await host.locator('[data-opening-frame]').check();
  await idle();
  assert.equal((await saved()).sections[0].openings[0].frame ?? false, false);
  await host.locator('[data-opening="0"] > rect').last().click();
  await host.locator('[data-opening-field="at"]').fill('60');
  await host.locator('[data-opening-field="at"]').press('Tab');
  await idle();
  await host.locator('[data-opening-frame]').check();
  await idle();
  await host.locator('[data-opening-field="across"]').fill('2');
  await host.locator('[data-opening-field="across"]').press('Tab');
  await idle();
  b = await saved();
  assert.deepEqual([b.sections[0].openings[0].frame, b.sections[0].openings[0].across], [true, 2]);
  assert.equal(await host.locator('.bd-drawing-frame').count(), 1);
  assert.equal(await host.locator('.bd-drawing-bars').count(), 1);
  await noError('connected frame');
  await host.locator('[data-bd-view="model"]').click();
  await snap('connected');
  const wait = page.waitForEvent('download');
  await host.locator('[data-bd="export"]').click();
  const kit = unzipSync(await readFile(await (await wait).path()));
  assert.match(strFromU8(kit['README.txt']), /Window and door frames print face up/);
  assert.ok(Object.keys(kit).some((n) => /frame/i.test(n) && n.endsWith('.stl')), 'the frame is in the kit');
  assert.match(strFromU8(kit['glazing.svg']), /Main hall, front window 1/);
  assert.match(strFromU8(kit['README.txt']), /glazing\.svg/);
  // A frame off takes its panes with it.
  await host.locator('[data-bd-view="draw"]').click();
  await host.locator('[data-opening="0"] > rect').last().click();
  await host.locator('[data-opening-frame]').uncheck();
  await idle();
  b = await saved();
  assert.deepEqual([b.sections[0].openings[0].frame, b.sections[0].openings[0].across], [false, 1]);
  await host.locator('[data-bd-view="model"]').click();

  // A shaped footprint: planks, its first wall in brick, a band of bricks.
  await host.locator('[data-bd-preset="footprint-l"]').click();
  await idle();
  await choose('ff-wallTexture', 'planks');
  await choose('ff-wall-edge-1', 'brick');
  await choose('ff-lowerTexture', 'brick');
  await edit('ff-lowerHeight', 14);
  b = await saved();
  assert.deepEqual([b.wallTexture, b.wallTextures, b.lowerTexture, b.lowerHeight], ['planks', { 'edge-1': 'brick' }, 'brick', 14]);
  await noError('footprint finish');
  // A different shape: the walls' fields follow it.
  await choose('fpShape', 'U');
  assert.equal(await host.locator('[name^="ff-wall-edge-"]').count(), 8);
  await snap('footprint');

  // An ordinary building: a brick front and a band of blocks.
  await host.locator('[data-bd-preset="garage"]').click();
  await idle();
  await choose('fw-wall-front', 'brick');
  await choose('fw-lowerTexture', 'block');
  await edit('fw-lowerHeight', 18);
  b = await saved();
  assert.deepEqual([b.wallTextures, b.lowerTexture, b.lowerHeight], [{ front: 'brick' }, 'block', 18]);
  await edit('play', 0.35);
  assert.equal((await saved()).play, 0.35);
  assert.ok(await host.locator('[data-bd-texture-size]').isVisible(), 'the texture size shows for a textured wall');
  await noError('garage finish');
  // The same wall chosen for all of them: it keeps nothing of its own.
  await host.locator('[data-bd-wall-texture="brick"]').click();
  await idle();
  assert.deepEqual((await saved()).wallTextures, {});
  assert.equal(await setting('fw-wall-front').inputValue(), '');
  await choose('fw-wall-left', 'metal');
  await snap('garage');
  assert.deepEqual(errors, []);
  console.log('PASS: wall finishes on sections, footprints and storeys; framed windows with panes in Draw; frames exported with their note.');
} finally {
  await browser.close();
}
