import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import originalClip from '../src/geometry/carrera-clip.json' with { type: 'json' };
import { encodeSTL, parseSTL } from '../src/editor.js';
import { strFromU8, unzipSync } from 'fflate';
import { packKit } from '../src/kit.js';
import { newProject } from '../src/project.js';
import { buildTrack, defaultTrack, validateTrack } from '../src/track.js';
import { SolidWorkshop } from '../src/geometry/solids.js';
import { withPrintableSolid } from '../src/geometry/joints.js';
import {
  clipAttribution,
  clipSpec,
  clipSTLHeader,
} from '../src/geometry/clip-types.js';
import {
  KEEPER_LIFT,
  KEEPER_SHELF,
  KEEPER_THICKNESS,
  RETAINED_ROOF,
} from '../src/geometry/keeper-dimensions.js';

const wasm = await init();
wasm.setup();

function params(clipType, clipClearance = 0.15) {
  return {
    ...defaultTrack(),
    kind: 'straight',
    length: 240,
    segments: 2,
    joint: 'clips',
    jointStart: 'none',
    jointEnd: 'none',
    placements: { seamClips: [0] },
    clipType,
    clipClearance,
  };
}

function fixture(t, p) {
  const shop = new SolidWorkshop(wasm);
  const parts = buildTrack(wasm, p);
  t.after(() => {
    parts.forEach((part) => part.solid.delete());
    shop.close();
  });
  return {
    shop,
    road: parts.filter((part) => part.role === 'road'),
    main: parts[2],
    keeper: parts[3],
    keepers: parts.filter((part) => part.role === 'retainer'),
  };
}

function near(actual, expected, label) {
  assert.ok(
    Math.abs(actual - expected) <= 0.00001,
    label + ': ' + actual + ' vs ' + expected,
  );
}

for (const type of ['draw-key', 'carrera-retained']) {
  for (const c of [0.03, 0.15, 0.4]) {
    test(
      type + ' installs from below and retains both clip ends at gap ' + c,
      (t) => {
        const p = {
          ...params(type, c),
          height: clipSpec(params(type, c)).minimumHeight,
          slotDepth: 5,
        };
        const spec = clipSpec(p);
        const { shop, road, main, keepers } = fixture(t, p);
        const expected = type === 'draw-key' ? [0] : [-15, 15];
        assert.equal(keepers.length, expected.length);
        const bodies = road.map((part) => part.solid);
        const collision = (a, b) => shop.and(a, b).volume();
        const seat = main.solid.boundingBox().min[2];
        near(seat, spec.seatHeight, 'main clip seat');
        const gap = type === 'draw-key' ? 0.15 : c;
        const roof = type === 'draw-key' ? 2 : RETAINED_ROOF;
        assert.ok(p.height >= seat + spec.thickness + gap + roof - 1e-6);
        // Complete downward sweep of a seated solid. The extruded projection is
        // a stronger check than sampling at a handful of insertion heights.
        const insertion = shop.prism(
          shop.own(main.solid.project()),
          -1,
          seat + spec.thickness,
        );
        for (const body of bodies)
          near(collision(insertion, body), 0, 'open primary insertion path');
        for (const [index, keeper] of keepers.entries()) {
          const x = expected[index];
          assert.equal(
            keeper.id,
            main.id + '-retainer' + (x ? '-' + (index + 1) : ''),
          );
          assert.equal(keeper.parentClipId, main.id);
          assert.equal(keeper.fabricationKey, 'quarter-turn-keeper/v1');
          const { min, max } = keeper.solid.boundingBox();
          near((min[0] + max[0]) / 2, x, 'keeper station');
          near(min[2], 0.3, 'table clearance');
          const origin = shop.own(keeper.solid.translate([-x, 0, 0]));
          const at = (angle, lift) =>
            shop.own(
              shop
                .own(origin.rotate([0, 0, angle - 90]))
                .translate([x, 0, lift]),
            );
          const entry = at(0, KEEPER_LIFT);
          const entrySweep = shop.prism(
            shop.own(entry.project()),
            -1,
            KEEPER_SHELF + KEEPER_THICKNESS + KEEPER_LIFT,
          );
          for (const body of bodies)
            near(collision(entrySweep, body), 0, 'open keeper entry');
          for (let angle = 0; angle <= 90; angle += 5) {
            const raised = at(angle, KEEPER_LIFT);
            const otherKeepers = keepers
              .filter((k) => k !== keeper)
              .map((k) => k.solid);
            for (const body of [...bodies, main.solid, ...otherKeepers])
              near(
                collision(raised, body),
                0,
                'quarter-turn clearance ' + angle,
              );
          }
          for (const body of bodies) {
            near(collision(keeper.solid, body), 0, 'keeper seated');
          }
          const supporting = x ? [bodies[index]] : bodies;
          for (const body of supporting) {
            assert.ok(
              collision(at(90, -0.3), body) > 0.2,
              'the installed keeper has a load-bearing shelf',
            );
            assert.ok(
              collision(at(70, 0), body) > 0.1,
              'locked keeper must lift to turn',
            );
          }
          assert.ok(
            bodies.some((body) => collision(at(110, KEEPER_LIFT), body) > 0.1),
            'positive rotation stop',
          );
          assert.ok(
            collision(
              shop.own(main.solid.translate([0, 0, -1.45])),
              keeper.solid,
            ) > 1,
            'keeper catches the falling clip',
          );
          near(
            collision(main.solid, keeper.solid),
            0,
            'clearance between assembled parts',
          );
          withPrintableSolid(
            keeper,
            (solid) => {
              near(solid.boundingBox().min[2], 0, 'print-bed contact');
              near(
                solid.volume(),
                keeper.solid.volume(),
                'identical printable keeper',
              );
              assert.ok(
                shop.own(solid.slice(0.01)).area() > 55,
                'wide blade face lies against the bed',
              );
              assert.equal(solid.status(), 'NoError');
            },
            { sideDown: true },
          );
        }
      },
    );
  }
}

