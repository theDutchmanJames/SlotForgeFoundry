import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { pitLayout } from '../src/geometry/special-junction-layout.js';
import { laneTools } from '../src/geometry/import-track.js';
import { pitActuatorSpec } from '../src/geometry/pit-turnout.js';
import { SolidWorkshop } from '../src/geometry/solids.js';
import { printableSTL } from '../src/kit.js';
import { specialTrackParams } from '../src/special-pieces.js';
import { buildTrack, defaultTrack } from '../src/track.js';

const wasm = await Module();
wasm.setup();

// Linear interpolation follows the actual faceted slot path. The branch and
// main lane share the same incoming straight before the branch's first point.
function lateralAt(route, x) {
  const i = route.findIndex(([station]) => station > x);
  if (i === -1) return route.at(-1)[1];
  if (i === 0) return route[0][1];
  const [a, b] = [route[i - 1], route[i]];
  return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
}

function box(work, x0, y0, x1, y1) {
  return work.section([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]);
}

function reassemblePrinted(work, part, project, throwAngle = 0) {
  const bytes = printableSTL(part, encodeSTL, undefined, project);
  const fromPlate = work.own(parseSTL(wasm, bytes));
  const upright = work.own(fromPlate.rotate([
    ['road', 'border', 'turnoutBearing'].includes(part.role) ? 180 : 0, 0, throwAngle * 180 / Math.PI,
  ]));
  const installed = part.solid.boundingBox().min;
  const printed = upright.boundingBox().min;
  return work.own(upright.translate(installed.map((coordinate, axis) => coordinate - printed[axis])));
}

test('the pit-side rod clears the full solid roadway and attached border on a taller track', () => {
  const p = specialTrackParams('pit', {
    ...defaultTrack(), hollow: false, width: 200, laneSpacing: 100, height: 12, slotDepth: 7,
  });
  Object.assign(p, { borderSide: 'both', borderEntry: 30, borderApex: 35, borderExit: 30 });
  p.special.side = 'right';
  const fork = pitLayout(p).forks[0];
  const parts = buildTrack(wasm, p);
  const work = new SolidWorkshop(wasm);
  try {
    const project = { mode: 'track', track: { params: p } };
    assert.ok(parts.some(part => part.role === 'border'));
    const track = work.union(parts.filter(part => ['road', 'border', 'turnoutBearing'].includes(part.role))
      .map(part => reassemblePrinted(work, part, project)));
    const bounds = track.boundingBox();
    const [x, y] = fork.heel;
    const outside = fork.sign > 0 ? bounds.max[1] + 1 : bounds.min[1] - 1;
    for (const angle of [0, fork.swing / 2, fork.swing]) {
      const ex = x + 12 * Math.cos(angle), ey = y + 12 * Math.sin(angle);
      const channel = box(work, ex - 0.5, Math.min(outside, ey), ex + 0.5, Math.max(outside, ey));
      const rod = work.prism(channel, 0.2, 1.2);
      assert.ok(work.and(rod, track).volume() < 0.001, 'the actuator rod must pass through the outside border');
      assert.ok(work.and(work.prism(channel, 1.5, 1.6), track).volume() > 2,
        'the rod should have a recess under the actual road and shoulder');
    }
    const arm = parts.find(part => part.role === 'turnoutArm');
    const blade = parts.find(part => part.role === 'turnout');
    checkHeightStop(work, [track], blade.solid, arm.solid, fork, p);
    checkDriveMechanism(work, [track], arm.solid, blade.solid, fork, p);
  } finally {
    work.close();
    parts.forEach(part => part.solid.delete());
  }
});

