import assert from 'node:assert/strict';
import { parseSTL } from '../../src/editor.js';
import { newProject } from '../../src/project.js';
import { selectTrackPart } from './part-outline.mjs';

export async function checkUndersideRibs({ page, wasm, openProject, tab, input, action, live, download, downloadSelected }) {
  const project = newProject();
  project.name = 'Ribbed straight';
  Object.assign(project.track.params, {
    kind: 'straight', width: 100, length: 200, height: 10, deck: 2, wall: 2,
    lanes: 1, slotDepth: 8, joint: 'none', borderSide: 'outer', borderSegments: 1,
    borderEntry: 22, borderApex: 22, borderExit: 22,
  });
  // An existing saved piece should acquire the same controls as a new one.
  delete project.track.params.reinforcement;
  delete project.track.params.ribSpacing;
  await openProject(Buffer.from(JSON.stringify(project)), 'ribbed-straight.slotfab');
  await tab('profile').click();
  assert.equal(await input('reinforcement').isChecked(), true);
  assert.equal(await input('ribSpacing').inputValue(), '50');
  // View the underside now sits in the Print section.
  await tab('print').click();
  await action('view-underside').click();
  assert.equal(await action('bottom').getAttribute('aria-pressed'), 'true');

  async function countRows(id, y) {
    await selectTrackPart(page.locator('[data-part="' + id + '"]'));
    const solid = parseSTL(wasm, (await downloadSelected()).bytes);
    try {
      let rows = 0, onRib = false;
      for (let x = -93; x <= 93; x += 0.5) {
        const hit = solid.rayCast([x, y, -1], [x, y, 11])[0];
        assert.ok(hit, id + ' deck spans the probe at x=' + x + ', y=' + y);
        const bed = Math.abs(hit.position[2]) < 0.002;
        if (bed && !onRib) rows++;
        onRib = bed;
      }
      return rows;
    } finally { solid.delete(); }
  }
  const initial = await countRows('road-1', 25);
  assert.ok(initial > 0);
  await tab('profile').click();
  await input('ribSpacing').fill('30');
  await live();
  const saved = await download(action('save'));
  assert.equal(JSON.parse(saved.bytes).track.params.ribSpacing, 30);
  await openProject(saved.bytes, saved.name);
  assert.ok(await countRows('road-1', 25) > initial, 'closer spacing adds printable rows');
  assert.ok(await countRows('border-outer-1', 0) > 0, 'detachable border has printable rows');
  await tab('profile').click();
  await input('reinforcement').uncheck();
  assert.equal(await input('ribSpacing').isVisible(), false);
  await live();
  await action('apply').click();
  await live('idle');
  assert.equal(await countRows('road-1', 25), 0);
  assert.equal(await countRows('border-outer-1', 0), 0);
  console.log('✓ Underside ribs on a saved straight and its border reach the print plane, change with spacing, and disappear when switched off.');
}
