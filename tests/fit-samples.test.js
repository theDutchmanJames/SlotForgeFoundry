import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import init from 'manifold-3d';
import { createEngine } from '../src/engine.js';
import { parseSTL } from '../src/editor.js';
import {
  JOINT_FIT_LIMITS,
  resolveJointFit,
  TAB_SIZE_LIMITS,
} from '../src/geometry/joint-fit.js';
import { clipSpec } from '../src/geometry/clip-types.js';
import { clipPair, withPrintableSolid } from '../src/geometry/joints.js';
import { makePart, shell, SolidWorkshop } from '../src/geometry/solids.js';
import { newProject } from '../src/project.js';

const wasm = await init();
wasm.setup();

function fixture(t) {
  const engine = createEngine(wasm);
  const work = new SolidWorkshop(wasm);
  t.after(() => {
    work.close();
    engine.dispose();
  });
  const params = {
    ...newProject().track.params,
    jointFitVersion: 2,
    tabClearance: 0.16,
    clipClearance: 0.23,
  };
  return { engine, work, params };
}

function stationY(rack, count, index) {
  const { min, max } = rack.boundingBox();
  return min[1] + ((index + 0.5) / count) * (max[1] - min[1]);
}

function receiverBlocks(work, p, y = 0) {
  return [-1, 1].map((sign) => {
    const section = work.section([[
      [0, y - 15], [sign * 34, y - 15], [sign * 34, y + 15], [0, y + 15],
    ]]);
    const part = makePart('receiver-' + sign, 'Receiver', 'body', section);
    shell(work, part, p);
    return part;
  });
}

function tabAtStation(work, key, rack, projection, y) {
  const { min, max } = key.boundingBox();
  const backOfTab = max[0] - projection;
  const reversed = work.own(key.rotate([0, 0, 180]));
  return work.own(
    reversed.translate([
      rack.boundingBox().max[0] + backOfTab,
      y + (min[1] + max[1]) / 2,
      0,
    ]),
  );
}

test('fit kit exports independently printable connectors, racks and a reusable keeper tool', (t) => {
  const { engine, work, params } = fixture(t);
  params.height = 14;
  const files = unzipSync(engine.fitSamples(params));
  assert.deepEqual(Object.keys(files).sort(), [
    'draw-key.stl',
    'fit-key.txt',
    'keeper-turning-tool.stl',
    'rack-A.stl',
    'rack-B.stl',
    'retaining-clip.stl',
    'tab-key.stl',
  ]);
  const keyText = strFromU8(files['fit-key.txt']);
  assert.match(keyText, /Track height 14\.00 mm/);
  assert.match(keyText, /1 dot \| 0\.11 \| 0\.18/);
  assert.match(keyText, /2 dots \| 0\.16 \| 0\.23  \(current\)/);
  assert.match(keyText, /3 dots \| 0\.21 \| 0\.28/);
  const boxes = [];
  for (const [name, bytes] of Object.entries(files)) {
    if (!name.endsWith('.stl')) continue;
    const solid = work.own(parseSTL(wasm, bytes));
    const components = solid.decompose().map((part) => work.own(part));
    assert.equal(components.length, 1, name);
    const bounds = solid.boundingBox();
    assert.equal(bounds.min[2], 0, name);
    assert.ok(
      boxes.every(
        ({ min, max }) =>
          bounds.min[0] > max[0] ||
          bounds.max[0] < min[0] ||
          bounds.min[1] > max[1] ||
          bounds.max[1] < min[1],
      ),
      'separate objects in shared bed coordinates',
    );
    boxes.push(bounds);
    if (name.startsWith('rack-')) {
      assert.equal(bounds.max[2], params.height);
      const top = work.own(solid.slice(params.height - 0.3)).toPolygons();
      assert.equal(
        top.length,
        1 + 1 + 2 + 3,
        'outer loop plus one, two and three dot holes',
      );
      const bottom = work.own(solid.slice(0.15)).toPolygons();
      const dots = bottom.filter((loop) => {
        const xs = loop.map(([x]) => x),
          ys = loop.map(([, y]) => y);
        return (
          Math.abs(Math.max(...xs) - Math.min(...xs) - 1.7) < 0.01 &&
          Math.abs(Math.max(...ys) - Math.min(...ys) - 1.7) < 0.01
        );
      });
      assert.equal(
        dots.length,
        6,
        'the same dots identify stations from underneath',
      );
    }
  }
});