function checkGuidePassage(work, assembled, p, route, start, end) {
  // Model a rigid 10 mm-long guide flag, oriented on the chord joining its
  // ends. Its width leaves 0.4 mm on each side in the straight approach.
  const flag = box(work, -5, -(p.slotWidth - 0.8) / 2, 5, (p.slotWidth - 0.8) / 2);
  const positions = [];
  for (let x = start; x <= end; x += 0.5) {
    const angle = Math.atan2(lateralAt(route, x + 5) - lateralAt(route, x - 5), 10);
    const oriented = work.own(flag.rotate(angle * 180 / Math.PI));
    positions.push(work.own(oriented.translate([x, lateralAt(route, x)])));
  }
  const swept = work.own(wasm.CrossSection.union(positions));
  const gauge = work.prism(swept, p.height - p.slotDepth + 0.4, p.height - 0.15);
  const collision = work.and(assembled, gauge).volume();
  assert.ok(collision < 0.001,
    `the road or flipper intersects ${collision.toFixed(3)} mm³ of the selected guide sweep`);
}

function checkBladeInsertion(work, roads, blade, fork, p) {
  const centered = work.own(blade.translate([-fork.heel[0], -fork.heel[1], 0]));
  const midThrow = work.own(centered.rotate([0, 0, fork.swing * 90 / Math.PI]));
  const tongue = work.own(midThrow.translate([...fork.heel, 0]));
  const { min, max } = tongue.boundingBox();
  const window = box(work, min[0] - 1, min[1] - 1, max[0] + 1, max[1] + 1);
  const housing = work.and(work.union(roads), work.prism(window, 0, p.height));
  // Use the real 3D tongue at each height. Its upper flank can overhang a
  // lower receiver, so a full-height extrusion of its outline is too large.
  for (let dz = 0; min[2] + dz < p.height; dz += 0.15) {
    const raised = work.own(tongue.translate([0, 0, dz]));
    const collision = work.and(housing, raised).volume();
    assert.ok(collision < 0.001,
      `${collision.toFixed(3)} mm³ of stock obstructs blade insertion at ${dz.toFixed(2)} mm lift`);
  }
}

function checkWrongBranchClosed(work, assembled, fork, p, routes, start, end, pitOpen) {
  const outside = lateralAt(routes.pit, end);
  const main = lateralAt(routes.main, end);
  const margin = p.slotWidth + 3;
  const window = box(work, start - 2, Math.min(outside, main) - margin,
    end + 2, Math.max(outside, main) + margin);
  const inlet = box(work, start - 0.1, main - 0.1, start + 0.1, main + 0.1);
  const outlets = [main, outside].map(y => box(work, end - 0.1, y - 0.1, end + 0.1, y + 0.1));
  // The guide steers below the braid shelves. Air above a bare shelf is
  // filled by the fitted braid and is not an alternative driving route.
  const high = p.height - p.braidDepth - 0.10;
  const low = p.height - p.slotDepth + 0.32;
  for (const z of [high, (low + high) / 2, low]) {
    const material = work.own(assembled.slice(z));
    const space = work.own(window.subtract(material));
    // A point could sneak through the running clearance beside the hinge or
    // nose. Erode the void by half a 1 mm guide's width before asking which
    // outlet the guide can physically reach from upstream.
    const available = work.own(space.offset(-0.5, 'Round'));
    const channels = available.decompose().map(section => work.own(section));
    const contains = (channel, probe) => work.own(channel.intersect(probe)).area() > 0.035;
    const channel = channels.find(c => contains(c, inlet));
    assert.ok(channel, 'the incoming slot must be open');
    const reached = outlets.map(probe => contains(channel, probe));
    assert.deepEqual(reached, [!pitOpen, pitOpen],
      `${fork.side} pit open=${pitOpen}, ${(p.height - z).toFixed(2)} mm below the road`);
  }
}

