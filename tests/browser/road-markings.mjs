import assert from 'node:assert/strict';
import { parseSTL } from '../../src/editor.js';
import { newProject } from '../../src/project.js';
import { defaultTrack } from '../../src/track.js';
import { specialTrackParams } from '../../src/special-pieces.js';

function expectSurface(solid, x, y, expected, fromBelow = false) {
  const z = fromBelow ? [-1, 11] : [11, -1];
  const hit = solid.rayCast([x, y, z[0]], [x, y, z[1]])[0];
  assert.ok(hit && Math.abs(hit.position[2] - expected) < 0.002,
    'Printed surface at ' + [x, y] + ' should be ' + expected + ' mm, got ' + hit?.position[2]);
}

export async function checkRoadMarkings({ wasm, action, tab, input, live, openSection,
  openProject, download, downloadSelected }) {
  const project = newProject();
  project.name = 'Road marking check';
  project.track.params = {
    ...defaultTrack(), kind: 'straight', width: 200, length: 200, laneSpacing: 100,
    height: 10, slotDepth: 8, whiteLineWidth: 3, grooveWidth: 0.5, grooveDepth: 0.4,
  };
  await openProject(Buffer.from(JSON.stringify(project)), 'road-markings.slotfab');
  await tab('markings').click();
  await openSection('White lines on the road');
  assert.equal(await input('roadCentreLine').inputValue(), 'none');
  await input('roadCentreLine').selectOption('solid');
  assert.equal(await input('dashLength').isVisible(), false);
  await input('roadLineGroove').check();
  await live();
  const solidLine = parseSTL(wasm, (await downloadSelected()).bytes);
  try { expectSurface(solidLine, -76, 1.75, 9.6); } finally { solidLine.delete(); }

  await openSection('White lines on the road');
  await input('roadCentreLine').selectOption('dashed');
  await input('dashLength').fill('18');
  await input('dashGap').fill('12');
  await openSection('Kerbs');
  await input('roadKerbSide').selectOption('outer');
  await input('kerbWidth').fill('8');
  await input('kerbLength').fill('17');
  await input('kerbGroove').check();
  await live();
  const saved = await download(action('save'));
  await openProject(saved.bytes, saved.name);
  await tab('markings').click();
  for (const [key, value] of Object.entries({ roadCentreLine: 'dashed', dashLength: '18',
    dashGap: '12', roadKerbSide: 'outer', kerbWidth: '8', kerbLength: '17' }))
    assert.equal(await input(key).inputValue(), value, key);
  assert.equal(await input('kerbGroove').isChecked(), true);
  const straight = parseSTL(wasm, (await downloadSelected()).bytes);
  try {
    expectSurface(straight, -91, 1.75, 9.6);   // Side of first dash.
    expectSurface(straight, -81.75, 0, 9.6);   // Outline around its end.
    expectSurface(straight, -76, 1.75, 10);    // Gap restored on the same surface as the solid-line test.
    expectSurface(straight, -91, 92.25, 9.6);  // Road kerb outline, no border present.
    expectSurface(straight, -83, 95, 9.6);     // Joint between the first two kerbstones.
    expectSurface(straight, -91, -92.25, 10);  // Only the selected edge is marked.
    expectSurface(straight, -91, 50, 2);
  } finally { straight.delete(); }

  const pit = newProject();
  pit.name = 'Wide pit';
  pit.track.params = specialTrackParams('pit', project.track.params);
  pit.track.params.length = 1200;
  pit.track.params.special.pitOffset = 200;
  pit.track.params.special.pitWhiteLine = false;
  await openProject(Buffer.from(JSON.stringify(pit)), 'wide-pit.slotfab');
  await tab('markings').click();
  await openSection('White lines on the road');
  await input('spPitWhiteLine').check();
  await input('spPitCrossingStyle').selectOption('dashed');
  await input('roadLineGroove').check();
  assert.equal(await input('dashLength').isVisible(), true, 'pit dashes have controls even with the centre line off');
  await live();
  const savedPit = await download(action('save'));
  await openProject(savedPit.bytes, savedPit.name);
  await tab('markings').click();
  assert.equal(await input('spPitCrossingStyle').inputValue(), 'dashed');
  const pitRoad = parseSTL(wasm, (await downloadSelected()).bytes);
  try {
    // Pit STLs print face down. From the non-pit edge travel exactly one
    // original road width to reach the divider's pit-facing groove.
    const { max } = pitRoad.boundingBox();
    for (const x of [-55, 55]) expectSurface(pitRoad, x, max[1] - 200 - 0.2, 0.4, true);
  } finally { pitRoad.delete(); }
  console.log('✓ Road centre dashes, road kerbstones and the fixed-width pit divider survive save/reopen and produce recessed outlines in the offline STL exports.');
}
