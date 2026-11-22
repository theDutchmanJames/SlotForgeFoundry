import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import { newProject } from '../../src/project.js';

export async function checkConnectorPlacement({
  page,
  action,
  tab,
  openProject,
  openSection,
  download,
  waitText,
  snap,
}) {
  const project = newProject();
  project.name = 'Connector placement test';
  project.track.params.placements = { innerSideClips: [0.75, 0.25] };
  Object.assign(project.track.params, {
    kind: 'straight',
    length: 400,
    width: 190,
    borderSide: 'both',
    segments: 1,
    borderSegments: 1,
    borderEntry: 58,
    borderApex: 58,
    borderExit: 58,
    joint: 'none',
    jointStart: 'none',
    jointEnd: 'none',
    borderMount: 'none',
    borderJoint: 'none',
  });
  await openProject(
    Buffer.from(JSON.stringify(project)),
    'connector-placement.slotfab',
  );
  await tab('joints').click();
  await action('place-connectors').click();
  const dialog = page.locator('dialog.connector-placement');
  const find = (k) => dialog.locator('[data-cp-' + k + ']');
  const committedParts = (count) =>
    page.waitForFunction(
      (n) =>
        !document.querySelector('dialog[open]') &&
        document.querySelector('#app').getAttribute('aria-busy') === 'false' &&
        document.querySelector('[data-action="save"] span').textContent ===
          'Save' &&
        document.querySelectorAll('#parts [data-part]').length === n,
      count,
    );
  await find('scope').selectOption('outerSide');
  await dialog.locator('[data-cp-kind="clip"]').click();
  async function point(f) {
    return find('edge').evaluate((el, f) => {
      const p = el
        .getPointAtLength(el.getTotalLength() * f)
        .matrixTransform(el.getScreenCTM());
      return [p.x, p.y];
    }, f);
  }
  // Each click redraws the map, so wait for its count before the next one.
  let placed = 0;
  const click = async (f) => {
    await page.mouse.click(...(await point(f)));
    placed++;
    await page
      .waitForFunction(
        (n) => document.querySelector('dialog.connector-placement [data-cp-count]')?.value === String(n),
        placed,
        { timeout: 10000 },
      )
      .catch(async () => {
        throw Error(
          `Click at ${f} did not add mark ${placed}: count ${await find('count').inputValue()}, ` +
            `status "${await dialog.locator('[data-cp-status], .cp-status, [role=status]').first().textContent().catch(() => '?')}"`,
        );
      });
  };
  for (const f of [0.16, 0.4, 0.84]) await click(f);
  assert.equal(await find('count').inputValue(), '3');
  const markValues = () => find('pick').locator('option').allTextContents();
  const middlePercent = async () =>
    Number((await markValues())[2].split(' · ')[1].split(' ')[0]);
  assert.ok(Math.abs((await middlePercent()) - 50) < 0.6);
  await dialog.locator('[data-cp-kind="tab"]').click();
  placed = 0;
  await click(0.29);
  // Well clear of the clip at 84%, which a smaller dialog would otherwise pick.
  await click(0.62);
  assert.equal(await find('count').inputValue(), '2');
  await find('scope').selectOption('innerSide');
  assert.equal(await find('count').inputValue(), '0');
  await dialog.locator('[data-cp-kind="clip"]').click();
  assert.equal(await find('count').inputValue(), '0');
  await find('scope').selectOption('outerSide');
  assert.equal(await find('count').inputValue(), '3');
  // Move the middle clip directly; the two outer marks stay pinned.
  const middle = dialog.locator('[data-cp-type=clip][data-cp-index="1"]');
  const box = await middle.boundingBox(),
    target = await point(0.57);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(...target, { steps: 8 });
  await page.mouse.up();
  assert.equal(await find('spacing').inputValue(), 'exact');
  await find('value').fill('55');
  await find('value').press('Tab');
  assert.equal(await find('value').inputValue(), '55');
  await find('spacing').selectOption('even');
  assert.ok(Math.abs((await middlePercent()) - 50) < 0.6);
  await snap('click-to-place-connectors');
  await find('apply').click();
  await dialog.waitFor({ state: 'detached' });
  await committedParts(9);
  const file = (await download(action('save'))).bytes,
    params = JSON.parse(file).track.params;
  assert.equal(params.borderMount, 'both');
  assert.equal(params.placements.outerSideClips.length, 3);
  assert.equal(params.placements.outerSideTabs.length, 2);
  assert.deepEqual(params.placements.innerSideClips, [0.75, 0.25]);
  assert.ok(params.mutedPlacements.includes('innerSideClips'));
  assert.deepEqual(params.placements.innerSideTabs, []);
  const [a, b, c] = params.placements.outerSideClips;
  assert.ok(Math.abs(b - (a + c) / 2) < 1e-6);
  await openProject(file, 'saved-connector-positions.slotfab');
  await tab('joints').click();
  await action('place-connectors').click();
  await find('scope').selectOption('outerSide');
  await dialog.locator('[data-cp-kind="clip"]').click();
  await find('count').fill('0');
  await find('count').press('Tab');
  await find('apply').click();
  await committedParts(3);
  await action('undo').click();
  await committedParts(9);
  await waitText('#model-title', 'Connector placement test');
  await tab('joints').click();
  await action('place-connectors').click();
  await find('scope').selectOption('innerSide');
  await dialog.getByRole('button', { name: 'Use saved marks' }).click();
  assert.equal(await find('count').inputValue(), '2');
  await find('apply').click();
  await committedParts(13);
  await openSection('Test prints');
  await action('test-joint').click();
  assert.equal(await action('coupon-side-outer').isVisible(), true);
  const insideKit = unzipSync(
    (await download(action('coupon-side-inner'))).bytes,
  );
  assert.equal(
    Object.keys(insideKit).filter((name) => name.endsWith('.stl') && !name.startsWith('tools/')).length,
    4,
  );
  assert.ok(insideKit['tools/keeper-turning-tool.stl']);
  assert.match(
    strFromU8(insideKit['parts.csv']),
    /"C1",[^\r\n]+,"2","side-clip-inner-1 \| side-clip-inner-1-2"/,
  );
  assert.match(
    strFromU8(insideKit['parts.csv']),
    /"R1",[^\r\n]+,"2","side-clip-inner-1-retainer \| side-clip-inner-1-2-retainer"/,
  );
  await action('place-connectors').click();
  await find('scope').selectOption('innerSide');
  await find('spacing').selectOption('exact');
  await find('count').fill('4');
  await find('count').press('Tab');
  const positions = (await markValues())
    .slice(1)
    .map((row) => Number(row.split(' · ')[1].split(' ')[0]));
  assert.equal(positions.length, 4);
  assert.ok(positions.includes(25) && positions.includes(75));
  await find('apply').click();
  await committedParts(17);
  console.log(
    '✓ Joint clicks, exact dragging, even spacing, per-side counts, zero, editable project round-trip and undo produce the requested track parts',
  );
  await checkAutomaticCounts({ page, action, tab, openProject, openSection, download, snap });
}

