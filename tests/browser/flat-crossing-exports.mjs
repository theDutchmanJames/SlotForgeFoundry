import { selectTrackPart } from './part-outline.mjs';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import { parseSTL } from '../../src/editor.js';
import { newProject } from '../../src/project.js';
import { inspectFlatImport } from '../../src/drawings/flat-import.js';

export async function checkFlatCrossingExports({
  page,
  action,
  download,
  downloadSelected,
  snap,
}) {
  await page.locator('[data-tab="geometry"]').click();
  const count = page.locator('#settings-form [name="bridgeSupportCount"]');
  for (const group of await count.locator('xpath=ancestor::details').all())
    if (!(await group.evaluate((node) => node.open)))
      await group.locator(':scope > summary').click();
  const approaches = page.locator('#settings-form [name="bridgeApproaches"]');
  // This compact figure eight has room for the elevated span and separate
  // blocks. Its short approaches cannot meet a shallow ramp grade.
  await approaches.uncheck();
  await count.fill('2');
  await page.locator('#live-status[data-state="ready"]').waitFor();
  await action('apply').click();
  await page.locator('#parts [data-part^="support-"]').first().waitFor({ state: 'attached' });
  await snap('flat-crossing-supports');

  await action('export-menu').click();
  const dialog = page.locator('#dialog');
  assert.equal(
    await dialog.locator('[data-action="export-assembly"]').count(),
    0,
  );
  assert.match(await dialog.innerText(), /surface-down/);
  const supports = await download(action('export-supports'));
  assert.match(supports.name, /-bridge-supports\.zip$/);
  const supportFiles = Object.entries(unzipSync(supports.bytes));
  assert.equal(supportFiles.length, 2);
  await selectTrackPart(page.locator('#parts [data-part="road-1"]'));
  const road = (await downloadSelected()).bytes;
  await action('export-menu').click();
  const kit = unzipSync((await download(action('export-kit'))).bytes);
  const printed = Object.entries(kit).filter(([name]) => name.endsWith('.stl'));
  for (const [id, bytes] of [['road-1.stl', road], ...supportFiles])
    assert.ok(
      printed.some(([, b]) => Buffer.from(b).equals(bytes)),
      id + ' matches its kit STL',
    );
  assert.match(
    strFromU8(kit['assembly.svg']),
    /Crossing 1 · Section \d+ over section \d+/,
  );
  assert.match(strFromU8(kit['parts.csv']), /Support height \(mm\)/);
}

export async function checkRampExports({
  page,
  action,
  download,
  downloadSelected,
  openProject,
  snap,
  wasm,
}) {
  const project = newProject();
  project.name = 'Long bridge with approaches';
  Object.assign(project.track.params, {
    kind: 'import',
    width: 40,
    lanes: 1,
    braidGap: 2,
    borderSide: 'none',
    bridgeClearance: 48,
    bridgeApproaches: true,
    bridgeSupportCount: 6,
  });
  const lanes = [
    [
      [-600, 0],
      [600, 0],
    ],
    [
      [0, -200],
      [0, 200],
    ],
  ];
  const { flatCrossing } = inspectFlatImport(
    { lanes },
    40,
    project.track.params,
  );
  flatCrossing.crossings[0].upperPass = 'first';
  project.track.plan = {
    lanes,
    outlines: flatCrossing.sections.flatMap((s) => s.outlines),
    flatCrossing,
  };
  await openProject(
    Buffer.from(JSON.stringify(project)),
    'bridge-with-approaches.slotfab',
  );
  await page.locator('[data-tab="geometry"]').click();
  await snap('bridge-with-approaches');
  for (const label of ['Entry ramp', 'Exit ramp']) {
    const road = page
      .locator('#parts [data-part]')
      .filter({ hasText: label })
      .first();
    await selectTrackPart(road);
    const mesh = parseSTL(
      wasm,
      (await downloadSelected()).bytes,
    );
    try {
      const { min, max } = mesh.boundingBox();
      assert.ok(
        Math.abs(min[2]) < 0.001 && Math.abs(max[2] - 12) < 0.001,
        label + ' flattens onto the print plate',
      );
      for (const [y, depth] of [
        [0, 7],
        [-2.5, 0], [2.5, 0],
        [-3.6, 0.5], [3.6, 0.5],
        [-8.4, 0.5], [8.4, 0.5],
        [-8.6, 0], [8.6, 0],
      ]) {
        const hits = mesh.rayCast([0, y, -1], [0, y, 13]);
        assert.ok(
          Math.abs(hits[0]?.position[2] - depth) < 0.001,
          'the offset walls touch the PEI plate and each braid recess keeps its width',
        );
      }
    } finally {
      mesh.delete();
    }
  }
  await action('export-menu').click();
  const supports = unzipSync((await download(action('export-supports'))).bytes);
  const heights = Object.values(supports).map((bytes) => {
    const mesh = parseSTL(wasm, bytes);
    try {
      return mesh.boundingBox().max[2];
    } finally {
      mesh.delete();
    }
  });
  assert.equal(heights.length, 6);
  assert.equal(Math.max(...heights), 60);
  assert.ok(Math.min(...heights) < 30);
  console.log(
    '✓ Both sloping approaches print road-face down with full guide depth, and graduated supports export upright',
  );
}
