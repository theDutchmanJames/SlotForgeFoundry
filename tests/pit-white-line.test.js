import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { defaultTrack, buildTrack } from '../src/track.js';
import { specialTrackParams, specialPreview } from '../src/special-pieces.js';
import { pitLayout } from '../src/geometry/special-junction-paths.js';
import { turnoutOutline } from '../src/geometry/pit-turnout.js';
import { SolidWorkshop } from '../src/geometry/solids.js';
import { printableSTL } from '../src/kit.js';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { wiringDiagram, assemblyNotes } from '../src/special-print.js';
import { toolGuides } from '../src/guide-geometry.js';

const wasm = await Module();
wasm.setup();

function pit(side, lanes) {
  const p = specialTrackParams('pit', {
    ...defaultTrack(), width: lanes * 100, lanes, laneSpacing: 100, height: 10, slotDepth: 8,
    whiteLineWidth: 4, grooveWidth: 0.8, grooveDepth: 0.35, borderSide: 'both',
  });
  Object.assign(p.special, { side, pitContactMode: 'braid' });
  return p;
}

// Intersect the plan with a vertical section. Each pair gives the measured
// edges of one painted band, including any shared approach to mirrored pits.
function bandsAtX(loops, x) {
  const bands = [];
  for (const loop of loops) {
    const ys = [];
    for (const [i, [ax, ay]] of loop.entries()) {
      const [bx, by] = loop[(i + 1) % loop.length];
      if ((ax <= x) !== (bx <= x)) ys.push(ay + (x - ax) * (by - ay) / (bx - ax));
    }
    ys.sort((a, b) => a - b);
    for (let i = 0; i < ys.length; i += 2) bands.push([ys[i], ys[i + 1]]);
  }
  return bands.sort((a, b) => a[0] - b[0]);
}

// Probe perpendicular to an actual pit guide segment, away from vertices.
function inwardFromLane(p, branch, sign, station, distance) {
  const x = (station - 0.5) * p.length;
  const i = branch.findIndex(([bx]) => bx > x);
  const [ax, ay] = branch[i - 1], [bx, by] = branch[i];
  const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
  return [x + sign * distance * dy / length, ay + (x - ax) * dy / dx - sign * distance * dx / length];
}

