import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { unzipSync } from 'fflate';
import { buildTrack, defaultTrack, validateTrack, trackParameters } from '../src/track.js';
import { encodeSTL } from '../src/editor.js';
import { packBarrierSTLs, printableSTL } from '../src/kit.js';
import { checkProject, newProject } from '../src/project.js';
import { BARRIER_FOOT, barrierProfile } from '../src/geometry/trackside.js';
import { resolveJointFit } from '../src/geometry/joint-fit.js';
import { groupTrackParts } from '../src/track-parts.js';
import { trackInspector } from '../src/inspector.js';

const wasm = await Module();
wasm.setup();

const piece = (changes = {}) => ({
  ...defaultTrack(),
  kind: 'straight',
  length: 200,
  width: 100,
  lanes: 1,
  ...changes,
});
function build(p, inspect) {
  const parts = buildTrack(wasm, p);
  try {
    return inspect(parts);
  } finally {
    parts.forEach((part) => part.solid.delete());
  }
}
const barriers = (parts) => parts.filter((part) => part.role === 'barrier');
const size = (solid) => {
  const { min, max } = solid.boundingBox();
  return max.map((v, i) => v - min[i]);
};
const near = (actual, expected, tolerance = 1e-3) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
const overlap = (a, b) => {
  const both = a.intersect(b);
  try {
    return both.volume();
  } finally {
    both.delete();
  }
};

test('a piece has no barriers until one is switched on', () => {
  build(piece(), (parts) => assert.equal(barriers(parts).length, 0));
  assert.equal(defaultTrack().tracksideSide, 'none');
});

test('the profile keeps the measured barrier: a foot as high as the track and the slope above it', () => {
  const ring = barrierProfile(8.3, 20);
  const heights = ring.map(([, z]) => z),
    widths = ring.map(([d]) => d);
  near(Math.max(...heights), 28.3);
  near(Math.max(...widths), BARRIER_FOOT);
  // The vertical foot ends at the road surface, where the face steps in.
  assert.deepEqual(ring.at(-1), [0, 8.3]);
  assert.deepEqual(ring.at(-2), [1.06, 8.3]);
  // On a 12 mm track the slope still starts at the road and rises 20 mm.
  near(Math.max(...barrierProfile(12, 20).map(([, z]) => z)), 32);
});

test('a road without borders gets a barrier on each chosen side, as long as the road', () => {
  build(piece({ tracksideSide: 'both' }), (parts) => {
    const [outer, inner] = barriers(parts);
    assert.deepEqual(barriers(parts).map((part) => part.id), ['barrier-outer-1', 'barrier-inner-1']);
    const fit = resolveJointFit(trackParameters(piece()));
    for (const part of [outer, inner]) {
      assert.equal(part.solid.status(), 'NoError');
      const [length, depth, height] = size(part.solid);
      near(length, 200);
      near(depth, BARRIER_FOOT + fit.tabLength);
      near(height, 12 + 20);
      assert.equal(part.tabCount, 2);
    }
    // One stands outside each road edge.
    assert.ok(outer.solid.boundingBox().min[1] > 0);
    assert.ok(inner.solid.boundingBox().max[1] < 0);
  });
  build(piece({ tracksideSide: 'inner' }), (parts) =>
    assert.deepEqual(barriers(parts).map((part) => part.id), ['barrier-inner-1']));
});

test('each tab sits in a socket: nothing overlaps and the road loses the socket volume', () => {
  const plain = build(piece(), ([road]) => road.solid.volume());
  build(piece({ tracksideSide: 'outer' }), (parts) => {
    const road = parts.find((part) => part.role === 'road'),
      [barrier] = barriers(parts);
    near(overlap(road.solid, barrier.solid), 0, 1e-6);
    // A hollow road gains the support around each socket and loses the socket.
    assert.notEqual(road.solid.volume().toFixed(1), plain.toFixed(1));
    // The tab reaches into the road: the barrier crosses the road edge at tab height.
    const fit = resolveJointFit(trackParameters(piece()));
    const edge = 50;
    near(barrier.solid.boundingBox().min[1], edge - fit.tabLength);
    const slice = barrier.solid.slice((fit.tabBottom + fit.tabTop) / 2);
    try {
      assert.ok(slice.bounds().min[1] < edge - 1);
    } finally {
      slice.delete();
    }
    assert.equal(barrier.jointGuides.filter((g) => g.kind === 'Tab').length, 2);
    assert.equal(road.jointGuides.filter((g) => g.kind === 'Socket').length, 2);
  });
});

test('the tab count follows the setting and the length of the edge', () => {
  build(piece({ tracksideSide: 'outer', length: 100 }), (parts) =>
    assert.equal(barriers(parts)[0].tabCount, 1));
  build(piece({ tracksideSide: 'outer', length: 100, tracksideTabs: '2' }), (parts) =>
    assert.equal(barriers(parts)[0].tabCount, 2));
  build(piece({ tracksideSide: 'outer', tracksideTabs: '1' }), (parts) =>
    assert.equal(barriers(parts)[0].tabCount, 1));
  // Too short for two tabs when two are asked for: say so.
  assert.throws(
    () => build(piece({ tracksideSide: 'outer', length: 30, tracksideTabs: '2' }), () => {}),
    /Outer barrier 1\. There is no room for 2 tab sockets/,
  );
});