test('the original key shoulders take up seam clearance during the insertion stroke', (t) => {
  const { shop, road, main } = fixture(t, params('draw-key'));
  for (const [i, half] of road.entries()) {
    const shifted = shop.own(half.solid.translate([i ? 0.2 : -0.2, 0, 0]));
    const starting = shop.own(
      main.solid.translate([
        0,
        0,
        -0.8 * clipSpec(params('draw-key')).thickness,
      ]),
    );
    near(
      shop.and(shifted, starting).volume(),
      0,
      'key lead-in admits an open seam',
    );
    assert.ok(
      shop.and(shifted, main.solid).volume() > 0.05,
      'bearing enforces closure on final insertion',
    );
  }
});

test('angled road and border joints have one matching keeper per loose clip', (t) => {
  const p = {
    ...params('draw-key'),
    kind: 'curve',
    segments: 2,
    borderSide: 'outer',
    borderSegments: 2,
    borderMount: 'clips',
    borderJoint: 'clips',
    borderEntry: 80,
    borderApex: 80,
    borderExit: 80,
    radius: 550,
    angle: 50,
  };
  const parts = buildTrack(wasm, p);
  const shop = new SolidWorkshop(wasm);
  t.after(() => {
    parts.forEach((part) => part.solid.delete());
    shop.close();
  });
  const loose = parts.filter((p) => p.role === 'clip');
  const keepers = parts.filter((p) => p.role === 'retainer');
  assert.equal(keepers.length, loose.length);
  for (const prefix of ['road-clip', 'side-clip', 'end-clip']) {
    assert.ok(loose.some((p) => p.id.startsWith(prefix)));
  }
  const structure = shop.union(
    parts
      .filter((p) => p.role === 'road' || p.role === 'border')
      .map((p) => p.solid),
  );
  for (const main of loose) {
    const keeper = keepers.find((p) => p.id === main.id + '-retainer');
    near(
      shop.and(keeper.solid, structure).volume(),
      0,
      'keeper clears curved joint',
    );
    near(
      shop.and(main.solid, structure).volume(),
      0,
      'main clears curved joint',
    );
    near(
      shop.and(keeper.solid, main.solid).volume(),
      0,
      'hardware clears its mate',
    );
  }
  const main = loose.find((p) => p.id.startsWith('side-clip'));
  const keeper = keepers.find((p) => p.id === main.id + '-retainer');
  const bounds = main.solid.boundingBox();
  const [x, y] = bounds.min.map((n, i) => (n + bounds.max[i]) / 2);
  // The border station is away from the world origin and its seam is curved.
  // Rotate about the slotted boss, preserving that station's local direction.
  const localKeeper = shop.own(keeper.solid.translate([-x, -y, 0]));
  for (let a = -90; a <= 0; a += 10) {
    const moving = shop.own(
      shop.own(localKeeper.rotate([0, 0, a])).translate([x, y, KEEPER_LIFT]),
    );
    near(
      shop.and(moving, structure).volume(),
      0,
      'curved joint turn clearance',
    );
  }
  const sweep = shop.prism(shop.own(main.solid.project()), -1, bounds.max[2]);
  near(
    shop.and(sweep, structure).volume(),
    0,
    'open underside on the curved road and border',
  );
  const pulling = shop.own(keeper.solid.translate([0, 0, -0.3]));
  for (const role of ['road', 'border']) {
    assert.ok(
      parts
        .filter((p) => p.role === role)
        .some((p) => shop.and(pulling, p.solid).volume() > 0.2),
      role + ' supports the locked keeper',
    );
  }
});

