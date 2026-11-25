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
    'Buildings',
    'STL Edit',
    'Library',
    'Settings',
  ]);
  // The pieces in groups, the specials it can still have as small buttons,
  // and the state of the layout beside its name.
  const groups = await panel.locator('.pl-catalog .pl-group').allTextContents();
  for (const g of ['Straights', 'Corners', 'Add a special piece', 'From Track Set']) assert.ok(groups.includes(g), g);
  assert.ok((await panel.locator('.pl-chips .pl-chip').count()) >= 3);
  assert.equal(await panel.locator('[data-pl-pill]').textContent(), 'Empty layout');
  await add(/^Full straight/);
  assert.equal(await panel.locator('[data-pl-pill]').textContent(), '2 open ends');
  assert.ok(await panel.locator('[data-pl-pill]').evaluate((p) => p.classList.contains('warn')));
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
  // Pieces go in whole: two sections until the layout is segmented for the bed.
  assert.equal((await state()).nodes.length, 2);
  await cmd('segment').click();
  await page.locator('dialog.pl-segment').waitFor();
  await cmd('segment-confirm').click();
  await idle();
  assert.match(await panel.locator('.pl-message').textContent(), /1 piece was cut to fit a 200 × 200 mm plate/);
  const initial = await state();
  assert.equal(initial.nodes.length, 7);
  await cmd('remove').click();
  await idle();
  await cmd('left').click();
  await add(/^R2 corner/);
  // The new corner is whole as well: one more section.
  const next = await state();
  assert.equal(next.nodes.length, 7);
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
  // Export waits for the print bed check: the first try opens the window
  // instead of downloading, and confirming the bed makes the layout exportable.
  await action('export-menu').click();
  const bed = page.locator('dialog.pl-segment');
  await bed.waitFor();
  assert.match(
    await bed.locator('.pl-segment-note').textContent(),
    /Confirm your print bed before exporting/,
  );
  assert.equal(await field('bedWidth').inputValue(), '200');
  await cmd('segment-confirm').click();
  await idle();
  assert.equal(await bed.count(), 0);
  assert.match(await panel.locator('.pl-message').textContent(), /ready to export/);
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
  await add(/^Timing$/);
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
    document.querySelector('.pl-stats').textContent.startsWith('7 sections'),
  );
  assert.equal((await state()).nodes.length, 7);
  await field('end').selectOption({ index: 0 });
  console.log(
    '✓ Track Planner snaps actual print sections, removes and reverses individual corners, opens specials, restores a layout, and exports the counted mirrored STL kit',
  );

  // A turnout in a single-lane layout: three ends, a side and an insert.
  await cmd('new').click();
  await idle();
  await field('pack').selectOption({ label: 'SlotForge Basic Single Lane' });
  await add(/^Full straight/);
  await cmd('left').click();
  await add(/^Turnout/);
  const ends = () => field('end').locator('option').allTextContents();
  const chosenEnd = () => field('end').evaluate((s) => s.selectedOptions[0].textContent);
  // Building carries on from the main exit; the branch is open as end C.
  assert.match(await chosenEnd(), /2 · Turnout · B$/);
  assert.ok((await ends()).some((text) => /2 · Turnout · C$/.test(text)), (await ends()).join(' | '));
  let plan = await state();
  const turnoutOf = (data) => data.sources[data.nodes[1].source].track.params.special;
  assert.equal(turnoutOf(plan).side, 'left');
  assert.equal(turnoutOf(plan).turnoutMode, 'digital');
  assert.match(await panel.locator('.pl-selection p').first().textContent(), /Branch to the left · Digital/);
  // The barrier and marking panels are not offered on a turnout; its insert is.
  assert.equal(await panel.locator('.pl-barriers').isVisible(), false);
  assert.equal(await panel.locator('.pl-markings').isVisible(), false);
  await field('turnoutMode').selectOption('closed');
  await cmd('turnout-mode').click();
  await idle();
  plan = await state();
  assert.equal(turnoutOf(plan).turnoutMode, 'closed');
  assert.equal(plan.nodes.length, 2);
  assert.match(await panel.locator('.pl-selection p').first().textContent(), /Branch to the left · Closed/);
  assert.match(await panel.locator('.pl-inventory').textContent(), /Turnout insert · Closed/);
  assert.match(await panel.locator('.pl-inventory').textContent(), /Turnout · L/);
  // A corner on the branch, then a straight on the main exit: both join.
  await field('end').selectOption({ label: (await ends()).find((text) => /Turnout · C$/.test(text)) });
  await add(/^R1 corner/);
  await field('end').selectOption({ label: (await ends()).find((text) => /Turnout · B$/.test(text)) });
  await add(/^Full straight/);
  plan = await state();
  assert.equal(plan.nodes.length, 4);
  assert.ok(!(await ends()).some((text) => /Turnout/.test(text)), 'all three ends of the turnout are joined or built on');
  assert.match(await panel.locator('.pl-stats').textContent(), /3 open ends/);
  assert.equal(await panel.locator('.pl-crossings button').count(), 0);
  // A right-hand turnout is its own piece in the parts list.
  await cmd('right').click();
  await add(/^Turnout/);
  plan = await state();
  assert.equal(plan.sources[plan.nodes.at(-1).source].track.params.special.side, 'right');
  assert.match(await panel.locator('.pl-inventory').textContent(), /Turnout · R/);
  await snap('track-planner-turnout');
  // The kit holds the turnout's parts and its notes.
  await action('export-menu').click();
  await page.locator('dialog.pl-segment').waitFor();
  await field('bedWidth').fill('320');
  await field('bedDepth').fill('320');
  await cmd('segment-confirm').click();
  await idle();
  const turnoutKit = unzipSync((await download(action('export-menu'))).bytes);
  const names = Object.keys(turnoutKit);
  assert.ok(names.some((k) => /turnout-insert/i.test(k)), names.join(' '));
  assert.ok(names.some((k) => /^notes\/.*-assembly\.txt$/.test(k)));
  const notes = names.filter((k) => /-assembly\.txt$/.test(k)).map((k) => strFromU8(turnoutKit[k])).join('\n');
  assert.match(notes, /insert/i);

  // A pit lane beside the main road: split, four straights, join, both
  // branches turned back, and a straight made to the length of the gap.
  const note = () => panel.locator('.pl-message').textContent();
  const pick = async (pattern) =>
    field('end').selectOption({ label: (await ends()).find((text) => pattern.test(text)) });
  await cmd('new').click();
  await idle();
  await cmd('left').click();
  await add(/^Full straight/);
  await cmd('fill-gap').click();
  await idle();
  assert.match(await note(), /No open end faces the chosen build end in a straight line/);
  assert.equal(await cmd('split').getAttribute('aria-pressed'), 'true');
  await add(/^Turnout/);
  for (let i = 0; i < 4; i++) await add(/^Full straight/);
  await cmd('merge').click();
  await add(/^Turnout/);
  plan = await state();
  // The join lies the other way round: it is the right-hand piece, on its main exit.
  assert.equal(plan.sources[plan.nodes.at(-1).source].track.params.special.side, 'right');
  assert.match(await chosenEnd(), /7 · Turnout · A$/);
  await cmd('return-curve').click();
  await idle();
  assert.match(await note(), /× R1 corner brings? the branch back parallel to the main road/);
  await pick(/^2 · Turnout · C$/);
  await cmd('return-curve').click();
  await idle();
  const before = (await state()).nodes.length;
  await cmd('fill-gap').click();
  await idle();
  assert.match(await note(), /A straight of [\d.,]+ mm closes the gap\./);
  plan = await state();
  assert.equal(plan.nodes.length, before + 1);
  assert.match(await panel.locator('.pl-stats').textContent(), /2 open ends/);
  assert.match(await panel.locator('.pl-inventory').textContent(), /Straight [\d.,]+ mm/);
  assert.equal(await panel.locator('.pl-crossings button').count(), 0);
  // One Undo takes the fitted straight away again.
  await cmd('undo').click();
  await idle();
  assert.equal((await state()).nodes.length, before);

  // A road surface texture for selected sections: the straight takes it, the turnout does not.
  await cmd('new').click();
  await idle();
  await cmd('split').click();
  await add(/^Full straight/);
  await pick(/^1 · Full straight · A$/);
  assert.equal(await panel.locator('.pl-texture').count(), 1);
  await panel.locator('.pl-texture summary').click();
  await field('texKind').selectOption('cobbles');
  await field('texSize').selectOption('full');
  await field('texFit').selectOption('piece');
  await cmd('texture').click();
  await idle();
  plan = await state();
  const textured = plan.sources[plan.nodes[0].source].track.params;
  assert.equal(textured.roadTexture, 'cobbles');
  assert.equal(textured.textureSize, 'full');
  assert.equal(textured.textureFit, 'piece');
  assert.equal(await panel.locator('.pl-message.error').count(), 0);
  await pick(/^1 · Full straight · B$/);
  await add(/^Turnout/);
  assert.equal(await panel.locator('.pl-texture').count(), 0, 'a turnout has no texture panel');
  await cmd('undo').click();
  await idle();
  await cmd('undo').click();
  await idle();
  assert.equal((await state()).sources[(await state()).nodes[0].source].track.params.roadTexture ?? 'none', 'none');

  // A pit ladder: three bays in one go, each closed by an end stop.
  await cmd('new').click();
  await idle();
  await cmd('split').click();
  await add(/^Full straight/);
  await cmd('ladder').click();
  const ladderBox = page.locator('dialog.pl-ladder');
  await ladderBox.waitFor();
  assert.equal(await field('ladderBays').inputValue(), '3');
  assert.equal(await field('ladderParallel').isChecked(), true);
  const least = Number(await field('ladderSpacing').inputValue());
  assert.ok(least > 400, 'the suggested spacing keeps parallel bays apart: ' + least);
  // Too close: refused with the spacing that works, and nothing is added.
  // A straight too short to make between the turnouts says what to enter.
  await field('ladderSpacing').fill('280');
  await cmd('ladder-confirm').click();
  await idle();
  assert.match(await note(), /The straight of 20 mm between two turnouts cannot be made\..*Use a spacing of 260 mm, with no straight between the turnouts, or a larger one\./);
  assert.equal((await state()).nodes.length, 1);
  await cmd('ladder').click();
  await ladderBox.waitFor();
  await field('ladderSpacing').fill('260');
  await cmd('ladder-confirm').click();
  await idle();
  assert.match(await note(), /The bays would run into each other or into the layout\. Use a spacing of at least [\d.,]+ mm/);
  assert.equal((await state()).nodes.length, 1);
  await cmd('ladder').click();
  await ladderBox.waitFor();
  await cmd('ladder-confirm').click();
  await idle();
  assert.match(await note(), /3 pit bays were added/);
  plan = await state();
  const named = (name) => plan.nodes.filter((n) => plan.sources[n.source].name === name).length;
  assert.equal(named('Turnout'), 3);
  assert.equal(named('End stop'), 3);
  assert.match(await panel.locator('.pl-stats').textContent(), /2 open ends/);
  assert.equal(await panel.locator('.pl-crossings button').count(), 0);
  assert.match(await chosenEnd(), /Turnout · B$/);
  await snap('track-planner-pit-ladder');
  // The whole ladder is one step back.
  await cmd('undo').click();
  await idle();
  assert.equal((await state()).nodes.length, 1);
  // The end stop is a piece of its own under Specials, and closes the run.
  await add(/^End stop/);
  assert.match(await panel.locator('.pl-stats').textContent(), /1 open end/);
  console.log(
    '✓ Track Planner places a turnout that joins two lanes, turns both branches back with return curves, fits a straight to the gap, builds a pit ladder of three bays in one step and closes a run with an end stop',
  );
  await cmd('left').click();
  await action('mode-track').click();
  console.log(
    '✓ Track Planner places a left and a right turnout with three ends, builds on the branch and the main exit, swaps the insert of a placed turnout, and exports its parts and notes',
  );
}
