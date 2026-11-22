export async function selectTrackPart(part) {
  await part.waitFor({ state: 'attached' });
  const group = part.locator('xpath=ancestor::*[@data-part-group]');
  const toggle = group.locator('[data-toggle-part-group]');
  if ((await toggle.getAttribute('aria-expanded')) === 'false')
    await toggle.click();
  await part.click();
}
