import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { defaultTrack, buildTrack, buildTestJoint, validateTrack } from '../src/track.js';
import { defaultStartingGrid, startingGridLayout } from '../src/geometry/starting-grid.js';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { printableSTL } from '../src/kit.js';
import { laneOffsetAt } from '../src/lane-adjustment.js';

const wasm = await Module();
wasm.setup();

function straight(lanes = 2) {
  const p = {
    ...defaultTrack(), kind: 'straight', length: 200, width: 100 * lanes,
    lanes, laneSpacing: 100, height: 10, slotDepth: 8, braidGap: 0.6,
  };
  return { ...p, startingGrid: defaultStartingGrid(p) };
}

// Measure painted intervals on a horizontal section through the road.
function spans(loops, y) {
  const spans = [];
  for (const loop of loops) {
    const xs = [];
    for (const [i, [x0, y0]] of loop.entries()) {
      const [x1, y1] = loop[(i + 1) % loop.length];
      if ((y0 <= y) !== (y1 <= y)) xs.push(x0 + (x1 - x0) * (y - y0) / (y1 - y0));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i < xs.length; i += 2) spans.push([xs[i], xs[i + 1]]);
  }
  return spans.sort((a, b) => a[0] - b[0]);
}

test('grid strokes have the specified width, thickness and leg length and stagger along the driving direction', () => {
  const p = straight();
  assert.deepEqual(p.startingGrid, { width: 72, thickness: 3, legLength: 35, stagger: 45, recessed: false });
  for (const stagger of [45, 0, -45]) {
    p.startingGrid.stagger = stagger;
    const { paint, grooves } = startingGridLayout(p);
    assert.equal(paint.length, 4);
    assert.deepEqual(grooves, []);
    for (const side of [-1, 1]) {
      const front = 19 + side * stagger / 2, y = side * 50;
      assert.deepEqual(spans(paint, y + 20), [[front - 3, front]]);
      assert.deepEqual(spans(paint, y + 35.99), [[front - 38, front]]);
      assert.deepEqual(spans(paint, y - 35.99), [[front - 38, front]]);
      assert.deepEqual(spans(paint, y + side * 36.01), []);
      // Guide, both braid shelves and a small painting margin are clear.
      assert.deepEqual(spans(paint, y), []);
      assert.deepEqual(spans(paint, y - 7.49), []);
      assert.deepEqual(spans(paint, y + 7.49), []);
      assert.deepEqual(spans(paint, y + 7.51), [[front - 3, front]]);
    }
  }
  const one = straight(1);
  Object.assign(one.startingGrid, { legLength: 0, thickness: 2, width: 50, stagger: 180 });
  assert.deepEqual(spans(startingGridLayout(one).paint, 24.99), [[-1, 1]]);
  assert.deepEqual(spans(startingGridLayout(one).paint, -8), [[-1, 1]]);
  assert.deepEqual(spans(startingGridLayout(one).paint, 25.01), []);
  const four = straight(4);
  const { paint } = startingGridLayout(four);
  assert.deepEqual(spans(paint, 150 + 18), spans(paint, -50 + 18));
  assert.deepEqual(spans(paint, 50 + 18), spans(paint, -150 + 18));
  assert.notDeepEqual(spans(paint, 150 + 18), spans(paint, 50 + 18));
});

test('grid fit errors identify the mark, guide or edge that needs more room', () => {
  const p = straight();
  function withMark(fields) {
    return { ...p, startingGrid: { ...p.startingGrid, ...fields } };
  }
  assert.throws(() => validateTrack(withMark({ stagger: Infinity })), /finite/);
  assert.throws(() => validateTrack(withMark({ thickness: 0 })), /thickness/i);
  assert.throws(() => validateTrack(withMark({ legLength: 180 })), /Shorten the legs/);
  assert.throws(() => validateTrack(withMark({ width: 14 })), /guide slot or braid/);
  assert.throws(() => validateTrack({ ...withMark({ width: 95 }), whiteLineRoad: 'both' }), /white line/);
  assert.throws(() => validateTrack({ ...p, kind: 'curve' }), /regular straight/);
  assert.throws(() => validateTrack({ ...p, startingGrid: null }), /valid starting grid/);
  const wideBraids = { ...p, braidWidth: 36 };
  wideBraids.startingGrid = defaultStartingGrid(wideBraids);
  assert.ok(wideBraids.startingGrid.width > 2 * wideBraids.braidWidth);
  assert.doesNotThrow(() => validateTrack(wideBraids));
});

test('a tapered border transfers its shared white line onto the deck clear of the grid', t => {
  const p = {
    ...straight(), borderSide: 'outer', whiteLineRoad: 'outer', whiteLineBorder: 'outer', whiteLineWidth: 8,
    borderEnds: { outer: { finish: { shape: 'tapered', length: 'short', at: 0.5 } } },
  };
  const parts = buildTrack(wasm, p);
  t.after(() => parts.forEach(part => part.solid.delete()));
  assert.ok(parts.some(part => part.role === 'border' && part.kerbMarkings?.length));
  // At the grid, the border has ended and all 8 mm of stripe occupy the road.
  p.startingGrid.width = 89;
  assert.throws(() => buildTrack(wasm, p), /overlaps the road white line at the border end/);
});