test('pit dividers align with the original road edge and clear slots, braids, feeds and blade travel', () => {
  const w = new SolidWorkshop(wasm);
  try {
    for (const [side, lanes] of [['left', 1], ['right', 2], ['both', 2]]) {
      const p = pit(side, lanes);
      p.length = 1050;
      p.special.pitOffset = 200;
      if (lanes === 1) p.laneSpacing = 70;
      delete p.special.pitWhiteLine;
      assert.deepEqual(specialPreview(p).pitWhiteLines, []);
      assert.doesNotMatch(wiringDiagram(p), /Pit divider stripe/);
      p.special.pitWhiteLine = true;
      p.roadLineGroove = true;
      const plan = specialPreview(p), geometry = pitLayout(p);
      assert.equal(wiringDiagram(p).match(/Pit divider stripe/g).length, plan.pitWhiteLines.length);
      assert.match(assemblyNotes(p), /4 mm white divider/);
      const footprint = w.own(w.section(plan.pitWhiteLines).add(w.section(plan.pitWhiteLineGrooves)));
      const keepouts = [
        ...plan.conductors.map(rail => rail.polygon),
        ...plan.jumpers.flatMap(j => j.openings.map(o => o.outline)),
        ...geometry.forks.flatMap(f => [0, 0.25, 0.5, 0.75, 1].map(t => turnoutOutline(f, t))),
        ...geometry.lanePaths.slice(0, lanes).map(([[a, y], [b]]) => [
          [a, y - p.slotWidth / 2], [b, y - p.slotWidth / 2], [b, y + p.slotWidth / 2], [a, y + p.slotWidth / 2],
        ]),
      ];
      for (const loop of keepouts)
        assert.ok(w.own(footprint.intersect(w.section([loop]))).area() < 1e-6, 'paint and grooves clear the running gear');
      assert.ok(w.own(footprint.subtract(w.section(plan.outlines))).area() < 1e-6, 'stripe stays on the deck');
      const box = bandsAtX(plan.pitWhiteLines, 0);
      assert.equal(box.length, geometry.forks.length);
      for (const [i, fork] of geometry.forks.entries()) {
        const branch = geometry.lanePaths[lanes + i];
        const base = branch[0][1], sign = fork.sign;
        const [lo, hi] = box.find(([a, b]) => sign * ((a + b) / 2) > 0);
        assert.ok(Math.abs(hi - lo - p.whiteLineWidth) < 0.02);
        const boxY = (lo + hi) / 2;
        assert.ok(Math.abs(boxY - sign * (p.width - p.whiteLineWidth) / 2) < 0.02,
          'the wide pit projects the main road edge stripe into the middle of the piece');
        const nominal = (lanes > 1 ? p.laneSpacing : p.width) / 2;
        const leadOffset = lanes > 1 ? nominal : nominal - p.whiteLineWidth / 2 - p.grooveWidth - 1;
        for (const x of [-0.49 * p.length, 0.49 * p.length]) {
          const lead = bandsAtX(plan.pitWhiteLines, x);
          assert.equal(lead.length, 1, 'one stripe on the shared straight');
          assert.ok(Math.abs((lead[0][0] + lead[0][1]) / 2 - (base - sign * leadOffset)) < 0.15);
        }
        const deeper = structuredClone(p);
        deeper.special.pitOffset = 270;
        const second = specialPreview(deeper);
        for (const station of [0.15, 0.26, 0.74, 0.85]) {
          const x = (station - 0.5) * p.length;
          const a = bandsAtX(plan.pitWhiteLines, x), b = bandsAtX(second.pitWhiteLines, x);
          assert.equal(a.length, b.length);
          a.forEach((band, j) => band.forEach((y, k) =>
            assert.ok(Math.abs(y - b[j][k]) < 0.12, 'moving the pit slot leaves the painted approach in place')));
        }
      }
      p.whiteLineWidth = 150;
      assert.throws(() => specialPreview(p), /stripe cannot fit/);
    }
    const wide = pit('left', 1);
    Object.assign(wide, { length: 740, whiteLineWidth: 45 });
    Object.assign(wide.special, { pitOffset: 150, pitWhiteLine: true });
    assert.ok(specialPreview(wide).pitWhiteLines.length > 0);
    const narrow = pit('left', 2);
    Object.assign(narrow.special, { pitOffset: 35, pitWhiteLine: true });
    const [[lo, hi]] = bandsAtX(specialPreview(narrow).pitWhiteLines, 0);
    const mainY = narrow.laneSpacing / 2, shelf = narrow.slotWidth / 2 + narrow.braidGap + narrow.braidWidth;
    assert.ok(lo > mainY + shelf && hi < mainY + narrow.special.pitOffset - shelf,
      'a narrow pit keeps its divider between the two braid shelves in the pit box');
  } finally { w.close(); }
});

test('enabling flat pit paint colours the single-lane road and preserves the printable solids', t => {
  const p = pit('right', 1);
  const plain = buildTrack(wasm, p);
  t.after(() => plain.forEach(part => part.solid.delete()));
  p.special.pitWhiteLine = true;
  const painted = buildTrack(wasm, p);
  t.after(() => painted.forEach(part => part.solid.delete()));
  for (const [i, part] of painted.entries()) {
    assert.deepEqual(encodeSTL(plain[i].solid), encodeSTL(part.solid));
    assert.equal(!!part.kerbMarkings?.length, part.role === 'road');
    assert.ok((part.kerbMarkings ?? []).every(mark => mark.color === '#FFFFFF'));
  }
});

