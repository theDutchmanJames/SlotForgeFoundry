import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { createEngine } from '../src/engine.js';
import { starterPack, trackWithProfile } from '../src/library-profile.js';
import { END_STOP, packSpecialTrack } from '../src/pack-specials.js';
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
  isTurnout,
  turnoutChoice,
  applyTurnoutChoice,
  ladderSpacing,
  turnoutSideFor,
  returnCurveFor,
  addReturnCurve,
  gapAhead,
  pitLadder,
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

test('a piece recipe with barriers gives its sections their own barrier parts', () => {
  const plain = source(0),
    walled = source(0, { tracksideSide: 'outer', tracksideEnds: 'finish' });
  assert.equal(walled.sections.length, plain.sections.length);
  const barriers = walled.meshes.filter((m) => m.role === 'barrier');
  assert.ok(barriers.length >= 1);
  // Drawn on the plan from their outline, and issued with a section.
  for (const mesh of barriers) {
    assert.ok(mesh.outline?.length, 'the barrier has an outline for the plan');
    assert.ok(walled.sections.some((s) => s.parts.includes(mesh.id)));
  }
  assert.equal(plain.meshes.filter((m) => m.role === 'barrier').length, 0);
  // The two recipes sit side by side in one layout: only the section that
  // uses the walled recipe prints a barrier.
  const { layout, defs } = setup([['s1', plain], ['s2', walled]]);
  placeSource(layout, defs, 's1');
  placeSource(layout, defs, 's2');
  const printed = tally(layout, defs).filter((g) => g.role === 'barrier');
  assert.equal(printed.length, barriers.length);
  assert.ok(printed.every((g) => g.source === 's2'));
  const bytes = engine.plannerPrint({
    track: walled.track,
    items: printed.map((g) => ({ id: g.id, mirror: g.mirror, pose: g.pose })),
  });
  const print = parseSTL(wasm, bytes[0]);
  assert.equal(print.status(), 'NoError');
  assert.ok(Math.abs(print.boundingBox().min[2]) < 0.001);
  print.delete();
});

// ---- The turnout in a layout: three ends ----
const single = starterPack(1);
const singlePiece = (kind) => {
  const { name, track } = structuredClone(single.pieces.find((p) => p.track.params.kind === kind));
  return { name, ...engine.plannerSource({ track: trackWithProfile(track, single.profile), plate }) };
};
function turnoutSource(choice = {}, bed = plate, autoFit = false) {
  const track = trackWithProfile(packSpecialTrack(single, 'turnout'), single.profile);
  applyTurnoutChoice(track.params, choice);
  return { name: 'Turnout', ...engine.plannerSource({ track, plate: bed, autoFit }) };
}

