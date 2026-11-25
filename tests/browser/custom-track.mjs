import assert from 'node:assert/strict';
import { newProject } from '../../src/project.js';
import { parseSTL } from '../../src/editor.js';
import { openPackCreator } from './track-pack-creator.mjs';

export async function checkCustomTrack({
  page,
  wasm,
  action,
  openProject,
  download,
  downloadSelected,
  snap,
  tab,
}) {
  const project = newProject();
  Object.assign(project.track.params, {
    kind: 'straight',
    width: 60,
    lanes: 2,
    laneSpacing: 25,
    borderSide: 'none',
  });
  await openProject(Buffer.from(JSON.stringify(project)), 'draw-road.slotfab');
  const pack = 'Corner creation test';
  const creator = await openPackCreator(page, action, pack, {
    packWidth: 200,
    packLanes: 2,
    packLaneSpacing: 100,
    packR1: 200,
    packAngle: 45,
  });
  const measure = (name) => creator.locator('[name="' + name + '"]');
  await measure('pcMode').selectOption('family');
  for (const name of ['pcWidth', 'pcLanes', 'pcSpacing', 'pcBase'])
    assert.equal(await measure(name).evaluate((el) => el.readOnly), true);
  await measure('pcAngle').fill('45');
  await measure('pcIndex').selectOption('2');
  assert.equal(await measure('pcInner').inputValue(), '400');
  assert.deepEqual(
    await creator
      .locator('[data-family-graphic] tr.chosen > *')
      .allTextContents(),
    ['R2', '400', '600'],
  );
  await measure('pcIndex').selectOption('1');
  assert.match(
    await creator.locator('[data-slot-lengths]').innerText(),
    /196\.35 \/ 274\.89/,
  );
  const slots = creator.locator('[data-piece-preview] .ct-lane');
  const baseline = await slots.nth(1).getAttribute('points');
  await snap('native-track-creator');
  await measure('ctAdjustLanes').check();
  await measure('ctLaneMode').selectOption('squeeze');
  await measure('ctLaneAnchor').selectOption('inner');
  assert.notEqual(await slots.nth(1).getAttribute('points'), baseline);
  await creator.locator('[data-pc-apply]').click();
  await creator.waitFor({ state: 'detached' });
  const curve = JSON.parse((await download(action('save'))).bytes).track;
  assert.equal(curve.params.kind, 'curve');
  assert.equal(curve.params.radius, 300);
  assert.equal(curve.params.angle, 45);
  assert.deepEqual(curve.curveFamily, { index: 1, r1InnerRadius: 200 });
  assert.equal(curve.params.laneAdjustment.anchor, 'inner');
  await openPackCreator(page, action, pack);
  await measure('pcMode').selectOption('independent');
  await measure('pcInner').fill('177');
  assert.equal(
    await creator.locator('[data-family-preview]').isVisible(),
    false,
  );
  await creator.getByRole('button', { name: 'Straight', exact: true }).click();
  assert.equal(await measure('pcInner').isVisible(), false);
  await measure('pcLength').fill('150');
  await creator.locator('[data-pc-apply]').click();
  await creator.waitFor({ state: 'detached' });
  const straight = JSON.parse((await download(action('save'))).bytes).track;
  assert.equal(straight.params.kind, 'straight');
  assert.equal(straight.params.length, 150);
  assert.equal(straight.curveFamily, undefined);
  await openProject(Buffer.from(JSON.stringify(project)), 'draw-road.slotfab');
  await openPackCreator(page, action, 'Workshop drawing test', {
    packWidth: 60,
    packLanes: 2,
    packLaneSpacing: 25,
    packR1: 100,
    packAngle: 30,
  });
  await page.getByRole('button', { name: 'Freeform path' }).click();
  const dialog = page.locator('dialog.custom-track-editor');
  const field = (name) => dialog.locator('[name="' + name + '"]');
  assert.equal(await field('ctWidth').inputValue(), '60');
  for (const name of ['ctWidth', 'ctSpacing', 'ctLanes'])
    assert.equal(await field(name).evaluate((el) => el.readOnly), true);
  await dialog.locator('[data-ct-name]').fill('Workshop corner');
  await field('ctRadius').fill('70');
  async function at(x, y) {
    return dialog.locator('[data-ct-world]').evaluate(
      (node, [x, y]) => {
        const point = new DOMPoint(x, y).matrixTransform(node.getScreenCTM());
        return { x: point.x, y: point.y };
      },
      [x, y],
    );
  }
  const third = await at(190, 50);
  await page.mouse.click(third.x, third.y);
  assert.equal(await dialog.locator('[data-ct-point]').inputValue(), '2');
  await field('ctX').fill('200');
  await field('ctY').fill('220');
  await dialog.locator('[data-custom="fit"]').click();
  assert.equal(await dialog.locator('.ct-lane').count(), 2);
  const visibleControls = await dialog.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const button = node
      .querySelector('[data-custom="apply"]')
      .getBoundingClientRect();
    const svg = node
      .querySelector('[data-custom-canvas]')
      .getBoundingClientRect();
    const guides = [...node.querySelectorAll('[data-ct-handles] circle')].map(
      (circle) => circle.getBoundingClientRect(),
    );
    return (
      svg.bottom <= button.top &&
      guides.every((g) => g.top >= svg.top && g.bottom <= svg.bottom) &&
      button.top >= bounds.top &&
      button.bottom <= Math.min(bounds.bottom, innerHeight)
    );
  });
  assert.ok(visibleControls, 'the drawing and its commit button fit together');
  await snap('custom-road-drawing');
  await dialog.locator('[data-custom="apply"]').click();
  await dialog.waitFor({ state: 'detached' });
  const saved = (await download(action('save'))).bytes;
  const track = JSON.parse(saved).track;
  assert.deepEqual(track.custom.points, [
    [0, 0],
    [200, 0],
    [200, 220],
  ]);
  assert.equal(track.custom.radius, 70);
  assert.equal(track.plan.lanes.length, 2);
  await openProject(saved, 'workshop-corner.slotfab');
  await tab('geometry').click();
  await action('edit-custom').click();
  assert.equal(await field('ctY').inputValue(), '220');
  const start = await at(200, 220),
    end = await at(200, 245);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  assert.equal(await field('ctY').inputValue(), '245');
  await dialog.locator('[data-custom="apply"]').click();
  await dialog.waitFor({ state: 'detached' });
  const updated = JSON.parse((await download(action('save'))).bytes).track;
  assert.equal(updated.custom.points[2][1], 245);
  assert.deepEqual(updated.plan.lanes[0].at(-1), [212.5, 245]);
  const solid = parseSTL(wasm, (await downloadSelected()).bytes);
  try {
    const { min, max } = solid.boundingBox();
    assert.ok(Math.abs(max[0] - min[0] - 230) < 0.001);
    assert.ok(Math.abs(max[1] - min[1] - 275) < 0.001);
    // Downloaded roads are centred on the plate. Check the two slots near
    // both mouths as well as the full-height road between the slots.
    function height(x, y) {
      const px = x - 115,
        py = y - 107.5;
      return solid.rayCast([px, py, 13], [px, py, -1])[0]?.position[2];
    }
    for (const side of [-12.5, 12.5]) {
      assert.ok(Math.abs(height(10, side) - 5) < 0.001);
      assert.ok(Math.abs(height(200 + side, 240) - 5) < 0.001);
    }
    assert.equal(height(10, 0), 12);
  } finally {
    solid.delete();
  }
  console.log(
    '✓ Draw, dimension, save and reopen a custom road; moving its endpoint updates the printed lanes without Circuit',
  );
}

