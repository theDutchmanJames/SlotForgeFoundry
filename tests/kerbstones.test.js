import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Module from 'manifold-3d';
import { buildTrack, defaultTrack, borderWidth } from '../src/track.js';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { createEngine } from '../src/engine.js';
import { parseDrawing } from '../src/imports.js';
import { newProject } from '../src/project.js';
import { finishKerbstones } from '../src/geometry/kerbstones.js';
import { specialTrackParams } from '../src/special-pieces.js';

const wasm = await Module();
wasm.setup();
const red = '#E5484D',
  white = '#ECE9E2';
const straight = {
  kind: 'straight',
  length: 101,
  width: 80,
  lanes: 1,
  borderSide: 'both',
  borderSegments: 3,
  borderEntry: 20,
  borderApex: 20,
  borderExit: 20,
  kerbWidth: 5,
  kerbLength: 13,
};
function built(params, inspect, plan) {
  const parts = buildTrack(wasm, params, plan);
  try {
    return inspect(parts);
  } finally {
    for (const part of parts) part.solid.delete();
  }
}
function cross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function colourAt(marks, point) {
  return marks.find(({ points }) =>
    points.every(
      (a, i) => cross(a, points[(i + 1) % points.length], point) >= -1e-7,
    ),
  )?.color;
}
function near(a, b, eps = 1e-5) {
  assert.ok(Math.abs(a - b) < eps, `${a} differs from ${b}`);
}
function checkPaint(part, height) {
  const marks = part.kerbMarkings;
  assert.ok(marks.length > 0);
  let area = 0;
  for (const { points, color } of marks) {
    assert.ok(color === red || color === white);
    assert.ok(points.every((v) => v.every(Number.isFinite) && v[2] === height));
    assert.equal(points.length, 3);
    const triangle = cross(...points) / 2;
    assert.ok(triangle > 0);
    area += triangle;
  }
  const paint = new wasm.CrossSection(
    marks.map((m) => m.points.map(([x, y]) => [x, y])),
    'Positive',
  );
  const top = part.solid.slice(height - 0.0001),
    spill = paint.subtract(top);
  try {
    near(spill.area(), 0, 0.0001);
    near(paint.area(), area, 0.0001); // Includes overlaps between red and white.
  } finally {
    spill.delete();
    top.delete();
    paint.delete();
  }
  return area;
}

test('road kerbs follow either edge without a border and preserve block phase across print seams', () => {
  const p = { ...straight, length: 100, segments: 2, borderSide: 'none' };
  for (const roadKerbSide of ['inner', 'outer', 'both']) {
    built({ ...p, roadKerbSide }, parts => {
      for (const x of [-45, -34, -0.02, 0.02, 4, 46]) {
        const part = parts[x < 0 ? 0 : 1];
        const expected = Math.floor((x + 50) / p.kerbLength) % 2 ? white : red;
        for (const [side, y] of [['inner', -37.5], ['outer', 37.5]])
          assert.equal(colourAt(part.kerbMarkings, [x, y]), [side, 'both'].includes(roadKerbSide) ? expected : undefined);
        assert.equal(colourAt(part.kerbMarkings, [x, 32]), undefined);
      }
      for (const part of parts) checkPaint(part, 12);
    });
  }
});

test('road kerbs fit beside an off-centre slot on either edge and point at Slot position when they reach it', () => {
  // 20 mm from the left edge leaves 12.9 mm of road outside the braid.
  const p = {
    ...straight, length: 100, width: 200, borderSide: 'none', braidGap: 0.6,
    slotPosition: { version: 1, edge: 'outer', startMm: 20, endMm: 20 },
  };
  built({ ...p, roadKerbSide: 'both', kerbWidth: 12 }, ([road]) => {
    for (const y of [-94, 94]) assert.equal(colourAt(road.kerbMarkings, [-45, y]), red);
    assert.equal(colourAt(road.kerbMarkings, [-45, 80]), undefined, 'the slot keeps its braids');
    checkPaint(road, 12);
  });
  built({ ...p, roadKerbSide: 'inner', kerbWidth: 60 }, ([road]) => {
    assert.equal(colourAt(road.kerbMarkings, [-45, -41]), red);
    assert.equal(colourAt(road.kerbMarkings, [-45, -39]), undefined);
  });
  assert.throws(
    () => built({ ...p, roadKerbSide: 'outer', kerbWidth: 14 }, () => {}),
    /The kerbstones reach a guide slot or braid strip\. Reduce the kerbstone width or the edge line width to leave room beside the lane, or move the slot away from this edge under Slot position\.$/,
  );
  // Without a slot position the advice is what it was.
  const centred = { ...p, roadKerbSide: 'outer', kerbWidth: 95 };
  delete centred.slotPosition;
  assert.throws(
    () => built(centred, () => {}),
    /The kerbstones reach a guide slot or braid strip\. Reduce the kerbstone width or the edge line width to leave room beside the lane\.$/,
  );
});