test('a turnout has three ends: it carries on along the main road and leaves its branch open', () => {
  const turnout = turnoutSource({ side: 'left' });
  assert.equal(turnout.sections.length, 1);
  const [entry, main, branch] = turnout.sections[0].ports;
  assert.equal(turnout.sections[0].ports.length, 3);
  assert.deepEqual([entry.out, main.out, branch.out], [undefined, undefined, true]);
  assert.equal(branch.branch, true);
  // The branch leaves to the left of travel, turned by the branch angle.
  assert.ok(branch.xy[1] > 20, 'the branch ends beside the main road: ' + branch.xy);
  const angle = (turnout.track.params.special.turnoutAngle * Math.PI) / 180;
  assert.ok(Math.abs(branch.angle - angle) < 1e-9);
  assert.equal(turnout.sections[0].lanes.length, 2, 'the main lane and the branch lane');
  // Both are lane 1 of a single-lane layout: the braid list has one lane,
  // as long as the main road and the branch together.
  const p = turnout.track.params;
  const braid = laneLengths([{ lanes: turnout.sections[0].lanes, laneOf: turnout.sections[0].laneOf }]);
  assert.equal(braid.length, 1);
  const arc = p.special.turnoutRadius * angle;
  assert.ok(Math.abs(braid[0] - (p.length + arc)) < 0.5, braid[0] + ' against ' + (p.length + arc));
  // Pieces that do not say so keep one lane per slot, as before.
  assert.equal(laneLengths([{ lanes: turnout.sections[0].lanes }]).length, 2);
  assert.ok(turnout.sections[0].ports.every((port) => port.slots.length === 1));

  const { layout, defs } = setup([['s1', singlePiece('straight')], ['s2', turnout], ['s3', singlePiece('curve')]]);
  let active = placeSource(layout, defs, 's1');
  active = placeSource(layout, defs, 's2', active.end);
  const node = layout.nodes[1];
  // Building goes on from the main exit: end B.
  assert.equal(active.end, node.id + ':1');
  let net = endsOf(layout, defs);
  assert.deepEqual(net.open.map((e) => e.key).sort(), [layout.nodes[0].id + ':0', node.id + ':1', node.id + ':2'].sort());
  const ends = net.ends.filter((e) => e.id === node.id);
  assert.deepEqual(ends.map((e) => e.out), [false, true, true]);
  // A straight on the main exit, a corner on the branch: both join.
  placeSource(layout, defs, 's1', node.id + ':1');
  const onBranch = placeSource(layout, defs, 's3', node.id + ':2', 'left');
  net = endsOf(layout, defs);
  assert.ok(net.joints.has(node.id + ':1'));
  assert.ok(net.joints.has(node.id + ':2'));
  assert.equal(net.joints.get(node.id + ':2').i, 0, 'the corner starts at the branch');
  assert.equal(blockedJoints(net).length, 0);
  assert.equal(net.open.length, 3);
  assert.ok(onBranch.end);
  // The two roads behind the turnout do not run into each other.
  assert.equal(crossings(surfaces(layout, defs)).length, 0);
  // Every part of the turnout is in the kit once.
  const totals = tally(layout, defs).filter((g) => g.source === 's2');
  // (The clips of a joint are issued once, with one of its two pieces.)
  const loose = (m) => m.role === 'clip' || m.role === 'retainer';
  assert.deepEqual(
    totals.filter((g) => !loose(g)).map((g) => g.id).sort(),
    turnout.meshes.filter((m) => !loose(m)).map((m) => m.id).sort(),
  );
  assert.ok(totals.filter((g) => !loose(g)).every((g) => g.count === 1));
  // The turnout brings the clips of its two exits, the branch included, and
  // both are joined here, so both sets are in the kit.
  const own = turnout.meshes.filter((m) => m.role === 'clip');
  assert.deepEqual([...new Set(Object.values(turnout.sections[0].hardwareEnds))].sort(), [1, 2]);
  assert.equal(
    totals.filter((g) => g.role === 'clip').reduce((sum, g) => sum + g.count, 0),
    own.length,
  );
  assert.ok(totals.some((g) => g.role === 'turnoutInsert'));
  assert.deepEqual(validateLayout(JSON.parse(JSON.stringify(layout))), layout);
});

test('a right-hand turnout is the mirror of a left-hand one, and a piece built backwards joins its main exit', () => {
  const left = turnoutSource({ side: 'left' }),
    right = turnoutSource({ side: 'right' });
  const [, , l] = left.sections[0].ports,
    [, , r] = right.sections[0].ports;
  assert.ok(Math.abs(l.xy[0] - r.xy[0]) < 1e-9 && Math.abs(l.xy[1] + r.xy[1]) < 1e-9);
  assert.ok(Math.abs(l.angle + r.angle) < 1e-9);
  assert.ok(right.meshes.some((m) => /^Right turnout/.test(m.name)));
  // Built backwards from the start of a straight, the turnout goes in with its
  // main exit on that start: its entry is the new build end, its branch open.
  const { layout, defs } = setup([['s1', singlePiece('straight')], ['s2', right]]);
  placeSource(layout, defs, 's1');
  const back = placeSource(layout, defs, 's2', layout.nodes[0].id + ':0');
  const node = layout.nodes[1];
  assert.equal(back.end, node.id + ':0');
  const net = endsOf(layout, defs);
  assert.equal(net.joints.get(layout.nodes[0].id + ':0').key, node.id + ':1');
  assert.deepEqual(net.open.map((e) => e.key).sort(), [layout.nodes[0].id + ':1', node.id + ':0', node.id + ':2'].sort());
});

