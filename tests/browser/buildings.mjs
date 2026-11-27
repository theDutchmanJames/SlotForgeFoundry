import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';

// The Buildings page: a one-car garage as a kit, its model, its plates, the
// kit download and the Library shelf.
export async function checkBuildings({ page, action, download, snap }) {
  const host = page.locator('#buildings-page');
  const bd = (k) => host.locator('[data-bd="' + k + '"]');
  const setting = (name) => host.locator('form.bd-form [name="' + name + '"]');
  await action('mode-buildings').click();
  await host.waitFor();
  // The model is built: seven parts, and the filament it takes.
  await page.waitForFunction(() => /g filament/.test(document.querySelector('[data-bd-chips]')?.textContent));
  assert.match(await host.locator('[data-bd-chips]').textContent(), /^12 parts/);
  assert.match(await host.locator('[data-bd-fit]').textContent(), /^Fits a \d+ × \d+ plate$/);
  assert.equal(await host.locator('.bd-parts [data-bd-part]').count(), 12);
  await snap('buildings');
  // Exploded: the parts come apart to show how they fit, and back together.
  const apart = host.locator('.bd-apart input');
  await apart.fill('100');
  await snap('buildings-exploded');
  await apart.fill('0');
  // Wider than the plate: the base, the roof and the long walls are cut into pieces that fit.
  await setting('width').fill('230');
  await setting('width').press('Tab');
  await host.locator('[data-bd-part="base-1"]').waitFor();
  assert.match(await host.locator('[data-bd-fit]').textContent(), /^Fits a \d+ × \d+ plate$/);
  assert.ok(await host.locator('[data-bd-fitting]').isVisible());
  // A door wider than the wall is refused, with the most it can be.
  await setting('width').fill('80');
  await setting('width').press('Tab');
  await host.locator('.bd-error').waitFor();
  assert.match(await host.locator('.bd-error').textContent(), /door is too wide for this building: at most 62 mm/);
  await setting('width').fill('120');
  await setting('width').press('Tab');
  await host.locator('.bd-error').waitFor({ state: 'hidden' });
  // Without a door the kit has six parts.
  await setting('door').selectOption('open');
  await page.waitForFunction(() => /^11 parts/.test(document.querySelector('[data-bd-chips]').textContent));
  await setting('door').selectOption('roller');
  await page.waitForFunction(() => /^12 parts/.test(document.querySelector('[data-bd-chips]').textContent));
  // Every part on a plate of its own.
  await host.locator('[data-bd-view="plate"]').click();
  assert.equal(await host.locator('.bd-plates .bd-plate').count(), 12);
  assert.ok(await apart.isHidden(), 'the exploded view belongs to the model');
  await host.locator('[data-bd-view="model"]').click();
  // The kit: an STL for each part as it prints, and the notes.
  await host.locator('[name="buildingName"]').fill('Test garage');
  const kit = await download(bd('export'));
  assert.equal(kit.name, 'Test garage kit.zip');
  const files = unzipSync(new Uint8Array(kit.bytes));
  const stls = Object.keys(files).filter((n) => n.endsWith('.stl'));
  assert.deepEqual(stls, ['01 Base plate.stl', '02 Front wall.stl', '03 Back wall.stl', '04 Left wall.stl', '05 Right wall.stl', '06 Flat roof.stl', '07 Roof frame.stl', '08 Roller door.stl', '09 Corner brace, front left.stl', '10 Corner brace, front right.stl', '11 Corner brace, back left.stl', '12 Corner brace, back right.stl']);
  for (const n of stls) {
    const bytes = files[n];
    const count = new DataView(bytes.buffer, bytes.byteOffset).getUint32(80, true);
    assert.equal(bytes.length, 84 + 50 * count, n);
  }
  assert.match(strFromU8(files['README.txt']), /Test garage · SlotForge Foundry building kit[\s\S]*without supports/);
  // Saved in the Library, on the Buildings shelf, and opened again from there.
  await bd('save').click();
  await host.locator('.bd-saved [data-bd-open]').first().waitFor();
  await action('mode-library').click();
  await page.locator('[data-lp-shelf="buildings"]').click();
  const card = page.locator('#library-page .lp-card').filter({ hasText: 'Test garage' });
  await card.waitFor();
  await card.locator('[data-lp="open-building"]').click();
  await host.waitFor();
  assert.equal(await host.locator('[name="buildingName"]').inputValue(), 'Test garage');
  assert.equal(await action('mode-buildings').getAttribute('aria-pressed'), 'true');
  // A two-sided roof: two panels in place of the flat roof.
  const partCount = (n) => page.waitForFunction((n) => new RegExp('^' + n + ' parts').test(document.querySelector('[data-bd-chips]').textContent), n);
  await host.locator('[data-bd-roof="gable"]').click();
  await partCount(14);
  assert.deepEqual(
    await host.locator('.bd-parts [data-bd-part^="roof"]').evaluateAll((parts) => parts.map((p) => p.dataset.bdPart)),
    ['roof-left', 'roof-right', 'roof-left-frame', 'roof-right-frame'],
  );
  assert.ok(await setting('pitch').isVisible());
  assert.ok(await setting('ridge').isVisible());
  // Bricks on the walls and tiles on the roof: the parts stay the same, cut.
  const built = () => page.waitForFunction(() => document.querySelector('.bd-message').hidden);
  assert.ok(await host.locator('[data-bd-texture-size]').isHidden());
  await host.locator('[data-bd-wall-texture="brick"]').click();
  await built();
  await host.locator('[data-bd-roof-texture="tile"]').click();
  await built();
  assert.equal(await host.locator('[data-bd-wall-texture="brick"]').getAttribute('aria-pressed'), 'true');
  assert.ok(await host.locator('[data-bd-texture-size]').isVisible());
  await partCount(14);
  await setting('textureDepth').fill('2');
  await setting('textureDepth').press('Tab');
  await host.locator('.bd-error').waitFor();
  assert.match(await host.locator('.bd-error').textContent(), /Joint depth must be between 0.3 and 1 mm/);
  await setting('textureDepth').fill('0.5');
  await setting('textureDepth').press('Tab');
  await host.locator('.bd-error').waitFor({ state: 'hidden' });
  await host.locator('[data-bd-wall-texture="plain"]').click();
  await built();
  await host.locator('[data-bd-roof-texture="plain"]').click();
  await built();
  // A window in the left wall: a hole, and with a frame a part of its own.
  await host.locator('[data-bd-wall="left"]').click();
  await host.locator('[data-bd-add="window"]').click();
  await host.locator('.bd-opening').waitFor();
  await partCount(14);
  await host.locator('.bd-opening [name="frame"]').check();
  await partCount(15);
  assert.match(await host.locator('[data-bd-part="frame-1"]').textContent(), /Left window frame/);
  // Placed too high, it is refused with how high it can go.
  await host.locator('.bd-opening [name="sill"]').fill('60');
  await host.locator('.bd-opening [name="sill"]').press('Tab');
  await host.locator('.bd-error').waitFor();
  assert.match(await host.locator('.bd-error').textContent(), /left window reaches too high: its top can be at most 69 mm/);
  await host.locator('.bd-opening [name="sill"]').fill('25');
  await host.locator('.bd-opening [name="sill"]').press('Tab');
  await host.locator('.bd-error').waitFor({ state: 'hidden' });
  // Removed again, and back to a flat roof.
  await host.locator('[data-bd-remove]').click();
  await partCount(14);
  await host.locator('[data-bd-roof="flat"]').click();
  await partCount(12);
  assert.ok(await setting('pitch').isHidden());
  // A 200 × 200 garage on a 150 × 150 plate: the parts are cut into pieces
  // that fit, and each cut can be moved within its range.
  await page.evaluate(() => localStorage.setItem('foundry.settings', JSON.stringify({ plate: { width: 150, depth: 150, margin: 0 } })));
  await setting('width').fill('200');
  await setting('depth').fill('200');
  await setting('depth').press('Tab');
  await host.locator('[data-bd-fitting]').waitFor();
  await page.waitForFunction(() => /^1[5-9] parts|^2\d parts/.test(document.querySelector('[data-bd-chips]').textContent));
  assert.match(await host.locator('[data-bd-fit]').textContent(), /^Fits a 150 × 150 plate$/);
  assert.match(await host.locator('[data-bd-part="front-1"]').textContent(), /Front wall 1 of 2/);
  const frontCut = host.locator('[name="cut-front-0"]');
  assert.equal(await frontCut.inputValue(), '100');
  await frontCut.fill('20');
  await frontCut.press('Tab');
  await host.locator('.bd-error').waitFor();
  assert.match(await host.locator('.bd-error').textContent(), /Front wall: cut 1 at 20 mm leaves a piece that does not fit the plate/);
  await frontCut.fill('80');
  await frontCut.press('Tab');
  await host.locator('.bd-error').waitFor({ state: 'hidden' });
  await host.locator('[data-bd-even="front"]').click();
  await page.waitForFunction(() => document.querySelector('[name="cut-front-0"]').value === '100');
  // Back to the default garage on the plate from Settings.
  await page.evaluate(() => localStorage.removeItem('foundry.settings'));
  await setting('width').fill('120');
  await setting('depth').fill('180');
  await setting('depth').press('Tab');
  await host.locator('[data-bd-fitting]').waitFor({ state: 'hidden' });
  // Two rooms side by side: their sizes make the width, a dividing wall
  // between them, and a garage door in each.
  await host.locator('[data-bd-rooms="width"]').click();
  await setting('room-0').waitFor();
  assert.ok(await setting('width').isDisabled(), 'the rooms set the width');
  await setting('room-0').fill('110');
  await setting('room-1').fill('140');
  await setting('room-1').press('Tab');
  await page.waitForFunction(() => document.querySelector('form.bd-form [name="width"]').value === '250');
  assert.match(await host.locator('.bd-rooms .bd-hint').textContent(), /110 \+ 140 = 250 mm wide/);
  await host.locator('[data-bd-part="divide1"]').waitFor();
  assert.match(await host.locator('[data-bd-part="door2"]').textContent(), /Roller door, room 2/);
  await host.locator('[data-bd-rooms=""]').click();
  await host.locator('[data-bd-part="divide1"]').waitFor({ state: 'detached' });
  assert.ok(!(await setting('width').isDisabled()));
  await setting('width').fill('120');
  await setting('width').press('Tab');
  await partCount(12);
  // A second storey: a floor and four walls of its own, which stay on the storey below.
  await host.locator('[data-bd-add-storey]').click();
  await partCount(22);
  assert.match(await host.locator('[data-bd-part="floor2"]').textContent(), /Floor of storey 2/);
  assert.equal(await host.locator('[data-bd-storey="1"]').getAttribute('aria-pressed'), 'true');
  // Clicking a part opens its settings: its storey and its wall are chosen.
  const pressed = (attr) => host.locator('[' + attr + '][aria-pressed="true"]').first().textContent();
  await host.locator('[data-bd-part="right"]').click();
  assert.equal(await pressed('data-bd-storey'), 'Ground floor');
  assert.equal(await pressed('data-bd-wall'), 'Right');
  await host.locator('[data-bd-part="right"]').click();
  await host.locator('[data-bd-part="back2"]').click();
  assert.equal(await pressed('data-bd-storey'), 'Storey 2');
  assert.equal(await pressed('data-bd-wall'), 'Back');
  await host.locator('[data-bd-part="back2"]').click();
  await host.locator('[data-bd-part^="roof"]').first().click();
  assert.equal(await host.locator('.bd-flash').getAttribute('data-bd-card'), 'roof');
  await host.locator('[data-bd-part^="roof"]').first().click();
  await setting('upWidth').fill('140');
  await setting('upWidth').press('Tab');
  await host.locator('.bd-error').waitFor();
  assert.match(await host.locator('.bd-error').textContent(), /Storey 2: Width must be between 60 and 120 mm/);
  await setting('upWidth').fill('100');
  await setting('upX').fill('10');
  await setting('upX').press('Tab');
  await host.locator('.bd-error').waitFor({ state: 'hidden' });
  // Its windows and wall texture are its own.
  await host.locator('[data-bd-wall="front"]').click();
  await host.locator('[data-bd-add="window"]').click();
  await host.locator('.bd-openings .bd-opening').waitFor();
  await host.locator('.bd-openings .bd-opening [name="frame"]').check();
  await partCount(23);
  assert.match(await host.locator('[data-bd-part="frame2-1"]').textContent(), /Front window frame, storey 2/);
  await host.locator('[data-bd-storey="0"]').click();
  assert.match(await host.locator('.bd-openings').textContent(), /No windows or doors in the front wall of the ground floor/);
  await host.locator('[data-bd-storey="1"]').click();
  await host.locator('[data-bd-remove-storey]').click();
  await partCount(12);
  // Start from a standard building: its name and its parts, then back to the plain garage.
  await host.locator('[data-bd-preset="tower"]').click();
  await host.locator('[data-bd-part="floor3"]').waitFor();
  assert.equal(await host.locator('[name="buildingName"]').inputValue(), 'Control tower');
  await host.locator('[data-bd-preset="pitrow"]').click();
  await host.locator('[data-bd-part="divide3"]').waitFor();
  assert.match(await host.locator('.bd-rooms .bd-hint').textContent(), /110 \+ 110 \+ 110 \+ 110 = 440 mm wide/);
  // A grandstand has cards of its own: its rows, its shape, its roof and its sections.
  await host.locator('[data-bd-preset="stand-curved"]').click();
  await host.locator('[data-bd-part="end"]').waitFor();
  assert.ok(await host.locator('[data-bd-card="stand"]').isVisible());
  assert.ok(await host.locator('[data-bd-card="size"]').isHidden(), 'the garage cards are put away');
  assert.equal(await host.locator('[data-bd-stand-shape="curved"]').getAttribute('aria-pressed'), 'true');
  assert.ok(await setting('gLength').isDisabled(), 'a curve sets the length');
  await setting('gRows').fill('3');
  await setting('gRows').press('Tab');
  await page.waitForFunction(() => /3 rows/.test(document.querySelector('[data-bd-grandstand-size]').textContent));
  await host.locator('[data-bd-stand-shape="straight"]').click();
  await page.waitForFunction(() => !document.querySelector('form.bd-form [name="gLength"]').disabled);
  // The modern pit building: railings, a balcony and bay numbers.
  await host.locator('[data-bd-preset="pit-modern"]').click();
  await host.locator('[data-bd-part="number-3"]').waitFor();
  assert.ok(await host.locator('[data-bd-part^="railing2-front"]').count());
  assert.ok(await setting('numbers').isChecked());
  // The pit building in bays: its own cards, a door to choose, a part opening its card.
  await host.locator('[data-bd-preset="pit-building"]').click();
  await host.locator('[data-bd-part="roofback-3"]').waitFor();
  assert.ok(await host.locator('[data-bd-card="pits"]').isVisible());
  assert.ok(await host.locator('[data-bd-card="size"]').isHidden(), 'the garage cards are put away');
  assert.match(await host.locator('[data-bd-pits-size]').textContent(), /3 bays, 333 mm long/);
  await host.locator('[data-bd-pits-door="roller"]').click();
  await page.waitForFunction(() => /Roller door 1/.test(document.querySelector('[data-bd-part="door-1"]')?.textContent));
  await setting('pBays').fill('2');
  await setting('pBays').press('Tab');
  await page.waitForFunction(() => !document.querySelector('[data-bd-part="bay-3"]'));
  assert.match(await host.locator('[data-bd-chips]').textContent(), /No supports/);
  await host.locator('[data-bd-part="number-2"]').click();
  await page.waitForFunction(() => document.querySelector('[data-bd-card="pitsDoors"]').classList.contains('bd-flash'));
  // A marshal post: raised on legs with a ladder, or on the ground without them.
  await host.locator('[data-bd-preset="marshal-low"]').click();
  await host.locator('[data-bd-part="ladder"]').waitFor();
  assert.ok(await host.locator('[data-bd-card="marshal"]').isVisible() && (await host.locator('[data-bd-card="pits"]').isHidden()));
  assert.match(await host.locator('[data-bd-marshal-size]').textContent(), /A cabin on four legs, its floor 40 mm above the table/);
  await host.locator('[data-bd-marshal-walls="boards"]').click();
  await page.waitForFunction(() => document.querySelector('[data-bd-marshal-walls="boards"]').getAttribute('aria-pressed') === 'true');
  await setting('mDeck').fill('0');
  await setting('mDeck').press('Tab');
  await page.waitForFunction(() => !document.querySelector('[data-bd-part="stand"]') && !document.querySelector('[data-bd-part="ladder"]'));
  assert.ok(await host.locator('[data-bd-raised]').isHidden(), 'no ladder on the ground');
  assert.match(await host.locator('[data-bd-chips]').textContent(), /No supports/);
  await host.locator('[data-bd-part="roof"]').click();
  await page.waitForFunction(() => document.querySelector('[data-bd-card="marshalRoof"]').classList.contains('bd-flash'));
  // A viewing platform: the staircase moves to the other end, or goes.
  await host.locator('[data-bd-preset="platform"]').click();
  await host.locator('[data-bd-part="rail-right"]').waitFor();
  assert.ok(await host.locator('[data-bd-card="platformStair"]').isVisible() && (await host.locator('[data-bd-card="marshal"]').isHidden()));
  assert.match(await host.locator('[data-bd-platform-size]').textContent(), /A deck 150 × 110 mm, 65 mm above the table, 10 steps up/);
  await host.locator('[data-bd-platform-stair="both"]').click();
  await host.locator('[data-bd-part="stair-right"]').waitFor();
  assert.ok(await host.locator('[data-bd-part="stair-left"]').count());
  await host.locator('[data-bd-platform-stair="none"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-bd-part^="stair"]'));
  assert.ok(await host.locator('[data-bd-stair-width]').isHidden());
  assert.match(await host.locator('[data-bd-chips]').textContent(), /No supports/);
  await host.locator('[data-bd-part="board"]').click();
  await page.waitForFunction(() => document.querySelector('[data-bd-card="platformRail"]').classList.contains('bd-flash'));
  // A building on a stand, open above its waist wall.
  await host.locator('[data-bd-preset="booth-column"]').click();
  await host.locator('[data-bd-part="column"]').waitFor();
  assert.ok((await setting('stOpen').isChecked()) && (await setting('stWaist').isVisible()));
  await setting('standType').selectOption('legs');
  await setting('standSize').fill('12');
  await setting('standSize').press('Tab');
  await host.locator('[data-bd-part="leg-4"]').waitFor();
  assert.ok(await host.locator('[data-bd-column]').isHidden());
  await host.locator('[data-bd-part="leg-1"]').click();
  await page.waitForFunction(() => document.querySelector('[data-bd-card="support"]').classList.contains('bd-flash'));
  await setting('stOpen').uncheck();
  await page.waitForFunction(() => !document.querySelector('.bd-form [name="stWaist"]'));
  // A control tower: its top storey open in panes, its walls leaning out, under a hip-free flat roof.
  await host.locator('[data-bd-preset="tower"]').click();
  await host.locator('[data-bd-part="front3"]').waitFor();
  await host.locator('[data-bd-storey="2"]').click();
  assert.equal(await setting('stLean').inputValue(), '15');
  assert.equal(await setting('stPanes').inputValue(), '3');
  // A way up: the press tower's staircase; a ladder instead, its card on a click.
  await host.locator('[data-bd-preset="press-tower"]').click();
  await page.waitForFunction(() => /Staircase/.test(document.querySelector('[data-bd-part="access"]')?.textContent ?? ''));
  assert.match(await host.locator('[data-bd-part="access"]').textContent(), /Staircase/);
  // A ladder stands along the wall: its foot moves onto it first.
  await setting('accessAt').fill('40');
  await setting('accessAt').press('Tab');
  await setting('access').selectOption('ladder');
  await page.waitForFunction(() => /Ladder/.test(document.querySelector('[data-bd-part="access"]')?.textContent ?? ''));
  await host.locator('[data-bd-part="access"]').click();
  await page.waitForFunction(() => document.querySelector('[data-bd-card="access"]').classList.contains('bd-flash'));
  // A walkway with towers: its own card, the towers' parts in the kit, no legs.
  await host.locator('[data-bd-preset="walkway-towers"]').click();
  await host.locator('[data-bd-part="tower2-roof-right"]').waitFor();
  assert.ok(await host.locator('[data-bd-card="walkway"]').isVisible() && (await host.locator('[data-bd-card="size"]').isHidden()));
  assert.ok(await host.locator('[data-bd-walkway-legs]').isHidden());
  // Without them, on its legs; then off its legs.
  await setting('wTowers').uncheck();
  await host.locator('[data-bd-part="leg-1"]').waitFor();
  await setting('wLegs').uncheck();
  await page.waitForFunction(() => !document.querySelector('[data-bd-part="leg-1"]'));
  // A modern pit lane: bays chosen one by one; a bay added, its type changed.
  await host.locator('[data-bd-preset="pit-boxes"]').click();
  await host.locator('[data-bd-part="roofright-3"]').waitFor();
  assert.ok(await host.locator('[data-bd-card="bays"]').isVisible());
  await host.locator('[data-bd-bay-add]').click();
  await host.locator('[data-bd-part="bay-4"]').waitFor();
  await setting('bType-3').selectOption('podium');
  await page.waitForFunction(() => /podium/.test(document.querySelector('[data-bd-part="bay-4"]')?.textContent ?? ''));
  await host.locator('[data-bd-bay-remove="0"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-bd-part="bay-4"]'));
  // A hip roof: its four panels.
  await host.locator('[data-bd-preset="tower-pyramid"]').click();
  await host.locator('[data-bd-part="roof-right"]').waitFor();
  // A food stall: serving hatches with a counter and a flap, a sign.
  await host.locator('[data-bd-preset="stall-container"]').click();
  await host.locator('[data-bd-part="counter-2"]').waitFor();
  await host.locator('[data-bd-part="flap-1"]').waitFor();
  assert.ok((await setting('sign').inputValue()) === 'billboard' && (await host.locator('[data-bd-sign-size]').isVisible()));
  assert.match(await host.locator('[data-bd-part="sign"]').textContent(), /Billboard/);
  // Return to an ordinary shell and leave room above the taller framed café hatch.
  await setting('container').selectOption('none');
  await setting('height').fill('100'); await setting('height').press('Tab');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('foundry.building'))?.height === 100);
  await setting('sign').selectOption('fascia');
  await page.waitForFunction(() => /^Sign/.test(document.querySelector('[data-bd-part="sign"] b')?.textContent ?? ''));
  await setting('sign').selectOption('none');
  await page.waitForFunction(() => !document.querySelector('[data-bd-part="sign"]'));
  assert.ok(await host.locator('[data-bd-sign-size]').isHidden());
  await host.locator('[data-bd-part="counter-1"]').click();
  // Its window's row in the card lights up.
  await page.waitForFunction(() => document.querySelector('[data-bd-card="openings"] [data-op="0"]')?.classList.contains('bd-flash'));
  const flap = host.locator('[data-op="0"] [name="flap"]');
  assert.ok(await flap.isChecked());
  await flap.uncheck();
  await page.waitForFunction(() => !document.querySelector('[data-bd-part="flap-1"]'));
  // Each newer kind and preset loads in the page and builds, its own card showing, no error.
  for (const [preset, part, card] of [
    ['flag-post', 'steps', 'flag'],
    ['billboard', 'board-1', 'billboard'],
    ['hoarding', 'board-3', 'billboard'],
    ['benches', 'seat-3', 'bench'],
    ['tyre-bridge', 'canopy-roof', 'tyre'],
    ['picnic', 'end-right', 'picnic'],
    ['stairs-switchback', 'landing-top', 'switchback'],
    ['gantry-timber', 'board', 'gantry'],
    ['gantry-sign', 'sign', 'gantry'],
    ['stand-raised', 'frame-1', 'standFrame'],
    ['race-control', 'railing3-back', 'size'],
    ['pit-tower', 'access', 'access'],
    ['crosswalk', 'tower2-front3', 'walkway'],
    ['hut-frames', 'stand-foot', 'support'],
    ['hut-legs', 'access', 'access'],
    ['hut-brick', 'step-1', 'size'],
  ]) {
    await host.locator('[data-bd-preset="' + preset + '"]').click();
    await host.locator('[data-bd-part="' + part + '"]').waitFor();
    assert.ok(await host.locator('[data-bd-card="' + card + '"]').isVisible(), preset + ': its card');
    assert.ok(await host.locator('.bd-error').isHidden(), preset + ': no error');
  }
  // A gantry over the track: a type to choose, its own cards.
  await host.locator('[data-bd-preset="gantry-lattice"]').click();
  await host.locator('[data-bd-part="leg-2"]').waitFor();
  assert.ok(await host.locator('[data-bd-card="gantry"]').isVisible());
  assert.ok(await host.locator('[data-bd-card="gantryBridge"]').isHidden());
  await host.locator('[data-bd-gantry-type="bridge"]').click();
  await host.locator('[data-bd-part^="deck"]').first().waitFor();
  assert.ok(await host.locator('[data-bd-card="gantryBridge"]').isVisible());
  await bd('new').click();
  await partCount(12);
  assert.ok(await host.locator('[data-bd-card="size"]').isVisible());
  // Close the last notice, as the next checks expect none.
  if (await page.locator('#notice').isVisible()) await page.locator('#notice').click();
  console.log('✓ Buildings: a garage kit is built, checked, exported as STLs with notes, saved and opened from the Library; a two-sided roof, a framed window, textures and a second storey change its parts; on a small plate the parts are cut into pieces that fit');
}
