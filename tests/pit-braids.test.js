import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { defaultTrack, buildTrack } from '../src/track.js';
import { pitLayout } from '../src/geometry/special-junction-layout.js';
import { pitBraidLayout } from '../src/geometry/pit-braids.js';
import { SolidWorkshop } from '../src/geometry/solids.js';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { printableSTL } from '../src/kit.js';

const wasm = await Module();
wasm.setup();
const params = (side) => ({
  ...defaultTrack(),
  kind: 'straight',
  width: 200,
  laneSpacing: 100,
  length: 600,
  special: { type: 'pit', side, pitOffset: 100 },
});
const circle = (p, r) =>
  Array.from({ length: 32 }, (_, i) => [
    p[0] + r * Math.cos((i * Math.PI) / 16),
    p[1] + r * Math.sin((i * Math.PI) / 16),
  ]);

function exportedRoadMeshes(work, pieces, p) {
  // Pit road STLs are individually centred and placed running face down.
  return pieces.filter(part => part.role === 'road').map(part => {
    const file = printableSTL(part, encodeSTL, undefined, { mode: 'track', track: {params: p} });
    const mesh = work.own(parseSTL(wasm, file));
    assert.equal(mesh.status(), 'NoError');
    const { min, max } = part.solid.boundingBox();
    return work.own(work.own(mesh.rotate([180,0,0])).translate([
      (min[0]+max[0])/2, (min[1]+max[1])/2, max[2],
    ]));
  });
}

test('pit contact slits keep a full-height guide wall and feed folded tails from both island ends, while the through braids keep round wire taps', () => {
  for (const [side, hollow, braidGap, slitLength, segments, motorMount] of [
    ['both', true, 0, 1.2, 3, false], ['right', false, 2, 3.4, 1, true],
  ]) {
    const p = { ...params(side), hollow, braidGap, segments, height: 10, slotDepth: 8 };
    Object.assign(p.special, { pitContactMode: 'braid', pitContactLength: slitLength, motorMount });
    const layout = pitLayout(p), electrical = pitBraidLayout(p, layout);
    const pieces = buildTrack(wasm, p), w = new SolidWorkshop(wasm);
    try {
      const roads = exportedRoadMeshes(w, pieces, p);
      for (const j of electrical.jumpers) {
        const road = roads.find(mesh => {
          const { min, max } = mesh.boundingBox();
          return [j.from, j.to].every(([x,y]) => x >= min[0] && x <= max[0] && y >= min[1] && y <= max[1]);
        });
        assert.ok(road, 'both contacts belong to the same printable road segment');
        const [slot, tap] = j.openings;
        assert.equal(slot.kind, 'slot');
        assert.equal(tap.kind, 'hole');
        const footprint = w.section([slot.outline]);
        assert.ok(Math.abs(footprint.area() / p.braidWidth - slitLength) < 0.015);
        // A full braid-width gauge passes through the entire printed road.
        const plug = w.prism(w.own(footprint.offset(-0.015)), -0.01, p.height + 0.01);
        const collision = w.and(plug, road);
        assert.ok(Math.abs(collision.volume()) < 0.0001, `braid gauge at ${j.from} overlaps ${collision.volume()} mm³ (${collision.status()})`);
        assert.equal(road.rayCast([...j.to,-1], [...j.to,p.height+1]).length, 0);
        const { best, distance } = nearestPoint(layout.lanePaths, j.from);
        const normal = j.from.map((v,i) => (v - best[i]) / distance);
        const guard = Math.max(0.8, braidGap);
        assert.ok(Math.abs(distance - (p.slotWidth/2 + guard + p.braidWidth/2)) < 0.03);
        for (const d of [p.slotWidth/2 + 0.08, p.slotWidth/2 + guard - 0.08]) {
          const xy = best.map((v,i) => v + normal[i] * d);
          const top = road.rayCast([...xy,p.height+1], [...xy,0])[0];
          assert.ok(Math.abs(top?.position[2] - p.height) < 0.005, 'surface-height guide shoulder');
          for (const z of [p.height - p.slotDepth + 1, p.height - p.braidDepth - 1]) {
            if (d > p.slotWidth/2 + p.wall - 0.04) continue;
            const probe = w.section([circle(xy, 0.025)]);
            assert.ok(w.and(w.prism(probe, z, z + 0.1), road).volume() > 0.00015, 'backed guide wall');
          }
        }
        const tailXY = j.tailPocket.reduce((sum, v) => [sum[0]+v[0]/j.tailPocket.length,
          sum[1]+v[1]/j.tailPocket.length], [0,0]);
        const underside = road.rayCast([...tailXY,-1], [...tailXY,p.height])[0];
        assert.ok(underside.position[2] >= p.braidDepth && underside.position[2] <= j.wireDepth + 0.01,
          'the folded braid has a recessed backing surface');
        const tapEdge = [j.to[0] + j.viaRadius + 0.14, j.to[1]];
        const tapFloor = road.rayCast([...tapEdge,p.height+1], [...tapEdge,0])[0];
        assert.ok(Math.abs(tapFloor.position[2] - (p.height-p.braidDepth)) < 0.01,
          'wire access leaves the surrounding through braid seated');
      }
    } finally { w.close(); pieces.forEach(part => part.solid.delete()); }
  }
});

