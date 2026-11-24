// Sloped straights: a road that bends in height, from level into a climb or
// from a climb back to level.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { createEngine } from '../src/engine.js';
import { withPrintableSolid } from '../src/geometry/joints.js';
import {
  SLOPE_DEFAULTS,
  SLOPE_LEAD,
  hasSlope,
  slopeFilled,
  slopeDescends,
  slopeEndRates,
  slopeOnTable,
  slopeProfile,
  slopeSettings,
} from '../src/geometry/slope.js';
import { trackInspector } from '../src/inspector.js';
import { syncSlopeControls } from '../src/slope-controls.js';
import { canRamp, crossings, endsOf, newLayout, pitch, placeSource, setElevation, surfaces } from '../src/planner-model.js';
import { newProject } from '../src/project.js';
import { buildTestJoint, buildTrack, defaultTrack, trackParameters, validateTrack } from '../src/track.js';

const wasm = await Module();
wasm.setup();
const engine = createEngine(wasm);

const piece = (changes = {}) =>
  trackParameters({ ...defaultTrack(), kind: 'straight', length: 200, lanes: 1, width: 100, ...changes });
const sloped = (changes = {}) => piece({ slopeForm: 'up', ...changes });
function built(p, inspect) {
  const parts = buildTrack(wasm, p);
  try {
    return inspect(parts);
  } finally {
    parts.forEach((part) => part.solid.delete());
  }
}
const roadOf = (parts) => parts.find((part) => part.role === 'road');
const near = (actual, expected, tolerance) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, 'expected ' + expected + ' ± ' + tolerance + '; measured ' + actual);
const degrees = (radians) => (radians * 180) / Math.PI;
// The first surface met from above, and from below.
const topAt = (solid, x, y) => solid.rayCast([x, y, 200], [x, y, -5])[0]?.position[2];
const underAt = (solid, x, y) => solid.rayCast([x, y, -5], [x, y, 200])[0]?.position[2];

