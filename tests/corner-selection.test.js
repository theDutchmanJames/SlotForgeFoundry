import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { makeDemo } from '../src/editor.js';
import { faceOf, nextCorner } from '../src/mesh-topology.js';
import {
  crease,
  pickFinishEdge,
  resolveFinishEdge,
  topology,
} from '../src/geometry/feature-selection.js';
import {
  compactEdge,
  sameFinishEdge,
  selectedEdgeRefs,
} from '../src/geometry/edge-groups.js';
import { validateCreationFeature } from '../src/geometry/create-features.js';
import { toggleMember } from '../src/modify-selection.js';

const wasm = await init();
wasm.setup();

function topEdges(solid) {
  const top = solid.boundingBox().max[2],
    t = topology(solid),
    edges = [];
  for (let f = 0; 3 * f < t.indices.length; f++) {
    if (t.normal(f)[2] < 0.99999) continue;
    for (let j = 0; j < 3; j++) {
      const i = 3 * f + j;
      const a = t.point(i),
        b = t.point(nextCorner(i));
      if (Math.abs(a[2] - top) > 1e-5 || !crease(t, i)) continue;
      const midpoint = a.map((x, k) => (x + b[k]) / 2);
      edges.push({
        a,
        b,
        midpoint,
        pick: (side = false) =>
          pickFinishEdge(solid, side ? faceOf(t.twins[i]) : f, midpoint),
      });
    }
  }
  return edges;
}
const outside = ([x, y]) =>
  x >= 35.99 && y >= 21.99 && Math.hypot(x - 36, y - 22) > 4.95;
const outerCorner = (solid) =>
  topEdges(solid).filter((e) => outside(e.a) && outside(e.b));
const partOf = (a, b) => sameFinishEdge(a, b, 1e-4, 'corner');

test('both arcs of a lens can be Shift-selected and restored independently, even with a mirrored witness', (t) => {
  const radius = Math.sqrt(34),
    halfAngle = Math.atan2(5, 3);
  const upper = Array.from({ length: 17 }, (_, i) => {
    const angle = (i / 8 - 1) * halfAngle;
    return [radius * Math.sin(angle), radius * Math.cos(angle) - 3];
  });
  const profile = [
    ...upper,
    ...upper
      .slice(1, -1)
      .reverse()
      .map(([x, y]) => [x, -y]),
  ];
  const section = new wasm.CrossSection([profile.reverse()]),
    solid = section.extrude(3);
  t.after(() => {
    solid.delete();
    section.delete();
  });
  const edges = topEdges(solid);
  const a = edges.find((e) => e.midpoint[1] > 2.5).pick();
  const b = edges.find((e) => e.midpoint[1] < -2.5).pick(true);
  assert.deepEqual(a.corner.start, b.corner.end);
  assert.deepEqual(a.corner.end, b.corner.start);
  assert.ok(!partOf(a, b));
  const both = toggleMember([a], b, true, partOf);
  assert.equal(both.length, 2);
  assert.deepEqual(toggleMember(both, a, true, partOf), [b]);
  const reversed = {
    ...a,
    a: a.b,
    b: a.a,
    n1: a.n2,
    n2: a.n1,
    corner: {
      ...a.corner,
      start: a.corner.end,
      end: a.corner.start,
      startWitness: a.corner.endWitness,
      endWitness: a.corner.startWitness,
    },
  };
  assert.ok(partOf(a, reversed));
  // Simulate a changed bounding box projecting the saved click onto the other arc.
  // The absolute witness can still recover the correct finish at its original location.
  for (const [correct, other] of [
    [reversed, b],
    [b, a],
  ]) {
    const saved = { ...compactEdge(correct), witness: other.witness };
    const actual = resolveFinishEdge(solid, saved);
    assert.ok(partOf(correct, actual));
    assert.ok(!partOf(other, actual));
  }
});

test('a cap or a flank click anywhere on the compound enclosure corner locates one bounded curve', (t) => {
  for (const version of [1, 2]) {
    const stock = makeDemo(wasm, version);
    t.after(() => stock.delete());
    const facets = outerCorner(stock);
    assert.ok(facets.length > 7);
    const picks = facets.map((f, i) => f.pick(i % 2 === 0)),
      first = picks[0];
    assert.deepEqual(first.corner.start, [41, 22, 16]);
    assert.deepEqual(first.corner.end, [36, 27, 16]);
    assert.ok(first.corner.length > 7.8 && first.corner.length < 8);
    for (const picked of picks) {
      assert.ok(partOf(first, picked));
      assert.deepEqual(picked.cornerPath, first.cornerPath);
    }
    assert.ok(!sameFinishEdge(first, picks.at(-1), 1e-4, 'picked'));
    const distinct = selectedEdgeRefs(
      stock,
      [compactEdge(first), compactEdge(picks.at(-1))],
      'corner',
    );
    assert.equal(distinct.length, first.cornerPath.length - 1);
    const adjacentStraight = topEdges(stock)
      .find(
        (e) => e.a[0] === 41 && e.b[0] === 41 && Math.abs(e.b[1] - e.a[1]) > 10,
      )
      .pick();
    assert.equal(adjacentStraight.corner, undefined);
    assert.equal(
      selectedEdgeRefs(stock, [adjacentStraight], 'corner').length,
      1,
    );
    assert.equal(selectedEdgeRefs(stock, [first], 'picked').length, 1);
    const bore = topEdges(stock)
      .find(
        (e) => Math.abs(Math.hypot(e.a[0] - 36.6, e.a[1] - 22.6) - 1.7) < 0.001,
      )
      .pick();
    assert.equal(bore.circle.outward, -1);
    assert.equal(bore.corner, undefined);
  }
});

