import { selectTrackPart } from './part-outline.mjs';
import assert from 'node:assert/strict';
import { newProject } from '../../src/project.js';
import { parseSTL } from '../../src/editor.js';

export async function checkImportFlatCrossing({
  page,
  action,
  openProject,
  upload,
  download,
  downloadSelected,
  waitText,
  snap,
  wasm,
}) {
  const project = newProject();
  const svg = `<svg width="400mm" height="400mm" viewBox="0 0 400 400">
    <g id="SLOT_CENTRES"><path d="M20 200H380 M200 20V380"/></g>
    <g id="TABLE"><rect x="0" y="0" width="400" height="400"/></g></svg>`;
  const file = {
    name: 'Routed crossing.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(svg),
  };
  await openProject(
    Buffer.from(JSON.stringify(project)),
    'start-import-crossing.slotfab',
  );
  await upload('import-context', file);
  const dialog = page.locator('#flat-import'),
    width = dialog.locator('[name="passageWidth"]');
  await waitText('#flat-import', '1 crossing · 2 separate flat passages');
  assert.ok(
    await dialog.getByRole('button', { name: 'Use original deck' }).isVisible(),
  );
  await width.fill('3');
  await waitText('#flat-import', 'width above');
  assert.ok(await dialog.locator('[data-flat-install]').isDisabled());
  await width.fill('40');
  await waitText('#flat-import', '1 crossing · 2 separate flat passages');
  await snap('import-flat-routed-crossing');
  await dialog.locator('[data-flat-install]').click();
  await waitText('#model-title', 'Routed crossing');
  assert.equal(await page.locator('#parts [data-part^="road-"]').count(), 2);
  const saved = (await download(action('save'))).bytes;
  const { track } = JSON.parse(saved);
  assert.equal(track.plan.flatCrossing.independentRoutes, true);
  assert.equal(track.params.width, 40);
  await openProject(saved, 'routed-crossing.slotfab');
  for (const id of ['road-1', 'road-2']) {
    await selectTrackPart(page.locator(`[data-part="${id}"]`));
    const mesh = parseSTL(
      wasm,
      (await downloadSelected()).bytes,
    );
    try {
      const { min, max } = mesh.boundingBox();
      assert.ok(Math.abs(min[2]) < 0.001);
      assert.ok(Math.abs(max[2] - track.params.height) < 0.001);
      const xy = [max[0] - min[0], max[1] - min[1]].sort((a, b) => a - b);
      assert.ok(
        Math.abs(xy[0] - 40) < 0.001 && Math.abs(xy[1] - 360) < 0.001,
        'each passage is a single straight with its own deck footprint',
      );
    } finally {
      mesh.delete();
    }
  }
  await upload('import-context', file);
  await dialog.locator('[data-flat-original]').click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('#parts [data-part]').length === 1 &&
      document.querySelector('#app').getAttribute('aria-busy') === 'false',
  );
  const panel = JSON.parse((await download(action('save'))).bytes);
  assert.equal(panel.track.plan.flatCrossing, undefined);
  assert.deepEqual(panel.track.plan.outlines, panel.track.plan.tables);
  console.log(
    '✓ Import a routed crossing, set passage width, save, reopen and print separate flat STLs or keep the original table panel',
  );
}
