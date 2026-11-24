import assert from 'node:assert/strict';
import { newProject } from '../../src/project.js';
import { selectTrackPart } from './part-outline.mjs';

export async function checkWorkspaceNavigation({
  page,
  action,
  tab,
  input,
  live,
  openProject,
  waitText,
  snap,
}) {
  const top = page.getByRole('banner');
  for (const key of [
    'mode-track',
    'mode-editor',
    'mode-library',
    'open',
    'save',
    'export-menu',
  ])
    assert.ok(
      await top.locator('[data-action="' + key + '"]').isVisible(),
      key,
    );
  for (const key of ['new-custom', 'import-context'])
    assert.ok(
      await page
        .locator('#project-panel [data-action="' + key + '"]')
        .isVisible(),
      key,
    );
  assert.equal(
    await page.locator('[data-action="export-menu"]:visible').count(),
    1,
  );
  assert.equal(await page.locator('[data-action="print-selected"]').count(), 0);

  // Settings: a printer preset fills the plate and is kept on this device.
  await action('mode-settings').click();
  const settingsForm = page.locator('#app-settings-form');
  await settingsForm.locator('[name="printer"]').selectOption('bambu-a1');
  assert.equal(await settingsForm.locator('[name="width"]').inputValue(), '256');
  assert.equal(await settingsForm.locator('[name="margin"]').inputValue(), '0');
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('foundry.settings')));
  assert.deepEqual(kept.plate, { width: 256, depth: 256, margin: 0 });
  await page.evaluate(() => localStorage.removeItem('foundry.settings'));
  await action('mode-track').click();
  assert.ok(await page.locator('#settings-page').isHidden());
  assert.ok(await page.locator('.workspace').isVisible());

  await action('mode-editor').click();
  await waitText('#model-title', 'Workshop enclosure');
  await action('mode-library').click();
  await action('packs-dialog').click();
  const library = page.locator('dialog.track-library');
  await library.waitFor();
  assert.equal(await library.locator('[data-lib="save"]:visible').count(), 0);
  await library.getByRole('button', { name: /^R4 corner\b/ }).click();
  await library.waitFor({ state: 'detached' });
  await waitText('#model-title', 'R4 corner');
  assert.equal(await action('mode-track').getAttribute('aria-pressed'), 'true');

  // The recipe opens whole. Cut it in six, as for a 200 mm plate, so the
  // assembly has groups of several parts.
  await tab('print').click();
  assert.equal(await input('segments').inputValue(), '1');
  await input('segments').fill('6');
  await live();
  await action('apply').click();
  await live('idle');

  // The clip type is a pack rule: the commit bar offers Apply to collection,
  // which rebuilds every piece of the pack. The pack is set back at the end.
  await tab('joints').click();
  const originalClip = await input('clipType').inputValue();
  await input('clipType').selectOption('carrera-retained');
  await live();
  assert.ok(await page.locator('[data-pack-apply]').isVisible());
  assert.match(await page.locator('[data-pack-apply]').innerText(), /Clip type/);
  assert.equal(await action('apply').isVisible(), false);
  await action('apply-collection').click();
  await live('idle');
  await waitText('#notice', 'Applied to all');
  await page.locator('#notice').click();
  await tab('profile').click();
  for (const id of ['road', 'clip', 'retainer']) {
    const group = page.locator('[data-part-group="' + id + '"]');
    const toggle = group.locator('[data-toggle-part-group]');
    const members = group.locator('[data-part]');
    const n = await members.count();
    assert.ok(n > 1, id);
    assert.match(await toggle.innerText(), new RegExp('\\b' + n + '\\b'), id);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await members.first().isVisible(), false);
  }
  assert.equal(
    await page.locator('[data-part-group="road"] [data-part]').count(),
    6,
  );
  const inspector = await page.locator('.inspector').boundingBox();
  assert.ok(
    inspector.width >= 260 && inspector.width <= 325,
    'compact desktop property inspector',
  );
  const slot = page.locator('[data-property-readout="slot"]');
  const braid = page.locator('[data-property-readout="braid"]');
  assert.match(await slot.textContent(), /3.*8/);
  assert.equal(
    await braid
      .locator('xpath=ancestor::details')
      .evaluate((section) => section.open),
    false,
  );
  await input('slotDepth').fill('7.5');
  await live();
  assert.match(await slot.textContent(), /7\.5/);
  await action('restore').click();
  await live('idle');
  await snap('r4-cross-section');

  const hardware = page.locator('[data-part-group="clip"]');
  const visibility = hardware.locator('[data-visible-group]');
  await visibility.click();
  assert.equal(await visibility.getAttribute('aria-pressed'), 'false');
  assert.ok(
    await hardware
      .locator('[data-visible]')
      .evaluateAll((buttons) =>
        buttons.every((b) => /show/i.test(b.ariaLabel || b.title)),
      ),
    'all clip instances hide together',
  );
  await visibility.click();
  await hardware.locator('[data-toggle-part-group]').click();
  await hardware.locator('[data-visible]').first().click();
  assert.equal(await visibility.getAttribute('aria-pressed'), 'mixed');
  await visibility.click();
  assert.equal(await visibility.getAttribute('aria-pressed'), 'true');
  const road = page.locator('[data-part="road-3"]');
  await selectTrackPart(road);
  await waitText('#selected-name', 'Road 3');
  await page.locator('[data-toggle-part-group="road"]').click();
  await action('reveal-selected').click();
  assert.ok(
    await road.evaluate((element) => element === document.activeElement),
  );
  await action('edit-part').click();
  await waitText('#model-title', 'Road 3');
  assert.equal(
    await action('mode-editor').getAttribute('aria-pressed'),
    'true',
  );
  await action('mode-track').click();
  await waitText('#model-title', 'R4 corner');
  await tab('joints').click();
  await input('clipType').selectOption(originalClip);
  await live();
  await action('apply-collection').click();
  await live('idle');
  await waitText('#notice', 'Applied to all');
  await page.locator('#notice').click();
  await openProject(
    Buffer.from(JSON.stringify(newProject())),
    'club-bend.slotfab',
  );
  console.log(
    '✓ Global Library opens an R4 in Track builder, its outline counts and hides hardware, and Road 3 transfers to STL editor',
  );
}
