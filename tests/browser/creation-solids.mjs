import assert from 'node:assert/strict';
import { newProject } from '../../src/project.js';
import { workplane } from '../../src/design.js';
import { parseSTL } from '../../src/editor.js';

export async function checkCreationSolids({
  wasm,
  page,
  action,
  input,
  opCount,
  live,
  upload,
  download,
  downloadSelected,
  openProject,
  waitText,
  snap,
}) {
  const project = newProject();
  project.mode = 'editor';
  project.name = 'Creation profiles';
  project.editor.source = { empty: true, label: 'Creation profiles' };
  const sketch = (name, plane, entities) => ({
    id: name.replaceAll(' ', '-'),
    type: 'sketch',
    name,
    label: name,
    plane,
    offset: 0,
    frame: workplane(plane),
    sketch: { entities },
  });
  const rect = (x, y, width, height) => ({
    type: 'rectangle',
    x,
    y,
    width,
    height,
  });
  const circle = (diameter) => ({ type: 'circle', x: 0, y: 0, diameter });
  const curve = Array.from({ length: 13 }, (_, i) => {
    const a = (i * Math.PI) / 24;
    return [25 * Math.cos(a), 25 * Math.sin(a)];
  });
  project.editor.ops = [
    sketch('Radial profile', 'xz', [rect(3, 0, 4, 10)]),
    sketch('Grip section', 'xy', [circle(4)]),
    sketch('Handle path', 'xz', [
      { type: 'path', closed: false, points: curve },
    ]),
    sketch('Square rim', 'xy', [rect(-10, -10, 20, 20), rect(-3, -3, 6, 6)]),
    sketch('Round rim', 'xy', [circle(16), circle(4)]),
  ];
  await action('open').click();
  await upload('browse', {
    name: 'profiles.slotfab',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await waitText('#project-name', project.name);
  let count = project.editor.ops.length;
  await opCount(count);
  const tool = (kind) =>
    page.locator('#workspace-nav [data-tab="' + kind + '"]').click();
  async function applyAndMeasure(check) {
    await live();
    await action('apply').click();
    await opCount(++count);
    const file = await downloadSelected();
    const part = parseSTL(wasm, file.bytes);
    try {
      check(part);
    } finally {
      part.delete();
    }
  }
  // Start with free-standing stock, without an imported mesh or a picked face.
  await tool('primitive');
  await input('primitiveShape').selectOption('tube');
  await input('shapeDiameter').fill('12');
  await input('boreDiameter').fill('6');
  await input('shapeHeight').fill('8');
  await applyAndMeasure((part) => {
    assert.ok(Math.abs(part.volume() - Math.PI * 27 * 8) < 5);
    assert.equal(part.rayCast([0, 0, 12], [0, 0, -2]).length, 0);
  });
  await tool('revolve');
  await input('profileSketch').selectOption('Radial-profile');
  await input('revolveAngle').fill('90');
  await applyAndMeasure((part) =>
    assert.ok(Math.abs(part.volume() - Math.PI * 100) < 2.5),
  );
  await tool('sweep');
  await input('profileSketch').selectOption('Grip-section');
  await input('pathSketch').selectOption('Handle-path');
  await applyAndMeasure((part) => {
    assert.ok(part.volume() > 480 && part.volume() < 495);
    assert.ok(part.boundingBox().max[2] - part.boundingBox().min[2] > 24);
  });
  await tool('loft');
  await input('profileSketch').selectOption('Square-rim');
  await input('loftSketch').selectOption('Round-rim');
  await input('loftDistance').fill('24');
  await live();
  await action('iso').click();
  await snap('square-to-round-loft');
  await applyAndMeasure((part) => {
    assert.equal(part.boundingBox().max[2] - part.boundingBox().min[2], 24);
    assert.equal(part.rayCast([0, 0, 26], [0, 0, -2]).length, 0);
  });
  const saved = await download(action('save'));
  await openProject(saved.bytes, 'created-parts.slotfab');
  const rebuilt = JSON.parse(saved.bytes.toString());
  const last = rebuilt.editor.ops.at(-1);
  assert.equal(last.kind, 'loft');
  assert.equal(last.sectionId, 'Round-rim');
  await page.locator('[data-op="' + last.id + '"]').click();
  assert.equal(await input('loftDistance').inputValue(), '24');
  console.log(
    '✓ Dimensioned primitive, partial revolution, curved sweep and hollow square-to-round loft produce printable geometry and reopen as editable features',
  );
}
