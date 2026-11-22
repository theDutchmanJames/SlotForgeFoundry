import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { SolidWorkshop } from '../src/geometry/solids.js';
import { encodeSTL, parseSTL, surfaceRegion } from '../src/editor.js';
import { meshFromSolid } from '../src/mesh-topology.js';
import {
  applyCreationFeature,
  defaultHolePlacement,
  pickFinishEdge,
  validateCreationFeature,
} from '../src/geometry/create-features.js';
import { locateHole } from '../src/geometry/feature-selection.js';
import { createEngine } from '../src/engine.js';
import { newProject, checkProject, toBase64 } from '../src/project.js';

const wasm = await init();
wasm.setup();
function tools(t) {
  const workshop = new SolidWorkshop(wasm);
  t.after(() => workshop.close());
  const own = (x) => workshop.own(x);
  return {
    own,
    block: (x, y, z) => own(wasm.Manifold.cube([x, y, z])),
    apply: (stock, op, seeds = new Map()) =>
      applyCreationFeature(wasm, stock, op, seeds, own),
    printed: (solid) => own(parseSTL(wasm, encodeSTL(solid))),
  };
}
function part(solid) {
  return { ...meshFromSolid(solid), bounds: solid.boundingBox(), id: 'body' };
}
function top(solid, x, y) {
  const z = solid.boundingBox().max[2] + 1;
  const hit = solid.rayCast([x, y, z], [x, y, -1])[0];
  const region = surfaceRegion(solid, Number(hit.faceID), 0);
  region.seed = { triangle: Number(hit.faceID), point: hit.position };
  return region;
}
function hole(solid, x, y, extra = {}) {
  const region = top(solid, x, y);
  return {
    id: 'drill',
    target: 'body',
    type: 'hole',
    kind: 'plain',
    diameter: 3,
    extent: 'through',
    ...defaultHolePlacement(region, part(solid)),
    ...extra,
  };
}
function depth(solid, x, y) {
  return solid.rayCast([x, y, 100], [x, y, -1])[0]?.position?.[2];
}
function near(a, b, tolerance = 0.002) {
  assert.ok(Math.abs(a - b) <= tolerance, `${a} versus ${b}`);
}

test('plain through, blind counterbore and angled countersink produce stepped and conical exported cuts', (t) => {
  const { block, apply, printed } = tools(t),
    stock = block(24, 24, 12);
  const p = hole(stock, 12, 12);
  const through = printed(apply(stock, p).solid);
  assert.equal(depth(through, 12, 12), undefined);
  near(depth(through, 14, 12), 12);
  const bore = printed(
    apply(stock, {
      ...p,
      kind: 'counterbore',
      headDiameter: 8,
      headDepth: 2,
      extent: 'blind',
      depth: 7,
    }).solid,
  );
  near(depth(bore, 12, 12), 5);
  near(depth(bore, 15, 12), 10);
  near(depth(bore, 16.5, 12), 12);
  const sink = printed(
    apply(stock, {
      ...p,
      kind: 'countersink',
      diameter: 4,
      headDiameter: 8,
      headAngle: 90,
    }).solid,
  );
  near(depth(sink, 15, 12), 11, 0.04);
  near(depth(sink, 15.5, 12), 11.5, 0.04);
  assert.throws(
    () => apply(stock, { ...p, offsetU: 0 }),
    /crosses a face edge/,
  );
  assert.throws(
    () =>
      apply(stock, {
        ...p,
        kind: 'counterbore',
        headDiameter: 4,
        headDepth: 3,
        extent: 'blind',
        depth: 2,
      }),
    /below the screw head/,
  );
});

test('mirror replays source diameter and preserves mounting distances when the bracket width changes', (t) => {
  const { block, own, apply, printed } = tools(t);
  const bracket = (w) => own(block(w, 22, 4).add(block(w, 4, 30)));
  const original = bracket(40),
    h = hole(original, 6, 16);
  const mirror = {
    type: 'featurePattern',
    kind: 'mirror',
    id: 'pair',
    target: 'body',
    sourceId: 'drill',
    axis: 'x',
    centerMode: 'part',
  };
  for (const [stock, width, dia] of [
    [original, 40, 3],
    [bracket(70), 70, 5],
  ]) {
    const op = { ...h, diameter: dia };
    const seed = apply(stock, op),
      seeds = new Map([['drill', { ...seed, target: 'body' }]]);
    const replay = printed(apply(seed.solid, mirror, seeds).solid);
    for (const x of [6, width - 6]) {
      assert.equal(depth(replay, x, 16), undefined);
      assert.equal(depth(replay, x + dia / 2 - 0.08, 16), undefined);
      near(depth(replay, x + dia / 2 + 0.08, 16), 4);
    }
    near(depth(replay, width / 2, 16), 4);
  }
});

