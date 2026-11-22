import assert from 'node:assert/strict';
import { newProject } from '../../src/project.js';
import { parseSTL } from '../../src/editor.js';
import { checkCornerAppearance } from './corner-appearance.mjs';

function oldEnclosureProject() {
  const project = newProject();
  project.mode = 'editor';
  delete project.editor.source.demoVersion;
  // Three real top edges from a 0.15.0 enclosure. That release stored a
  // normal pair and a relative midpoint for each individually selected chord.
  const chords = [
    [
      [-36, -27],
      [36, -27],
    ],
    [
      [36.9754524231, -26.9039268494],
      [37.1751289368, -26.8433551788],
    ],
    [
      [40.8433532715, -23.1751308441],
      [40.9039268494, -22.9754524231],
    ],
  ];
  const edges = chords.map(([[ax, ay], [bx, by]]) => {
    const dx = bx - ax,
      dy = by - ay,
      length = Math.hypot(dx, dy);
    return {
      a: [ax, ay, 16],
      b: [bx, by, 16],
      convex: true,
      n1: [0, 0, 1],
      n2: [dy / length, -dx / length, 0],
      witness: [(ax + bx + 82) / 164, (ay + by + 54) / 108, 1],
    };
  });
  project.editor.ops.push({
    id: 'manual-bevel',
    target: 'body',
    type: 'edgeGroup',
    kind: 'chamfer',
    label: 'Chamfer edges',
    scope: 'picked',
    size: 2,
    edges,
  });
  return project;
}

