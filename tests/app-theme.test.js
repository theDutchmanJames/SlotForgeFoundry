import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THEMES,
  PALETTES,
  read,
  fromURL,
  toneOf,
  problems,
  paletteOf,
  onAccent,
} from '../src/app-theme.js';

test('the eight SlotForge presets and Custom, each preset with six colours', () => {
  assert.deepEqual(
    THEMES.map(([id]) => id),
    ['dark', 'light', 'midnight', 'forest', 'sunset', 'violet', 'carbon', 'ocean', 'custom'],
  );
  for (const [id] of THEMES.filter(([id]) => id !== 'custom'))
    assert.equal(Object.keys(PALETTES[id]).length, 6, id);
});

test('reads Circuit’s saved theme and Foundry’s old light/dark key', () => {
  assert.deepEqual(read('light'), { theme: 'light', customColors: null });
  assert.deepEqual(read(JSON.stringify({ theme: 'violet' })), { theme: 'violet', customColors: null });
  assert.deepEqual(read('not json'), { theme: 'dark', customColors: null });
  assert.deepEqual(read({ theme: 'nope' }), { theme: 'dark', customColors: null });
  const own = read({ theme: 'custom', customColors: { accent: '#ABC', bg: 'red' } });
  assert.equal(own.customColors.accent, '#aabbcc');
  assert.equal(own.customColors.bg, PALETTES.dark.bg, 'a bad colour falls back');
});

test('a link from another app brings its theme along', () => {
  assert.deepEqual(fromURL(new URL('file:///x.html?sfTheme=forest')), { theme: 'forest' });
  assert.equal(fromURL(new URL('file:///x.html?sfTheme=custom')), null);
  const custom = fromURL(new URL('file:///x.html?sfTheme=custom&sfColors=000000,111111,eeeeee,999999,333333,ff0000'));
  assert.equal(custom.customColors.accent, '#ff0000');
  assert.equal(fromURL(new URL('file:///x.html')), null);
});

test('tone follows the preset, or the panel colour of your own', () => {
  assert.equal(toneOf({ theme: 'ocean' }), 'light');
  assert.equal(toneOf({ theme: 'carbon' }), 'dark');
  assert.equal(toneOf({ theme: 'custom', customColors: { ...PALETTES.light } }), 'light');
  assert.equal(toneOf({ theme: 'custom', customColors: null }), 'dark');
  assert.deepEqual(paletteOf({ theme: 'sunset' }), PALETTES.sunset);
});

test('warns about hard-to-read colours and picks readable accent text', () => {
  assert.deepEqual(problems(PALETTES.dark), []);
  assert.equal(problems({ ...PALETTES.dark, ink: '#222831' }).length, 1);
  assert.equal(onAccent('#ffd400'), '#000000');
  assert.equal(onAccent('#c92424'), '#ffffff');
});