test('linear and circular repeat transforms instance geometry about the selected axis and reject empty cutters', (t) => {
  const { block, apply, printed } = tools(t),
    stock = block(40, 40, 8);
  const seed = apply(stock, hole(stock, 10, 20)),
    seeds = new Map([['drill', { ...seed, target: 'body' }]]);
  const op = {
    type: 'featurePattern',
    kind: 'linear',
    id: 'row',
    target: 'body',
    sourceId: 'drill',
    axis: 'x',
    spacing: 8,
    count: 3,
  };
  const row = printed(apply(seed.solid, op, seeds).solid);
  for (const x of [10, 18, 26]) assert.equal(depth(row, x, 20), undefined);
  const circular = {
    ...op,
    kind: 'circular',
    axis: 'z',
    angle: 360,
    count: 4,
    centerMode: 'part',
  };
  const ring = printed(apply(seed.solid, circular, seeds).solid);
  for (const [x, y] of [
    [10, 20],
    [30, 20],
    [20, 10],
    [20, 30],
  ])
    assert.equal(depth(ring, x, y), undefined);
  const custom = printed(
    apply(
      seed.solid,
      {
        ...circular,
        angle: 180,
        count: 2,
        centerMode: 'custom',
        center: [16, 20, 0],
      },
      seeds,
    ).solid,
  );
  assert.equal(depth(custom, 22, 20), undefined);
  assert.throws(
    () => apply(seed.solid, { ...op, spacing: 50 }, seeds),
    /copy 2 has no material/,
  );
  assert.throws(
    () => apply(seed.solid, { ...op, count: 2, axis: 'z', spacing: 0 }, seeds),
    /nonzero/,
  );
});

test('edge picker ignores face diagonals and exported straight convex chamfer/fillet have the requested dimensions', (t) => {
  const { block, apply, printed } = tools(t),
    stock = printed(block(30, 20, 10));
  const hit = stock.rayCast([15, 0.05, 16], [15, 0.05, 0])[0];
  const edge = pickFinishEdge(part(stock), Number(hit.faceID), hit.position);
  assert.ok(edge.convex);
  near(Math.hypot(...edge.a.map((v, i) => v - edge.b[i])), 30);
  const f = {
    id: 'rim',
    target: 'body',
    type: 'edgeFinish',
    kind: 'chamfer',
    edge,
    size: 2,
  };
  const bevel = printed(apply(stock, f).solid);
  near(bevel.volume(), 6000 - 30 * 2);
  near(depth(bevel, 15, 1), 9);
  const round = printed(apply(stock, { ...f, kind: 'fillet' }).solid);
  near(round.volume(), 6000 - 30 * (4 - Math.PI), 1);
  near(depth(round, 15, 1), 8 + Math.sqrt(3), 0.025);
  const fine = printed(
    apply(stock, { ...f, kind: 'fillet', curveVersion: 2 }).solid,
  );
  assert.ok(fine.numTri() > round.numTri());
  // Sample between mesh vertices in directions radial to the 2 mm round.
  for (let i = 0; i < 32; i++) {
    const angle = ((i + 0.5) * Math.PI) / 64;
    const y = Math.cos(angle),
      z = Math.sin(angle);
    const hit = fine.rayCast([15, 2 - 4 * y, 8 + 4 * z], [15, 2, 8])[0]
      .position;
    near(Math.hypot(hit[1] - 2, hit[2] - 8), 2, 0.00501);
  }
  assert.throws(
    () => apply(stock, { ...f, size: 25 }),
    /beyond an adjacent face/,
  );
});

test('interior straight corner takes an additive bevel or a tangent round', (t) => {
  const { block, own, apply, printed } = tools(t);
  const stock = printed(own(block(25, 16, 3).add(block(25, 3, 18))));
  const hit = stock.rayCast([12, 3.03, 22], [12, 3.03, 0])[0],
    edge = pickFinishEdge(part(stock), Number(hit.faceID), hit.position);
  assert.equal(edge.convex, false);
  const f = {
    type: 'edgeFinish',
    id: 'inside',
    target: 'body',
    kind: 'chamfer',
    size: 2,
    edge,
  };
  near(depth(printed(apply(stock, f).solid), 12, 4), 4);
  near(
    depth(printed(apply(stock, { ...f, kind: 'fillet' }).solid), 12, 4),
    5 - Math.sqrt(3),
    0.025,
  );
});