test('the reusable male tab seats at each indicated side gap and the clip STL is the production free shape', (t) => {
  const { engine, work, params } = fixture(t);
  const files = unzipSync(engine.fitSamples(params));
  const rack = work.own(parseSTL(wasm, files['rack-B.stl']));
  const tab = work.own(parseSTL(wasm, files['tab-key.stl']));
  for (const [i, gap] of [0.11, 0.16, 0.21].entries()) {
    const station = stationY(rack, 3, i);
    const key = tabAtStation(work, tab, rack, 6, station);
    for (const side of [-1, 1]) {
      const interference = (offset) => {
        const placed = work.own(key.translate([0, side * offset, 0]));
        return work.and(placed, rack).volume();
      };
      assert.ok(
        interference(gap - 0.02) < 1e-4,
        'key slides fully into socket',
      );
      assert.ok(
        interference(gap + 0.02) > 1e-3,
        'key contacts socket past its clearance',
      );
    }
  }
  const exported = work.own(parseSTL(wasm, files['draw-key.stl']));
  const box = exported.boundingBox();
  const spec = clipSpec(params);
  assert.ok(Math.abs(box.max[2] - spec.thickness) < 1e-5);
  const upright = work.own(exported.translate([
    -(box.min[0] + box.max[0]) / 2, -(box.min[1] + box.max[1]) / 2,
    spec.seatHeight,
  ]));
  const rackA = work.own(parseSTL(wasm, files['rack-A.stl']));
  for (const [i, gap] of [0.18, 0.23, 0.28].entries()) {
    const clips = [];
    clipPair(
      work,
      { ...params, clipClearance: gap },
      [0, 0],
      [1, 0],
      null,
      null,
      clips,
      'reference',
    );
    // Close the two free rack halves and place the assembled key at this seam.
    const seam = rack.boundingBox().min[0];
    const left = work.own(
      rackA.translate([seam - rackA.boundingBox().max[0], 0, 0]),
    );
    const seated = work.own(
      clips[0].solid.translate([seam, stationY(rack, 3, i), 0]),
    );
    const base = Math.max(left.boundingBox().min[2], rack.boundingBox().min[2]);
    assert.ok(
      seated.boundingBox().min[2] > base,
      'seated clip clears the table',
    );
    assert.ok(
      work.and(seated, left).volume() < 1e-3,
      'key seats within left recess',
    );
    assert.ok(
      work.and(seated, rack).volume() < 1e-3,
      'key seats within right recess',
    );
    withPrintableSolid(clips[0], (solid) => {
      assert.ok(Math.abs(upright.volume() - solid.volume()) < 1e-3);
      assert.ok(
        Math.abs(work.and(upright, solid).volume() - solid.volume()) < 1e-3,
      );
    });
  }
});

test('fit sample generation needs no active track seams, native plan or applied project, and preserves the current project', (t) => {
  const { engine, params } = fixture(t);
  const original = unzipSync(engine.fitSamples(params));
  const project = newProject();
  engine.build(project);
  const before = engine.export({ mode: 'assembly' });
  const imported = unzipSync(
    engine.fitSamples({
      ...params,
      kind: 'import',
      joint: 'none',
      borderMount: 'none',
      borderJoint: 'none',
      segments: 1,
    }),
  );
  for (const key of Object.keys(original))
    assert.deepEqual(imported[key], original[key]);
  const sparse = unzipSync(
    engine.fitSamples({
      jointFitVersion: 2,
      tabClearance: params.tabClearance,
      clipClearance: params.clipClearance,
    }),
  );
  for (const key of Object.keys(original))
    assert.deepEqual(sparse[key], original[key]);
  assert.deepEqual(engine.export({ mode: 'assembly' }), before);
});

