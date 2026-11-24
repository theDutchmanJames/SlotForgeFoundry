import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { validatePitMotorSettings } from '../src/geometry/pit-motor-settings.js';
import { pitActuatorSpec } from '../src/geometry/pit-turnout.js';
import { pitLayout, validateSpecialJunction } from '../src/geometry/special-junction-layout.js';
import { specialTrackParams } from '../src/special-pieces.js';
import { buildTrack, defaultTrack } from '../src/track.js';

const wasm = await Module();
wasm.setup();

// A pit whose crank is worked from outside the piece, by a pushrod in its eye.
function remotePit(special = {}) {
  const p = specialTrackParams('pit', {
    ...defaultTrack(), width: 200, laneSpacing: 100, height: 12, slotDepth: 7,
  });
  Object.assign(p.special, { motorMount: false, eyeDiameter: 1.9, rodDiameter: 1.2, side: 'both' }, special);
  return p;
}

// Measure the bore in the generated triangles.
function hole(crank, [x, y]) {
  const z = crank.boundingBox().min[2] + 0.75;
  const walls = [[-4, 0], [4, 0], [0, -4], [0, 4]].map(([dx, dy]) => {
    const [hit] = crank.rayCast([x, y, z], [x + dx, y + dy, z]);
    assert.ok(hit, 'the lateral ray must hit the wall of the linkage hole');
    return hit.position[dx ? 0 : 1];
  });
  return { width: walls[1] - walls[0], height: walls[3] - walls[2] };
}

test('a remote crank accepts a custom hole without altering its existing lever length', () => {
  const p = remotePit({ eyeDiameter: 2.6, side: 'left' });
  const [fork] = pitLayout(p).forks, spec = pitActuatorSpec(p, fork);
  assert.doesNotThrow(() => validateSpecialJunction(p));
  assert.equal(spec.crankRadius, 12);
  const parts = buildTrack(wasm, p);
  try {
    const crank = parts.find(part => part.role === 'turnoutArm');
    const bore = hole(crank.solid, [fork.heel[0] + 12, fork.heel[1]]);
    assert.ok(Math.abs(bore.width - 2.6) < 0.012);
    assert.ok(Math.abs(bore.height - 2.6) < 0.012);
    // The eye is drawn as a guide, and no slider or motor cradle is made.
    assert.ok(crank.crankGuide);
    assert.equal(parts.some(part => ['turnoutSlider', 'motorMount'].includes(part.role)), false);
  } finally { parts.forEach(part => part.solid.delete()); }
});

test('the lever of a remote crank is the same whatever motor was once entered', () => {
  const plain = remotePit({ side: 'left' }),
    leftover = remotePit({ side: 'left', motorStroke: 9, motorLength: 40, motorWidth: 20 });
  const fork = (p) => pitLayout(p).forks[0];
  assert.deepEqual(pitActuatorSpec(leftover, fork(leftover)).mainEye, pitActuatorSpec(plain, fork(plain)).mainEye);
  assert.doesNotThrow(() => validateSpecialJunction(leftover));
});

test('pin fit and floor thickness give specific errors for a remote crank', () => {
  assert.throws(() => validatePitMotorSettings(remotePit({ eyeDiameter: 1.3 }).special), /0.15 mm larger/);
  const deep = remotePit({ eyeDiameter: 2.8, rodDiameter: 2 });
  deep.slotDepth = deep.height - 2.5;
  assert.throws(() => validateSpecialJunction(deep), /2.85 mm under the guide/);
  // With a motor the eye is the plunger's, and no pushrod has to fit it.
  assert.doesNotThrow(() => validatePitMotorSettings(remotePit({ motorMount: true, eyeDiameter: 1.3 }).special));
  assert.throws(() => validatePitMotorSettings(remotePit({ motorMount: true, motorHeight: NaN }).special), /Motor height/);
});