test('with a border the barrier stands outside the border, one per border segment', () => {
  const p = piece({
    length: 400,
    borderSide: 'outer',
    borderEntry: 30,
    borderApex: 30,
    borderExit: 30,
    outerApexWidth: 30,
    borderSegments: 2,
    borderMount: 'tabs',
    tracksideSide: 'outer',
  });
  build(p, (parts) => {
    const found = barriers(parts);
    assert.deepEqual(found.map((part) => part.name), ['Outer barrier 1', 'Outer barrier 2']);
    for (const part of found) {
      near(size(part.solid)[0], 200);
      // Outside the 30 mm border, apart from its tabs.
      near(part.solid.boundingBox().max[1], 50 + 30 + BARRIER_FOOT);
      for (const other of parts)
        if (other !== part) near(overlap(part.solid, other.solid), 0, 0.01);
    }
    const borders = parts.filter((part) => part.role === 'border');
    for (const border of borders)
      assert.equal(border.jointGuides.filter((g) => g.kind === 'Socket').length >= 1, true);
  });
});

test('a bend gets curved barriers on both sides', () => {
  const p = { ...defaultTrack(), angle: 45, tracksideSide: 'both' };
  build(p, (parts) => {
    const [outer, inner] = barriers(parts);
    assert.ok(outer.solid.volume() > inner.solid.volume());
    for (const part of [outer, inner]) {
      assert.equal(part.solid.status(), 'NoError');
      near(size(part.solid)[2], p.height + 20);
      assert.equal(part.printPose, undefined, 'a curved barrier prints standing');
      for (const other of parts)
        if (other !== part) near(overlap(part.solid, other.solid), 0, 0.01);
    }
  });
});

test('the height above the road is a setting with limits', () => {
  build(piece({ tracksideSide: 'outer', tracksideRise: 35, height: 10 }), (parts) =>
    near(size(barriers(parts)[0].solid)[2], 45));
  for (const tracksideRise of [4, 101, NaN])
    assert.throws(() => validateTrack(trackParameters(piece({ tracksideRise }))), /between 5 and 100 mm/);
  assert.throws(() => validateTrack(trackParameters(piece({ tracksideSide: 'left' }))), /trackside side/);
  assert.throws(() => validateTrack(trackParameters(piece({ tracksideShape: 'fence' }))), /trackside shape/);
});

test('a straight barrier prints on its flat back with the tabs up', () => {
  const p = piece({ tracksideSide: 'both' });
  build(p, (parts) => {
    const fit = resolveJointFit(trackParameters(p));
    for (const part of barriers(parts)) {
      const laid = printableSTL(part, (solid) => size(solid), undefined, { mode: 'track', track: { params: p } });
      // Foot plus tab is the height on the bed; the barrier's own height lies flat.
      near(laid[2], BARRIER_FOOT + fit.tabLength);
      near(Math.max(laid[0], laid[1]), 200);
      near(Math.min(laid[0], laid[1]), 32);
      // The whole back rests on the bed.
      const area = printableSTL(part, (solid) => {
        const cut = solid.slice(0.01);
        try {
          return cut.area();
        } finally {
          cut.delete();
        }
      }, undefined, { mode: 'track', track: { params: p } });
      near(area, 200 * 32, 1);
    }
  });
});

test('barriers have their own family in the parts list and their own STL export', () => {
  const p = piece({ tracksideSide: 'both' });
  build(p, (parts) => {
    const group = groupTrackParts(parts).find((g) => g.role === 'barrier');
    assert.equal(group.label, 'Barriers');
    assert.equal(group.parts.length, 2);
    const files = unzipSync(packBarrierSTLs(parts, encodeSTL, { mode: 'track', track: { params: p } }));
    assert.deepEqual(Object.keys(files).sort(), ['barrier-inner-1.stl', 'barrier-outer-1.stl']);
  });
  build(piece(), (parts) =>
    assert.throws(() => packBarrierSTLs(parts, encodeSTL), /Switch on a barrier under Trackside/));
});

test('the Trackside section offers the barrier settings and older projects open without them', () => {
  const project = newProject();
  project.mode = 'track';
  project.track.params = piece({ tracksideSide: 'outer' });
  const html = trackInspector(project, 'trackside');
  for (const name of ['tracksideSide', 'tracksideShape', 'tracksideRise', 'tracksideTabs'])
    assert.match(html, new RegExp('name="' + name + '"'));
  assert.match(html, /Concrete barrier/);
  const old = newProject();
  for (const key of ['tracksideSide', 'tracksideShape', 'tracksideRise', 'tracksideTabs'])
    delete old.track.params[key];
  assert.equal(checkProject(JSON.parse(JSON.stringify(old))).track.params.tracksideSide, 'none');
});

test('barriers follow the segments of their edge and can be cut shorter', () => {
  // One barrier per road segment on a side without a border.
  build(piece({ length: 400, segments: 2, tracksideSide: 'outer' }), (parts) => {
    assert.equal(barriers(parts).length, 2);
    for (const part of barriers(parts)) near(size(part.solid)[0], 200);
  });
  // Three barriers per segment: six in all, each with its own tab, end to end.
  build(piece({ length: 600, segments: 2, tracksideSide: 'outer', tracksideSegments: 3 }), (parts) => {
    const found = barriers(parts);
    assert.deepEqual(found.map((part) => part.id), [1, 2, 3, 4, 5, 6].map((n) => 'barrier-outer-' + n));
    let total = 0;
    for (const part of found) {
      near(size(part.solid)[0], 100);
      assert.equal(part.tabCount, 1);
      total += size(part.solid)[0];
      for (const other of parts)
        if (other !== part) near(overlap(part.solid, other.solid), 0, 0.01);
    }
    near(total, 600);
  });
  for (const tracksideSegments of [0, 1.5, 17])
    assert.throws(
      () => validateTrack(trackParameters(piece({ tracksideSegments }))),
      /Barrier segments must be a whole number between 1 and 16/,
    );
});
