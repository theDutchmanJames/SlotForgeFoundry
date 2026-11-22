import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';

export async function checkPlanner({ page, action, download, snap }) {
  const panel = page.locator('#track-planner'),
    cmd = (k) => panel.locator('[data-pl="' + k + '"]');
  const field = (k) => panel.locator('[data-pl-field="' + k + '"]');
  const idle = () =>
    page.waitForFunction(
      () => !document.querySelector('#track-planner').hasAttribute('aria-busy'),
    );
  const add = async (name) => {
    await panel.getByRole('button', { name }).click();
    await idle();
  };
  const state = async () => JSON.parse((await download(action('save'))).bytes);
  await action('mode-planner').click();
  await panel.waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll('.pl-card').length === 10,
  );
  assert.deepEqual(await page.locator('.appbar nav button').allTextContents(), [
    'Home',
    'Track Set',
    'Track Planner',
    'STL Edit',
    'Library',
    'Settings',
  ]);
  await add(/^Full straight/);
  await add(/^R4 corner/);
  // Built pieces are kept on this device for the next session.
  await page.waitForFunction(async () => {
    const db = await new Promise((resolve) => {
      const r = indexedDB.open('slotforge-planner-cache');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    });
    if (!db?.objectStoreNames.contains('pieces')) return false;
    const count = await new Promise((resolve) => {
      const r = db.transaction('pieces').objectStore('pieces').count();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return count >= 2;
  });
  const initial = await state();
  assert.equal(initial.nodes.length, 7);
  await cmd('remove').click();
  await idle();
  await cmd('left').click();
  await add(/^R2 corner/);
  const next = await state();
  assert.equal(next.nodes.length, 10);
  assert.ok(next.nodes.at(-1).pose.flip);
  await cmd('reverse').click();
  await idle();
  assert.equal((await state()).nodes.at(-1).pose.flip, false);
  await cmd('undo').click();
  await idle();
  assert.equal((await state()).nodes.at(-1).pose.flip, true);
  await snap('track-planner-layout');
  await cmd('solid').click();
  await idle();
  assert.ok(await panel.locator('.planner-solid canvas').isVisible());
  await snap('track-planner-3d');
  await cmd('plan').click();
  await idle();
  const kit = unzipSync((await download(action('export-menu'))).bytes);
  assert.equal(JSON.parse(strFromU8(kit['layout.slotplan'])).nodes.length, 10);
  // Every different part once, its count in the name, grouped by folder.
  const stls = Object.keys(kit).filter((k) => k.endsWith('.stl'));
  assert.ok(stls.some((k) => /-mirrored-x\d+\.stl$/.test(k)));
  assert.ok(stls.every((k) => /^(track|borders|hardware|supports|tools|parts)\//.test(k)));
  assert.ok(stls.filter((k) => !k.startsWith('tools/')).every((k) => /-x\d+\.stl$/.test(k)));
  assert.equal(new Set(stls.map((k) => k.replace(/-x\d+\.stl$/, ''))).size, stls.length);
  assert.ok(strFromU8(kit['parts.csv']).includes('R4 corner'));
  // Shopping list: filament weight and braid for each lane.
  const shopping = strFromU8(kit['shopping-list.txt']);
  assert.match(shopping, /Estimated weight: \d+\.\d\d kg/);
  const laneBraid = [...shopping.matchAll(/Lane \d: slot (\d+\.\d\d) m/g)].map((m) => Number(m[1]));
  assert.ok(laneBraid.length >= 2 && laneBraid.every((v) => v > 0.1), shopping);
  await cmd('special').click();
  await add(/^Timing straight/);
  assert.equal((await state()).nodes.length, 11);
  const old = JSON.stringify(next);
  await action('mode-track').click();
  await action('mode-planner').click();
  assert.equal((await state()).nodes.length, 11);
  await page
    .locator('#file')
    .setInputFiles({
      name: 'saved.slotplan',
      mimeType: 'application/json',
      buffer: Buffer.from(old),
    });
  await page.waitForFunction(() =>
    document.querySelector('.pl-stats').textContent.startsWith('10 sections'),
  );
  assert.equal((await state()).nodes.length, 10);
  await field('end').selectOption({ index: 0 });
  await action('mode-track').click();
  console.log(
    '✓ Track Planner snaps actual print sections, removes and reverses individual corners, opens specials, restores a layout, and exports the counted mirrored STL kit',
  );
}
