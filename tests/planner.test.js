import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { createEngine } from '../src/engine.js';
import { starterPack } from '../src/library-profile.js';
import { specialTrackParams } from '../src/special-pieces.js';
import { parseSTL } from '../src/editor.js';
import {
  newLayout,
  endsOf,
  placeSource,
  removeSection,
  reverseSection,
  snapRun,
  setElevation,
  surfaces,
  crossings,
  supportRequests,
  tally,
  validateLayout,
  blockedJoints,
} from '../src/planner-model.js';
import {
  printGroups,
  kitPieceNames,
  laneLengths,
} from '../src/planner-kit.js';

const wasm = await init();
wasm.setup();
const engine = createEngine(wasm),
  plate = { width: 450, depth: 450, margin: 0 },
  stock = starterPack().pieces;
function source(index, changes = {}, bed = plate) {
  const { name, track } = structuredClone(stock[index]);
  Object.assign(track.params, changes);
  return { name, ...engine.plannerSource({ track, plate: bed }) };
}
function setup(entries) {
  const defs = new Map(entries),
    layout = newLayout();
  for (const [id, d] of defs)
    layout.sources[id] = { name: d.name, track: d.track };
  return { defs, layout };
}
test('an R4 cut to two thirds, two left R2s and a quarter of an R1 form one printable run', () => {
  const { defs, layout } = setup([
    ['s1', source(0)],
    ['s2', source(7, { segments: 3 })],
    ['s3', source(5, { segments: 2 })],
    ['s4', source(4, { segments: 4 })],
  ]);
  let active = {};
  function add(id, hand) {
    active = placeSource(layout, defs, id, active.end, hand);
  }
  function trim() {
    active = removeSection(layout, defs, active.selected);
  }
  add('s1');
  add('s2');
  trim();
  add('s3', 'left');
  add('s3', 'left');
  add('s4');
  trim();
  trim();
  trim();
  add('s1');
  assert.deepEqual(
    layout.nodes.map((n) => n.source),
    ['s1', 's2', 's2', 's3', 's3', 's3', 's3', 's4', 's1'],
  );
  assert.equal(endsOf(layout, defs).open.length, 2);
  assert.equal(crossings(surfaces(layout, defs)).length, 0);
  const totals = tally(layout, defs);
  const count = (role) =>
    totals.filter((g) => g.role === role).reduce((s, g) => s + g.count, 0);
  assert.deepEqual(
    [count('road'), count('clip'), count('retainer')],
    [9, 8, 8],
  );
  const after = validateLayout(JSON.parse(JSON.stringify(layout)));
  assert.deepEqual(after, layout);
  const before = layout.nodes[0].pose;
  reverseSection(layout, defs, layout.nodes[3].id);
  assert.equal(layout.nodes[3].pose.flip, false);
  assert.deepEqual(layout.nodes[0].pose, before);
  assert.equal(endsOf(layout, defs).open.length, 2);
  const cut = removeSection(layout, defs, layout.nodes[3].id);
  const ends = endsOf(layout, defs).open;
  assert.equal(ends.length, 4);
  snapRun(
    layout,
    defs,
    ends.find((e) => e.id === layout.nodes[3].id).key,
    cut.end,
  );
  assert.equal(endsOf(layout, defs).open.length, 2);
});
test('snapping a loop closes the last joint, and a single-lane road cannot attach to a two-lane end', () => {
  const single = starterPack(1).pieces[0].track;
  const { defs, layout } = setup([
    ['s1', source(4, { segments: 1, angle: 90, joint: 'none' })],
    [
      's2',
      { name: 'Single', ...engine.plannerSource({ track: single, plate }) },
    ],
  ]);
  let c = placeSource(layout, defs, 's1');
  assert.throws(() => placeSource(layout, defs, 's2', c.end), /slots|edges/);
  for (let i = 0; i < 3; i++) c = placeSource(layout, defs, 's1', c.end);
  assert.equal(endsOf(layout, defs).open.length, 0);
  assert.throws(() => placeSource(layout, defs, 's1', c.end), /open end/i);
});
test('the actual bed fit increases a long straight’s divisions and preserves attached borders after trimming', () => {
  const s = source(
    0,
    {
      length: 520,
      width: 110,
      laneSpacing: 55,
      segments: 1,
      borderSide: 'both',
    },
    { width: 200, depth: 200, margin: 0 },
  );
  assert.ok(s.sections.length >= 3);
  assert.ok(s.meshes.every((m) => m.fit.fits));
  assert.ok(
    s.sections.every((s) => s.parts.some((k) => k.startsWith('border-'))),
  );
  const { defs, layout } = setup([['s1', s]]);
  const c = placeSource(layout, defs, 's1');
  removeSection(layout, defs, c.selected);
  assert.equal(
    tally(layout, defs).filter((g) => g.role === 'road').length,
    s.sections.length - 1,
  );
});
test('a diamond exposes four ends, a split pit stays in station pairs and both tally every road STL', () => {
  for (const [type, ends] of [
    ['diamond', 4],
    ['pit', 2],
  ]) {
    const track = {
      params: {
        ...specialTrackParams(type, stock[0].track.params),
        segments: 3,
      },
      plan: null,
    };
    const def = {
      name: type,
      ...engine.plannerSource({ track, plate, autoFit: false }),
    };
    const { layout, defs } = setup([['s1', def]]);
    placeSource(layout, defs, 's1');
    assert.equal(endsOf(layout, defs).open.length, ends);
    assert.equal(
      tally(layout, defs).filter((g) => g.role === 'road').length,
      def.meshes.filter((m) => m.role === 'road').length,
    );
  }
});
test('bridge headroom subtracts lower road thickness and printable supports avoid its complete footprint', () => {
  const def = source(0, {
      length: 400,
      width: 80,
      laneSpacing: 40,
      joint: 'none',
    }),
    { defs, layout } = setup([['s1', def]]);
  const c = placeSource(layout, defs, 's1');
  const upper = layout.nodes[0];
  placeSource(layout, defs, 's1', c.end);
  const lower = structuredClone(upper);
  lower.id = 'cross-track';
  lower.pose = { x: 200, y: 0, a: Math.PI / 2, flip: false };
  layout.nodes.push(lower);
  setElevation(layout, defs, upper.id, 70, 70, 2);
  const rows = surfaces(layout, defs),
    hits = crossings(rows);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].clearance, 60);
  // The Planner keeps pair results between edits; they must match a fresh check,
  // and a moved section must be worked out again.
  const memo = new Map();
  assert.deepEqual(crossings(rows, memo), hits);
  assert.ok(memo.size > 0);
  assert.deepEqual(crossings(surfaces(layout, defs), memo), hits);
  lower.pose = { ...lower.pose, x: 1000 };
  assert.deepEqual(crossings(surfaces(layout, defs), memo), []);
  lower.pose = { ...lower.pose, x: 200 };
  assert.deepEqual(layout.nodes[1].h, [70, 0]);
  const blocks = engine.plannerSupports({
    requests: supportRequests(rows),
    plate,
  });
  assert.equal(blocks.length, 2);
  for (const b of blocks) {
    assert.ok(b.bounds.max[0] < 160 || b.bounds.min[0] > 240);
    assert.equal(b.bounds.max[2], 70);
    const solid = parseSTL(wasm, b.stl);
    assert.equal(solid.status(), 'NoError');
    solid.delete();
  }
  const ramp = tally(layout, defs).find((g) => g.pose.slope);
  const [bytes] = engine.plannerPrint({ track: def.track, items: [ramp] });
  const print = parseSTL(wasm, bytes);
  assert.equal(print.status(), 'NoError');
  assert.ok(Math.abs(print.boundingBox().min[2]) < 0.001);
  print.delete();
});