function checkCrownProfile(blade, fork, p) {
  const [hx, hy] = fork.heel;
  const top = (x, y) => blade.rayCast([x, y, p.height + 1], [x, y, -1])[0]?.position[2];
  // A solid crown covers the full rotating hub, including its centreline.
  for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, 1], [0, -1]])
    assert.ok(Math.abs(top(hx + dx, hy + dy) - p.height) < 0.002, 'the hinge crown must be flush with the road');

  // Scan the actual printed top across the tongue. Find its centre at each
  // station independently of the profile used to generate the STL.
  const outline = fork.outline;
  const heights = [];
  for (let x = fork.mainToe[0] + 0.2; x < hx - 2; x += 0.1) {
    const ys = [];
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length];
      if ((a[0] <= x && b[0] > x) || (b[0] <= x && a[0] > x))
        ys.push(a[1] + (x - a[0]) * (b[1] - a[1]) / (b[0] - a[0]));
    }
    assert.equal(ys.length, 2, 'the tongue must have two guiding faces');
    const z = top(x, (ys[0] + ys[1]) / 2);
    assert.ok(Number.isFinite(z), 'a continuous upper face must connect nose and crown');
    heights.push(z);
  }
  const nose = heights[0], rise = p.height - nose;
  assert.ok(rise > 0.5, 'the tip must tuck under the fixed lip');
  assert.ok(Math.abs(heights.at(-1) - p.height) < 0.002, 'the curved rise must reach the level crown');
  const slopes = heights.slice(1).map((z, i) => (z - heights[i]) / 0.1);
  assert.ok(Math.min(...slopes) > -0.002, 'the lead-in must rise monotonically');
  // Compare gradients *inside* the rise: a single planar chamfer has the
  // same gradient in all three bands even if its adjacent flats are long.
  function meanSlope(lower, upper) {
    const band = slopes.filter((_, i) => {
      const fraction = ((heights[i] + heights[i + 1]) / 2 - nose) / rise;
      return fraction >= lower && fraction <= upper;
    });
    assert.ok(band.length >= 2, 'the STL must resolve the curved transition');
    return band.reduce((sum, s) => sum + s, 0) / band.length;
  }
  const middle = meanSlope(0.4, 0.6);
  assert.ok(meanSlope(0.015, 0.10) < 0.85 * middle, 'the slope must ease away from the tucked nose');
  assert.ok(meanSlope(0.9, 0.985) < 0.85 * middle, 'the slope must ease into the road surface');
}

function rotateAboutHeel(work, solid, fork, radians) {
  const [x, y] = fork.heel;
  const centred = work.own(solid.translate([-x, -y, 0]));
  const rotated = work.own(centred.rotate([0, 0, radians * 180 / Math.PI]));
  return work.own(rotated.translate([x, y, 0]));
}