async function checkAutomaticCounts({ page, action, tab, openProject, openSection, download, snap }) {
  const project = newProject();
  project.name = 'Counted joints';
  Object.assign(project.track.params, {
    kind: 'straight', length: 360, width: 300, laneSpacing: 100,
    segments: 2, borderSide: 'both', borderSegments: 2,
    borderEntry: 70, borderApex: 70, borderExit: 70,
    joint: 'clips', jointStart: 'none', jointEnd: 'none',
    borderMount: 'none', borderJoint: 'none',
    placements: { seamClips: [-80] },
  });
  await openProject(Buffer.from(JSON.stringify(project)), 'counted-joints.slotfab');
  await tab('joints').click();
  await openSection('Road connections');
  const field = (name) => page.locator('#settings-form select[name="' + name + '"]');
  const choose = (name, value) => field(name).selectOption(String(value));
  const markDialog = page.locator('dialog.connector-placement');
  async function marks(scope, seamIndex) {
    await action('place-connectors').click();
    await markDialog.locator('[data-cp-scope]').selectOption(scope);
    if (seamIndex !== undefined) {
      await markDialog.locator('[data-cp-example]').selectOption(String(seamIndex));
    }
    const positions = {};
    for (const kind of ['clip', 'tab']) {
      await markDialog.locator('[data-cp-kind="' + kind + '"]').click();
      positions[kind] = await markDialog.locator('[data-cp-pick] option').evaluateAll(
        (options) => options.slice(1).map((o) => parseFloat(o.textContent.split(' · ')[1])).sort((a, b) => a - b),
      );
    }
    await markDialog.locator('[data-cp-done]').click();
    return positions;
  }
  await choose('count_seamClips', 1);
  assert.deepEqual((await marks('seam')).clip, [0], 'one clip replaces the old manual offset with a centred clip');
  await choose('count_seamClips', 2);
  const flanks = (await marks('seam')).clip;
  assert.equal(flanks.length, 2);
  assert.ok(flanks[0] < 0 && Math.abs(flanks[0] + flanks[1]) < 0.001);
  await choose('count_seamClips', 3);
  const three = (await marks('seam')).clip;
  assert.deepEqual(three, [flanks[0], 0, flanks[1]]);

  await choose('joint', 'both');
  await choose('count_seamTabs', 2);
  assert.equal(await field('count_seamTabs').locator('option[value="3"]').isDisabled(), true);
  async function checkMix(majority) {
    const positions = await marks('seam');
    const order = Object.entries(positions)
      .flatMap(([kind, values]) => values.map((value) => ({ value, kind })))
      .sort((a, b) => a.value - b.value);
    const minority = majority === 'clip' ? 'tab' : 'clip';
    assert.deepEqual(order.map(({ kind }) => kind), [majority, minority, majority, minority, majority]);
    assert.equal(order[2].value, 0);
  }
  await checkMix('clip');
  await choose('count_seamClips', 2);
  await choose('count_seamTabs', 3);
  assert.equal(await field('count_seamClips').locator('option[value="3"]').isDisabled(), true);
  await checkMix('tab');
  await page.locator('#live-status[data-state="ready"]').waitFor();
  await action('bottom').click();
  await snap('automatic-road-connectors');

  await openSection('Border connections');
  await choose('borderMount', 'clips');
  await choose('count_sideClips', 3);
  const outside = (await marks('outerSide')).clip;
  assert.equal(outside.length, 3);
  assert.equal(outside[1], 50);
  assert.ok(outside[0] < 50 && Math.abs(100 - outside[0] - outside[2]) < 0.001);
  assert.deepEqual((await marks('innerSide')).clip, outside);
  const file = (await download(action('save'))).bytes;
  const saved = JSON.parse(file).track.params;
  assert.equal(saved.connectorCounts.seamClips, 2);
  assert.equal(saved.connectorCounts.seamTabs, 3);
  assert.equal(saved.connectorCounts.sideClips, 3);
  assert.equal(saved.placements?.seamClips, undefined);
  await openProject(file, 'reopened-counted-joints.slotfab');
  await tab('joints').click();
  await openSection('Road connections');
  assert.equal(await field('count_seamClips').inputValue(), '2');
  assert.equal(await field('count_seamTabs').inputValue(), '3');
  await action('export-menu').click();
  const kit = unzipSync((await download(action('export-kit'))).bytes);
  const parts = strFromU8(kit['parts.csv']);
  assert.match(parts, /"C1",[^\r\n]+,"14",/);
  assert.match(parts, /"R1",[^\r\n]+,"14",/);
  for (const id of ['road-clip-1-2', 'side-clip-inner-1-3', 'side-clip-outer-1-3']) {
    assert.ok(parts.includes(id), 'kit contains ' + id);
  }
  project.track.params.lanes = 1;
  await openProject(Buffer.from(JSON.stringify(project)), 'centre-slot.slotfab');
  await tab('joints').click();
  await openSection('Road connections');
  await choose('count_seamClips', 1);
  const warning = page.locator('#live-status[data-state="error"]');
  await warning.waitFor();
  assert.match(await warning.innerText(), /centre|center|middle/i);
  assert.match(await warning.innerText(), /lane|slot/i);
  await action('place-connectors').click();
  await markDialog.locator('[data-cp-scope]').selectOption('seam');
  await markDialog.locator('[data-cp-kind="clip"]').click();
  await markDialog.locator('[data-cp-pick]').selectOption('0');
  const offset = markDialog.locator('[data-cp-value]');
  assert.equal(await offset.inputValue(), '0');
  await offset.fill('60');
  await offset.press('Tab');
  await markDialog.locator('[data-cp-apply]').click();
  await markDialog.waitFor({ state: 'detached' });
  await page.waitForFunction(() =>
    document.querySelector('#live-status')?.dataset.state === 'idle' &&
    document.querySelector('#app').getAttribute('aria-busy') === 'false');
  const corrected = JSON.parse((await download(action('save'))).bytes);
  assert.deepEqual(corrected.track.params.placements.seamClips, [60]);

  await openSection('Road connections');
  await choose('count_seamClips', 2);
  await page.locator('#live-status[data-state="ready"]').waitFor();
  assert.equal((await marks('seam')).clip.length, 2);

  const bend = newProject();
  Object.assign(bend.track.params, {
    kind: 'curve', width: 200, radius: 185, angle: 90, laneSpacing: 85,
    segments: 3, borderSide: 'none', joint: 'clips', clipType: 'carrera-retained',
    connectorCounts: { seamClips: 2 },
  });
  await openProject(Buffer.from(JSON.stringify(bend)), 'three-segment-carrera-bend.slotfab');
  await tab('joints').click();
  const curveClips = (await marks('seam', 2)).clip;
  assert.equal(curveClips.length, 2);
  assert.ok(Math.abs(curveClips[0] + 29) < 1 && Math.abs(curveClips[1] - 29) < 1,
    'the map must show the built pocket offsets on this curve, got ' + curveClips.join(', '));
  console.log('✓ Count dropdowns place centred, flanking and alternating connectors, persist road and border settings, and export matching hardware quantities');
}
