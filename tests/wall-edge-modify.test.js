import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { SolidWorkshop } from '../src/geometry/solids.js';
import { encodeSTL, makeDemo, parseSTL, surfaceRegion } from '../src/editor.js';
import { applyCreationFeature } from '../src/geometry/create-features.js';
import {
  pickFinishEdge,
  makeHoleSeat,
  topology,
  dot3,
  sub3,
  cross3,
} from '../src/geometry/feature-selection.js';
import {
  applyWallEdgeModify,
  validateWallEdgeModify,
  selectedEdgeRefs,
  compactEdge,
  sameFinishEdge,
  wallPickSeeds,
} from '../src/geometry/wall-edge-modify.js';
const wasm = await init();
wasm.setup();
function kit(t) {
  const work = new SolidWorkshop(wasm),
    own = (x) => work.own(x);
  t.after(() => work.close());
  const apply = (s, op) =>
    own(
      parseSTL(
        wasm,
        encodeSTL(
          applyWallEdgeModify(wasm, s, JSON.parse(JSON.stringify(op)), own),
        ),
      ),
    );
  return { work, own, apply, block: (size) => own(wasm.Manifold.cube(size)) };
}
const near = (a, b, tol = 1e-3) =>
  assert.ok(Math.abs(a - b) < tol, `${a} versus ${b}`);
const hit = (s, a, b) => s.rayCast(a, b)[0];
const z = (s, x, y) => hit(s, [x, y, 100], [x, y, -10])?.position[2];
// rayCast reports the original Manifold face ID after CSG; the viewport picks
// the triangle in the rendered mesh. Locate that same triangle for the tests.
function viewportTriangle(s, h) {
  const t = topology(s);
  for (let i = 0; i < t.indices.length; i += 3) {
    if (
      dot3(t.normal(i / 3), h.normal) < 0.99999 ||
      Math.abs(dot3(sub3(t.point(i), h.position), h.normal)) > 1e-4
    )
      continue;
    if (
      [0, 1, 2].every(
        (j) =>
          dot3(
            cross3(
              sub3(t.point(i + ((j + 1) % 3)), t.point(i + j)),
              sub3(h.position, t.point(i + j)),
            ),
            h.normal,
          ) >= -1e-5,
      )
    )
      return i / 3;
  }
  throw Error('Missing viewport triangle');
}
function edgeAt(s, x, y) {
  const h = hit(s, [x, y, 100], [x, y, -10]);
  return compactEdge(pickFinishEdge(s, viewportTriangle(s, h), h.position));
}
function wall(s, a, b) {
  const h = hit(s, a, b),
    triangle = viewportTriangle(s, h),
    r = surfaceRegion(s, triangle, 0);
  r.seed = { triangle, point: h.position };
  return makeHoleSeat(r, { bounds: s.boundingBox() });
}
test('complete lid perimeter bevel preserves internal hole and measures at all four corners after STL export', (t) => {
  const { own, apply, block } = kit(t),
    raw = block([30, 20, 8]),
    bore = own(
      own(wasm.Manifold.cylinder(10, 2, 2, 32)).translate([15, 10, -1]),
    ),
    stock = own(raw.subtract(bore)),
    edge = edgeAt(stock, 15, 0.01);
  const op = {
    type: 'edgeGroup',
    scope: 'loop',
    kind: 'chamfer',
    size: 1,
    edges: [edge],
  };
  assert.equal(selectedEdgeRefs(stock, [edge], 'loop').length, 4);
  const result = apply(stock, op);
  for (const [x, y] of [
    [0.4, 0.4],
    [29.6, 0.4],
    [29.6, 19.6],
    [0.4, 19.6],
    [0.4, 10],
    [15, 19.6],
  ])
    near(z(result, x, y), 7.4);
  near(z(result, 15, 12.05), 8);
  assert.equal(z(result, 15, 10), undefined);
  const round = apply(stock, { ...op, kind: 'fillet' });
  near(z(round, 0.5, 10), 7 + Math.sqrt(0.75), 0.02);
  assert.throws(() => apply(stock, { ...op, size: 15 }), /consume|past|finish/);
});
test('tangent chain follows a tessellated quarter round between two straight sides and stops at sharp corners', (t) => {
  const { work, own, apply } = kit(t),
    polygon = [
      [0, 0],
      [25, 0],
    ];
  for (let i = 1; i <= 12; i++) {
    const a = ((i / 12 - 1) * Math.PI) / 2;
    polygon.push([25 + 5 * Math.cos(a), 5 + 5 * Math.sin(a)]);
  }
  polygon.push([30, 20], [0, 20]);
  const stock = own(work.section([polygon]).extrude(8)),
    edge = edgeAt(stock, 12, 0.03),
    edges = selectedEdgeRefs(stock, [edge], 'tangent');
  assert.equal(edges.length, 14);
  const op = {
    type: 'edgeGroup',
    scope: 'tangent',
    kind: 'chamfer',
    size: 1,
    edges: [edge],
  };
  const result = apply(stock, op);
  near(z(result, 12, 0.4), 7.4);
  near(z(result, 29.6, 15), 7.4);
  near(z(result, 12, 19.6), 8);
  const a = -Math.PI / 4;
  near(z(result, 25 + 4.6 * Math.cos(a), 5 + 4.6 * Math.sin(a)), 7.4, 0.02);
});
test('manual group deduplicates picks, supports reversed endpoints and corners without false tangent continuation', (t) => {
  const { apply, block } = kit(t),
    stock = block([30, 20, 8]);
  const bottom = edgeAt(stock, 12, 0.03),
    right = edgeAt(stock, 29.97, 10),
    top = edgeAt(stock, 12, 19.97);
  assert.ok(sameFinishEdge(bottom, { ...bottom, a: bottom.b, b: bottom.a }));
  assert.equal(selectedEdgeRefs(stock, [bottom], 'tangent').length, 1);
  const result = apply(stock, {
    type: 'edgeGroup',
    scope: 'picked',
    kind: 'chamfer',
    size: 1,
    edges: [bottom, right, bottom, top],
  });
  near(z(result, 20, 0.5), 7.5);
  near(z(result, 29.5, 19), 7.5);
  near(z(result, 0.5, 10), 8);
});