for (const [description, mounted, custom] of [
  // A motor works a pin on the crank through a slider: see pit-drive.test.js.
  ['external', false, false], ['custom external', false, true],
]) {
  test(`exported crank tab and pushrod head have running clearance throughout a mirrored ${description} pit`, () => {
    const p = specialTrackParams('pit', {
      ...defaultTrack(), width: 200, laneSpacing: 100, hollow: !custom, segments: 3,
      height: custom ? 12 : 10, slotDepth: custom ? 7 : 8,
    });
    Object.assign(p.special, { side: 'both', motorMount: mounted });
    if (custom) Object.assign(p.special, { motorStroke: 3, eyeDiameter: 2.4, rodDiameter: 1.2 });
    const layout = pitLayout(p);
    const parts = buildTrack(wasm, p), work = new SolidWorkshop(wasm);
    try {
      const project = { mode: 'track', track: { params: p } };
      const printed = new Map(parts.filter(part =>
        ['road', 'turnout', 'turnoutArm', 'turnoutBearing', 'motorMount'].includes(part.role),
      ).map(part => [part.id, reassemblePrinted(work, part, project)]));
      for (const fork of layout.forks) {
        const drive = pitActuatorSpec(p, fork);
        const [hx, hy] = fork.heel, [ex, ey] = drive.mainEye;
        const arm = printed.get('pit-crank-' + fork.side);
        const blade = printed.get('pit-blade-' + fork.side);
        // This ray starts beside the printed hole, on the flat top of the arm.
        const top = arm.rayCast([ex + drive.eyeDiameter / 2 + 0.25, ey, p.height + 1],
          [ex + drive.eyeDiameter / 2 + 0.25, ey, 0])[0].position[2];
        const bottom = arm.boundingBox().min[2];
        const radius = Math.hypot(ex - hx, ey - hy);
        const window = work.prism(box(work, hx - 4, hy - radius - 6, hx + radius + 6, hy + radius + 6), 0, p.height);
        const fixed = work.union(parts.filter(part => ['road', 'turnoutBearing', 'motorMount'].includes(part.role))
          .map(part => work.and(printed.get(part.id), window)));
        // Gauge the full mobile tab from hub to eye, allowing for STL faceting.
        const tab = work.own(arm.slice((top + bottom) / 2));
        const outline = work.own(tab.offset(0.57, 'Round', 2, 40));
        const tabGauge = work.prism(outline, bottom, top + 0.58);
        // Size the gauge independently of the generated pocket. A loose
        // pushrod can shift the centre of its head to either side of the eye.
        const headDiameter = Math.max(p.special.rodDiameter + 2, p.special.eyeDiameter + 1);
        const eccentricity = (p.special.eyeDiameter - p.special.rodDiameter) / 2;
        const headRadius = headDiameter / 2 + eccentricity + 0.23;
        const head = work.own(wasm.Manifold.cylinder(1.38, headRadius, headRadius, 64));
        const headGauge = work.own(head.translate([ex, ey, top]));
        // The blade and arm move together. Their relative clearance can
        // be checked in one pose. The road and motor cradle stay fixed.
        for (const [feature, gauge] of [['fastener head', headGauge], ['crank tab', tabGauge]]) {
          assert.ok(Math.abs(work.and(gauge, blade).volume()) < 0.001, 'the blade clears the ' + feature);
          for (let step = 0; step <= 16; step++) {
            const angle = fork.swing * step / 16;
            const installed = rotateAboutHeel(work, gauge, fork, angle);
            const overlap = Math.abs(work.and(installed, fixed).volume());
            assert.ok(overlap < 0.001, `${fork.side} pit at step ${step}/16, ${feature} meets ${overlap} mm³ of fixed stock`);
            assert.ok(installed.boundingBox().min[2] > 0, 'the arm and fitting stay above the table');
          }
        }
        for (const point of [drive.mainEye, drive.midEye, drive.pitEye]) {
          const [surface, ceiling] = fixed.rayCast([...point, p.height + 1], [...point, -1]);
          assert.ok(surface && ceiling, 'a roof covers the eye throughout its sweep');
          assert.ok(surface.position[2] - ceiling.position[2] >= p.deck - 0.01, 'the deck keeps its specified thickness');
          assert.ok(ceiling.position[2] >= top + 1.39, 'the head has at least 0.4 mm of overhead clearance');
        }
        const mainY = fork.mainGuide[0][1];
        for (const dx of [-2, 0, 2]) for (const dy of [-1, 0, 1]) {
          const xy = [ex + dx, mainY + dy];
          const hits = fixed.rayCast([...xy, p.height + 1], [...xy, -1]);
          assert.ok(Math.abs(hits[0].position[2] - (p.height - p.slotDepth)) < 0.002, 'guide floor stays at the set depth');
          assert.ok(hits[0].position[2] - hits[1].position[2] >= 0.59, 'printable stock remains below the guide');
        }
      }
    } finally { work.close(); parts.forEach(part => part.solid.delete()); }
  });
}

