// Takes the README pictures from the built app (npm run build first):
// node scripts/readme-shots.mjs [dark|light]
// Saves PNGs in docs/screenshots. Set SLOT_FORGE_BROWSER for another browser.
import { existsSync, mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const page = new URL('../dist/index.html', import.meta.url);
const out = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
if (!existsSync(page)) throw Error('Run npm run build first.');
mkdirSync(out, { recursive: true });
const browserPath =
  process.env.SLOT_FORGE_BROWSER ||
  [
    join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    join(process.env.ProgramFiles || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((p) => existsSync(p));
const tone = process.argv[2] === 'light' ? 'light' : 'dark';
const profile = await mkdtemp(join(tmpdir(), 'foundry-shots-'));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: browserPath,
  viewport: { width: 1600, height: 960 },
  deviceScaleFactor: 1,
  colorScheme: tone,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const tab = context.pages()[0] || (await context.newPage());
const errors = [];
tab.on('pageerror', (e) => errors.push(e.message));
const settle = (ms = 1500) => tab.waitForTimeout(ms);
const click = async (selector) => {
  await tab.locator(selector).first().click();
  await settle();
};
const shot = async (name) => {
  await settle(800);
  await tab.screenshot({ path: join(out, name + '.png') });
  console.log('saved ' + name + '.png');
};
try {
  await tab.goto(page.href);
  await tab.waitForSelector('#home:not([hidden]) .home-tile', { timeout: 60000 });
  await tab.evaluate((t) => document.querySelector(`[data-action="theme-${t}"]`)?.click(), tone);
  await shot('home');
  await click('[data-action="mode-track"]');
  await tab.waitForSelector('#viewport canvas, canvas', { timeout: 60000 });
  await settle(4000);
  await shot('track-set');
  // A small oval in the Track Planner: two straights and six 30° bends per end.
  await click('[data-action="mode-planner"]');
  const planner = tab.locator('#track-planner');
  await tab.waitForFunction(() => document.querySelectorAll('.pl-card').length >= 10);
  const idle = () =>
    tab.waitForFunction(() => !document.querySelector('#track-planner').hasAttribute('aria-busy'), null, {
      timeout: 120000,
    });
  const add = async (name) => {
    await planner.getByRole('button', { name }).first().click();
    await idle();
  };
  for (let end = 0; end < 2; end++) {
    await add(/^Full straight/);
    await add(/^Starting grid|^Full straight/);
    for (let i = 0; i < 6; i++) await add(/^R3 corner/);
  }
  await click('[data-pl="fit"]').catch(() => {});
  await tab.keyboard.press('Escape');
  await shot('planner');
  await planner.locator('[data-pl="solid"]').click();
  await idle();
  await settle(3000);
  await shot('planner-3d');
  await planner.locator('[data-pl="plan"]').click();
  await idle();
  // A special piece from the Track Set shelf of the starter pack.
  await click('[data-action="mode-home"]');
  await tab.getByRole('button', { name: 'Edit pieces' }).first().click();
  await settle(6000);
  for (const [type, name] of [['hairpin', 'special-hairpin'], ['pit', 'special-pit']]) {
    const special = tab.locator('[data-add-special="' + type + '"]').first();
    await special.waitFor({ timeout: 30000 });
    await special.click();
    await settle(10000);
    await shot(name);
  }
  await click('[data-action="mode-editor"]');
  await settle(2000);
  await shot('stl-editor');
  await click('[data-action="mode-settings"]');
  await shot('settings');
  if (errors.length) console.log('page errors:\n' + errors.join('\n'));
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