test('saved corner references replay on a finer tessellation with only a compact geometric witness', (t) => {
  const coarse = makeDemo(wasm, 1),
    fine = makeDemo(wasm, 2);
  t.after(() => {
    coarse.delete();
    fine.delete();
  });
  const original = outerCorner(coarse)[3].pick(true);
  const saved = JSON.parse(JSON.stringify(compactEdge(original)));
  assert.ok(!('cornerPath' in saved) && !('cornerEdges' in saved));
  const recovered = resolveFinishEdge(fine, saved);
  assert.ok(partOf(original, recovered));
  assert.ok(recovered.cornerPath.length > original.cornerPath.length);
  assert.throws(
    () =>
      validateCreationFeature({
        type: 'edgeFinish',
        kind: 'chamfer',
        size: 1,
        edge: { ...saved, corner: { ...saved.corner, normal: [1, 1, 0] } },
      }),
    /rounded corner/,
  );
});

test('a short tangent flat splits two successive arcs; a deliberate diagonal bevel stays one segment', (t) => {
  const shape = [
    [0, 0],
    [20, 0],
  ];
  const arc = (x, y, r, a0, a1) => {
    for (let j = 1; j <= 8; j++) {
      const a = a0 + ((a1 - a0) * j) / 8;
      shape.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
    }
  };
  arc(20, 5, 5, -Math.PI / 2, 0);
  shape.push([25, 5.8]);
  arc(20, 5.8, 5, 0, Math.PI / 2);
  shape.push([2, 10.8], [0, 8.8]);
  const section = new wasm.CrossSection([shape]),
    solid = section.extrude(4);
  t.after(() => {
    solid.delete();
    section.delete();
  });
  const edges = topEdges(solid);
  const first = edges
    .find((e) => e.midpoint[0] > 23 && e.midpoint[1] < 4)
    .pick();
  const second = edges
    .find((e) => e.midpoint[0] > 23 && e.midpoint[1] > 7)
    .pick(true);
  assert.ok(first.corner && second.corner && !partOf(first, second));
  assert.ok(first.cornerPath.every((p) => p[1] <= 5 + 1e-6));
  assert.ok(second.cornerPath.every((p) => p[1] >= 5.8 - 1e-6));
  assert.equal(
    edges.find((e) => e.a[0] === 25 && e.b[0] === 25).pick().corner,
    undefined,
  );
  assert.equal(
    edges.find((e) => e.midpoint[0] === 1 && e.midpoint[1] > 8).pick().corner,
    undefined,
  );
});

test('removing a selected boss cannot redirect a saved finish onto the same corner of its neighbour', (t) => {
  const garbage = [],
    own = (x) => (garbage.push(x), x);
  t.after(() => garbage.reverse().forEach((s) => s.delete()));
  const base = own(
    own(wasm.Manifold.cube([45, 45, 1], true)).translate([0, 0, 0.5]),
  );
  const profile = [
    [0, 0],
    [6, 0],
    [6, 4],
  ];
  for (let k = 1; k <= 8; k++)
    profile.push([
      4 + 2 * Math.cos((Math.PI * k) / 16),
      4 + 2 * Math.sin((Math.PI * k) / 16),
    ]);
  profile.push([0, 6]);
  const post = own(own(wasm.CrossSection.ofPolygons([profile])).extrude(3));
  const neighbour = own(post.translate([-12, -12, 0]));
  const before = own(wasm.Manifold.union([base, post, neighbour]));
  const remaining = own(base.add(neighbour));
  const corner = compactEdge(
    topEdges(before)
      .find(
        (e) => e.midpoint[0] > 4.5 && e.midpoint[0] < 5.5 && e.midpoint[1] > 4,
      )
      .pick(),
  );
  assert.ok(corner.corner);
  assert.throws(
    () => resolveFinishEdge(remaining, corner),
    /corner has changed/,
  );
});
