import assert from 'node:assert/strict';
import { parseSTL } from '../../src/editor.js';
import { newProject } from '../../src/project.js';

// Slot position, through the real controls: a single-lane straight whose slot
// runs from 35 mm to 145 mm from the left edge of a 200 mm road.
export async function checkSlotPosition({
  page,
  wasm,
  action,
  tab,
  input,
  live,
  download,
  downloadSelected,
  openProject,
  openSection,
  waitText,
  snap,
}) {
  const saved = async () =>
    JSON.parse((await download(action('save'))).bytes).track.params;
  const slot = { version: 1, edge: 'outer', startMm: 35, endMm: 145 };
  const pathPoints = (d) =>
    [...d.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => [+m[1], +m[2]]);

  const project = newProject();
  project.name = 'Slot position test';
  Object.assign(project.track.params, {
    kind: 'straight',
    length: 300,
    width: 200,
    lanes: 1,
    laneSpacing: 100,
    borderSide: 'none',
    borderSegments: 1,
    joint: 'clips',
    connectorCounts: { seamClips: 2 },
  });
  await openProject(Buffer.from(JSON.stringify(project)), 'slot-position.slotfab');

  // ---- The inspector: edit the open straight.
  await tab('geometry').click();
  await openSection('Lane layout');
  const group = page.locator('#settings-form [data-slot-position]');
  const mode = group.locator('[data-slot-mode]');
  const notes = group.locator('[data-slot-notes]');
  const error = page.locator('#live-status[data-state="error"]');
  assert.equal(await mode.inputValue(), 'centre');
  assert.equal(await group.locator('[data-slot-options]').isVisible(), false);
  assert.equal(await page.locator('[data-centred-lane]').isVisible(), true);
  await mode.selectOption('off');
  assert.equal(await input('slotEdge').inputValue(), 'outer');
  assert.equal(await input('slotEdge').locator('option:checked').textContent(), 'Left edge');
  assert.equal(await group.locator('[data-slot-looking]').isVisible(), true);
  assert.equal(await page.locator('[data-centred-lane]').isVisible(), false);
  // Restore brings the unapplied choice back to Centred.
  await live();
  await action('restore').click();
  await live('idle');
  assert.equal(await mode.inputValue(), 'centre');
  assert.equal(await group.locator('[data-slot-options]').isVisible(), false);
  await mode.selectOption('off');
  // Several lanes keep their slots where they are, and the group says so.
  await input('lanes').fill('2');
  await group.locator('[data-slot-unavailable]').waitFor();
  assert.equal(await mode.isVisible(), false);
  assert.equal(await group.locator('[data-slot-options]').isVisible(), false);
  await input('lanes').fill('1');
  await mode.waitFor();
  assert.equal(await mode.inputValue(), 'off');
  await input('slotStart').fill('35');
  await input('slotEnd').fill('145');
  await live();
  assert.equal(await page.locator('#live-status').getAttribute('data-state'), 'ready');
  assert.match(
    await group.locator('[data-slot-readout]').innerText(),
    /End A is 165 mm and end B 55 mm from the right edge\. Room on this road: /,
  );
  // 110 mm sideways in 300 mm is a gentle bend: a note, not a warning.
  assert.match(await notes.innerText(), /tightest bend in the slot is about \d+ mm radius, which is gentle/);
  assert.equal(await notes.locator('.slot-warning').count(), 0);
  await input('length').fill('150');
  await notes.locator('.slot-warning').filter({ hasText: 'tightest bend' }).waitFor();
  assert.match(await notes.locator('.slot-warning').first().innerText(), /make the piece at least \d+ mm long/);
  await input('length').fill('300');
  await notes.locator('.slot-warning').waitFor({ state: 'detached' });
  await live();
  const applied = await saved();
  assert.deepEqual(applied.slotPosition, slot);
  await snap('slot-position-inspector');
  // The printable road has its slot where it was typed: 65 mm left of centre
  // at end A, 10 mm at mid-length and 45 mm right of centre at end B.
  const road = parseSTL(wasm, (await downloadSelected()).bytes);
  try {
    const { min, max } = road.boundingBox();
    assert.ok(Math.abs(max[0] - min[0] - 300) < 0.002 && Math.abs(max[1] - min[1] - 200) < 0.002);
    const top = (x, y) => road.rayCast([x, y, applied.height + 1], [x, y, -1])[0]?.position[2];
    const floor = applied.height - applied.slotDepth;
    for (const [x, y] of [[-149.5, 65], [0, 10], [149.5, -45]]) {
      assert.ok(Math.abs(top(x, y) - floor) < 0.002, 'slot floor at ' + x + ', ' + y + ': ' + top(x, y));
      assert.ok(Math.abs(top(x, -y) - applied.height) < 0.002, 'plain road at ' + x + ', ' + -y);
    }
    assert.ok(Math.abs(top(0, 0) - applied.height) < 0.002, 'no slot on the road centre');
  } finally {
    road.delete();
  }

  // 3 mm puts the braid off the road: the edit is refused, not built.
  await tab('geometry').click();
  await openSection('Lane layout');
  await input('slotStart').fill('3');
  await error.waitFor();
  assert.match(
    await error.innerText(),
    /The slot at end A is 3 mm from the left edge\. Keep it between [\d.]+ and [\d.]+ mm so the slot and braids stay on the road\./,
  );
  await page.locator('#settings-form [data-action="apply"]').click();
  await waitText('#notice', 'so the slot and braids stay on the road');
  await page.locator('#notice').click();
  assert.equal(await page.locator('#live-status').getAttribute('data-state'), 'error');
  assert.equal(await page.locator('[data-action="save"] span').textContent(), 'Apply & save');
  // Typing the applied distance again leaves nothing to apply.
  await input('slotStart').fill('35');
  await live('idle');
  assert.equal(await page.locator('[data-action="save"] span').textContent(), 'Save');

  // A corner keeps one distance: end B is not asked for.
  await input('kind').selectOption('curve');
  await live();
  assert.equal(await group.locator('[data-slot-end]').isVisible(), false);
  assert.equal(await group.locator('[data-slot-curve]').isVisible(), true);
  assert.equal(await group.locator('[data-slot-looking]').isVisible(), false);
  assert.equal(await input('slotEdge').locator('option:checked').textContent(), 'Outer edge');
  assert.deepEqual((await saved()).slotPosition, { ...slot, endMm: 35 });
  await tab('geometry').click();
  await input('kind').selectOption('straight');
  await openSection('Lane layout');
  await input('slotEnd').fill('145');
  await live();
  assert.deepEqual((await saved()).slotPosition, slot);

  // ---- Connector positions: the map draws the slot where it runs.
  await tab('joints').click();
  await action('place-connectors').click();
  const placement = page.locator('dialog.connector-placement');
  const find = (k) => placement.locator('[data-cp-' + k + ']');
  // Across the joint, measured on the map: 0 at one road edge, 1 at the other.
  async function slotAcross(end) {
    await find('scope').selectOption(end);
    await placement.locator('.cp-lane').first().waitFor({ state: 'attached' });
    const lane = pathPoints(await placement.locator('.cp-lane').first().getAttribute('d'));
    const edge = pathPoints(await find('edge').getAttribute('d'));
    const [a, b] = [edge[0], edge.at(-1)];
    const point = end === 'start' ? lane[0] : lane.at(-1);
    const along =
      ((point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1])) /
      ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
    // The map plots y upwards, so the left edge of this straight is on top.
    const top = a[1] < b[1] ? along : 1 - along;
    return top;
  }
  assert.ok(Math.abs((await slotAcross('start')) - 35 / 200) < 0.01, 'slot 35 mm from the left edge at end A');
  assert.match(await find('hint').innerText(), /off-centre slot/);
  await placement.locator('[data-cp-kind="clip"]').click();
  const clips = await find('pick').locator('option').evaluateAll((options) =>
    options.slice(1).map((o) => parseFloat(o.textContent.split(' · ')[1])),
  );
  assert.equal(clips.length, 2);
  // Offsets are measured from the road centre; the slot is at +65 mm here.
  assert.ok(clips.every((mm) => Math.abs(mm - 65) > 9), 'clips keep clear of the slot: ' + clips.join(', '));
  assert.ok(Math.abs((await slotAcross('finish')) - 145 / 200) < 0.01, 'slot 145 mm from the left edge at end B');
  await snap('slot-position-connectors');
  await find('done').click();
  await placement.waitFor({ state: 'detached' });

  // ---- Back to Centred: nothing is stored.
  await tab('geometry').click();
  await openSection('Lane layout');
  await mode.selectOption('centre');
  await live();
  assert.equal(await group.locator('[data-slot-options]').isVisible(), false);
  assert.equal(await page.locator('[data-centred-lane]').isVisible(), true);
  assert.equal('slotPosition' in (await saved()), false);

  // ---- A connector the moving slot leaves no room for points at Slot position.
  const tight = newProject();
  tight.name = 'Slot position warning';
  Object.assign(tight.track.params, {
    ...project.track.params,
    length: 400,
    clipType: 'carrera-retained',
    connectorCounts: undefined,
    slotPosition: { version: 1, edge: 'outer', startMm: 100, endMm: 35 },
  });
  await openProject(Buffer.from(JSON.stringify(tight)), 'slot-position-warning.slotfab');
  await tab('geometry').click();
  await input('length').fill('150');
  await error.waitFor();
  assert.match(await error.innerText(), /Road start · Carrera clip/);
  assert.match(await error.innerText(), /the slot moves sideways into the room this pocket needs/);
  await tab('joints').click();
  await error.waitFor();
  const jump = error.locator('[data-action="show-warning-setting"]');
  assert.equal((await jump.innerText()).trim(), 'Slot position');
  await jump.click();
  await page.waitForFunction(() => document.activeElement?.name === 'slotStart');
  assert.equal(await input('slotStart').isVisible(), true);
  await action('restore').click();
  await live('idle');

  // ---- The piece creator, in a single-lane pack 200 mm wide.
  const library = page.locator('dialog.track-library');
  const control = (key) => library.locator('[data-lib="' + key + '"]');
  const setting = (key) => library.locator('[name="' + key + '"]');
  const pack = 'Slot position pack';
  async function openLibrary(group) {
    // Foundry ignores clicks while it is still building: try again until the
    // Library dialog opens.
    for (let attempt = 0; ; attempt++) {
      await page.waitForFunction(() => document.querySelector('#app')?.getAttribute('aria-busy') !== 'true');
      await action('mode-library').click();
      await action('packs-dialog').click();
      try {
        await library.waitFor({ timeout: 3000 });
        break;
      } catch (e) {
        if (attempt >= 5) throw e;
      }
    }
    if (group) await setting('collection').selectOption({ label: group });
  }
  await openLibrary();
  await control('new').click();
  await setting('itemName').fill(pack);
  await setting('startWith').selectOption('empty');
  await setting('packWidth').fill('200');
  await setting('packLanes').fill('1');
  await setting('packR1').fill('200');
  await control('commit-new').click();
  await control('create-piece').waitFor();
  assert.equal(await setting('collection').locator('option:checked').textContent(), pack);

  const creator = page.locator('dialog.piece-creator');
  const pc = (name) => creator.locator('[name="' + name + '"]');
  const pcStatus = creator.locator('[data-ct-status]');
  const add = creator.locator('[data-pc-apply]');
  async function createStraight(start, end, check) {
    await control('create-piece').click();
    await creator.locator('[data-shape="straight"]').click();
    await pc('pcLength').fill('300');
    assert.equal(await pc('pcWidth').inputValue(), '200');
    assert.equal(await pc('pcLanes').inputValue(), '1');
    // A new piece starts centred, whatever piece is open.
    assert.equal(await creator.locator('[data-slot-mode]').inputValue(), 'centre');
    await creator.locator('[data-slot-mode]').selectOption('off');
    await pc('pcSlotEdge').selectOption('outer');
    await pc('pcSlotStart').fill(String(start));
    await pc('pcSlotEnd').fill(String(end));
    const name = 'Straight · 300 mm · slot ' + (start === end ? start : start + '-' + end) + ' from left';
    assert.equal(await creator.locator('[data-piece-name]').inputValue(), name);
    assert.equal(await pcStatus.innerText(), '');
    await check?.();
    await add.click();
    await creator.waitFor({ state: 'detached' });
    await waitText('#model-title', name);
    return name;
  }
  const sName = await createStraight(35, 145, async () => {
    assert.equal(await pc('pcSlotEdge').locator('option:checked').textContent(), 'Left edge');
    const preview = creator.locator('svg[data-piece-preview]');
    assert.deepEqual(await preview.locator('.ct-end-label').allTextContents(), ['A', 'B']);
    assert.deepEqual(await preview.locator('.ct-edge-label').allTextContents(), ['left', 'right']);
    // The preview plots -y: 35 mm from the left edge is 65 mm above centre.
    const lane = (await preview.locator('.ct-lane').getAttribute('points'))
      .split(' ')
      .map((pair) => pair.split(',').map(Number));
    assert.deepEqual(lane[0], [-150, -65]);
    assert.deepEqual(lane.at(-1), [150, 45]);
    const creatorNotes = creator.locator('[data-slot-notes]');
    assert.match(await creatorNotes.innerText(), /tightest bend in the slot is about \d+ mm radius, which is gentle/);
    assert.equal(await creatorNotes.locator('.slot-warning').count(), 0);
    await snap('slot-position-creator');

    await pc('pcSlotStart').fill('3');
    assert.match(await pcStatus.innerText(), /Keep it between [\d.]+ and [\d.]+ mm so the slot and braids stay on the road\./);
    assert.equal(await pcStatus.evaluate((el) => el.classList.contains('ct-error')), true);
    assert.equal(await add.isDisabled(), true);
    assert.equal(await preview.locator('.ct-lane').count(), 0);
    await pc('pcSlotStart').fill('35');
    assert.equal(await add.isDisabled(), false);

    await creator.locator('[data-shape="curve"]').click();
    assert.equal(await creator.locator('[data-slot-end]').isVisible(), false);
    assert.equal(await creator.locator('[data-slot-curve]').isVisible(), true);
    assert.equal(await pc('pcSlotEdge').locator('option:checked').textContent(), 'Outer edge');
    assert.deepEqual(await preview.locator('.ct-end-label').allTextContents(), ['A', 'B']);
    await creator.locator('[data-shape="straight"]').click();
    assert.equal(await creator.locator('[data-slot-end]').isVisible(), true);
    assert.equal(await pc('pcSlotEnd').inputValue(), '145');
  });
  const made = await saved();
  assert.deepEqual(made.slotPosition, slot);
  assert.equal(made.length, 300);
  assert.equal(made.width, 200);
  assert.equal(made.lanes, 1);
  assert.equal(Object.keys(made).some((key) => /^pcSlot|^slot(Edge|Start|End)$/.test(key)), false);

  await openLibrary(pack);
  const sCard = library.locator('[data-open-piece]').filter({ hasText: 'slot 35-145' });
  assert.match(await library.locator('.lib-section-head').innerText(), /200 mm wide · 1 lane · some slots off-centre/);
  assert.deepEqual(await sCard.locator('.lib-thumb .lib-end').allTextContents(), ['A', 'B']);
  assert.match(await sCard.innerText(), /slot 35-145 from left/);
  await snap('slot-position-pack');
  const endName = await createStraight(145, 145);
  assert.deepEqual((await saved()).slotPosition, { ...slot, startMm: 145 });

  // ---- Track Planner: equal slots join, different slots are refused.
  const panel = page.locator('#track-planner');
  const idle = () =>
    page.waitForFunction(
      () => !document.querySelector('#track-planner').hasAttribute('aria-busy'),
    );
  const place = async (name) => {
    await panel.locator('.pl-card').filter({ hasText: name }).click();
    await idle();
  };
  const layout = async () => JSON.parse((await download(action('save'))).bytes);
  const message = panel.locator('.pl-message');
  await action('mode-planner').click();
  await panel.waitFor();
  await panel.locator('[data-pl="new"]').click();
  await idle();
  await panel.locator('[data-pl-field="pack"]').selectOption({ label: pack });
  await page.waitForFunction(() => document.querySelectorAll('.pl-card').length === 2);
  assert.match(await panel.locator('.pl-card').filter({ hasText: sName }).innerText(), /slot 35-145/);
  await place(sName);
  assert.equal(await message.evaluate((el) => el.classList.contains('error')), false, await message.innerText());
  const first = (await layout()).nodes.length;
  assert.ok(first >= 1);
  // End B of the S piece is 145 mm from the left edge, like the next piece.
  await place(endName);
  assert.equal(await message.evaluate((el) => el.classList.contains('error')), false, await message.innerText());
  const joined = (await layout()).nodes.length;
  assert.ok(joined > first, 'the matching piece was added');
  assert.match(await panel.locator('.pl-stats').innerText(), /2 open ends/);
  assert.doesNotMatch(await panel.locator('.pl-stats').innerText(), /slots out of line/);
  await snap('slot-position-planner');
  // The S piece starts at 35 mm: it does not follow an end at 145 mm.
  await place(sName);
  assert.equal(await message.evaluate((el) => el.classList.contains('error')), true);
  assert.match(
    await message.innerText(),
    /The guide slots do not line up at this joint: the slot is 145 mm from the left edge on this piece and 35 mm on the next\./,
  );
  assert.equal((await layout()).nodes.length, joined);
  await panel.locator('[data-pl="new"]').click();
  await idle();
  await action('mode-track').click();
  console.log(
    '✓ Slot position: an off-centre S on a single-lane straight applies live, shows its ends, notes and connector map, refuses a slot off the road, keeps one distance on a corner, clears when centred, and only joins matching slots in the Track Planner',
  );
}
