import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSettings, readSettingsForm, PRINTERS, DEFAULT_SETTINGS } from '../src/settings.js';

test('settings fall back to defaults field by field', () => {
  assert.deepEqual(cleanSettings(null), DEFAULT_SETTINGS);
  const s = cleanSettings({ printer: 'nope', plate: { width: 'x', depth: 300, margin: 4 }, infill: 500 });
  assert.equal(s.printer, 'custom');
  assert.deepEqual(s.plate, { width: 200, depth: 300, margin: 4 });
  assert.equal(s.infill, DEFAULT_SETTINGS.infill);
});

test('a margin that would leave no plate is dropped', () => {
  assert.equal(cleanSettings({ plate: { width: 20, depth: 20, margin: 10 } }).plate.margin, 0);
});

test('choosing a printer fills the plate; editing the plate makes it custom', () => {
  const form = (values) => ({
    elements: Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { value }])),
  });
  const base = {
    printer: 'bambu-a1',
    width: 200,
    depth: 200,
    margin: 0,
    material: 'pla',
    infill: 100,
    spoolPrice: 0,
    braidSpare: 50,
  };
  const picked = readSettingsForm(form(base), DEFAULT_SETTINGS, 'printer');
  const a1 = PRINTERS.find((p) => p.id === 'bambu-a1');
  assert.deepEqual(picked.plate, { width: a1.width, depth: a1.depth, margin: 0 });
  const edited = readSettingsForm(form({ ...base, width: 240 }), picked, 'width');
  assert.equal(edited.printer, 'custom');
  assert.equal(edited.plate.width, 240);
  // A cleared field keeps the last value instead of a factory default or zero.
  const cleared = readSettingsForm(form({ ...base, width: '', margin: '', braidSpare: '' }), { ...edited, braidSpare: 80 }, 'width');
  assert.equal(cleared.plate.width, 240);
  assert.equal(cleared.plate.margin, 0);
  assert.equal(cleared.braidSpare, 80);
});