// Slot position. A 200 mm wide single-lane road, 300 mm long, without
// connectors unless asked: only the road and its slot decide what joins.
// Distances "from the left" look along the direction of travel, end A to B.
const lone = starterPack(1).pieces,
  STRAIGHT = 0,
  CORNER = 4;
const slot = (edge, startMm, endMm = startMm) => ({
  version: 1,
  edge,
  startMm,
  endMm,
});
const built = new Map();
function wide(index, slotPosition, changes = {}) {
  const key = JSON.stringify([index, slotPosition, changes]);
  if (!built.has(key)) {
    const { name, track } = structuredClone(lone[index]);
    Object.assign(track.params, {
      width: 200,
      length: 300,
      radius: 300,
      angle: 90,
      segments: 1,
      borderSegments: 1,
      joint: 'none',
      ...changes,
    });
    if (slotPosition) track.params.slotPosition = slotPosition;
    built.set(key, {
      name,
      ...engine.plannerSource({ track, plate, autoFit: false }),
    });
  }
  return built.get(key);
}
// The whole message a refusal shows, without the "Error: " prefix.
const refuses = (action, pattern) =>
  assert.throws(action, (err) => {
    assert.match(err.message, pattern);
    return true;
  });
const fromLeft = (mm) => wide(STRAIGHT, slot('outer', mm));
const corner = (edge, mm) => wide(CORNER, slot(edge, mm));
// Lays the pieces end to end; a [piece, 'left'] entry is a left-hand turn.
function run(...pieces) {
  const list = pieces.map((piece) => (Array.isArray(piece) ? piece : [piece]));
  const { defs, layout } = setup(list.map(([def], i) => ['s' + (i + 1), def]));
  let active = {};
  list.forEach(([, hand], i) => {
    active = placeSource(layout, defs, 's' + (i + 1), active.end, hand);
  });
  const add = (def, hand) => {
    const id = 's' + (defs.size + 1);
    defs.set(id, def);
    layout.sources[id] = { name: def.name, track: def.track };
    active = placeSource(layout, defs, id, active.end, hand);
    return active;
  };
  return { defs, layout, add, at: () => active };
}

