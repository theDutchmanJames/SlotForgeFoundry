// The colours each standard building starts in: a set for every one, by
// material unless it has plain walls of a colour of its own.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILDING_PRESETS, presetColours } from '../src/building-presets.js';
import { COLOUR_SETS, checkColours, setColours } from '../src/building-colours.js';

test('every standard building starts in a colour set that exists', () => {
  const sets = new Set(COLOUR_SETS.map(([id]) => id));
  for (const p of BUILDING_PRESETS) {
    const c = presetColours(p.id);
    assert.ok(sets.has(c.set), p.id + ': ' + c.set);
    assert.deepEqual(checkColours(c), c, p.id);
  }
});

test('brick and planks by material; pits in team colours, marshal posts orange; New building by material', () => {
  assert.equal(presetColours('hut-brick').set, 'material');
  assert.equal(presetColours('timber-cottage').set, 'material');
  assert.equal(presetColours('pit-row-modern').set, 'racing');
  assert.equal(presetColours('marshal-shelter').set, 'marshal');
  assert.deepEqual(presetColours(undefined), setColours('material'));
  assert.deepEqual(presetColours('no-such-building'), setColours('material'));
});

test('every building named for a colour set is a standard building, named once', async () => {
  const { COLOURED } = await import('../src/building-presets.js');
  const ids = new Set(BUILDING_PRESETS.map((p) => p.id));
  const named = Object.values(COLOURED).flat();
  for (const id of named) assert.ok(ids.has(id), id);
  assert.equal(new Set(named).size, named.length);
});
