'use strict';
// SlotForge Foundry desktop shell. Foundry is a single offline page
// (dist/index.html, built by Vite); this shows it in its own window, keeps
// its data in the right place for this copy (installed or portable), and adds
// the SlotForge update check (desktop/update-check.cjs).
const { app, BrowserWindow, Menu, dialog, shell, session, ipcMain, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const location = require('./data-location.cjs');
const { UpdateCheck } = require('./update-check.cjs');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'dist', 'index.html');
const HOMEPAGE = require('../package.json').homepage;

const where = location.resolve({ packaged: app.isPackaged });
if (where.profile) app.setPath('userData', where.profile);
app.setAppUserModelId('nl.slotforge.foundry');
// Test machines without a usable GPU (a CI virtual display): draw WebGL in
// software with Chromium's SwiftShader. Never set for normal use.
if (process.env.SLOTFORGE_SOFTWARE_GL) {
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
}
const logFile = () => path.join(app.getPath('userData'), 'desktop.log');

function log(message) {
  try {
    const file = logFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      if (fs.statSync(file).size > 256 * 1024) fs.renameSync(file, file + '.previous');
    } catch {}
    fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
  } catch {}
}

const automated = !!(process.env.SLOTFORGE_DESKTOP_SMOKE || process.env.SLOTFORGE_UI_TESTS);
function fail(title, message) {
  log(`${title}: ${message}`);
  if (automated)
    fs.writeFileSync(
      process.env.SLOTFORGE_DESKTOP_SMOKE || process.env.SLOTFORGE_UI_TESTS,
      JSON.stringify({ failed: title, message }),
    );
  else dialog.showErrorBox(title, message);
  app.exit(1);
}