test('lanes are drawn and measured where the off-centre slot really runs', () => {
  // 35 mm from the left edge is 65 mm left of the centre line.
  const still = fromLeft(35).sections[0];
  assert.ok(still.lanes[0].every(([, y]) => Math.abs(y - 65) < 1e-9));
  assert.deepEqual(
    still.ports.map((port) => port.slots[0][1]),
    [65, 65],
  );
  const s = wide(STRAIGHT, slot('outer', 35, 145)).sections[0],
    lane = s.lanes[0];
  assert.ok(lane.length > 17);
  assert.equal(lane[0][1], 65);
  assert.equal(lane.at(-1)[1], -45);
  const middle = (line) => line.find(([x]) => Math.abs(x) < 1e-9)[1];
  assert.ok(Math.abs(middle(lane) - 10) < 1e-9);
  // The S is longer than the road: about 326.7 mm of slot in 300 mm.
  const [length] = laneLengths([{ lanes: s.lanes }]);
  assert.ok(Math.abs(length - 326.7) < 0.1, String(length));
  // The slot leaves both ends square to the joint.
  for (const port of s.ports)
    assert.ok(Math.abs(port.slotAngles[0] - port.angle) < 1e-6);
  // On a corner the slot is concentric: 35 mm from the inner edge of R300,
  // on the chords the road is printed with.
  const bend = corner('inner', 35).sections[0];
  for (const [x, y] of bend.lanes[0])
    assert.ok(Math.abs(Math.hypot(x, y + 300) - 235) < 0.03);
  for (const port of bend.ports) {
    assert.ok(Math.abs(Math.hypot(port.slots[0][0], port.slots[0][1] + 300) - 235) < 1e-9);
    assert.ok(Math.abs(port.slotAngles[0] - port.angle) < 1e-6);
  }
  // A squeeze is drawn from the same lanes: 40 mm apart in the middle.
  const squeezed = source(0, {
    length: 400,
    joint: 'none',
    laneAdjustment: {
      version: 1,
      mode: 'squeeze',
      anchor: 'centre',
      spacingMm: 40,
    },
  });
  const [low, high] = squeezed.sections[0].lanes.map(middle);
  assert.ok(Math.abs(high - low - 40) < 1e-9);
});

