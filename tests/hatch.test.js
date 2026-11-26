// Serving hatches and signs on a building: a counter under a window and a
// flap propped open over it, each a plate on fins that set its angle against
// the wall; a sign board along the top of the front wall. The food stalls
// are built from them.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { HATCH, KIT, OPENING_DEFAULTS, buildGarage, buildingLayout, printPose, printSize, validateBuilding } from '../src/geometry/building.js';
import { BUILDING_PRESETS } from '../src/building-presets.js';
import { kitNotes } from '../src/building-kit.js';

const wasm = await Module();
wasm.setup();
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const PLATE = { width: 200, depth: 200, margin: 0 };
const STALLS = BUILDING_PRESETS.filter((p) => p.id.startsWith('stall-'));
const hatch = (o) => ({ wall: 'front', type: 'window', at: 60, width: 40, height: 25, sill: 30, counter: true, flap: true, ...o });
const withParts = (settings, check, plate = null) => {
  const parts = buildGarage(wasm, settings, plate);
  try {
    return check(parts, (id) => parts.find((p) => p.id === id));
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
};
const overAir = (part) => {
  const printed = printPose(part);
  const m = printed.getMesh();
  let over = 0;
  for (let i = 0; i < m.triVerts.length; i += 3) {
    const v = [0, 1, 2].map((k) => Array.from(m.vertProperties.subarray(m.triVerts[i + k] * m.numProp, m.triVerts[i + k] * m.numProp + 3)));
    const a = v[1].map((x, j) => x - v[0][j]),
      b = v[2].map((x, j) => x - v[0][j]);
    const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const len = Math.hypot(...n);
    if (n[2] / len < -0.71 && Math.min(v[0][2], v[1][2], v[2][2]) > 0.05) over += len / 2;
  }
  printed.delete();
  return over;
};

test('a counter, a flap and a sign are checked', () => {
  const b = validateBuilding({ openings: [hatch({})], sign: 'fascia', door: 'none' });
  assert.equal(b.openings[0].counter, true);
  assert.throws(() => validateBuilding({ openings: [{ wall: 'front', type: 'door', at: 60, flap: true }] }), /A door has no counter or flap/);
  assert.throws(() => validateBuilding({ openings: [hatch({ counter: 'yes' })] }), /has a counter and a flap/);
  assert.throws(() => validateBuilding({ openings: [hatch({ sill: 10 })] }), /needs the window at least 15 mm up from the floor/);
  assert.throws(() => validateBuilding({ openings: [hatch({ sill: 12, frame: true })] }), /at least 18 mm up/);
  assert.throws(() => validateBuilding({ sign: 'fascia', numbers: true }), /sign and the bay numbers/);
  assert.throws(() => validateBuilding({ sign: 'fascia', doorHeight: 62 }), /garage door reaches up under the sign: at most 60 mm/);
  assert.throws(() => validateBuilding({ door: 'none', sign: 'fascia', signHeight: 30, openings: [hatch({})] }), /front window reaches up under the sign: its top can be at most 39 mm/);
  assert.throws(() => validateBuilding({ sign: 'big' }), /Choose a sign from the list/);
  assert.throws(() => validateBuilding({ sign: 'fascia', width: 70, depth: 70, signWidth: 80, door: 'none' }), /wider than the building: at most 70 mm/);
  assert.throws(() => validateBuilding({ sign: 'billboard', roof: 'gable', ridge: 'depth' }), /level along the front/);
  assert.throws(() => validateBuilding({ sign: 'billboard', roof: 'slope', rises: 'left' }), /level along the front/);
  assert.throws(() => validateBuilding({ sign: 'billboard', roofRailing: true }), /roof railing runs along the front/);
  // A billboard stands on the roof: the front wall's openings are free of it.
  assert.doesNotThrow(() => validateBuilding({ sign: 'billboard', signHeight: 60, door: 'none', openings: [hatch({})] }));
  assert.throws(() => validateBuilding({ openings: [hatch({ flapAngle: 70 })] }), /leans out between 0° \(level\) and 60°/);
  assert.throws(() => validateBuilding({ openings: [{ wall: 'front', type: 'door', at: 60, flapAngle: 10 }] }), /A door has no counter or flap/);
  assert.throws(() => validateBuilding({ width: 300, door: 'none', openings: [hatch({ at: 150, width: 190, counter: false })] }), /too wide for a counter or a flap in one piece: at most 180 mm/);
  // Only the front wall is under the sign.
  assert.doesNotThrow(() => validateBuilding({ door: 'none', sign: 'fascia', signHeight: 30, openings: [hatch({ wall: 'left', at: 90 })] }));
  const ids = buildingLayout({ door: 'none', sign: 'fascia', openings: [hatch({}), hatch({ at: 25, width: 12, counter: false })] }).parts.map((p) => p.id);
  assert.deepEqual(ids.filter((id) => /counter|flap|sign/.test(id)), ['counter-1', 'flap-1', 'flap-2', 'sign']);
});

test('each food stall builds: one body a part, fitting the plate, nothing over air, nothing in another part', () => {
  assert.deepEqual(STALLS.map((p) => p.id), ['stall-container', 'stall-twin', 'stall-kiosk', 'stall-tickets']);
  for (const { id, building } of STALLS)
    withParts(
      building,
      (parts) => {
        for (const p of parts.filter((q) => /^(counter|flap|sign)/.test(q.id))) {
          assert.equal(p.solid.decompose().length, 1, id + ': ' + p.name + ' is one body');
          assert.ok(overAir(p) <= 0.5, id + ': ' + p.name + ' prints ' + overAir(p).toFixed(1) + ' mm² over air');
        }
        for (let i = 0; i < parts.length; i++)
          for (let j = i + 1; j < parts.length; j++) {
            const both = parts[i].solid.intersect(parts[j].solid);
            assert.ok(both.volume() < 0.01, id + ': ' + parts[i].name + ' and ' + parts[j].name + ' overlap');
            both.delete();
          }
      },
      PLATE,
    );
});

test('the flap leans out at its angle, its fins joining it to the wall at every angle, clear of the counter', () => {
  for (const flapAngle of [0, 15, 35, 60])
    for (const frame of [false, true]) {
      const b = validateBuilding({ door: 'none', openings: [hatch({ flapAngle, frame, sill: 30 })] });
      withParts(b, (parts, part) => {
        const label = flapAngle + '°' + (frame ? ', framed' : '');
        const flap = part('flap-1');
        assert.equal(flap.solid.decompose().length, 1, 'one body ' + label);
        assert.ok(overAir(flap) <= 0.5, 'prints without supports ' + label);
        // Out from the wall by its length at that angle, and its thickness.
        const a = (flapAngle * Math.PI) / 180,
          L = 25 + 2 * (frame ? KIT.trim : 1),
          n0 = frame ? KIT.trimDepth : 0;
        const box = flap.solid.boundingBox();
        assert.ok(near(box.min[1], -n0 - L * Math.cos(a) - HATCH.flap * Math.sin(a), 0.05), 'reaches out ' + box.min[1] + ' ' + label);
        // The fins' back edge lies on the wall or on the frame: touching it, not in it.
        assert.ok(near(box.max[1], -n0, 0.01), 'against the ' + (frame ? 'frame' : 'wall') + ' ' + label);
        for (const other of parts.filter((p) => p !== flap)) {
          const both = flap.solid.intersect(other.solid);
          assert.ok(both.volume() < 0.01, 'clear of ' + other.name + ' ' + label);
          both.delete();
        }
      });
    }
});

test('the counter is level under the window, the flap leans out over it, both on the wall; the sign under the eaves', () => {
  const b = validateBuilding({ door: 'none', sign: 'fascia', signWidth: 100, openings: [hatch({}), hatch({ wall: 'right', at: 90, frame: true })] });
  withParts(b, (parts, part) => {
    const top = b.baseHeight;
    const counter = part('counter-1').solid.boundingBox();
    assert.ok(near(counter.max[2], top + 30) && near(counter.min[1], -HATCH.counter[0], 0.01) && near(counter.max[1], 0), 'counter top at the sill, out from the wall');
    assert.ok(near(counter.max[0] - counter.min[0], 40 + 2 * KIT.trim), 'as wide as the window and its margins');
    const flap = part('flap-1').solid.boundingBox();
    const a = (OPENING_DEFAULTS.window.flapAngle * Math.PI) / 180,
      L = 25 + 2;
    assert.ok(near(flap.min[1], -L * Math.cos(a) - HATCH.flap * Math.sin(a), 0.05), 'the flap reaches out: ' + flap.min[1]);
    assert.ok(near(flap.max[1], 0) && flap.max[2] > top + 30 + 25, 'hinged on the wall over the window');
    assert.ok(flap.min[2] > counter.max[2], 'over the counter');
    // On a framed window the flap is hinged on the frame's face, over its top.
    const framed = part('flap-2').solid.boundingBox();
    assert.ok(near(framed.min[0], 120 + KIT.trimDepth), 'on the frame: ' + framed.min[0]);
    // Each prints flat: as high as its fins.
    assert.ok(near(printSize(part('counter-1'))[2], HATCH.counter[1] + HATCH.finDrop * 0.9 * HATCH.counter[0], 0.05), 'counter ' + printSize(part('counter-1')));
    const sign = part('sign').solid.boundingBox();
    assert.ok(near(sign.max[2], top + b.height, 0.02) && near(sign.min[2], top + b.height - b.signHeight, 0.02) && near(sign.min[1], -HATCH.sign) && near(sign.min[0], 10) && near(sign.max[0], 110), 'the sign, in the middle');
    assert.equal(printSize(part('sign'))[2], HATCH.sign);
  });
  const notes = kitNotes('Stall', b, buildingLayout(b).parts, {});
  assert.match(notes, /Glue each counter under its window/);
  assert.match(notes, /Glue each flap over its window/);
  assert.match(notes, /Glue the sign along the top of the front wall/);
  assert.match(notes, /A counter or a flap lies on its top/);
});

test('a billboard stands on the roof, its foot on the roof, its fins behind it, on every roof that is level along the front', () => {
  const roofs = [{ roof: 'flat' }, { roof: 'slope', rises: 'back' }, { roof: 'slope', rises: 'front' }, { roof: 'gable', ridge: 'width', pitch: 30 }, { roof: 'gable', ridge: 'width', roofTexture: 'tile' }];
  for (const r of roofs) {
    const b = validateBuilding({ door: 'none', sign: 'billboard', signWidth: 90, signHeight: 30, overhangFront: 8, ...r });
    withParts(b, (parts, part) => {
      const label = JSON.stringify(r);
      const sign = part('sign');
      assert.equal(sign.name, 'Billboard');
      assert.equal(sign.solid.decompose().length, 1, 'one body ' + label);
      assert.ok(overAir(sign) <= 0.5, 'prints without supports ' + overAir(sign).toFixed(1) + ' ' + label);
      const box = sign.solid.boundingBox();
      assert.ok(near(box.min[0], 15) && near(box.max[0], 105), 'in the middle ' + label);
      assert.ok(near(box.min[1], -8 + HATCH.billboard.inset), 'just inside the front edge of the roof ' + label);
      // It stands on the roof: nothing of it in the roof, and its foot on it, not in the air.
      for (const roof of parts.filter((p) => p.role === 'roof')) {
        const both = sign.solid.intersect(roof.solid);
        assert.ok(both.volume() < 0.01, 'clear of ' + roof.name + ' ' + label);
        both.delete();
      }
      const roofTop = Math.max(...parts.filter((p) => p.role === 'roof').map((p) => {
        const probe = wasm.Manifold.cube([1, 0.1, 1000]).translate([60, box.min[1] + HATCH.sign / 2, 0]);
        const hit = p.solid.intersect(probe);
        const z = hit.isEmpty() ? -Infinity : hit.boundingBox().max[2];
        [probe, hit].forEach((x) => x.delete());
        return z;
      }));
      const foot = (() => {
        const probe = wasm.Manifold.cube([1, 0.1, 1000]).translate([60, box.min[1] + HATCH.sign / 2, 0]);
        const hit = sign.solid.intersect(probe);
        const z = hit.boundingBox().min[2];
        [probe, hit].forEach((x) => x.delete());
        return z;
      })();
      assert.ok(Math.abs(foot - roofTop) < 0.6, 'its foot on the roof: ' + foot.toFixed(2) + ' ' + roofTop.toFixed(2) + ' ' + label);
      assert.ok(box.max[2] >= roofTop + 30 - 0.01, 'standing up above it ' + label);
    });
  }
  assert.match(kitNotes('B', validateBuilding({ sign: 'billboard' }), buildingLayout({ sign: 'billboard' }).parts, {}), /Stand the billboard on the roof/);
});