function checkBearingInsert(work, roads, part, bearing, fork, p, project) {
  const [x, y] = fork.heel;
  const housing = work.and(work.union(roads), work.prism(box(work, x - 12, y - 7, x + 5, y + 7), 0, p.height));
  const { min, max } = bearing.boundingBox();
  assert.ok(min[2] >= 0.24, 'the fixed peg clears the table');
  for (let lift = 0; min[2] + lift < p.height; lift += 0.2) {
    assert.ok(work.and(housing, work.own(bearing.translate([0, 0, lift]))).volume() < 0.001,
      'the whole insert must pass through the top of the road before the blade is installed');
  }
  assert.ok(work.and(housing, work.own(bearing.translate([0, 0, -0.10]))).volume() > 0.4,
    'the shoulder rests on the printed socket');
  assert.ok(work.and(housing, rotateAboutHeel(work, bearing, fork, Math.PI / 12)).volume() > 0.5,
    'the oblong peg keys the carrier against rotation');
  for (const dz of [0.1, 1.9]) {
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8, z = max[2] - dz;
      const [inner, outer] = bearing.rayCast([x, y, z], [x + 12 * Math.cos(a), y + 12 * Math.sin(a), z]);
      assert.ok(inner && outer);
      assert.ok(Math.abs(Math.hypot(inner.position[0] - x, inner.position[1] - y) - 2.18) < 0.01,
        'the printed bore clears the 4 mm shaft');
      assert.ok(Math.hypot(outer.position[0] - inner.position[0], outer.position[1] - inner.position[1]) > 1.23,
        'the deep-guide bearing wall surrounds the shaft at full thickness');
    }
  }
  const printed = work.own(parseSTL(wasm, printableSTL(part, encodeSTL, undefined, project)));
  assert.equal(printed.decompose().map(s => work.own(s)).length, 1);
  assert.ok(Math.abs(printed.boundingBox().min[2]) < 0.0001);
  let below = work.own(printed.slice(0.01));
  for (let z = 0.11; z < printed.boundingBox().max[2]; z += 0.1) {
    const layer = work.own(printed.slice(z));
    assert.ok(work.own(layer.subtract(below)).area() < 0.001,
      'every layer of the exported bearing has material directly beneath it');
    below = layer;
  }
}

test('the bearing foot follows a steep pit entry and preserves both guide floors', () => {
  for (const [height, slotDepth, side] of [[10, 8, 'left'], [12, 7, 'right']]) {
    const p = specialTrackParams('pit', { ...defaultTrack(), height, slotDepth, width: 200, laneSpacing: 100 });
    p.length = 500;
    Object.assign(p.special, { side, pitOffset: 110 });
    const parts = buildTrack(wasm, p), work = new SolidWorkshop(wasm);
    try {
      const layout = pitLayout(p), fork = layout.forks[0], [x, y] = fork.heel;
      const project = { mode: 'track', track: { params: p } };
      const bearing = reassemblePrinted(work, parts.find(part => part.role === 'turnoutBearing'), project);
      const blade = reassemblePrinted(work, parts.find(part => part.role === 'turnout'), project);
      const crank = reassemblePrinted(work, parts.find(part => part.role === 'turnoutArm'), project);
      const roads = work.union(parts.filter(part => part.role === 'road').map(part => reassemblePrinted(work, part, project)));
      const slotTools = laneTools(work, p, { lanes: layout.lanePaths, outlines: [] });
      const local = box(work, x - 11, y - 12, x + 3, y + 12);
      const guides = work.own(wasm.CrossSection.union(slotTools.map(([guide]) => guide)));
      const slots = work.own(guides.intersect(local));
      const floor = p.height - p.slotDepth;
      assert.ok(work.and(bearing, work.prism(slots, floor, p.height)).volume() < 0.001,
        'the bearing and its anchor stay outside the guide paths');
      // Measure away from mesh rounding at the slot walls.
      const skin = work.prism(work.own(slots.offset(-0.02)), floor - 0.55, floor - 0.02);
      assert.ok(work.cut(skin, [roads]).volume() < 0.001, 'the socket leaves stock under both slots');
      for (let lift = 0; lift < p.height; lift += 0.4)
        assert.ok(work.and(roads, work.own(bearing.translate([0, 0, lift]))).volume() < 0.001,
          'the bearing inserts from the road surface on the selected hand');
      const moving = work.union([crank, blade]);
      for (let step = 0; step <= 16; step++) {
        const posed = rotateAboutHeel(work, moving, fork, fork.swing * step / 16);
        assert.ok(work.and(bearing, posed).volume() < 0.001, 'the blade and crank clear the bearing through the throw');
      }
    } finally { work.close(); parts.forEach(part => part.solid.delete()); }
  }
});