test('slots the same distance from the edge join; other distances are refused with both positions', () => {
  const { layout, defs, add } = run(fromLeft(35), fromLeft(35));
  assert.equal(layout.nodes.length, 2);
  assert.equal(endsOf(layout, defs).open.length, 2);
  refuses(
    () => add(wide(STRAIGHT)),
    /^The guide slots do not line up at this joint: the slot is 35 mm from the left edge on this piece and 100 mm on the next\.$/,
  );
  assert.equal(layout.nodes.length, 2);
  // The same slot typed from the other edge is the same road.
  add(wide(STRAIGHT, slot('inner', 165)));
  assert.equal(layout.nodes.length, 3);
  assert.equal(endsOf(layout, defs).open.length, 2);
  // A slot typed from the right edge is reported from the right edge.
  const right = run(wide(STRAIGHT, slot('inner', 35)));
  refuses(
    () => right.add(wide(STRAIGHT)),
    /the slot is 35 mm from the right edge on this piece and 100 mm on the next\./,
  );
  // Building backwards from end A still reads left and right along the travel.
  const back = run(fromLeft(35));
  const start = endsOf(back.layout, back.defs).open.find((e) => e.i === 0);
  back.defs.set('s9', fromLeft(60));
  refuses(
    () => placeSource(back.layout, back.defs, 's9', start.key),
    /the slot is 35 mm from the left edge on this piece and 60 mm on the next\./,
  );
  // Road edges are a different fault, with the two widths.
  refuses(
    () => right.add(wide(STRAIGHT, null, { width: 100 })),
    /^The road edges do not line up at this joint: this piece is 200 mm wide and the next is 100 mm\. Choose a matching piece or another open end\.$/,
  );
});

test('a mirrored left-hand corner carries its slot to the other edge and says which corner to make', () => {
  // As built a corner turns right, and its outer edge is the left edge.
  const right = run(fromLeft(35), corner('outer', 35), fromLeft(35));
  assert.equal(endsOf(right.layout, right.defs).open.length, 2);
  // A left-hand turn is the mirrored print: now the inner edge is the left.
  const left = run(fromLeft(35), [corner('inner', 35), 'left'], fromLeft(35));
  assert.equal(left.layout.nodes[1].pose.flip, true);
  assert.equal(endsOf(left.layout, left.defs).open.length, 2);
  const mirrored = (edge) =>
    new RegExp(
      '^The guide slots do not line up at this joint\\. This corner is printed mirrored for a left-hand turn\\. Its slot is still 35 mm from its ' +
        (edge === 'inner' ? 'outer' : 'inner') +
        ' edge, but this turn puts that edge on the other side of the road\\. Make a corner with the slot measured from the ' +
        edge +
        ' edge instead\\.$',
    );
  refuses(
    () => run(fromLeft(35), [corner('outer', 35), 'left']),
    mirrored('inner'),
  );
  refuses(
    () => run(fromLeft(165), [corner('inner', 35), 'left']),
    mirrored('outer'),
  );
  // The wrong corner for a right-hand turn gets the plain positions.
  refuses(
    () => run(fromLeft(35), corner('inner', 35)),
    /the slot is 35 mm from the left edge on this piece and 165 mm on the next\.$/,
  );
  // Reverse turn mirrors a placed corner, so it is refused the same way.
  refuses(
    () => reverseSection(right.layout, right.defs, right.layout.nodes[1].id),
    mirrored('inner'),
  );
  // A straight added to a mirrored corner names the corner as the cause.
  refuses(
    () => run([corner('outer', 35), 'left'], fromLeft(35)),
    /^The guide slots do not line up at this joint\. The corner at this joint is printed mirrored for a left-hand turn\. Its slot is still 35 mm from its outer edge, but this turn puts that edge on the other side of the road\. Make a corner with the slot measured from the inner edge instead\.$/,
  );
});

test('ends with equal slots carry the same connectors, so they join with tabs, clips or both', () => {
  // The planner refuses a joint whose hardware is more than 0.2 mm apart.
  for (const changes of [
    { joint: 'tabs' },
    { joint: 'clips' },
    { joint: 'both' },
    { joint: 'clips', clipType: 'carrera-retained', connectorCounts: undefined },
  ]) {
    const piece = (index, slotPosition) => wide(index, slotPosition, changes);
    const label = JSON.stringify(changes);
    // Centre, across to 35 mm, along, a right-hand corner, a left-hand
    // corner (the mirrored print), then across to 145 mm and along.
    const { layout, defs } = run(
      piece(STRAIGHT),
      piece(STRAIGHT, slot('outer', 100, 35)),
      piece(STRAIGHT, slot('outer', 35)),
      piece(CORNER, slot('outer', 35)),
      [piece(CORNER, slot('inner', 35)), 'left'],
      piece(STRAIGHT, slot('outer', 35, 145)),
      piece(STRAIGHT, slot('outer', 145)),
      piece(STRAIGHT, slot('inner', 55)),
    );
    assert.equal(layout.nodes.length, 8, label);
    const net = endsOf(layout, defs);
    assert.equal(net.open.length, 2, label);
    assert.deepEqual(blockedJoints(net), [], label);
  }
});