test('hole seat re-finds the selected face of a translated and retessellated body', (t) => {
  const { own, block } = tools(t),
    source = block(40, 20, 8),
    op = hole(source, 35, 4);
  const updated = own(block(75, 20, 12).translate([12, 9, 5]));
  const point = locateHole(updated, op);
  near(point[0], 82);
  near(point[1], 13);
  near(point[2], 17);
  assert.throws(
    () =>
      validateCreationFeature({
        ...op,
        kind: 'countersink',
        headAngle: 180,
        headDiameter: 6,
      }),
    /between 0 and 180/,
  );
});

test('straight-sided STL cylinder and drilled inner rims receive complete concentric bevels and rounds', (t) => {
  const { apply, printed, own } = tools(t);
  const outer = own(wasm.Manifold.cylinder(12, 15, 15, 48)),
    bore = own(wasm.Manifold.cylinder(12, 5, 5, 48));
  const ring = printed(own(outer.subtract(bore)));
  for (const [x, r, sign] of [
    [14.93, 15, -1],
    [5.07, 5, 1],
  ]) {
    const hit = ring.rayCast([x, 0, 14], [x, 0, 0])[0];
    const edge = pickFinishEdge(part(ring), Number(hit.faceID), hit.position);
    assert.ok(edge.circle);
    near(edge.circle.radius, r);
    const f = {
      type: 'edgeFinish',
      id: 'rim',
      target: 'body',
      kind: 'chamfer',
      size: 2,
      edge,
    };
    const bevel = printed(apply(ring, f).solid);
    for (const angle of [0.15, 1.7, 3.2, 4.8]) {
      const p = [Math.cos(angle) * (r + sign), Math.sin(angle) * (r + sign)];
      near(depth(bevel, ...p), 11, 0.055);
    }
    const round = printed(apply(ring, { ...f, kind: 'fillet' }).solid);
    near(depth(round, r + sign, 0), 10 + Math.sqrt(3), 0.045);
    assert.ok(
      round.volume() > bevel.volume() && round.volume() < ring.volume(),
    );
  }
});

test('additive feature patterns keep flush bosses attached and refuse detached instances', (t) => {
  const { block, apply, own } = tools(t),
    plate = block(30, 20, 4),
    boss = own(own(wasm.Manifold.cylinder(3, 2, 2, 48)).translate([5, 10, 4]));
  const stock = own(plate.add(boss)),
    seeds = new Map([['boss', { tool: boss, mode: 'join', target: 'body' }]]);
  const op = {
    id: 'row',
    type: 'featurePattern',
    kind: 'linear',
    sourceId: 'boss',
    target: 'body',
    axis: 'x',
    count: 3,
    spacing: 10,
  };
  const result = apply(stock, op, seeds).solid;
  near(depth(result, 15, 10), 7);
  near(depth(result, 25, 10), 7);
  assert.throws(() => apply(stock, { ...op, spacing: 16 }, seeds), /detached/);
});

test('saved mirror feature follows its original bore through transformations and alignment', (t) => {
  const { block, own } = tools(t),
    stock = block(40, 20, 6),
    model = toBase64(encodeSTL(stock));
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  const drill = hole(stock, 6, 10),
    move = {
      id: 'move',
      type: 'transform',
      target: 'body',
      scale: 1,
      rotate: [0, 0, 0],
      move: [75, 10, 3],
      layFlat: [0, 0, -1],
    };
  const align = {
    id: 'align',
    type: 'alignParts',
    target: 'body',
    reference: 'second',
    alignment: 'centres',
    gap: 0,
  };
  const mirror = {
    id: 'mirror',
    type: 'featurePattern',
    kind: 'mirror',
    target: 'body',
    sourceId: drill.id,
    axis: 'x',
    centerMode: 'part',
  };
  for (const how of ['transform', 'align']) {
    const project = newProject();
    project.mode = 'editor';
    project.editor.source = { label: 'Plate', data: model };
    const refs =
      how === 'align'
        ? [
            {
              id: 'second',
              type: 'addModel',
              name: 'Jig',
              data: toBase64(encodeSTL(own(stock.translate([180, 70, 0])))),
            },
            align,
          ]
        : [];
    project.editor.ops = [drill, move, ...refs, mirror];
    engine.build(checkProject(JSON.parse(JSON.stringify(project))));
    const result = own(
      parseSTL(wasm, engine.export({ id: 'body', mode: 'part' })),
    );
    const b = result.boundingBox(),
      y = (b.min[1] + b.max[1]) / 2;
    near(b.min[0], how === 'align' ? 180 : 75);
    for (const x of [b.min[0] + 6, b.max[0] - 6])
      assert.equal(depth(result, x, y), undefined);
    near(depth(result, b.min[0] + 20, y), 6);
  }
});