test('the curve of the road: level into a climb, or a climb back to level, with the same rise', () => {
  assert.equal(hasSlope(piece()), false);
  assert.deepEqual(slopeSettings(sloped()), { ...SLOPE_DEFAULTS, slopeForm: 'up' });
  const up = slopeProfile(sloped()),
    down = slopeProfile(sloped({ slopeForm: 'down' }));
  // Level at end A and at the climb angle at end B; the other way round at the top of a hill.
  assert.equal(up.at(0)[2], 0);
  near(degrees(up.at(200)[2]), 8, 1e-9);
  near(degrees(down.at(0)[2]), 8, 1e-9);
  assert.equal(down.at(200)[2], 0);
  // The ends stay straight for the connectors, and the bend takes its share of the rest.
  near(up.start, SLOPE_LEAD, 1e-9);
  near(up.bend, 0.7 * (200 - 2 * SLOPE_LEAD), 1e-9);
  near(down.end, 200 - SLOPE_LEAD, 1e-9);
  near(up.radius, up.bend / up.climb, 1e-9);
  assert.equal(up.at(SLOPE_LEAD)[1], 0, 'still on the table at the end of the level stretch');
  // Both forms rise as much over the same run: one is the other turned round.
  near(up.rise, down.rise, 1e-9);
  near(up.run, down.run, 1e-9);
  assert.ok(up.rise > 15 && up.rise < 20 && up.run < 200 && up.run > 198);
  // The surface is as long as the piece: it is bent, not stretched.
  let length = 0;
  for (let d = 0; d < 200; d += 0.5) {
    const a = up.at(d),
      b = up.at(d + 0.5);
    length += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  near(length, 200, 1e-3);
  // A gentle curve takes the whole piece on a wide radius; an aggressive one bends tightly and climbs further.
  const gentle = slopeProfile(sloped({ slopeBend: 100 })),
    aggressive = slopeProfile(sloped({ slopeBend: 25 }));
  assert.ok(gentle.radius > up.radius && up.radius > aggressive.radius);
  assert.ok(gentle.rise < up.rise && up.rise < aggressive.rise);
  // A steeper angle rises further.
  assert.ok(slopeProfile(sloped({ slopeAngle: 12 })).rise > up.rise * 1.4);
});

test('a climb is one solid piece on the table, with its slot as deep as on a level road', () => {
  const p = sloped();
  const profile = slopeProfile(p);
  built(p, (parts) => {
    const road = roadOf(parts);
    assert.equal(road.solid.status(), 'NoError');
    const pieces = road.solid.decompose();
    assert.equal(pieces.length, 1);
    pieces.forEach((part) => part.delete());
    const box = road.solid.boundingBox();
    near(box.min[2], 0, 1e-6);
    near(box.max[2], p.height + profile.rise, 0.01);
    near(box.min[0], -100, 1e-6);
    // End B is square to the road: its lower edge reaches further than its upper edge.
    near(box.max[0], -100 + profile.run + p.height * Math.sin(profile.climb), 0.01);
    // Level at end A, and on the curve everywhere else.
    near(topAt(road.solid, -95, 20), p.height, 1e-6);
    for (const d of [40, 90, 140, 190]) {
      const [x, z] = profile.at(d);
      near(topAt(road.solid, -100 + x, 20), p.height + z, 0.02);
    }
    // The slot floor lies its depth below the surface, measured square to the road.
    for (const d of [60, 120, 180]) {
      const [x, z, angle] = profile.at(d);
      const floor = [-100 + x + p.slotDepth * Math.sin(angle), p.height + z - p.slotDepth * Math.cos(angle)];
      near(topAt(road.solid, floor[0], 0), floor[1], 0.03);
    }
    // Solid down to the table under the climb, and open under the high end.
    for (const d of [60, 120, 160]) near(underAt(road.solid, -100 + profile.at(d)[0], 20), 0, 1e-6);
    assert.ok(underAt(road.solid, -100 + profile.at(190)[0], 20) > 5, 'the last stretch is open from below');
    assert.equal(slopeFilled(p), true);
  });
  // Without the base it is the bent road alone, hollow as the pack makes its roads.
  const bare = sloped({ slopeFill: false });
  let filled, open;
  built(p, (parts) => (filled = roadOf(parts).solid.volume()));
  built(bare, (parts) => {
    const road = roadOf(parts).solid;
    open = road.volume();
    assert.ok(underAt(road, -100 + profile.at(120)[0], 20) > 3);
    near(road.boundingBox().max[2], p.height + profile.rise, 0.01);
  });
  assert.ok(filled > open * 1.5, filled + ' against ' + open);
});

test('the top of a hill bends the other way and ends level, as high as the climb reached', () => {
  const p = sloped({ slopeForm: 'down' });
  const profile = slopeProfile(p);
  assert.equal(slopeFilled(p), false);
  built(p, (parts) => {
    const road = roadOf(parts).solid;
    assert.equal(road.status(), 'NoError');
    // Level over the last stretch, at the full rise.
    for (const back of [2, 8, 14]) near(topAt(road, -100 + profile.run - back, 20), p.height + profile.rise, 0.01);
    // Climbing at end A, at the climb angle.
    const a = profile.at(5),
      b = profile.at(12);
    near(degrees(Math.atan2(topAt(road, -100 + b[0], 20) - topAt(road, -100 + a[0], 20), b[0] - a[0])), 8, 0.05);
    // It is a road of even thickness: no base under it.
    assert.ok(underAt(road, -100 + profile.at(150)[0], 20) > profile.rise - p.height);
  });
});

test('connectors, borders and a texture follow the slope', () => {
  // The clips of end B are lifted and turned with it.
  const p = sloped({ joint: 'clips' }),
    profile = slopeProfile(p);
  let flatClips;
  built(piece({ joint: 'clips' }), (parts) => {
    flatClips = parts.filter((part) => part.role === 'clip').map((part) => part.solid.volume());
  });
  built(p, (parts) => {
    const clips = parts.filter((part) => part.role === 'clip');
    assert.equal(clips.length, flatClips.length);
    clips.forEach((clip, i) => {
      // Turned as a whole in the straight stretch at the end: not stretched or squeezed.
      near(clip.solid.volume(), flatClips[i], flatClips[i] * 0.002);
      assert.ok(clip.solid.boundingBox().min[2] > profile.rise - 3, clip.id + ' is up at end B');
      const overlap = clip.solid.intersect(roadOf(parts).solid);
      try {
        assert.ok(overlap.volume() < 0.01 * flatClips[i], clip.id + ' sits in its pocket');
      } finally {
        overlap.delete();
      }
    });
  });
  built(sloped({ slopeForm: 'down', lanes: 2, width: 200, borderSide: 'both' }), (parts) => {
    const borders = parts.filter((part) => part.role === 'border');
    assert.equal(borders.length, 2);
    for (const border of borders) {
      assert.equal(border.solid.status(), 'NoError');
      assert.ok(border.solid.boundingBox().max[2] > 25, 'the border rises with the road');
    }
  });
  built(sloped({ roadTexture: 'cobbles', textureSize: 'full' }), (parts) => {
    const road = roadOf(parts);
    assert.equal(road.solid.status(), 'NoError');
    assert.ok(road.textureJoints > 1000);
  });
});

test('a sloped piece prints on its side, and its fit sample is a flat cut of the road', () => {
  const p = sloped({ joint: 'clips' });
  built(p, (parts) => {
    const road = roadOf(parts);
    withPrintableSolid(road, (solid) => {
      const { min, max } = solid.boundingBox();
      near(min[2], 0, 1e-9);
      near(max[2] - min[2], p.width, 1e-6);
    }, { sideDown: true });
    // In place it is where it stands on the table.
    withPrintableSolid(road, (solid) => near(solid.boundingBox().max[2], p.height + slopeProfile(p).rise, 0.01));
  });
  const flat = buildTestJoint(wasm, p, 'start');
  try {
    for (const part of flat) assert.ok(part.solid.boundingBox().max[2] <= p.height + 2, part.id);
  } finally {
    flat.forEach((part) => part.solid.delete());
  }
});

test('a slope that cannot be made is refused with what to change', () => {
  const refuse = (changes, text) => assert.throws(() => validateTrack(sloped(changes)), text, JSON.stringify(changes));
  refuse({ slopeForm: 'sideways' }, /Choose Level, a climb or a descent for the slope/);
  refuse({ slopeAngle: 0 }, /climb angle must be between 1 and 30°/);
  refuse({ slopeAngle: 45 }, /climb angle must be between 1 and 30°/);
  refuse({ slopeBend: 5 }, /curve must be between 10 and 100 %/);
  refuse({ slopeOpen: 500 }, /open length under the high end must be between 0 and 200 mm/);
  refuse({ segments: 2 }, /prints as one road piece\. Set the road Segments to 1/);
  refuse({ length: 40 }, /needs a road at least 50 mm long/);
  // Too tight a bend: with the setting that makes it gentle enough.
  refuse({ slopeAngle: 20, slopeBend: 20 }, /bend on a radius of 97\.4 mm, too tight for a car to follow \(150 mm at least\)\. Set Curve to at least 31 %, or the climb angle to at most 12\.9°/);
  refuse({ length: 80, slopeAngle: 30, slopeBend: 100 }, /Set the climb angle to at most 19°, or use a road at least 109 mm long/);
  refuse({ tracksideSide: 'outer' }, /cannot have trackside accessories yet/);
  refuse({ whiteLineRoad: 'both' }, /cannot have white lines or kerbstones yet/);
  refuse({ roadCentreLine: 'solid' }, /cannot have white lines or kerbstones yet/);
  assert.throws(
    () => validateTrack(trackParameters({ ...defaultTrack(), kind: 'curve', slopeForm: 'up' })),
    /Only a plain straight can be a sloped piece/,
  );
  // Level, none of its settings is looked at; and a piece from before slopes is unchanged.
  assert.doesNotThrow(() => validateTrack(piece({ slopeAngle: 99, slopeBend: 0 })));
  assert.equal(defaultTrack().slopeForm, undefined);
});

test('in a layout the piece is as long as its run, and the next piece joins at the height it reached', () => {
  const plate = { width: 450, depth: 450, margin: 0 };
  const source = (name, changes) => ({ name, ...engine.plannerSource({ track: { params: piece(changes), plan: null }, plate, autoFit: false }) });
  const up = source('Climb', { slopeForm: 'up' }),
    level = source('Straight', {});
  const profile = slopeProfile(sloped());
  const [a, b] = up.sections[0].ports;
  near(b.xy[0] - a.xy[0], profile.run, 1e-6);
  near(b.baseZ, profile.rise, 1e-9);
  assert.equal(a.baseZ, undefined);
  // Its outline on the plan is its shadow: no longer than its run and the tilt of its end face.
  const xs = up.meshes.find((m) => m.role === 'road').outline.flat().map(([x]) => x);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 200.7 && Math.max(...xs) - Math.min(...xs) > 198);
  const defs = new Map([['s1', level], ['s2', up]]),
    layout = newLayout();
  for (const [id, def] of defs) layout.sources[id] = { name: def.name, track: def.track };
  let active = placeSource(layout, defs, 's1');
  active = placeSource(layout, defs, 's2', active.end);
  active = placeSource(layout, defs, 's1', active.end);
  const net = endsOf(layout, defs);
  assert.equal(net.open.length, 2);
  assert.equal(net.joints.size, 4);
  // The straight behind the climb is lifted by the rise.
  near(layout.nodes[2].h[0], profile.rise, 1e-6);
  assert.deepEqual(layout.nodes[1].h, [0, 0]);
  // A sloped piece has its own curve in height: it is not tilted as a ramp as well.
  assert.equal(canRamp(layout.nodes[1], up), false);
  assert.equal(canRamp(layout.nodes[0], level), true);
});

