import assert from 'node:assert/strict';
import { parseSTL } from '../../src/editor.js';
import { newProject } from '../../src/project.js';

export async function checkTrackLibrary({
  page,
  wasm,
  openProject,
  action,
  tab,
  input,
  live,
  waitText,
  download,
  downloadSelected,
  snap,
}) {
  const dialog = page.locator('dialog.track-library');
  const control = (key) => dialog.locator('[data-lib="' + key + '"]');
  const setting = (key) => dialog.locator('[name="' + key + '"]');
  const card = (name) =>
    dialog.getByRole('button', { name: new RegExp('^' + name + '\\b') });
  const basic = 'SlotForge Basic';
  const collection = 'Club test collection';
  async function library(group) {
    // Foundry ignores clicks while it is still building, so slower machines
    // try again until the Library dialog opens.
    for (let attempt = 0; ; attempt++) {
      await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') !== 'true');
      await action('mode-library').click();
      await action('packs-dialog').click();
      try {
        await dialog.waitFor({ timeout: 3000 });
        break;
      } catch (e) {
        if (attempt >= 5) throw e;
      }
    }
    await setting('collection').selectOption({ label: group });
  }
  async function openMember(name) {
    await card(name).click();
    await dialog.waitFor({ state: 'detached' });
    await waitText('#model-title', name);
  }
  async function checkGridPreset(pack, lanes) {
    assert.ok(await card('Starting grid').locator('.lib-thumb path[fill="white"]').count() > 0);
    await openMember('Starting grid');
    const p = JSON.parse((await download(action('save'))).bytes).track.params;
    assert.equal(p.lanes, lanes);
    assert.equal(p.width, 100 * lanes);
    assert.ok(p.startingGrid.width > 0 && p.startingGrid.legLength > 0);
    assert.equal(p.startingGrid.stagger > 0, lanes === 2);
    await library(pack);
  }
  async function checkPrint(length, floor) {
    const stl = parseSTL(wasm, (await downloadSelected()).bytes);
    try {
      const { min, max } = stl.boundingBox();
      assert.ok(Math.abs(max[0] - min[0] - length) < 0.002);
      // Printable download has its bounding-box centre at XY zero.
      for (const y of [-50, 50]) {
        const z = stl.rayCast([0, y, 12], [0, y, -1])[0]?.position[2];
        assert.ok(Math.abs(z - floor) < 0.001, 'guide floor Z=' + z);
      }
    } finally {
      stl.delete();
    }
  }
  await openProject(
    Buffer.from(JSON.stringify(newProject())),
    'library-test.slotfab',
  );
  await library('SlotForge Basic Single Lane');
  assert.equal(await dialog.locator('[data-open-piece]').count(), 10);
  assert.match(await dialog.locator('.lib-section-head').innerText(), /100 mm wide · 1 centred lane/);
  await snap('single-lane-starter-pack');
  await checkGridPreset('SlotForge Basic Single Lane', 1);
  await control('new').click();
  await setting('itemName').fill('Single-lane template test');
  await setting('startWith').selectOption('single-starter');
  await control('commit-new').click();
  await card('R6 corner').waitFor();
  assert.equal(await setting('collection').locator('option:checked').textContent(), 'Single-lane template test');
  assert.match(await card('R6 corner').innerText(), /700 mm/);
  await openMember('Full straight');
  assert.equal(await input('laneSpacing').isVisible(), false);
  assert.equal(await page.locator('[data-centred-lane]').isVisible(), true);
  await tab('borders').click();
  await input('borderSide').selectOption('both');
  await live();
  const single = JSON.parse((await download(action('save'))).bytes).track.params;
  assert.equal(single.lanes, 1);
  assert.equal(single.width, 100);
  assert.equal(single.borderSide, 'both');
  const singleRoad = parseSTL(wasm, (await downloadSelected()).bytes);
  try {
    const { min, max } = singleRoad.boundingBox();
    assert.ok(Math.abs(max[0] - min[0] - 200) < 0.002);
    assert.ok(Math.abs(max[1] - min[1] - 100) < 0.002);
    for (const [y, height] of [[0, 2], [-25, 10], [25, 10]]) {
      const hit = singleRoad.rayCast([0, y, 12], [0, y, -1])[0];
      assert.ok(Math.abs(hit.position[2] - height) < 0.002, 'centred guide and shoulders in the printable road');
    }
  } finally { singleRoad.delete(); }
  await library('Single-lane template test');
  await control('create-piece').click();
  const singleCreator = page.locator('dialog.piece-creator');
  await singleCreator.locator('[name="pcIndex"]').selectOption('2');
  await singleCreator.locator('[data-piece-name]').fill('Single-lane matching R2');
  await singleCreator.getByRole('button', { name: 'Add to pack' }).click();
  await singleCreator.waitFor({ state: 'detached' });
  await waitText('#model-title', 'Single-lane matching R2');
  const added = JSON.parse((await download(action('save'))).bytes).track.params;
  assert.equal(added.radius, 350);
  assert.equal(added.angle, 30);
  assert.equal(added.connectorCounts.seamClips, 2);
  assert.equal(added.curveGridRadius, 1400);
  console.log('✓ The single-lane library and template open ten presets and export a centred guide on a 100 mm road with both borders enabled');
  await library(basic);
  assert.equal(await dialog.locator('[data-open-piece]').count(), 10);
  await snap('track-library');
  await checkGridPreset(basic, 2);
  const baseline = await download(control('backup'));
  assert.match(baseline.name, /\.sqlite$/);
  assert.equal(baseline.bytes.subarray(0, 16).toString(), 'SQLite format 3\0');
  await openMember('Full straight');
  await checkPrint(200, 2);
  await library(basic);
  await control('profile').click();
  await snap('track-library-shared-profile');
  assert.equal(await setting('slotDepth').inputValue(), '8');
  await setting('slotDepth').fill('9');
  await control('commit-profile').click();
  await dialog.locator('.lib-error').waitFor();
  assert.match(await dialog.locator('.lib-error').innerText(), /slot|floor/i);
  await control('browse').click();
  const unchanged = await download(control('backup'));
  assert.deepEqual(
    unchanged.bytes,
    baseline.bytes,
    'rejected shared dimensions made a partial change',
  );

  await control('profile').click();
  await setting('slotDepth').fill('6.75');
  await setting('tabWidth').fill('8.5');
  await control('commit-profile').click();
  await card('Half straight').waitFor({ timeout: 90000 });
  await openMember('Half straight');
  await checkPrint(100, 3.25);
  const half = JSON.parse((await download(action('save'))).bytes);
  assert.equal(half.track.params.tabWidth, 8.5);
  assert.equal(half.track.params.slotDepth, 6.75);

  // A pack rule changed on a piece goes to the whole pack with Apply to
  // collection; restoring the edit instead leaves the pack as it was.
  await tab('profile').click();
  await input('slotDepth').fill('7');
  await live();
  assert.match(await page.locator('[data-pack-apply]').innerText(), /Guide slot depth/);
  await action('apply-collection').click();
  await live('idle');
  await waitText('#notice', 'Applied to all');
  await page.locator('#notice').click();
  await library(basic);
  await openMember('Quarter straight');
  await checkPrint(50, 3);
  await tab('profile').click();
  await input('slotDepth').fill('6');
  await live();
  await action('restore').click();
  await live('idle');
  await checkPrint(50, 3);
  await library(basic);
  await openMember('Half straight');
  await checkPrint(100, 3);

  await tab('geometry').click();
  await input('length').fill('123');
  await live();
  await library(basic);
  await control('new').click();
  await setting('itemName').fill(collection);
  await setting('startWith').selectOption('empty');
  await setting('packWidth').fill('200');
  await setting('packLanes').fill('2');
  await setting('packLaneSpacing').fill('100');
  await setting('packR1').fill('200');
  await control('commit-new').click();
  await control('save').click();
  await control('commit-piece').waitFor();
  await setting('itemName').fill('Workshop straight');
  await control('commit-piece').click();
  await dialog.waitFor({ state: 'detached' });
  await waitText('#model-title', 'Workshop straight');
  await checkPrint(123, 3);

  // Fresh page, original active project and a different library collection:
  // the new editable recipe is loaded from SQLite rather than the workbench.
  await page.reload();
  await waitText('#model-title', 'Workshop straight');
  await page.waitForFunction(
    () =>
      document.querySelector('#app')?.getAttribute('aria-busy') === 'false' &&
      document.querySelector('#parts [data-part="road-1"]'),
  );
  await openProject(
    Buffer.from(JSON.stringify(newProject())),
    'other-work.slotfab',
  );
  await library(collection);
  await openMember('Workshop straight');
  assert.equal(await input('length').inputValue(), '123');
  await checkPrint(123, 3);
  await library(collection);
  const copyName = 'Club print trial';
  await control('new').click();
  await setting('itemName').fill(copyName);
  await setting('startWith').selectOption('copy');
  await control('commit-new').click();
  await card('Workshop straight').waitFor();
  assert.equal(await dialog.locator('[data-open-piece]').count(), 1);
  await control('profile').click();
  await setting('slotDepth').fill('6.5');
  await control('commit-profile').click();
  await openMember('Workshop straight');
  await checkPrint(123, 3.5);
  await library(collection);
  await openMember('Workshop straight');
  await checkPrint(123, 3);
  await library(basic);
  await control('new').click();
  await setting('itemName').fill('Factory dimensions');
  await setting('startWith').selectOption('starter');
  await control('commit-new').click();
  await card('Full straight').waitFor();
  assert.equal(await dialog.locator('[data-open-piece]').count(), 10);
  await openMember('Full straight');
  await checkPrint(200, 2);
  await library(collection);
  const membersBefore = await dialog.locator('[data-open-piece]').count();
  await control('create-piece').click();
  const creator = page.locator('dialog.piece-creator');
  await creator.getByRole('button', { name: 'Freeform path' }).click();
  const freeform = page.locator('dialog.custom-track-editor');
  assert.ok(
    await freeform
      .getByRole('button', { name: 'Add to pack' })
      .isVisible(),
  );
  await freeform.getByRole('button', { name: 'Cancel' }).click();
  await freeform.waitFor({ state: 'detached' });
  assert.equal(
    await dialog.locator('[data-open-piece]').count(),
    membersBefore,
  );
  assert.equal(
    await setting('collection').locator('option:checked').textContent(),
    collection,
  );
  await control('create-piece').click();
  const pieceName = 'Library R2 test corner';
  await creator.locator('[data-piece-name]').fill(pieceName);
  await creator.locator('[name="pcMode"]').selectOption('family');
  await creator.locator('[name="pcIndex"]').selectOption('2');
  assert.equal(await creator.locator('[name="pcBase"]').inputValue(), '200');
  assert.equal(await creator.locator('[name="pcWidth"]').inputValue(), '200');
  await creator.locator('[name="pcAngle"]').fill('45');
  await creator.getByRole('button', { name: 'Add to pack' }).click();
  await dialog.waitFor({ state: 'detached' });
  await waitText('#model-title', pieceName);
  await library(collection);
  await control('rules').click();
  await setting('packR1').fill('225');
  await setting('packAngle').fill('60');
  await control('commit-rules').click();
  await control('create-piece').click();
  assert.equal(await creator.locator('[name="pcBase"]').inputValue(), '225');
  assert.equal(await creator.locator('[name="pcAngle"]').inputValue(), '60');
  await creator.getByRole('button', { name: 'Cancel' }).click();
  await control('close').click();
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector('#app')?.getAttribute('aria-busy') === 'false' &&
      document.querySelector('[data-part]'),
  );
  await openProject(
    Buffer.from(JSON.stringify(newProject())),
    'other-work.slotfab',
  );
  await library(collection);
  assert.equal(
    await dialog.locator('[data-open-piece]').count(),
    membersBefore + 1,
  );
  await openMember(pieceName);
  const reopened = JSON.parse((await download(action('save'))).bytes);
  assert.equal(reopened.track.params.radius, 500);
  assert.equal(reopened.track.params.angle, 45);
  assert.equal(reopened.track.params.slotDepth, 7);
  assert.deepEqual(reopened.track.curveFamily, {
    index: 2,
    r1InnerRadius: 200,
  });
  await library(collection);
  await control('restore').click();
  await setting('backupFile').setInputFiles({
    name: baseline.name,
    mimeType: 'application/vnd.sqlite3',
    buffer: baseline.bytes,
  });
  await control('commit-restore').waitFor();
  assert.match(await dialog.textContent(), /pieces in [0-9]+ collections/);
  await control('commit-restore').click();
  await card('Quarter straight').waitFor({ timeout: 90000 });
  assert.ok(
    !(await setting('collection').locator('option').allTextContents()).includes(
      collection,
    ),
  );
  await openMember('Quarter straight');
  await checkPrint(50, 2);
  console.log(
    '✓ The offline SQLite library opens ten editable presets, updates linked slot floors and tab dimensions, rejects invalid shared edits atomically, reopens a saved custom length and restores a portable backup',
  );
}
