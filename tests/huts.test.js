// Marshal huts: windows of small panes, a step at a door, a standing-seam
// roof, braced frames or knee-braced legs under a building, an arched roof,
// a solid parapet railing, and the flag waver's post.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { KIT, PANES, STAND, buildGarage, buildingLayout, fitsPlate, printPose, printSize, validateBuilding } from '../src/geometry/building.js';
import { FLAG_POST, flagDepth, flagFootprint, validateFlagPost } from '../src/geometry/flag-post.js';
import { BUILDING_PRESETS } from '../src/building-presets.js';
import { kitNotes } from '../src/building-kit.js';
import { shapeOf } from '../src/planner-buildings.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 200, depth: 200, margin: 0 };
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const withParts = (b, check) => {
  const parts = buildGarage(wasm, b, PLATE);
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
    if (len && n[2] / len < -0.71 && Math.min(v[0][2], v[1][2], v[2][2]) > 0.05) over += len / 2;
  }
  printed.delete();
  return over;
};
const clean = (parts, label) => {
  for (const p of parts) {
    assert.equal(p.solid.decompose().length, 1, p.name + ' is one body ' + label);
    assert.ok(fitsPlate(printSize(p), PLATE), p.name + ' fits ' + label);
  }
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const both = parts[i].solid.intersect(parts[j].solid);
      assert.ok(both.volume() < 0.01, parts[i].name + ' and ' + parts[j].name + ' overlap ' + label);
      both.delete();
    }
};
const HUT = { width: 90, depth: 70, height: 56, door: 'none' };
const win = (o) => ({ wall: 'front', type: 'window', at: 45, width: 40, height: 28, sill: 14, frame: true, ...o });

test('windows of small panes and a step at a door are checked', () => {
  assert.throws(() => validateBuilding({ ...HUT, openings: [win({ across: 7 })] }), new RegExp('1 to ' + PANES.most + ' panes across'));
  assert.throws(() => validateBuilding({ ...HUT, openings: [win({ up: 1.5 })] }), /panes up/);
  assert.throws(() => validateBuilding({ ...HUT, openings: [win({ width: 20, across: 4 })] }), /panes of the front window are too small/);
  assert.throws(() => validateBuilding({ ...HUT, openings: [{ wall: 'front', type: 'door', at: 30, across: 2 }] }), /A door has no panes/);
  assert.throws(() => validateBuilding({ ...HUT, openings: [win({ step: true })] }), /A window has no step/);
  assert.throws(() => validateBuilding({ ...HUT, standType: 'legs', openings: [{ wall: 'front', type: 'door', at: 30, step: true }] }), /door on a stand has no step/);
  assert.throws(() => validateBuilding({ ...HUT, upper: [{ height: 56, openings: [{ wall: 'front', type: 'door', at: 30, step: true }] }] }), /step is for a door on the ground floor/);
  // Panes default to a cross, as before.
  assert.deepEqual([validateBuilding({ ...HUT, openings: [win({})] }).openings[0].across, validateBuilding({ ...HUT, openings: [win({})] }).openings[0].up], [2, 2]);
  // Windows can stand one above the other, wall enough between them.
  assert.equal(validateBuilding({ ...HUT, height: 90, openings: [win({ sill: 5, height: 20 }), win({ sill: 5 + 20 + KIT.frame + 2 * KIT.trim, height: 20 })] }).openings.length, 2);
});

test('a frame of more panes has more bars; a step stands against the base in front of its door', () => {
  const frameVolume = (across, up) => withParts({ ...HUT, openings: [win({ across, up })] }, (_, part) => part('frame-1').solid.volume());
  const one = frameVolume(1, 1),
    cross = frameVolume(2, 2),
    many = frameVolume(4, 3);
  assert.ok(one < cross && cross < many, [one, cross, many].join(' '));
  withParts({ ...HUT, openings: [{ wall: 'front', type: 'door', at: 30, step: true }] }, (parts, part) => {
    clean(parts, 'step');
    const s = part('step-1').solid.boundingBox();
    assert.ok(near(s.max[1], -KIT.ledge) && near(s.min[2], 0) && s.min[0] < 30 - 14 && s.max[0] > 30 + 14, 'against the base, wider than the door');
    assert.ok(overAir(part('step-1')) < 0.5);
  });
  // On the side walls too.
  withParts({ ...HUT, openings: [{ wall: 'right', type: 'door', at: 30, step: true }] }, (_, part) => {
    assert.ok(near(part('step-1').solid.boundingBox().min[0], HUT.width + KIT.ledge), 'outside the right wall');
  });
});