test('road and border kerbs sit beside their shared edge stripe and each block perimeter exports as a groove', () => {
  const p = {
    ...straight, length: 100, segments: 2, borderSegments: 2, borderSide: 'outer',
    roadKerbSide: 'outer', kerbEdge: 'road', kerbGroove: true,
    whiteLineRoad: 'outer', whiteLineBorder: 'outer', whiteLineWidth: 4, grooveWidth: 0.5,
    grooveDepth: 0.4, roadLineGroove: true,
  };
  built(p, parts => {
    const [roadA, roadB] = parts, border = parts.find(part => part.role === 'border');
    assert.equal(colourAt(roadA.kerbMarkings, [-45, 39]), '#FFFFFF');
    assert.equal(colourAt(border.kerbMarkings, [-45, 41]), '#FFFFFF');
    assert.equal(colourAt(roadA.kerbMarkings, [-45, 35]), red);
    assert.equal(colourAt(border.kerbMarkings, [-45, 45]), red);
    assert.equal(colourAt(roadA.kerbMarkings, [-45, 31]), undefined);
    for (const part of [roadA, roadB]) {
      const stl = parseSTL(wasm, encodeSTL(part.solid));
      try {
        const x = part === roadA ? -0.02 : 0.02;
        const z = (x, y) => stl.rayCast([x, y, 13], [x, y, -1])[0]?.position[2];
        near(z(x, 35), 12);  // A print seam through a stone stays flush.
        for (const y of [32.7, 37.3]) near(z(x, y), 11.6);
        const join = part === roadA ? -37 : 2;
        near(z(join, 35), 11.6); // Join between two colours.
        near(z(x, 0), 5);        // Guide slot.
        near(z(x, 4), 11.5);     // Braid recess.
      } finally { stl.delete(); }
    }
  });
  assert.throws(() => buildTrack(wasm, { ...p, kerbWidth: 35 }), /kerbstones reach a guide slot or braid strip/);
});

test('a pit with 200 mm offset carries road kerbs along its widened shoulder and cannot paint the flipper', () => {
  const p = specialTrackParams('pit', { ...defaultTrack(), width: 200, laneSpacing: 100 });
  Object.assign(p.special, { pitOffset: 200, side: 'left' });
  Object.assign(p, { length: 1200, roadKerbSide: 'outer', kerbGroove: true, whiteLineRoad: 'outer' });
  built(p, parts => {
    const road = parts.find(part => part.role === 'road');
    assert.ok([red, white].includes(colourAt(road.kerbMarkings, [6, 294])));
    assert.equal(colourAt(road.kerbMarkings, [6, 100]), undefined);
    assert.equal(colourAt(road.kerbMarkings, [6, 250]), undefined);
    assert.ok(parts.filter(part => part.role !== 'road').every(part => !part.kerbMarkings));
  });
});

