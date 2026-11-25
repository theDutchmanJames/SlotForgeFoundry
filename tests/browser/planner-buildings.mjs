import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';

// A building from the Library in a layout: placed along the track, seen in
// 3D, kept in the layout file and exported with the print kit. Runs after
// the Buildings checks, which save the Test garage in the Library.
export async function checkPlannerBuildings({ page, action, download, snap }) {
  const panel = page.locator('#track-planner'),
    cmd = (k) => panel.locator('[data-pl="' + k + '"]');
  const field = (k) => panel.locator('[data-pl-field="' + k + '"]');
  const idle = () => page.waitForFunction(() => !document.querySelector('#track-planner').hasAttribute('aria-busy'));
  await action('mode-planner').click();
  await panel.waitFor();
  await cmd('new').click();
  await idle();
  await field('pack').selectOption({ label: 'SlotForge Basic' });
  for (let i = 0; i < 2; i++) {
    await panel.getByRole('button', { name: /^Full straight/ }).click();
    await idle();
  }
  // The saved building is listed; placed, it stands along the track.
  const saved = panel.locator('.pl-homes [data-home]').filter({ hasText: 'Test garage' });
  await saved.waitFor();
  await saved.click();
  await idle();
  await panel.locator('svg.planner-map [data-building]').waitFor();
  assert.match(await panel.locator('.pl-message').textContent(), /Test garage was placed/);
  assert.match(await panel.locator('.pl-selection').textContent(), /Selected building[\s\S]*Test garage/);
  assert.match(await panel.locator('.pl-stats').textContent(), /1 building/);
  assert.match(await panel.locator('.pl-inventory').textContent(), /Test garage · building×7/);
  // Turned round, and stood along the track again.
  await cmd('b-turn').click();
  await idle();
  await cmd('b-snap').click();
  await idle();
  assert.match(await panel.locator('.pl-message').textContent(), /Standing along the track/);
  assert.match(await panel.locator('.pl-home-place summary').textContent(), /Clear of the track/);
  // In 3D, beside the track.
  await cmd('solid').click();
  await idle();
  await snap('track-planner-building');
  await cmd('plan').click();
  await idle();
  // The kit has the building in a folder of its own, with its notes.
  await action('export-menu').click();
  await page.locator('dialog.pl-segment').waitFor();
  await cmd('segment-confirm').click();
  await idle();
  const kit = unzipSync((await download(action('export-menu'))).bytes);
  const names = Object.keys(kit);
  assert.ok(names.includes('buildings/Test garage/01 Base plate.stl'), names.join(' '));
  assert.equal(names.filter((k) => /^buildings\/Test garage\/.*\.stl$/.test(k)).length, 7);
  assert.match(strFromU8(kit['buildings/Test garage/README.txt']), /Test garage · SlotForge Foundry building kit/);
  assert.match(strFromU8(kit['parts.csv']), /"Roller door","buildings\/Test garage\/07 Roller door\.stl","1","Test garage"/);
  const plan = JSON.parse(strFromU8(kit['layout.slotplan']));
  assert.equal(plan.buildings.length, 1);
  assert.equal(plan.buildings[0].building.width, 120);
  // Clicked in the plan it is chosen again; Delete takes it out.
  await panel.locator('svg.planner-map [data-building]').click();
  await cmd('remove').click();
  await idle();
  assert.equal(await panel.locator('svg.planner-map [data-building]').count(), 0);
  assert.equal(await panel.locator('.pl-stats').textContent().then((t) => /building/.test(t)), false);
  // A pit row: a garage over the end of every bay of a pit ladder, the track
  // running in through its open door.
  await cmd('new').click();
  await idle();
  await field('pack').selectOption({ label: 'SlotForge Basic Single Lane' });
  await panel.getByRole('button', { name: /^Full straight/ }).click();
  await idle();
  await cmd('ladder').click();
  await page.locator('dialog.pl-ladder').waitFor();
  // Bays far enough apart for a garage over each: closer, a garage would
  // stand on the corner that brings the next bay in, and says so.
  await field('ladderSpacing').fill('600');
  await cmd('ladder-confirm').click();
  await idle();
  await panel.locator('svg.planner-map [data-node]').filter({ has: page.locator('title', { hasText: 'End stop' }) }).first().click();
  await idle();
  await panel.locator('.pl-pit').waitFor();
  await field('pitHome').selectOption({ label: 'Test garage' });
  await cmd('pit-all').click();
  await idle();
  assert.match(await panel.locator('.pl-message').textContent(), /3 garages stand over the pit bays/);
  assert.equal(await panel.locator('svg.planner-map [data-building]').count(), 3);
  assert.match(await panel.locator('.pl-selection').textContent(), /over a pit bay/);
  const row = JSON.parse((await download(action('save'))).bytes);
  assert.equal(row.buildings.length, 3);
  for (const entry of row.buildings) {
    assert.ok(entry.bay && row.nodes.some((n) => n.id === entry.bay), 'each garage keeps its bay');
    assert.equal(entry.building.door, 'open');
    assert.ok(entry.building.doorWidth >= entry.building.lane.width + 4);
  }
  // A garage over a bay moves with it, not by hand.
  await panel.locator('svg.planner-map [data-building]').first().dragTo(panel.locator('svg.planner-map'), { targetPosition: { x: 20, y: 20 } });
  await idle();
  assert.match(await panel.locator('.pl-message').textContent(), /moves with it/);
  await cmd('solid').click();
  await idle();
  await snap('track-planner-pit-row');
  await cmd('plan').click();
  await idle();
  console.log('✓ Track Planner places a building from the Library along the track, turns it, shows it in 3D, keeps it in the layout and exports it with the kit; a pit row puts a garage over every bay, the track running in through its open door');
}