// Only one window per data folder: the profile path makes this lock per
// folder, so a portable copy and an installed copy can run side by side.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  // "A new version is available": installed and portable apps ask GitHub once,
  // a few seconds after start; a newer version opens a window with What's new,
  // Skip and Download. Development copies, automated runs and
  // SLOTFORGE_NO_UPDATE_CHECK only check when asked in Settings.
  const updateCheck = new UpdateCheck({
    profile: app.getPath('userData'),
    current: app.getVersion(),
    homepage: HOMEPAGE,
    appName: 'Foundry',
    artifactPrefix: 'SlotForgeFoundry',
    userAgent: 'SlotForge-Foundry',
    fetch: (url, init) => net.fetch(url, init),
    automatic: app.isPackaged && !automated && !process.env.SLOTFORGE_NO_UPDATE_CHECK,
    // Which file replaces this copy: the portable app and an AppImage say so through these.
    edition: {
      platform: process.platform,
      arch: process.arch,
      portable: !!process.env.PORTABLE_EXECUTABLE_FILE,
      appImage: !!process.env.APPIMAGE,
    },
    downloads: app.getPath('downloads'),
    onChange: () => {
      if (win && !win.isDestroyed()) win.webContents.send('update:changed');
    },
  });
  let updateTimer = setTimeout(() => void updateCheck.startupCheck(), 5 * 1000);
  updateTimer.unref();
  // Only Foundry's own page may ask: the page is a file, so the sender must be
  // the main frame of Foundry's window showing that file.
  const ownPage = event =>
    !!win &&
    event.sender === win.webContents &&
    event.senderFrame === win.webContents.mainFrame &&
    sameFile(event.senderFrame.url);
  ipcMain.handle('update:action', async (event, action, payload) => {
    if (!ownPage(event)) return { error: 'Unknown page.' };
    try {
      if (action === 'status') return { ok: true, value: updateCheck.status() };
      if (action === 'check') return { ok: true, value: await updateCheck.check() };
      if (action === 'enable') return { ok: true, value: updateCheck.setEnabled(payload?.enabled) };
      if (action === 'skip') return { ok: true, value: updateCheck.skip(payload?.version) };
      if (action === 'download') {
        // Not awaited: progress and the result reach the window through update:changed.
        updateCheck.startDownload().catch(() => {});
        return { ok: true, value: updateCheck.status() };
      }
      if (action === 'cancel') return { ok: true, value: updateCheck.cancelDownload() };
      if (action === 'show') {
        shell.showItemInFolder(updateCheck.downloadedFile());
        return { ok: true, value: { shown: true } };
      }
      if (action === 'open') {
        await shell.openExternal(updateCheck.releaseUrl());
        return { ok: true, value: { opened: true } };
      }
      throw Error('Unknown update action.');
    } catch (e) {
      return { error: e.message, code: e.code };
    }
  });

  // The page and nothing else: the same file, any hash or query.
  const pageUrl = new URL('file:' + (process.platform === 'win32' ? '///' : '//') + PAGE.replaceAll('\\', '/'));
  function sameFile(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'file:' && decodeURIComponent(u.pathname) === decodeURIComponent(pageUrl.pathname);
    } catch {
      return false;
    }
  }
  function external(url) {
    try {
      const u = new URL(url);
      if (['https:', 'http:', 'mailto:'].includes(u.protocol)) shell.openExternal(url);
    } catch {}
  }

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.on('before-quit', () => {
    clearTimeout(updateTimer);
    updateCheck.stop(); // abandons a check or download in progress
  });
  app.on('window-all-closed', () => app.quit());

  function openWindow() {
    const ses = session.defaultSession;
    // Copying text is the only permission the page needs.
    ses.setPermissionRequestHandler((_wc, permission, callback) =>
      callback(permission === 'clipboard-sanitized-write'),
    );
    win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      show: false,
      title: 'SlotForge Foundry',
      backgroundColor: '#171b21',
      icon: path.join(ROOT, 'desktop', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    // Links leave in the system browser; the window only ever shows Foundry.
    win.webContents.setWindowOpenHandler(({ url }) => {
      external(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
      if (!sameFile(url)) {
        event.preventDefault();
        external(url);
      }
    });
    win.webContents.on('render-process-gone', (_e, details) => log('Renderer stopped: ' + details.reason));
    win.once('ready-to-show', () => {
      // Interface-test pictures need a painted window.
      if (!automated || process.env.SLOTFORGE_UI_SHOTS) win.show();
    });
    win.on('closed', () => {
      win = null;
    });
    if (process.env.SLOTFORGE_DESKTOP_SMOKE) smoke(process.env.SLOTFORGE_DESKTOP_SMOKE);
    else if (process.env.SLOTFORGE_UI_TESTS)
      // Interface tests (desktop/ui-tests.cjs) are only in the source tree, not in builds.
      win.webContents.once('did-finish-load', () =>
        require('./ui-tests.cjs')
          .run(win, { app, where, updateCheck })
          .then(result => fs.writeFileSync(process.env.SLOTFORGE_UI_TESTS, JSON.stringify(result, null, 2)))
          .catch(e => fs.writeFileSync(process.env.SLOTFORGE_UI_TESTS, JSON.stringify({ crashed: e.stack })))
          .finally(() => app.quit()),
      );
    win.loadFile(PAGE);
  }

  // Automated check used by desktop/smoke.cjs: report what the page shows, then quit.
  function smoke(resultFile) {
    const errors = [];
    win.webContents.on('console-message', event => {
      if (event.level === 'error') errors.push(event.message);
    });
    win.webContents.once('did-finish-load', async () => {
      let page = null;
      for (let i = 0; i < 80 && !page?.home; i++) {
        await new Promise(r => setTimeout(r, 250));
        page = await win.webContents
          .executeJavaScript(
            `({ href: location.href, title: document.title, home: !!document.querySelector('#home:not([hidden]) .home-tile'), packs: document.querySelectorAll('#home [data-home="edit"]').length, desktop: !!window.slotforgeDesktop, updates: !!window.UpdateUI })`,
          )
          .catch(e => ({ error: e.message }));
      }
      // Counted once per start: saved data must survive a restart.
      if (page?.home)
        page.starts = await win.webContents
          .executeJavaScript(
            `(() => { const n = 1 + Number(localStorage.getItem('foundry.smokeStarts') || 0); localStorage.setItem('foundry.smokeStarts', String(n)); return n; })()`,
          )
          .catch(() => null);
      fs.writeFileSync(
        resultFile,
        JSON.stringify(
          { mode: where.mode, profile: app.getPath('userData'), version: app.getVersion(), page, errors },
          null,
          2,
        ),
      );
      app.quit();
    });
  }

  function menu() {
    const mac = process.platform === 'darwin';
    const template = [
      ...(mac ? [{ role: 'appMenu' }] : [{ label: 'File', submenu: [{ role: 'quit' }] }]),
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          { role: 'toggleDevTools' },
        ],
      },
      { role: 'windowMenu' },
      {
        label: 'Help',
        submenu: [
          { label: 'SlotForge Foundry on GitHub', click: () => shell.openExternal(HOMEPAGE) },
          { label: 'Report a problem', click: () => shell.openExternal(HOMEPAGE + '/issues') },
          { type: 'separator' },
          { label: 'Show data folder', click: () => shell.openPath(app.getPath('userData')) },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  app
    .whenReady()
    .then(() => {
      if (where.problem) return fail('SlotForge Foundry cannot start here', where.problem);
      if (!fs.existsSync(PAGE))
        return fail('SlotForge Foundry is incomplete', 'The app page is missing:\n' + PAGE + '\n\nRun npm run build first.');
      try {
        fs.mkdirSync(app.getPath('userData'), { recursive: true });
        fs.accessSync(app.getPath('userData'), fs.constants.W_OK);
      } catch (e) {
        return fail(
          'SlotForge Foundry cannot save here',
          `Foundry could not create its data folder:\n${app.getPath('userData')}\n\n${e.message}\n\n` +
            (where.mode === 'portable'
              ? 'Move the portable app to a folder you can write to, such as Documents or a USB drive.'
              : 'Check the folder permissions and try again.'),
        );
      }
      log(`Starting ${app.getVersion()} (${where.mode}) with data in ${app.getPath('userData')}`);
      menu();
      openWindow();
    })
    .catch(e => fail('SlotForge Foundry could not start', (e.stack || e.message) + `\n\nDetails: ${logFile()}`));
}