export async function checkFlowingCurve({
  page,
  wasm,
  action,
  openProject,
  download,
  downloadSelected,
  snap,
  tab,
}) {
  const project = newProject();
  Object.assign(project.track.params, {
    kind: 'straight',
    width: 60,
    lanes: 2,
    laneSpacing: 25,
    borderSide: 'none',
  });
  await openProject(Buffer.from(JSON.stringify(project)), 'flowing-road.slotfab');
  const pack = 'Flowing curve test';
  const creator = await openPackCreator(page, action, pack, {
    packWidth: 60,
    packLanes: 2,
    packLaneSpacing: 25,
    packR1: 150,
    packAngle: 30,
  });
  // A straight for the bend to join in the Track Planner.
  await creator.getByRole('button', { name: 'Straight', exact: true }).click();
  await creator.locator('[name="pcLength"]').fill('150');
  await creator.locator('[data-piece-name]').fill('Short straight');
  await creator.locator('[data-pc-apply]').click();
  await creator.waitFor({ state: 'detached' });
  await openPackCreator(page, action, pack);
  await creator.getByRole('button', { name: 'Flowing curve / S-bend' }).click();
  const dialog = page.locator('dialog.custom-track-editor');
  const field = (name) => dialog.locator('[name="' + name + '"]');
  const values = (...names) =>
    Promise.all(names.map((name) => field(name).inputValue()));
  const readout = dialog.locator('[data-ct-readout]');
  const tight = dialog.locator('.ct-tight');
  assert.equal(await dialog.locator('[data-ct-shape]').inputValue(), 'flowing');
  // Waypoint controls give way to the curve's own.
  for (const waypointOnly of [
    field('ctRadius'),
    dialog.locator('[data-ct-closed]'),
    dialog.locator('[data-ct-crossing-mode]'),
    dialog.locator('[data-ct-point]'),
  ])
    assert.equal(await waypointOnly.isVisible(), false);
  assert.equal(await dialog.locator('[data-ct-polygon]').getAttribute('points'), '');
  assert.equal(await dialog.locator('[data-ct-handles] circle[data-ct-handle]').count(), 2);
  assert.equal(await dialog.locator('[data-ct-handles] rect[data-ct-handle="3"]').count(), 1);
  // The pack's tightest slot is the inside lane of R1: 150 + (60 - 25) / 2.
  assert.equal(await field('ctPreferred').inputValue(), '167.5');
  assert.deepEqual(
    await values('ctEndX', 'ctEndY', 'ctStartDirection', 'ctEndDirection'),
    ['200', '200', '0', '90'],
  );
  assert.match(
    await readout.innerText(),
    /^Smallest radius per lane: 210\.91 \/ 185\.91 mm\. Slot lengths: 333\.8\d? \/ 294\.5\d? mm\.$/,
  );
  assert.equal(await tight.count(), 0);
  await field('ctPreferred').fill('190');
  assert.ok((await tight.count()) > 0);
  assert.match(await readout.innerText(), /Red sections are tighter than your preferred 190 mm\.$/);
  // An S-bend, and its mirror image.
  await dialog.locator('[data-ct-preset]').selectOption('s-bend');
  await dialog.getByRole('button', { name: 'Use shape' }).click();
  const [sEnd, sStart] = await values('ctEndX', 'ctStartDirection');
  assert.equal(sStart, '24.7751');
  assert.ok(Number(sEnd) >= 400);
  await dialog.getByRole('button', { name: 'Mirror to the other side' }).click();
  assert.deepEqual(await values('ctStartDirection', 'ctEndDirection'), ['-24.7751', '-24.7751']);
  assert.equal(await dialog.locator('.ct-lane').count(), 2);
  // With the directions released, a typed direction turns that end: the end
  // handle comes level with the end.
  await dialog.locator('.ct-coordinates summary').click();
  await dialog.locator('[data-ct-lock]').uncheck();
  await field('ctEndDirection').fill('0');
  const [endY, handleY, handleX] = (
    await values('ctEndY', 'ctHandle2Y', 'ctHandle2X')
  ).map(Number);
  assert.ok(Math.abs(handleY - endY) < 1e-6);
  assert.ok(handleX < Number(sEnd) - 100);
  // A starting shape keeps its directions again.
  await field('ctPreferred').fill('167.5');
  await dialog.locator('[data-ct-preset]').selectOption('bend');
  await dialog.getByRole('button', { name: 'Use shape' }).click();
  assert.ok(await dialog.locator('[data-ct-lock]').isChecked());
  assert.deepEqual(await values('ctEndX', 'ctEndY'), ['200', '200']);
  async function at(x, y) {
    return dialog.locator('[data-ct-world]').evaluate(
      (node, [x, y]) => {
        const point = new DOMPoint(x, y).matrixTransform(node.getScreenCTM());
        return { x: point.x, y: point.y };
      },
      [x, y],
    );
  }
  // Drag the square: the end moves and takes its handle along.
  const from = await at(200, 200),
    to = await at(240, 200);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  assert.deepEqual(
    await values('ctEndX', 'ctEndY', 'ctHandle2X', 'ctEndDirection'),
    ['240', '200', '240', '90'],
  );
  // Drag a round handle off its line: it slides along the kept direction.
  const grip = await at(110.45695, 0),
    off = await at(150, 60);
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(off.x, off.y, { steps: 5 });
  await page.mouse.up();
  assert.deepEqual(
    await values('ctHandle1X', 'ctHandle1Y', 'ctStartDirection'),
    ['150', '0', '0'],
  );
  // Arrow keys move the focused handle 1 mm, with Shift 10 mm.
  const startHandle = dialog.locator('[data-ct-handle="1"]');
  await startHandle.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await field('ctHandle1X').inputValue(), '139');
  assert.equal(
    await page.evaluate(() => document.activeElement.dataset.ctHandle),
    '1',
  );
  // An exact coordinate for the end: its handle follows.
  await field('ctEndY').fill('220');
  assert.deepEqual(await values('ctHandle2X', 'ctHandle2Y'), ['240', '109.54305']);
  await dialog.locator('[data-custom="fit"]').click();
  await dialog.locator('[data-ct-name]').fill('Workshop sweep');
  await snap('flowing-curve-drawing');
  await dialog.getByRole('button', { name: 'Add to pack' }).click();
  await dialog.waitFor({ state: 'detached' });
  const saved = (await download(action('save'))).bytes;
  const track = JSON.parse(saved).track;
  assert.deepEqual(track.custom, {
    version: 1,
    shape: 'flowing',
    controlPoints: [
      [0, 0],
      [139, 0],
      [240, 109.54305],
      [240, 220],
    ],
  });
  assert.deepEqual(track.plan.lanes[0][0], [0, -12.5]);
  assert.deepEqual(track.plan.lanes[0].at(-1), [252.5, 220]);
  assert.deepEqual(track.plan.lanes[1].at(-1), [227.5, 220]);
  // The printed road spans both square ends and carries both slots.
  await openProject(saved, 'workshop-sweep.slotfab');
  const solid = parseSTL(wasm, (await downloadSelected()).bytes);
  try {
    const { min, max } = solid.boundingBox();
    assert.ok(Math.abs(max[0] - min[0] - 270) < 0.01);
    assert.ok(Math.abs(max[1] - min[1] - 250) < 0.01);
    const height = (x, y) => {
      const px = x - 135,
        py = y - 95;
      return solid.rayCast([px, py, 13], [px, py, -1])[0]?.position[2];
    };
    for (const side of [-12.5, 12.5]) {
      assert.ok(Math.abs(height(5, side) - 5) < 0.001);
      assert.ok(Math.abs(height(240 + side, 215) - 5) < 0.001);
    }
    assert.equal(height(5, 0), 12);
  } finally {
    solid.delete();
  }
  // Edit drawn path reopens the curve with its handles.
  await tab('geometry').click();
  await action('edit-custom').click();
  assert.equal(await dialog.locator('[data-ct-shape]').inputValue(), 'flowing');
  assert.deepEqual(
    await values('ctEndX', 'ctEndY', 'ctHandle1X', 'ctHandle2Y', 'ctEndDirection'),
    ['240', '220', '139', '109.54305', '90'],
  );
  assert.equal(await dialog.locator('[data-ct-handle]').count(), 3);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.waitFor({ state: 'detached' });
  // The pack shows the piece with a drawn thumbnail.
  await action('mode-library').click();
  await action('packs-dialog').click();
  const library = page.locator('dialog.track-library');
  await library.locator('[name="collection"]').selectOption({ label: pack });
  const card = library.getByRole('button', { name: /^Workshop sweep\b/ });
  assert.equal(await card.locator('.lib-thumb path.lib-road').count(), 1);
  assert.equal(
    (await card.locator('.lib-thumb path.lib-lanes').getAttribute('d')).split('M').length - 1,
    2,
  );
  await library.locator('[data-lib="close"]').click();
  // Track Planner: straight, bend, straight. The second straight leaves at a
  // right angle to the first, from the end of the curve.
  const panel = page.locator('#track-planner');
  const idle = () =>
    page.waitForFunction(
      () => !document.querySelector('#track-planner').hasAttribute('aria-busy'),
    );
  const command = (key) => panel.locator('[data-pl="' + key + '"]');
  await action('mode-planner').click();
  await panel.waitFor();
  await command('new').click();
  await idle();
  await command('left').click();
  await panel.locator('[data-pl-field="pack"]').selectOption({ label: pack });
  await page.waitForFunction(
    () => document.querySelectorAll('.pl-card').length === 2,
  );
  for (const name of [/^Short straight/, /^Workshop sweep/, /^Short straight/]) {
    await panel.getByRole('button', { name }).click();
    await idle();
  }
  const layout = JSON.parse((await download(action('save'))).bytes);
  const named = layout.nodes.map((node) => layout.sources[node.source].name);
  assert.deepEqual(
    [...new Set(named)],
    ['Short straight', 'Workshop sweep'],
  );
  const first = layout.nodes[0].pose,
    last = layout.nodes.at(-1).pose;
  const turn = last.a - first.a;
  assert.ok(Math.abs(Math.cos(turn)) < 1e-9, 'the far straight is square to the near one');
  assert.ok(Math.abs(Math.abs(Math.sin(turn)) - 1) < 1e-9);
  assert.match(await panel.locator('.pl-stats').textContent(), /2 open ends/);
  await command('new').click();
  await idle();
  await action('mode-track').click();
  console.log(
    '✓ Flowing curve: presets, mirror, dragged and typed handles, kept directions and the preferred radius; saved to a pack, reopened, printed, and joined square to straights in the Track Planner',
  );
}
