import assert from 'node:assert/strict';
import { newProject } from '../../src/project.js';
import { parseSTL } from '../../src/editor.js';

export async function checkSolidMove({
  wasm,
  page,
  action,
  input,
  openProject,
  download,
  downloadSelected,
  opCount,
  live,
  snap,
}) {
  const project = newProject();
  project.mode = 'editor';
  project.name = 'Move a solid';
  await openProject(
    Buffer.from(JSON.stringify(project)),
    'move-a-solid.slotfab',
  );
  const original = (await downloadSelected()).bytes;
  await page.locator('#workspace-nav [data-tab="primitive"]').click();
  await live();
  await action('top').click();
  const handle = (h) => page.locator('button[data-solid-move="' + h + '"]');
  const undo = page.locator('button[data-undo-position]');
  const center = async (el) => {
    const b = await el.boundingBox();
    assert.ok(b);
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  async function pull(which, dx, dy, cancel = false) {
    const [x, y] = await center(handle(which));
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 4 });
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    await live();
  }
  const p = async (key) => Number(await input('shape' + key).inputValue());
  await pull(0, 27, 0);
  assert.ok((await p('X')) > 0);
  assert.equal(await p('Y'), 0);
  assert.equal(await p('Z'), 0);
  await undo.click();
  await live();
  assert.equal(await p('X'), 0);
  await pull('plane', 20, -16, true);
  assert.deepEqual([await p('X'), await p('Y'), await p('Z')], [0, 0, 0]);
  // Grab the box away from the floating controls.
  const [ax, ay] = await center(handle('plane'));
  await page.mouse.move(ax + 24, ay + 24);
  await page.mouse.down();
  await page.mouse.move(ax + 39, ay + 14, { steps: 3 });
  await page.mouse.up();
  await live();
  assert.ok((await p('X')) > 0 && (await p('Y')) > 0);
  assert.equal(await p('Z'), 0);
  await undo.click();
  await live();
  assert.deepEqual([await p('X'), await p('Y')], [0, 0]);
  await handle(2).press('ArrowUp');
  await live();
  assert.equal(await p('Z'), 1);
  await input('shapeX').fill('7');
  await input('shapeY').fill('-4');
  await input('shapeZ').fill('3');
  await live();
  await action('iso').click();
  await action('fit').click();
  await snap('move-solid-axes');
  await input('shapeX').fill('65');
  await live();
  await action('iso').click();
  await action('apply').click();
  await opCount(1);
  const selected = page.getByRole('button', { name: 'Move selected part' });
  await selected.click();
  await handle(0).press('ArrowUp');
  await handle(1).press('ArrowDown');
  await handle(2).press('Shift+ArrowUp');
  await live();
  await action('apply').click();
  await opCount(2);
  const exported = (await downloadSelected()).bytes;
  // Individual print STLs are recentered. The assembly STL retains world placement.
  await action('export-menu').click();
  await page.locator('.export-other summary').click();
  const assembly = parseSTL(
    wasm,
    (await download(action('export-assembly'))).bytes,
  );
  const bodies = assembly.decompose();
  try {
    const box = bodies.map((b) => b.boundingBox()).find((b) => b.min[0] > 40);
    assert.ok(box);
    assert.ok(
      box.min.every((v, i) => Math.abs(v - [46, -20, 3.1][i]) < 1e-5),
      JSON.stringify(box),
    );
    assert.ok(box.max.every((v, i) => Math.abs(v - [86, 10, 15.1][i]) < 1e-5));
  } finally {
    bodies.forEach((b) => b.delete());
    assembly.delete();
  }
  const saved = (await download(action('save'))).bytes;
  assert.equal(JSON.parse(saved).editor.ops[0].x, 65);
  assert.deepEqual(JSON.parse(saved).editor.ops[1].move, [1, -1, 0.1]);
  await openProject(saved, 'moved-box.slotfab');
  await page.locator('button[data-part]').filter({ hasText: 'Box' }).click();
  assert.deepEqual((await downloadSelected()).bytes, exported);
  await page
    .locator('button[data-part]')
    .filter({ hasText: 'Workshop enclosure' })
    .click();
  assert.deepEqual((await downloadSelected()).bytes, original);
  console.log(
    '✓ Axis and body drags, Cancel, Undo move and exact offsets persist in the box STL while the enclosure stays in place',
  );
}
