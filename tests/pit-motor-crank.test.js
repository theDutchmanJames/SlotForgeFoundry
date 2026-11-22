import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { pitBraidLayout } from '../src/geometry/pit-braids.js';
import { pitMotorMountLayout } from '../src/geometry/pit-motor-mount.js';
import { validatePitMotorSettings } from '../src/geometry/pit-motor-settings.js';
import { pitActuatorSpec, pitMotorXBounds } from '../src/geometry/pit-turnout.js';
import { SolidWorkshop } from '../src/geometry/solids.js';
import { pitLayout, pitPrintPath, validateSpecialJunction } from '../src/geometry/special-junction-layout.js';
import { specialTrackParams } from '../src/special-pieces.js';
import { buildTrack, defaultTrack } from '../src/track.js';

const wasm = await Module();
wasm.setup();

function motorPit(special = {}) {
  const p = specialTrackParams('pit', {
    ...defaultTrack(), width: 200, laneSpacing: 100, height: 12, slotDepth: 7,
  });
  Object.assign(p.special, { motorMount: true, motorStroke: 3, eyeDiameter: 1.9,
    rodDiameter: 1.2, side: 'both' }, special);
  return p;
}

// Measure the bore in the generated triangles. On a push the pin rides the
// far wall of the eye, then on a pull it rides the opposite wall.
function hole(crank, [x, y]) {
  const z = crank.boundingBox().min[2] + 0.75;
  const walls = [[-4, 0], [4, 0], [0, -4], [0, 4]].map(([dx, dy]) => {
    const [hit] = crank.rayCast([x, y, z], [x + dx, y + dy, z]);
    assert.ok(hit, 'the lateral ray must hit the wall of the linkage hole');
    return hit.position[dx ? 0 : 1];
  });
  return { x: (walls[0] + walls[1]) / 2, width: walls[1] - walls[0],
    yMin: walls[2], yMax: walls[3], height: walls[3] - walls[2] };
}

test('the actual hole takes the chosen pushrod to both blade stops within its usable stroke on either hand', () => {
  const p = motorPit(), stops = new Map();
  for (const position of ['main', 'pit']) {
    p.special.turnoutPosition = position;
    const raw = pitLayout(p);
    const parts = buildTrack(wasm, p);
    try {
      for (const [i, fork] of raw.forks.entries()) {
        const arm = parts.find(part => part.id === 'pit-crank-' + fork.side);
        const crank = parseSTL(wasm, encodeSTL(arm.solid));
        try {
          const mount = pitMotorMountLayout(p, fork, raw.lanePaths[p.lanes + i]);
          const drive = mount.drive, diverted = position === 'pit';
          const bore = hole(crank, diverted ? drive.pitEye : drive.mainEye);
          for (const measured of [bore.width, bore.height])
            assert.ok(Math.abs(measured - p.special.eyeDiameter) < 0.012, 'actual printed bore diameter');
          const pin = fork.sign * (diverted ? 1 : -1) > 0
            ? bore.yMax - p.special.rodDiameter / 2 : bore.yMin + p.special.rodDiameter / 2;
          assert.ok(Math.abs(mount.rodPath[0][1] - pin) < 0.01, 'the linkage drawing must contact the hole wall');
          if (diverted) {
            const main = stops.get(fork.side);
            assert.ok(Math.abs(main.x - bore.x) < 0.01, 'both crank stops must align with the motor shaft');
            assert.ok(Math.abs(Math.abs(pin - main.pin) - p.special.motorStroke) < 0.012,
              'pin travel between the printed contact surfaces must use the entered motor stroke');
          } else {
            stops.set(fork.side, { x: bore.x, pin });
          }
        } finally { crank.delete(); }
      }
    } finally { parts.forEach(part => part.solid.delete()); }
  }
});

test('a remote crank accepts a custom hole without altering its existing lever length', () => {
  const p = motorPit({ motorMount: false, motorStroke: 0, eyeDiameter: 2.6, side: 'left' });
  const [fork] = pitLayout(p).forks, spec = pitActuatorSpec(p, fork);
  assert.doesNotThrow(() => validateSpecialJunction(p));
  assert.equal(spec.crankRadius, 12);
  const parts = buildTrack(wasm, p);
  try {
    const crank = parts.find(part => part.role === 'turnoutArm').solid;
    const bore = hole(crank, [fork.heel[0] + 12, fork.heel[1]]);
    assert.ok(Math.abs(bore.width - 2.6) < 0.012);
  } finally { parts.forEach(part => part.solid.delete()); }
});

