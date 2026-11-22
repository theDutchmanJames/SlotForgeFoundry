import assert from 'node:assert/strict';
import { encodeSTL, parseSTL } from '../../src/editor.js';
import { SolidWorkshop } from '../../src/geometry/solids.js';

export async function checkHealStretch({
  wasm,
  page,
  action,
  input,
  opCount,
  live,
  upload,
  download,
  downloadSelected,
  openProject,
  waitText,
  snap,
}) {
  const bench = new SolidWorkshop(wasm),
    own = (value) => bench.own(value);
  try {
    const base = own(wasm.Manifold.cube([52, 20, 5]));
    const rib = own(
      own(wasm.Manifold.cube([5, 14, 6])).translate([23.5, 3, 5]),
    );
    let fixture = own(base.add(rib));
    for (const x of [6, 46]) {
      const bore = own(
        own(wasm.Manifold.cylinder(8, 2, 2, 48)).translate([x, 10, -1]),
      );
      fixture = own(fixture.subtract(bore));
    }
    await upload('import-context', {
      name: 'Ribbed bracket.stl',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(encodeSTL(fixture)),
    });
  } finally {
    bench.close();
  }
  await waitText('#model-title', 'Ribbed bracket.stl');
  await opCount(0);
  await action('top').click();
  await page.locator('#viewport canvas').first().click();
  const choose = (name) =>
    page
      .locator('[data-editor="' + name + '"],[data-tab="' + name + '"]')
      .first()
      .click();
  await choose('heal-feature');
  await live();
  await page.locator('[data-guide="heal-landing"]').waitFor();
  await action('iso').click();
  await snap('heal-rib');
  await action('apply').click();
  await opCount(1);
  await waitText('#selected-size', '52 × 20 × 5');
  await choose('stretch-section');
  await input('stretchAxis').selectOption('x');
  await input('stretchChange').fill('15');
  await live();
  await page.locator('[data-guide="stretch-fixed"]').waitFor();
  await page.locator('[data-guide="stretch-moving"]').waitFor();
  await snap('stretch-bracket');
  await action('apply').click();
  await opCount(2);
  await waitText('#selected-size', '67 × 20 × 5');
  async function checkPrinted() {
    const result = parseSTL(
      wasm,
      (await downloadSelected()).bytes,
    );
    try {
      const bounds = result.boundingBox(),
        y = (bounds.min[1] + bounds.max[1]) / 2;
      const height = (x) =>
        result.rayCast([x, y, 20], [x, y, -1])[0]?.position[2];
      for (const x of [bounds.min[0] + 6, bounds.max[0] - 6]) {
        assert.equal(height(x + 1.95), undefined);
        assert.ok(Math.abs(height(x + 2.05) - 5) < 0.001);
      }
      assert.ok(
        Math.abs(
          result.volume() -
            (67 * 20 * 5 -
              ((2 * 5 * 48) / 2) * 4 * Math.sin((2 * Math.PI) / 48)),
        ) < 0.015,
      );
    } finally {
      result.delete();
    }
  }
  await checkPrinted();
  const saved = (await download(action('save'))).bytes;
  await action('undo').click();
  await waitText('#selected-size', '52 × 20 × 5');
  await openProject(saved, 'healed-and-stretched.slotfab');
  await opCount(2);
  await checkPrinted();
  console.log(
    '✓ Healed an imported rib, stretched between two planes and measured both surviving holes in the exported and reopened bracket',
  );
}
