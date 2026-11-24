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

test('a sloped end runs the top down to the foot at the chosen end only', () => {
  const top = (solid, x, y) => solid.rayCast([x, y, 60], [x, y, -1])[0]?.position[2];
  const y = 50 + 12;
  const p = piece({ tracksideSide: 'outer', tracksideEnds: 'start' });
  build(p, (parts) => {
    const [barrier] = barriers(parts);
    assert.equal(barrier.solid.status(), 'NoError');
    // Just above the 12 mm foot at the very end, half way up half way along
    // the 25 mm slope, full height from there on and at the other end.
    near(top(barrier.solid, -99.99, y), 12.5, 0.02);
    near(top(barrier.solid, -100 + 12.5, y), 12 + (0.5 + 20) / 2, 0.02);
    near(top(barrier.solid, -100 + 25.5, y), 32);
    near(top(barrier.solid, 99.9, y), 32);
    near(size(barrier.solid)[0], 200);
  });
  build({ ...p, tracksideEnds: 'both', tracksideSegments: 2 }, (parts) => {
    const [first, second] = barriers(parts);
    // The slopes are at the two outer ends of the row, not where barriers meet.
    near(top(first.solid, -99.99, y), 12.5, 0.02);
    near(top(first.solid, -0.1, y), 32);
    near(top(second.solid, 0.1, y), 32);
    near(top(second.solid, 99.99, y), 12.5, 0.02);
  });
  build({ ...defaultTrack(), angle: 45, tracksideSide: 'both', tracksideEnds: 'both' }, (parts) => {
    for (const part of barriers(parts)) assert.equal(part.solid.status(), 'NoError');
  });
  assert.throws(() => validateTrack(trackParameters(piece({ tracksideEnds: 'round' }))), /Unknown barrier end/);
});

test('the face angle leans the sloped face more or less, and keeps a flat top', () => {
  // The measured barrier at its own angle.
  const measured = barrierProfile(8.3, 20);
  near(measured.find(([, z]) => Math.abs(z - (8.3 + 18.68)) < 1e-9)[0], 6.8, 0.01);
  // Upright: the face stays above the step all the way up.
  const upright = barrierProfile(8.3, 20, 0);
  near(upright.find(([, z]) => Math.abs(z - (8.3 + 18.68)) < 1e-9)[0], 1.06);
  // 30 degrees: tan(30) × 18.68 further in.
  const leaning = barrierProfile(8.3, 20, 30);
  near(leaning.find(([, z]) => Math.abs(z - (8.3 + 18.68)) < 1e-9)[0], 1.06 + Math.tan(Math.PI / 6) * 18.68);
  const volume = (tracksideFaceAngle) =>
    build(piece({ tracksideSide: 'outer', tracksideFaceAngle }), (parts) => {
      assert.equal(barriers(parts)[0].solid.status(), 'NoError');
      return barriers(parts)[0].solid.volume();
    });
  assert.ok(volume(0) > volume(17.1));
  assert.ok(volume(17.1) > volume(28));
  // A face that leans so far that the top gets thinner than 2 mm is refused, with the limit.
  assert.throws(
    () => validateTrack(trackParameters(piece({ tracksideFaceAngle: 40 }))),
    /top would be thinner than 2 mm\. Use at most 28\.\d degrees/,
  );
  // A lower barrier can lean further.
  validateTrack(trackParameters(piece({ tracksideFaceAngle: 40, tracksideRise: 10 })));
  for (const tracksideFaceAngle of [-1, 46, NaN])
    assert.throws(() => validateTrack(trackParameters(piece({ tracksideFaceAngle }))), /between 0 and 45 degrees/);
});

test('a rounded end also narrows to a tip at the track edge', () => {
  const p = piece({ tracksideSide: 'outer', tracksideEnds: 'start', tracksideEndShape: 'round', tracksideTabs: '1' });
  const depthAt = (solid, x) => {
    // Just above the table: how far the foot reaches out from the road edge.
    const cut = solid.slice(0.5);
    try {
      const ys = cut.toPolygons().flat().filter(([px]) => Math.abs(px - x) < 0.005).map(([, y]) => y);
      return Math.max(...ys) - 50;
    } finally {
      cut.delete();
    }
  };
  build(p, (parts) => {
    const [barrier] = barriers(parts);
    assert.equal(barrier.solid.status(), 'NoError');
    near(size(barrier.solid)[0], 200);
    // A 1 mm blunt tip at the end, the full 15 mm foot after the 25 mm slope,
    // and a quarter-round outline between them.
    near(depthAt(barrier.solid, -100), 1, 0.05);
    near(depthAt(barrier.solid, -75), 15, 0.05);
    const half = depthAt(barrier.solid, -100 + 25 * 0.48);
    near(half, 1 + 14 * Math.sqrt(1 - 0.52 ** 2), 0.1);
    near(depthAt(barrier.solid, 100), 15, 0.05);
    for (const other of parts)
      if (other !== barrier) near(overlap(barrier.solid, other.solid), 0, 0.01);
  });
  build({ ...defaultTrack(), angle: 45, tracksideSide: 'both', tracksideEnds: 'both', tracksideEndShape: 'round' }, (parts) => {
    for (const part of barriers(parts)) assert.equal(part.solid.status(), 'NoError');
  });
  assert.throws(() => validateTrack(trackParameters(piece({ tracksideEndShape: 'point' }))), /Unknown barrier end shape/);
});