test('a Circuit bend supports road kerbs without detachable borders in both drawing formats', async () => {
  const areas = [];
  for (const file of ['circuit-curve-mm.dxf', 'circuit-curve-compact.svg']) {
    const plan = parseDrawing(await readFile(new URL('./drawings/' + file, import.meta.url), 'utf8'), file);
    areas.push(built({ kind: 'import', segments: 2, roadKerbSide: 'both' },
      parts => parts.map(part => checkPaint(part, 12)), plan));
  }
  assert.equal(areas[0].length, 2);
  for (const [i, area] of areas[0].entries()) near(area, areas[1][i], 0.1);
});
test('flat paint preserves every mesh and export byte, including the clips, bounds and sockets', () => {
  const p = {
    ...defaultTrack(),
    radius: 310,
    angle: 45,
    borderSide: 'both',
    segments: 2,
    borderSegments: 2,
    borderEntry: 48,
    borderApex: 65,
    borderExit: 46,
    joint: 'both',
    borderJoint: 'both',
    borderMount: 'both',
  };
  const unmarked = built(p, (parts) =>
    parts.map(({ solid }) => encodeSTL(solid)),
  );
  built({ ...p, kerbEdge: 'both' }, (parts) => {
    assert.equal(parts.length, unmarked.length);
    parts.forEach((part, i) => {
      assert.deepEqual(encodeSTL(part.solid), unmarked[i]);
      if (part.role === 'border') checkPaint(part, p.height);
      else assert.equal(part.kerbMarkings, undefined);
    });
  });
});
test('edge and border side are independent; alternating 13 mm stones continue across three print pieces', () => {
  for (const [kerbEdge, kerbSide] of [
    ['road', 'inner'],
    ['free', 'outer'],
    ['both', 'both'],
  ]) {
    built({ ...straight, kerbEdge, kerbSide }, (parts) => {
      for (const [side, sign] of [
        ['outer', 1],
        ['inner', -1],
      ]) {
        const sections = parts.filter((p) => p.id.startsWith('border-' + side));
        assert.equal(sections.length, 3);
        if (kerbSide !== 'both' && kerbSide !== side) {
          assert.ok(sections.every((p) => p.kerbMarkings === undefined));
          continue;
        }
        // Include points on each side of a seam, inside a single colour block.
        for (const s of [
          0.4, 12.9, 13.1, 33.65, 33.68, 44, 67.32, 67.35, 100.6,
        ]) {
          const part = sections[Math.floor((s * 3) / 101)],
            x = s - 50.5;
          const expected = Math.floor(s / 13) % 2 ? white : red;
          assert.equal(
            colourAt(part.kerbMarkings, [x, sign * 42.5]),
            kerbEdge === 'free' ? undefined : expected,
          );
          assert.equal(
            colourAt(part.kerbMarkings, [x, sign * 57.5]),
            kerbEdge === 'road' ? undefined : expected,
          );
          assert.equal(colourAt(part.kerbMarkings, [x, sign * 50]), undefined);
        }
      }
    });
  }
});
test('two painted edges share a narrow taper without overlap and leave the wider apex exposed', () => {
  const p = {
    ...defaultTrack(),
    ...straight,
    borderSide: 'outer',
    borderSegments: 1,
    borderEntry: 0,
    borderExit: 1,
    borderApex: 25,
    kerbWidth: 7,
    kerbEdge: 'both',
  };
  built(p, (parts) => {
    const part = parts.find((p) => p.role === 'border');
    checkPaint(part, p.height);
    for (const t of [0.0625, 0.5, 0.9375]) {
      const w = borderWidth(p, t),
        x = (t - 0.5) * p.length;
      assert.ok(colourAt(part.kerbMarkings, [x, 40 + Math.min(1, w / 4)]));
      assert.ok(colourAt(part.kerbMarkings, [x, 40 + w - Math.min(1, w / 4)]));
      assert.equal(
        Boolean(colourAt(part.kerbMarkings, [x, 40 + w / 2])),
        w <= 2 * p.kerbWidth,
      );
      assert.equal(colourAt(part.kerbMarkings, [x, 40 + w + 0.001]), undefined);
    }
  });
});
test('Circuit SVG and DXF borders get matching full-size paint at the actual surface', async () => {
  const areas = [];
  for (const file of ['circuit-curve-mm.dxf', 'circuit-curve-compact.svg']) {
    const plan = parseDrawing(
      await readFile(new URL('./drawings/' + file, import.meta.url), 'utf8'),
      file,
    );
    areas.push(
      built(
        {
          kind: 'import',
          borderSide: 'both',
          borderSegments: 2,
          kerbEdge: 'both',
        },
        (parts) =>
          parts
            .filter((p) => p.role === 'border')
            .map((p) => checkPaint(p, 12)),
        plan,
      ),
    );
  }
  assert.equal(areas[0].length, 4);
  for (const [i, a] of areas[0].entries()) near(a, areas[1][i], 0.1);
});
test('paint triangles are trimmed around a through hole in the finished surface', () => {
  const base = wasm.Manifold.cube([10, 10, 4]),
    cutter = wasm.Manifold.cube([2, 2, 6]),
    placed = cutter.translate([3, 2, -1]),
    cut = base.subtract(placed);
  try {
    const kerbMarkings = finishKerbstones(wasm, cut, 4, [
      {
        block: 0,
        outer: [
          [0, 0],
          [10, 0],
        ],
        inner: [
          [0, 10],
          [10, 10],
        ],
      },
    ]);
    assert.equal(colourAt(kerbMarkings, [4, 3]), undefined);
    near(checkPaint({ solid: cut, kerbMarkings }, 4), 96);
  } finally {
    cut.delete();
    placed.delete();
    cutter.delete();
    base.delete();
  }
});
test('legacy designs stay plain and oversized or invalid paint parameters fail before allocating large arrays', () => {
  const project = newProject();
  for (const key of ['kerbEdge', 'kerbSide', 'kerbWidth', 'kerbLength'])
    delete project.track.params[key];
  const engine = createEngine(wasm);
  try {
    assert.ok(engine.build(project).every((p) => p.kerbMarkings === undefined));
    project.track.params.kerbEdge = 'road';
    assert.ok(engine.preview(project).some((p) => p.kerbMarkings?.length));
  } finally {
    engine.dispose();
  }
  for (const [key, value] of [
    ['kerbWidth', 0],
    ['kerbLength', Infinity],
    ['kerbEdge', 'bad'],
    ['kerbSide', 'left'],
  ]) {
    assert.throws(
      () => buildTrack(wasm, { ...straight, [key]: value }),
      /kerb/i,
    );
  }
  assert.throws(
    () =>
      buildTrack(wasm, {
        ...straight,
        length: 20000,
        kerbEdge: 'free',
        kerbLength: 0.1,
      }),
    /Increase kerbstone block length/,
  );
});
