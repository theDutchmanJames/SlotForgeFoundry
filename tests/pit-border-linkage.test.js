import assert from 'node:assert/strict';
import test from 'node:test';
import init from 'manifold-3d';
import { buildTrack, defaultTrack } from '../src/track.js';
import { specialTrackParams } from '../src/special-pieces.js';

const wasm = await init();
wasm.setup();

function pit(hand, type, station) {
  const side = hand === 'left' ? 'outer' : 'inner';
  const p = specialTrackParams('pit', defaultTrack());
  return {
    ...p, clipType: type, joint: 'none', borderSide: side,
    borderMount: 'clips', borderJoint: 'none',
    borderEntry: 45, borderApex: 45, borderExit: 45,
    special: { ...p.special, side: hand },
    placements: { [side + 'SideClips']: [station, 0.65] },
  };
}

function build(p) {
  const parts = buildTrack(wasm, p);
  try {
    assert.ok(parts.filter(part => part.role === 'retainer').length >= 2);
  } finally {
    parts.forEach(part => part.solid.delete());
  }
}

// The centred dovetail keeper crosses the rod at 17.18%. Carrera's two
// keepers flank the channel there, and the raised fork clears it vertically.
// Moving 4.32 mm along the piece reverses which connector family fits.
for (const [hand, family, blocked, clear] of [
  ['left', 'draw-key', 0.1718, 0.179],
  ['right', 'carrera', 0.179, 0.1718],
]) {
  test(hand + ' pit checks fitted ' + family + ' hardware through pushrod travel', () => {
    const p = pit(hand, family, blocked);
    const side = hand === 'left' ? 'outer' : 'inner';
    assert.throws(() => build(p), error => {
      assert.match(error.warning.location, /border attachment 1.*clip 1/i);
      assert.match(error.warning.reason, /keeper.*pushrod/i);
      assert.match(error.warning.reason, new RegExp(Number((blocked * 100).toFixed(2)) + '%'));
      assert.equal(error.warning.setting.field, 'place_' + side + 'SideClips');
      return true;
    });
    build(pit(hand, family, clear));
  });
}

test('a border-end keeper over the channel points to a working seam adjustment', () => {
  const p = { ...pit('left', 'draw-key', 0.25), borderMount: 'none', borderJoint: 'clips' };
  assert.throws(() => build({ ...p, borderSegments: 6 }), error => {
    assert.equal(error.warning.location, 'Outside border seam 1 · clip 1');
    assert.equal(error.warning.setting.field, 'borderSegments');
    return true;
  });
  build({ ...p, borderSegments: 5 });
});
