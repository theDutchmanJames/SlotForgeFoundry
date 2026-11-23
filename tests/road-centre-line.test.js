import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { buildTrack, defaultTrack, nativeTrackPoint } from '../src/track.js';
import { specialTrackParams } from '../src/special-pieces.js';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { printableSTL } from '../src/kit.js';
import { centreLineSlots } from '../src/geometry/road-centre-line.js';
import { laneOffsetAt } from '../src/lane-adjustment.js';
import { roadLineFolder, syncCentreSlotNote, syncRoadMarkingFields } from '../src/paint-controls.js';

const wasm = await Module();
wasm.setup();
const straight = (extra = {}) => ({
  ...defaultTrack(), kind: 'straight', width: 200, length: 210, height: 10,
  laneSpacing: 100, slotDepth: 8, braidGap: 0.6, whiteLineWidth: 4,
  grooveWidth: 0.6, grooveDepth: 0.4, roadCentreLine: 'dashed',
  dashLength: 18, dashGap: 12, ...extra,
});

function roads(t, p, plan) {
  const parts = buildTrack(wasm, p, plan);
  t.after(() => parts.forEach(part => part.solid.delete()));
  return parts.filter(part => part.role === 'road');
}

// Convert a world-space probe to the centred, print-plane STL coordinates.
function readDepth(t, p, part) {
  const stl = parseSTL(wasm, printableSTL(part, encodeSTL, undefined, { mode: 'track', track: { params: p } }));
  t.after(() => stl.delete());
  const { min, max } = part.solid.boundingBox();
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2;
  return (x, y) => {
    const from = p.special ? -1 : p.height + 1, to = p.height - from;
    const xy = [x - cx, (p.special ? -1 : 1) * (y - cy)];
    const z = stl.rayCast([...xy, from], [...xy, to])[0]?.position[2];
    return Math.round((p.special ? z : p.height - z) * 1000) / 1000;
  };
}

