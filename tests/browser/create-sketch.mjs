import assert from 'node:assert/strict';
import { newProject } from '../../src/project.js';

// Exercise the shipped app rather than constructing a sketch through its data API.
export async function checkSketchCreation({
  page,
  action,
  download,
  openProject,
  snap,
}) {
  await action('new-design').click();
  await page
    .locator('#model-title')
    .filter({ hasText: 'Untitled design' })
    .waitFor();
  await action('new-sketch').click();
  const sketch = page.getByRole('dialog', { name: 'Edit sketch' });
  const canvas = sketch.locator('canvas');
  await canvas.waitFor();
  const name = sketch.locator('[data-sk-name]');
  await name.fill('Snap and dimensions');
  const box = await canvas.boundingBox();
  const scale = Math.min(box.width / 100, box.height / 70) * 0.78;
  const point = (x, y, dx = 0, dy = 0) => ({
    position: {
      x: box.width / 2 + x * scale + dx,
      y: box.height / 2 - y * scale + dy,
    },
  });
  await sketch.locator('[data-sk-tool="rectangle"]').click();
  await canvas.click(point(0, 0, 3, 2));
  await canvas.click(point(22, 12));
  assert.equal(await sketch.locator('[data-key=x]').inputValue(), '0');
  assert.equal(await sketch.locator('[data-key=y]').inputValue(), '0');
  await sketch.locator('[data-key=width]').fill('36');
  await sketch.locator('[data-key=height]').fill('14');
  await sketch.locator('[data-sk-tool=line]').click();
  await canvas.click(point(18, 7, 3, 1));
  await canvas.click(point(42, 14));
  await canvas.press('Enter');
  await sketch.locator('[data-sk-finish]').click();
  await page
    .locator('[data-sketch]')
    .filter({ hasText: 'Snap and dimensions' })
    .waitFor();
  await action('new-sketch').click();
  await name.fill('Imported paths');
  await sketch.locator('[data-sk-plane]').selectOption('xz');
  await sketch.locator('[data-sk-offset]').fill('8');
  const chooser = page.waitForEvent('filechooser');
  await sketch.locator('[data-sk-import]').click();
  await (
    await chooser
  ).setFiles({
    name: 'paths.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="20mm" viewBox="0 0 40 20"><path d="M 2 2 H 12 V 8 H 2 Z M 4 4 H 9 V 6 H 4 Z"/><path d="M 18 3 L 24 9 L 35 5"/></svg>',
    ),
  });
  await sketch
    .locator('[data-sk-status]')
    .filter({ hasText: '2 closed outlines · 1 open path' })
    .waitFor();
  // Sample the live sketch, between grid lines. The inner loop is a hole.
  const coverage = await canvas.evaluate(
    (c) =>
      new Promise((resolve) =>
        requestAnimationFrame(() => {
          const view = c.getBoundingClientRect(),
            dpr = c.width / view.width;
          const scale = Math.min(view.width / 33, view.height / 7) * 0.78;
          const alpha = (x) =>
            c
              .getContext('2d')
              .getImageData(
                Math.round((view.width / 2 + (x - 18.5) * scale) * dpr),
                Math.round((view.height / 2) * dpr),
                1,
                1,
              ).data[3];
          resolve([alpha(3.5), alpha(6.5)]);
        }),
      ),
  );
  assert.ok(coverage[0] > coverage[1] + 20);
  if (snap) await snap('creation-sketch');
  await sketch.locator('[data-sk-finish]').click();
  await page
    .locator('[data-sketch]')
    .filter({ hasText: 'Imported paths' })
    .waitFor();
  const saved = await download(action('save'));
  const project = JSON.parse(saved.bytes.toString());
  const [drawn, imported] = project.editor.ops;
  assert.equal(drawn.type, 'sketch');
  assert.deepEqual(drawn.sketch.entities[0], {
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 36,
    height: 14,
  });
  assert.deepEqual(drawn.sketch.entities[1].points[0], [18, 7]);
  assert.equal(imported.plane, 'xz');
  assert.equal(imported.offset, 8);
  assert.deepEqual(imported.sketch.entities.map((e) => e.closed).sort(), [
    false,
    true,
    true,
  ]);
  await openProject(saved.bytes, 'creation-sketch.slotfab');
  await page.locator('[data-op]').filter({ hasText: 'Imported paths' }).click();
  assert.equal(await sketch.locator('[data-sk-offset]').inputValue(), '8');
  assert.equal(await name.inputValue(), 'Imported paths');
  await sketch.locator('footer [data-sk-cancel]').click();

  const demo = newProject();
  demo.mode = 'editor';
  await openProject(Buffer.from(JSON.stringify(demo)), 'planar-face.slotfab');
  await action('top').click();
  const viewport = page.locator('#viewport canvas').first(),
    stage = await viewport.boundingBox();
  await viewport.click({
    position: { x: stage.width / 2, y: stage.height / 2 },
  });
  await page.locator('#selection-count[data-count="1"]').waitFor();
  await action('new-sketch').click();
  const plane = sketch.locator('[data-sk-plane]'),
    projectEdges = sketch.locator('[data-sk-project]');
  assert.equal(await plane.inputValue(), 'face');
  await plane.selectOption('xy');
  assert.equal(await projectEdges.isVisible(), false);
  await plane.selectOption('face');
  await projectEdges.click();
  await name.fill('Projected floor');
  await sketch.locator('[data-sk-finish]').click();
  await page
    .locator('[data-sketch]')
    .filter({ hasText: 'Projected floor' })
    .waitFor();
  const final = JSON.parse((await download(action('save'))).bytes.toString());
  const projected = final.editor.ops.at(-1);
  assert.equal(projected.plane, 'face');
  assert.ok(
    projected.sketch.entities.length > 0 &&
      projected.sketch.entities.every((e) => e.closed),
  );
  assert.deepEqual(
    projected.sketch.entities.map((e) => e.points),
    projected.referenceLoops,
  );
  console.log(
    '✓ Create a sketch with grid/centre snapping, exact dimensions, imported outlines and open paths, editable history, and projected edges on a picked face',
  );
}