test('pit contact defaults, explicit wire mode, invalid length and colliding manual feed are handled independently', () => {
  const p = { ...params('left'), braidGap: 2 };
  const legacy = pitBraidLayout(p).jumpers;
  p.special.pitContactMode = 'wire';
  assert.deepEqual(pitBraidLayout(p).jumpers, legacy);
  p.special.pitContactMode = 'braid';
  const jumper = pitBraidLayout(p).jumpers[0];
  assert.equal(jumper.openings[0].length, 1.2);
  for (const value of [0, -1, Infinity, 51]) {
    p.special.pitContactLength = value;
    assert.throws(() => buildTrack(wasm, p), /opening length/);
  }
  p.special.pitContactLength = 1.2;
  p.braidFeedSide = 'left';
  p.braidFeedLane = 2;
  p.braidFeedStations = [0.5 + jumper.from[0]/p.length];
  assert.throws(() => buildTrack(wasm, p), /overlaps another braid pass-through/);
});

function nearestPoint(paths, point) {
  let best, distance = Infinity;
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const u = Math.max(0, Math.min(1,
        ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)));
      const q = [a[0] + u * dx, a[1] + u * dy];
      const d = Math.hypot(q[0] - point[0], q[1] - point[1]);
      if (d < distance) { distance = d; best = q; }
    }
  }
  return { best, distance };
}

test('pit jumper holes leave solid guide walls at zero and offset braid spacing', () => {
  for (const braidGap of [0, 0.6]) {
    const p = { ...params('left'), braidGap, hollow: true, segments: 1, wall: 0.8,
      joint: 'none', borderSide: 'none' };
    const geometry = pitLayout(p);
    const { jumpers } = pitBraidLayout(p, geometry);
    const parts = buildTrack(wasm, p);
    const w = new SolidWorkshop(wasm);
    try {
      const road = parts.find(part => part.role === 'road').solid;
      const slice = w.own(road.slice(p.height - p.slotDepth + 1));
      for (const { from, to, viaRadius } of jumpers) {
        for (const pad of [from, to]) {
          const { best, distance } = nearestPoint(geometry.lanePaths, pad);
          const nominalWeb = p.braidWidth / 2 + braidGap - viaRadius;
          assert.ok(distance - p.slotWidth / 2 - viaRadius >= nominalWeb - 0.025);
          const normal = pad.map((v, i) => (v - best[i]) / distance);
          const at = (d, across) => [best[0] + d * normal[0] - across * normal[1],
            best[1] + d * normal[1] + across * normal[0]];
          const start = p.slotWidth / 2 + 0.04;
          // The guide sleeve in a hollow piece is only as wide as its specified
          // wall. Test the complete backed run up to that width.
          const stop = Math.min(distance - viaRadius - 0.04, start + p.wall - 0.08);
          const web = w.section([[at(start,-0.02), at(stop,-0.02), at(stop,0.02), at(start,0.02)]]);
          assert.ok(w.own(web.subtract(slice)).area() < 0.00001, 'intact wall beside the terminal');
        }
      }
      const fork = geometry.forks[0];
      const halfway = fork.guardEndX - 7.5;
      const mainY = geometry.lanePaths[p.lanes - 1][0][1];
      const wall = w.section([circle([halfway, mainY + p.slotWidth / 2 + 0.25 + 0.72], 0.025)]);
      assert.ok(w.own(wall.subtract(slice)).area() < 0.00001, 'full wall behind the eased fixed shoulder');
    } finally {
      w.close();
      parts.forEach(part => part.solid.delete());
    }
  }
});