test('Track Set offers the slope under Shape on a plain straight', () => {
  const project = newProject();
  project.mode = 'track';
  project.track.params = sloped();
  const html = trackInspector(project, 'geometry');
  for (const label of ['Level', 'Level into a climb', 'Climb back to level', 'Level into a descent', 'Descent back to level', 'Climb angle', 'Curve', 'Solid base down to the table', 'Open under the high end'])
    assert.ok(html.includes(label), label);
  assert.match(html, /name="slopeAngle"[^>]*value="8"/);
  assert.match(html, /name="slopeBend"[^>]*value="70"/);
  assert.match(html, /data-slope-fields>/);
  assert.match(html, /data-slope-base>/);
  assert.match(html, /End B is 17\.5 mm higher than end A, 199 mm further on\. The road bends on a radius of 852\.3 mm\./);
  project.track.params = sloped({ slopeForm: 'down' });
  assert.match(trackInspector(project, 'geometry'), /data-slope-base hidden disabled>/);
  project.track.params = piece();
  assert.match(trackInspector(project, 'geometry'), /data-slope-fields hidden disabled>/);
  project.track.params = trackParameters({ ...defaultTrack(), kind: 'curve' });
  assert.doesNotMatch(trackInspector(project, 'geometry'), /slopeForm/);
});