test('the four inserts share one road, so a turnout changes insert without moving anything in the layout', () => {
  const modes = ['digital', 'manual', 'analog', 'closed'];
  const built = modes.map((turnoutMode) => turnoutSource({ turnoutMode }));
  const roadOf = (def) => def.meshes.find((m) => m.role === 'road');
  for (const [i, def] of built.entries()) {
    assert.equal(def.track.params.special.turnoutMode, modes[i]);
    assert.deepEqual(def.sections[0].ports, built[0].sections[0].ports, modes[i]);
    assert.deepEqual(roadOf(def).outline, roadOf(built[0]).outline, modes[i]);
    assert.equal(def.meshes.filter((m) => m.role === 'turnoutInsert').length, 1);
  }
  const names = (def) => def.meshes.map((m) => m.name);
  assert.ok(names(built[0]).includes('Turnout slider'));
  assert.ok(!names(built[2]).includes('Turnout slider'));
  assert.ok(names(built[3]).includes('Turnout insert · Closed'));
  // A layout whose turnout moves to the other recipe keeps both joints.
  const { layout, defs } = setup([['s1', singlePiece('straight')], ['s2', built[0]], ['s3', built[3]]]);
  let active = placeSource(layout, defs, 's1');
  active = placeSource(layout, defs, 's2', active.end);
  const node = layout.nodes[1];
  placeSource(layout, defs, 's1', node.id + ':1');
  placeSource(layout, defs, 's1', node.id + ':2');
  const before = endsOf(layout, defs);
  node.source = 's3';
  const after = endsOf(layout, defs);
  assert.equal(after.joints.size, before.joints.size);
  assert.deepEqual(after.open.map((e) => e.key), before.open.map((e) => e.key));
  assert.ok(tally(layout, defs).some((g) => g.name === 'Turnout insert · Closed'));
  // The choice is read from and written to the piece the same way everywhere.
  const params = structuredClone(built[0].track.params);
  assert.deepEqual(turnoutChoice(params), { side: 'left', turnoutMode: 'digital' });
  applyTurnoutChoice(params, { turnoutMode: 'analog' });
  assert.deepEqual(turnoutChoice(params), { side: 'left', turnoutMode: 'analog' });
  assert.equal(params.special.turnoutRadius, built[0].track.params.special.turnoutRadius);
  assert.equal(isTurnout(params), true);
  assert.equal(isTurnout(singlePiece('straight').track.params), false);
});

test('a turnout is never cut for the plate, lifts as one piece and prints from a layout', () => {
  // On a small plate it stays whole and says so.
  const small = { width: 180, depth: 180, margin: 5 };
  const tight = turnoutSource({}, small, true);
  assert.equal(tight.track.params.segments, 1);
  assert.equal(tight.sections.length, 1);
  assert.match(tight.warning, /prints as one road piece, and this one is larger than the print plate/);
  const roomy = turnoutSource({}, { width: 450, depth: 450, margin: 0 }, true);
  assert.equal(roomy.warning, '');
  // Lifted, all three ends rise together: a turnout is not a ramp.
  const { layout, defs } = setup([['s1', singlePiece('straight')], ['s2', roomy]]);
  let active = placeSource(layout, defs, 's1');
  active = placeSource(layout, defs, 's2', active.end);
  const node = layout.nodes[1];
  const onBranch = placeSource(layout, defs, 's1', node.id + ':2');
  setElevation(layout, defs, node.id, 30, 30, 2);
  const lifted = endsOf(layout, defs);
  const z = lifted.ends.filter((e) => e.id === node.id).map((e) => e.z);
  assert.deepEqual(z, [z[0], z[0], z[0]]);
  assert.ok(lifted.joints.has(node.id + ':2'), 'the piece on the branch came up with it');
  assert.equal(layout.nodes.find((n) => n.id === onBranch.selected).h[0], 30);
  assert.throws(() => setElevation(layout, defs, node.id, 30, 60, 2), /Use equal lifts across a corner or crossing/);
  // Its parts print from the layout as they do from Track Set.
  const jobs = tally(layout, defs).filter((g) => g.source === 's2' && ['road', 'turnoutInsert', 'turnoutSlider'].includes(g.role));
  assert.equal(jobs.length, 3);
  const bytes = engine.plannerPrint({
    track: roomy.track,
    items: jobs.map((g) => ({ id: g.id, mirror: g.mirror, pose: g.pose })),
  });
  for (const stl of bytes) {
    const print = parseSTL(wasm, stl);
    assert.equal(print.status(), 'NoError');
    assert.ok(Math.abs(print.boundingBox().min[2]) < 0.001);
    print.delete();
  }
});

