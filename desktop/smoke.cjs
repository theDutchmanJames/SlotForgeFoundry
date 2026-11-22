'use strict';
// Starts the desktop app on a throwaway portable data folder, twice, and
// checks what the page shows: Foundry's Home with its packs, the desktop
// bridge and the update check, no console errors, and the data folder used.
// Run after npm run build: npm run test:desktop
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electron = require('electron');

const root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) throw Error('Run npm run build first.');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-desktop-'));

function launch() {
  const result = path.join(data, 'smoke-' + Date.now() + '.json');
  return new Promise((resolve, reject) => {
    // SLOTFORGE_ELECTRON_ARGS adds Chromium switches, such as software WebGL on a CI machine.
    const extra = (process.env.SLOTFORGE_ELECTRON_ARGS || '').split(/\s+/).filter(Boolean);
    const child = spawn(electron, [...extra, root, '--portable-data-dir=' + data], {
      env: { ...process.env, SLOTFORGE_DESKTOP_SMOKE: result, SLOTFORGE_NO_UPDATE_CHECK: '1' },
      stdio: 'inherit',
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('The desktop app did not finish within 90 s.'));
    }, 90_000);
    child.on('exit', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(fs.readFileSync(result, 'utf8')));
      } catch (e) {
        reject(Error('The desktop app wrote no result: ' + e.message));
      }
    });
  });
}

(async () => {
  try {
    for (const round of ['first start', 'second start']) {
      const r = await launch();
      assert.equal(r.failed, undefined, r.message);
      assert.equal(r.mode, 'portable', round);
      assert.equal(path.resolve(r.profile), path.join(data, 'app-profile'), round + ': data stays in the given folder');
      assert.ok(r.page?.home, round + ': Home did not appear: ' + JSON.stringify(r.page));
      assert.ok(r.page.packs >= 2, round + ': the starter packs are listed');
      assert.ok(r.page.desktop && r.page.updates, round + ': the desktop bridge and the update check are there');
      assert.match(r.page.href, /^file:/, round);
      assert.deepEqual(r.errors, [], round + ': console errors');
      assert.equal(r.page.starts, round === 'first start' ? 1 : 2, round + ': saved data is there after a restart');
      console.log('✓ ' + round + ': Foundry ' + r.version + ' opened from ' + r.page.href.split('/').slice(-2).join('/'));
    }
    // The Library, autosave and settings live in the portable folder.
    assert.ok(fs.existsSync(path.join(data, 'app-profile', 'IndexedDB')), 'the Library is kept in the portable folder');
    console.log('✓ the Library and settings are kept in the portable data folder');
  } finally {
    fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
