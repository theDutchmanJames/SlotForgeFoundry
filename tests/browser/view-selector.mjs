import assert from 'node:assert/strict';
import { encodeSTL } from '../../src/editor.js';

export async function checkViewSelector({
  wasm,
  page,
  action,
  opCount,
  upload,
  downloadSelected,
  waitText,
  snap,
}) {
  const box = wasm.Manifold.cube([52, 24, 6]),
    sloped = box.rotate([30, 0, 0]);
  try {
    await upload('import-context', {
      name: 'Angled workplane.stl',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(encodeSTL(sloped)),
    });
  } finally {
    sloped.delete();
    box.delete();
  }
  await waitText('#model-title', 'Angled workplane.stl');
  const selector = page.getByRole('navigation', { name: 'Camera view' });
  const face = selector.locator('[data-action="look-at-face"]');
  assert.ok(await face.isDisabled());
  for (const side of [
    'left',
    'right',
    'front',
    'back',
    'bottom',
    'iso',
    'top',
  ]) {
    const button = selector.locator('[data-action="' + side + '"]');
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
  }
  const before = (await downloadSelected()).bytes;
  const canvas = page.locator('#viewport canvas').first();
  await canvas.click();
  await page
    .locator('.view-selector [data-action="look-at-face"]:enabled')
    .waitFor();
  await face.click();
  assert.equal(await face.getAttribute('aria-pressed'), 'true');
  const axes = page.locator('.camera-axes');
  const directions = await axes.innerHTML();
  await action('iso').click();
  assert.notEqual(await axes.innerHTML(), directions);
  await face.click();
  assert.equal(await axes.innerHTML(), directions);
  await snap('view-along-angled-face');
  const size = page.viewportSize();
  const grid = page.locator('.workplane-grid-toggle');
  try {
    for (const width of [390, 1500]) {
      await page.setViewportSize({ width, height: 844 });
      await grid.click();
      // All settings and camera directions remain accessible while the face
      // grid is open, even on phones where the face action bar wraps.
      const covered = await page.evaluate(() => {
        const buttons = document.querySelectorAll(
          '.view-selector button:enabled, #workplane-grid button:enabled, #face-actions button:enabled',
        );
        return [...buttons]
          .filter((button) => {
            const r = button.getBoundingClientRect();
            if (!r.width || !r.height) return false;
            const hit = document.elementFromPoint(
              r.x + r.width / 2,
              r.y + r.height / 2,
            );
            return !button.contains(hit);
          })
          .map((button) => button.textContent);
      });
      assert.deepEqual(
        covered,
        [],
        'covered camera / grid controls at width ' + width,
      );
      await grid.click();
    }
  } finally {
    await page.setViewportSize(size);
  }
  await opCount(0);
  assert.deepEqual((await downloadSelected()).bytes, before);
  console.log(
    '✓ Seven named camera views and returning straight onto an inclined STL face preserve axes and exported geometry',
  );
}