function checkHeightStop(work, roads, blade, crank, fork, p) {
  const [x, y] = fork.heel;
  const atHinge = work.prism(box(work, x - 3.5, y - 3.5, x + 3.5, y + 3.5), 0, p.height);
  const bearing = work.and(work.union(roads), atHinge);
  const moving = work.union([blade, crank]);
  assert.ok(work.and(bearing, moving).volume() < 0.001, 'the seated flipper must turn freely');
  const settled = work.own(moving.translate([0, 0, -0.05]));
  assert.ok(work.and(bearing, settled).volume() > 0.045,
    'an anchored shoulder at the hinge must hold the blade flush under its own weight');
}

function checkDriveMechanism(work, roads, crank, blade, fork, p) {
  const [x, y] = fork.heel;
  const { min, max } = crank.boundingBox();
  assert.ok(min[2] > 1, 'the crank must leave underside clearance for a hooked wire');
  assert.ok(max[2] < p.height - 0.5, 'the drive shaft must end inside the blade');
  const bottomHit = dx => blade.rayCast([x + dx, y, -1], [x + dx, y, p.height + 1])[0]?.position[2];
  const pilotFloor = bottomHit(0.05), pilotMouth = bottomHit(0.94);
  const hardware = pitActuatorSpec(p, fork);
  assert.ok(p.height - pilotFloor >= 0.95, 'material must cover the blind fixing at the road surface');
  assert.ok(min[2] + hardware.screwMin >= pilotMouth + 1.49, 'the shortest recommended screw must engage the blade');
  assert.ok(min[2] + hardware.screwMax < pilotFloor - 0.1, 'the longest recommended screw must clear the blind end');
  assert.ok(hardware.screwMin <= hardware.screwMax, 'the supported fastener range must be usable');
  const housing = work.and(work.union(roads), work.prism(box(work, x - 18, y - 23, x + 19, y + 23), 0, p.height));
  assert.equal(housing.rayCast([x, y, -1], [x, y, p.height + 1]).length, 0, 'the through-bearing must be open');
  assert.ok(work.and(crank, blade).volume() < 0.001, 'the shaft must install fully');
  // Twist only the crank: true positive drive must encounter a keyed flank.
  // Restrict the check to the shaft so a collision at the rod arm cannot pass.
  const shaft = work.and(crank, work.prism(box(work, x - 2.4, y - 2.4, x + 2.4, y + 2.4), 3, max[2] + 1));
  const twisted = rotateAboutHeel(work, shaft, fork, Math.PI / 2);
  assert.ok(work.and(blade, twisted).volume() > 0.02, 'the shaft must transmit torque into the blade');

  const armTop = 2.8;
  const pin = work.own(wasm.Manifold.cylinder(armTop - 0.3, 0.5, 0.5, 32));
  const eyeRadius = 12;
  for (let step = 0; step <= 10; step++) {
    const angle = fork.swing * step / 10;
    const moving = rotateAboutHeel(work, crank, fork, angle);
    assert.ok(work.and(moving, housing).volume() < 0.001, 'the crank must clear its housing throughout the throw');
    const ex = x + eyeRadius * Math.cos(angle), ey = y + eyeRadius * Math.sin(angle);
    const wireEnd = work.own(pin.translate([ex, ey, 0.3]));
    const inside = work.own(moving.slice((min[2] + armTop) / 2));
    // The eye must both admit the hook and retain it under push or pull.
    for (const dx of [-1.25, 1.25]) {
      const flank = box(work, ex + dx - 0.08, ey - 0.08, ex + dx + 0.08, ey + 0.08);
      assert.ok(work.own(inside.intersect(flank)).area() > 0.023, 'the rod eye must have material on both sides');
    }
    const guide = box(work, ex - 0.5, Math.min(ey, ey + 12 * fork.sign),
      ex + 0.5, Math.max(ey, ey + 12 * fork.sign));
    const wire = work.union([wireEnd, work.prism(guide, 0.2, 1.2)]);
    assert.ok(work.and(wire, moving).volume() < 0.001, 'a 1 mm wire must fit the moving eye');
    assert.ok(work.and(wire, housing).volume() < 0.001, 'the rod must have a clear path under the road to the actuator');
  }
  // The keyed crank and fixing are fitted from beneath after inserting the
  // tongue from above. Obstructions outside the installed pose still matter.
  const fixed = work.union([housing, blade]);
  for (let dz = -0.25; max[2] + dz > 0; dz -= 0.25) {
    const lowered = work.own(crank.translate([0, 0, dz]));
    assert.ok(work.and(lowered, fixed).volume() < 0.001, 'the keyed crank must insert from below');
  }
}