for (const version of [1, 2]) {
  test(
    'one corner pick gives a continuous printable finish on enclosure version ' +
      version,
    (t) => {
      const { own, apply } = kit(t);
      // Use an imported copy too: CAD face IDs disappear in an STL.
      const example = own(makeDemo(wasm, version));
      const stock =
        version === 1 ? own(parseSTL(wasm, encodeSTL(example))) : example;
      const rim = edgeAt(stock, 36 + 4.98 / Math.SQRT2, 22 + 4.98 / Math.SQRT2);
      const edges = selectedEdgeRefs(stock, [rim], 'corner');
      // The screw post and outside wall both contribute facets to this outline.
      assert.ok(edges.length >= 8);
      const chain = edges
        .map((edge) => {
          let [a, b] = [edge.a, edge.b];
          if (a[1] > b[1]) [a, b] = [b, a];
          const n = edge.n1[2] < 0.5 ? edge.n1 : edge.n2;
          return { a, b, n };
        })
        .sort((a, b) => a.a[1] - b.a[1]);
      near(chain[0].a[0], 41);
      near(chain[0].a[1], 22);
      near(chain.at(-1).b[0], 36);
      near(chain.at(-1).b[1], 27);
      const size = 2;
      for (const kind of ['chamfer', 'fillet']) {
        for (const withStraights of [false, true]) {
          const picks = withStraights
            ? [edgeAt(stock, 40.98, 0), rim, edgeAt(stock, 0, 26.98)]
            : [rim];
          const result = apply(stock, {
            type: 'edgeGroup',
            scope: 'corner',
            kind,
            size,
            edges: picks,
            curveVersion: 2,
          });
          assert.equal(result.status(), 'NoError');
          const shells = result.decompose().map(own);
          assert.equal(shells.length, 1);
          // A film of the old vertical wall can survive a coplanar subtraction.
          // Probe horizontally from outside the part: top-down rays inside the
          // finish miss these films, which become dark triangles in the viewer.
          const halfway = kind === 'chamfer' ? 1 : 2 - Math.sqrt(3);
          for (const { a, b, n } of chain) {
            const x = (a[0] + b[0]) / 2,
              y = (a[1] + b[1]) / 2;
            const h = hit(
              result,
              [x + n[0], y + n[1], 15],
              [x - 2 * n[0], y - 2 * n[1], 15],
            );
            assert.ok(h, 'expected the finished corner at mid-height');
            near(
              (x - h.position[0]) * n[0] + (y - h.position[1]) * n[1],
              halfway,
              0.02,
            );
          }
          for (const inset of kind === 'chamfer'
            ? [0.005, 0.18, 0.9]
            : [0.18, 0.9]) {
            const expected =
              16 -
              size +
              (kind === 'chamfer'
                ? inset
                : Math.sqrt(size ** 2 - (size - inset) ** 2));
            const heightTolerance = kind === 'chamfer' ? 0.003 : 0.04;
            for (const [i, { a, b, n }] of chain.entries()) {
              near(
                z(
                  result,
                  (a[0] + b[0]) / 2 - n[0] * inset,
                  (a[1] + b[1]) / 2 - n[1] * inset,
                ),
                expected,
                heightTolerance,
              );
              // The intersection of two equal-width offsets belongs to both
              // bevel planes; check both sides of that intersection for teeth.
              const previous = i
                ? chain[i - 1].n
                : withStraights
                  ? [1, 0, 0]
                  : null;
              if (!previous) continue;
              const scale = inset / (1 + dot3(n, previous));
              const x = a[0] - scale * (n[0] + previous[0]);
              const y = a[1] - scale * (n[1] + previous[1]);
              for (const delta of [-0.002, 0.002])
                near(
                  z(result, x - n[1] * delta, y + n[0] * delta),
                  expected,
                  heightTolerance,
                );
            }
            near(
              z(result, 41 - inset, 0),
              withStraights ? expected : 16,
              heightTolerance,
            );
            near(
              z(result, 0, 27 - inset),
              withStraights ? expected : 16,
              heightTolerance,
            );
          }
          near(z(result, 36.6 + 1.65, 22.6), 2);
          near(z(result, 36.6 + 1.75, 22.6), 16);
          near(z(result, -40.8, 0), 16);
        }
      }
    },
  );
}
test('an individual facet and a complete bore rim clear the old wall through the finished height', (t) => {
  const { own } = kit(t),
    stock = own(makeDemo(wasm, 2));
  function chamfer(edge) {
    const op = {
      type: 'edgeFinish',
      kind: 'chamfer',
      edge,
      size: 1,
      curveVersion: 2,
    };
    return own(
      parseSTL(
        wasm,
        encodeSTL(applyCreationFeature(wasm, stock, op, new Map(), own).solid),
      ),
    );
  }
  // This is where the enclosure radius meets the screw post.
  const segment = edgeAt(stock, 40.83, 23.3);
  delete segment.corner;
  const single = chamfer(segment);
  const n = segment.n1[2] < 0.5 ? segment.n1 : segment.n2;
  const x = (segment.a[0] + segment.b[0]) / 2,
    y = (segment.a[1] + segment.b[1]) / 2;
  const flank = hit(
    single,
    [x + n[0], y + n[1], 15.5],
    [x - 2 * n[0], y - 2 * n[1], 15.5],
  );
  near(Math.hypot(x - flank.position[0], y - flank.position[1]), 0.5);
  const rim = edgeAt(stock, 36.6 + 1.705, 22.6);
  assert.ok(rim.circle);
  const bore = chamfer(rim);
  for (let i = 0; i < 96; i++) {
    const angle = ((i + 0.5) * Math.PI) / 48;
    const h = hit(
      bore,
      [36.6, 22.6, 15.5],
      [36.6 + 3 * Math.cos(angle), 22.6 + 3 * Math.sin(angle), 15.5],
    );
    near(Math.hypot(h.position[0] - 36.6, h.position[1] - 22.6), 2.2, 0.005);
  }
});
test('offset adjacent and opposite walls by independent face normals, preserving the unpicked faces and bore', (t) => {
  const { block, own, apply } = kit(t),
    raw = block([30, 20, 10]),
    cutter = own(
      own(wasm.Manifold.cylinder(12, 2, 2, 32)).translate([15, 10, -1]),
    ),
    stock = own(raw.subtract(cutter));
  const walls = [
    wall(stock, [-5, 10, 5], [35, 10, 5]),
    wall(stock, [35, 10, 5], [-5, 10, 5]),
    wall(stock, [15, 25, 5], [15, -5, 5]),
  ];
  const result = apply(stock, {
      type: 'wallModify',
      kind: 'offset',
      distance: -0.2,
      walls,
    }),
    b = result.boundingBox();
  near(b.min[0], 0.2);
  near(b.max[0], 29.8);
  near(b.min[1], 0);
  near(b.max[1], 19.8);
  near(b.max[2], 10);
  assert.equal(z(result, 15, 10), undefined);
  near(z(result, 17.01, 10), 10);
  assert.throws(
    () =>
      apply(stock, {
        type: 'wallModify',
        kind: 'offset',
        distance: -17,
        walls,
      }),
    /collapse|cross/,
  );
});
test('draft on perpendicular walls holds a chosen base, changes the top dimensions and permits a top reference', (t) => {
  const { apply, block } = kit(t),
    stock = block([30, 20, 10]),
    walls = [
      wall(stock, [40, 10, 5], [0, 10, 5]),
      wall(stock, [15, 30, 5], [15, 0, 5]),
    ];
  const op = {
      type: 'wallModify',
      kind: 'draft',
      axis: 'z',
      angle: (Math.atan(0.2) * 180) / Math.PI,
      base: 0,
      walls,
    },
    result = apply(stock, op);
  const at = (s, h) => hit(s, [50, 10, h], [0, 10, h]).position[0];
  near(at(result, 0.01), 30.002);
  near(at(result, 9.99), 31.998);
  near(hit(result, [15, 40, 9.99], [15, 0, 9.99]).position[1], 21.998);
  near(at(apply(stock, { ...op, base: 10 }), 0.01), 28.002);
  assert.throws(
    () => validateWallEdgeModify({ ...op, axis: 'x' }),
    /perpendicular/,
  );
  assert.throws(
    () => validateWallEdgeModify({ ...op, walls: Array(129).fill(walls[0]) }),
    /128/,
  );
});

