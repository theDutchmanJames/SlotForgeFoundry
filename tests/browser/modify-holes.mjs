import assert from 'node:assert/strict';
import { encodeSTL, parseSTL } from '../../src/editor.js';

export async function checkModifyHoles({
  wasm,
  page,
  action,
  tab,
  input,
  upload,
  download,
  downloadSelected,
  openProject,
  opCount,
  live,
  waitText,
  snap,
}) {
  const holes = [
    [-19, -9, 1.5],
    [14, -9, 2],
    [-14, 9, 1.5],
    [14, 9, 1.8],
  ];
  const owned = [],
    keep = (s) => (owned.push(s), s);
  try {
    const stock = keep(
      keep(wasm.Manifold.cube([48, 34, 8])).translate([-24, -17, 0]),
    );
    const cutters = holes.map(([x, y, r]) =>
      keep(keep(wasm.Manifold.cylinder(10, r, r, 64)).translate([x, y, -1])),
    );
    const plate = keep(stock.subtract(keep(wasm.Manifold.union(cutters))));
    await upload('import-context', {
      name: 'Four holes.stl',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(encodeSTL(plate)),
    });
  } finally {
    owned.forEach((s) => s.delete());
  }
  await waitText('#model-title', 'Four holes.stl');
  await action('top').click();
  const canvas = page.locator('#viewport canvas').first();
  const b = await canvas.boundingBox();
  const scale = Math.min(b.width / 48, b.height / 34) / 1.31;
  async function pick([x, y, r], shift) {
    await canvas.click({
      position: {
        x: b.width / 2 + (x + r + 0.12) * scale,
        y: b.height / 2 - y * scale,
      },
      modifiers: shift ? ['Shift'] : [],
    });
  }
  for (let i = 0; i < holes.length; i++) await pick(holes[i], i > 0);
  await page.locator('#edge-selection-count[data-count="4"]').waitFor();
  await pick(holes[2], true);
  await page.locator('#edge-selection-count[data-count="3"]').waitFor();
  await pick(holes[2], true);
  await tab('hole-modify').click();
  await waitText('.selection-note', '4 hole rims selected');
  await input('modifyHeadDiameter').fill('11');
  await live('error');
  await page.locator('[data-guide="hole-rim-1"].guide-warning').waitFor();
  assert.ok(await action('apply').isDisabled());
  await opCount(0);
  await input('modifyHeadDiameter').fill('6');
  await input('modifyHeadAngle').fill('82');
  await live();
  await action('iso').click();
  await snap('four-countersinks');
  await action('apply').click();
  await opCount(1);
  const project = await download(action('save'));
  const [operation] = JSON.parse(project.bytes).editor.ops;
  assert.equal(operation.rims.length, 4);
  assert.equal(operation.headAngle, 82);
  async function verify(headDiameter) {
    const solid = parseSTL(
      wasm,
      (await downloadSelected()).bytes,
    );
    try {
      for (const [x, y, r] of holes) {
        assert.equal(
          solid.rayCast([x + r - 0.06, y, 10], [x + r - 0.06, y, -1]).length,
          0,
        );
        const offset = (headDiameter / 2 + r) / 2;
        const z = solid.rayCast([x + offset, y, 10], [x + offset, y, -1])[0]
          .position[2];
        const expected =
          8 - (headDiameter / 2 - offset) / Math.tan((82 * Math.PI) / 360);
        assert.ok(Math.abs(z - expected) < 0.025);
      }
    } finally {
      solid.delete();
    }
  }
  await verify(6);
  await action('undo').click();
  await opCount(0);
  await openProject(project.bytes, 'countersinks.slotfab');
  await page.locator('[data-op]').first().click();
  await waitText('.selection-note', '4 hole rims selected');
  await input('modifyHeadDiameter').fill('7');
  await live();
  await action('apply').click();
  await input('modifyHeadDiameter').waitFor({ state: 'detached' });
  await verify(7);
  console.log(
    '✓ Four independent bore rims on one face toggle, flag a thin margin, countersink as one undoable edit, and keep their seats in exported and reopened geometry',
  );
}
