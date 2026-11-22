import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { encodeSTL, parseSTL } from '../../src/editor.js';

export async function checkWallEdge({
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
  const dimensions = [30, 20, 10];
  async function reset(name) {
    const block = wasm.Manifold.cube(dimensions);
    try {
      await upload('import-context', {
        name,
        mimeType: 'application/octet-stream',
        buffer: Buffer.from(encodeSTL(block)),
      });
    } finally {
      block.delete();
    }
    await waitText('#model-title', name);
    await opCount(0);
  }
  async function pick(world, view, modifiers = []) {
    const box = await canvas.boundingBox();
    const back = new Vector3(
      ...(view === 'top' ? [0, -0.00001, 1] : [0.68, -1, 0.95]),
    ).normalize();
    const right = new Vector3(0, 0, 1).cross(back).normalize(),
      up = back.clone().cross(right);
    const size = (v) =>
      dimensions.reduce((s, x, i) => s + x * Math.abs(v.getComponent(i)), 0);
    const scale =
      Math.min(box.width / size(right), box.height / size(up)) / 1.31;
    const p = new Vector3(...world.map((v, i) => v - dimensions[i] / 2));
    await canvas.click({
      position: {
        x: box.width / 2 + scale * p.dot(right),
        y: box.height / 2 - scale * p.dot(up),
      },
      modifiers,
    });
  }
  const tool = (name) =>
    page
      .locator('[data-editor="' + name + '"],[data-tab="' + name + '"]')
      .first();
  await reset('Perimeter.stl');
  await action('top').click();
  await pick([15, 0.06, 10], 'top');
  await tool('edge-finish').click();
  await input('edgeScope').selectOption('loop');
  await input('edgeKind').selectOption('chamfer');
  await input('edgeSize').fill('1');
  await live();
  await waitText('[data-guide="finish-edge"]', '4 edges');
  await action('apply').click();
  await opCount(1);
  let solid = parseSTL(wasm, (await downloadSelected()).bytes);
  try {
    const { min, max } = solid.boundingBox();
    for (const [x, y] of [
      [min[0] + 0.5, 0],
      [max[0] - 0.5, 0],
      [0, min[1] + 0.5],
      [0, max[1] - 0.5],
    ]) {
      assert.ok(
        Math.abs(solid.rayCast([x, y, 30], [x, y, -1])[0].position[2] - 9.5) <
          1e-3,
      );
    }
  } finally {
    solid.delete();
  }
  await reset('Walls.stl');
  await action('iso').click();
  await pick([12, 0, 5], 'iso');
  await pick([30, 12, 5], 'iso', ['Shift']);
  await tool('wall-modify').click();
  await waitText('#settings-form', '2 flat walls selected');
  await input('wallDistance').fill('-0.2');
  await live();
  await input('wallAction').selectOption('draft');
  await input('wallAxis').selectOption('z');
  await input('wallBase').fill('0');
  await input('wallAngle').fill('10');
  await live();
  await page
    .locator('[data-guide="wall-fixed-plane"]')
    .waitFor({ state: 'attached' });
  await snap('draft-adjacent-walls');
  await action('apply').click();
  await opCount(1);
  solid = parseSTL(wasm, (await downloadSelected()).bytes);
  try {
    const xAt = (z) => solid.rayCast([50, 0, z], [-50, 0, z])[0].position[0];
    const yAt = (z) => solid.rayCast([0, -50, z], [0, 50, z])[0].position[1];
    const amount = Math.tan((10 * Math.PI) / 180) * 9.8;
    assert.ok(Math.abs(xAt(9.9) - xAt(0.1) - amount) < 0.001);
    assert.ok(Math.abs(yAt(0.1) - yAt(9.9) - amount) < 0.001);
  } finally {
    solid.delete();
  }
  await page.locator('[data-op]').first().click();
  await waitText('#settings-form', '2 flat walls selected');
  await pick([30, 12, 5], 'iso', ['Shift']);
  await waitText('#settings-form', '1 flat wall selected');
  await action('restore').click();
  await waitText('#settings-form', '2 flat walls selected');
  assert.equal(await input('wallAngle').inputValue(), '10');
  console.log(
    '✓ Selected and chamfered the full lid loop, then Shift-picked perpendicular walls and drafted both about a fixed plane in the printed STL',
  );
}