test('a tight pit ramp eases into the straight box on both sides of its painted band', () => {
  const p = pit('left', 2);
  p.special.pitWhiteLine = true;
  for (const [length, offset] of [[600, 100], [480, 80]]) {
    p.length = length;
    p.special.pitOffset = offset;
    const target = (p.width - p.whiteLineWidth) / 2;
    let largestTurn = 0;
    for (const loop of specialPreview(p).pitWhiteLines) {
      for (const [i, [x, y]] of loop.entries()) {
        if (Math.abs(y - target) > 9 || Math.abs(x) < 0.08 * length || Math.abs(x) > 0.23 * length) continue;
        const [ax, ay] = loop[(i + loop.length - 1) % loop.length], [bx, by] = loop[(i + 1) % loop.length];
        if ((x - ax) * (bx - x) <= 1e-10) continue;
        const turn = Math.abs(Math.atan((by - y) / (bx - x)) - Math.atan((y - ay) / (x - ax)));
        largestTurn = Math.max(largestTurn, turn * 180 / Math.PI);
      }
    }
    assert.ok(largestTurn > 0 && largestTurn < 6,
      `the ${length} mm pit should ease into its box, largest paint-edge turn was ${largestTurn.toFixed(2)} degrees`);
  }
});

test('mirrored pit paint grooves export at their selected width and depth on each side of a print seam', t => {
  const p = pit('both', 2);
  Object.assign(p, { segments: 2, borderSegments: 2, whiteLineRoad: 'both', whiteLineBorder: 'both', roadLineGroove: true });
  p.special.pitWhiteLine = true;
  p.special.pitOffset = 100;
  const parts = buildTrack(wasm, p);
  t.after(() => parts.forEach(part => part.solid.delete()));
  const project = { mode: 'track', track: { params: p } };
  const roads = parts.filter(part => part.role === 'road');
  const geometry = pitLayout(p);
  assert.equal(roads.length, 4);
  assert.ok(parts.filter(part => part.role === 'border').every(part => part.kerbMarkings.some(m => m.color === '#FFFFFF')));
  for (const part of roads) {
    const solid = parseSTL(wasm, printableSTL(part, encodeSTL, undefined, project));
    try {
      const { min, max } = part.solid.boundingBox();
      const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2;
      const sign = Math.sign(cy);
      function checkDepth([x, y], depth) {
        const point = [x - cx, cy - y];
        const hit = solid.rayCast([...point, -1], [...point, p.height + 1])[0];
        assert.ok(Math.abs(hit?.position[2] - depth) < 0.001,
          `${part.id} at ${x.toFixed(2)}, ${y.toFixed(2)}: expected ${depth} mm, got ${hit?.position[2]}`);
      }
      // Probe both edges of the paint and their full groove widths right up
      // to the print seam. The painted centre carries through the joint.
      for (const side of [-1, 1]) {
        for (const [offset, depth] of [[0, 0], [1.95, 0], [2.05, 0.35], [2.75, 0.35], [2.85, 0]]) {
          checkDepth([0.1 * Math.sign(cx), sign * (p.special.pitOffset + side * offset)], depth);
        }
      }
      // The two branches share a single painted line at the ends. A
      // lengthwise assembly split must leave the middle of that line flush.
      for (const [y, depth] of [[0.1, 0], [1.95, 0], [2.4, p.grooveDepth], [2.85, 0]]) {
        checkDepth([Math.sign(cx) * p.length * 0.48, sign * y], depth);
      }
      // Away from the seam the same dimensions are measured across the
      // bend, perpendicular to the local direction of the guide.
      const branch = geometry.lanePaths[p.lanes + geometry.forks.findIndex(f => f.sign === sign)];
      for (const side of [-1, 1]) {
        for (const [across, depth] of [[1.5, 0], [2.4, p.grooveDepth], [3.2, 0]]) {
          const point = inwardFromLane(p, branch, sign, cx < 0 ? 0.26 : 0.74, p.laneSpacing / 2 + side * across);
          checkDepth(point, depth);
        }
      }
    } finally { solid.delete(); }
  }
});

