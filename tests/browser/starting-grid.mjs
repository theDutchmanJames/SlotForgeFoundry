import assert from 'node:assert/strict';
import { parseSTL } from '../../src/editor.js';
import { newProject } from '../../src/project.js';
import { defaultTrack } from '../../src/track.js';
import { specialTrackParams } from '../../src/special-pieces.js';

export async function checkStartingGrid({ page, wasm, action, tab, input, live, download, downloadSelected, openProject, waitText }) {
  const library = page.locator('dialog.track-library');
  const openPack = async (name) => {
    await action('mode-library').click();
  await action('packs-dialog').click();
    await library.locator('[name="collection"]').selectOption({ label: name });
  };
  const openGrid = async (name) => {
    await openPack(name);
    await library.getByRole('button', { name: /^Starting grid\b/ }).click();
    await library.waitFor({ state: 'detached' });
    await waitText('#model-title', 'Starting grid');
    await tab('markings').click();
    await input('gridWidth').waitFor();
  };

  await openGrid('SlotForge Basic Single Lane');
  assert.equal(await input('gridLayout').isVisible(), false);
  await input('gridWidth').fill('64');
  await input('gridThickness').fill('2.5');
  await input('gridLegLength').fill('0');
  await input('gridRecessed').check();
  await live();
  const project = await download(action('save'));
  const p = JSON.parse(project.bytes).track.params;
  assert.equal(p.width, 100);
  assert.equal(p.lanes, 1);
  assert.deepEqual(p.startingGrid, { width: 64, thickness: 2.5, legLength: 0, stagger: 0, recessed: true });
  await openProject(project.bytes, project.name);
  await tab('markings').click();
  assert.equal(await input('gridWidth').inputValue(), '64');
  assert.equal(await input('gridRecessed').isChecked(), true);

  const road = parseSTL(wasm, (await downloadSelected()).bytes);
  try {
    for (const y of [-16, 16]) {
      // Plain transverse bar is centred at X=0 and splits either side of the braid.
      for (const sign of [-1, 1]) {
        const x = sign * (p.startingGrid.thickness + p.grooveWidth) / 2;
        const hit = road.rayCast([x, y, p.height + 1], [x, y, -1])[0];
        assert.ok(Math.abs(hit.position[2] - (p.height - p.grooveDepth)) < 0.002);
      }
      assert.ok(Math.abs(road.rayCast([0, y, p.height + 1], [0, y, -1])[0].position[2] - p.height) < 0.002);
    }
    for (const side of [-1, 1]) {
      const braidEdge = p.slotWidth / 2 + p.braidGap + p.braidWidth;
      const y = side * (braidEdge + 0.4 + p.grooveWidth / 2);
      const cap = road.rayCast([0, y, p.height + 1], [0, y, -1])[0];
      assert.ok(Math.abs(cap.position[2] - (p.height - p.grooveDepth)) < 0.002, 'closed groove beside the braid');
    }
  } finally {
    road.delete();
  }

  await openGrid('SlotForge Basic');
  await input('gridLayout').selectOption('aligned');
  assert.equal(await input('gridStagger').isVisible(), false);
  await input('gridLayout').selectOption('right');
  await input('gridStagger').fill('28');
  await live();
  assert.equal(JSON.parse((await download(action('save'))).bytes).track.params.startingGrid.stagger, -28);

  await openPack('SlotForge Basic Single Lane');
  await library.locator('[data-lib="create-piece"]').click();
  const creator = page.locator('dialog.piece-creator');
  await creator.locator('[data-shape="straight"]').click();
  await creator.getByLabel('Starting grid', { exact: true }).check();
  assert.equal(await creator.locator('.ct-starting-grid').count(), 2, 'one mark split at its single slot');
  await creator.locator('[data-shape="curve"]').click();
  assert.equal(await creator.locator('.ct-starting-grid').count(), 0);
  await creator.getByRole('button', { name: 'Cancel' }).click();
  if (await library.isVisible()) await library.getByRole('button', { name: 'Close library' }).click();
  // Back from the Library page to Track Set, where Open is in the top bar.
  await action('mode-track').click();
  console.log('✓ Single-lane starting marks export grooves along both edges and around their ends beside the braid. Saved grid dimensions and staggered rows reopen.');
}

