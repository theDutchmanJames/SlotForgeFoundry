import assert from 'node:assert/strict';
import { parseSTL } from '../../src/editor.js';

export async function checkBracket({
  wasm,
  page,
  action,
  tab,
  input,
  opCount,
  live,
  download,
  downloadSelected,
  openProject,
  waitText,
  snap,
}) {
  await action('new-design').click();
  await waitText('#model-title', 'Untitled design');
  await action('new-sketch').click();
  const sketch = page.locator('dialog.create-sketch');
  await sketch.locator('[data-sk-plane]').selectOption('xz');
  await sketch.locator('[data-sk-name]').fill('Bracket cross section');
  await sketch.locator('[data-sk-tool="lProfile"]').click();
  for (const [key, value] of Object.entries({
    x: 0,
    y: 0,
    width: 40,
    height: 30,
    thickness: 4,
  }))
    await sketch.locator('[data-key="' + key + '"]').fill(String(value));
  await sketch.locator('[data-sk-add]').click();
  await sketch.locator('[data-sk-finish]').click();
  await opCount(1);
  await tab('extrude').first().click();
  await input('extrudeDistance').fill('24');
  await live();
  const handle = page.locator('[data-face-handle]');
  await handle.press('ArrowUp');
  assert.equal(await input('extrudeDistance').inputValue(), '25');
  await handle.press('ArrowDown');
  await live();
  await snap('bracket-extrusion');
  await action('apply').click();
  await opCount(2);
  await action('top').click();
  const canvas = page.locator('#viewport canvas'),
    b = await canvas.boundingBox();
  const scale = Math.min(b.width / 40, b.height / 24) / 1.31;
  // Pick the middle of the lower flange, eight millimetres from the right end.
  await canvas.click({
    position: { x: b.width / 2 + 12 * scale, y: b.height / 2 },
  });
  await tab('hole').click();
  await input('holeFromU').selectOption('max');
  await input('holeU').fill('8');
  await input('holeFromV').selectOption('center');
  await input('holeV').fill('0');
  await input('boreDiameter').fill('3');
  await live();
  await action('apply').click();
  await opCount(3);
  await tab('feature-pattern').click();
  await input('patternKind').selectOption('mirror');
  await input('patternAxis').selectOption('x');
  await live();
  await action('apply').click();
  await opCount(4);
  async function verifyPrint(width) {
    const mesh = parseSTL(
      wasm,
      (await downloadSelected()).bytes,
    );
    try {
      const { min, max } = mesh.boundingBox();
      const y = (min[1] + max[1]) / 2;
      const at = (x) => mesh.rayCast([x, y, max[2] + 1], [x, y, min[2] - 1]);
      for (const x of [min[0] + 8, max[0] - 8]) {
        assert.equal(
          at(x).length,
          0,
          'Mounting hole must stay 8 mm from the outside edge',
        );
        assert.equal(at(x + 1.46).length, 0);
        assert.ok(at(x + 1.52)[0]?.position[2] > 3.99);
      }
      assert.ok(Math.abs(max[0] - min[0] - width) < 1e-5);
      const expected = (width * 4 + 26 * 4) * 24 - 2 * Math.PI * 1.5 ** 2 * 4;
      // The STL approximates each circular bore with a polygon.
      assert.ok(Math.abs(expected - mesh.volume()) < 0.5);
    } finally {
      mesh.delete();
    }
  }
  await verifyPrint(40);
  const saved = (await download(action('save'))).bytes;
  await openProject(saved, 'bracket.slotfab');
  await page.locator('[data-op]').first().click();
  await sketch.locator('[data-key="width"]').fill('70');
  await sketch.locator('[data-sk-finish]').click();
  await sketch.waitFor({ state: 'detached' });
  await waitText('#selected-size', '70 × 24 × 30');
  await verifyPrint(70);
  await action('iso').click();
  await snap('bracket-widened');
  await action('undo').click();
  await waitText('#selected-size', '40 × 24 × 30');
  await verifyPrint(40);

  // Edit history: switch the mirror step off and on, refuse deleting the
  // sketch every later step needs, then delete the mirror step.
  const volume = async () => {
    const mesh = parseSTL(wasm, (await downloadSelected()).bytes);
    try {
      return mesh.volume();
    } finally {
      mesh.delete();
    }
  };
  const full = await volume();
  const rowTool = (n, kind) => page.locator('.op-line').nth(n).locator('[data-op-' + kind + ']');
  await rowTool(3, 'toggle').click();
  await page.locator('.op-line.off').waitFor();
  const oneHole = await volume();
  assert.ok(Math.abs(oneHole - full - Math.PI * 1.5 ** 2 * 4) < 0.5, 'Switching the mirror off must fill the mirrored bore');
  await rowTool(3, 'toggle').click();
  await page.locator('.op-line.off').waitFor({ state: 'detached' });
  assert.ok(Math.abs((await volume()) - full) < 1e-3);
  await rowTool(0, 'delete').click();
  await page.locator('.lp-dialog [data-answer="ok"]').click();
  await waitText('#notice', 'cannot be deleted');
  await opCount(4);
  await rowTool(3, 'delete').click();
  await page.locator('.lp-dialog [data-answer="ok"]').click();
  await opCount(3);
  assert.ok(Math.abs((await volume()) - oneHole) < 1e-3);
  console.log(
    '✓ Created the bracket from a sketch, set extrusion with the handle, mirrored a hole, reopened, widened and measured both edge distances in exported STL; switched off, refused and deleted history steps',
  );
}
