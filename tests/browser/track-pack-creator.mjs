export async function openPackCreator(page, action, pack, rules) {
  // The top bar's Library (the sidebar shows the pack rail for pack pieces).
  await action('mode-library').click();
  await action('packs-dialog').click();
  const library = page.locator('dialog.track-library');
  const setting = (name) => library.locator('[name="' + name + '"]');
  if (rules) {
    await library.locator('[data-lib="new"]').click();
    await setting('itemName').fill(pack);
    await setting('startWith').selectOption('empty');
    for (const [name, value] of Object.entries(rules))
      await setting(name).fill(String(value));
    await library.locator('[data-lib="commit-new"]').click();
  } else {
    await setting('collection').selectOption({ label: pack });
  }
  await library.locator('[data-lib="create-piece"]').click();
  return page.locator('dialog.piece-creator');
}