test('the hint follows the fields while they are edited', () => {
  const fields = { hidden: true, disabled: true },
    base = { hidden: true, disabled: true },
    hint = { textContent: '' };
  // As a browser form has it: elements.length is the number of fields.
  const elements = {
    length: 5,
    slopeForm: { value: 'up' },
    slopeAngle: { valueAsNumber: 8 },
    slopeBend: { valueAsNumber: 70 },
  };
  const nodes = {
    '[data-slope-fields]': fields,
    '[data-slope-base]': base,
    '[data-slope-hint]': hint,
    '[name="length"]': { valueAsNumber: 200 },
  };
  const form = { elements, querySelector: (key) => nodes[key] };
  syncSlopeControls(form);
  assert.equal(fields.hidden, false);
  assert.equal(base.hidden, false);
  assert.match(hint.textContent, /End B is 17\.5 mm higher than end A, 199 mm further on/);
  elements.slopeAngle.valueAsNumber = 12;
  syncSlopeControls(form);
  assert.match(hint.textContent, /End B is 26\.\d mm higher/);
  elements.slopeForm.value = 'down';
  syncSlopeControls(form);
  assert.equal(base.hidden, true);
  elements.slopeForm.value = 'none';
  syncSlopeControls(form);
  assert.equal(fields.hidden, true);
  assert.equal(hint.textContent, '');
});