test('both sides of every rack pocket reproduce the corresponding production clip clearance', (t) => {
  const { engine, work, params } = fixture(t);
  // Solid blocks make the comparison independent of the outline of each rack's hollow shell.
  params.hollow = false;
  const files = unzipSync(engine.fitSamples(params));
  const a = work.own(parseSTL(wasm, files['rack-A.stl']));
  const b = work.own(parseSTL(wasm, files['rack-B.stl']));
  const pocketVolumes = [];
  for (const [i, clipClearance] of [0.18, 0.23, 0.28].entries()) {
    const [first, second] = receiverBlocks(work, params);
    clipPair(
      work,
      { ...params, clipClearance },
      [0, 0],
      [1, 0],
      first,
      second,
      [],
      null,
    );
    const y = stationY(b, 3, i);
    let volume = 0;
    for (const [rack, seam, side, sign] of [
      [a, a.boundingBox().max[0], first, -1],
      [b, b.boundingBox().min[0], second, 1],
    ]) {
      const aligned = work.own(rack.translate([-seam, -y, 0]));
      const region = work.prism(
        work.section([
          [
            [0, -6],
            [sign * 9, -6],
            [sign * 9, 6],
            [0, 6],
          ],
        ]),
        0,
        params.height - 0.61,
      );
      const expectedHole = work.and(region, work.union(side.cuts));
      const actualHole = work.cut(region, [aligned]);
      const common = work.and(actualHole, expectedHole).volume();
      assert.ok(
        Math.abs(actualHole.volume() + expectedHole.volume() - 2 * common) <
          1e-3,
      );
      volume += actualHole.volume();
    }
    pocketVolumes.push(volume);
  }
  assert.ok(
    pocketVolumes[0] < pocketVolumes[1] && pocketVolumes[1] < pocketVolumes[2],
  );
});

test('limits yield unique station pairs with the current row identified and unsupported profiles are rejected', (t) => {
  const { engine, params } = fixture(t);
  const kitKey = (custom) =>
    strFromU8(
      unzipSync(engine.fitSamples({ ...params, ...custom }))['fit-key.txt'],
    );
  for (const i of [0, 1]) {
    const tab = JOINT_FIT_LIMITS.tab[i];
    const clip = JOINT_FIT_LIMITS.clip[i];
    const lines = kitKey({ tabClearance: tab, clipClearance: clip })
      .split('\n')
      .filter((row) => /^\d+ dots? \|/.test(row));
    assert.equal(lines.length, 2);
    assert.match(lines[i], /\(current\)/);
    assert.ok(lines[i].includes(`${tab.toFixed(2)} | ${clip.toFixed(2)}`));
  }
  assert.throws(() => kitKey({ jointFitVersion: 3 }), /version/i);
  assert.throws(() => kitKey({ height: 3 }), /height/i);
  assert.throws(() => kitKey({ clipClearance: 2 }), /clearance/i);
});

