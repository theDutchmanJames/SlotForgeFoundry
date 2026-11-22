import assert from 'node:assert/strict';
import { encodeSTL, parseSTL } from '../../src/editor.js';

export async function checkFaceGrid({
  wasm,
  page,
  action,
  tab,
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
  const owned = [],
    own = (s) => (owned.push(s), s);
  try {
    const stock = own(
      own(wasm.Manifold.cube([235, 117, 6])).translate([-117.5, -58.5, 0]),
    );
    const hole = own(
      own(wasm.Manifold.cylinder(8, 4, 4, 48)).translate([-32, -16, -1]),
    );
    const plate = own(stock.subtract(hole));
    await upload('import-context', {
      name: 'Grid plate.stl',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(encodeSTL(plate)),
    });
  } finally {
    owned.reverse().forEach((s) => s.delete());
  }
  await waitText('#model-title', 'Grid plate.stl');
  await action('top').click();
  const viewport = page.locator('#viewport canvas').first(),
    b = await viewport.boundingBox();
  await viewport.click({ position: { x: b.width / 2, y: b.height / 2 } });
  await page.locator('#selection-count[data-count="1"]').waitFor();
  const gridButton = page.locator('.workplane-grid-toggle');
  const visibility = page.locator('[data-grid-visible]');
  const settleFrame = () =>
    page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        ),
    );
  const gridPicture = async (show) => {
    await gridButton.click();
    await visibility.setChecked(show);
    await gridButton.click();
    await settleFrame();
    return viewport.screenshot();
  };
  const hidden = await gridPicture(false);
  const visible = await gridPicture(true);
  assert.ok(
    !hidden.equals(visible),
    'The selected face must show a rendered grid',
  );
  await gridButton.click();
  await page.locator('[data-grid-size]').fill('5');
  await page.locator('[data-grid-edit]').click();
  const dialog = page.locator('dialog.create-sketch');
  const field = (name) => dialog.locator('[data-sk-' + name + ']');
  const dim = (key) => dialog.locator('[data-key="' + key + '"]');
  assert.equal(await field('plane').inputValue(), 'face');
  assert.equal(await field('grid').inputValue(), '5');
  await field('grid').fill('10');
  assert.match(
    await field('grid-info').innerText(),
    /23 × 11.*2\.5 mm X, 3\.5 mm Y/,
  );
  await field('grid').fill('5');
  assert.match(await field('grid-info').innerText(), /47 × 23.*0 mm X, 1 mm Y/);
  await field('exact').click();
  assert.equal(await field('grid').inputValue(), '1');
  await field('density').waitFor({ state: 'visible' });
  assert.match(
    await field('density').innerText(),
    /Grid lines shown every [\d.]+ mm/,
  );
  assert.match(
    await field('grid-info').innerText(),
    /235 × 117.*0 mm X, 0 mm Y/,
  );
  await field('grid').fill('10');
  await field('name').fill('Hole datum');
  await field('fit').click();
  const sketchCanvas = dialog.locator('canvas'),
    f = await sketchCanvas.boundingBox();
  const scale = 0.78 * Math.min(f.width / 235, f.height / 117);
  function clickSketch(x, y) {
    return sketchCanvas.click({
      position: { x: f.width / 2 + x * scale, y: f.height / 2 - y * scale },
    });
  }
  await field('zero').click();
  // Deliberately pick the bore rim instead of its centre.
  await clickSketch(-28, -16);
  assert.equal(await field('placement').inputValue(), 'custom');
  await field('align').click();
  await clickSketch(-117.5, 0);
  assert.match(await field('grid-info').innerText(), /\+X at 90°/);
  await field('reverse').click();
  assert.match(await field('grid-info').innerText(), /\+X at 270°/);
  await field('reverse').click();
  await field('visible').uncheck();
  assert.equal(await field('snap').isChecked(), true);
  await field('visible').check();
  await dialog.locator('[data-sk-tool="rectangle"]').click();
  // The new grid has X pointing north, Y pointing west, and zero at (-32,-16).
  // A raw point slightly off the 10-mm lattice should land at local (20,10).
  await clickSketch(-42.7, 3.4);
  await clickSketch(-52.7, 23.6);
  assert.ok(Math.abs(Number(await dim('x').inputValue()) - 20) < 1e-6);
  assert.ok(Math.abs(Number(await dim('y').inputValue()) - 10) < 1e-6);
  await dim('width').fill('8');
  await dim('height').fill('4');
  await snap('hole-datum-grid');
  await field('finish').click();
  await opCount(1);
  const project = (await download(action('save'))).bytes;
  const [op] = JSON.parse(project).editor.ops;
  assert.equal(op.grid.placement, 'custom');
  assert.equal(op.grid.angle, 90);
  assert.equal(op.grid.pitch, 10);
  assert.equal(op.grid.snap, true);
  const world = ([x, y]) =>
    op.frame.origin.map((p, i) => p + x * op.frame.u[i] + y * op.frame.v[i]);
  const close = (point, expected) =>
    assert.ok(
      point.every((v, i) => Math.abs(v - expected[i]) < 0.001),
      `Expected ${expected}, saw ${point}`,
    );
  close(world(op.grid.origin), [-32, -16, 6]);
  const [rect] = op.sketch.entities;
  assert.equal(rect.angle, 90);
  close(world([rect.x, rect.y]), [-42, 4, 6]);
  await openProject(project, 'face-grid.slotfab');
  await page.locator('[data-op]').filter({ hasText: 'Hole datum' }).click();
  assert.equal(await field('placement').inputValue(), 'custom');
  assert.equal(await field('grid').inputValue(), '10');
  assert.equal(Number(await dim('x').inputValue()), 20);
  assert.equal(Number(await dim('y').inputValue()), 10);
  assert.equal(Number(await dim('width').inputValue()), 8);
  assert.equal(Number(await dim('height').inputValue()), 4);
  await field('finish').click();
  await dialog.waitFor({ state: 'detached' });
  await tab('extrude').first().click();
  await input('creationResult').selectOption('join');
  await input('extrudeDistance').fill('3');
  await live();
  await action('apply').click();
  await opCount(2);
  const part = parseSTL(wasm, (await downloadSelected()).bytes);
  try {
    const top = (x, y) => part.rayCast([x, y, 12], [x, y, -1])[0]?.position[2];
    // The 8-mm dimension runs north from y=4; the 4-mm dimension runs west from x=-42.
    for (const [x, y] of [
      [-45.8, 4.2],
      [-42.2, 11.8],
    ])
      assert.equal(top(x, y), 9);
    for (const [x, y] of [
      [-46.2, 8],
      [-44, 12.2],
      [-41.8, 8],
    ])
      assert.equal(top(x, y), 6);
    assert.equal(top(-32, -16), undefined);
  } finally {
    part.delete();
  }
  console.log(
    '✓ Imported face grid fits physical dimensions, snaps from a picked bore to a rotated edge, and preserves the measured sketch in the reopened and extruded STL',
  );
}
