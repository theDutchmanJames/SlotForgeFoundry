'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolve, macBundle, PORTABLE_FOLDER } = require('./data-location.cjs');

test('installed copies use Electron’s own folder', () => {
  for (const platform of ['win32', 'linux', 'darwin'])
    assert.equal(
      resolve({ platform, env: {}, argv: [], execPath: '/Applications/SlotForge Foundry.app/Contents/MacOS/x' }).mode,
      'installed',
    );
  assert.equal(resolve({ platform: 'win32', env: {}, argv: [], packaged: false }).profile, null);
});

test('the Windows portable app keeps its data beside the program', () => {
  const where = resolve({ platform: 'win32', env: { PORTABLE_EXECUTABLE_DIR: 'E:\\Apps' }, argv: [] });
  assert.equal(where.mode, 'portable');
  assert.equal(where.profile, 'E:\\Apps\\' + PORTABLE_FOLDER + '\\app-profile');
});

test('an AppImage keeps its data beside the AppImage', () => {
  const where = resolve({ platform: 'linux', env: { APPIMAGE: '/media/usb/SlotForgeFoundry.AppImage' }, argv: [] });
  assert.equal(where.profile, '/media/usb/' + PORTABLE_FOLDER + '/app-profile');
});

test('a Mac copy outside Applications is portable, and a translocated or mounted copy is refused', () => {
  const docs = resolve({ platform: 'darwin', env: {}, argv: [], user: '/Users/j', execPath: '/Users/j/Documents/SlotForge Foundry.app/Contents/MacOS/SlotForge Foundry' });
  assert.equal(docs.mode, 'portable');
  assert.equal(docs.problem, null);
  assert.equal(resolve({ platform: 'darwin', env: {}, argv: [], user: '/Users/j', execPath: '/Users/j/Applications/SlotForge Foundry.app/Contents/MacOS/x' }).mode, 'installed');
  assert.match(resolve({ platform: 'darwin', env: {}, argv: [], execPath: '/private/var/folders/x/AppTranslocation/y/d/SlotForge Foundry.app/Contents/MacOS/x' }).problem, /temporary read-only copy/);
  assert.match(resolve({ platform: 'darwin', env: {}, argv: [], execPath: '/Volumes/SlotForge Foundry/SlotForge Foundry.app/Contents/MacOS/x' }).problem, /disk image/);
  assert.equal(macBundle('/x/A.app/Contents/MacOS/A'), '/x/A.app');
});

test('an explicit data folder wins, also in development', () => {
  assert.equal(resolve({ platform: 'linux', env: {}, argv: ['--portable-data-dir=/tmp/qa'], packaged: false }).profile, '/tmp/qa/app-profile');
  assert.equal(resolve({ platform: 'linux', env: { SLOTFORGE_DATA_DIR: '/tmp/d' }, argv: [] }).mode, 'custom');
});
