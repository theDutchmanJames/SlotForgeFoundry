import assert from 'node:assert/strict';
import { newProject } from '../../src/project.js';
import { checkFlatCrossingExports } from './flat-crossing-exports.mjs';
import { openPackCreator } from './track-pack-creator.mjs';

export async function checkDrawFlatCrossing({
  page,
  action,
  openProject,
  download,
  downloadSelected,
  snap,
}) {
  const project = newProject();
  Object.assign(project.track.params, {
    kind: 'straight',
    width: 60,
    lanes: 2,
    laneSpacing: 25,
    borderSide: 'none',
  });
  await openProject(
    Buffer.from(JSON.stringify(project)),
    'start-figure-eight.slotfab',
  );
  await openPackCreator(page, action, 'Bridge drawing test', {
    packWidth: 60,
    packLanes: 2,
    packLaneSpacing: 25,
    packR1: 100,
    packAngle: 30,
  });
  await page.getByRole('button', { name: 'Freeform path' }).click();
  const dialog = page.locator('dialog.custom-track-editor');
  const field = (name) => dialog.locator('[name="' + name + '"]');
  const points = [
    [-150, -100],
    [150, 100],
    [150, -100],
    [-150, 100],
  ];
  await dialog.locator('[data-ct-name]').fill('Workshop figure eight');
  await field('ctRadius').fill('40');
  for (const [i, point] of points.entries()) {
    if (i < 2) await dialog.locator('[data-ct-point]').selectOption(String(i));
    else await dialog.locator('[data-custom="add"]').click();
    await field('ctX').fill(String(point[0]));
    await field('ctY').fill(String(point[1]));
  }
  await dialog.locator('[data-ct-closed]').check();
  const apply = dialog.locator('[data-custom="apply"]');
  assert.ok(
    await apply.isDisabled(),
    'a crossing needs an explicit print mode',
  );
  assert.match(
    await dialog.locator('[data-ct-status]').innerText(),
    /Crossing detected/,
  );
  await dialog.locator('[data-ct-crossing-mode]').selectOption('flat-pieces');
  const upper = dialog.locator('[data-ct-pass="0"]');
  const highlight = dialog.locator('.ct-upper-arrow');
  const original = await highlight.getAttribute('points');
  await upper.selectOption('first');
  assert.notEqual(await highlight.getAttribute('points'), original);
  await dialog.locator('[data-custom="fit"]').click();
  assert.ok(await apply.isEnabled());
  await snap('draw-flat-figure-eight');
  await apply.click();
  await dialog.waitFor({ state: 'detached' });
  const saved = (await download(action('save'))).bytes;
  const { track } = JSON.parse(saved);
  assert.equal(track.custom.closed, true);
  assert.equal(track.custom.crossingMode, 'flat-pieces');
  assert.equal(track.custom.upperPasses[0], 'first');
  assert.equal(track.plan.flatCrossing.sections.length, 2);
  await openProject(saved, 'workshop-figure-eight.slotfab');
  await checkFlatCrossingExports({
    page,
    action,
    download,
    downloadSelected,
    snap,
  });
  console.log(
    '✓ Detect a drawn figure eight, choose the upper passage, reopen the flat road pieces and export the kit',
  );
}