function painted(part, x, y) {
  return (part.kerbMarkings ?? []).some(({ color, points }) => color === '#FFFFFF' && points.every(([ax, ay], i) => {
    const [bx, by] = points[(i + 1) % 3];
    return (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= -1e-7;
  }));
}

test('centre dashes retain physical length, open gaps and capped grooves across a printable join', t => {
  const p = straight({ segments: 2, roadLineGroove: true });
  const [entry, exit] = roads(t, p);
  for (const [part, along] of [[entry, -0.25], [exit, 0.25]]) {
    assert.ok(painted(part, along, 0.1));
    const depth = readDepth(t, p, part);
    assert.equal(depth(along, 0.1), 0, 'no transverse groove partway through a dash');
    for (const sign of [-1, 1]) {
      assert.equal(depth(along, sign * 1.9), 0);
      assert.equal(depth(along, sign * 2.3), 0.4);
      assert.equal(depth(along, sign * 2.7), 0);
    }
  }
  const z = readDepth(t, p, entry);
  for (const x of [-105 + 18.3, -105 + 29.7]) assert.equal(z(x, 0.1), 0.4, 'square cap');
  assert.equal(z(-105 + 22, 0.1), 0);
  assert.equal(painted(entry, -105 + 22, 0), false);
});

test('flat centre paint leaves the STL intact and a centred guide stays entirely clear', t => {
  const p = straight({ kind: 'curve', radius: 350, angle: 40, roadCentreLine: 'solid',
    laneAdjustment: { version: 1, mode: 'squeeze', spacingMm: 55, anchor: 'centre' } });
  const [marked] = roads(t, p), [plain] = roads(t, { ...p, roadCentreLine: 'none' });
  assert.deepEqual(encodeSTL(marked.solid), encodeSTL(plain.solid));
  for (const at of [0.14, 0.43, 0.76]) {
    assert.ok(painted(marked, ...nativeTrackPoint(p, at, 0)));
    assert.equal(painted(marked, ...nativeTrackPoint(p, at, 5)), false);
  }
  for (const lanes of [1, 3]) {
    const odd = straight({ lanes, width: lanes * 100, roadLineGroove: true });
    const [part] = roads(t, odd), [reference] = roads(t, { ...odd, roadCentreLine: 'none' });
    assert.equal(part.kerbMarkings?.length ?? 0, 0);
    assert.deepEqual(encodeSTL(part.solid), encodeSTL(reference.solid));
  }
});

test('centre stripes follow recovered imported edges and stay on the racing road through a broad pit', t => {
  const p = straight({ kind: 'import', roadCentreLine: 'solid' });
  const plan = { outlines: [[[40, 0], [240, 0], [240, 300], [40, 300]]],
    lanes: [[[90, 0], [90, 300]], [[190, 0], [190, 300]]] };
  const [road] = roads(t, p, plan);
  assert.ok(painted(road, 140, 225));
  assert.equal(painted(road, 146, 225), false);
  const pit = specialTrackParams('pit', straight({ roadCentreLine: 'solid', roadLineGroove: true }));
  pit.length = 1050;
  Object.assign(pit.special, { pitOffset: 200, pitWhiteLine: true });
  const [box] = roads(t, pit);
  assert.ok(painted(box, 0.1, 0));
  assert.equal(readDepth(t, pit, box)(0, -2.3), 0.4);
});

test('the diamond carries a continuous marking across each assembled arm and leaves its four lane paths open', t => {
  const p = specialTrackParams('diamond', straight({ roadCentreLine: 'solid', roadLineGroove: true }));
  p.segments = 2;
  p.special.angle = 90;
  const parts = roads(t, p);
  const [core] = parts;
  assert.ok(parts.every(part => part.kerbMarkings?.length));
  assert.ok(painted(core, 0.1, 0.1));
  const z = readDepth(t, p, core);
  assert.equal(z(15, 2.3), 0.4);
  assert.equal(z(50, 0.2), p.slotDepth);
  assert.equal(z(54, 0.2), p.braidDepth);
});

const slot = (edge, startMm, endMm = startMm) => ({ version: 1, edge, startMm, endMm });

test('an off-centre slot leaves the whole centre stripe on the road, and a moving slot opens it only where it crosses', t => {
  const single = extra => straight({ lanes: 1, length: 300, roadCentreLine: 'solid', ...extra });
  // Centred: the slot and its braids take the stripe along the whole piece.
  const [centred] = roads(t, single());
  for (const x of [-140, 0, 140]) assert.equal(painted(centred, x, 0.1), false);
  for (const edge of ['outer', 'inner']) {
    const p = single({ slotPosition: slot(edge, 35), roadLineGroove: true });
    const [road] = roads(t, p);
    for (const x of [-149, -75, 0.1, 75, 149]) {
      assert.ok(painted(road, x, 1.9));
      assert.ok(painted(road, x, -1.9));
      assert.equal(painted(road, x, 2.1), false);
    }
    const depth = readDepth(t, p, road);
    const y = edge === 'outer' ? 65 : -65;
    assert.equal(depth(10, y), p.slotDepth, 'the slot is where it was typed');
    assert.equal(depth(10, 0.1), 0, 'no slot under the stripe');
    assert.equal(depth(10, 2.3), 0.4);
    assert.equal(depth(10, -2.3), 0.4);
  }
  // From 35 to 145 mm the slot passes over the centre a little after mid-way.
  const moving = single({ slotPosition: slot('outer', 35, 145) });
  const [road] = roads(t, moving);
  const x = [...Array(301).keys()].map(i => i - 150).find(x => laneOffsetAt(moving, 0, x / 300 + 0.5) <= 0);
  assert.ok(x > 5 && x < 25, 'crossing at ' + x);
  for (const clear of [-149, -60, 80, 149]) assert.ok(painted(road, clear, 0.1), 'stripe at ' + clear);
  for (const taken of [x - 4, x, x + 4]) assert.equal(painted(road, taken, 0.1), false, 'slot at ' + taken);
});

test('the centre line hint describes the slot that is really there', () => {
  const p = straight({ lanes: 1, length: 300, roadCentreLine: 'solid' });
  assert.equal(centreLineSlots(p), 'centred');
  assert.equal(centreLineSlots({ ...p, lanes: 2 }), 'clear');
  assert.equal(centreLineSlots({ ...p, lanes: 3 }), 'centred');
  assert.equal(centreLineSlots({ ...p, slotPosition: slot('outer', 35) }), 'clear');
  assert.equal(centreLineSlots({ ...p, slotPosition: slot('inner', 35) }), 'clear');
  // 5 mm off centre the 4 mm stripe and the 7.1 mm braid shoulder still overlap.
  assert.equal(centreLineSlots({ ...p, slotPosition: slot('outer', 95) }), 'beside');
  assert.equal(centreLineSlots({ ...p, slotPosition: slot('outer', 35, 145) }), 'crossing');
  assert.equal(centreLineSlots({ ...p, slotPosition: slot('outer', 35, 80) }), 'clear');
  assert.equal(centreLineSlots({ ...p, kind: 'curve', radius: 300, angle: 45, slotPosition: slot('inner', 35) }), 'clear');

  const note = html => html.match(/<p class="hint" data-lanes="(\d)" data-centre-slot-note(?:="(\w+)")?( hidden)?>([^<]*)<\/p>/);
  // Without a slot position the markup is what it always was.
  assert.deepEqual(note(roadLineFolder(p)).slice(1),
    ['1', undefined, undefined, 'A centred guide slot occupies the marking here. Paint appears only on clear road surface.']);
  assert.equal(note(roadLineFolder({ ...p, lanes: 2 }))[3], ' hidden');
  assert.equal(note(roadLineFolder({ ...p, roadCentreLine: 'none' }))[3], ' hidden');
  const off = note(roadLineFolder({ ...p, slotPosition: slot('outer', 35) }));
  assert.deepEqual(off.slice(2, 4), ['clear', ' hidden']);
  const crossing = note(roadLineFolder({ ...p, slotPosition: slot('outer', 35, 145) }));
  assert.deepEqual(crossing.slice(2), ['crossing', undefined,
    'The guide slot crosses the centre line on this piece. Paint appears only on clear road surface.']);
  assert.match(note(roadLineFolder({ ...p, slotPosition: slot('outer', 95) }))[4], /^The off-centre guide slot takes part of the marking here\./);

  // Showing and hiding the folder's fields keeps the note in step.
  const form = (dataset, lanes) => {
    const hint = { dataset }, group = {};
    return { hint, elements: { roadCentreLine: { value: 'solid' }, roadKerbSide: { value: 'none' }, ...(lanes ? { lanes: { value: lanes } } : {}) },
      querySelector: key => key === '[data-centre-slot-note]' ? hint : group };
  };
  for (const [dataset, lanes, hidden] of [
    [{ lanes: '1', centreSlotNote: 'clear' }, undefined, true],
    [{ lanes: '1', centreSlotNote: 'crossing' }, undefined, false],
    [{ lanes: '1', centreSlotNote: 'beside' }, '1', false],
    [{ lanes: '1' }, undefined, false],
    [{ lanes: '1', centreSlotNote: '' }, '2', true],
    [{ lanes: '2' }, '3', false],
  ]) {
    const f = form(dataset, lanes);
    syncRoadMarkingFields(f);
    assert.equal(f.hint.hidden, hidden, JSON.stringify(dataset) + ' with ' + lanes + ' lanes');
  }
  const live = { dataset: {} };
  const container = { querySelector: () => live };
  syncCentreSlotNote(container, { ...p, slotPosition: slot('outer', 35, 145) });
  assert.deepEqual([live.hidden, live.dataset.centreSlotNote], [false, 'crossing']);
  assert.match(live.textContent, /crosses the centre line/);
  syncCentreSlotNote(container, { ...p, slotPosition: slot('outer', 35) });
  assert.deepEqual([live.hidden, live.dataset.centreSlotNote], [true, 'clear']);
  syncCentreSlotNote(container, p);
  assert.deepEqual([live.hidden, live.dataset.centreSlotNote], [false, '']);
  assert.match(live.textContent, /^A centred guide slot/);
});
