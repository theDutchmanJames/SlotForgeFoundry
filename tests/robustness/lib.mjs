// Shared harness for the robustness runs: the Vite dev server (so a page can
// import Foundry's own modules and use the real IndexedDB and SQLite), and a
// Chrome or Edge started here, so a test can kill its whole process tree in
// the middle of a save, as a crash or a pulled plug would.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

export const root = fileURLToPath(new URL('../../', import.meta.url));

const browserPaths = {
  win32: [
    join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    join(process.env.ProgramFiles || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};
export const executablePath =
  process.env.SLOT_FORGE_BROWSER ||
  [...(browserPaths[process.platform] || []), chromium.executablePath()].find((p) => existsSync(p));
if (!executablePath) throw Error('Install Chromium or set SLOT_FORGE_BROWSER to the browser executable.');

// The dev server serves src/ as modules. The Planner cache is switched off in
// dev builds; `cache: true` switches it on for the crash test.
export async function devServer({ cache = false } = {}) {
  const server = await createServer({
    root,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null },
    ...(cache && { define: { 'import.meta.env.DEV': 'false' } }),
  });
  await server.listen();
  const { port } = server.httpServer.address();
  return { url: 'http://127.0.0.1:' + port, close: () => server.close() };
}

export async function tempDir(name) {
  return mkdtemp(join(tmpdir(), 'slotforge-' + name + '-'));
}
// A killed browser can hold its profile lock for a moment longer.
export const removeDir = (dir) =>
  rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});

// Starts the browser on a profile folder and connects to it.
export async function startBrowser(profile) {
  const child = spawn(
    executablePath,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--user-data-dir=' + profile,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      'about:blank',
    ],
    { stdio: 'ignore', detached: process.platform !== 'win32' },
  );
  const portFile = join(profile, 'DevToolsActivePort');
  // A killed browser leaves its old port behind.
  await rm(portFile, { force: true });
  let port;
  for (let i = 0; i < 200 && !port; i++) {
    await sleep(50);
    try {
      port = (await readFile(portFile, 'utf8')).split('\n')[0].trim();
    } catch {
      /* not written yet */
    }
  }
  if (!port) throw Error('The browser did not start.');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + port, { timeout: 30_000 });
  return { browser, child, profile };
}

// Kills the browser and every helper process at once: nothing gets to
// finish or flush on its own. On Windows the started process can hand over
// to another, so every browser process on this profile is stopped.
export async function killBrowser({ child, profile }) {
  if (process.platform === 'win32') {
    const script =
      "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' or Name='chrome.exe' or Name='chromium.exe'\" | " +
      "Where-Object { $_.CommandLine -and $_.CommandLine.Contains('" + profile.replaceAll("'", "''") + "') } | " +
      'ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }';
    try {
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  if (child.exitCode === null)
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(5000)]);
  await sleep(300);
}
export async function closeBrowser(session) {
  try {
    await session.browser.close();
  } catch {
    /* killed */
  }
  await killBrowser(session);
}

// A page on the dev server with Foundry's modules a call away.
export async function harnessPage(browser, url) {
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url + '/tests/robustness/harness.html');
  page.errors = errors;
  return page;
}

export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