test('the moving crank and full-diameter wire clear the assembled road throughout the throw', () => {
  const p = motorPit({ side: 'right', motorStroke: 4.5 });
  const raw = pitLayout(p), [fork] = raw.forks;
  const mount = pitMotorMountLayout(p, fork, raw.lanePaths[p.lanes]);
  const parts = buildTrack(wasm, p), work = new SolidWorkshop(wasm);
  try {
    const [hx, hy] = fork.heel;
    const roads = work.union(parts.filter(part => part.role === 'road').map(part => part.solid));
    const arm = parts.find(part => part.role === 'turnoutArm').solid;
    const centred = work.own(arm.translate([-hx, -hy, 0]));
    const { drive } = mount;
    for (let step = 0; step <= 10; step++) {
      const t = step / 10;
      const angle = fork.swing * t, theta = angle - fork.swing / 2;
      const rotated = work.own(centred.rotate([0, 0, angle * 180 / Math.PI]));
      const installed = work.own(rotated.translate([hx, hy, 0]));
      assert.ok(work.and(installed, roads).volume() < 0.001, 'crank must clear the printable stock');
      const x = hx + drive.crankRadius * Math.cos(theta);
      const y = hy + drive.crankRadius * Math.sin(theta) - fork.sign * drive.pinClearance / 2;
      const rodRadius = p.special.rodDiameter / 2;
      const wire = work.own(wasm.Manifold.cylinder(Math.abs(mount.rodEndY - y), rodRadius, rodRadius, 32));
      const sideways = work.own(wire.rotate([-fork.sign * 90, 0, 0]));
      const pushrod = work.own(sideways.translate([x, y, drive.rodCenterZ]));
      assert.ok(work.and(pushrod, roads).volume() < 0.001, 'a low wire can reach the motor at every crank angle');
      assert.ok(pushrod.boundingBox().min[2] > 0, 'the wire clears the table');
      assert.ok(work.and(pushrod, installed).volume() < 0.001, 'the horizontal wire clears the arm');
    }
  } finally {
    work.close();
    parts.forEach(part => part.solid.delete());
  }
});

test('pin fit, lost motion, pivot overlap and floor thickness give specific errors', () => {
  assert.throws(() => validatePitMotorSettings(motorPit({ eyeDiameter: 1.3 }).special), /0.15 mm larger/);
  assert.throws(() => validateSpecialJunction(motorPit({ motorStroke: 0.5 })), /taken up by clearance/);
  assert.throws(() => validateSpecialJunction(motorPit({ motorStroke: 1 })), /overlap the pivot/);
  assert.throws(() => validateSpecialJunction(motorPit({ motorHeight: NaN })), /Motor height/);
  const deep = motorPit({ eyeDiameter: 2.8, rodDiameter: 2, motorStroke: 2 });
  deep.slotDepth = deep.height - 2.5;
  assert.throws(() => validateSpecialJunction(deep), /2.85 mm under the guide/);
  const reachesSlot = motorPit({ side: 'right', motorStroke: 4, rodDiameter: 1, eyeDiameter: 1.6 });
  Object.assign(reachesSlot, { height: 10, slotDepth: 8 });
  assert.throws(() => buildTrack(wasm, reachesSlot), /crank sweep reaches the guide slot.*4 mm under the guide/);
  reachesSlot.special.motorStroke = 5;
  reachesSlot.slotDepth = 6;
  assert.throws(() => buildTrack(wasm, reachesSlot), /pushrod fastener.*4\.8 mm under the guide/);
});

test('long strokes reserve room for the tray and jumpers without shortening either live island', () => {
  const p = motorPit({ motorStroke: 6 });
  p.segments = 4;
  const raw = pitLayout(p), braids = pitBraidLayout(p, raw);
  const off = { ...p, special: { ...p.special, motorMount: false } };
  const original = pitBraidLayout(off, raw);
  assert.deepEqual(braids.conductors.map(rail => rail.points), original.conductors.map(rail => rail.points));
  const [fork] = raw.forks, bounds = pitMotorXBounds(p, fork);
  const feeds = braids.jumpers.filter(wire => wire.from[0] < 0);
  assert.ok(feeds.length >= 2);
  assert.ok(feeds.every(wire => wire.from[0] - wire.wireWidth / 2 > bounds.max));
  assert.ok(feeds.some(wire => wire.from[0] > original.jumpers[0].from[0] + 5));
  const path = pitPrintPath(raw.path, raw.forks, p, braids);
  for (const t of path.cuts.slice(1, -1)) {
    const x = (t - 0.5) * p.length;
    assert.ok(x < bounds.min || x > braids.protectedEndX, 'no road seam can divide the motor or its jumper');
  }
});
