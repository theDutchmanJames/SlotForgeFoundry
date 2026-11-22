import assert from 'node:assert/strict';
import { encodeSTL, parseSTL } from '../../src/editor.js';

export async function checkSolidTools({
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
  const canvas = page.locator('#viewport canvas').first();
  async function importSolid(solid, name) {
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
  }
  async function pickCenter() {
    const { width, height } = await canvas.boundingBox();
    await canvas.click({ position: { x: width / 2, y: height / 2 } });
    await page.locator('#selection-count[data-count="1"]').waitFor();
  }
  async function printed() {
    return parseSTL(wasm, (await downloadSelected()).bytes);
  }
  await importSolid(wasm.Manifold.cube([36, 24, 12]), 'Solid block.stl');
  await pickCenter();
  await tab('hollow').click();
  await input('wallThickness').fill('1.5');
  await live();
  await action('iso').click();
  await snap('hollow-opening');
  await action('apply').click();
  await opCount(1);
  const shell = await printed();
  try {
    assert.ok(
      Math.abs(shell.volume() - (36 * 24 * 12 - 33 * 21 * 10.5)) < 0.01,
    );
    const { min, max } = shell.boundingBox();
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
    assert.ok(
      Math.abs(
        shell.rayCast([...center, 16], [...center, -1])[0].position[2] - 1.5,
      ) < 0.001,
    );
  } finally {
    shell.delete();
  }
  await action('undo').click();
  await opCount(0);
  await action('top').click();
  await pickCenter();
  await tab('text').click();
  await input('labelText').fill('B8');
  await input('textHeight').fill('5');
  await input('depth').fill('1');
  await live();
  const handle = page.locator('[data-text-handle]');
  const pos = await handle.boundingBox();
  await page.mouse.move(pos.x + pos.width / 2, pos.y + pos.height / 2);
  await page.mouse.down();
  await page.mouse.move(pos.x + pos.width / 2 + 16, pos.y + pos.height / 2, {
    steps: 3,
  });
  await page.mouse.up();
  assert.ok((await input('dx').inputValue()) > 0);
  await live();
  await action('iso').click();
  await snap('editable-lettering');
  await action('apply').click();
  await opCount(1);
  const raised = await printed();
  try {
    assert.ok(raised.volume() > 36 * 24 * 12);
    assert.equal(raised.boundingBox().max[2], 13);
  } finally {
    raised.delete();
  }
  const file = await download(action('save'));
  await openProject(file.bytes, 'lettering.slotfab');
  await page.locator('[data-op]').first().click();
  assert.equal(await input('labelText').inputValue(), 'B8');
  await input('separate').check();
  await live();
  await action('apply').click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-part]').length === 2 &&
      document.querySelector('#app').getAttribute('aria-busy') === 'false',
  );
  const letters = await printed();
  try {
    assert.ok(letters.volume() > 0 && letters.volume() < 36 * 24);
    assert.ok(Math.abs(letters.boundingBox().max[2] - 1) < 0.001);
  } finally {
    letters.delete();
  }
  await openProject(file.bytes, 'joined-lettering.slotfab');
  await page.locator('[data-op]').first().click();
  await input('textMethod').selectOption('cut');
  await live();
  assert.ok(await input('separate').isDisabled());
  const old = await page.locator('[data-op]').first().elementHandle();
  await action('apply').click();
  await page.waitForFunction(
    (row) =>
      !row.isConnected &&
      document.querySelector('#app').getAttribute('aria-busy') === 'false',
    old,
  );
  await old.dispose();
  const engraved = await printed();
  try {
    assert.ok(engraved.volume() < 36 * 24 * 12);
    assert.equal(engraved.boundingBox().max[2], 12);
  } finally {
    engraved.delete();
  }

  const sphere = wasm.Manifold.sphere(20, 72),
    before = sphere.numTri();
  await importSolid(sphere, 'Dense sphere.stl');
  await tab('simplify').click();
  await input('maxDeviation').fill('1');
  await input('triangleTarget').fill('1400');
  await live();
  await page
    .locator('.silhouette-comparison canvas[data-ready="true"]')
    .waitFor();
  await page.locator('[data-silhouette-view]').selectOption('front');
  await page
    .locator('.silhouette-comparison canvas[data-ready="true"]')
    .waitFor();
  await snap('simplification-comparison');
  await action('apply').click();
  await opCount(1);
  const reduced = await printed();
  try {
    assert.ok(reduced.numTri() <= 1400 && reduced.numTri() < before);
  } finally {
    reduced.delete();
  }
  console.log(
    '✓ Hollow from a face, drag/edit raised and engraved lettering, and simplify a dense STL with silhouette comparison and printable exports',
  );
}
