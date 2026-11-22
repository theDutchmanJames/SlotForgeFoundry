'use strict';
// Interface tests in the real desktop window (started by ui-test-runner.cjs
// with SLOTFORGE_UI_TESTS). GitHub is replaced by a fake answer.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (ok, message) => {
  if (!ok) throw Error(message);
};

test("a newer release opens the update window: What's new, Skip, and Download into Downloads", async (h) => {
  const u = h.context.updateCheck;
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-downloads-'));
  const bytes = Buffer.from('a pretend installer');
  let tag = 'v9.9.0';
  const name = () => `SlotForgeFoundry-${tag.slice(1)}-Setup-x64.exe`;
  const requests = [];
  u.edition = { platform: 'win32', arch: 'x64' };
  u.downloads = folder;
  u.fetch = async (url) => {
    requests.push(url);
    return url.includes('/releases/download/')
      ? {
          ok: true,
          status: 200,
          body: {
            getReader: () => {
              const parts = [bytes];
              return { read: async () => (parts.length ? { done: false, value: parts.shift() } : { done: true }) };
            },
          },
        }
      : {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              tag_name: tag,
              draft: false,
              prerelease: false,
              published_at: '2026-01-01T00:00:00Z',
              body: "Intro.\n\n## What's new\n\n- **Desktop app:** Foundry as an installer and a portable app.\n\n## Verification\n\n- tests",
              assets: [
                { name: name(), size: bytes.length, digest: 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex') },
              ],
            }),
        };
  };
  const dialog = () =>
    h.js(`const d = document.getElementById('update-dialog');
      return d && { open: d.open, title: d.querySelector('h2')?.textContent, news: d.querySelector('.update-news')?.textContent,
        text: d.textContent, buttons: [...d.querySelectorAll('.dialog-actions button')].map(b => b.textContent) };`);
  // At start: the check opens the window by itself.
  await u.check(); // what the check at start does (it is off in automated runs)
  await h.waitFor(`return document.getElementById('update-dialog')?.open;`, 'the update window');
  let d = await dialog();
  assert(d.title === 'Foundry 9.9.0', `title "${d.title}"`);
  assert(/Desktop app: Foundry as an installer/.test(d.news) && !/tests/.test(d.news), `What's new "${d.news}"`);
  assert(/Windows · installer/.test(d.text), 'the window does not say which copy this is');
  assert(!/null|undefined/.test(d.text), `stray words in the window: ${d.text}`);
  assert(d.buttons.join() === 'Skip this version,Download', `buttons ${d.buttons}`);
  assert(requests[0] === 'https://api.github.com/repos/theDutchmanJames/SlotForgeFoundry/releases/latest', `asked ${requests[0]}`);
  await h.shot('update-window');
  if (process.env.SLOTFORGE_UI_SHOTS) {
    await h.js(`document.querySelector('[data-action="theme-light"]').click();`);
    await h.shot('update-window-light');
    await h.js(`document.querySelector('[data-action="theme-dark"]').click();`);
  }
  // Download: saved in the Downloads folder and checked; Show in folder is offered.
  await h.click('#update-download');
  await h.waitFor(`return !!document.getElementById('update-show');`, 'the finished download');
  assert(fs.readFileSync(path.join(folder, name())).equals(bytes), 'the downloaded file is not the release file');
  assert(/Saved in Downloads/.test((await dialog()).text), 'no saved message');
  assert(/your packs, layouts and STL parts stay where they are/.test((await dialog()).text), 'no word on what an update keeps');
  await h.shot('update-saved');
  await h.js(`document.getElementById('update-dialog').close();`);
  // Settings → Updates shows the newer version.
  u.download = { state: 'idle' };
  await h.js(`document.querySelector('[data-action="mode-settings"]').click();`);
  await h.waitFor(`return /Version 9\\.9\\.0 is available/.test(document.querySelector('.update-card')?.textContent);`, 'Settings → Updates');
  await h.shot('settings-updates');
  // Check now shows the window again; Skip keeps it away until a newer version.
  await h.click('#update-check-now');
  await h.waitFor(`return document.getElementById('update-dialog')?.open;`, 'the window from Check now');
  await h.click('#update-skip');
  await h.waitFor(`return !document.getElementById('update-dialog')?.open;`, 'the window to close after Skip');
  assert(u.status().notify === false, 'a skipped version still asks to open');
  tag = 'v9.10.0';
  await u.check();
  await h.waitFor(`return document.getElementById('update-dialog')?.open && /9\\.10\\.0/.test(document.querySelector('#update-dialog h2').textContent);`, 'the next version');
  await h.js(`document.getElementById('update-dialog').close();`);
  fs.rmSync(folder, { recursive: true, force: true });
});

test('Settings → Updates leaves the other settings alone and switches the check at start', async (h) => {
  const u = h.context.updateCheck;
  u.automatic = true; // as in an installed copy
  u.onChange(); // the page asks for the status again
  // One click at a time: Foundry ignores a click while the last one is busy.
  await h.click('[data-action="mode-home"]');
  await h.waitFor(`return !document.getElementById('home').hidden;`, 'Home');
  await h.waitFor(
    `const page = document.getElementById('settings-page');
     if (page.hidden) document.querySelector('[data-action="mode-settings"]').click();
     return !page.hidden;`,
    'Settings',
  );
  await h.waitFor(`return !!document.getElementById('update-toggle');`, 'the switch').catch(async (e) => {
    throw Error(e.message + ' | ' + JSON.stringify(u.status()).slice(0, 300) + ' | ' + (await h.js(`return [!!document.querySelector('.st-updates'), document.querySelector('.st-updates')?.innerHTML.length, !document.getElementById('settings-page').hidden, document.querySelector('#settings-page h2')?.textContent].join(',')`)));
  });
  const before = u.status().enabled;
  await h.click('#update-toggle');
  await h.waitFor(`return document.getElementById('update-toggle').checked === ${!before};`, 'the switch to move');
  assert(u.status().enabled === !before, 'the switch did not change the setting');
  await h.click('#update-toggle');
  const groups = await h.js(`return [...document.querySelectorAll('#settings-page h2')].map(h => h.textContent).join(',');`);
  assert(/Look/.test(groups) && /Printer/.test(groups) && /Updates/.test(groups), `Settings groups: ${groups}`);
});

async function run(win, context) {
  const wc = win.webContents;
  const js = (body) => wc.executeJavaScript(`(async () => { ${body} })()`, true);
  const h = {
    context,
    js,
    click: (selector) => js(`const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw Error('No ' + ${JSON.stringify(selector)}); el.click();`),
    async waitFor(body, what, ms = 15000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await js(body).catch(() => false)) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error('Timed out waiting for ' + what);
    },
    async shot(name) {
      const dir = process.env.SLOTFORGE_UI_SHOTS;
      if (!dir) return;
      await new Promise((r) => setTimeout(r, 300));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name + '.png'), (await wc.capturePage()).toPNG());
    },
  };
  // Wait for Foundry's Home before testing.
  await h.waitFor(`return !!document.querySelector('#home:not([hidden]) .home-tile');`, 'Foundry to open', 30000);
  const results = [];
  for (const t of tests) {
    try {
      await t.fn(h);
      results.push({ name: t.name, ok: true });
    } catch (e) {
      results.push({ name: t.name, ok: false, error: e.stack || e.message });
    }
  }
  return { results };
}

module.exports = { run };
