import assert from 'node:assert/strict';
import { encodeSTL, parseSTL } from '../../src/editor.js';

export async function checkFinishTools({
  wasm,
  page,
  action,
  input,
  upload,
  downloadSelected,
  opCount,
  live,
  waitText,
  snap,
}) {
  const canvas = page.locator('#viewport canvas').first();
  async function importAndPick(solid, name, size, dx, dy) {
    try {
      await upload('import-context', {
        name,
        mimeType: 'application/octet-stream',
        buffer: Buffer.from(encodeSTL(solid)),
      });
    } finally {
      solid.delete();
    }
    await waitText('#model-title', name);
    await opCount(0);
    await action('top').click();
    const box = await canvas.boundingBox(),
      s = Math.min(box.width / size[0], box.height / size[1]) / 1.31;
    await canvas.click({
      position: { x: box.width / 2 + s * dx, y: box.height / 2 - s * dy },
    });
    await page
      .locator('[data-editor="edge-finish"],[data-tab="edge-finish"]')
      .first()
      .click();
    await page.locator('[data-guide="finish-edge"]').waitFor();
  }
  async function printed() {
    await action('apply').click();
    await opCount(1);
    return parseSTL(wasm, (await downloadSelected()).bytes);
  }
  await importAndPick(
    wasm.Manifold.cube([30, 20, 10]),
    'Bevel block.stl',
    [30, 20],
    0,
    -9.4,
  );
  await input('edgeKind').selectOption('chamfer');
  await input('edgeSize').fill('2');
  await live();
  const bevel = await printed();
  try {
    assert.ok(Math.abs(bevel.volume() - 5940) < 0.01);
  } finally {
    bevel.delete();
  }
  const outer = wasm.Manifold.cylinder(12, 15, 15, 48),
    inner = wasm.Manifold.cylinder(12, 5, 5, 48);
  let ring;
  try {
    ring = outer.subtract(inner);
  } finally {
    outer.delete();
    inner.delete();
  }
  await importAndPick(ring, 'Round bore.stl', [30, 30], 5.4, 0);
  await page
    .locator('.selection-note')
    .filter({ hasText: 'Circular rim' })
    .waitFor();
  await input('edgeKind').selectOption('fillet');
  await input('edgeSize').fill('2');
  await live();
  await action('iso').click();
  await snap('rounded-bore');
  const rounded = await printed();
  try {
    const b = rounded.boundingBox(),
      x = (b.min[0] + b.max[0]) / 2,
      y = (b.min[1] + b.max[1]) / 2;
    for (const sign of [-1, 1]) {
      const at = rounded.rayCast([x + 6 * sign, y, 20], [x + 6 * sign, y, 0])[0]
        .position[2];
      assert.ok(Math.abs(at - (10 + Math.sqrt(3))) < 0.05);
    }
  } finally {
    rounded.delete();
  }
  console.log(
    '✓ Clicked a straight edge and circular bore rim, then measured the bevel and rounded profile in real STL exports',
  );
}