// If a polygon is translated sideways at fixed yaw, first contact occurs
// when a flag corner touches a wall edge or a wall vertex touches a flag edge.
function yOnSegment(x, a, b) {
  if (x < Math.min(a[0], b[0]) || x > Math.max(a[0], b[0])) return undefined;
  if (Math.abs(b[0] - a[0]) < 1e-9) return undefined;
  return a[1] + (x - a[0]) * (b[1] - a[1]) / (b[0] - a[0]);
}

function lateralTravel(walls, flag, x, y, tangent, normal) {
  function frame(point) {
    const dx = point[0] - x, dy = point[1] - y;
    return [dx * tangent[0] + dy * tangent[1], dx * normal[0] + dy * normal[1]];
  }
  let distance = Infinity;
  for (const wall of walls) {
    let a = frame(wall.at(-1));
    for (const point of wall) {
      const b = frame(point);
      if (Math.min(a[0], b[0]) <= 5.1 && Math.max(a[0], b[0]) >= -5.1) {
        for (let i = 0; i < flag.length; i++) {
          const v = flag[i], next = flag[(i + 1) % flag.length];
          const wallY = yOnSegment(v[0], a, b);
          if (wallY >= v[1]) distance = Math.min(distance, wallY - v[1]);
          const flagY = yOnSegment(b[0], v, next);
          if (flagY <= b[1]) distance = Math.min(distance, b[1] - flagY);
        }
      }
      a = b;
    }
  }
  return distance;
}

function checkLoadedGuideAtHeel(work, assembled, fork, p, route, pitOpen) {
  const [hx, hy] = fork.heel;
  const endX = (fork.guardEndX ?? hx + 25) + 7;
  const endY = lateralAt(route, endX);
  const window = box(work, hx - 20, Math.min(hy, endY) - 20, endX + 8, Math.max(hy, endY) + 20);
  const side = fork.sign * (pitOpen ? -1 : 1);
  // Pressure on the nose of a straight, yawed flag makes it reach into a
  // recess that a centred car clears. Follow the actual *first contact* side
  // of the printed track continuously as the front passes the fixed divider.
  const yaw = 4 * Math.PI / 180;
  const flag = [[-5, -.85], [5, -.85], [5, .85], [-5, .85]].map(([u, v]) => [
    u * Math.cos(yaw) - v * Math.sin(yaw), u * Math.sin(yaw) + v * Math.cos(yaw),
  ]);
  for (const depth of [2, 4, p.slotDepth - 0.4]) {
    // The scarf overlaps at different heights. Project every obstacle the
    // vertical flag can touch anywhere between its root and its tip.
    const engagement = work.prism(window, p.height - depth, p.height - 0.05);
    const projected = work.own(work.and(assembled, engagement).project());
    const walls = work.own(projected.simplify(0.0001)).toPolygons();
    const previous = [];
    let maxCorrection = 0, maxTravel = 0, finalWall;
    const stations = Math.ceil((endX - hx + 10) / 0.05);
    for (let i = 0; i <= stations; i++) {
      const x = hx - 10 + i * 0.05;
      const rise = lateralAt(route, x + 1) - lateralAt(route, x - 1);
      const length = Math.hypot(2, rise);
      const tangent = [2 / length, rise / length];
      const normal = [-side * tangent[1], side * tangent[0]];
      const travel = lateralTravel(walls, flag, x, lateralAt(route, x), tangent, normal);
      assert.ok(Number.isFinite(travel), 'the flag must find a guiding wall');
      if (i >= 2) maxCorrection = Math.max(maxCorrection, previous[i - 2] - travel);
      maxTravel = Math.max(maxTravel, travel);
      if (i === stations)
        finalWall = lateralTravel(walls, [[0, 0]], x, lateralAt(route, x), tangent, normal);
      previous.push(travel);
    }
    const straightAllowance = p.slotWidth / 2 - (5 * Math.sin(yaw) + 0.85 * Math.cos(yaw));
    assert.ok(maxTravel <= straightAllowance + 0.6,
      'wall pressure must leave the flag supported throughout the relief');
    assert.ok(Math.abs(finalWall - p.slotWidth / 2) < 0.015,
      'the fixed guide must return to the specified slot width');
    assert.ok(maxCorrection <= 0.035,
      `${fork.side} ${pitOpen ? 'pit' : 'main'}, ${depth} mm deep: the loaded flag must move inward ${maxCorrection.toFixed(3)} mm in 0.1 mm of travel`);
  }
}