test('clearance on a cavity changes the inside opening while keeping wall exteriors and floor thickness', (t) => {
  const { block, own, apply } = kit(t);
  const cavity = own(block([20, 12, 10]).translate([5, 4, 2]));
  const box = own(block([30, 20, 10]).subtract(cavity));
  const inside = [
    wall(box, [15, 10, 6], [35, 10, 6]),
    wall(box, [15, 10, 6], [-5, 10, 6]),
  ];
  const seeds = wallPickSeeds(box, inside);
  assert.equal(seeds.length, 2);
  for (const [i, s] of seeds.entries()) {
    const region = surfaceRegion(box, s.triangle, 0);
    assert.ok(dot3(region.normal, inside[i].normal) > 0.999);
    assert.ok(
      Math.abs(dot3(sub3(s.point, region.origin), region.normal)) < 1e-6,
    );
  }
  const result = apply(box, {
    type: 'wallModify',
    kind: 'offset',
    distance: -0.2,
    walls: inside,
  });
  const right = hit(result, [15, 10, 5], [35, 10, 5]).position[0];
  const left = hit(result, [15, 10, 5], [-5, 10, 5]).position[0];
  near(right - left, 20.4);
  near(result.boundingBox().max[0], 30);
  near(result.boundingBox().min[0], 0);
  near(z(result, 15, 10), 2);
});

test('a drafted lid takes one continuous mitred loop even where its walls meet the top at an obtuse angle', (t) => {
  const { work, own, apply } = kit(t);
  const stock = own(
    work
      .section([
        [
          [-10, -10],
          [10, -10],
          [10, 10],
          [-10, 10],
        ],
      ])
      .extrude(10, 0, 0, [0.8, 0.8]),
  );
  const edge = edgeAt(stock, 7.95, 0),
    op = {
      type: 'edgeGroup',
      scope: 'loop',
      kind: 'chamfer',
      size: 1,
      edges: [edge],
    };
  const result = apply(stock, op),
    c = 0.2 / Math.sqrt(1.04),
    s = 1 / Math.sqrt(1.04);
  const expected = 10 - (s * 0.5) / (1 + c);
  near(z(result, 7.5, 0), expected);
  near(z(result, 7.5, 7.5), expected);
  near(z(result, -7.5, -7.5), expected);
  const rounded = apply(stock, { ...op, kind: 'fillet' }),
    tangent = 8 - 1 / Math.tan(Math.acos(-c) / 2);
  near(z(rounded, 7.6, 7.6), 9 + Math.sqrt(1 - (7.6 - tangent) ** 2), 0.012);
});