// ---- Advertising boards and catch fences ----
const boardPiece = (changes = {}) =>
  piece({ length: 172.5, tracksideSide: 'outer', tracksideShape: 'board', ...changes });
const fences = (parts) => parts.filter((part) => part.role === 'fence');

test('an advertising board is a flat wall of the set thickness, on tabs', () => {
  build(boardPiece(), (parts) => {
    const [board] = barriers(parts);
    assert.equal(board.id, 'board-outer-1');
    assert.equal(board.name, 'Outer board 1');
    assert.equal(board.solid.status(), 'NoError');
    const fit = resolveJointFit(trackParameters(boardPiece()));
    const [length, depth, height] = size(board.solid);
    near(length, 172.5);
    // 2 mm of board and the tab in front of it: the tab root is trimmed at the back.
    near(depth, 2 + fit.tabLength);
    near(height, 12 + 20);
    near(board.solid.boundingBox().max[1], 50 + 2);
    assert.equal(fences(parts).length, 0);
    const road = parts.find((part) => part.role === 'road');
    near(overlap(board.solid, road.solid), 0, 1e-6);
    // Flat on its back: the thickness of the board and its tab stand up from the bed.
    const laid = printableSTL(board, (solid) => size(solid), undefined, { mode: 'track', track: { params: boardPiece() } });
    near(laid[2], 2 + fit.tabLength);
  });
  build(boardPiece({ tracksideThickness: 4, tracksideRise: 40 }), (parts) => {
    const [, depth, height] = size(barriers(parts)[0].solid);
    near(depth, 4 + 6);
    near(height, 52);
  });
  assert.throws(() => validateTrack(trackParameters(boardPiece({ tracksideThickness: 1 }))), /board thickness must be between 1.2 and 15 mm/);
});

test('a board end has a rounded top corner', () => {
  const top = (solid, x) => solid.rayCast([x, 51, 90], [x, 51, -1])[0]?.position[2];
  build(boardPiece({ tracksideEnds: 'start' }), (parts) => {
    const [board] = barriers(parts);
    assert.equal(board.solid.status(), 'NoError');
    // A 25 mm quarter round: 25 mm lower at the very end, full height after it.
    near(top(board.solid, -86.24), 32 - 25, 0.8);
    near(top(board.solid, -86.25 + 25 * 0.48), 32 - 25 + 25 * Math.sqrt(1 - 0.52 ** 2), 0.05);
    near(top(board.solid, -86.25 + 25.5), 32);
    near(top(board.solid, 86), 32);
  });
});

test('a fence stands in two sockets in the top of a thicker board', () => {
  const p = boardPiece({ tracksideFence: true });
  build(p, (parts) => {
    const [board] = barriers(parts),
      [fence] = fences(parts);
    assert.equal(fence.id, 'fence-outer-1');
    assert.equal(fence.name, 'Outer fence 1');
    assert.equal(fence.solid.status(), 'NoError');
    // Thick enough for a 1.25 mm wall and 0.15 mm of play on both sides of a 3 mm post.
    near(board.solid.boundingBox().max[1], 50 + 5.8);
    // The fence: 50 mm above the board, its pegs 9.5 mm into it, nothing touching.
    const box = fence.solid.boundingBox();
    near(box.max[2], 32 + 50);
    near(box.min[2], 32 - 9.5);
    near(overlap(fence.solid, board.solid), 0, 1e-6);
    // A post at a quarter and at three quarters of the length, in the middle of the board.
    for (const x of [-43.125, 43.125]) {
      const post = fence.solid.slice(32 - 5);
      try {
        const corners = post.toPolygons().flat().filter(([px]) => Math.abs(px - x) < 2);
        assert.ok(corners.length >= 4, 'a post in the socket: ' + corners.length);
        near(Math.min(...corners.map(([px]) => px)), x - 1.5);
        near(Math.max(...corners.map(([px]) => px)), x + 1.5);
        near(Math.min(...corners.map(([, y]) => y)), 50 + 2.9 - 1.5);
        near(Math.max(...corners.map(([, y]) => y)), 50 + 2.9 + 1.5);
      } finally {
        post.delete();
      }
      // The socket: 10 mm deep and open at the top.
      near(board.solid.rayCast([x, 52.9, 90], [x, 52.9, -1])[0].position[2], 32 - 10);
    }
  });
  // No fence on a concrete barrier, and none on a board too short for two posts.
  build(piece({ tracksideSide: 'outer', tracksideFence: true }), (parts) => assert.equal(fences(parts).length, 0));
  build(boardPiece({ length: 35, tracksideFence: true, tracksideTabs: '1' }), (parts) => assert.equal(fences(parts).length, 0));
});