test('with clips, a sloped piece joins a level piece at both ends in a layout, in either form', () => {
  const plate = { width: 450, depth: 450, margin: 0 };
  const source = (name, changes) => ({
    name,
    ...engine.plannerSource({ track: { params: piece({ joint: 'clips', ...changes }), plan: null }, plate, autoFit: false }),
  });
  const level = source('Straight', {});
  const clipsAt = (def) => def.sections[0].ports.map((port) => port.hardware.length);
  assert.ok(clipsAt(level)[1] >= 1, 'this piece joins with clips');
  for (const slopeForm of ['up', 'down']) {
    const slope = source('Slope', { slopeForm });
    // The Planner finds the clips of both ends where the bent road carries them.
    assert.deepEqual(clipsAt(slope), clipsAt(level), slopeForm);
    assert.deepEqual(
      [...new Set(Object.values(slope.sections[0].hardwareEnds))],
      [...new Set(Object.values(level.sections[0].hardwareEnds))],
      slopeForm + ': its loose clips belong to the same end as on a level piece',
    );
    const defs = new Map([['s1', level], ['s2', slope]]),
      layout = newLayout();
    for (const [id, def] of defs) layout.sources[id] = { name: def.name, track: def.track };
    let active = placeSource(layout, defs, 's1');
    active = placeSource(layout, defs, 's2', active.end);
    active = placeSource(layout, defs, 's1', active.end);
    const net = endsOf(layout, defs);
    assert.equal(net.joints.size, 4, slopeForm + ': both ends of the sloped piece are joined');
    assert.equal(net.open.length, 2);
    near(layout.nodes[2].h[0], slopeProfile(sloped({ slopeForm })).rise, 1e-6);
  }
});

test('the straight behind a sloped end carries on at the climb angle, and no crossing is reported at the joint', () => {
  const plate = { width: 450, depth: 450, margin: 0 };
  const source = (name, changes) => ({
    name,
    ...engine.plannerSource({ track: { params: piece({ joint: 'clips', ...changes }), plan: null }, plate, autoFit: false }),
  });
  const level = source('Straight', {}),
    up = source('Climb', { slopeForm: 'up' }),
    top = source('Top', { slopeForm: 'down' });
  const rate = Math.tan((8 * Math.PI) / 180);
  assert.deepEqual(slopeEndRates(piece()), [0, 0]);
  assert.deepEqual(slopeEndRates(sloped()), [0, rate]);
  assert.deepEqual(slopeEndRates(sloped({ slopeForm: 'down' })), [rate, 0]);
  const profile = slopeProfile(sloped());
  const defs = new Map([['level', level], ['up', up], ['top', top]]),
    layout = newLayout();
  for (const [id, def] of defs) layout.sources[id] = { name: def.name, track: def.track };
  let active = placeSource(layout, defs, 'level');
  active = placeSource(layout, defs, 'up', active.end);
  active = placeSource(layout, defs, 'level', active.end);
  // The ramp starts where the climb ended and rises at its angle.
  const ramp = layout.nodes[2];
  near(ramp.h[0], profile.rise, 1e-6);
  near(ramp.h[1], profile.rise + rate * 200, 0.01);
  near(pitch(ramp, level).slope, rate, 1e-4);
  assert.ok(ramp.supports >= 1, 'a lifted ramp gets a support');
  assert.deepEqual(layout.nodes[1].h, [0, 0]);
  // A second straight carries on, as behind any ramp.
  active = placeSource(layout, defs, 'level', active.end);
  near(pitch(layout.nodes[3], level).slope, rate, 1e-4);
  // The top of the hill joins the ramp with its sloped end and ends level, higher still.
  active = placeSource(layout, defs, 'top', active.end);
  const crest = layout.nodes[4];
  near(crest.h[0], layout.nodes[3].h[1], 1e-6);
  active = placeSource(layout, defs, 'level', active.end);
  const after = layout.nodes[5];
  near(after.h[0], crest.h[0] + profile.rise, 1e-6);
  near(after.h[1], after.h[0], 1e-9);
  const net = endsOf(layout, defs);
  assert.equal(net.open.length, 2);
  assert.equal(net.joints.size, 10);
  // Pieces that only meet at a joint are not a crossing.
  assert.equal(crossings(surfaces(layout, defs)).length, 0);
  // Built backwards from the foot of a climb, a straight stays level: that end is level.
  const back = newLayout();
  for (const [id, def] of defs) back.sources[id] = { name: def.name, track: def.track };
  placeSource(back, defs, 'up');
  placeSource(back, defs, 'level', back.nodes[0].id + ':0');
  assert.deepEqual(back.nodes[1].h, [0, 0]);
});

