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
    /^The guide slots meet at an angle at this joint, so a guide would catch\. A piece whose slot moves sideways only joins up with all of its own sections in place\.$/,
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

// Several lanes. The 2-lane pack road: 200 mm wide, lanes 100 mm apart, so
// centred slots are 50 and 150 mm from either edge. Pieces are 300 mm long
// on R300, without connectors unless asked.
const pack = starterPack(2).pieces;
const each = (edge, starts, ends = starts) => ({
  version: 1,
  edge,
  lanes: starts.map((startMm, k) => ({ startMm, endMm: ends[k] })),
});
function pair(index, slotPosition, changes = {}) {
  const key = JSON.stringify(['pair', index, slotPosition, changes]);
  if (!built.has(key)) {
    const { name, track } = structuredClone(pack[index]);
    Object.assign(track.params, {
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
const both = (mm) => pair(STRAIGHT, slot('outer', mm));

test('every lane of an off-centre piece is drawn where its slot runs, nearest slot first', () => {
  // Together: 35 and 135 mm from the left are 65 and -35 mm across.
  const together = pair(STRAIGHT, slot('outer', 35, 55)).sections[0];
  const ys = (port) => port.slots.map(([, y]) => y).sort((a, b) => a - b);
  assert.deepEqual(ys(together.ports[0]), [-35, 65]);
  assert.deepEqual(ys(together.ports[1]), [-55, 45]);
  // Each lane its own: 40 and 110 mm from the left become 30 and 110 mm.
  const spread = pair(STRAIGHT, each('outer', [40, 110], [30, 110])).sections[0];
  assert.deepEqual(ys(spread.ports[0]), [-10, 60]);
  assert.deepEqual(ys(spread.ports[1]), [-10, 70]);
  for (const s of [together, spread])
    for (const port of s.ports)
      for (const a of port.slotAngles) assert.ok(Math.abs(a - port.angle) < 1e-6);
  // A still lane stays straight; the moving one makes its S.
  assert.ok(spread.lanes.some((line) => line.every(([, y]) => Math.abs(y + 10) < 1e-9)));
});

test('a 2-lane run from centred through together and each-lane slots joins with tabs, clips or both', () => {
  for (const changes of [
    { joint: 'none' },
    { joint: 'tabs' },
    { joint: 'clips' },
    { joint: 'clips', connectorCounts: { seamClips: 2 } },
    { joint: 'both' },
    { joint: 'clips', clipType: 'carrera-retained', connectorCounts: undefined },
  ]) {
    const piece = (index, slotPosition) => pair(index, slotPosition, changes);
    const label = JSON.stringify(changes);
    // Centred (50/150), across to 30/130 together, along, a right-hand corner
    // (outer edge on the left), a left-hand corner (the mirrored print, inner
    // edge on the left), then each lane its own to 40/110, along, the same
    // road typed from the right edge, an each-lane corner both ways round, and
    // back to the pack spacing and centred.
    const { layout, defs } = run(
      piece(STRAIGHT),
      piece(STRAIGHT, slot('outer', 50, 30)),
      piece(STRAIGHT, slot('outer', 30)),
      piece(CORNER, slot('outer', 30)),
      [piece(CORNER, slot('inner', 30)), 'left'],
      piece(STRAIGHT, each('outer', [30, 130], [40, 110])),
      piece(STRAIGHT, each('outer', [40, 110])),
      piece(STRAIGHT, each('inner', [90, 160])),
      piece(CORNER, each('outer', [40, 110])),
      [piece(CORNER, each('inner', [40, 110])), 'left'],
      piece(STRAIGHT, each('outer', [40, 110], [50, 150])),
      piece(STRAIGHT),
    );
    assert.equal(layout.nodes.length, 12, label);
    const net = endsOf(layout, defs);
    // Every joint really carries its connectors, off-centre ends included.
    if (changes.joint !== 'none')
      assert.ok(net.ends.every((e) => e.hardware.length > 0), label);
    assert.equal(net.open.length, 2, label);
    assert.deepEqual(blockedJoints(net), [], label);
  }
});

test('several slots out of place are refused with every slot, from the edge they were typed from', () => {
  const left = run(both(35));
  refuses(
    () => left.add(pair(STRAIGHT)),
    /^The guide slots do not line up at this joint: the slots are 35 and 135 mm from the left edge on this piece and 50 and 150 mm on the next\.$/,
  );
  const right = run(pair(STRAIGHT, slot('inner', 35)));
  refuses(
    () => right.add(pair(STRAIGHT)),
    /^The guide slots do not line up at this joint: the slots are 35 and 135 mm from the right edge on this piece and 50 and 150 mm on the next\.$/,
  );
  // One slot in place and one not is still refused, naming both.
  const spread = run(pair(STRAIGHT, each('outer', [40, 110])));
  refuses(
    () => spread.add(pair(STRAIGHT, each('outer', [40, 120]))),
    /^The guide slots do not line up at this joint: the slots are 40 and 110 mm from the left edge on this piece and 40 and 120 mm on the next\.$/,
  );
  // The centred road reads from the left, as it always has.
  refuses(
    () => run(pair(STRAIGHT), both(35)),
    /^The guide slots do not line up at this joint: the slots are 50 and 150 mm from the left edge on this piece and 35 and 135 mm on the next\.$/,
  );
  // A different number of lanes is said as such.
  refuses(
    () => run(both(35), wide(STRAIGHT, slot('outer', 35))),
    /^The guide slots do not line up at this joint: this piece has 2 slots and the next has 1 slot\.$/,
  );
  // The planner refuses before anything is placed.
  assert.equal(left.layout.nodes.length, 1);
});

test('a mirrored 2-lane corner names all its slots and the corner to make, in either lane form', () => {
  const mirrored = (word, list, edge) =>
    new RegExp(
      '^The guide slots do not line up at this joint\\. This corner is printed mirrored for a left-hand turn\\. Its slots are still ' +
        list +
        ' mm from its ' +
        edge +
        ' edge, but this turn puts that edge on the other side of the road\\. Make a corner with the slots measured from the ' +
        (edge === 'outer' ? 'inner' : 'outer') +
        ' edge instead\\.$',
    );
  refuses(
    () => run(both(35), [pair(CORNER, slot('outer', 35)), 'left']),
    mirrored('slots', '35 and 135', 'outer'),
  );
  // The advice is right: the same numbers from the inner edge fit.
  const fixed = run(both(35), [pair(CORNER, slot('inner', 35)), 'left'], both(35));
  assert.equal(endsOf(fixed.layout, fixed.defs).open.length, 2);
  const spread = pair(STRAIGHT, each('outer', [40, 110]));
  refuses(
    () => run(spread, [pair(CORNER, each('outer', [40, 110])), 'left']),
    mirrored('slots', '40 and 110', 'outer'),
  );
  refuses(
    () => run(pair(STRAIGHT, each('inner', [40, 110])), [pair(CORNER, each('inner', [40, 110])), 'left']),
    mirrored('slots', '40 and 110', 'inner'),
  );
  const fixedEach = run(spread, [pair(CORNER, each('inner', [40, 110])), 'left'], spread);
  assert.equal(endsOf(fixedEach.layout, fixedEach.defs).open.length, 2);
  // A straight added to a mirrored corner names the corner as the cause.
  refuses(
    () => run([pair(CORNER, slot('outer', 35)), 'left'], both(35)),
    /^The guide slots do not line up at this joint\. The corner at this joint is printed mirrored for a left-hand turn\. Its slots are still 35 and 135 mm from its outer edge, but this turn puts that edge on the other side of the road\. Make a corner with the slots measured from the inner edge instead\.$/,
  );
  // The wrong corner for a right-hand turn gets the plain positions.
  refuses(
    () => run(both(35), pair(CORNER, slot('inner', 35))),
    /the slots are 35 and 135 mm from the left edge on this piece and 65 and 165 mm on the next\.$/,
  );
});

test('a mirrored 3-lane corner whose slots sit symmetric about the centre says why its clip no longer meets', () => {
  // 300 mm, lanes 90 mm apart: 55/150/245 is symmetric about the centre but
  // off the standard 60/150/240, so its single clip stands beside the middle slot.
  const three = { lanes: 3, width: 300, laneSpacing: 90, joint: 'clips' };
  const list = [55, 150, 245];
  const straight = pair(STRAIGHT, each('outer', list), three);
  // Turning right, the corner joins.
  const right = run(straight, pair(CORNER, each('outer', list), three));
  assert.equal(right.layout.nodes.length, 2);
  refuses(
    () => run(straight, [pair(CORNER, each('inner', list), three), 'left']),
    /^The connector positions differ at this joint\. This corner is printed mirrored for a left-hand turn, which moves its off-centre clip to the other side of the road\. Use tab joints, or move one slot so that the slots are no longer symmetric about the road centre\.$/,
  );
  // Named from the other side when the straight follows the corner.
  refuses(
    () => run([pair(CORNER, each('inner', list), three), 'left'], straight),
    /^The connector positions differ at this joint\. The corner at this joint is printed mirrored for a left-hand turn, which moves its off-centre clip/,
  );
  // Both remedies work: tab joints, or a list that is not symmetric.
  const tabs = { ...three, joint: 'tabs' };
  run(pair(STRAIGHT, each('outer', list), tabs), [pair(CORNER, each('inner', list), tabs), 'left']);
  const lopsided = [40, 130, 220];
  run(pair(STRAIGHT, each('outer', lopsided), three), [pair(CORNER, each('inner', lopsided), three), 'left']);
  // Centred pieces keep the message they always had.
  refuses(
    () => run(pair(STRAIGHT, null, three), [pair(CORNER, null, three), 'left']),
    /^The connector positions or clip families differ at this joint\. Choose another end or match their settings in Track Set\.$/,
  );
});

test('half of a 2-lane piece whose slots move sideways is refused next to another piece, in the plural', () => {
  const moving = pair(STRAIGHT, slot('outer', 30, 50), { segments: 2 });
  const half = run(both(30), moving);
  const cut = removeSection(half.layout, half.defs, half.at().selected);
  half.defs.set('s9', both(40));
  half.layout.sources.s9 = { name: 'Straight', track: both(40).track };
  refuses(
    () => placeSource(half.layout, half.defs, 's9', cut.end),
    /^The guide slots meet at an angle at this joint, so a guide would catch\. A piece whose slots move sideways only joins up with all of its own sections in place\.$/,
  );
});

test('a 2-lane straight only goes in as built, and the advice says slots', () => {
  const moving = pair(STRAIGHT, each('outer', [30, 130], [40, 110]));
  const asBuilt = run(both(30), moving, pair(STRAIGHT, each('outer', [40, 110])));
  assert.equal(endsOf(asBuilt.layout, asBuilt.defs).open.length, 2);
  // Turned end for end it would be 90/160 to 70/170 from the left.
  refuses(
    () => run(pair(STRAIGHT, each('outer', [90, 160])), moving),
    /the slots are 90 and 160 mm from the left edge on this piece and 30 and 130 mm on the next\. This piece would fit turned end for end, but the planner builds every piece from end A to end B\. Make a second piece for the way back, with the distances for end A and end B swapped and measured from the other edge\.$/,
  );
  // That second piece: 40/110 to 30/130 from the right edge.
  const second = run(
    pair(STRAIGHT, each('outer', [90, 160])),
    pair(STRAIGHT, each('inner', [40, 110], [30, 130])),
    pair(STRAIGHT, slot('outer', 70)),
  );
  assert.equal(endsOf(second.layout, second.defs).open.length, 2);
  refuses(
    () => run(both(30), moving, moving),
    /the slots are 40 and 110 mm from the left edge on this piece and 30 and 130 mm on the next\. Turning this piece round does not bring the slots back\. Make a second piece for the way back, with the distances for end A and end B swapped\.$/,
  );
  refuses(
    () => run(both(65), both(35)),
    /This piece would fit turned end for end, but the planner builds every piece from end A to end B\. Make a second piece with the slots measured from the other edge\.$/,
  );
});

test('a 2-lane loop whose last joint is out of line reports every slot', () => {
  const bend = pair(CORNER, slot('outer', 35));
  const oval = run(both(35), bend, bend, both(35), bend, bend);
  assert.equal(endsOf(oval.layout, oval.defs).open.length, 0);
  assert.deepEqual(blockedJoints(endsOf(oval.layout, oval.defs)), []);
  const far = pair(CORNER, each('outer', [35, 115]));
  const open = run(
    both(35),
    bend,
    bend,
    pair(STRAIGHT, each('outer', [35, 135], [35, 115])),
    far,
    far,
  );
  const [joint, ...others] = blockedJoints(endsOf(open.layout, open.defs));
  assert.equal(others.length, 0);
  assert.equal(joint.reason, 'slots');
  assert.equal(
    joint.text,
    'The guide slots do not line up at this joint: the slots are 35 and 115 mm from the left edge on this piece and 35 and 135 mm on the next.',
  );
});

test('2-lane pieces that differ only in their slots are separate kit entries named by every slot', () => {
  const { layout, defs } = run(
    pair(STRAIGHT),
    pair(STRAIGHT, slot('outer', 50, 35)),
    both(35),
    pair(STRAIGHT, each('outer', [35, 135], [40, 110])),
    [pair(CORNER, each('inner', [40, 110])), 'left'],
  );
  layout.nodes.push({
    ...structuredClone(layout.nodes.at(-1)),
    id: 'right-hander',
    pose: { x: 3000, y: 0, a: 0, flip: false },
  });
  const names = kitPieceNames(layout.sources);
  assert.deepEqual(names, {
    s1: 'Full straight',
    s2: 'Full straight slots 50/150-35/135 from left',
    s3: 'Full straight slots 35/135 from left',
    s4: 'Full straight slots 35/135-40/110 from left',
    s5: 'R1 corner',
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
});

test('a new piece carries on the climb and the supports of the piece it joins', () => {
  const { defs, layout } = setup([
    ['s1', source(0, { joint: 'none' })],
    ['c1', source(5, { joint: 'none' })],
  ]);
  const node = (c) => layout.nodes.find((n) => n.id === c.selected);
  let c = placeSource(layout, defs, 's1');
  setElevation(layout, defs, c.selected, 0, 20, 2);
  c = placeSource(layout, defs, 's1', c.end);
  assert.deepEqual(node(c).h, [20, 40]);
  assert.equal(node(c).supports, 2);
  // A corner stays level at the height it joins, and keeps the supports.
  c = placeSource(layout, defs, 'c1', c.end);
  assert.deepEqual(node(c).h, [40, 40]);
  assert.equal(node(c).supports, 2);
  // After a level piece the next straight is level too, until a descent is set.
  c = placeSource(layout, defs, 's1', c.end);
  assert.deepEqual(node(c).h, [40, 40]);
  setElevation(layout, defs, c.selected, 40, 10, 1);
  // The descent stops at the table.
  c = placeSource(layout, defs, 's1', c.end);
  assert.deepEqual(node(c).h, [10, 0]);
  assert.equal(node(c).supports, 1);
  c = placeSource(layout, defs, 's1', c.end);
  assert.deepEqual(node(c).h, [0, 0]);
  assert.equal(node(c).supports, 0);
});

test('square pegs stand in pairs under the road edges with tops that follow the slope', () => {
  const { defs, layout } = setup([['s1', source(0, { joint: 'none' })]]);
  let c = placeSource(layout, defs, 's1');
  setElevation(layout, defs, c.selected, 30, 50, 2, 'pegs');
  c = placeSource(layout, defs, 's1', c.end);
  const next = layout.nodes.find((n) => n.id === c.selected);
  assert.equal(next.supportStyle, 'pegs');
  assert.deepEqual(next.h, [50, 70]);
  setElevation(layout, defs, c.selected, 50, 50, 1, 'block');
  const requests = supportRequests(surfaces(layout, defs));
  assert.deepEqual(requests.map((r) => r.style), ['pegs', 'block']);
  const blocks = engine.plannerSupports({ requests, plate });
  // Two stations of two pegs on the ramp, one full-width block on the level.
  assert.equal(blocks.length, 5);
  const pegs = blocks.filter((b) => / Peg /.test(b.name));
  assert.equal(pegs.length, 4);
  for (const peg of pegs) {
    const [x, y, z] = peg.bounds.max.map((v, i) => v - peg.bounds.min[i]);
    assert.ok(Math.abs(Math.min(x, y) - 20) < 0.01, peg.name);
    assert.ok(Math.abs(Math.max(x, y) - 20) < 0.01, peg.name);
    assert.ok(z > 30 && z < 50.5, peg.name);
    // The sloping top makes a peg lower on one side than the other.
    assert.match(peg.name, /\d–\d/);
  }
  assert.match(blocks.find((b) => !/ Peg /.test(b.name)).name, /Support 1 · 50 mm/);
});

test('pegs take the width and length that are set, and new pieces keep that size', () => {
  const { defs, layout } = setup([['s1', source(0, { joint: 'none' })]]);
  let c = placeSource(layout, defs, 's1');
  assert.throws(
    () => setElevation(layout, defs, c.selected, 40, 40, 1, 'pegs', [30, 200]),
    /peg width and length from 5 to 100 mm/,
  );
  setElevation(layout, defs, c.selected, 40, 40, 1, 'pegs', [30, 50]);
  c = placeSource(layout, defs, 's1', c.end);
  assert.deepEqual(layout.nodes.find((n) => n.id === c.selected).peg, [30, 50]);
  const blocks = engine.plannerSupports({
    requests: supportRequests(surfaces(layout, defs)),
    plate,
  });
  assert.equal(blocks.length, 4);
  // The road runs along X: 50 mm along it, 30 mm across it, 40 mm tall.
  for (const b of blocks)
    assert.deepEqual(
      b.bounds.max.map((v, i) => Math.round((v - b.bounds.min[i]) * 100) / 100),
      [50, 30, 40],
    );
});
