import assert from 'node:assert/strict';
import { encodeSTL, parseSTL } from '../../src/editor.js';
import { SolidWorkshop } from '../../src/geometry/solids.js';

const centers = [
  [-24, -15],
  [24, -15],
  [24, 15],
  [-24, 15],
];
const heights = [10, 12, 14, 16];

function enclosureSTL(wasm) {
  const work = new SolidWorkshop(wasm);
  const box = (size, at) =>
    work.own(work.own(wasm.Manifold.cube(size)).translate(at));
  const cylinder = (height, radius) =>
    work.own(wasm.Manifold.cylinder(height, radius, radius, 48));
  try {
    const walls = work.cut(box([82, 54, 18], [-41, -27, 0]), [
      box([78, 50, 17], [-39, -25, 2]),
    ]);
    const posts = centers.map(([x, y], i) => {
      const tube = work.cut(cylinder(heights[i], 5), [
        cylinder(heights[i], 1.75),
      ]);
      return work.own(tube.translate([x, y, 0]));
    });
    return Buffer.from(encodeSTL(work.union([walls, ...posts])));
  } finally {
    work.close();
  }
}

export async function checkSteppedPosts({
  wasm,
  page,
  canvas,
  action,
  tab,
  input,
  selectedFaces,
  opCount,
  waitText,
  live,
  upload,
  download,
  downloadSelected,
  openProject,
  snap,
}) {
  await upload('import-context', {
    name: 'Stepped posts.stl',
    mimeType: 'application/octet-stream',
    buffer: enclosureSTL(wasm),
  });
  await waitText('#model-title', 'Stepped posts.stl');
  async function checkHeightRows(targets) {
    const rows = await page
      .locator('[data-face-levels] tbody tr')
      .evaluateAll((nodes) =>
        nodes.map((row) =>
          Array.from(row.cells, (cell) => Number(cell.textContent)),
        ),
      );
    assert.deepEqual(
      rows,
      heights.map((start, i) => [i + 1, start, targets[i], targets[i] - start]),
    );
  }
  async function pickTops() {
    await action('top').click();
    const { width, height } = await canvas.boundingBox();
    const scale = Math.min(width / 82, height / 54) / 1.31;
    for (const [i, [x, y]] of centers.entries()) {
      await canvas.click({
        position: {
          x: width / 2 + (x + 3.4) * scale,
          y: height / 2 - y * scale,
        },
        modifiers: i ? ['Shift'] : [],
      });
      await selectedFaces(i + 1);
    }
    await action('iso').click();
    await tab('move-face').click();
  }
  async function verifyExport(expected) {
    const stl = await downloadSelected();
    const solid = parseSTL(wasm, stl.bytes);
    const heightAt = (x, y) =>
      solid.rayCast([x, y, 30], [x, y, -1])[0]?.position[2];
    try {
      for (const [i, [x, y]] of centers.entries()) {
        assert.ok(
          Math.abs(heightAt(x + 3.4, y) - expected[i]) < 0.002,
          'printed post ' + (i + 1) + ' should be ' + expected[i] + ' mm',
        );
        assert.ok(
          Math.abs(heightAt(x, y) - 2) < 0.002,
          'bore floor on post ' + (i + 1),
        );
      }
      assert.ok(Math.abs(heightAt(0, 26) - 18) < 0.002, 'enclosure wall');
    } finally {
      solid.delete();
    }
  }
  await pickTops();
  await input('faceMoveMode').selectOption('offset');
  await input('faceDistance').fill('-2');
  await live();
  await checkHeightRows([8, 10, 12, 14]);
  await page
    .locator('[data-guide="face-height-3"]')
    .waitFor({ state: 'attached' });
  await snap('unequal-posts-offset');
  await action('apply').click();
  await opCount(1);
  await verifyExport([8, 10, 12, 14]);
  await action('undo').click();
  await opCount(0);
  await verifyExport(heights);
  await pickTops();
  await input('faceMoveMode').selectOption('height');
  await input('faceHeight').fill('17');
  await live();
  assert.ok(await input('separate').isEnabled());
  await input('faceHeight').fill('12');
  await live();
  assert.ok(await input('separate').isDisabled());
  await page
    .locator('[data-guide="common-height-plane"]')
    .waitFor({ state: 'attached' });
  const handle = page.locator('button[data-face-handle]');
  await handle.press('ArrowUp');
  assert.equal(await input('faceHeight').inputValue(), '13');
  await handle.press('ArrowDown');
  assert.equal(await input('faceHeight').inputValue(), '12');
  await live();
  await checkHeightRows([12, 12, 12, 12]);
  await snap('unequal-posts-common');
  await action('apply').click();
  await opCount(1);
  await verifyExport([12, 12, 12, 12]);
  await pickTops();
  await input('faceMoveMode').selectOption('height');
  await input('faceHeight').fill('12');
  await live('unchanged');
  assert.ok(await action('apply').isDisabled());
  const saved = await download(action('save'));
  const ops = JSON.parse(saved.bytes).editor.ops;
  assert.equal(ops.length, 1);
  const [op] = ops;
  assert.equal(op.moveMode, 'height');
  assert.equal(op.faces.length, 4);
  await openProject(saved.bytes, 'level-posts.slotfab');
  await verifyExport([12, 12, 12, 12]);
  await page.locator('[data-op]').first().click();
  assert.equal(await input('faceMoveMode').inputValue(), 'height');
  assert.equal(await input('faceHeight').inputValue(), '12');
  await input('faceHeight').fill('13');
  await live();
  const oldRow = await page.locator('[data-op]').elementHandle();
  await action('apply').click();
  await page.waitForFunction(
    (row) =>
      !row.isConnected &&
      document.querySelector('#app').getAttribute('aria-busy') === 'false',
    oldRow,
  );
  await oldRow.dispose();
  await opCount(1);
  await verifyExport([13, 13, 13, 13]);
  console.log(
    '✓ Unequal screw posts shift by a shared offset or meet one height, including a mixed raise/cut, with intact walls and bores after export and project reload',
  );
}
