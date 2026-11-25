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
  // Wider than the plate: the base and the roof say so.
  await setting('width').fill('230');
  await setting('width').press('Tab');
  await page.waitForFunction(() => /larger than the plate/.test(document.querySelector('[data-bd-fit]').textContent));
  assert.ok(await host.locator('[data-bd-part="base"]').evaluate((b) => b.classList.contains('big')));
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
  // Close the last notice, as the next checks expect none.
  if (await page.locator('#notice').isVisible()) await page.locator('#notice').click();
  console.log('✓ Buildings: a garage kit is built, checked, exported as STLs with notes, saved and opened from the Library');
}
