import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { buildTrack, defaultTrack, fitPlate } from '../src/track.js';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { specialTrackParams } from '../src/special-pieces.js';
import {
  diamondLayout,
  diamondJumperSize,
  pitLayout,
  pitPrintPath,
  specialJunctionPlan,
  pointOnAxis,
} from '../src/geometry/special-junction-layout.js';
import { pitBraidLayout } from '../src/geometry/pit-braids.js';
import { turnoutOutline } from '../src/geometry/pit-turnout.js';

const wasm = await Module();
wasm.setup();
function profile(type, changes = {}) {
  return {
    ...specialTrackParams(type, {
      ...defaultTrack(),
      width: 200,
      laneSpacing: 100,
      height: 10,
      slotDepth: 8,
    }),
    ...changes,
  };
}
function assembly(p, inspect) {
  const parts = buildTrack(wasm, p);
  try {
    inspect(parts);
  } finally {
    parts.forEach((part) => part.solid.delete());
  }
}
const top = (solid, x, y) =>
  solid.rayCast([x, y, 12], [x, y, -1])[0]?.position[2];
const near = (actual, expected) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-3,
    'expected ' + expected + '; measured ' + actual,
  );
function printable(part, inspect) {
  const printed = parseSTL(wasm, encodeSTL(part.solid));
  try {
    inspect(printed);
  } finally {
    printed.delete();
  }
}

test('diamond has four independent slot intersections, full-height insulating lands and recessed jumper feeds in the exported STL', () => {
  const p = profile('diamond', { hollow: false, braidGap: 2 });
  const { roads, breaks, gap } = diamondLayout(p);
  assert.equal(breaks.length, 4);
  assembly(p, ([road]) =>
    printable(road, (solid) => {
      const grooves = diamondJumperSize(p);
      assert.ok(2 * grooves.wireOD + 0.1 <= grooves.depth);
      // The common underside pocket beneath two passing leads stays open
      // through the entire overlap on a solid-body STL.
      const wireOffset = p.slotWidth / 2 + p.braidGap + p.braidWidth / 2;
      const [bx, by] = [breaks[0].x + wireOffset, breaks[0].y + wireOffset];
      near(
        solid.rayCast([bx, by, -1], [bx, by, p.height + 1])[0].position[2],
        grooves.depth,
      );
      for (const { axis, laneData } of roads)
        for (const { d, crossings } of laneData)
          for (const crossing of crossings) {
            const at = (x, y = d) => top(solid, ...pointOnAxis(axis, x, y));
            near(at(crossing), p.height - p.slotDepth);
            for (const sign of [-1, 1])
              for (const side of [-1, 1]) {
                const y = d + side * wireOffset;
                near(at(crossing + sign * (gap - 0.5), y), p.height);
                assert.equal(at(crossing + sign * (gap + 0.6), y), undefined);
                near(
                  at(crossing + sign * (gap + 2), y),
                  p.height - p.braidDepth,
                );
                const shoulder = d + side * (p.slotWidth / 2 + p.braidGap - 0.04);
                near(at(crossing + sign * (gap + 2), shoulder), p.height);
              }
          }
    }),
  );
});

test('exported pit keeps each braid at its specified width and leaves the chosen wall beside straight and curved slots', () => {
  for (const braidGap of [0, 2]) {
    const p = profile('pit', {
      slotWidth: 3, slotDepth: 8, braidWidth: 5, braidDepth: 0.5, braidGap,
      segments: 1, borderSide: 'none', joint: 'none',
    });
    const rails = pitBraidLayout(p).conductors;
    assembly(p, (parts) => printable(parts.find(part => part.role === 'road'), (solid) => {
      const half = p.slotWidth / 2;
      for (const rail of rails) {
        // Station 0.28 on the through pit conductor falls on the curved
        // leg, after the two slots diverge and outside the turnout sweep.
        const station = rail.route === 'pit' ? 0.28 : (rail.from + rail.to) / 2;
        const sign = Math.sign(rail.mid);
        const at = (offset) => top(solid, ...rail.line.atOffset(station, sign * offset));
        near(at(half - 0.04), p.height - p.slotDepth);
        if (braidGap > 0) {
          near(at(half + 0.04), p.height);
          near(at(half + braidGap - 0.04), p.height);
        }
        const nearEdge = half + braidGap;
        near(at(nearEdge + 0.04), p.height - p.braidDepth);
        near(at(nearEdge + p.braidWidth - 0.04), p.height - p.braidDepth);
        near(at(nearEdge + p.braidWidth + 0.04), p.height);
      }
    }));
  }
});

test('diamond elbows, segmented arms, borders and configured clips form printable nonoverlapping parts', () => {
  const p = profile('diamond', {
    length: 660,
    segments: 2,
    borderSide: 'both',
    borderSegments: 2,
    borderMount: 'clips',
    borderJoint: 'clips',
    joint: 'clips',
    borderEntry: 42,
    borderExit: 42,
    borderApex: 48,
    kerbEdge: 'road',
  });
  p.special.crossingAngle = 80;
  const plan = specialJunctionPlan(p);
  assert.equal(plan.borderPaths.length, 16);
  assembly(p, (parts) => {
    assert.equal(new Set(parts.map((part) => part.id)).size, parts.length);
    const roads = parts.filter((part) => part.role === 'road'),
      borders = parts.filter((part) => part.role === 'border');
    assert.equal(roads.length, 5);
    assert.equal(borders.length, 12);
    assert.ok(parts.some((part) => part.role === 'clip'));
    for (const part of [...roads, ...borders])
      printable(part, (s) => assert.ok(s.volume() > 0));
    for (const b of borders)
      for (const r of roads) {
        const common = b.solid.intersect(r.solid);
        try {
          assert.ok(common.volume() < 0.003, b.id + ' overlaps ' + r.id);
        } finally {
          common.delete();
        }
      }
  });
});