export async function checkRoundedCorner({
  page,
  wasm,
  action,
  input,
  openProject,
  opCount,
  live,
  download,
  downloadSelected,
  snap,
  waitText,
}) {
  const project = newProject();
  project.mode = 'editor';
  await openProject(
    Buffer.from(JSON.stringify(project)),
    'rounded-enclosure.slotfab',
  );
  await action('top').click();
  const canvas = page.locator('#viewport canvas').first();
  async function clickCorner(degrees, side = 1, shift = false) {
    const box = await canvas.boundingBox();
    const t = (degrees * Math.PI) / 180;
    const scale = Math.min(box.width / 82, box.height / 54) / 1.31;
    await canvas.click({
      position: {
        x: box.width / 2 + scale * side * (36 + 4.78 * Math.cos(t)),
        y: box.height / 2 + scale * (22 + 4.78 * Math.sin(t)),
      },
      modifiers: shift ? ['Shift'] : [],
    });
  }
  await clickCorner(45);
  await waitText('#edge-selection-count', '1 rounded corner selected');
  const edgeGuide = page.locator('[data-guide="picked-edge-0"] path').first();
  assert.ok((await edgeGuide.getAttribute('d')).length > 100);
  await clickCorner(20, -1, true);
  await waitText('#edge-selection-count', '2 rounded corners selected');
  await clickCorner(65, -1, true);
  await waitText('#edge-selection-count', '1 rounded corner selected');
  await page
    .locator('[data-editor="edge-finish"],[data-tab="edge-finish"]')
    .first()
    .click();
  assert.equal(await input('edgeScope').inputValue(), 'corner');
  await input('edgeKind').selectOption('chamfer');
  await input('edgeSize').fill('2');
  await live();
  await waitText('[data-guide="finish-edge"]', '1 rounded corner');
  const guide = page.locator('[data-guide="finish-edge"] path').first();
  const guideOutline = () =>
    page.waitForFunction(() => document.querySelector('[data-guide="finish-edge"] path')?.getAttribute('d'));
  const wholeArc = await (await guideOutline()).jsonValue();
  await input('edgeScope').selectOption('picked');
  await live();
  // The guide is redrawn after the live edit; slower machines need a moment.
  await page.waitForFunction(
    (whole) => {
      const d = document.querySelector('[data-guide="finish-edge"] path')?.getAttribute('d');
      return !!d && d.length < whole / 2;
    },
    wholeArc.length,
    { timeout: 15000 },
  );
  await input('edgeScope').selectOption('corner');
  await live();
  await action('iso').click();
  const model = await canvas.boundingBox();
  const arc = await guide.boundingBox();
  const cx = model.x + model.width / 2,
    cy = model.y + model.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(
    cx + cx - arc.x - arc.width / 2,
    cy + cy - arc.y - arc.height / 2,
    { steps: 4 },
  );
  await page.mouse.up({ button: 'middle' });
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -2400);
  await page.waitForFunction(
    (initial) =>
      document
        .querySelector('[data-guide="finish-edge"] .guide-line')
        ?.getBoundingClientRect().width >
      initial * 2,
    arc.width,
  );
  await snap('rounded-corner-chamfer');
  await checkCornerAppearance(page, canvas, guide);
  await action('apply').click();
  await opCount(1);
  const original = (await downloadSelected()).bytes;
  const stl = parseSTL(wasm, original);
  const top = (x, y) => stl.rayCast([x, y, 25], [x, y, -1])[0]?.position[2];
  try {
    for (let degrees = 4; degrees < 90; degrees += 4) {
      const t = (degrees * Math.PI) / 180;
      const z = top(36 + 4.55 * Math.cos(t), -22 - 4.55 * Math.sin(t));
      assert.ok(
        z > 14 && z < 15.1,
        'plateau on selected chamfer at ' + degrees + ' degrees: ' + z,
      );
    }
    assert.ok(Math.abs(top(36.6, -22.6) - 2) < 0.001);
    assert.ok(Math.abs(top(0, -26.7) - 16) < 0.001);
    assert.ok(Math.abs(top(-39.2, -25.2) - 16) < 0.001);
  } finally {
    stl.delete();
  }
  const saved = (await download(action('save'))).bytes;
  const edit = JSON.parse(saved).editor.ops.at(-1);
  assert.equal(edit.scope, 'corner');
  assert.equal(edit.edges.length, 1);
  assert.ok(edit.edges[0].corner);
  await openProject(saved, 'corner-chamfer.slotfab');
  assert.deepEqual((await downloadSelected()).bytes, original);
  await page.locator('[data-op]').last().click();
  await waitText('[data-edge-description]', '1 rounded corner');
  assert.equal(await input('edgeSize').inputValue(), '2');
  await input('edgeSize').fill('1.5');
  await live();
  await waitText('[data-guide="finish-edge"]', 'Chamfer 1.5 mm');
  console.log(
    '✓ One click selects a whole enclosure corner, Shift toggles another corner, single-segment mode stays local, and the saved chamfer measures continuously in the exported STL',
  );

  const old = oldEnclosureProject();
  await openProject(
    Buffer.from(JSON.stringify(old)),
    'old-manual-chamfer.slotfab',
  );
  const previous = parseSTL(
    wasm,
    (await downloadSelected()).bytes,
  );
  try {
    assert.ok(
      Math.abs(
        previous.rayCast([39.2, -25.2, 20], [39.2, -25.2, -1])[0].position[2] -
          16,
      ) < 0.001,
    );
  } finally {
    previous.delete();
  }
  await page.locator('[data-op="manual-bevel"]').click();
  assert.equal(await input('edgeScope').inputValue(), 'picked');
  await waitText('[data-edge-description]', '3 edges');
  await input('edgeScope').selectOption('corner');
  await live();
  await waitText('[data-edge-description]', '1 rounded corner and 1 edge');
  await action('apply').click();
  await page
    .locator('#settings-form [name="edgeScope"]')
    .waitFor({ state: 'detached' });
  const upgraded = (await download(action('save'))).bytes;
  const editor = JSON.parse(upgraded).editor;
  assert.equal(editor.ops.length, 1);
  assert.equal(editor.ops[0].id, 'manual-bevel');
  assert.equal(editor.ops[0].scope, 'corner');
  assert.equal(editor.ops[0].edges.length, 2);
  assert.equal(editor.ops[0].edges.filter((e) => e.corner).length, 1);
  assert.equal(editor.source.demoVersion ?? 1, 1);
  await openProject(upgraded, 'revised-manual-chamfer.slotfab');
  const revised = parseSTL(
    wasm,
    (await downloadSelected()).bytes,
  );
  try {
    for (let degrees = 3; degrees < 90; degrees += 4) {
      const a = (degrees * Math.PI) / 180;
      const x = 36 + 4.55 * Math.cos(a),
        y = -22 - 4.55 * Math.sin(a);
      const z = revised.rayCast([x, y, 20], [x, y, -1])[0].position[2];
      assert.ok(
        z > 14 && z < 15.1,
        'unrepaired legacy chamfer at ' + degrees + '°',
      );
    }
    const railHeight = revised.rayCast([0, -26.4, 20], [0, -26.4, -1])[0]
      .position[2];
    assert.ok(Math.abs(railHeight - 14.6) < 0.001);
  } finally {
    revised.delete();
  }
  console.log(
    '✓ Editing a 0.15.0 chamfer replaces two manual chords with one rounded corner, retains the straight edge, and reopens the continuous bevel',
  );
}
