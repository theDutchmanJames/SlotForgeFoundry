import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { parseSTL } from '../../src/editor.js';
import { newProject } from '../../src/project.js';
import { defaultTrack } from '../../src/track.js';
import { specialTrackParams } from '../../src/special-pieces.js';
import { openPackCreator } from './track-pack-creator.mjs';
import { selectTrackPart } from './part-outline.mjs';

export async function checkSpecialTrackPieces({
  wasm,
  page,
  action,
  tab,
  input,
  download,
  downloadSelected,
  openProject,
  openSection,
  live,
}) {
  await openProject(
    Buffer.from(JSON.stringify(newProject())),
    'specials-start.slotfab',
  );
  const pack = 'Analogue specials test';
  const rules = {
    packWidth: 200,
    packLanes: 2,
    packLaneSpacing: 100,
    packR1: 200,
    packAngle: 45,
  };
  const creator = await openPackCreator(page, action, pack, rules);
  const tile = (type) => creator.locator('[data-special="' + type + '"]');
  // Every special is its own picture tile.
  assert.equal(await creator.locator('.pc-special').count(), 6);
  const field = (name) => creator.locator('[name="' + name + '"]');
  const lines = creator.locator('[data-piece-preview] .ct-lane');
  const apply = creator.locator('[data-pc-apply]');
  for (const type of [
    'hairpin',
    'duel',
    'diamond',
    'pit',
    'timing',
    'chicane',
  ]) {
    await tile(type).click();
    assert.equal(await tile(type).getAttribute('aria-pressed'), 'true');
    assert.ok(
      await apply.isEnabled(),
      type +
        ' defaults · ' +
        (await creator.locator('[data-ct-status]').innerText()),
    );
    assert.ok((await lines.count()) >= 2);
    if (type === 'pit') {
      const before = await lines.count();
      await field('spSide').selectOption('both');
      assert.ok(
        (await lines.count()) > before,
        'adds an independent pit on the second side',
      );
      const stripes = creator.locator('[data-piece-preview] .ct-pit-divider');
      assert.equal(await stripes.count(), 0);
      await field('spPitWhiteLine').check();
      assert.ok(await stripes.count() > 2, 'the creator shows the separate runs on either side of the guide slots');
      await field('spPitGridEnabled').check();
      const grid = creator.locator('[data-piece-preview] .ct-starting-grid');
      assert.equal(await grid.count(), 4, 'one grid mark around each mirrored pit slot');
      const initialGrid = await grid.first().getAttribute('points');
      await field('spPitGridPosition').fill('83');
      assert.notEqual(await grid.first().getAttribute('points'), initialGrid);
      const aligned = await grid.evaluateAll(polygons => polygons.map(poly => poly.getAttribute('points')));
      await field('spPitGridIndependent').check();
      await field('spPitGridRightPosition').fill('24');
      const staggered = await grid.evaluateAll(polygons => polygons.map(poly => poly.getAttribute('points')));
      assert.equal(staggered.filter(points => aligned.includes(points)).length, 2, 'only the right pit marker moves');
      await field('spPitGridEnabled').uncheck();
      assert.equal(await grid.count(), 0);
      const flippers = creator.locator('[data-piece-preview] .ct-flipper');
      assert.equal(await flippers.count(), 2);
      const closed = await flippers.first().getAttribute('points');
      await field('spTurnoutPosition').selectOption('pit');
      assert.notEqual(await flippers.first().getAttribute('points'), closed);
      assert.equal(await field('spMotorWidth').isVisible(), false);
      assert.equal(await field('spEyeDiameter').isVisible(), true);
      await field('spMotorMount').check();
      await field('spMotorWidth').fill('9');
      await field('spMotorHeight').fill('35');
      assert.match(await creator.locator('[data-motor-diagram]').innerText(), /too tall/);
      assert.equal(await apply.isDisabled(), true);
      await field('spMotorHeight').fill('5');
      assert.ok(await apply.isEnabled(), await creator.locator('[data-ct-status]').innerText());
      assert.match(await creator.locator('[data-motor-diagram]').innerText(), /Crank travel 1\.4 mm/);
      await tile('timing').click();
      await tile('pit').click();
      assert.equal(await field('spMotorMount').isChecked(), true);
      assert.equal(await field('spMotorWidth').inputValue(), '9');
      assert.equal(await field('spPitWhiteLine').isChecked(), true);
      await field('spPitWhiteLine').uncheck();
      assert.equal(await stripes.count(), 0);
    }
    if (type === 'timing') {
      assert.equal(await field('spStripLength').isVisible(), false);
      await field('spDetector').selectOption('strip');
      assert.equal(await field('spStripLength').isVisible(), true);
      assert.equal(await field('spSensorSize').isVisible(), false);
    }
  }
  await field('pcBorderSide').selectOption('both');
  const before = await lines.first().getAttribute('points');
  await field('spHand').selectOption('right');
  await field('spLength').fill('1300');
  await field('spEntryRadius').fill('250');
  await field('spExitRadius').fill('370');
  assert.notEqual(await lines.first().getAttribute('points'), before);
  await creator.locator('[data-piece-name]').fill('Mixed-radius bus stop');
  await apply.click();
  await creator.waitFor({ state: 'detached', timeout: 60000 });
  const recipe = JSON.parse((await download(action('save'))).bytes);
  const p = recipe.track.params;
  assert.deepEqual(
    [
      p.special.type,
      p.special.hand,
      p.special.entryRadius,
      p.special.exitRadius,
      p.length,
      p.borderSide,
    ],
    ['chicane', 'right', 250, 370, 1300, 'both'],
  );
  assert.ok(await page.locator('[data-part-group="border"]').count());
  await tab('geometry').click();
  await input('spExitRadius').fill('340');
  await live();
  await page.locator('[data-restore-field="spExitRadius"]').click();
  assert.equal(await input('spExitRadius').inputValue(), '370');
  const stl = await downloadSelected();
  assert.ok(stl.name.endsWith('.stl') && stl.bytes.length > 84);
  await openProject(
    Buffer.from(JSON.stringify(recipe)),
    'specials-reopen.slotfab',
  );
  await tab('geometry').click();
  assert.equal(await input('spEntryRadius').inputValue(), '250');
  assert.equal(await input('spHand').inputValue(), 'right');
  await action('mode-library').click();
  await action('packs-dialog').click();
  const library = page.locator('dialog.track-library');
  await library.waitFor();
  await library.locator('[name="collection"]').selectOption({ label: pack });
  const member = library.getByRole('button', {
    name: /^Mixed-radius bus stop/,
  });
  await member.waitFor();
  assert.ok(
    await member.locator('.lib-thumb .lib-border').count(),
    'pack thumbnail includes the selected borders',
  );
  await member.click();
  await library.waitFor({ state: 'detached' });
  const fixture = (type) => {
    const project = newProject();
    project.track.params = specialTrackParams(type, {
      ...p,
      borderSide: 'none',
    });
    return Buffer.from(JSON.stringify(project));
  };
  await openProject(fixture('diamond'), 'crossing-check.slotfab');
  await tab('geometry').click();
  const wiring = page
    .locator('#settings-form details')
    .filter({
      has: page.locator('summary', { hasText: 'Assembly and wiring' }),
    });
  if (!(await wiring.evaluate((el) => el.open)))
    await wiring.locator('summary').click();
  const coupon = await download(action('export-crossing-sample'));
  assert.ok(coupon.name.endsWith('-crossing-test.stl'));
  assert.equal(coupon.bytes.length, 84 + 50 * coupon.bytes.readUInt32LE(80));
  assert.ok(coupon.bytes.readUInt32LE(80) > 0);
  const oldPit = JSON.parse(fixture('pit'));
  delete oldPit.track.params.special.turnoutPosition;
  delete oldPit.track.params.special.pitWhiteLine;
  await openProject(Buffer.from(JSON.stringify(oldPit)), 'pit-check.slotfab');
  await tab('geometry').click();
  assert.equal(await input('spTurnoutPosition').inputValue(), 'main');
  await page.getByRole('button', { name: 'Turnout cranks, 1 part' }).waitFor();
  await page.getByRole('button', { name: 'Turnout pivot bearings, 1 part' }).waitFor();
  const routeGuide = page.locator('[data-guide="pit-flipper-left"]');
  await routeGuide.getByText('Pit closed · main lane').waitFor();
  await input('spTurnoutPosition').selectOption('pit');
  await live();
  await routeGuide.getByText('Pit open · enter pit').waitFor();
  // The pit lane divider is a marking: it lives under Markings.
  await tab('markings').click();
  const pitDivider = input('spPitWhiteLine');
  assert.equal(await pitDivider.isChecked(), false);
  await openSection('White lines on the road');
  await input('whiteLineRoad').selectOption('none');
  await pitDivider.check();
  await page.locator('[data-guide="pit-white-line"]').getByText('Pit lane divider · 3 mm').waitFor();
  await input('roadLineGroove').check();
  await page.locator('[data-guide="pit-white-line-groove"]').getByText('Paint groove · 0.5 mm × 0.3 mm').waitFor();
  await live();
  const savedPit = (await download(action('save'))).bytes;
  const savedParams = JSON.parse(savedPit).track.params;
  assert.equal(savedParams.special.turnoutPosition, 'pit');
  assert.equal(savedParams.special.pitWhiteLine, true);
  assert.equal(savedParams.whiteLineRoad, 'none');
  assert.equal(savedParams.roadLineGroove, true);
  await openProject(savedPit, 'pit-reopen.slotfab');
  await tab('geometry').click();
  assert.equal(await input('spTurnoutPosition').inputValue(), 'pit');
  await tab('markings').click();
  assert.equal(await pitDivider.isChecked(), true);
  assert.equal(await input('roadLineGroove').isChecked(), true);
  await pitDivider.uncheck();
  await live();
  assert.equal(await page.locator('[data-guide="pit-white-line"]').count(), 0);
  assert.equal(await input('roadLineGroove').isChecked(), true);
  console.log('✓ The optional pit divider and its paint groove preview live and survive reopening with road edge lines off');
  await tab('geometry').click();
  await input('spMotorMount').check();
  await input('spMotorLength').fill('16');
  await input('spEyeDiameter').fill('1.5');
  await input('spPlungerProjection').fill('2.5');
  await live();
  assert.match(await page.locator('[data-assembly-notes="pit"]').textContent(), /cradle bosses/);
  const motorPit = JSON.parse((await download(action('save'))).bytes);
  assert.equal(motorPit.track.params.special.motorMount, true);
  assert.equal(motorPit.track.params.special.motorLength, 16);
  assert.equal(motorPit.track.params.special.plungerProjection, 2.5);
  assert.equal(motorPit.track.params.special.eyeDiameter, 1.5);
  await openProject(Buffer.from(JSON.stringify(motorPit)), 'motor-pit.slotfab');
  await tab('geometry').click();
  assert.equal(await input('spMotorMount').isChecked(), true);
  assert.equal(await input('spEyeDiameter').inputValue(), '1.5');
  await page.getByRole('button', { name: 'Motor mounts, 1 part' }).waitFor();
  await page.locator('[data-guide="pit-motor-left"]').getByText('Motor · 16 × 8 × 5 mm').waitFor();
  await input('spEyeDiameter').focus();
  await page.locator('[data-guide="pit-eye-clearance-left"]').waitFor();
  assert.match(await page.locator('[data-pushrod-play]').innerText(), /Ø3 mm/);
  await action('export-menu').click();
  const motorKit = unzipSync((await download(action('export-kit'))).bytes);
  assert.ok(Object.keys(motorKit).some(name => /^parts\/M.*\.stl$/i.test(name)));
  const buildNotes = new TextDecoder().decode(motorKit['Assembly notes.txt']);
  assert.match(buildNotes, /1 mm above the tab/);
  assert.match(buildNotes, /keyed pivot.*M2/i);
  console.log('✓ A resized pit motor survives reopening, appears in the live assembly and exports a printable mount');
  const borderPit = newProject();
  borderPit.track.params = {
    ...specialTrackParams('pit', defaultTrack()), clipType: 'draw-key',
    borderSide: 'outer', borderMount: 'clips', borderJoint: 'none',
    borderEntry: 45, borderApex: 45, borderExit: 45,
    placements: { outerSideClips: [0.179, 0.65] },
  };
  await openProject(Buffer.from(JSON.stringify(borderPit)), 'pit-pushrod-border.slotfab');
  await tab('joints').click();
  const borderClipPositions = input('place_outerSideClips');
  for (const heading of ['Custom border connector positions', 'Per-side overrides']) {
    const summary = page.locator('#settings-form summary').getByText(heading, { exact: true });
    if (!(await summary.evaluate(el => el.closest('details').open))) await summary.click();
  }
  await borderClipPositions.fill('17.18, 65');
  await live('error');
  assert.match(await page.locator('#live-status').innerText(), /17.18% along this section.*pushrod/);
  await action('show-warning-setting').click();
  assert.equal(await page.locator(':focus').getAttribute('name'), 'place_outerSideClips');
  await borderClipPositions.fill('25, 65');
  await live();
  await openProject(fixture('timing'), 'detector-check.slotfab');
  await tab('geometry').click();
  await input('spDetector').selectOption('strip');
  await live();
  assert.match(
    await page.locator('[data-assembly-notes]').textContent(),
    /isolated pair/,
  );

  const pit = newProject();
  pit.track.params = specialTrackParams('pit', {
    ...defaultTrack(), width: 200, laneSpacing: 100, height: 10, slotDepth: 8,
  });
  await openProject(Buffer.from(JSON.stringify(pit)), 'pit-braid-offset.slotfab');
  await tab('profile').click();
  await openSection('Braid recess');
  for (const gap of [2, 0]) {
    await input('braidGap').fill(String(gap));
    await live();
    const wallGuide = page.locator('[data-guide="braid-wall-width"]');
    if (gap) await wallGuide.getByText('Wall beside slot · 2 mm').waitFor();
    else assert.equal(await wallGuide.count(), 0);
    const road = parseSTL(wasm, (await downloadSelected()).bytes);
    try {
      // Special roads export face down. A transverse ray just above both
      // recess floors locates the two guide slots independently of STL origin.
      const { min, max } = road.boundingBox();
      const x = min[0] + 10;
      const edges = road.rayCast([x, min[1] - 1, 1], [x, max[1] + 1, 1])
        .map(hit => hit.position[1]);
      assert.equal(edges.length, 6, 'two road edges plus four guide walls');
      const inner = 1.5 + gap, outer = inner + 5;
      const probes = [[0, 8], [inner + 0.05, 0.5], [outer - 0.05, 0.5], [outer + 0.05, 0]];
      if (gap) probes.push([1.55, 0], [inner - 0.05, 0]);
      for (const left of [1, 3]) {
        const mid = (edges[left] + edges[left + 1]) / 2;
        assert.ok(Math.abs(edges[left + 1] - edges[left] - 3) < 0.002);
        for (const side of [-1, 1]) {
          for (const [offset, depth] of probes) {
            const y = mid + side * offset;
            const surface = road.rayCast([x, y, -1], [x, y, 11])[0];
            assert.ok(Math.abs(surface?.position[2] - depth) < 0.002,
              `gap ${gap}, at ${side * offset} mm from slot centre`);
          }
        }
      }
    } finally { road.delete(); }
  }
  console.log('✓ Pit exports have 5 mm braid recesses and the selected 0 or 2 mm divider on both sides of both slots');

  await openSection('Braid pass-throughs');
  assert.equal(await input('spPitContactMode').inputValue(), 'wire');
  await input('spPitContactMode').selectOption('braid');
  await input('spPitContactLength').fill('1.8');
  await live();
  assert.equal(await input('braidFeedSide').inputValue(), 'none');
  assert.equal(Number(await input('braidFeedLength').inputValue()), 3);
  const changedPit = (await download(action('save'))).bytes;
  const contact = JSON.parse(changedPit).track.params.special;
  assert.equal(contact.pitContactMode, 'braid');
  assert.equal(contact.pitContactLength, 1.8);
  await openProject(changedPit, 'pit-braid-pass-throughs.slotfab');
  await tab('profile').click();
  await openSection('Braid pass-throughs');
  assert.equal(await input('spPitContactMode').inputValue(), 'braid');
  assert.equal(Number(await input('spPitContactLength').inputValue()), 1.8);
  // In the face-down road STL a slice 0.8 mm above the plate cuts just below
  // the 0.5 mm braid seats, through the actual openings on the solid deck.
  for (const mode of ['braid', 'wire']) {
    if (mode === 'wire') {
      await input('spPitContactMode').selectOption('wire');
      await live();
    }
    const road = parseSTL(wasm, (await downloadSelected()).bytes);
    const section = road.slice(0.8);
    try {
      const areas = section.toPolygons().map(loop => {
        const twiceArea = loop.reduce((sum, [x, y], index) => {
          const next = loop[(index + 1) % loop.length];
          return sum + x * next[1] - y * next[0];
        }, 0);
        return Math.abs(twiceArea) / 2;
      });
      const count = target => areas.filter(area => Math.abs(area - target) < target * 0.04).length;
      assert.equal(count(5 * 1.8), mode === 'braid' ? 4 : 0, 'slots at all four terminated braid ends');
      assert.equal(count(Math.PI * 0.9 ** 2), mode === 'braid' ? 4 : 8, 'round wire access under continuous braids');
    } finally { section.delete(); road.delete(); }
  }
  console.log('✓ The pit junction setting changes all four braid ends in the saved project and road STL independently of manual feeds');

  // A single-lane turnout: its controls, its four inserts and its parts list.
  const turnout = newProject();
  turnout.track.params = specialTrackParams('turnout', {
    ...defaultTrack(), kind: 'straight', lanes: 1, width: 100, length: 300,
  });
  await openProject(Buffer.from(JSON.stringify(turnout)), 'turnout-check.slotfab');
  await tab('geometry').click();
  const insertMode = input('spTurnoutMode');
  assert.deepEqual(
    await insertMode.locator('option').allInnerTexts(),
    ['Digital', 'Hand-set point', 'Analog', 'Closed'],
  );
  const modeHint = page.locator('#settings-form [data-turnout-mode-hint]');
  assert.match(await modeHint.innerText(), /slider/);
  await page.getByRole('button', { name: 'Turnout sliders, 1 part' }).waitFor();
  assert.equal(Number(await input('spMotorStroke').inputValue()), 6);
  assert.equal(Number(await input('spTurnoutPlay').inputValue()), 0.2);
  await page.getByRole('button', { name: 'Turnout inserts, 1 part' }).waitFor();
  await page.getByRole('button', { name: 'Turnout cranks, 1 part' }).waitFor();
  assert.ok(await input('spTurnoutPosition').isVisible());
  await insertMode.selectOption('closed');
  assert.match(await modeHint.innerText(), /only go straight on/);
  assert.ok(!(await input('spTurnoutPosition').isVisible()));
  assert.ok(!(await input('spMotorStroke').isVisible()));
  await live();
  await page.locator('#parts [data-part="turnout-insert"]').waitFor({ state: 'attached' });
  assert.equal(await page.getByRole('button', { name: /^Turnout cranks/ }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /^Turnout blades/ }).count(), 0);
  // Selecting the insert opens the Shape section, like the other turnout parts.
  await tab('profile').click();
  await selectTrackPart(page.locator('#parts [data-part="turnout-insert"]'));
  assert.equal(await tab('geometry').getAttribute('aria-pressed'), 'true');
  assert.equal(await input('spTurnoutMode').inputValue(), 'closed');
  const savedTurnout = JSON.parse((await download(action('save'))).bytes).track.params;
  assert.equal(savedTurnout.special.turnoutMode, 'closed');
  assert.equal(savedTurnout.special.turnoutPosition, 'main');
  console.log('✓ A turnout offers its four inserts, lists the insert as its own part and opens Shape when the insert is selected');
}