test('changing the supports or the lifts of the ramp behind a sloped piece keeps both joined', () => {
  const plate = { width: 450, depth: 450, margin: 0 };
  const source = (name, changes) => ({
    name,
    ...engine.plannerSource({ track: { params: piece({ joint: 'clips', ...changes }), plan: null }, plate, autoFit: false }),
  });
  const level = source('Straight', {}),
    up = source('Climb', { slopeForm: 'up' }),
    top = source('Top', { slopeForm: 'down' });
  const defs = new Map([['level', level], ['up', up], ['top', top]]),
    layout = newLayout();
  for (const [id, def] of defs) layout.sources[id] = { name: def.name, track: def.track };
  let active = placeSource(layout, defs, 'level');
  active = placeSource(layout, defs, 'up', active.end);
  active = placeSource(layout, defs, 'level', active.end);
  active = placeSource(layout, defs, 'top', active.end);
  active = placeSource(layout, defs, 'level', active.end);
  const [first, climb, ramp, crest, last] = layout.nodes;
  const before = structuredClone(layout.nodes.map((n) => n.h));
  const joints = () => endsOf(layout, defs).joints.size;
  assert.equal(joints(), 8);
  // Apply heights on the ramp as it stands, with pegs: nothing moves and nothing comes apart.
  setElevation(layout, defs, ramp.id, ramp.h[0], ramp.h[1], 2, 'pegs', [10, 10]);
  assert.equal(joints(), 8);
  layout.nodes.forEach((n, i) => n.h.forEach((h, k) => near(h, before[i][k], 1e-6)));
  assert.deepEqual(climb.h, [0, 0], 'the climb stays on the table');
  assert.equal(climb.supports, 0);
  assert.equal(ramp.supports, 2);
  assert.equal(ramp.supportStyle, 'pegs');
  // The same from the field values, which are rounded to what the panel shows.
  const shown = (value) => Number(value.toFixed(2));
  setElevation(layout, defs, ramp.id, shown(ramp.h[0]), shown(ramp.h[1]), 2, 'pegs', [10, 10]);
  assert.equal(joints(), 8);
  assert.ok(Math.abs(climb.h[0]) < 0.01 && climb.h[0] >= 0, 'the climb is not lifted off the table: ' + climb.h);
  // Raising the far end of the ramp lifts the top of the hill and the level road behind it by as much.
  const lifted = ramp.h[1] + 10;
  setElevation(layout, defs, ramp.id, ramp.h[0], lifted, 2, 'pegs', [10, 10]);
  assert.equal(joints(), 8);
  near(crest.h[0], lifted, 1e-6);
  near(last.h[0], lifted + slopeProfile(sloped()).rise, 1e-6);
  assert.ok(Math.abs(climb.h[0]) < 0.01);
  assert.deepEqual(first.h, [0, 0]);
  // Lowering the start of the ramp below what the climb reaches would push the climb under the table.
  assert.throws(
    () => setElevation(layout, defs, ramp.id, 5, lifted, 2, 'pegs', [10, 10]),
    /The adjoining road would be below table level/,
  );
});

// ---- Descents: the same two shapes turned round, with their ends the other way ----