test('half of a piece whose slot moves sideways is refused next to another piece: the slots would meet at an angle', () => {
  const moving = wide(STRAIGHT, slot('outer', 35, 145), { segments: 2 });
  assert.equal(moving.sections.length, 2);
  // Whole, its halves join each other and the pieces at both ends.
  const whole = run(fromLeft(35), moving, fromLeft(145));
  assert.equal(whole.layout.nodes.length, 4);
  assert.equal(endsOf(whole.layout, whole.defs).open.length, 2);
  // Cut in half, the slot is 90 mm from the left edge and still turning.
  const half = run(fromLeft(35), moving);
  const cut = removeSection(half.layout, half.defs, half.at().selected);
  half.defs.set('s9', fromLeft(90));
  half.layout.sources.s9 = { name: 'Straight', track: fromLeft(90).track };
  refuses(
    () => placeSource(half.layout, half.defs, 's9', cut.end),
    /^The guide slots meet at an angle at this joint/,
  );
  assert.equal(half.layout.nodes.length, 2);
  // The second half of another copy is the same seam, and fits.
  half.layout.nodes.push({
    ...structuredClone(half.layout.nodes[1]),
    id: 'spare',
    index: 1,
    pose: { x: 900, y: 400, a: 1, flip: false },
  });
  snapRun(half.layout, half.defs, 'spare:0', cut.end);
  assert.equal(endsOf(half.layout, half.defs).open.length, 2);
});

test('a 35 to 145 mm straight only goes in as built; turned or mirrored needs its own piece', () => {
  const moving = wide(STRAIGHT, slot('outer', 35, 145));
  // As built: in at 35 mm from the left, out at 145 mm.
  const asBuilt = run(fromLeft(35), moving, fromLeft(145));
  assert.equal(endsOf(asBuilt.layout, asBuilt.defs).open.length, 2);
  // Mirrored it would be 165 to 55 mm, but a straight is never mirrored.
  refuses(
    () => run(fromLeft(165), [moving, 'left']),
    /the slot is 165 mm from the left edge on this piece and 35 mm on the next\.$/,
  );
  // Turned end for end it would be 55 to 165 mm: the planner builds A to B.
  refuses(
    () => run(fromLeft(55), moving),
    /the slot is 55 mm from the left edge on this piece and 35 mm on the next\. This piece would fit turned end for end, but the planner builds every piece from end A to end B\. Make a second piece for the way back, with the distances for end A and end B swapped and measured from the other edge\.$/,
  );
  // That second piece: 145 to 35 mm from the right edge.
  const second = run(
    fromLeft(55),
    wide(STRAIGHT, slot('inner', 145, 35)),
    fromLeft(165),
  );
  assert.equal(endsOf(second.layout, second.defs).open.length, 2);
  // The way back, 145 to 35 mm, is not the same piece turned round.
  refuses(
    () => run(fromLeft(35), moving, moving),
    /the slot is 145 mm from the left edge on this piece and 35 mm on the next\. Turning this piece round does not bring the slot back\. Make a second piece for the way back, with the distances for end A and end B swapped\.$/,
  );
  const back = run(
    fromLeft(35),
    moving,
    wide(STRAIGHT, slot('outer', 145, 35)),
    fromLeft(35),
  );
  assert.equal(endsOf(back.layout, back.defs).open.length, 2);
  // A constant off-centre straight has the same limit, and a shorter answer.
  refuses(
    () => run(fromLeft(165), fromLeft(35)),
    /This piece would fit turned end for end, but the planner builds every piece from end A to end B\. Make a second piece with the slot measured from the other edge\.$/,
  );
  // With tab joints the piece cannot be turned round at all.
  const tabs = { joint: 'tabs' };
  const tabbed = wide(STRAIGHT, slot('outer', 35, 145), tabs);
  refuses(
    () => run(wide(STRAIGHT, slot('outer', 55), tabs), tabbed),
    /This piece would fit turned end for end, but it cannot be turned round with tab joints\. Make a second piece for the way back/,
  );
  refuses(
    () => run(wide(STRAIGHT, slot('outer', 35), tabs), tabbed, tabbed),
    /Turning this piece round does not bring the slot back, and it cannot be turned round with tab joints\. Make a second piece for the way back/,
  );
  // Without connectors two separate runs can still be snapped end B to end B:
  // the slots are matched where they lie, whichever way a piece faces.
  const loose = run(fromLeft(55));
  loose.defs.set('s9', moving);
  loose.layout.sources.s9 = { name: 'Moving', track: moving.track };
  loose.layout.nodes.push({
    id: 'turned',
    source: 's9',
    index: 0,
    pose: { x: 900, y: 400, a: 1, flip: false },
    h: [0, 0],
    supports: 0,
  });
  snapRun(loose.layout, loose.defs, 'turned:1', loose.at().end);
  assert.equal(endsOf(loose.layout, loose.defs).open.length, 2);
});