test('a standing-seam roof: the sheets cut down between raised seams', () => {
  const roofVolume = (roofTexture) => withParts({ ...HUT, roof: 'gable', pitch: 30, roofTexture }, (_, part) => part('roof-left').solid.volume());
  assert.ok(roofVolume('seam') < roofVolume('plain') - 50);
});

test('braced frames all round, and knee braces on legs', () => {
  assert.throws(() => validateBuilding({ ...HUT, standType: 'column', standSize: 20, standBraces: true }), /Knee braces are for legs/);
  assert.throws(() => validateBuilding({ ...HUT, standType: 'legs', standSize: 8, standHeight: 30, standBraces: true }), /need a stand at least \d+ mm high/);
  const framed = { ...HUT, standType: 'frames', standHeight: 60 };
  assert.deepEqual(buildingLayout(framed).parts.filter((p) => /^stand/.test(p.id)).map((p) => p.id), ['stand-front', 'stand-back', 'stand-left', 'stand-right', 'stand-foot']);
  withParts(framed, (parts, part) => {
    clean(parts, 'frames');
    for (const p of parts.filter((q) => /^stand/.test(q.id))) assert.ok(overAir(p) < 0.5, p.name + ' prints flat');
    // Just inside the base all round.
    const front = part('stand-front').solid.boundingBox();
    assert.ok(front.max[0] - front.min[0] > HUT.width - 10, 'as wide as the base');
    assert.ok(near(part('base').solid.boundingBox().min[2], 60), 'the base on the frames');
  });
  assert.match(kitNotes('Hut', validateBuilding(framed), buildingLayout(framed).parts, {}), /foot frame/);
  const legs = { ...HUT, standType: 'legs', standSize: 8, standHeight: 60 };
  const legVolume = (standBraces) =>
    withParts({ ...legs, standBraces }, (parts, part) => {
      clean(parts, 'legs ' + standBraces);
      assert.ok(overAir(part('leg-1')) < 0.5, 'a leg prints standing');
      return part('leg-1').solid.volume();
    });
  assert.ok(legVolume(true) > legVolume(false) + 50, 'braces on the legs');
});

test('an arched roof: higher in the middle than at its edges, flat underneath', () => {
  assert.throws(() => validateBuilding({ ...HUT, roof: 'gable', arch: 5 }), /choose a flat roof/);
  assert.throws(() => validateBuilding({ ...HUT, arch: 5, roofRailing: true }), /no railing, billboard or way up/);
  assert.throws(() => validateBuilding({ ...HUT, arch: 40 }), /Arch must be between 0 and 30/);
  for (const ridge of ['depth', 'width'])
    withParts({ ...HUT, arch: 8, ridge }, (parts, part) => {
      clean(parts, 'arch ' + ridge);
      const roof = part('roof').solid;
      const top = roof.boundingBox().max[2],
        bottom = roof.boundingBox().min[2];
      assert.ok(near(top - bottom, KIT.roof + 8, 0.05), 'as high as the arch in the middle');
      // At an edge across the arch it is no thicker than a flat roof.
      const edge = ridge === 'depth' ? [-HUT.overhangLeft || -3, HUT.depth / 2] : [HUT.width / 2, -3];
      const probe = wasm.Manifold.cube([0.4, 0.4, 20]).translate([edge[0] + 0.1, edge[1], bottom + KIT.roof + 0.5]);
      const hit = roof.intersect(probe);
      assert.ok(hit.volume() < 0.05, 'thin at its edge ' + ridge);
      [probe, hit].forEach((s) => s.delete());
      // Over air only where a flat roof is too: the tops of the pockets for its frame's tabs.
      const flat = withParts({ ...HUT, ridge }, (_, q) => overAir(q('roof')));
      assert.ok(overAir(part('roof')) <= flat + 0.5, 'prints flat');
    });
});