for (const hollow of [false, true]) {
  for (const turnoutPosition of ['main', 'pit']) {
    test(`exported ${hollow ? 'hollow' : 'solid'} mirrored turnout routes a rigid guide only to ${turnoutPosition}`, () => {
      const p = specialTrackParams('pit', {
        ...defaultTrack(), hollow, height: 10, slotDepth: 8, slotWidth: 3,
        width: 200, laneSpacing: 100,
      });
      Object.assign(p.special, { side: 'both', turnoutPosition });
      const { forks, lanePaths } = pitLayout(p);
      const parts = buildTrack(wasm, p);
      const work = new SolidWorkshop(wasm);
      try {
        const project = { mode: 'track', track: { params: p } };
        const roads = parts.filter(part => part.role === 'road')
          .map(part => reassemblePrinted(work, part, project));
        for (const road of roads) {
          const shells = road.decompose().map(shell => work.own(shell));
          assert.equal(shells.length, 1, 'the stationary socket belongs to a single printed road shell');
        }
        for (const [i, fork] of forks.entries()) {
          const blade = parts.find(part => part.id === 'pit-blade-' + fork.side);
          assert.ok(blade);
          const arm = parts.find(part => part.id === 'pit-crank-' + fork.side);
          assert.equal(arm?.role, 'turnoutArm');
          const insert = parts.find(part => part.id === 'pit-bearing-' + fork.side);
          assert.equal(insert?.role, 'turnoutBearing');
          const bearing = reassemblePrinted(work, insert, project);
          const fixed = [...roads, bearing];
          const tongue = reassemblePrinted(work, blade, project, turnoutPosition === 'pit' ? fork.swing : 0);
          const crank = reassemblePrinted(work, arm, project, turnoutPosition === 'pit' ? fork.swing : 0);
          assert.ok(work.own(crank.subtract(arm.solid)).volume() < 0.035, 'the printable crank must reproduce the chosen assembly pose');
          checkHeightStop(work, fixed, tongue, crank, fork, p);
          if (turnoutPosition === 'main') {
            checkCrownProfile(tongue, fork, p);
            checkBearingInsert(work, roads, insert, bearing, fork, p, project);
            checkBladeInsertion(work, fixed, tongue, fork, p);
            checkDriveMechanism(work, fixed, crank, tongue, fork, p);
          }
          const assembled = work.union([...fixed, tongue, crank]);
          const main = lanePaths[fork.sign > 0 ? p.lanes - 1 : 0];
          const pit = lanePaths[p.lanes + i];
          const start = Math.min(fork.mainToe[0], fork.pitToe[0]) - 8;
          const end = fork.heel[0] + 8;
          checkGuidePassage(work, assembled, p, turnoutPosition === 'pit' ? pit : main, start, end);
          checkWrongBranchClosed(work, assembled, fork, p, { main, pit }, start, end, turnoutPosition === 'pit');
          checkLoadedGuideAtHeel(work, assembled, fork, p, turnoutPosition === 'pit' ? pit : main,
            turnoutPosition === 'pit');
        }
      } finally {
        work.close();
        parts.forEach(part => part.solid.delete());
      }
    });
  }
}
