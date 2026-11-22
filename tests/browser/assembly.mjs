import assert from 'node:assert/strict';
import { encodeSTL, parseSTL } from '../../src/editor.js';
import { clipSTLHeader } from '../../src/geometry/clip-types.js';
import { clipTypeFromSTL } from '../../src/geometry/fork-clip.js';

export async function checkAssembly({
  wasm,
  page,
  action,
  tab,
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
  const raw = wasm.Manifold.cube([10, 10, 10]);
  const second = raw.translate([5, 0, 0]);
  try {
    await upload('import-context', {
      name: 'Box.stl',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(encodeSTL(raw)),
    });
    await waitText('#model-title', 'Box.stl');
    await upload('add-model', {
      name: 'Cutter.stl',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(encodeSTL(second, clipSTLHeader('slotforge'))),
    });
  } finally {
    raw.delete();
    second.delete();
  }
  await opCount(1);
  const original = await download(action('save'));
  const add = JSON.parse(original.bytes).editor.ops[0];
  assert.equal(add.type, 'addModel');
  assert.equal(add.clipType, 'slotforge');
  await page.locator('[data-include-part="body"]').click();
  await tab('combine-parts').click();
  await input('assemblyTarget').selectOption('body');
  await input('combineMethod').selectOption('subtract');
  await live();
  await snap('combine-parts');
  await action('apply').click();
  await opCount(2);
  async function checkVolume(expected) {
    const { bytes } = await downloadSelected();
    assert.equal(clipTypeFromSTL(bytes), 'slotforge');
    const solid = parseSTL(wasm, bytes);
    try {
      assert.equal(solid.volume(), expected);
    } finally {
      solid.delete();
    }
  }
  await checkVolume(500);
  const combined = await download(action('save'));
  await openProject(combined.bytes, 'cut.slotfab');
  await page.locator('[data-op]').last().click();
  assert.equal(await input('combineMethod').inputValue(), 'subtract');
  await input('combineMethod').selectOption('join');
  await live();
  const oldRow = await page.locator('[data-op]').last().elementHandle();
  await action('apply').click();
  await page.waitForFunction(
    (row) =>
      !row.isConnected &&
      document.querySelector('#app').getAttribute('aria-busy') === 'false',
    oldRow,
  );
  await oldRow.dispose();
  await checkVolume(1500);
  await openProject(original.bytes, 'pair.slotfab');
  await page.locator('[data-part="body"]').click();
  await page.locator('[data-include-part="' + add.id + '"]').click();
  await tab('align-parts').click();
  await input('assemblyTarget').selectOption(add.id);
  await input('alignment').selectOption('faces');
  await action('top').click();
  const canvas = page.locator('#viewport canvas');
  await action('pick-moving-face').click();
  await canvas.click();
  await page.waitForFunction(() =>
    document
      .querySelectorAll('.assembly-pick-note')[0]
      ?.textContent.includes('Point'),
  );
  await action('pick-reference-face').click();
  await canvas.click();
  await live();
  await input('partGap').fill('1');
  await live();
  await action('apply').click();
  await opCount(2);
  const aligned = JSON.parse((await download(action('save'))).bytes).editor
    .ops[1];
  assert.equal(aligned.type, 'alignParts');
  assert.equal(aligned.reference, 'body');
  assert.equal(aligned.gap, 1);
  for (const f of [aligned.sourceFace, aligned.destinationFace])
    assert.ok(f.normal[2] > 0.999);
  await action('undo').click();
  await opCount(1);
  assert.equal(await page.locator('[data-part]').count(), 2);
  console.log(
    '✓ Add STL preserves history; checked parts, directional subtraction, saved history revision, two picked faces, and Undo work in the shipped editor',
  );
}