test('every Carrera keeper on a curved road, border mount or border seam turns and bears on the local pocket', (t) => {
  const p = {
    ...params('carrera-retained'),
    kind: 'curve',
    radius: 550,
    angle: 50,
    segments: 2,
    borderSegments: 2,
    jointStart: 'clips',
    jointEnd: 'clips',
    borderSide: 'outer',
    borderMount: 'clips',
    borderJoint: 'clips',
    borderEntry: 80,
    borderExit: 80,
    borderApex: 80,
  };
  const parts = buildTrack(wasm, p);
  const shop = new SolidWorkshop(wasm);
  t.after(() => {
    parts.forEach((part) => part.solid.delete());
    shop.close();
  });
  const clips = parts.filter((part) => part.role === 'clip');
  const keepers = parts.filter((part) => part.role === 'retainer');
  assert.equal(keepers.length, clips.length * 2);
  assert.equal(new Set(keepers.map((part) => part.id)).size, keepers.length);
  const structure = shop.union(
    parts
      .filter((part) => part.role === 'road' || part.role === 'border')
      .map((part) => part.solid),
  );
  const center = (part) => {
    const box = part.solid.boundingBox();
    return box.min.slice(0, 2).map((v, i) => (v + box.max[i]) / 2);
  };
  for (const prefix of ['road-clip', 'side-clip', 'end-clip']) {
    assert.ok(clips.some((part) => part.id.startsWith(prefix)));
  }
  for (const main of clips) {
    const pair = keepers.filter((part) => part.parentClipId === main.id);
    assert.equal(pair.length, 2, main.id + ' kit quantity');
    for (const keeper of pair) {
      const [x, y] = center(keeper);
      const local = shop.own(keeper.solid.translate([-x, -y, 0]));
      const installed = shop.and(keeper.solid, structure).volume();
      near(installed, 0, keeper.id + ' seated');
      for (let turn = -90; turn <= 0; turn += 15) {
        const rotated = shop.own(local.rotate([0, 0, turn]));
        const lifted = shop.own(rotated.translate([x, y, KEEPER_LIFT]));
        near(shop.and(lifted, structure).volume(), 0, keeper.id + ' rotation');
      }
      const lowered = shop.own(keeper.solid.translate([0, 0, -0.3]));
      assert.ok(
        shop.and(lowered, structure).volume() > 0.2,
        keeper.id + ' shelf',
      );
      if (keeper.id.startsWith(main.id + '-retainer')) {
        const [u, v] = center(main);
        near(Math.hypot(x - u, y - v), 15, keeper.id + ' longitudinal offset');
        const drop = shop.own(main.solid.translate([0, 0, -1.45]));
        assert.ok(shop.and(drop, keeper.solid).volume() > 1);
      }
    }
  }
  assert.equal(
    keepers.find((p) => p.id === 'road-clip-0-retainer-2').parentClipId,
    'road-clip-2',
  );
  assert.equal(
    keepers.find((p) => p.id === 'end-clip-outer-0-retainer-2').parentClipId,
    'end-clip-outer-2',
  );
});