test('a fence prints flat in one piece: posts full thickness, mesh a thin skin', () => {
  const p = boardPiece({ tracksideFence: true, tracksideFenceHeight: 60, tracksidePost: 3 });
  build(p, (parts) => {
    const [fence] = fences(parts);
    const project = { mode: 'track', track: { params: p } };
    const laid = printableSTL(fence, (solid) => size(solid), undefined, project);
    near(laid[2], 3);
    near(Math.max(laid[0], laid[1]), 172.5 - 0.6);
    near(Math.min(laid[0], laid[1]), 60 + 9.5);
    // Everything starts on the bed, and only the posts reach above the skin.
    const areas = printableSTL(fence, (solid) => [0.4, 2].map((z) => {
      const cut = solid.slice(z);
      try {
        return cut.area();
      } finally {
        cut.delete();
      }
    }), undefined, project);
    near(areas[1], 2 * 3 * 69.5, 0.5);
    assert.ok(areas[0] > areas[1] * 3, 'the mesh, cables and frame lie on the bed');
    assert.equal(printableSTL(fence, (solid) => solid.decompose().length, undefined, project), 1);
  });
});

test('on a bend the fence follows the board and still prints flat', () => {
  const p = { ...defaultTrack(), angle: 45, tracksideSide: 'both', tracksideShape: 'board', tracksideFence: true };
  build(p, (parts) => {
    assert.equal(fences(parts).length, 2);
    for (const fence of fences(parts)) {
      assert.equal(fence.solid.status(), 'NoError');
      assert.ok(fence.solid.volume() > 0);
      for (const other of parts)
        if (other !== fence) near(overlap(fence.solid, other.solid), 0, 0.02);
      const laid = printableSTL(fence, (solid) => size(solid), undefined, { mode: 'track', track: { params: p } });
      near(laid[2], 3);
    }
  });
});

test('fences have their own family and join the barrier export', () => {
  const p = boardPiece({ tracksideFence: true });
  build(p, (parts) => {
    assert.equal(groupTrackParts(parts).find((g) => g.role === 'fence').label, 'Fences');
    const files = unzipSync(packBarrierSTLs(parts, encodeSTL, { mode: 'track', track: { params: p } }));
    assert.deepEqual(Object.keys(files).sort(), ['board-outer-1.stl', 'fence-outer-1.stl']);
  });
  for (const [key, text] of [
    ['tracksideFenceHeight', /fence height must be between 10 and 250 mm/],
    ['tracksidePost', /fence post size must be between 2 and 6 mm/],
    ['tracksideCable', /fence cable spacing must be between 3 and 100 mm/],
    ['tracksideMesh', /fence mesh size must be between 2 and 30 mm/],
  ])
    assert.throws(() => validateTrack(trackParameters(boardPiece({ [key]: 1 }))), text);
  // A tall board does not have to satisfy the face angle of a concrete barrier.
  validateTrack(trackParameters(boardPiece({ tracksideRise: 60 })));
});

