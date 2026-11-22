import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import {
  applyEdit,
  encodeSTL,
  makeDemo,
  parseSTL,
  surfaceRegion,
} from '../src/editor.js';
import { postOnFace } from '../src/geometry/post-selection.js';
import { createEngine } from '../src/engine.js';
import { newProject } from '../src/project.js';

const wasm = await init();
wasm.setup();

function owned(t) {
  const objects = [];
  t.after(() => objects.forEach((handle) => handle.delete()));
  return (obj) => (objects.push(obj), obj);
}

function faceSeed(solid, point, normal = [0, 0, 1]) {
  const mesh = solid.getMesh(),
    stride = mesh.numProp;
  for (let i = 0; i < mesh.triVerts.length; i += 3) {
    if (
      mesh.triVerts
        .subarray(i, i + 3)
        .every(
          (v) =>
            Math.abs(
              normal.reduce(
                (sum, n, j) =>
                  sum + n * (mesh.vertProperties[v * stride + j] - point[j]),
                0,
              ),
            ) < 0.00005,
        )
    )
      return i / 3;
  }
  throw Error('The fixture has no triangle on the requested plane');
}

function hasMaterial(own, solid, x, y, z) {
  const probe = own(
    own(wasm.Manifold.cube([0.05, 0.05, 0.05], true)).translate([x, y, z]),
  );
  return own(solid.intersect(probe)).volume() > 0.05 ** 3 * 0.99;
}

for (const imported of [false, true])
  test(
    'four fused post caps move down together with all bores and the full wall intact · ' +
      (imported ? 'STL round trip' : 'native'),
    (t) => {
      const own = owned(t),
        demo = own(makeDemo(wasm));
      const part = imported ? own(parseSTL(wasm, encodeSTL(demo))) : demo;
      const original = surfaceRegion(part, faceSeed(part, [0, 0, 16]));
      const centers = [-36.6, 36.6].flatMap((x) =>
        [-22.6, 22.6].map((y) => [x, y]),
      );
      const posts = centers.map(([x, y]) =>
        postOnFace(wasm, original, [x - Math.sign(x) * 2.8, y, 16]),
      );
      assert.equal(new Set(posts.map((p) => p.featureKey)).size, 4);
      assert.equal(new Set(posts.map((p) => p.sourceFaceKey)).size, 1);
      assert.ok(
        posts.every(
          (p) =>
            p.feature === 'post' &&
            p.patches.length > 0 &&
            p.loops.length === 2,
        ),
      );
      assert.equal(postOnFace(wasm, original, [0, 26, 16]), null);
      assert.equal(postOnFace(wasm, original, [36.6, 22.6, 16]), null);
      const loops = posts.flatMap((p) => p.loops);
      const cut = own(
        applyEdit(wasm, part, {
          type: 'cut',
          tool: 'move-face',
          depth: 2,
          profileKind: 'face',
          frame: original,
          loops,
          faceRefs: posts.map((p) => ({ feature: p.feature })),
        }),
      );
      assert.equal(cut.boundingBox().max[2], 16);
      assert.equal(
        own(cut.slice(15)).numContour(),
        2,
        'the cut leaves a continuous rim without fins at the former post tops',
      );
      assert.equal(own(cut.slice(13.9)).numContour(), 6);
      for (const [x, y] of centers) {
        assert.equal(
          hasMaterial(own, cut, x - Math.sign(x) * 2.8, y, 13.9),
          true,
        );
        assert.equal(
          hasMaterial(own, cut, x - Math.sign(x) * 2.8, y, 14.1),
          false,
        );
        assert.equal(
          hasMaterial(own, cut, x, y, 13.9),
          false,
          'the screw hole is open',
        );
        assert.equal(
          hasMaterial(own, cut, x, y, 1.9),
          true,
          'the bottom of the blind bore is intact',
        );
        for (const phi of [0, 15, 30, 45, 60, 75, 90]) {
          const angle = (phi * Math.PI) / 180;
          assert.equal(
            hasMaterial(
              own,
              cut,
              Math.sign(x) * (36 + 3.2 * Math.cos(angle)),
              Math.sign(y) * (22 + 3.2 * Math.sin(angle)),
              15.96,
            ),
            true,
            'rounded corner wall remains at original height',
          );
        }
      }
      assert.equal(hasMaterial(own, cut, 0, 26, 15.96), true);
      assert.equal(hasMaterial(own, cut, 39.8, 0, 15.96), true);
      const saved = own(parseSTL(wasm, encodeSTL(cut)));
      assert.equal(saved.status(), 'NoError');
      assert.ok(Math.abs(saved.volume() - cut.volume()) < cut.volume() * 1e-6);
    },
  );