test('an isolated Carrera end supplies the one keeper seated in its half', (t) => {
  for (const start of [true, false]) {
    const parts = buildTrack(wasm, {
      ...params('carrera-retained'),
      segments: 1,
      joint: 'none',
      jointStart: start ? 'clips' : 'none',
      jointEnd: start ? 'none' : 'clips',
    });
    t.after(() => parts.forEach((p) => p.solid.delete()));
    const [main] = parts.filter((part) => part.role === 'clip');
    const keepers = parts.filter((part) => part.role === 'retainer');
    assert.equal(keepers.length, 1);
    assert.equal(keepers[0].parentClipId, main.id);
    const x = keepers[0].solid.boundingBox();
    near((x.min[0] + x.max[0]) / 2, start ? -105 : 105, 'inside its end');
  }
});

test('Carrera kits list and map the keepers for isolated, repeating and unequal open ends', (t) => {
  for (const [start, finish, countClips, countKeepers] of [
    [[0], [], 1, 1],
    [[], [0], 1, 1],
    [[0], [0], 1, 2],
    [[-15, 15], [0], 2, 3],
  ]) {
    const project = newProject();
    project.track.params = {
      ...params('carrera-retained'),
      segments: 1,
      joint: 'none',
      jointStart: start.length ? 'clips' : 'none',
      jointEnd: finish.length ? 'clips' : 'none',
      placements: { startClips: start, finishClips: finish },
    };
    const parts = buildTrack(wasm, project.track.params);
    t.after(() => parts.forEach((p) => p.solid.delete()));
    const clips = parts.filter((p) => p.role === 'clip');
    const keepers = parts.filter((p) => p.role === 'retainer');
    assert.equal(clips.length, countClips);
    assert.equal(keepers.length, countKeepers);
    assert.ok(
      keepers.every((keeper) =>
        clips.some((main) => main.id === keeper.parentClipId),
      ),
    );
    const files = unzipSync(packKit(wasm, parts, project, encodeSTL));
    const csv = strFromU8(files['parts.csv']);
    assert.ok(
      csv.includes(
        '"' + countKeepers + '","' + keepers.map((p) => p.id).join(' | ') + '"',
      ),
    );
    const map = strFromU8(files['assembly.svg']);
    const labels = [
      ...map.matchAll(/<text x="([^"]+)" y="([^"]+)"[^>]*>R1<\/text>/g),
    ];
    assert.equal(labels.length, countKeepers);
    assert.equal(
      new Set(labels.map((m) => m[1] + ',' + m[2])).size,
      countKeepers,
      'one map label per occupied physical seat',
    );
    assert.equal(
      Object.keys(files).filter((file) => file.startsWith('parts/R')).length,
      1,
    );
  }
});

test('retained Carrera uses the same credited printable mesh and independent uncredited keepers', (t) => {
  const { shop, main, keepers } = fixture(t, params('carrera-retained'));
  const source = shop.own(
    parseSTL(wasm, Buffer.from(originalClip.stl, 'base64')),
  );
  const turned = shop.own(source.rotate([-90, 0, 0]));
  const expected = shop.own(turned.translate([0, -10, 4.5]));
  withPrintableSolid(
    main,
    (printed) => {
      near(
        shop.own(expected.subtract(printed)).volume(),
        0,
        'identical Carrera body',
      );
      near(
        shop.own(printed.subtract(expected)).volume(),
        0,
        'identical Carrera body',
      );
      assert.equal(printed.numTri(), 388);
    },
    { sideDown: true },
  );
  assert.equal(clipSTLHeader(main.clipType), clipSTLHeader('carrera'));
  assert.match(clipAttribution(main), /URSUS/);
  for (const keeper of keepers) assert.equal(clipAttribution(keeper), null);
  assert.equal(clipAttribution({ clipType: 'draw-key' }), null);
  for (const type of ['draw-key', 'carrera-retained']) {
    const p = params(type);
    assert.throws(
      () =>
        validateTrack({
          ...p,
          height: clipSpec(p).minimumHeight - 0.1,
          slotDepth: 4,
        }),
      /height/i,
    );
  }
});
