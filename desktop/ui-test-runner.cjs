'use strict';
// Runs desktop/ui-tests.cjs in the real desktop window on a throwaway data
// folder. SLOTFORGE_UI_SHOTS=<folder> also saves pictures of the windows.
// Run after npm run build: npm run test:desktop-ui
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electron = require('electron');

const root = path.resolve(__dirname, '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-ui-'));
const result = path.join(data, 'result.json');
// A show:false window still paints for screenshots when this is set.
// SLOTFORGE_ELECTRON_ARGS adds Chromium switches, such as software WebGL on a CI machine.
const extra = (process.env.SLOTFORGE_ELECTRON_ARGS || '').split(/\s+/).filter(Boolean);
const args = [...extra, root, '--portable-data-dir=' + data, '--force-device-scale-factor=1'];
const child = spawn(electron, args, {
  env: { ...process.env, SLOTFORGE_UI_TESTS: result, SLOTFORGE_NO_UPDATE_CHECK: '1' },
  stdio: 'inherit',
});
const timer = setTimeout(() => child.kill(), 180_000);
child.on('exit', () => {
  clearTimeout(timer);
  let report;
  try {
    report = JSON.parse(fs.readFileSync(result, 'utf8'));
  } catch {
    report = { crashed: 'The desktop app wrote no result.' };
  }
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  if (report.crashed || report.failed) {
    console.error(report.crashed || report.failed + ': ' + report.message);
    process.exit(1);
  }
  let failed = 0;
  for (const r of report.results) {
    console.log((r.ok ? '✓ ' : '✗ ') + r.name);
    if (!r.ok) {
      failed++;
      console.error('  ' + r.error);
    }
  }
  process.exit(failed ? 1 : 0);
});