test('both handed pit turnouts preserve the outer braids and keep the island conductors clear of opposite polarities and the rotating hub', () => {
  for (const side of ['left', 'right', 'both'])
    for (const braidGap of [0, 0.6]) {
      const p = { ...params(side), braidGap },
        geometry = pitLayout(p),
        m = pitBraidLayout(p, geometry);
      const w = new SolidWorkshop(wasm);
      try {
        const rails = m.conductors.map((r) => w.section([r.polygon]));
        for (let i = 0; i < rails.length; i++) {
          const rail = m.conductors[i],
            bounds = rails[i].bounds();
          if (!rail.route.endsWith('island')) {
            assert.ok(
              bounds.min[0] <= -p.length / 2 && bounds.max[0] >= p.length / 2,
            );
          }
          for (let j = i + 1; j < rails.length; j++) {
            const next = m.conductors[j];
            if (next.driver === rail.driver && next.side === rail.side)
              continue;
            const left = w.own(rails[i].offset(0.24)),
              right = w.own(rails[j].offset(0.24));
            assert.ok(
              w.own(left.intersect(right)).area() < 1e-6,
              'physical separation between conductors',
            );
          }
          for (const fork of geometry.forks) {
            const hub = w.section([circle(fork.heel, 2.48)]);
            assert.ok(
              w.own(hub.intersect(rails[i])).area() < 1e-6,
              'the exposed rotating hub stays clear of both braids',
            );
          }
        }
        assert.equal(m.jumpers.length, 4 * geometry.forks.length);
        for (const jumper of m.jumpers)
          for (const [endpoint, island] of [
            [jumper.from, true],
            [jumper.to, false],
          ]) {
            const pad = w.section([circle(endpoint, 0.1)]);
            const onRail = m.conductors
              .map((r, i) => [r, w.own(pad.intersect(rails[i])).area()])
              .filter(([, area]) => area > 0.02);
            assert.equal(
              onRail.length,
              1,
              'terminal lies on exactly one conductor',
            );
            assert.equal(onRail[0][0].driver, jumper.driver);
            assert.equal(onRail[0][0].side, jumper.side);
            assert.equal(onRail[0][0].route.endsWith('island'), island);
          }
      } finally {
        w.close();
      }
    }
});

test('the segmented pit STL provides same-polarity jumper feeds, recessed wire paths and a shelf under each continuous outside braid', () => {
  const p = { ...params('both'), segments: 3, hollow: false },
    m = pitBraidLayout(p);
  const parts = buildTrack(wasm, p);
  const w = new SolidWorkshop(wasm);
  try {
    const road = w.union(
      parts.filter((x) => x.role === 'road').map((x) => x.solid),
    );
    function occupied(xy, z) {
      const probe = w.own(wasm.Manifold.cube([0.03, 0.03, 0.03], true));
      return (
        w.and(road, w.own(probe.translate([...xy, z]))).volume() >
        0.03 ** 3 * 0.5
      );
    }
    for (const j of m.jumpers) {
      for (const y of [j.from[1], j.to[1]]) {
        assert.equal(
          occupied([j.from[0], y], p.height - p.deck + 0.2),
          false,
          'terminal through the deck',
        );
      }
      const at = [j.from[0], (j.from[1] + j.to[1]) / 2];
      assert.equal(
        occupied(at, j.wireDepth / 2),
        false,
        'wiring sits inside table plane',
      );
      assert.equal(
        occupied(at, j.wireDepth + 0.1),
        true,
        'material remains above the channel',
      );
    }
    for (const rail of m.conductors.filter((r) => r.route === 'pit')) {
      const xy = rail.line.atOffset(0.5, rail.mid);
      assert.equal(
        occupied(xy, p.height - 0.25),
        false,
        'outside braid recess',
      );
      assert.equal(
        occupied(xy, p.height - p.braidDepth - 0.15),
        true,
        'continuous shelf',
      );
    }
  } finally {
    w.close();
    parts.forEach((x) => x.solid.delete());
  }
});