// ---- Pit lane helpers: end stop, merge, return curve, fitted straight, ladder ----
const straightOf = (length, changes = {}) => {
  const { track } = structuredClone(single.pieces.find((p) => p.track.params.kind === 'straight'));
  const made = trackWithProfile(track, single.profile);
  Object.assign(made.params, { length, segments: 1, ...changes });
  return { name: 'Straight ' + length, ...engine.plannerSource({ track: made, plate, autoFit: false }) };
};
const endStop = () => ({
  name: 'End stop',
  ...engine.plannerSource({ track: trackWithProfile(packSpecialTrack(single, END_STOP), single.profile), plate, autoFit: false }),
});
const returnCorner = (turnout) => {
  const found = returnCurveFor(single.pieces, turnout.track.params);
  return {
    count: found.count,
    def: { name: found.piece.name, ...engine.plannerSource({ track: trackWithProfile(found.piece.track, single.profile), plate, autoFit: false }) },
  };
};

test('an end stop is the shortest straight of the pack with one end: nothing joins its closed end', () => {
  const track = packSpecialTrack(single, END_STOP);
  const lengths = single.pieces.filter((p) => p.track.params.kind === 'straight').map((p) => p.track.params.length);
  assert.equal(track.params.length, Math.min(...lengths));
  assert.equal(track.params.endStop, true);
  const stop = endStop();
  assert.equal(stop.sections.length, 1);
  assert.equal(stop.sections[0].ports.length, 1);
  // It carries the connectors of its open end only.
  const plain = straightOf(track.params.length);
  const clips = (def) => def.meshes.filter((m) => m.role === 'clip').length;
  // Its clips are for its open end; a plain straight brings them for end B.
  assert.ok(clips(plain) >= 1);
  assert.equal(clips(stop), clips(plain));
  assert.deepEqual([...new Set(Object.values(stop.sections[0].hardwareEnds))], [0]);
  assert.deepEqual([...new Set(Object.values(plain.sections[0].hardwareEnds))], [1]);
  // On a run it closes the open end; behind it nothing can be built.
  const { layout, defs } = setup([['s1', singlePiece('straight')], ['s2', stop]]);
  let active = placeSource(layout, defs, 's1');
  active = placeSource(layout, defs, 's2', active.end);
  const net = endsOf(layout, defs);
  assert.deepEqual(net.open.map((e) => e.key), [layout.nodes[0].id + ':0']);
  assert.equal(net.joints.size, 2);
  assert.equal(tally(layout, defs).filter((g) => g.role === 'road').length, 2);
  // The joint gets one set of clips, from the straight before the end stop.
  const issued = tally(layout, defs).filter((g) => g.role === 'clip');
  assert.equal(issued.reduce((sum, g) => sum + g.count, 0), clips(plain));
  assert.ok(issued.every((g) => g.source === 's1'));
  // Built backwards onto the start of a run, where no piece brings clips, the end stop brings its own.
  const lone = setup([['s1', singlePiece('straight')], ['s2', stop]]);
  placeSource(lone.layout, lone.defs, 's1');
  placeSource(lone.layout, lone.defs, 's2', lone.layout.nodes[0].id + ':0');
  assert.equal(endsOf(lone.layout, lone.defs).joints.size, 2);
  const backward = tally(lone.layout, lone.defs).filter((g) => g.role === 'clip');
  assert.equal(backward.reduce((sum, g) => sum + g.count, 0), clips(stop));
  assert.ok(backward.every((g) => g.source === 's2'));
  // It lies level and lifts with the piece it joins.
  setElevation(layout, defs, layout.nodes[0].id, 20, 20, 1);
  assert.deepEqual(layout.nodes[1].h, [20, 20]);
  assert.equal(crossings(surfaces(layout, defs)).length, 0);
  assert.deepEqual(validateLayout(JSON.parse(JSON.stringify(layout))), layout);
});