test('grid geometry follows native straight lane adjustments without covering the braid', t => {
  const p = straight();
  Object.assign(p, { length: 300, laneAdjustment: { version: 1, mode: 'squeeze', spacingMm: 80, anchor: 'centre' } });
  Object.assign(p.startingGrid, { width: 50, legLength: 20, stagger: 0 });
  const { paint } = startingGridLayout(p);
  const x = p.startingGrid.legLength / 2;
  for (const lane of [0, 1]) {
    const centre = laneOffsetAt(p, lane, 0.5 + x / p.length);
    assert.deepEqual(spans(paint, centre), []);
    assert.deepEqual(spans(paint, centre + 7.4), []);
    assert.deepEqual(spans(paint, centre - 7.4), []);
    assert.deepEqual(spans(paint, centre + 8), [[x - 1.5, x + 1.5]]);
  }
  const parts = buildTrack(wasm, p);
  t.after(() => parts.forEach(part => part.solid.delete()));
  assert.ok(parts[0].kerbMarkings.some(mark => mark.color === '#FFFFFF'));
});

test('paint-only grids preserve STL solids, including borders and joint samples', t => {
  const p = { ...straight(), borderSide: 'both', whiteLineBorder: 'both', jointStart: 'tabs' };
  const plain = buildTrack(wasm, { ...p, startingGrid: undefined });
  t.after(() => plain.forEach(part => part.solid.delete()));
  const painted = buildTrack(wasm, p);
  t.after(() => painted.forEach(part => part.solid.delete()));
  for (const [i, part] of painted.entries()) {
    assert.deepEqual(encodeSTL(part.solid), encodeSTL(plain[i].solid));
    if (part.role === 'road') assert.ok(part.kerbMarkings.some(mark => mark.color === '#FFFFFF'));
    else assert.deepEqual(part.kerbMarkings, plain[i].kerbMarkings);
  }
  p.startingGrid.legLength = 130;
  const sample = buildTestJoint(wasm, p, 'start');
  t.after(() => sample.forEach(part => part.solid.delete()));
  assert.ok(sample.every(part => !part.kerbMarkings?.length));
});

test('each painted grid island has a closed groove in the printable single- and two-lane straights', t => {
  for (const lanes of [1, 2]) {
    for (const legLength of [0, 35]) {
      const p = { ...straight(lanes), grooveWidth: 0.8, grooveDepth: 0.4 };
      Object.assign(p.startingGrid, { recessed: true, legLength });
      const { paint, grooves } = startingGridLayout(p);
      assert.equal(paint.length, 2 * lanes);
      assert.equal(grooves.length, 2 * paint.length, 'one outer and one inner contour per half-mark');

      const parts = buildTrack(wasm, p), road = parts.find(part => part.role === 'road');
      t.after(() => parts.forEach(part => part.solid.delete()));
      const solid = parseSTL(wasm, printableSTL(road, encodeSTL, undefined, { mode: 'track', track: { params: p } }));
      t.after(() => solid.delete());
      function checkFloor(x, y, depth) {
        const hit = solid.rayCast([x, y, p.height + 1], [x, y, -1])[0];
        assert.ok(Math.abs(hit?.position[2] - (p.height - depth)) < 0.001,
          lanes + '-lane grid with ' + legLength + ' mm legs at (' + x + ', ' + y + ') needs depth ' + depth);
      }
      // Check every leg side, free tip, crossbar edge and cut end. The paint
      // polygons run counter-clockwise, so the right normal points outward.
      for (const ring of paint) {
        for (const [i, a] of ring.entries()) {
          const b = ring[(i + 1) % ring.length];
          const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
          for (const [distance, depth] of [[-0.1, 0], [0.05, 0.4], [0.75, 0.4], [0.9, 0]]) {
            checkFloor((a[0] + b[0]) / 2 + distance * dy / length,
              (a[1] + b[1]) / 2 - distance * dx / length, depth);
          }
        }
      }
      // Both cap grooves end 0.4 mm before the 7.1 mm braid shoulder.
      for (const y of lanes === 1 ? [0] : [-50, 50]) {
        const x = legLength / 2 + Math.sign(y) * p.startingGrid.stagger / 2;
        checkFloor(x, y, p.slotDepth);
        for (const sign of [-1, 1]) {
          for (const [offset, depth] of [[6.9, p.braidDepth], [7.3, 0], [7.6, 0.4], [8.2, 0.4], [8.4, 0]])
            checkFloor(x, y + sign * offset, depth);
        }
      }
    }
  }
});

test('recessed grid outlines survive STL export on both sides of a road print seam', t => {
  const p = {
    ...straight(), segments: 2, borderSegments: 2, borderSide: 'both',
    whiteLineRoad: 'both', whiteLineBorder: 'both', grooveWidth: 0.8, grooveDepth: 0.4,
  };
  Object.assign(p.startingGrid, { width: 64, thickness: 4, legLength: 40, stagger: 0, recessed: true });
  const parts = buildTrack(wasm, p);
  t.after(() => parts.forEach(part => part.solid.delete()));
  const roads = parts.filter(part => part.role === 'road');
  assert.equal(roads.length, 2);
  for (const part of roads) {
    const { min, max } = part.solid.boundingBox();
    const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2;
    const solid = parseSTL(wasm, printableSTL(part, encodeSTL, undefined, { mode: 'track', track: { params: p } }));
    try {
      const x = Math.sign(cx) - cx; // one millimetre either side of the seam
      for (const [offset, depth] of [[27, 0], [27.6, 0.4], [28.1, 0], [31.9, 0], [32.4, 0.4], [33, 0]]) {
        const y = 50 + offset - cy;
        const hit = solid.rayCast([x, y, p.height + 1], [x, y, -1])[0];
        assert.ok(Math.abs(hit?.position[2] - (p.height - depth)) < 0.001,
          part.id + ' at ' + offset + ' mm from guide, expected a ' + depth + ' mm groove');
      }
    } finally { solid.delete(); }
  }
});
