import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { unzipSync, strFromU8 } from 'fflate';
import { defaultTrack, buildTrack, chooseSegmentation } from '../src/track.js';
import { checkProject, newProject } from '../src/project.js';
import { specialTrackParams, SPECIAL_PIECES } from '../src/special-pieces.js';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { createEngine } from '../src/engine.js';

const wasm = await Module();
wasm.setup();
const base = {
  ...defaultTrack(),
  width: 200,
  lanes: 2,
  laneSpacing: 100,
  height: 10,
  slotDepth: 8,
  borderSide: 'both',
};
const params = (type = 'timing') => specialTrackParams(type, base);
const high = (s, x, y) => s.rayCast([x, y, 20], [x, y, -1])[0]?.position[2];
const close = (n, to) =>
  assert.ok(Math.abs(n - to) < 0.001, n + ' should be ' + to);
function withParts(p, fn) {
  const pieces = buildTrack(wasm, p);
  try {
    fn(pieces);
  } finally {
    pieces.forEach((piece) => piece.solid.delete());
  }
}

test('Optical gate keeps both running braids intact and opens two opposed windows at guide height, with a flush border exit', () => {
  const p = params(),
    y = 50;
  p.hollow = false;
  withParts(p, (parts) => {
    const road = parts.find((piece) => piece.role === 'road').solid;
    const socketY = y + p.slotWidth / 2 + 1.2 + p.special.sensorSize / 2;
    const beamZ = p.height - (p.slotDepth + p.braidDepth) / 2;
    for (const sign of [-1, 1])
      close(high(road, 0, y + sign * 3), p.height - p.braidDepth);
    assert.equal(road.rayCast([0, y, beamZ], [0, socketY, beamZ]).length, 0);
    assert.ok(road.rayCast([4, y, beamZ], [4, socketY, beamZ]).length > 0);
    close(
      road.rayCast([0, socketY, -1], [0, socketY, 20])[0].position[2],
      beamZ + 0.8,
    );
    const outer = parts.find((piece) => piece.id === 'border-outer-1').solid;
    const x = p.special.sensorSize / 2 + p.wall + 1 + 5;
    close(outer.rayCast([x, 105, -1], [x, 105, 20])[0].position[2], 1.35);
    close(outer.rayCast([x + 4, 105, -1], [x + 4, 105, 20])[0].position[2], 0);
  });
});

test('Dead strip has four insulating lands per lane and feed slits, while the guide stays open through each land in the STL', () => {
  const p = params();
  p.special.detector = 'strip';
  p.segments = 2;
  withParts(p, (parts) => {
    const gate = parts.find(
      (piece) =>
        piece.role === 'road' &&
        piece.solid.boundingBox().min[0] < -19 &&
        piece.solid.boundingBox().max[0] > 19,
    );
    assert.ok(gate);
    const printed = parseSTL(wasm, encodeSTL(gate.solid));
    try {
      for (const solid of [gate.solid, printed])
        for (const lane of [-50, 50]) {
          for (const x of [-19, 19]) {
            close(high(solid, x, lane), p.height - p.slotDepth);
            for (const sign of [-1, 1]) {
              const braidY = lane + sign * 4;
              close(high(solid, x, braidY), p.height);
              close(high(solid, x - 4, braidY), p.height - p.braidDepth);
              close(high(solid, x + 4, braidY), p.height - p.braidDepth);
              assert.equal(high(solid, x + 1.3, braidY), undefined);
              assert.equal(high(solid, x - 1.3, braidY), undefined);
            }
          }
        }
    } finally {
      printed.delete();
    }
  });
  p.special.stripLength = 140;
  p.segments = 4;
  assert.throws(() => buildTrack(wasm, p), /seam.*timing equipment/);
});

test('The automatic print layout can segment a timing straight without bisecting its detector', () => {
  const p = params();
  p.length = 385;
  const fit = chooseSegmentation(
    wasm,
    p,
    null,
    { width: 220, depth: 220, margin: 0 },
    'road-1',
  );
  assert.equal(fit.fits, true);
  assert.ok(fit.count > 1);
});

test('All six pack recipes round-trip and produce printable border STLs and route maps', () => {
  const engine = createEngine(wasm);
  try {
    for (const [type] of SPECIAL_PIECES) {
      const project = newProject();
      project.track = { params: params(type), plan: null, sourceName: type };
      const loaded = checkProject(JSON.parse(JSON.stringify(project)));
      assert.deepEqual(
        loaded.track.params.special,
        project.track.params.special,
      );
      const parts = engine.build(loaded);
      assert.ok(
        parts.some((part) => part.role === 'border'),
        type,
      );
      const kit = unzipSync(engine.kit());
      const wiring = strFromU8(kit['Conductor map.svg']);
      assert.match(wiring, /<polyline/);
      if (type === 'pit') {
        assert.match(wiring, /main island/);
        assert.match(wiring, /pit island/);
        assert.match(wiring, /Underside feed/);
        assert.match(wiring, /Rings · solder access/);
        assert.match(strFromU8(kit['Assembly notes.txt']), /feed the wire through the hole/);
        assert.ok(
          Object.keys(kit).some((name) => /^parts\/V.*\.stl$/.test(name)),
        );
      }
      if (type === 'hairpin') assert.match(wiring, /Underside jumper/);
      assert.ok(strFromU8(kit['Assembly notes.txt']).length > 50);
      const file = Object.keys(kit).find(
        (name) => name.startsWith('parts/T') && name.endsWith('.stl'),
      );
      const solid = parseSTL(wasm, kit[file]);
      try {
        assert.ok(solid.volume() > 0);
        close(solid.boundingBox().min[2], 0);
      } finally {
        solid.delete();
      }
      if (['diamond', 'hairpin'].includes(type)) {
        const coupon = parseSTL(
          wasm,
          engine.crossingSample(loaded.track.params),
        );
        try {
          assert.ok(coupon.volume() > 0);
          assert.ok(
            coupon.boundingBox().max[0] - coupon.boundingBox().min[0] < 160,
          );
        } finally {
          coupon.delete();
        }
      }
    }
  } finally {
    engine.dispose();
  }
});

test('the pit kit maps island slots and running-braid wire holes to the correct driver on both sides', () => {
  const p = params('pit');
  Object.assign(p.special, { side: 'both', pitContactMode: 'braid', pitContactLength: 1.2 });
  const project = newProject();
  project.track.params = p;
  const engine = createEngine(wasm);
  try {
    engine.build(project);
    const kit = unzipSync(engine.kit());
    const map = strFromU8(kit['Conductor map.svg']);
    for (const driver of [1, 2]) {
      for (const side of ['L', 'R']) {
        const rail = 'Lane ' + driver + ' · ' + side;
        assert.equal(map.split('<title>Braid pass-through · ' + rail + '</title></polygon>').length - 1, 2);
        assert.equal(map.split('<title>Solder access below braid · ' + rail + '</title></circle>').length - 1, 2);
      }
    }
    const notes = strFromU8(kit['Assembly notes.txt']);
    assert.match(notes, /Fold each tail down through its slot and back under the island/);
    assert.match(notes, /underside of the continuous braid/);
    assert.match(notes, /Connect L to L and R to R for the same driver/);
  } finally {
    engine.dispose();
  }
});