test('with barriers on both sides the inside can have settings of its own', () => {
  const p = piece({
    length: 172.5,
    tracksideSide: 'both',
    tracksideInnerOwn: true,
    // Outside: an advertising board with a fence, 30 mm above the road.
    tracksideShape: 'board',
    tracksideRise: 30,
    tracksideFence: true,
    // Inside: a lower concrete barrier in two halves, sloped at its start.
    tracksideShapeInner: 'barrier',
    tracksideRiseInner: 15,
    tracksideSegmentsInner: 2,
    tracksideEndsInner: 'start',
    tracksideTabsInner: '1',
  });
  build(p, (parts) => {
    assert.deepEqual(
      parts.filter((part) => ['barrier', 'fence'].includes(part.role)).map((part) => part.id),
      ['board-outer-1', 'fence-outer-1', 'barrier-inner-1', 'barrier-inner-2'],
    );
    const [board, first, second] = barriers(parts);
    near(board.solid.boundingBox().max[1], 50 + 5.8);
    near(size(board.solid)[2], 12 + 30);
    near(size(board.solid)[0], 172.5);
    for (const half of [first, second]) {
      near(size(half.solid)[2], 12 + 15);
      near(size(half.solid)[0], 172.5 / 2);
      assert.equal(half.tabCount, 1);
      near(half.solid.boundingBox().min[1], -50 - BARRIER_FOOT);
    }
    // The slope is at the start of the inside row only.
    const top = (solid, x) => solid.rayCast([x, -62, 90], [x, -62, -1])[0]?.position[2];
    near(top(first.solid, -86.24), 12.5, 0.02);
    near(top(second.solid, 86.2), 27);
    for (const part of [board, first, second, ...fences(parts)]) assert.equal(part.solid.status(), 'NoError');
  });
  // Switched off, or with one side only, the one set decides.
  build({ ...p, tracksideInnerOwn: false }, (parts) =>
    assert.deepEqual(barriers(parts).map((part) => part.id), ['board-outer-1', 'board-inner-1']));
  build({ ...p, tracksideSide: 'inner' }, (parts) =>
    assert.deepEqual(barriers(parts).map((part) => part.id), ['board-inner-1']));
  // Each set is checked for itself, and a fault on the inside says so.
  assert.throws(
    () => validateTrack(trackParameters({ ...p, tracksideShapeInner: 'hedge' })),
    /Inside barrier: Unknown trackside shape/,
  );
  assert.throws(
    () => validateTrack(trackParameters({ ...p, tracksideRiseInner: 60 })),
    /Inside barrier: The barrier face leans too far/,
  );
  // A tall board outside does not have to meet the face angle of the barrier inside.
  validateTrack(trackParameters({ ...p, tracksideRise: 60 }));
  // An unused inside set is not checked.
  validateTrack(trackParameters({ ...p, tracksideInnerOwn: false, tracksideRiseInner: 60 }));
  // Track Set shows both sets, each with the fields of its own shape.
  const project = newProject();
  project.mode = 'track';
  project.track.params = trackParameters(p);
  const html = trackInspector(project, 'trackside');
  for (const name of ['tracksideInnerOwn', 'tracksideShapeInner', 'tracksideRiseInner', 'tracksideFenceInner'])
    assert.match(html, new RegExp('name="' + name + '"'));
  assert.match(html, /Outside barrier/);
  assert.match(html, /Inside barrier/);
  assert.match(html, /data-trackside-shape="board" data-trackside-set="">/);
  assert.match(html, /data-trackside-shape="barrier" data-trackside-set="Inner">/);
  assert.match(html, /data-trackside-shape="board" data-trackside-set="Inner" hidden/);
});

test('the planner reads and writes barriers per side of a piece recipe', async () => {
  const { applyBarriers, barrierOf, plainBarrier } = await import('../src/planner-model.js');
  const recipe = (params) => ({ track: { params } });
  const none = plainBarrier({ kind: 'none' });
  assert.deepEqual(barrierOf(recipe({})), { outer: none, inner: none });
  const board = { ...none, kind: 'board', rise: 30, fence: true, fenceHeight: 70 },
    wall = { ...none, kind: 'barrier', rise: 15, ends: 'finish' };
  for (const wanted of [
    { outer: board, inner: wall },
    { outer: wall, inner: none },
    { outer: none, inner: board },
    { outer: none, inner: none },
  ]) {
    const params = { ...defaultTrack() };
    applyBarriers(params, wanted);
    assert.deepEqual(barrierOf(recipe(params)), wanted);
    validateTrack(trackParameters(params));
  }
  const both = { ...defaultTrack() };
  applyBarriers(both, { outer: board, inner: wall });
  assert.equal(both.tracksideSide, 'both');
  assert.equal(both.tracksideInnerOwn, true);
  assert.equal(both.tracksideShape, 'board');
  assert.equal(both.tracksideShapeInner, 'barrier');
  assert.equal(both.tracksideRiseInner, 15);
  // One shared set on both sides reads as the same answer twice.
  assert.deepEqual(
    barrierOf(recipe({ ...defaultTrack(), tracksideSide: 'both', tracksideShape: 'board' })).inner.kind,
    'board',
  );
});
