import assert from 'node:assert/strict';
import { newProject } from '../../src/project.js';

export async function checkShapedTrack({
  page,
  action,
  tab,
  input,
  live,
  openProject,
  download,
}) {
  const project = newProject();
  Object.assign(project.track.params, {
    kind: 'straight',
    length: 420,
    width: 200,
    laneSpacing: 100,
    lanes: 2,
    segments: 2,
    borderSide: 'both',
    borderSegments: 1,
    borderEntry: 36,
    borderExit: 36,
    borderApex: 36,
    joint: 'none',
    borderJoint: 'none',
    borderMount: 'none',
  });
  await openProject(
    Buffer.from(JSON.stringify(project)),
    'corner-exit.slotfab',
  );
  await tab('geometry').click();
  await input('laneMode').selectOption('squeeze');
  await input('laneMiddle').fill('40');
  await live();
  await tab('borders').click();
  const section = input('outerFinishShape').locator('xpath=ancestor::details');
  if ((await section.getAttribute('open')) === null)
    await section.locator('summary').click();
  await input('outerFinishShape').selectOption('s-curve');
  await input('outerFinishLength').selectOption('long');
  await input('outerFinishDistance').fill('184');
  await input('innerStartShape').selectOption('rounded');
  await input('innerStartDistance').fill('25');
  await live();
  const tip = page.getByRole('slider', {
    name: 'Outside finish tip',
    exact: true,
  });
  await tip.press('ArrowRight');
  assert.equal(await input('outerFinishDistance').inputValue(), '185');
  await live();
  await action('apply').click();
  await live('idle');
  const { bytes } = await download(action('save'));
  const p = JSON.parse(bytes).track.params;
  assert.deepEqual(p.laneAdjustment, {
    version: 1,
    mode: 'squeeze',
    spacingMm: 40,
    anchor: 'centre',
  });
  assert.deepEqual(p.borderEnds.outer.finish, {
    shape: 's-curve',
    length: 'long',
    at: 185 / 420,
  });
  assert.equal(p.borderEnds.inner.start.at, 25 / 420);
  await openProject(bytes, 'reopened.slotfab');
  await tab('borders').click();
  assert.equal(await input('outerFinishDistance').inputValue(), '185');
  await tab('geometry').click();
  await input('laneMode').selectOption('spread');
  assert.equal(await input('laneMiddle').inputValue(), '115');
  await live();
  await action('restore').click();
  await live('idle');
  assert.equal(await input('laneMode').inputValue(), 'squeeze');

  // The proposed corner once failed because its inner (unoccupied) edge
  // is only 62.83 mm long. The two centred Carrera pockets have ample room.
  Object.assign(project.track.params, {
    kind: 'straight', length: 400, radius: 220, angle: 30,
    width: 200, lanes: 2, laneSpacing: 85, height: 10,
    borderSide: 'none', segments: 1, joint: 'clips',
    jointStart: 'clips', jointEnd: 'clips', clipType: 'carrera-retained',
  });
  await openProject(Buffer.from(JSON.stringify(project)), 'carrera-straight.slotfab');
  await tab('geometry').click();
  await input('kind').selectOption('curve');
  await live();
  assert.equal(await page.locator('[data-action="view-fit-warning"]').isVisible(), false);
  await action('apply').click();
  await live('idle');
  const corner = JSON.parse((await download(action('save'))).bytes).track.params;
  assert.equal(corner.kind, 'curve');
  assert.equal(corner.radius, 220);
  assert.equal(corner.width, 200);
  assert.equal(corner.clipType, 'carrera-retained');
}