test('a loop whose last joint has its slots out of line stays open and reports that joint', () => {
  const bend = corner('outer', 35);
  const oval = run(fromLeft(35), bend, bend, fromLeft(35), bend, bend);
  assert.equal(endsOf(oval.layout, oval.defs).open.length, 0);
  assert.deepEqual(blockedJoints(endsOf(oval.layout, oval.defs)), []);
  // The far straight moves the slot to 145 mm and nothing brings it back.
  const wideBend = corner('outer', 145);
  const open = run(
    fromLeft(35),
    bend,
    bend,
    wide(STRAIGHT, slot('outer', 35, 145)),
    wideBend,
    wideBend,
  );
  const net = endsOf(open.layout, open.defs);
  assert.equal(net.open.length, 2);
  const [joint, ...others] = blockedJoints(net);
  assert.equal(others.length, 0);
  assert.equal(joint.reason, 'slots');
  assert.equal(
    joint.text,
    'The guide slots do not line up at this joint: the slot is 145 mm from the left edge on this piece and 35 mm on the next.',
  );
  // "This piece" is the one travel leaves: the last corner, at its end B.
  assert.equal(joint.a.id, open.layout.nodes.at(-1).id);
  assert.equal(joint.a.i, 1);
  assert.equal(joint.b.id, open.layout.nodes[0].id);
  // The first piece starts at the origin, and that is where the loop ends.
  assert.ok(Math.hypot(...joint.xy) < 0.05);
});

test('pieces that differ only in slot position, and the mirrored print of a corner, are separate kit entries', () => {
  const out = wide(STRAIGHT, slot('outer', 35, 145)),
    home = wide(STRAIGHT, slot('outer', 145, 35)),
    bend = corner('inner', 35);
  const { layout, defs } = run(fromLeft(35), out, home, fromLeft(35), [
    bend,
    'left',
  ]);
  // The same corner as built, for a right-hand turn somewhere else.
  layout.nodes.push({
    ...structuredClone(layout.nodes.at(-1)),
    id: 'right-hander',
    pose: { x: 2000, y: 0, a: 0, flip: false },
  });
  const roads = tally(layout, defs).filter((g) => g.role === 'road');
  assert.deepEqual(
    roads.map((g) => [g.source, g.mirror, g.count]),
    [
      ['s1', false, 1],
      ['s2', false, 1],
      ['s3', false, 1],
      ['s4', false, 1],
      ['s5', true, 1],
      ['s5', false, 1],
    ],
  );
  const names = kitPieceNames(layout.sources);
  assert.deepEqual(names, {
    s1: 'Full straight slot 35 from left',
    s2: 'Full straight slot 35-145 from left',
    s3: 'Full straight slot 145-35 from left',
    s4: 'Full straight slot 35 from left',
    s5: 'R1 corner',
  });
  const prints = Object.keys(layout.sources).flatMap((key) => {
    const items = roads.filter((g) => g.source === key);
    const bytes = engine.plannerPrint({ track: defs.get(key).track, items });
    return items.map((g, i) => ({
      piece: names[key],
      part: g.name,
      role: g.role,
      mirror: g.mirror,
      count: g.count,
      bytes: bytes[i],
    }));
  });
  assert.deepEqual(
    printGroups(prints)
      .map((g) => g.file)
      .sort(),
    [
      'track/Full-straight-slot-145-35-from-left-Road-1-x1.stl',
      'track/Full-straight-slot-35-145-from-left-Road-1-x1.stl',
      'track/Full-straight-slot-35-from-left-Road-1-x2.stl',
      'track/R1-corner-Road-1-mirrored-x1.stl',
      'track/R1-corner-Road-1-x1.stl',
    ],
  );
});