test('a solid parapet railing fills the field between its band and its rail', () => {
  const rail = (railingStyle) => withParts({ ...HUT, upper: [{ height: 40, balcony: 15, railing: true }], railingStyle }, (_, part) => part('railing2-front').solid.volume());
  assert.ok(rail('solid') > rail('lattice') && rail('lattice') > rail('bars'));
});

test("the flag waver's post: steps up to a landing, cheeks with handrails, a front rail with a board", () => {
  assert.throws(() => validateFlagPost({ steps: 2, height: 40 }), /too high: at most 12 mm, so at least 4 steps/);
  assert.throws(() => validateFlagPost({ boardHeight: 18, railHeight: 18 }), /room under the rail/);
  assert.throws(() => validateFlagPost({ colour: 'red' }), /unknown setting/);
  const f = validateFlagPost({});
  assert.equal(flagDepth(f), 16 + 4 * 9);
  assert.deepEqual(buildingLayout({ kind: 'flagpost' }).parts.map((p) => p.id), ['steps', 'cheek-left', 'cheek-right', 'front']);
  for (const settings of [{ kind: 'flagpost' }, { kind: 'flagpost', steps: 2, height: 12, board: false }, { kind: 'flagpost', steps: 12, height: 60, tread: 6 }])
    withParts(settings, (parts, part) => {
      clean(parts, JSON.stringify(settings));
      for (const p of parts) assert.ok(overAir(p) < 0.5, p.name + ' prints without supports');
      const v = validateFlagPost(settings);
      const steps = part('steps').solid.boundingBox();
      assert.ok(near(steps.max[2], v.height) && near(steps.max[1], flagDepth(v)), 'up to the landing, as deep as the steps');
      // The handrails as high above the landing as the front rail.
      assert.ok(near(part('cheek-left').solid.boundingBox().max[2], v.height + v.railHeight) && near(part('front').solid.boundingBox().max[2], v.height + v.railHeight));
      assert.ok(near(part('front').solid.boundingBox().max[1], 0) && near(part('cheek-right').solid.boundingBox().min[0], v.width));
    });
  // On the plan: its cheeks and front within its outline, the front rail to the track.
  const s = shapeOf(f);
  assert.deepEqual(flagFootprint(f), [-FLAG_POST.cheek, -FLAG_POST.cheek, f.width + FLAG_POST.cheek, flagDepth(f)]);
  assert.ok(near(s.front.f[1], -1));
  assert.match(kitNotes('Flag', f, buildingLayout(f).parts, {}), /Glue a cheek against each side of the steps/);
});

test('the hut presets build: one body a part, nothing overlapping, each fitting the plate', () => {
  for (const id of ['hut-brick', 'hut-first-aid', 'hut-large', 'hut-legs', 'hut-frames', 'post-box', 'hut-tower', 'flag-post'])
    withParts(BUILDING_PRESETS.find((p) => p.id === id).building, (parts) => clean(parts, id));
});

test('the notes say where a step goes', () => {
  const b = validateBuilding({ ...HUT, openings: [{ wall: 'front', type: 'door', at: 30, step: true }] });
  assert.match(kitNotes('Hut', b, buildingLayout(b).parts, {}), /Glue each step against the side of the base, in front of its door/);
});

test('a way up stands against the base, notched round the feet of the stand; a ladder onto a roof clears its railing', () => {
  for (const id of ['hut-legs', 'hut-frames'])
    withParts(BUILDING_PRESETS.find((p) => p.id === id).building, (parts, part) => {
      clean(parts, id);
      const a = part('access').solid.boundingBox(),
        base = part('base').solid.boundingBox();
      // The staircase is against the side of the base, a glue gap from it.
      const gaps = [a.min[0] - base.max[0], base.min[0] - a.max[0]];
      assert.ok(gaps.some((v) => v > 0 && v < 0.5), id + ' against the base: ' + gaps);
    });
  withParts(BUILDING_PRESETS.find((p) => p.id === 'scaffold-tower').building, (parts) => clean(parts, 'scaffold tower'));
});
