// The Buildings page's view tools: look from each side, cut away, measure
// between two points, hide a part, show only one, show all again. WebGL on,
// as the cut-away is drawn with it.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const executablePath = process.env.SLOT_FORGE_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, offline: true });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const output = new URL('../test-results/view-tools/', import.meta.url);
await mkdir(output, { recursive: true });
const host = page.locator('#buildings-page');
const idle = async () => {
  try {
    await page.waitForFunction(() => { const h = document.querySelector('#buildings-page'); return h && h.querySelector('.bd-message').hidden && !h.querySelector('[data-bd="save"]').disabled; }, null, { timeout: 30000 });
  } catch {
    throw Error('Not idle: ' + (await host.locator('.bd-error').textContent()));
  }
};
const snap = (name) => host.locator('.bd-centre').screenshot({ path: fileURLToPath(new URL(name + '.png', output)) });
try {
  await page.goto(new URL('../dist/index.html?ui-test#track', import.meta.url).href);
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  await page.locator('[data-action="mode-buildings"]').first().click();
  await idle();
  await host.locator('[data-bd-preset="hut-brick"]').click();
  await idle();
  assert.ok(await host.locator('[data-bd-viewbar]').isVisible(), 'the view bar in the model view');

  // Look from the front, then the top, then back to the corner.
  await host.locator('[data-bd-look="front"]').click();
  await snap('front');
  await host.locator('[data-bd-look="top"]').click();
  await host.locator('[data-bd-look="iso"]').click();

  // Cut away the top half: look inside.
  await host.locator('[name="cutaway"]').fill('45');
  await snap('cutaway');
  await host.locator('[name="cutaway"]').fill('100');

  // Measure across the front: two clicks on the model.
  await host.locator('[data-bd-look="front"]').click();
  await host.locator('[data-bd-measure]').click();
  assert.equal(await host.locator('[data-bd-measure]').getAttribute('aria-pressed'), 'true');
  const box = await host.locator('.bd-model canvas').boundingBox();
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.6);
  assert.match(await host.locator('[data-bd-measured]').textContent(), /second point/);
  await page.mouse.click(box.x + box.width * 0.65, box.y + box.height * 0.6);
  const measured = await host.locator('[data-bd-measured]').textContent();
  assert.match(measured, /^\d+(\.\d)? mm · across \d+(\.\d)?, back \d+(\.\d)?, up \d+(\.\d)?$/);
  assert.ok(Number(measured.split(' ')[0]) > 10, 'a distance across the front: ' + measured);
  await snap('measure');
  await host.locator('[data-bd-measure]').click();
  assert.equal(await host.locator('[data-bd-measured]').textContent(), '');

  // Hide the roof's left panel, then show only it, then everything.
  assert.equal(await host.locator('[data-bd-hide]').isDisabled(), true, 'nothing chosen to hide');
  await host.locator('[data-bd-part="roof-left"]').click();
  await host.locator('[data-bd-hide]').click();
  assert.ok(await host.locator('[data-bd-part="roof-left"].off').count(), 'the hidden part dimmed in the list');
  assert.equal(await host.locator('[data-bd-showall]').isDisabled(), false);
  await snap('hidden');
  await host.locator('[data-bd-part="chimney"]').click();
  await host.locator('[data-bd-only]').click();
  assert.ok((await host.locator('[data-bd-part].off').count()) > 5, 'all but the chimney hidden');
  await host.locator('[data-bd-showall]').click();
  assert.equal(await host.locator('[data-bd-part].off').count(), 0);
  // Not in Draw.
  await host.locator('[data-bd-view="draw"]').click();
  assert.equal(await host.locator('[data-bd-viewbar]').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('PASS: looked from the front, the top and the corner; cut away; measured across the front; hid a part, showed only one and all again.');
} finally {
  await browser.close();
}
