'use strict';
// Decides where the desktop app keeps its saved work. Foundry keeps
// everything (Library, autosave, settings, Planner cache) in its browser
// profile, so this only chooses that profile folder.
//
// Installed copies (Windows Setup, macOS /Applications, Linux .deb) use
// Electron's own folder for the app:
//   Windows  %APPDATA%\SlotForge Foundry
//   macOS    ~/Library/Application Support/SlotForge Foundry
//   Linux    $XDG_CONFIG_HOME (or ~/.config)/SlotForge Foundry
//
// Portable copies keep everything in a "SlotForge Foundry Data" folder
// beside the program, so the whole app can live on a USB stick:
//   Windows  folder containing the portable .exe
//   Linux    folder containing the .AppImage
//   macOS    folder containing SlotForge Foundry.app (outside Applications)
const path = require('node:path');
const os = require('node:os');

const PORTABLE_FOLDER = 'SlotForge Foundry Data';

// The .app bundle that contains the running executable, if any.
function macBundle(execPath) {
  const marker = '.app/Contents/MacOS/';
  const index = execPath.indexOf(marker);
  return index < 0 ? null : execPath.slice(0, index + 4);
}

function argument(argv, name) {
  const prefix = `--${name}=`;
  const found = argv.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

/**
 * Returns { mode, root, profile, problem }.
 *  profile: the folder for Electron's userData (null = Electron's default)
 *  problem: a message to show instead of starting, or null
 */
function resolve({
  platform = process.platform,
  env = process.env,
  argv = process.argv,
  execPath = process.execPath,
  user = os.homedir(),
  packaged = true,
} = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const portable = root => ({ mode: 'portable', root, profile: p.join(root, 'app-profile'), problem: null });
  const installed = () => ({ mode: 'installed', root: null, profile: null, problem: null });

  // Explicit choices (tests, advanced users) win over detection.
  const explicitPortable = argument(argv, 'portable-data-dir');
  if (explicitPortable) return portable(p.resolve(explicitPortable));
  if (env.SLOTFORGE_DATA_DIR) {
    const root = p.resolve(env.SLOTFORGE_DATA_DIR);
    return { mode: 'custom', root, profile: p.join(root, 'app-profile'), problem: null };
  }
  if (!packaged) return installed();

  if (platform === 'win32' && env.PORTABLE_EXECUTABLE_DIR)
    return portable(p.join(env.PORTABLE_EXECUTABLE_DIR, PORTABLE_FOLDER));
  if (platform === 'linux' && env.APPIMAGE) return portable(p.join(p.dirname(env.APPIMAGE), PORTABLE_FOLDER));
  if (platform === 'darwin') {
    const bundle = macBundle(execPath);
    if (!bundle) return installed();
    const applications = ['/Applications/', p.join(user, 'Applications') + '/'];
    if (applications.some(prefix => bundle.startsWith(prefix))) return installed();
    const result = portable(p.join(p.dirname(bundle), PORTABLE_FOLDER));
    if (bundle.includes('/AppTranslocation/')) {
      result.problem =
        'macOS is running SlotForge Foundry from a temporary read-only copy.\n\n' +
        'To install it: drag SlotForge Foundry into your Applications folder.\n' +
        'To use it portably: move the folder that contains SlotForge Foundry to another place with Finder (for example Documents or a USB drive), then open it again.';
    } else if (bundle.startsWith('/Volumes/') && bundle.split('/').length <= 4) {
      result.problem =
        'SlotForge Foundry is running directly from its disk image.\n\n' +
        'Drag SlotForge Foundry into your Applications folder, eject the disk image, and open it from Applications.';
    }
    return result;
  }
  return installed();
}

module.exports = { resolve, macBundle, PORTABLE_FOLDER };