test('a descent drops from end A to end B by what the matching climb rises', () => {
  const up = slopeProfile(sloped()),
    over = slopeProfile(sloped({ slopeForm: 'over' })),
    out = slopeProfile(sloped({ slopeForm: 'out' }));
  for (const form of ['up', 'down']) assert.equal(slopeDescends(sloped({ slopeForm: form })), false);
  for (const form of ['over', 'out']) assert.equal(slopeDescends(sloped({ slopeForm: form })), true);
  assert.deepEqual(['up', 'down', 'over', 'out'].map((form) => slopeOnTable(sloped({ slopeForm: form }))), [true, false, false, true]);
  // The top of a descent: level and high at end A, going down at the climb angle at end B.
  assert.equal(over.at(0)[2], 0);
  near(over.at(0)[1], up.rise, 1e-9);
  near(degrees(over.at(200)[2]), -8, 1e-9);
  near(over.at(200)[1], 0, 1e-9);
  // The foot of a descent: coming down at end A, level on the table at end B.
  near(degrees(out.at(0)[2]), -8, 1e-9);
  near(out.at(0)[1], up.rise, 1e-9);
  assert.equal(Math.abs(out.at(200)[2]), 0);
  near(out.at(200)[1], 0, 1e-9);
  near(out.at(200)[0], up.run, 1e-9);
  // Same rise, run and bend as the climb.
  for (const profile of [over, out]) {
    near(profile.rise, up.rise, 1e-9);
    near(profile.run, up.run, 1e-9);
    near(profile.radius, up.radius, 1e-9);
    assert.equal(profile.drops, true);
  }
  const rate = Math.tan((8 * Math.PI) / 180);
  assert.deepEqual(slopeEndRates(sloped({ slopeForm: 'over' })), [0, -rate]);
  assert.deepEqual(slopeEndRates(sloped({ slopeForm: 'out' })), [-rate, 0]);
});

test('the foot of a descent stands on the table at end B on its base; the top is the bent road alone', () => {
  const p = sloped({ slopeForm: 'out', joint: 'clips' }),
    profile = slopeProfile(p);
  assert.equal(slopeFilled(p), true);
  built(p, (parts) => {
    const road = roadOf(parts).solid;
    assert.equal(road.status(), 'NoError');
    const pieces = road.decompose();
    assert.equal(pieces.length, 1);
    pieces.forEach((part) => part.delete());
    near(road.boundingBox().min[2], 0, 1e-6);
    near(road.boundingBox().max[2], p.height + profile.rise, 0.02);
    // Level on the table at end B, and on the curve before it.
    near(topAt(road, -100 + profile.run - 5, 20), p.height, 1e-6);
    for (const d of [10, 60, 120]) {
      const [x, z] = profile.at(d);
      near(topAt(road, -100 + x, 20), p.height + z, 0.03);
    }
    // The slot keeps its depth, square to the road.
    const [x, z, angle] = profile.at(60);
    near(topAt(road, -100 + x + p.slotDepth * Math.sin(angle), 0), p.height + z - p.slotDepth * Math.cos(angle), 0.03);
    // Solid under the descent, and open under the high end, which is end A here.
    for (const d of [60, 120]) near(underAt(road, -100 + profile.at(d)[0], 20), 0, 1e-6);
    assert.ok(underAt(road, -100 + profile.at(12)[0], 20) > 5, 'open under the high end');
    // The clips of a piece are at its end B: here on the table, not up at the high end.
    for (const clip of parts.filter((part) => part.role === 'clip'))
      assert.ok(clip.solid.boundingBox().max[2] < p.height + 1, clip.id);
  });
  const over = sloped({ slopeForm: 'over' });
  assert.equal(slopeFilled(over), false);
  built(over, (parts) => {
    const road = roadOf(parts).solid;
    assert.equal(road.status(), 'NoError');
    const top = slopeProfile(over);
    // Level over the first stretch, at the full height; lower at end B.
    for (const d of [2, 8, 14]) near(topAt(road, -100 + d, 20), over.height + top.rise, 0.01);
    assert.ok(topAt(road, -100 + top.run - 6, 20) < over.height + 1.5);
  });
});