test('a turnout that joins two lanes goes in by its main exit, with its branch on the chosen side', () => {
  assert.equal(turnoutSideFor('left', false), 'left');
  assert.equal(turnoutSideFor('left', true), 'right');
  assert.equal(turnoutSideFor('right', true), 'left');
  // Travelling along +x, a join with its branch on the left is the right-hand piece.
  const join = turnoutSource({ side: turnoutSideFor('left', true) });
  const { layout, defs } = setup([['s1', singlePiece('straight')], ['s2', join]]);
  let active = placeSource(layout, defs, 's1');
  active = placeSource(layout, defs, 's2', active.end, 'left', { merge: true });
  const node = layout.nodes[1],
    net = endsOf(layout, defs);
  assert.equal(net.joints.get(layout.nodes[0].id + ':1').key, node.id + ':1', 'the main exit takes the joint');
  assert.equal(active.end, node.id + ':0', 'building carries on from its entry');
  const ends = net.ends.filter((e) => e.id === node.id);
  // The entry lies further along, and the branch reaches back on the left.
  assert.ok(ends[0].xy[0] > ends[1].xy[0] + 100);
  assert.ok(ends[2].xy[1] > 20 && ends[2].xy[0] < ends[0].xy[0]);
  // Placed the usual way the same piece would branch to the right.
  const usual = setup([['s1', singlePiece('straight')], ['s2', join]]);
  const first = placeSource(usual.layout, usual.defs, 's1');
  placeSource(usual.layout, usual.defs, 's2', first.end, 'left');
  const branch = endsOf(usual.layout, usual.defs).ends.find((e) => e.branch);
  assert.ok(branch.xy[1] < -20);
});

test('return corners bring a branch back parallel, and a fitted straight closes a pit lane onto its join', () => {
  const split = turnoutSource({ side: 'left' }),
    join = turnoutSource({ side: turnoutSideFor('left', true) });
  const corner = returnCorner(split);
  const angle = split.track.params.special.turnoutAngle;
  assert.equal(corner.count * corner.def.track.params.angle, angle);
  assert.equal(returnCurveFor([], split.track.params), null);
  const { layout, defs } = setup([
    ['s1', singlePiece('straight')], ['split', split], ['join', join], ['corner', corner.def],
    ['main', straightOf(1400)],
  ]);
  let active = placeSource(layout, defs, 's1');
  active = placeSource(layout, defs, 'split', active.end);
  const a = layout.nodes.at(-1);
  active = placeSource(layout, defs, 'main', a.id + ':1');
  active = placeSource(layout, defs, 'join', active.end, 'left', { merge: true });
  const b = layout.nodes.at(-1);
  // Both branches turned back: two ends facing each other on one line.
  const out = addReturnCurve(layout, defs, a.id, 'corner', corner.count);
  const back = addReturnCurve(layout, defs, b.id, 'corner', corner.count);
  assert.throws(() => addReturnCurve(layout, defs, a.id, 'corner', corner.count), /already has a piece on it/);
  assert.throws(() => addReturnCurve(layout, defs, layout.nodes[0].id, 'corner', 1), /Select a turnout first/);
  let net = endsOf(layout, defs);
  const from = net.open.find((e) => e.key === out.end),
    to = net.open.find((e) => e.key === back.end);
  assert.ok(Math.abs(Math.sin(from.angle)) < 1e-9, 'parallel to the main road again');
  assert.ok(Math.abs(from.xy[1] - to.xy[1]) < 1e-6 && from.xy[1] > 100);
  const gap = gapAhead(net, out.end);
  assert.equal(gap.to.key, back.end);
  assert.ok(Math.abs(gap.length - (to.xy[0] - from.xy[0])) < 1e-3 && gap.length > 50);
  assert.equal(gapAhead(net, layout.nodes[0].id + ':0'), null, 'nothing faces the start of the run');
  // The straight of that length joins both ends: the pit lane is a closed loop beside the main road.
  defs.set('fit', straightOf(gap.length));
  layout.sources.fit = { name: 'fit', track: defs.get('fit').track };
  placeSource(layout, defs, 'fit', out.end);
  net = endsOf(layout, defs);
  assert.deepEqual(net.open.map((e) => e.key).sort(), [layout.nodes[0].id + ':0', b.id + ':0'].sort());
  assert.equal(blockedJoints(net).length, 0);
  assert.equal(crossings(surfaces(layout, defs)).length, 0);
});

