import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';

// The Buildings page: a one-car garage as a kit, its model, its plates, the
// kit download and the Library shelf.
export async function checkBuildings({ page, action, download, snap }) {
  const host = page.locator('#buildings-page');
  const bd = (k) => host.locator('[data-bd="' + k + '"]');
  const setting = (name) => host.locator('form.bd-form [name="' + name + '"]');
  await action('mode-buildings').click();
  await host.waitFor();
  // The model is built: seven parts, and the filament it takes.
  await page.waitForFunction(() => /g filament/.test(document.querySelector('[data-bd-chips]')?.textContent));
  assert.match(await host.locator('[data-bd-chips]').textContent(), /^7 parts/);
  assert.match(await host.locator('[data-bd-fit]').textContent(), /^Fits a \d+ × \d+ plate$/);
  assert.equal(await host.locator('.bd-parts [data-bd-part]').count(), 7);
  await snap('buildings');
  // Exploded: the parts come apart to show how they fit, and back together.
  const apart = host.locator('.bd-apart input');
  await apart.fill('100');
  await snap('buildings-exploded');
  await apart.fill('0');
  // Wider than the plate: the base, the roof and the long walls are cut into pieces that fit.
  await setting('width').fill('230');
  await setting('width').press('Tab');
  await host.locator('[data-bd-part="base-1"]').waitFor();
  assert.match(await host.locator('[data-bd-fit]').textContent(), /^Fits a \d+ × \d+ plate$/);
  assert.ok(await host.locator('[data-bd-fitting]').isVisible());
  // A door wider than the wall is refused, with the most it can be.
  await setting('width').fill('80');
  await setting('width').press('Tab');
  await host.locator('.bd-error').waitFor();
  assert.match(await host.locator('.bd-error').textContent(), /door is too wide for this building: at most 62 mm/);
  await setting('width').fill('120');
  await setting('width').press('Tab');
  await host.locator('.bd-error').waitFor({ state: 'hidden' });
  // Without a door the kit has six parts.
  await setting('door').selectOption('open');
  await page.waitForFunction(() => /^6 parts/.test(document.querySelector('[data-bd-chips]').textContent));
  await setting('door').selectOption('roller');
  await page.waitForFunction(() => /^7 parts/.test(document.querySelector('[data-bd-chips]').textContent));
  // Every part on a plate of its own.
  await host.locator('[data-bd-view="plate"]').click();
  assert.equal(await host.locator('.bd-plates .bd-plate').count(), 7);
  assert.ok(await apart.isHidden(), 'the exploded view belongs to the model');
  await host.locator('[data-bd-view="model"]').click();
  // The kit: an STL for each part as it prints, and the notes.
  await host.locator('[name="buildingName"]').fill('Test garage');
  const kit = await download(bd('export'));
  assert.equal(kit.name, 'Test garage kit.zip');
  const files = unzipSync(new Uint8Array(kit.bytes));
  const stls = Object.keys(files).filter((n) => n.endsWith('.stl'));
  assert.deepEqual(stls, ['01 Base plate.stl', '02 Front wall.stl', '03 Back wall.stl', '04 Left wall.stl', '05 Right wall.stl', '06 Flat roof.stl', '07 Roller door.stl']);
  for (const n of stls) {
    const bytes = files[n];
    const count = new DataView(bytes.buffer, bytes.byteOffset).getUint32(80, true);
    assert.equal(bytes.length, 84 + 50 * count, n);
  }
  assert.match(strFromU8(files['README.txt']), /Test garage · SlotForge Foundry building kit[\s\S]*without supports/);
  // Saved in the Library, on the Buildings shelf, and opened again from there.
  await bd('save').click();
  await host.locator('.bd-saved [data-bd-open]').first().waitFor();
  await action('mode-library').click();
  await page.locator('[data-lp-shelf="buildings"]').click();
  const card = page.locator('#library-page .lp-card').filter({ hasText: 'Test garage' });
  await card.waitFor();
  await card.locator('[data-lp="open-building"]').click();
  await host.waitFor();
  assert.equal(await host.locator('[name="buildingName"]').inputValue(), 'Test garage');
  assert.equal(await action('mode-buildings').getAttribute('aria-pressed'), 'true');
  // A two-sided roof: two panels in place of the flat roof.
  const partCount = (n) => page.waitForFunction((n) => new RegExp('^' + n + ' parts').test(document.querySelector('[data-bd-chips]').textContent), n);
  await host.locator('[data-bd-roof="gable"]').click();
  await partCount(8);
  assert.deepEqual(
    await host.locator('.bd-parts [data-bd-part^="roof"]').evaluateAll((parts) => parts.map((p) => p.dataset.bdPart)),
    ['roof-left', 'roof-right'],
  );
  assert.ok(await setting('pitch').isVisible());
  assert.ok(await setting('ridge').isVisible());
  // Bricks on the walls and tiles on the roof: the parts stay the same, cut.
  const built = () => page.waitForFunction(() => document.querySelector('.bd-message').hidden);
  assert.ok(await host.locator('[data-bd-texture-size]').isHidden());
  await host.locator('[data-bd-wall-texture="brick"]').click();
  await built();
  await host.locator('[data-bd-roof-texture="tile"]').click();
  await built();
  assert.equal(await host.locator('[data-bd-wall-texture="brick"]').getAttribute('aria-pressed'), 'true');
  assert.ok(await host.locator('[data-bd-texture-size]').isVisible());
  await partCount(8);
  await setting('textureDepth').fill('2');
  await setting('textureDepth').press('Tab');
  await host.locator('.bd-error').waitFor();
  assert.match(await host.locator('.bd-error').textContent(), /Joint depth must be between 0.3 and 1 mm/);
  await setting('textureDepth').fill('0.5');
  await setting('textureDepth').press('Tab');
  await host.locator('.bd-error').waitFor({ state: 'hidden' });
  await host.locator('[data-bd-wall-texture="plain"]').click();
  await built();
  await host.locator('[data-bd-roof-texture="plain"]').click();
  await built();
  // A window in the left wall: a hole, and with a frame a part of its own.
  await host.locator('[data-bd-wall="left"]').click();
  await host.locator('[data-bd-add="window"]').click();
  await host.locator('.bd-opening').waitFor();
  await partCount(8);
  await host.locator('.bd-opening [name="frame"]').check();
  await partCount(9);
  assert.match(await host.locator('[data-bd-part="frame-1"]').textContent(), /Left window frame/);
  // Placed too high, it is refused with how high it can go.
  await host.locator('.bd-opening [name="sill"]').fill('60');
  await host.locator('.bd-opening [name="sill"]').press('Tab');
  await host.locator('.bd-error').waitFor();
  assert.match(await host.locator('.bd-error').textContent(), /left window reaches too high: its top can be at most 69 mm/);
  await host.locator('.bd-opening [name="sill"]').fill('25');
  await host.locator('.bd-opening [name="sill"]').press('Tab');
  await host.locator('.bd-error').waitFor({ state: 'hidden' });
  // Removed again, and back to a flat roof.
  await host.locator('[data-bd-remove]').click();
  await partCount(8);
  await host.locator('[data-bd-roof="flat"]').click();
  await partCount(7);
  assert.ok(await setting('pitch').isHidden());
  // A 200 × 200 garage on a 150 × 150 plate: the parts are cut into pieces
  // that fit, and each cut can be moved within its range.
  await page.evaluate(() => localStorage.setItem('foundry.settings', JSON.stringify({ plate: { width: 150, depth: 150, margin: 0 } })));
  await setting('width').fill('200');
  await setting('depth').fill('200');
  await setting('depth').press('Tab');
  await host.locator('[data-bd-fitting]').waitFor();
  await page.waitForFunction(() => /^1[5-9] parts|^2\d parts/.test(document.querySelector('[data-bd-chips]').textContent));
  assert.match(await host.locator('[data-bd-fit]').textContent(), /^Fits a 150 × 150 plate$/);
  assert.match(await host.locator('[data-bd-part="front-1"]').textContent(), /Front wall 1 of 2/);
  const frontCut = host.locator('[name="cut-front-0"]');
  assert.equal(await frontCut.inputValue(), '100');
  await frontCut.fill('20');
  await frontCut.press('Tab');
  await host.locator('.bd-error').waitFor();
  assert.match(await host.locator('.bd-error').textContent(), /Front wall: cut 1 at 20 mm leaves a piece that does not fit the plate/);
  await frontCut.fill('80');
  await frontCut.press('Tab');
  await host.locator('.bd-error').waitFor({ state: 'hidden' });
  await host.locator('[data-bd-even="front"]').click();
  await page.waitForFunction(() => document.querySelector('[name="cut-front-0"]').value === '100');
  // Back to the default garage on the plate from Settings.
  await page.evaluate(() => localStorage.removeItem('foundry.settings'));
  await setting('width').fill('120');
  await setting('depth').fill('180');
  await setting('depth').press('Tab');
  await host.locator('[data-bd-fitting]').waitFor({ state: 'hidden' });
  // A second storey: a floor and four walls of its own, which stay on the storey below.
  await host.locator('[data-bd-add-storey]').click();
  await partCount(12);
  assert.match(await host.locator('[data-bd-part="floor2"]').textContent(), /Floor of storey 2/);
  assert.equal(await host.locator('[data-bd-storey="1"]').getAttribute('aria-pressed'), 'true');
  await setting('upWidth').fill('140');
  await setting('upWidth').press('Tab');
  await host.locator('.bd-error').waitFor();
  assert.match(await host.locator('.bd-error').textContent(), /Storey 2: Width must be between 60 and 120 mm/);
  await setting('upWidth').fill('100');
  await setting('upX').fill('10');
  await setting('upX').press('Tab');
  await host.locator('.bd-error').waitFor({ state: 'hidden' });
  // Its windows and wall texture are its own.
  await host.locator('[data-bd-wall="front"]').click();
  await host.locator('[data-bd-add="window"]').click();
  await host.locator('.bd-openings .bd-opening').waitFor();
  await host.locator('.bd-openings .bd-opening [name="frame"]').check();
  await partCount(13);
  assert.match(await host.locator('[data-bd-part="frame2-1"]').textContent(), /Front window frame, storey 2/);
  await host.locator('[data-bd-storey="0"]').click();
  assert.match(await host.locator('.bd-openings').textContent(), /No windows or doors in the front wall of the ground floor/);
  await host.locator('[data-bd-storey="1"]').click();
  await host.locator('[data-bd-remove-storey]').click();
  await partCount(7);
  // Close the last notice, as the next checks expect none.
  if (await page.locator('#notice').isVisible()) await page.locator('#notice').click();
  console.log('✓ Buildings: a garage kit is built, checked, exported as STLs with notes, saved and opened from the Library; a two-sided roof, a framed window, textures and a second storey change its parts; on a small plate the parts are cut into pieces that fit');
}