export async function checkPitGrid({ page, tab, input, live, openSection, action, download, downloadSelected, openProject }) {
  const project = newProject();
  project.track.params = specialTrackParams('pit', {
    ...defaultTrack(), width: 200, laneSpacing: 100, length: 1200, joint: 'none',
    whiteLineRoad: 'none', height: 10, slotDepth: 8,
  });
  project.track.params.length = 1200;
  project.track.params.special.pitOffset = 200;
  await openProject(Buffer.from(JSON.stringify(project)), 'pit-grid.slotfab');
  await tab('geometry').click();
  await openSection('Pit grid marker');
  const toggle = input('spPitGridEnabled'), position = input('spPitGridPosition');
  const slider = page.locator('#settings-form [data-pit-grid-slider]');
  assert.equal(await toggle.isChecked(), false);
  assert.equal(await slider.isVisible(), false);
  const plain = (await downloadSelected()).bytes;
  await toggle.check();
  assert.equal(await position.inputValue(), '50');
  await input('spPitGridWidth').fill('64');
  await input('spPitGridThickness').fill('2.5');
  await input('spPitGridLegLength').fill('32');
  await position.fill('27');
  assert.equal(await slider.inputValue(), '27');
  await slider.focus();
  await slider.press('End');
  assert.equal(await position.inputValue(), '100');
  await position.fill('73');
  await live();
  await page.locator('[data-guide="pit-grid-marker"]').getByText('Pit grid marker · 73% along the bay').waitFor();
  assert.ok(plain.equals((await downloadSelected()).bytes), 'paint-only pit grid keeps the same printable road');
  await input('spPitGridRecessed').check();
  await live();
  assert.ok(!plain.equals((await downloadSelected()).bytes), 'the recessed outline is cut into the printable road');
  const saved = await download(action('save'));
  assert.deepEqual(JSON.parse(saved.bytes).track.params.special.pitGrid,
    { width: 64, thickness: 2.5, legLength: 32, recessed: true, position: 73 });
  await openProject(saved.bytes, saved.name);
  await tab('geometry').click();
  assert.equal(await slider.inputValue(), '73');
  assert.equal(await input('spPitGridRecessed').isChecked(), true);
  await toggle.uncheck();
  await live();
  assert.equal(JSON.parse((await download(action('save'))).bytes).track.params.special.pitGrid, undefined);
  assert.ok(plain.equals((await downloadSelected()).bytes), 'disabling the pit grid restores the plain road');
  await input('spSide').selectOption('both');
  await openSection('Pit grid marker');
  await toggle.check();
  await position.fill('65');
  await input('spPitGridIndependent').check();
  await input('spPitGridRightPosition').fill('10');
  await live();
  await page.locator('[data-guide="pit-grid-marker"]').getByText('Right pit · 10% along the bay').waitFor();
  const paired = await download(action('save'));
  assert.equal(JSON.parse(paired.bytes).track.params.special.pitGrid.rightPosition, 10);
  await openProject(paired.bytes, paired.name);
  await tab('geometry').click();
  assert.equal(await input('spPitGridRightPosition').inputValue(), '10');
  assert.equal(await position.inputValue(), '65');
  await input('spPitGridIndependent').uncheck();
  await live();
  assert.equal(JSON.parse((await download(action('save'))).bytes).track.params.special.pitGrid.rightPosition, undefined);
  console.log('✓ Optional pit grid moves along the bay using both position controls, saves and reopens, and cuts the selected outline into the road STL');
}