test('custom tab sizes and fork clips produce separate printable parts whose real sockets match the key', (t) => {
  const { engine, work, params } = fixture(t);
  for (const [limit, clipType, tabThickness] of [
    [0, 'draw-key', 1.2],
    [1, 'carrera-retained', 4.2],
  ]) {
    const p = {
      ...params,
      clipType,
      tabWidth: TAB_SIZE_LIMITS.width[limit],
      tabLength: TAB_SIZE_LIMITS.length[limit],
      tabThickness,
    };
    const files = unzipSync(engine.fitSamples(p));
    const solids = Object.fromEntries(
      Object.entries(files)
        .filter(([name]) => name.endsWith('.stl'))
        .map(([name, bytes]) => [name, work.own(parseSTL(wasm, bytes))]),
    );
    const key = solids['tab-key.stl'];
    const rack = solids['rack-B.stl'];
    const a = solids['rack-A.stl'];
    const clipFile = {
      'draw-key': 'draw-key.stl',
      'carrera-retained': 'carrera-clip.stl',
    }[clipType];
    const clip = solids[clipFile];
    const spec = clipSpec(p);
    const keeperFiles = Object.keys(solids).filter((name) => name.startsWith('retaining-clip'));
    const bounds = Object.values(solids).map((solid) => solid.boundingBox());
    assert.equal(keeperFiles.length, spec.keeperOffsets.length);
    assert.equal(bounds.length, 5 + keeperFiles.length);
    assert.match(strFromU8(files['fit-key.txt']), /quarter.turn/i);
    for (const name of keeperFiles) {
      const keeper = solids[name];
      const wing = work.own(keeper.slice(spec.retainerThickness - 0.01));
      const boss = work.own(keeper.slice(spec.retainerThickness + 0.01));
      assert.ok(wing.area() > boss.area() && boss.area() > 0);
      assert.doesNotMatch(strFromU8(files[name].subarray(0, 80)), /URSUS/);
    }
    for (const [i, box] of bounds.entries()) {
      assert.ok(Math.abs(box.min[2]) < 1e-5);
      assert.ok(
        bounds
          .slice(i + 1)
          .every((other) =>
            [0, 1].some(
              (axis) =>
                box.min[axis] > other.max[axis] ||
                other.min[axis] > box.max[axis],
            ),
          ),
        'print positions are separated',
      );
    }
    const keyInfo = strFromU8(files['fit-key.txt']);
    assert.ok(keyInfo.includes('Tab width ' + p.tabWidth.toFixed(2) + ' mm'));
    assert.ok(keyInfo.includes('projection ' + p.tabLength.toFixed(2) + ' mm'));
    assert.ok(keyInfo.includes('thickness ' + tabThickness.toFixed(2) + ' mm'));
    assert.ok(keyInfo.includes('extends ' + p.tabLength.toFixed(2) + ' mm'));
    if (clipType === 'draw-key') {
      assert.equal(files['clip-attribution.txt'], undefined);
      assert.doesNotMatch(strFromU8(files[clipFile].subarray(0, 80)), /URSUS/);
    } else {
      const credit = strFromU8(files['clip-attribution.txt']);
      assert.match(credit, /URSUS/);
      assert.match(credit, /1163344/);
      assert.match(credit, /by-sa\/4\.0/i);
      assert.match(
        strFromU8(files[clipFile].subarray(0, 80)),
        /URSUS.*CC BY-SA 4\.0/,
      );
    }
    const keyBox = key.boundingBox();
    const matingX = keyBox.max[0] - p.tabLength;
    // Isolate the projecting tongue from its handle and measure the emitted STL.
    const probeStock = work.own(
      wasm.Manifold.cube([p.tabLength + 1, 100, p.height + 1]),
    );
    const probe = work.own(probeStock.translate([matingX + 0.01, -5, 0]));
    const tongue = work.and(key, probe).boundingBox();
    const near = (a, b) => assert.ok(Math.abs(a - b) < 0.0001, a + ' vs ' + b);
    near(tongue.max[1] - tongue.min[1], p.tabWidth);
    near(tongue.max[2] - tongue.min[2], tabThickness);
    const clipBox = clip.boundingBox();
    near(clipBox.max[2] - clipBox.min[2], spec.thickness);
    const left = work.own(a.translate([-a.boundingBox().max[0], 0, 0]));
    const right = work.own(rack.translate([-rack.boundingBox().min[0], 0, 0]));
    for (const [i, delta] of [-0.05, 0, 0.05].entries()) {
      const gap = p.tabClearance + delta;
      const station = stationY(rack, 3, i);
      const seated = tabAtStation(work, key, rack, p.tabLength, station);
      for (const [dy, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const overlap = (offset) =>
          work
            .and(
              rack,
              work.own(seated.translate([0, dy * offset, dz * offset])),
            )
            .volume();
        assert.ok(overlap(gap - 0.02) < 1e-4, 'key seats at each labelled gap');
        assert.ok(
          overlap(gap + 0.03) > 1e-4,
          'side and height bear just past the socket gap',
        );
      }
      const installed = [];
      clipPair(
        work,
        { ...p, clipClearance: p.clipClearance + delta },
        [0, station],
        [1, 0],
        ...receiverBlocks(work, p, station),
        installed,
        'fork',
      );
      assert.equal(installed.length, 1 + spec.keeperOffsets.length);
      for (const hardware of installed) {
        assert.ok(hardware.solid.boundingBox().min[2] > 0);
        near(work.and(hardware.solid, left).volume(), 0);
        near(work.and(hardware.solid, right).volume(), 0);
      }
    }
  }
});

test('comparison gaps respect the floor and roof available for a thick tab', (t) => {
  const { engine, params } = fixture(t);
  const p = { ...params, height: 8, tabThickness: 6, tabClearance: 0.06 };
  const fit = resolveJointFit(p);
  assert.ok(
    fit.tabMaxClearance >= p.tabClearance &&
      fit.tabMaxClearance < p.tabClearance + 0.05,
  );
  const files = unzipSync(engine.fitSamples(p));
  const rows = strFromU8(files['fit-key.txt'])
    .split('\n')
    .filter((line) => /^\d+ dots? \|/.test(line));
  const loose = Number(rows.at(-1).split(' | ')[1]);
  assert.ok(Math.abs(loose - fit.tabMaxClearance) < 1e-8);
  assert.throws(
    () => engine.fitSamples({ ...p, tabThickness: 50 }),
    /thickness|roof|height|floor/i,
  );
});