test('single-lane pit STL closes the paint outline at both road ports and all four braid interruptions', t => {
  const p = pit('left', 1);
  Object.assign(p, { roadLineGroove: true, whiteLineRoad: 'none', whiteLineBorder: 'none' });
  p.special.pitWhiteLine = true;
  const plan = specialPreview(p);
  const parts = buildTrack(wasm, p);
  t.after(() => parts.forEach(part => part.solid.delete()));
  const meshes = parts.filter(part => part.role === 'road').map(part => {
    const project = { mode: 'track', track: { params: p } };
    const solid = parseSTL(wasm, printableSTL(part, encodeSTL, undefined, project));
    t.after(() => solid.delete());
    const { min, max } = part.solid.boundingBox();
    return { solid, cx: (min[0] + max[0]) / 2, cy: (min[1] + max[1]) / 2 };
  });
  function depth(x, y, expected) {
    // A pit can have multiple printable road islands. Find the first
    // surface seen from the print bed in their assembled coordinates.
    const hits = meshes.flatMap(({ solid, cx, cy }) => {
      const xy = [x - cx, cy - y];
      return solid.rayCast([...xy, -1], [...xy, p.height + 1]).map(hit => hit.position[2]);
    });
    const first = Math.min(...hits);
    assert.ok(Math.abs(first - expected) < 0.001, `(${x}, ${y}) expected ${expected} mm, got ${first}`);
  }
  for (const sign of [-1, 1]) {
    const port = sign * p.length / 2;
    const [[lo, hi]] = bandsAtX(plan.pitWhiteLines, port - sign * 5);
    const y = (lo + hi) / 2;
    for (const d of [0.05, p.grooveWidth - 0.05]) depth(port - sign * d, y, p.grooveDepth);
    depth(port - sign * (p.grooveWidth + 0.05), y, 0);
  }
  // The straight main guide crosses the divider on entry and exit, making
  // four short horizontal ends. Measure perpendicular to each clipped face.
  const ends = [];
  for (const loop of plan.pitWhiteLines) {
    for (const [i, [x0, y]] of loop.entries()) {
      const [x1, y1] = loop[(i + 1) % loop.length];
      if (Math.abs(y - y1) < 1e-6 && Math.abs(y) < 20 && Math.abs(x1 - x0) > 2)
        ends.push([(x0 + x1) / 2, y]);
    }
  }
  assert.equal(ends.length, 4, 'two separate paint ends on each side of the guide');
  for (const [x, y] of ends) {
    const towardSlot = -Math.sign(y);
    depth(x, y - towardSlot * 0.05, 0);
    for (const d of [0.05, p.grooveWidth - 0.05]) depth(x, y + towardSlot * d, p.grooveDepth);
    depth(x, y + towardSlot * (p.grooveWidth + 0.05), 0);
  }
});

