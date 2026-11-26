// The Start from list: every standard building in one group, each with its thumbnail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { BUILDING_PRESETS, PRESET_GROUPS } from '../src/building-presets.js';

test('every standard building is in exactly one group, and every group has some', () => {
  const grouped = PRESET_GROUPS.flatMap(([, ids]) => ids);
  assert.deepEqual([...grouped].sort(), BUILDING_PRESETS.map((p) => p.id).sort());
  assert.equal(new Set(grouped).size, grouped.length, 'none twice');
  for (const [title, ids] of PRESET_GROUPS) assert.ok(ids.length > 0, title);
});

test('every standard building has its thumbnail, small (scripts/preset-thumbnails.mjs makes them)', () => {
  for (const p of BUILDING_PRESETS) {
    const file = new URL('../src/assets/presets/' + p.id + '.webp', import.meta.url);
    assert.ok(existsSync(file), p.id + ' has no thumbnail: run node scripts/preset-thumbnails.mjs ' + p.id);
    assert.ok(statSync(file).size < 20000, p.id + ' thumbnail is small');
  }
});