test('a pit ladder lays out its bays in one go, parallel or angled, and refuses bays that collide', () => {
  const turnout = turnoutSource({ side: 'right' });
  const corner = returnCorner(turnout);
  const length = turnout.track.params.length,
    stop = endStop(),
    stopLength = stop.track.params.length;
  const keys = { turnout: 'turnout', stop: 'stop', curve: 'corner', bay: 'bay', spacer: 'spacer' };
  const fresh = (spacing, bay) => {
    const made = setup([
      ['s1', singlePiece('straight')], ['turnout', turnout], ['stop', stop], ['corner', corner.def],
      ['bay', straightOf(bay)], ['spacer', straightOf(spacing - length)],
    ]);
    const first = placeSource(made.layout, made.defs, 's1');
    return { ...made, end: first.end };
  };
  // Parallel bays lie in one line beside the main road, so each needs its own length of it.
  // A bay also has to end before the return corners of the next one rise into its line.
  const sizes = { bayLength: 150, stopLength, cornerRadius: corner.def.track.params.radius };
  const spacing = ladderSpacing(turnout.track.params, sizes);
  assert.ok(spacing > 150 + stopLength + 100 && spacing < 150 + stopLength + corner.def.track.params.radius);
  // That is the least: 10 mm closer and the bays collide.
  const close = fresh(spacing - 10, 150);
  assert.throws(
    () => pitLadder(close.layout, close.defs, keys, { bays: 2, end: close.end, curves: corner.count }),
    /ladder-overlap/,
  );
  // Angled bays stand a turnout apart.
  assert.equal(ladderSpacing(turnout.track.params, { bayLength: 150, stopLength, cornerRadius: 0 }), length);
  const row = fresh(spacing, 150);
  const done = pitLadder(row.layout, row.defs, keys, { bays: 3, end: row.end, curves: corner.count });
  const count = (key) => row.layout.nodes.filter((n) => n.source === key).length;
  assert.deepEqual(
    [count('turnout'), count('stop'), count('bay'), count('corner'), count('spacer')],
    [3, 3, 3, 3 * corner.count, 2],
  );
  let net = endsOf(row.layout, row.defs);
  // Only the start of the run and the last main exit are open: every bay is closed.
  assert.equal(net.open.length, 2);
  assert.equal(done.end, row.layout.nodes.filter((n) => n.source === 'turnout').at(-1).id + ':1');
  assert.ok(net.open.some((e) => e.key === done.end));
  assert.equal(crossings(surfaces(row.layout, row.defs)).length, 0);
  // Three turnouts, one spacing apart.
  const xs = row.layout.nodes.filter((n) => n.source === 'turnout').map((n) => n.pose.x);
  assert.ok(Math.abs(xs[1] - xs[0] - spacing) < 1e-6 && Math.abs(xs[2] - xs[1] - spacing) < 1e-6);
  // Bays too close together are refused.
  const tight = fresh(length + 40, 400);
  assert.throws(
    () => pitLadder(tight.layout, tight.defs, keys, { bays: 3, end: tight.end, curves: corner.count }),
    /ladder-overlap/,
  );
  // Angled bays: no corners, and bays without a straight are a turnout and an end stop.
  const angled = fresh(length + 40, 150);
  pitLadder(angled.layout, angled.defs, { turnout: 'turnout', stop: 'stop', spacer: 'spacer' }, { bays: 2, end: angled.end });
  net = endsOf(angled.layout, angled.defs);
  assert.equal(net.open.length, 2);
  assert.equal(angled.layout.nodes.filter((n) => n.source === 'stop').length, 2);
  assert.equal(crossings(surfaces(angled.layout, angled.defs)).length, 0);
  for (const bays of [0, 13, 2.5])
    assert.throws(() => pitLadder(angled.layout, angled.defs, keys, { bays, end: undefined }), /Enter 1 to 12 pit bays/);
});
