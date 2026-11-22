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