test('pit dashes have adjustable physical lengths and capped grooves, with a solid line beside the pit box', t => {
  const p = pit('right', 2);
  Object.assign(p, { length: 1050, roadLineGroove: true, dashLength: 18, dashGap: 7 });
  Object.assign(p.special, { pitOffset: 200, pitWhiteLine: true, pitCrossingStyle: 'dashed' });
  assert.match(assemblyNotes(p), /dash pattern through both transitions/);
  const plan = specialPreview(p);
  // Read complete dash ends in the entrance before the first braid. The end
  // midpoints and normals give independent physical checks on the STL.
  function entryDashes(loops) {
    return loops.flatMap(loop => {
      if (!loop.every(([x]) => x > -p.length * 0.4 && x < -p.length * 0.28)) return [];
      const caps = [];
      loop.forEach(([x, y], i) => {
        const [nx, ny] = loop[(i + 1) % loop.length], len = Math.hypot(nx - x, ny - y);
        if (Math.abs(len - p.whiteLineWidth) < 0.02 && Math.abs(ny - y) > Math.abs(nx - x))
          caps.push({ xy: [(x + nx) / 2, (y + ny) / 2], normal: [(ny - y) / len, (x - nx) / len] });
      });
      return caps.length === 2 ? [caps.sort((a, b) => a.xy[0] - b.xy[0])] : [];
    }).sort((a, b) => a[0].xy[0] - b[0].xy[0]);
  }
  function near(a, b) { assert.ok(Math.abs(a - b) < 0.05, `${a} vs ${b}`); }
  const length = (a, b) => Math.hypot(a.xy[0] - b.xy[0], a.xy[1] - b.xy[1]);
  function checkPitch(dashes, along, gap) {
    assert.ok(dashes.length >= 3);
    for (const [i, [a, b]] of dashes.entries()) {
      near(length(a, b), along);
      if (i > 0) near(length(dashes[i - 1][1], a), gap);
    }
  }
  const dashes = entryDashes(plan.pitWhiteLines);
  checkPitch(dashes, p.dashLength, p.dashGap);
  const fine = { ...p, dashLength: 8, dashGap: 4 };
  checkPitch(entryDashes(specialPreview(fine).pitWhiteLines), fine.dashLength, fine.dashGap);
  const parts = buildTrack(wasm, p);
  t.after(() => parts.forEach(part => part.solid.delete()));
  const road = parts.find(part => part.role === 'road');
  const mesh = parseSTL(wasm, printableSTL(road, encodeSTL, undefined, { mode: 'track', track: { params: p } }));
  t.after(() => mesh.delete());
  const { min, max } = road.solid.boundingBox();
  function depth(x, y) {
    const xy = [x - (min[0] + max[0]) / 2, (min[1] + max[1]) / 2 - y];
    return mesh.rayCast([...xy, -1], [...xy, p.height + 1])[0]?.position[2];
  }
  for (const [index, cap] of dashes[1].entries()) {
    const [x, y] = cap.xy;
    const direction = Math.sign(cap.normal[0]) * (index === 0 ? -1 : 1);
    for (const [distance, z] of [[-0.15, 0], [0.4, p.grooveDepth], [1, 0]]) {
      const dx = direction * distance * cap.normal[0], dy = direction * distance * cap.normal[1];
      near(depth(x + dx, y + dy), z);
      near(depth(-x - dx, y + dy), z); // matching exit pattern
    }
  }
  for (let x = -95; x < 95; x += 5) {
    const [[lo, hi]] = bandsAtX(plan.pitWhiteLines, x);
    near((hi + lo) / 2, -(p.width - p.whiteLineWidth) / 2);
    near(depth(x, hi + 0.4), p.grooveDepth);
  }
});

test('the pit divider and centre line preserve the dovetail roof where the paint crosses a centred connector', t => {
  for (const roadCentreLine of ['none', 'solid']) {
    const p = pit('left', 2);
    Object.assign(p, { roadLineGroove: true, joint: 'clips', clipType: 'draw-key', roadCentreLine });
    Object.assign(p.special, { pitOffset: 200, pitWhiteLine: true, pitCrossingStyle: 'dashed' });
    const parts = buildTrack(wasm, p);
    t.after(() => parts.forEach(part => part.solid.delete()));
    const road = parts.find(part => part.role === 'road');
    const mesh = parseSTL(wasm, printableSTL(road, encodeSTL, undefined, { mode: 'track', track: { params: p } }));
    t.after(() => mesh.delete());
    const { min, max } = road.solid.boundingBox();
    const guide = toolGuides({ mode: 'track', tab: 'geometry', field: 'grooveDepth', track: { params: p }, parts })
      .find(g => g.id === 'pit-white-line-groove');
    assert.deepEqual(guide.paths.map(path => path.slice(0,-1).map(([x,y]) => [x,y])), road.pitGrooveGuide);
    for (const sign of [-1, 1]) for (const y of [-2.4, 2.4]) {
      for (const [distance, depth] of [[2, 0], [25, p.grooveDepth]]) {
        const x = sign * (p.length / 2 - distance);
        const xy = [x - (min[0] + max[0]) / 2, (min[1] + max[1]) / 2 - y];
        const z = mesh.rayCast([...xy,-1], [...xy,p.height+1])[0]?.position[2];
        assert.ok(Math.abs(z-depth) < 0.001, 'the groove resumes beyond the dovetail roof');
      }
      const capX = sign * (p.length / 2 - 2);
      assert.ok(road.pitGrooveGuide.every(loop => !bandsAtX([loop], capX).some(([a,b]) => a < y && y < b)),
        'the overlay leaves the connector roof clear');
    }
  }
});
