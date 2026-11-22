import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { parseSTL } from '../../src/editor.js';
import { newProject } from '../../src/project.js';

// The two printable borders are centred independently. On a straight the
// station can be recovered directly from X, and the free edge is furthest
// from the road in positive Y on the outside and negative Y on the inside.
function checkPrintedBorder(wasm, bytes, side, percent, width) {
  const solid = parseSTL(wasm, bytes);
  try {
    const { min, max } = solid.boundingBox();
    assert.ok(Math.abs(max[1] - min[1] - width) < 0.001, side + ' width');
    const extreme = side === 'outer' ? max[1] : min[1];
    const mesh = solid.getMesh();
    let peaks = 0;
    for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp) {
      if (Math.abs(mesh.vertProperties[i + 1] - extreme) > 0.00001) continue;
      const station =
        (100 * (mesh.vertProperties[i] - min[0])) / (max[0] - min[0]);
      assert.ok(
        Math.abs(station - percent) < 0.001,
        side + ' STL apex at ' + station + '%',
      );
      peaks++;
    }
    assert.ok(peaks > 0);
  } finally {
    solid.delete();
  }
}

export async function checkBorderApices({
  wasm,
  page,
  action,
  tab,
  input,
  live,
  openProject,
  download,
  snap,
}) {
  const project = newProject();
  project.name = 'Asymmetric borders';
  Object.assign(project.track.params, {
    kind: 'straight',
    length: 160,
    borderSide: 'both',
    borderSegments: 1,
    borderEntry: 9,
    borderExit: 13,
    borderApex: 32,
    apexPosition: 0.37625,
  });
  for (const side of ['outer', 'inner']) {
    delete project.track.params[side + 'ApexWidth'];
    delete project.track.params[side + 'ApexPosition'];
  }
  await openProject(
    Buffer.from(JSON.stringify(project)),
    'shared-apex-legacy.slotfab',
  );
  await tab('borders').click();
  const read = async (side) => [
    Number(await input(side + 'ApexPercent').inputValue()),
    Number(await input(side + 'ApexWidth').inputValue()),
  ];
  const oldProfile = [37.625, 32];
  assert.deepEqual(await read('inner'), oldProfile);
  assert.deepEqual(await read('outer'), oldProfile);
  const untouched = JSON.parse((await download(action('save'))).bytes).track
    .params;
  for (const side of ['inner', 'outer'])
    assert.equal(
      untouched[side + 'ApexPosition'] ?? untouched.apexPosition,
      0.37625,
    );

  const outer = page.getByRole('slider', { name: 'Outside apex width' });
  await outer.hover();
  const bounds = await outer.boundingBox();
  const x = bounds.x + bounds.width / 2,
    y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 20, y - 6, { steps: 6 });
  await page.mouse.up();
  await live();
  const [movedPercent, movedWidth] = await read('outer');
  assert.ok(movedPercent > oldProfile[0] && movedWidth > oldProfile[1]);
  assert.deepEqual(await read('inner'), oldProfile);
  await page
    .getByRole('slider', { name: 'Inside apex width' })
    .press('ArrowLeft');
  const [innerStation, innerWidth] = await read('inner');
  assert.equal(innerStation, oldProfile[0] - 1);
  assert.equal(innerWidth, 32);
  await page.getByRole('slider', { name: 'Inside apex width' }).press('ArrowUp');
  assert.deepEqual(await read('inner'), [innerStation, innerWidth + 1]);
  assert.deepEqual(await read('outer'), [movedPercent, movedWidth]);
  await action('restore').click();
  await live('idle');
  assert.deepEqual(await read('inner'), oldProfile);
  assert.deepEqual(await read('outer'), oldProfile);

  await input('innerApexPercent').fill('24.75');
  await input('innerApexWidth').fill('27.5');
  await input('outerApexPercent').fill('72.5');
  await page.locator('[data-restore-field="outerApexPercent"]').click();
  await live();
  assert.deepEqual(await read('outer'), oldProfile);
  assert.deepEqual(await read('inner'), [24.75, 27.5]);
  await input('outerApexPercent').fill('72.5');
  await input('outerApexWidth').fill('43.5');
  await live();
  await action('apply').click();
  await live('idle');
  await snap('independent-border-apices');

  // A hidden side keeps its last printable width even if a previous
  // keystroke left its now-inactive field outside the supported range.
  await input('innerApexWidth').fill('2001');
  await input('borderSide').selectOption('outer');
  await live();
  await input('outerApexPercent').fill('68.125');
  await live();
  const single = (await download(action('save'))).bytes;
  const saved = JSON.parse(single).track.params;
  assert.equal(saved.borderSide, 'outer');
  assert.equal(saved.outerApexPosition, 0.68125);
  assert.equal(saved.innerApexPosition, 0.2475);
  await openProject(single, 'independent-border-apices.slotfab');
  await tab('borders').click();
  assert.deepEqual(await read('outer'), [68.125, 43.5]);
  await input('borderSide').selectOption('both');
  await live();
  assert.deepEqual(await read('inner'), [24.75, 27.5]);
  await action('export-menu').click();
  const files = unzipSync((await download(action('export-borders'))).bytes);
  checkPrintedBorder(wasm, files['border-inner-1.stl'], 'inner', 24.75, 27.5);
  checkPrintedBorder(wasm, files['border-outer-1.stl'], 'outer', 68.125, 43.5);
  await input('outerApexPercent').fill('52');
  await live();
  await action('export-menu').click();
  const moved = unzipSync((await download(action('export-borders'))).bytes);
  checkPrintedBorder(wasm, moved['border-outer-1.stl'], 'outer', 52, 43.5);
  const before = parseSTL(wasm, files['border-inner-1.stl']);
  const after = parseSTL(wasm, moved['border-inner-1.stl']);
  const removed = before.subtract(after);
  const added = after.subtract(before);
  try {
    assert.ok(
      removed.volume() + added.volume() < 0.00001,
      'moving the outside apex changes no printable material on the inside',
    );
  } finally {
    for (const body of [added, removed, after, before]) body.delete();
  }
  console.log(
    '✓ Independent border handles, field Restore, saved legacy precision and hidden-side edits reproduce both apex positions and widths in printable STLs',
  );
}
