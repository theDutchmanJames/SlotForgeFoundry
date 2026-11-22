import assert from 'node:assert/strict';
import { encodeSTL, parseSTL } from '../../src/editor.js';

export async function checkMeshWorkbench({
  wasm,
  page,
  action,
  opCount,
  upload,
  download,
  downloadSelected,
  openProject,
  waitText,
  snap,
}) {
  const cube = wasm.Manifold.cube([12, 12, 12]),
    sphere = wasm.Manifold.sphere(12, 28);
  let broken, scan;
  try {
    const file = Buffer.from(encodeSTL(cube));
    broken = file.subarray(0, file.length - 50);
    broken.writeUInt32LE((broken.length - 84) / 50, 80);
    scan = Buffer.from(encodeSTL(sphere));
  } finally {
    cube.delete();
    sphere.delete();
  }
  const dropped = {
    name: 'Torn shell.stl',
    mimeType: 'application/octet-stream',
    buffer: broken,
  };
  const dialog = page.locator('dialog.mesh-workbench');
  const enabled = () =>
    page.waitForFunction(
      () =>
        document.querySelector('dialog.mesh-workbench [data-accept]')
          ?.disabled === false,
    );
  const oldTitle = await page.locator('#model-title').textContent();
  const second = Buffer.from(broken.subarray(84));
  for (let i = 0; i < second.length; i += 50)
    for (const j of [12, 24, 36])
      second.writeFloatLE(second.readFloatLE(i + j) + 22, i + j);
  const two = Buffer.concat([broken, second]);
  two.writeUInt32LE((two.length - 84) / 50, 80);
  await upload('import-context', { ...dropped, buffer: two });
  await dialog.waitFor();
  assert.match(await dialog.textContent(), /2 open boundaries/);
  const target = await page.waitForFunction(() => {
    const path = document.querySelector(
      'dialog.mesh-workbench[data-review-state="ready"] path[data-boundary="1"]',
    );
    if (!path) return false;
    for (const t of [0.21, 0.42, 0.67, 0.85]) {
      const point = path
        .getPointAtLength(path.getTotalLength() * t)
        .matrixTransform(path.getScreenCTM());
      if (document.elementFromPoint(point.x, point.y) === path)
        return [point.x, point.y];
    }
    return false;
  });
  const pt = await target.jsonValue();
  await target.dispose();
  await page.mouse.move(...pt);
  await page.mouse.down();
  await dialog.evaluate(async (el) => {
    el.querySelector('[data-loop]').dispatchEvent(new Event('input'));
    await new Promise((done) =>
      requestAnimationFrame(() => requestAnimationFrame(done)),
    );
  });
  await page.mouse.up();
  assert.equal(await dialog.locator('[data-loop]').inputValue(), '2');
  assert.equal(await dialog.locator('[data-shell]').inputValue(), '2');
  assert.ok(await dialog.locator('[data-accept]').isDisabled());
  await dialog.locator('footer [data-cancel]').click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await page.locator('#model-title').textContent(), oldTitle);
  await upload('inspect-stl', dropped);
  await dialog.locator('[data-fill]').check();
  await enabled();
  await dialog.getByRole('button', { name: 'Section view' }).click();
  await dialog.locator('.section-controls[data-state="ready"]').waitFor();
  await snap('repair-boundary');
  await dialog.locator('[data-accept]').click();
  await dialog.waitFor({ state: 'detached' });
  await waitText('#model-title', 'Torn shell.stl');
  const repaired = await downloadSelected();
  const solid = parseSTL(wasm, repaired.bytes);
  try {
    assert.ok(Math.abs(solid.volume() - 1728) < 0.01);
  } finally {
    solid.delete();
  }
  await upload('import-context', {
    name: 'Sphere scan.stl',
    mimeType: 'application/octet-stream',
    buffer: scan,
  });
  await waitText('#model-title', 'Sphere scan.stl');
  await action('surface-brush').click();
  const canvas = dialog.locator('[data-view="0"] canvas');
  await canvas.waitFor();
  const size = await canvas.boundingBox();
  await canvas.click({ position: { x: size.width / 2, y: size.height / 2 } });
  await page.waitForFunction(
    () =>
      parseInt(
        document.querySelector('dialog.mesh-workbench [data-count]')
          ?.textContent,
      ) > 0,
  );
  await dialog.locator('[data-grow]').click();
  await dialog.locator('[data-shrink]').click();
  await dialog.locator('[data-clear]').click();
  await dialog.locator('[data-paint]').selectOption('lasso');
  const x = size.x + size.width / 2,
    y = size.y + size.height / 2;
  const span = Math.min(size.height, size.width) * 0.2;
  await page.mouse.move(x - span, y - span);
  await page.mouse.down();
  for (const [dx, dy] of [
    [span, -span],
    [span, span],
    [-span, span],
    [-span, -span],
  ])
    await page.mouse.move(x + dx, y + dy, { steps: 3 });
  await page.mouse.up();
  await enabled();
  await snap('smooth-scan');
  await dialog.locator('[data-accept]').click();
  await opCount(1);
  await dialog.waitFor({ state: 'detached' });
  const saved = await download(action('save'));
  const originalFileSolid = parseSTL(wasm, scan);
  try {
    const printed = await downloadSelected();
    const edited = parseSTL(wasm, printed.bytes);
    try {
      assert.ok(edited.volume() < originalFileSolid.volume() - 0.01);
    } finally {
      edited.delete();
    }
  } finally {
    originalFileSolid.delete();
  }
  await openProject(saved.bytes, 'smoothed.slotfab');
  await page.locator('[data-op]').first().click();
  await enabled();
  assert.equal(await dialog.locator('[data-method]').inputValue(), 'smooth');
  await dialog.locator('footer [data-cancel]').click();
  await dialog.waitFor({ state: 'detached' });
  console.log(
    '✓ Damaged STL repair, live section, lasso and brush, grow/shrink, smoothing, STL export and editable history round trip',
  );
}