test('a whole hill in a layout: up, along the top and down again to the table', () => {
  const plate = { width: 450, depth: 450, margin: 0 };
  const source = (name, changes) => ({
    name,
    ...engine.plannerSource({ track: { params: piece({ joint: 'clips', ...changes }), plan: null }, plate, autoFit: false }),
  });
  const forms = Object.fromEntries(['up', 'down', 'over', 'out'].map((form) => [form, source(form, { slopeForm: form })]));
  const defs = new Map([['level', source('Straight', {})], ...Object.entries(forms)]),
    layout = newLayout();
  for (const [id, def] of defs) layout.sources[id] = { name: def.name, track: def.track };
  const rise = slopeProfile(sloped()).rise,
    rate = Math.tan((8 * Math.PI) / 180);
  // The high end of a descent is its end A.
  assert.deepEqual(forms.over.sections[0].ports.map((port) => port.baseZ ?? 0), [rise, 0]);
  assert.deepEqual(forms.out.sections[0].ports.map((port) => port.baseZ ?? 0), [rise, 0]);
  assert.deepEqual(forms.up.sections[0].ports.map((port) => port.baseZ ?? 0), [0, rise]);
  let active = { end: undefined };
  const place = (id) => {
    active = placeSource(layout, defs, id, active.end);
    return layout.nodes.at(-1);
  };
  place('level');
  place('up');
  const climbing = place('level');
  const crest = place('down');
  const along = place('level');
  const brow = place('over');
  const descending = place('level');
  const foot = place('out');
  const last = place('level');
  const top = 2 * rise + rate * 200;
  near(pitch(climbing, defs.get('level')).slope, rate, 1e-4);
  near(along.h[0], top, 0.01);
  near(along.h[1], along.h[0], 1e-9);
  // The top of the descent hangs from the level road: its lift is that of its low end.
  near(brow.h[0], top - rise, 0.01);
  // The ramp down starts there and falls at the climb angle.
  near(descending.h[0], top - rise, 0.01);
  near(pitch(descending, defs.get('level')).slope, -rate, 1e-4);
  near(descending.h[1], rise, 0.02);
  assert.ok(descending.supports >= 1);
  // The foot stands on the table, and so does the road behind it.
  assert.ok(Math.abs(foot.h[0]) < 0.02, 'foot lift ' + foot.h);
  assert.ok(Math.abs(last.h[0]) < 0.02 && Math.abs(last.h[1]) < 0.02, 'back on the table: ' + last.h);
  const net = endsOf(layout, defs);
  assert.equal(net.open.length, 2);
  assert.equal(net.joints.size, 16);
  assert.equal(crossings(surfaces(layout, defs)).length, 0);
  assert.equal(crest.supports, climbing.supports);
  // On the table there is nothing to come down from: it says how high the road has to be.
  const flat = newLayout();
  for (const [id, def] of defs) flat.sources[id] = { name: def.name, track: def.track };
  const first = placeSource(flat, defs, 'level');
  assert.throws(
    () => placeSource(flat, defs, 'over', first.end),
    /This piece comes down 17\.48 mm, and the road here is only 0 mm above the table\. Lift the road to at least 17\.48 mm first/,
  );
  assert.equal(flat.nodes.length, 1);
});

test('the controls name all four forms and say whether end B is higher or lower', () => {
  const project = newProject();
  project.mode = 'track';
  project.track.params = sloped({ slopeForm: 'out' });
  const html = trackInspector(project, 'geometry');
  assert.match(html, /<option value="out" selected>Descent back to level/);
  assert.match(html, /End B is 17\.5 mm lower than end A, 199 mm further on/);
  assert.match(html, /data-slope-base>/, 'the foot of a descent can stand on a base');
  project.track.params = sloped({ slopeForm: 'over' });
  const over = trackInspector(project, 'geometry');
  assert.match(over, /data-slope-base hidden disabled>/);
  assert.match(over, /End B is 17\.5 mm lower/);
  assert.match(over, /A hill takes four pieces/);
});