test('matching one shortened enclosure post to three wall-mounted posts keeps its rim and all four bores', (t) => {
  const own = owned(t);
  const demo = own(makeDemo(wasm));
  const stock = own(parseSTL(wasm, encodeSTL(demo)));
  const positions = [-36.6, 36.6].flatMap((x) =>
    [-22.6, 22.6].map((y) => [x, y]),
  );
  const clicked = ([x, y], z) => [x - Math.sign(x) * 2.8, y, z];
  const rim = surfaceRegion(stock, faceSeed(stock, [0, 0, 16]));
  const first = postOnFace(wasm, rim, clicked(positions[0], 16));
  const stepped = own(
    applyEdit(wasm, stock, {
      type: 'cut',
      profileKind: 'face',
      tool: 'move-face',
      loops: first.loops,
      frame: first,
      depth: 2,
      faceRefs: [{ feature: 'post' }],
    }),
  );
  const upper = surfaceRegion(stepped, faceSeed(stepped, [0, 0, 16]));
  const lower = surfaceRegion(stepped, faceSeed(stepped, [0, 0, 14]));
  const regions = [
    lower,
    ...positions
      .slice(1)
      .map((pos) => postOnFace(wasm, upper, clicked(pos, 16))),
  ];
  const result = own(
    applyEdit(wasm, stepped, {
      type: 'moveFaces',
      moveMode: 'height',
      value: 15,
      faces: regions.map(({ origin, normal, u, v, loops }) => ({
        frame: { origin, normal, u, v },
        loops,
      })),
      faceRefs: regions.map(({ feature }) => ({ feature })),
    }),
  );
  const printable = own(parseSTL(wasm, encodeSTL(result)));
  for (const [x, y] of positions) {
    assert.equal(hasMaterial(own, printable, ...clicked([x, y], 15.2)), false);
    assert.equal(hasMaterial(own, printable, ...clicked([x, y], 14.8)), true);
    assert.equal(hasMaterial(own, printable, x, y, 14.8), false);
    assert.equal(hasMaterial(own, printable, x, y, 1.9), true);
  }
  assert.equal(own(printable.slice(15.8)).numContour(), 2);
  assert.equal(hasMaterial(own, printable, 0, 26, 15.9), true);
});

test('a straight-sided, tilted enclosure exposes its wall-mounted post from the STL alone', (t) => {
  const own = owned(t);
  const box = own(wasm.Manifold.cube([48, 30, 8]));
  const interior = own(
    own(wasm.Manifold.cube([44, 26, 9])).translate([2, 2, 1.5]),
  );
  const post = own(
    own(wasm.Manifold.cylinder(8, 4, 4, 48)).translate([17, 4.4, 0]),
  );
  const bore = own(
    own(wasm.Manifold.cylinder(9, 1.3, 1.3, 40)).translate([17, 4.4, 1.5]),
  );
  const shell = own(own(own(box.subtract(interior)).add(post)).subtract(bore));
  const rotated = own(own(shell.rotate([30, 0, 0])).translate([18, -7, 3]));
  const part = own(parseSTL(wasm, encodeSTL(rotated)));
  const c = Math.cos(Math.PI / 6),
    s = 0.5;
  const world = (x, y, z) => [18 + x, -7 + y * c - z * s, 3 + y * s + z * c];
  const pick = world(17, 6, 8);
  const region = surfaceRegion(part, faceSeed(part, pick, [0, -s, c]));
  const hit = postOnFace(wasm, region, pick);
  assert.ok(hit);
  assert.equal(hit.loops.length, 2);
  assert.equal(postOnFace(wasm, region, world(35, 1, 8)), null);
});

test('ordinary faces and previously distinct post tops retain standard surface picking', (t) => {
  const own = owned(t);
  const base = own(wasm.Manifold.cube([16, 16, 3]));
  const boss = own(
    own(wasm.Manifold.cylinder(3, 3, 3, 32)).translate([8, 8, 3]),
  );
  const bore = own(
    own(wasm.Manifold.cylinder(8, 1.4, 1.4, 32)).translate([8, 8, 0]),
  );
  const part = own(own(base.add(boss)).subtract(bore));
  assert.equal(
    postOnFace(
      wasm,
      surfaceRegion(part, faceSeed(part, [0, 0, 6])),
      [10.5, 8, 6],
    ),
    null,
  );
  const lid = own(wasm.Manifold.cube([40, 30, 5]));
  const window = own(
    own(wasm.Manifold.cube([22, 17, 8])).translate([9, 6.5, -1]),
  );
  const holes = [4, 36].flatMap((x) =>
    [4, 26].map((y) =>
      own(own(wasm.Manifold.cylinder(7, 1.5, 1.5, 32)).translate([x, y, -1])),
    ),
  );
  const apertures = own(wasm.Manifold.union([window, ...holes]));
  const panel = own(lid.subtract(apertures));
  const panelTop = surfaceRegion(panel, faceSeed(panel, [0, 0, 5]));
  assert.equal(panelTop.loops.length, 6);
  assert.equal(
    postOnFace(wasm, panelTop, [6, 4, 5]),
    null,
    'a screw hole near a rectangular window has no concentric outer post arc',
  );
  const project = newProject();
  project.mode = 'editor';
  const engine = createEngine(wasm);
  try {
    engine.build(project);
    const demo = own(makeDemo(wasm));
    const seed = {
      id: 'body',
      triangle: faceSeed(demo, [0, 0, 16]),
      point: [33.8, 22.6, 16],
      tolerance: 8,
    };
    const ordinary = engine.pick(seed);
    assert.equal(ordinary.loops.length, 6);
    assert.equal(engine.pick({ ...seed, preferPost: true }).feature, 'post');
    assert.equal(
      engine.pick({ ...seed, point: [0, 26, 16], preferPost: true }).loops
        .length,
      6,
    );
  } finally {
    engine.dispose();
  }
});