test('the pit uses the selected clip count across each road seam and along each median split', () => {
  const p = profile('pit', {
    segments: 3, borderSide: 'none', joint: 'clips', jointStart: 'none', jointEnd: 'none',
    connectorCounts: { seamClips: 2 },
  });
  assembly(p, parts => {
    const clips = parts.filter(part => part.role === 'clip');
    assert.equal(clips.filter(clip => clip.id.startsWith('road-clip-')).length, 4);
    for (let n = 1; n <= p.segments; n++)
      assert.equal(clips.filter(clip => clip.id.startsWith('median-' + n + '-')).length, 2);
  });
});

test('mirrored pits split into lane-width modules for a 200 mm plate and retain each mechanical blade on its own circuit', () => {
  const p = profile('pit', {
    segments: 4,
    borderSide: 'both',
    borderSegments: 3,
    joint: 'clips',
    borderMount: 'clips',
  });
  p.special.side = 'both';
  const geometry = pitLayout(p),
    printedPath = pitPrintPath(
      geometry.path,
      geometry.forks,
      p,
      pitBraidLayout(p, geometry),
    );
  assembly(p, (parts) => {
    const roads = parts.filter((part) => part.role === 'road'),
      blades = parts.filter((part) => part.role === 'turnout');
    assert.equal(roads.length, 8);
    assert.equal(blades.length, 2);
    assert.ok(
      parts.some(
        (part) => part.role === 'clip' && part.id.startsWith('median-'),
      ),
    );
    assert.ok(
      roads.every((part) => fitPlate(part.footprintXY, 200, 200, 0).fits),
    );
    for (const b of parts.filter((part) => part.role === 'border')) {
      for (const part of roads) {
        const overlap = part.solid.intersect(b.solid);
        try {
          assert.ok(overlap.volume() < 0.002);
        } finally {
          overlap.delete();
        }
      }
    }
    for (const fork of geometry.forks) {
      const { heel, mainToe, pitToe } = fork;
      for (const t of printedPath.cuts.slice(1, -1)) {
        const x = (t - 0.5) * p.length;
        assert.ok(x < mainToe[0] - 4.9 || x > heel[0] + 4.9);
      }
      const blade = blades.find((b) => b.id === 'pit-blade-' + fork.side);
      const a = Math.atan2(mainToe[1] - heel[1], mainToe[0] - heel[0]);
      const b = Math.atan2(pitToe[1] - heel[1], pitToe[0] - heel[0]);
      const sweep =
        (Math.atan2(Math.sin(b - a), Math.cos(b - a)) * 180) / Math.PI;
      printable(blade, (stl) => {
        const origin = stl.translate([-heel[0], -heel[1], 0]);
        try {
          for (const t of [0, 0.25, 0.5, 0.75, 1]) {
            const rotated = origin.rotate([0, 0, t * sweep]);
            const installed = rotated.translate([...heel, 0]);
            try {
              for (const r of roads) {
                const common = r.solid.intersect(installed);
                try {
                  assert.ok(
                    common.volume() < 0.001,
                    'blade binds during throw',
                  );
                } finally {
                  common.delete();
                }
              }
            } finally {
              installed.delete();
              rotated.delete();
            }
          }
        } finally {
          origin.delete();
        }
      });
      // The through-deck bearing must be open from the underside for the drive shaft.
      for (const road of roads) assert.equal(top(road.solid, ...heel), undefined);
    }
  });
});

test('impossible oblique crossing and a too-short turnout give actionable geometry errors', () => {
  const diamond = profile('diamond', { length: 200 });
  diamond.special.crossingAngle = 55;
  assert.throws(() => specialJunctionPlan(diamond), /engthen the diamond arms/);
  const pit = profile('pit', { length: 130 });
  assert.throws(
    () => specialJunctionPlan(pit),
    /pit approach bends too sharply/,
  );
});

test('pit validation checks floor thickness and blind fixing space before printing', () => {
  const p = profile('pit', { height: 10, slotDepth: 8.15 });
  assert.doesNotThrow(() => specialJunctionPlan(p), 'exactly 1.85 mm under the guide is sufficient');
  assert.throws(() => specialJunctionPlan({ ...p, slotDepth: 8.16 }), /1\.85 mm under the guide/);
  assert.throws(() => specialJunctionPlan({ ...p, height: 7, slotDepth: 5 }), /actuator key.*blind retaining screw/);
});

test('pit print seams keep the moving tail and its seat on the same road section without braid terminals', () => {
  for (const segments of [4, 9, 16, 28]) {
    const p = profile('pit', { segments, braidWidth: 0 });
    p.special.side = 'both';
    const { path, forks } = pitLayout(p);
    const split = pitPrintPath(path, forks, p, pitBraidLayout(p));
    for (const fork of forks) {
      const sweep = [0, 0.25, 0.5, 0.75, 1].flatMap(t => turnoutOutline(fork, t));
      const x = sweep.map(point => point[0]);
      const left = Math.min(...x) - 0.25;
      const right = Math.max(...x) + 0.25;
      for (const station of split.cuts.slice(1, -1)) {
        const seam = (station - 0.5) * p.length;
        assert.ok(seam < left || seam > right, 'print seam passes through the flipper pocket');
      }
    }
  }
});
