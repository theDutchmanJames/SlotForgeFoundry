// Drawing a shaped building's walls, and choosing several windows at once, in
// the Draw tab of a fresh offline browser profile.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const executablePath = process.env.SLOT_FORGE_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-webgl'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, offline: true });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const output = new URL('../test-results/outline/', import.meta.url);
await mkdir(output, { recursive: true });
const host = page.locator('#buildings-page');
const idle = () => page.waitForFunction(() => { const h = document.querySelector('#buildings-page'); return h && h.querySelector('.bd-message').hidden && !h.querySelector('[data-bd="save"]').disabled; });
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('foundry.building')));
const snap = (name, what = '.bd-centre') => host.locator(what).screenshot({ path: fileURLToPath(new URL(name + '.png', output)) });
const noError = async (what) => assert.equal(await host.locator('.bd-error').isVisible(), false, what + ': ' + (await host.locator('.bd-error').textContent()));
// Drags from the middle of an element by dx, dy screen pixels.
async function drag(locator, dx, dy, shift = false) {
  const box = await locator.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
  await idle();
}
try {
  await page.goto(new URL('../dist/index.html?ui-test#track', import.meta.url).href);
  await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') === 'false');
  await page.locator('[data-action="mode-buildings"]').first().click();
  await idle();

  // An L: its front wall dragged out (up the screen), so it becomes a drawn outline.
  await host.locator('[data-bd-preset="footprint-l"]').click();
  await idle();
  const before = await saved();
  await host.locator('[data-bd-view="draw"]').click();
  await host.locator('[data-canvas-mode="plan"]').click();
  await drag(host.locator('[data-edge="0"]'), 0, -40, true);
  let b = await saved();
  assert.equal(b.shape, 'custom');
  assert.ok(b.depth > before.depth + 5, 'deeper: ' + b.depth);
  assert.equal(b.depth % 5, 0, 'snapped to 5 mm with Shift');
  assert.ok(await host.locator('[name="fp-width"]').isDisabled(), 'a drawn outline sets its own width');
  assert.equal(await host.locator('[name="fpShape"]').inputValue(), 'custom');
  // A bay out of the front wall, then the corner at its start cut at 45°.
  await host.locator('[data-edge="0"]').click({ force: true });
  await host.locator('[data-outline="bay"]').click();
  await idle();
  b = await saved();
  assert.equal(b.points.length, 10);
  assert.match(await host.locator('.bd-drawing-properties strong').textContent(), /^Wall 3/, 'the bay face is chosen');
  await host.locator('[data-corner="0"]').click();
  await host.locator('[data-outline="chamfer"]').click();
  await idle();
  b = await saved();
  assert.equal(b.points.length, 11);
  // Too far in is refused, and says why.
  await host.locator('[data-edge="2"]').click({ force: true });
  await host.locator('[data-outline-depth]').fill('400');
  await host.locator('[data-outline="in"]').click();
  assert.equal((await saved()).points.length, 11);
  assert.match(await host.locator('.bd-error').textContent(), /crosses|too|room/);
  await snap('outline-plan', '.bd-canvas');
  await host.locator('[data-bd="undo"]').click();
  await idle();
  await noError('after undo');
  assert.equal((await saved()).points.length, 10, 'undo takes the cut corner back');
  await host.locator('[data-bd="redo"]').click();
  await idle();

  // Windows on the long back wall: two added, chosen together, mirrored, spaced, copied, removed.
  await host.locator('[data-canvas-mode="wall"]').click();
  const walls = await host.locator('[data-canvas-wall] option').evaluateAll((os) => os.map((o) => [o.value, Number(o.textContent.match(/([\d.]+) mm/)[1])]));
  const [long] = [...walls].sort((p, q) => q[1] - p[1]);
  await host.locator('[data-canvas-wall]').selectOption(long[0]);
  await host.locator('[data-canvas-add="window"]').click();
  await idle();
  await host.locator('[data-canvas-add="window"]').click();
  await idle();
  const on = async () => (await saved()).openings.filter((o) => o.wall === long[0]);
  assert.equal((await on()).length, 2);
  // Shift-click chooses a second; Shift-click again lets it go.
  await host.locator('[data-opening="0"] > rect').last().click();
  await host.locator('[data-opening="1"] > rect').last().click({ modifiers: ['Shift'] });
  assert.match(await host.locator('.bd-chosen').textContent(), /2 chosen/);
  // Both mirrored would overlap the two themselves on this wall: refused, with the reason.
  await host.locator('[data-canvas-group="mirror"]').click();
  await idle();
  assert.equal((await on()).length, 2);
  assert.match(await host.locator('.bd-error').textContent(), /6 mm/);
  await host.locator('[data-opening="1"] > rect').last().click({ modifiers: ['Shift'] });
  assert.match(await host.locator('.bd-chosen').textContent(), /1 chosen/);
  await host.locator('[data-canvas-group="mirror"]').click();
  await idle();
  assert.equal((await on()).length, 3);
  await host.locator('[data-canvas-group="all"]').click();
  assert.match(await host.locator('.bd-chosen').textContent(), /3 chosen/);
  await host.locator('[data-canvas-group="space"]').click();
  await idle();
  const spaced = (await on()).map((o) => o.at).sort((p, q) => p - q);
  const gaps = spaced.slice(1).map((u, i) => u - spaced[i]);
  assert.ok(gaps.every((g) => Math.abs(g - gaps[0]) < 1e-6), 'evenly: ' + gaps);
  // Moved together with the arrow keys.
  const sills = (await on()).map((o) => o.sill);
  await host.locator('.bd-drawing').focus();
  await page.keyboard.press('ArrowUp');
  await idle();
  assert.deepEqual((await on()).map((o) => o.sill), sills.map((z) => z + 1), 'all three up 1 mm');
  await snap('windows-chosen', '.bd-canvas');
  // A click on one of them alone chooses only it.
  await host.locator('[data-opening="0"] > rect').last().click();
  assert.match(await host.locator('.bd-chosen').textContent(), /1 chosen/);
  await host.locator('[data-canvas-group="all"]').click();
  await host.locator('[data-canvas-delete]').click();
  await idle();
  assert.equal((await on()).length, 0);
  await noError('after the windows');
  await host.locator('[data-bd-view="model"]').click();
  await snap('outline-model');
  assert.deepEqual(errors, []);
  console.log('PASS: walls dragged, a bay, a corner cut, an over-far move refused, undo and redo; windows chosen together, mirrored, spaced, moved and removed.');
} finally {
  await browser.close();
}
