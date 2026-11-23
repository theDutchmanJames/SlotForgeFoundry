import assert from 'node:assert/strict';
import test from 'node:test';
import initManifold from 'manifold-3d';
import {
  buildTestJoint,
  buildTrack,
  defaultTrack,
  nativePath,
  trackParameters,
} from '../src/track.js';
import { connectorLayout } from '../src/geometry/connector-layout.js';
import { connectorEnvelopes } from '../src/geometry/track-joints.js';
import {
  roadOffsetWarning,
  sideMountWarning,
} from '../src/geometry/connector-position-warnings.js';
import {
  SLOT_SWEEP_ALLOWANCE,
  slotConnectorNotes,
  slotEndFace,
  slotEndObstacle,
  slotEndRequest,
  slotEndRow,
} from '../src/geometry/slot-end-row.js';
import { left } from '../src/geometry/solids.js';
import { slotShiftAt } from '../src/slot-position.js';
import { profileDiagram } from '../src/connection-controls.js';

const wasm = await initManifold();
wasm.setup();

// The owner's example: a 200 mm single-lane road with the default slot (3 mm),
// braids and 2 mm walls. Distances are from the left edge, looking from end A
// to end B, so 35 mm is 65 mm left of the centre and 145 mm is 45 mm right.
const slot = (startMm, endMm = startMm, edge = 'outer') => ({ version: 1, edge, startMm, endMm });
const road = (extra = {}) => ({
  ...defaultTrack(), kind: 'straight', width: 200, length: 400, lanes: 1, ...extra,
});
const curve = (extra = {}) => road({ kind: 'curve', radius: 300, angle: 45, ...extra });

const MODES = {
  'tabs': { joint: 'tabs' },
  'a draw-key clip': { joint: 'clips' },
  'a Carrera clip': { joint: 'clips', clipType: 'carrera-retained' },
  'tabs and a clip': { joint: 'both' },
  'two counted tabs': { joint: 'tabs', connectorCounts: { seamTabs: 2 } },
  'two counted draw-key clips': { joint: 'clips', connectorCounts: { seamClips: 2 } },
  'two counted Carrera clips': {
    joint: 'clips', clipType: 'carrera-retained', connectorCounts: { seamClips: 2 },
  },
  'two tabs and two clips, counted': {
    joint: 'both', connectorCounts: { seamTabs: 2, seamClips: 2 },
  },
};
// Rows by slot position, low side first. 100 is the standard centred row.
const EXPECTED = {
  'tabs': {
    100: ['tab -72', 'tab 72'], 35: ['tab -72', 'tab 75'], 145: ['tab -72', 'tab 72'],
  },
  'a draw-key clip': { 100: ['clip 14'], 35: ['clip 0'], 145: ['clip 0'] },
  'a Carrera clip': { 100: ['clip 14'], 35: ['clip 0'], 145: ['clip 0'] },
  'tabs and a clip': {
    100: ['tab -72', 'clip 14', 'tab 72'],
    35: ['tab -72', 'clip 0', 'tab 75'],
    145: ['tab -72', 'clip 0', 'tab 72'],
  },
  'two counted tabs': {
    100: ['tab -72', 'tab 72'], 35: ['tab -75', 'tab 75'], 145: ['tab -72', 'tab 72'],
  },
  'two counted draw-key clips': {
    100: ['clip -72', 'clip 72'], 35: ['clip -79.5', 'clip 79.5'], 145: ['clip -72', 'clip 72'],
  },
  'two counted Carrera clips': {
    100: ['clip -72', 'clip 72'], 35: ['clip -79.5', 'clip 79.5'], 145: ['clip -72', 'clip 72'],
  },
  'two tabs and two clips, counted': {
    100: ['clip -72', 'tab -24', 'clip 24', 'tab 72'],
    35: ['clip -75', 'tab -25', 'clip 25', 'tab 75'],
    // Right of the centre the row is the mirror image of the standard one.
    145: ['tab -72', 'clip -24', 'tab 24', 'clip 72'],
  },
};

function build(t, p, sample) {
  const parts = sample ? buildTestJoint(wasm, p, sample) : buildTrack(wasm, p);
  t.after(() => parts.forEach((part) => part.solid.delete()));
  for (const part of parts) assert.equal(part.solid.status(), 'NoError');
  return parts;
}

const tidy = (value) => Number(value.toFixed(6)) + 0;
const typeOf = (kind) => (kind === 'Clip' ? 'clip' : 'tab');
const sorted = (row) =>
  row.sort((a, b) => a.offset - b.offset).map(({ type, offset }) => type + ' ' + offset);

// The connectors printed on one joint face, measured on the built parts:
// signed mm from the road centre, positive to the left of travel.
function measured(parts, centre, tangent, wanted) {
  const across = left(tangent);
  const row = [];
  for (const part of parts.filter((item) => item.role === 'road')) {
    for (const guide of part.jointGuides ?? []) {
      const dx = guide.point[0] - centre[0], dy = guide.point[1] - centre[1];
      if (Math.abs(dx * tangent[0] + dy * tangent[1]) > 1e-6) continue;
      if (wanted && !wanted.includes(guide.kind)) continue;
      row.push({ type: typeOf(guide.kind), offset: tidy(dx * across[0] + dy * across[1]) });
    }
  }
  return sorted(row);
}

function endRows(t, p) {
  const parts = build(t, p);
  const path = nativePath(trackParameters(p));
  const at = (station) => measured(parts, path.point(station, 0), path.tangent(station));
  // End A carries the sockets and end B the tabs of the same row.
  const kinds = (station) => new Set(
    parts.filter((part) => part.role === 'road').flatMap((part) => part.jointGuides ?? [])
      .filter((guide) => {
        const centre = path.point(station, 0), tangent = path.tangent(station);
        return Math.abs((guide.point[0] - centre[0]) * tangent[0] + (guide.point[1] - centre[1]) * tangent[1]) < 1e-6;
      })
      .map((guide) => guide.kind),
  );
  assert.equal(kinds(0).has('Tab'), false);
  assert.equal(kinds(1).has('Socket'), false);
  return { A: at(0), B: at(1) };
}

const mirrored = (row) =>
  row
    .map((entry) => {
      const [type, offset] = entry.split(' ');
      return { type, offset: -Number(offset) + 0 };
    })
    .sort((a, b) => a.offset - b.offset)
    .map(({ type, offset }) => type + ' ' + offset);

function warningOf(run) {
  let caught;
  assert.throws(run, (error) => {
    caught = error;
    return true;
  });
  assert.ok(caught.warning, 'a structured connector warning: ' + caught.message);
  return caught.warning;
}

const SLOT_POSITION = { tab: 'geometry', field: 'slotStart', label: 'Slot position' };

test('the owner\'s 200 mm road: every end with the same slot position gets the same row, and a centred end keeps the standard row', (t) => {
  for (const [name, mode] of Object.entries(MODES)) {
    const rows = (slotPosition) => endRows(t, road({ ...mode, slotPosition }));
    const standard = rows(undefined);
    const at35 = rows(slot(35));
    const at145 = rows(slot(145));
    const into35 = rows(slot(100, 35));
    const across = rows(slot(35, 145));
    assert.deepEqual(standard.A, EXPECTED[name][100], name + ': standard centred row');
    assert.deepEqual(standard.B, standard.A, name);
    assert.deepEqual(at35.A, EXPECTED[name][35], name + ': slot at 35 mm');
    assert.deepEqual(at35.B, at35.A, name + ': a constant 35 mm piece chains with itself');
    assert.deepEqual(at145.A, EXPECTED[name][145], name + ': slot at 145 mm');
    assert.deepEqual(at145.B, at145.A, name + ': a constant 145 mm piece chains with itself');
    // The 100 -> 35 transition joins a standard piece at A and a 35 mm piece at B.
    assert.deepEqual(into35.A, standard.B, name + ': centred end A fits a standard centred straight');
    assert.deepEqual(into35.B, at35.A, name + ': end B fits a constant 35 mm straight');
    // The 35 -> 145 piece joins a 35 mm piece at A and a 145 mm piece at B.
    assert.deepEqual(across.A, at35.B, name + ': end A of 35 -> 145');
    assert.deepEqual(across.B, at145.A, name + ': end B of 35 -> 145');
    // A centred slot written out as an object is still the standard piece.
    assert.deepEqual(rows(slot(100)), standard, name + ': explicit centre');
  }
});

test('the same slot position gives the same row on straights and curves, in one to three segments', (t) => {
  for (const name of ['tabs', 'tabs and a clip', 'two counted draw-key clips', 'two tabs and two clips, counted']) {
    const mode = MODES[name];
    const row = EXPECTED[name][35];
    for (const segments of [1, 2, 3]) {
      const label = name + ', ' + segments + ' segment(s)';
      const long = { ...mode, segments, length: 800 };
      const constant = endRows(t, road({ ...long, slotPosition: slot(35) }));
      assert.deepEqual([constant.A, constant.B], [row, row], label + ': constant straight');
      const moving = endRows(t, road({ ...long, slotPosition: slot(100, 35) }));
      assert.deepEqual([moving.A, moving.B], [EXPECTED[name][100], row], label + ': transition');
      // A seam that the slot crosses 22 mm off-centre has no symmetric row of
      // four connectors. That is a seam matter (see the seam test below).
      if (segments === 1 || mode.connectorCounts?.seamTabs !== 2 || mode.joint !== 'both') {
        const back = endRows(t, road({ ...long, slotPosition: slot(35, 145) }));
        assert.deepEqual([back.A, back.B], [row, EXPECTED[name][145]], label + ': 35 -> 145');
      }
      // 35 mm from the outer edge of a curve is the same +65 mm as on a straight.
      const outer = endRows(t, curve({ ...mode, segments, slotPosition: slot(35) }));
      assert.deepEqual([outer.A, outer.B], [row, row], label + ': curve, from the outer edge');
      const inner = endRows(t, curve({ ...mode, segments, slotPosition: slot(165, 165, 'inner') }));
      assert.deepEqual([inner.A, inner.B], [row, row], label + ': curve, 165 mm from the inner edge');
    }
  }
});

test('a slot the same distance from the other edge gets the mirror image of the row, in real builds', (t) => {
  const cases = Object.entries(MODES).map(([name, mode]) => [name, mode, 35]);
  // Close to the centre the slot pushes a lone clip aside: to the right for a
  // slot on the left, and to the left for a slot on the right.
  cases.push(['a draw-key clip', MODES['a draw-key clip'], 95]);
  cases.push(['tabs and a clip', MODES['tabs and a clip'], 90]);
  cases.push(['one tab and one clip, counted', { joint: 'both', connectorCounts: { seamTabs: 1, seamClips: 1 } }, 35]);
  for (const [name, mode, mm] of cases) {
    const leftSide = endRows(t, road({ ...mode, slotPosition: slot(mm) }));
    const rightSide = endRows(t, road({ ...mode, slotPosition: slot(200 - mm) }));
    const fromRight = endRows(t, road({ ...mode, slotPosition: slot(mm, mm, 'inner') }));
    assert.deepEqual(rightSide.A, mirrored(leftSide.A), name + ' at ' + mm + ' mm');
    assert.deepEqual(rightSide.B, mirrored(leftSide.B), name + ' at ' + mm + ' mm');
    assert.deepEqual(fromRight, rightSide, name + ': the same slot typed from the right edge');
  }
  const pushed = endRows(t, road({ joint: 'clips', slotPosition: slot(95) }));
  assert.deepEqual(pushed.A, ['clip -10']);
  // An inner-edge curve is the mirror image of an outer-edge one.
  const outer = endRows(t, curve({ ...MODES['tabs'], slotPosition: slot(35) }));
  const inner = endRows(t, curve({ ...MODES['tabs'], slotPosition: slot(35, 35, 'inner') }));
  assert.deepEqual(inner.A, mirrored(outer.A));
  assert.deepEqual(inner.B, mirrored(outer.B));
});

function pureRow(extra, end, lanes) {
  const p = trackParameters(road(extra));
  return slotEndRow(slotEndRequest(p, end, { lanes })).positions;
}

test('the row is a function of the end alone: mirror image for a mirrored face, hand-placed marks included', () => {
  const requests = [
    ...Object.values(MODES),
    { joint: 'both', connectorCounts: { seamTabs: 1, seamClips: 1 } },
    { joint: 'both', connectorCounts: { seamTabs: 3, seamClips: 1 } },
    { joint: 'clips', connectorCounts: { seamClips: 3 } },
    { joint: 'tabs', connectorOffset: 60 },
  ];
  const flip = (row) => ({
    tab: row.tab.map((value) => -value + 0).sort((a, b) => a - b),
    clip: row.clip.map((value) => -value + 0).sort((a, b) => a - b),
  });
  const attempt = (run) => {
    try {
      return run();
    } catch (error) {
      assert.ok(error.warning, error.message);
      return 'refused';
    }
  };
  for (const request of requests) {
    for (const lane of [0.4, 3, 9.5, 13.3, 20, 47.5, 58, 65, 72, 80, 91.5]) {
      const plus = attempt(() => pureRow(request, 'start', [lane]));
      const minus = attempt(() => pureRow(request, 'start', [-lane]));
      assert.deepEqual(minus, plus === 'refused' ? plus : flip(plus), JSON.stringify(request) + ' at ' + lane);
      // Nothing about the end's name or the far end enters the row.
      assert.deepEqual(attempt(() => pureRow(request, 'finish', [lane])), plus);
    }
  }
  const byHand = { joint: 'both', placements: { startClips: [-50, 20], startTabs: [84] } };
  const turned = { joint: 'both', placements: { startClips: [50, -20], startTabs: [-84] } };
  assert.deepEqual(pureRow(byHand, 'start', [65]), { tab: [84], clip: [-50, 20] });
  assert.deepEqual(pureRow(turned, 'start', [-65]), flip(pureRow(byHand, 'start', [65])));
  const mixed = {
    joint: 'both', connectorCounts: { seamTabs: 2, seamClips: 2 }, placements: { startClips: [-30, 40] },
  };
  const mixedTurned = { ...mixed, placements: { startClips: [30, -40] } };
  assert.deepEqual(pureRow(mixedTurned, 'start', [-65]), flip(pureRow(mixed, 'start', [65])));
});

test('two ways of typing one position cannot fall either side of a limit', (t) => {
  const tabs = { joint: 'tabs', connectorCounts: { seamTabs: 2 } };
  const clips = { joint: 'clips', connectorCounts: { seamClips: 2 } };
  // The standard tab at 72 mm needs 1.5 + 2 + 5 mm to the slot centre plus the
  // allowance: a slot exactly 9.5 mm away blocks it, however it was computed.
  assert.equal(SLOT_SWEEP_ALLOWANCE, 1);
  for (const lane of [62.5, 62.5 + 1e-9, 62.5 - 1e-9, 62.50000000000001, 62.49999999999999])
    assert.deepEqual(pureRow(tabs, 'start', [lane]), { tab: [-72.5, 72.5], clip: [] }, String(lane));
  assert.deepEqual(pureRow(tabs, 'start', [62.49]), { tab: [-72, 72], clip: [] });
  // The next step out, 74.5 mm, is exactly 9.5 mm from a slot at 65 mm.
  for (const lane of [65, 100 - 35, 65 + 1e-9, 64.99999999999999])
    assert.deepEqual(pureRow(tabs, 'start', [lane]), { tab: [-75, 75], clip: [] }, String(lane));
  // 42.3 mm from the left and 157.7 mm from the right are the same slot, but
  // 100 - 42.3 and 157.7 - 100 differ in the last bit.
  assert.notEqual(100 - 42.3, 157.7 - 100);
  const typed = [100 - 42.3, 157.7 - 100, 57.7, 57.699999999999996, 57.70000000000001];
  for (const lane of typed)
    assert.deepEqual(pureRow(clips, 'start', [lane]), pureRow(clips, 'start', [typed[0]]), String(lane));
  assert.notDeepEqual(pureRow(clips, 'start', [57.7]), { tab: [], clip: [-72, 72] });
  // A width that is a whisker over a whole millimetre searches the same steps.
  const p = trackParameters(road(clips));
  const ask = slotEndRequest(p, 'start', { lanes: [65] });
  assert.deepEqual(
    slotEndRow({ ...ask, width: 200 + 1e-10 }).positions,
    slotEndRow(ask).positions,
  );
  const fromLeft = endRows(t, road({ ...clips, slotPosition: slot(42.3) }));
  const fromRight = endRows(t, road({ ...clips, slotPosition: slot(157.7, 157.7, 'inner') }));
  assert.deepEqual(fromRight, fromLeft);
  // On a centred face the rule is the standard one, without the allowance.
  const face = (lanes) => slotEndFace({
    width: 200, lanes, envelopes: connectorEnvelopes(p), slotWidth: p.slotWidth, wall: p.wall,
  });
  assert.equal(slotEndObstacle(face([0]), 'clip', 14), null);
  assert.equal(slotEndObstacle(face([0]), 'clip', 13), 'lane');
  assert.equal(slotEndObstacle(face([65]), 'clip', 79), 'lane');
  assert.equal(slotEndObstacle(face([65]), 'clip', 79, true), null, 'a mark placed by hand may stand closer');
  assert.equal(slotEndObstacle(face([65]), 'clip', 78, true), 'lane');
  assert.equal(slotEndObstacle(face([65]), 'clip', 91), 'edge');
});

test('what the rest of the piece cannot accommodate is refused with a pointer to Slot position, never nudged', (t) => {
  const advice = 'Use a longer piece, move the slot, or place the connectors by hand.';
  // The standard clip of a centred end sits 14 mm left of the slot. On a short
  // piece a slot that leaves to the left runs into its long pocket.
  const carrera = { joint: 'clips', clipType: 'carrera-retained' };
  const swept = warningOf(() => buildTrack(wasm, road({ ...carrera, length: 150, slotPosition: slot(100, 35) })));
  assert.equal(swept.location, 'Road start · Carrera clip');
  assert.match(swept.reason, /At the 14 mm offset, the slot moves sideways into the room this pocket needs\./);
  assert.match(swept.reason, /keep fixed places/);
  assert.equal(swept.advice, advice);
  assert.deepEqual(swept.setting, SLOT_POSITION);
  // A longer piece, a slot that leaves to the other side, or a hand-placed clip all work.
  assert.deepEqual(endRows(t, road({ ...carrera, length: 400, slotPosition: slot(100, 35) })).A, ['clip 14']);
  assert.deepEqual(endRows(t, road({ ...carrera, length: 150, slotPosition: slot(100, 165) })).A, ['clip 14']);
  const placed = road({ ...carrera, length: 150, slotPosition: slot(100, 35), placements: { startClips: [-14] } });
  assert.deepEqual(endRows(t, placed).A, ['clip -14']);

  // Opposing pockets on a short piece.
  const counted = { joint: 'clips', clipType: 'carrera-retained', connectorCounts: { seamClips: 2 } };
  const opposing = warningOf(() => buildTrack(wasm, road({ ...counted, length: 50, slotPosition: slot(35) })));
  assert.equal(opposing.location, 'Road finish · Carrera clip');
  assert.match(opposing.reason, /meets a connector from the other end of the piece/);
  assert.equal(opposing.advice, advice);
  assert.deepEqual(opposing.setting, SLOT_POSITION);
  assert.deepEqual(endRows(t, road({ ...counted, length: 80, slotPosition: slot(35) })).A, ['clip -79.5', 'clip 79.5']);

  // A braid pass-through under a pocket.
  const fed = { joint: 'clips', connectorCounts: { seamClips: 2 }, braidFeedSide: 'both' };
  const feed = warningOf(() => buildTrack(wasm, road({ ...fed, braidFeedStations: [0.02], slotPosition: slot(35) })));
  assert.match(feed.reason, /At the 79\.5 mm offset, the pocket would cut into a braid pass-through\./);
  assert.equal(feed.advice, 'Move the braid pass-through, move the slot, or place the connectors by hand.');
  assert.deepEqual(feed.setting, SLOT_POSITION);
  // The same feed further along leaves the row exactly where it was.
  assert.deepEqual(endRows(t, road({ ...fed, braidFeedStations: [0.1], slotPosition: slot(35) })).A, ['clip -79.5', 'clip 79.5']);

  // The outline of a tight bend.
  const tight = warningOf(() => buildTrack(wasm, curve({ ...counted, radius: 150, angle: 22.5, slotPosition: slot(35) })));
  assert.match(tight.reason, /reach outside the road/);
  assert.equal(tight.advice, 'Use a larger radius or sweep angle, move the slot, or place the connectors by hand.');
  assert.deepEqual(tight.setting, SLOT_POSITION);
  // The slot itself, where a long pocket leaves the inside of a bend.
  const inside = warningOf(() => buildTrack(wasm, curve({ ...counted, radius: 185, angle: 30, slotPosition: slot(35, 35, 'inner') })));
  assert.match(inside.reason, /cut into the guide slot or a braid recess/);
  assert.deepEqual(inside.setting, SLOT_POSITION);

  // A row that cannot be laid out across the road at all.
  const centre = warningOf(() => buildTrack(wasm, road({ joint: 'clips', connectorCounts: { seamClips: 1 }, slotPosition: slot(95) })));
  assert.match(centre.reason, /centre position is blocked/i);
  assert.equal(centre.advice, 'Move the slot, change the number of connectors, or place the connectors by hand.');
  assert.deepEqual(centre.setting, SLOT_POSITION);
  // The centred end of a transition fails exactly as a standard piece does.
  const standard = warningOf(() => buildTrack(wasm, road({ joint: 'clips', connectorCounts: { seamClips: 1 }, slotPosition: slot(100, 35) })));
  assert.equal(standard.setting.field, 'count_seamClips');
});

test('connectors placed by hand keep working per end, and the dialog map agrees with the build', (t) => {
  const mode = { joint: 'both', connectorCounts: { seamTabs: 2, seamClips: 2 } };
  const p = road({ ...mode, slotPosition: slot(35, 145), placements: { startClips: [-50, 51.5] } });
  const rows = endRows(t, p);
  // A hand-placed clip may stand 13.5 mm from the slot; the automatic tabs
  // keep the 1 mm allowance, and end B is untouched.
  assert.deepEqual(rows.A, ['clip -50', 'tab -25', 'clip 51.5', 'tab 75']);
  assert.deepEqual(rows.B, EXPECTED['two tabs and two clips, counted'][145]);
  const start = connectorLayout(p, null, 'start');
  assert.deepEqual(start.positions.clip, [-50, 51.5]);
  assert.deepEqual(start.positions.tab.map(tidy), [-25, 75]);
  assert.equal(start.fixedRow, true);
  assert.equal(start.reason('clip', 51.5, 1), null);
  assert.match(start.reason('clip', 52, 1), /guide slot/);
  assert.match(start.reason('clip', 92, 1), /edge/);
  // The build refuses exactly what the map refuses.
  const close = warningOf(() => buildTrack(wasm, { ...p, placements: { startClips: [-50, 52] } }));
  assert.equal(close.setting.field, 'place_startClips');
  assert.match(close.reason, /nearest guide slot centre is 13 mm away/);
  assert.deepEqual(endRows(t, { ...p, placements: { startClips: [-50, 51.5], finishTabs: [0] } }).B,
    ['clip -72', 'tab 0', 'clip 72']);

  // A hand-placed clip in the path of the slot points at its own setting.
  const carrera = { joint: 'clips', clipType: 'carrera-retained', length: 150, slotPosition: slot(100, 35) };
  const inTheWay = warningOf(() => buildTrack(wasm, road({ ...carrera, placements: { startClips: [15] } })));
  assert.match(inTheWay.reason, /At the 15 mm offset, the slot moves sideways into the room this pocket needs\.$/);
  assert.equal(inTheWay.setting.field, 'place_startClips');
  const map = connectorLayout(road(carrera), null, 'start', { editInvalid: true });
  assert.deepEqual(map.positions, { tab: [], clip: [14] });
  assert.match(map.placementWarning, /Road start · Carrera clip\. The slot moves sideways into the room this pocket needs\. Use a longer piece, move the slot, or place the connectors by hand\./);
  assert.match(map.reason('clip', 15), /slot moves sideways/);
  // Further out the slot never reaches the pocket: the map and the build agree.
  assert.equal(map.reason('clip', 25, 0), null);
  assert.deepEqual(endRows(t, road({ ...carrera, placements: { startClips: [25] } })).A, ['clip 25']);
  assert.equal(map.reason('clip', -14), null);
  assert.throws(() => connectorLayout(road(carrera), null, 'start'), /slot moves sideways/);
});

test('the dialog map shows the row the build prints, at both ends, with the slot where it runs', (t) => {
  const pieces = [slot(35), slot(145), slot(100, 35), slot(35, 145)];
  for (const [name, mode] of Object.entries(MODES)) {
    for (const slotPosition of pieces) {
      const p = road({ ...mode, slotPosition });
      const rows = endRows(t, p);
      for (const [scope, row] of [['start', rows.A], ['finish', rows.B]]) {
        const layout = connectorLayout(p, null, scope);
        const shown = sorted([
          ...layout.positions.tab.map((offset) => ({ type: 'tab', offset: tidy(offset) })),
          ...layout.positions.clip.map((offset) => ({ type: 'clip', offset: tidy(offset) })),
        ]);
        assert.deepEqual(shown, row, name + ' ' + scope + ' ' + JSON.stringify(slotPosition));
        assert.equal(layout.placementWarning, undefined);
      }
    }
  }
  const p = road({ joint: 'clips', slotPosition: slot(35, 145) });
  const layout = connectorLayout(p, null, 'start');
  assert.deepEqual(layout.lanes[0][0].map(tidy), [-200, 65]);
  assert.deepEqual(layout.lanes[0].at(-1).map(tidy), [200, -45]);
  const constant = connectorLayout(road({ joint: 'clips', slotPosition: slot(35) }), null, 'finish');
  assert.deepEqual(constant.lanes[0][0].map(tidy), [-200, 65]);
  assert.deepEqual(constant.lanes[0].at(-1).map(tidy), [200, 65]);
  // A finished build confirms the row, so the map does not second-guess it.
  const parts = build(t, p);
  const confirmed = connectorLayout(p, null, 'finish', { parts, editInvalid: true });
  assert.deepEqual(confirmed.positions, { tab: [], clip: [0] });
  assert.equal(confirmed.placementWarning, undefined);
});

test('internal seams are planned from the slot at each seam and make room for the fixed end rows', (t) => {
  for (const mode of [MODES['two counted draw-key clips'], MODES['tabs and a clip']]) {
    const p = road({ ...mode, length: 600, segments: 3, slotPosition: slot(35, 145) });
    const q = trackParameters(p);
    const parts = build(t, p);
    const path = nativePath(q);
    const envelopes = connectorEnvelopes(q);
    for (const station of [1 / 3, 2 / 3]) {
      const lane = slotShiftAt(q, station);
      const row = measured(parts, path.point(station, 0), path.tangent(station));
      assert.ok(row.length >= 2, 'connectors at the seam');
      for (const entry of row) {
        const [type, offset] = entry.split(' ');
        assert.ok(
          Math.abs(Number(offset) - lane) > q.slotWidth / 2 + q.wall + envelopes[type].half,
          entry + ' clears the slot at ' + lane,
        );
      }
    }
  }
  // A seam row that cannot be found is still a seam matter, reported as today.
  const crowded = warningOf(() => buildTrack(wasm, road({
    ...MODES['two tabs and two clips, counted'], length: 800, segments: 3, slotPosition: slot(35, 145),
  })));
  assert.equal(crowded.location, 'Road seam 2');
  assert.equal(crowded.setting.field, 'count_seamClips');
});

test('a fit sample of an end shows the slot and the connector row of that end', (t) => {
  const seamRow = (p, which) => {
    const parts = build(t, p, which);
    assert.deepEqual(parts.filter((part) => part.role === 'road').map((part) => part.id), ['road-1', 'road-2']);
    const row = (kinds) => measured(parts, [0, 0], [1, 0], kinds);
    // Both halves of the sample carry the same row.
    assert.deepEqual(row(['Tab', 'Clip']).filter((entry) => entry.startsWith('tab')),
      row(['Socket']).filter((entry) => entry.startsWith('tab')));
    return row(['Socket', 'Clip']).filter((entry, i, all) => all.indexOf(entry) === i);
  };
  for (const name of ['tabs', 'tabs and a clip', 'two counted draw-key clips', 'two tabs and two clips, counted']) {
    const mode = MODES[name];
    const across = road({ ...mode, slotPosition: slot(35, 145) });
    assert.deepEqual(seamRow(across, 'start'), EXPECTED[name][35], name + ': start sample of 35 -> 145');
    assert.deepEqual(seamRow(across, 'finish'), EXPECTED[name][145], name + ': finish sample of 35 -> 145');
    const into = road({ ...mode, slotPosition: slot(100, 35) });
    assert.deepEqual(seamRow(into, 'start'), EXPECTED[name][100], name + ': start sample of 100 -> 35');
    assert.deepEqual(seamRow(into, 'finish'), EXPECTED[name][35], name + ': finish sample of 100 -> 35');
    // A piece in one segment has no seam of its own: its joint sample shows end A.
    assert.deepEqual(seamRow(across, 'seam'), EXPECTED[name][35], name + ': joint sample');
  }
  // The sample's slot runs straight at the position of its end.
  const contains = (solid, xy, z) => {
    const probe = wasm.Manifold.cube([0.04, 0.04, 0.04], true);
    const placed = probe.translate([...xy, z]);
    const hit = solid.intersect(placed);
    try {
      return hit.volume() > 0.000032;
    } finally {
      hit.delete();
      placed.delete();
      probe.delete();
    }
  };
  for (const [which, y] of [['start', 65], ['finish', -45]]) {
    const parts = build(t, road({ joint: 'clips', slotPosition: slot(35, 145) }), which);
    for (const [id, x] of [['road-1', -15], ['road-2', 15]]) {
      const half = parts.find((part) => part.id === id);
      assert.equal(contains(half.solid, [x, y], 8), false, which + ': slot');
      assert.equal(contains(half.solid, [x, y + 1.6], 8), true, which + ': slot wall');
    }
  }
});

test('the notes say which ends leave the standard positions and which slot position would keep them', (t) => {
  const texts = (extra) => slotConnectorNotes(trackParameters(road(extra))).map((note) => {
    assert.equal(note.level, 'note');
    return note.text;
  });
  const clips = MODES['two counted draw-key clips'];
  assert.deepEqual(texts({ ...clips, slotPosition: slot(35) }), [
    'Connectors at both ends move to make room for the slot. They fit other ends with the slot at 35 mm, not centred pieces. At 42.5 mm or more the standard positions stay.',
  ]);
  assert.deepEqual(texts({ ...clips, slotPosition: slot(100, 35) }), [
    'Connectors at end B move to make room for the slot. End B fits other ends with the slot at 35 mm, not centred pieces. At 42.5 mm or more the standard positions stay.',
  ]);
  assert.deepEqual(texts({ ...clips, slotPosition: slot(35, 145) }), [
    'Connectors at end A move to make room for the slot. End A fits other ends with the slot at 35 mm, not centred pieces. At 42.5 mm or more the standard positions stay.',
  ]);
  assert.deepEqual(texts({ ...MODES['tabs'], slotPosition: slot(165, 165, 'inner') }), [
    'Connectors at both ends move to make room for the slot. They fit other ends with the slot at 165 mm, not centred pieces. At 162 mm or less the standard positions stay.',
  ]);
  assert.deepEqual(texts({ ...MODES['a draw-key clip'], slotPosition: slot(35) }), [
    'Connectors at both ends are not where a centred piece has them. They fit other ends with the slot at 35 mm, not centred pieces.',
  ]);
  // Nothing to say where the standard row stays, where there are no
  // connectors, or for a centred piece.
  assert.deepEqual(texts({ ...clips, slotPosition: slot(145) }), []);
  assert.deepEqual(texts({ ...clips, slotPosition: slot(42.5) }), []);
  assert.deepEqual(texts({ joint: 'none', slotPosition: slot(35) }), []);
  assert.deepEqual(texts(clips), []);
  assert.deepEqual(slotConnectorNotes({ slotPosition: {} }), []);
  // The advice holds in a real build: at 42.5 mm the standard clips stay, at 42 mm they move.
  const standard = EXPECTED['two counted draw-key clips'][100];
  assert.deepEqual(endRows(t, road({ ...clips, slotPosition: slot(42.5) })).A, standard);
  assert.notDeepEqual(endRows(t, road({ ...clips, slotPosition: slot(42) })).A, standard);
});

test('side mounts beside a slot close to that edge point at Slot position', () => {
  const border = { joint: 'none', borderSide: 'outer', borderMount: 'clips' };
  const carrera = warningOf(() => buildTrack(wasm, road({ ...border, clipType: 'carrera-retained', slotPosition: slot(30) })));
  assert.equal(carrera.location, 'Outside border attachment 1 · Carrera clip');
  assert.match(carrera.reason, /guide-slot centre is 30 mm from this road edge/);
  assert.equal(carrera.advice, 'Either move the slot away from this edge under Road → Slot position, or increase Road → Road width.');
  assert.deepEqual(carrera.setting, SLOT_POSITION);
  // The braid recess of a slot a little further in still meets the pocket.
  const recess = warningOf(() => buildTrack(wasm, road({ ...border, slotPosition: slot(19) })));
  assert.match(recess.reason, /would cut into a guide slot or braid recess/);
  assert.match(recess.advice, /^Either move the slot away from this edge under Road → Slot position, or move Side clips/);
  assert.deepEqual(recess.setting, SLOT_POSITION);
  const parts = buildTrack(wasm, road({ ...border, slotPosition: slot(25) }));
  assert.ok(parts.some((part) => part.id === 'side-clip-outer-1'));
  parts.forEach((part) => part.solid.delete());
  // The dialog map of the border measures from the same moved slot.
  assert.equal(connectorLayout(road({ ...border, slotPosition: slot(25) }), null, 'side').reason('clip', 0.4), null);
  assert.match(
    connectorLayout(road({ ...border, clipType: 'carrera-retained', slotPosition: slot(30) }), null, 'side').reason('clip', 0.4),
    /guide slot/,
  );
  assert.equal(
    connectorLayout(road({ ...border, clipType: 'carrera-retained', slotPosition: slot(170) }), null, 'side').reason('clip', 0.4),
    null,
  );
  // Without a slot position the advice is the usual one.
  const usual = sideMountWarning({
    label: 'Outside border attachment 1 · clip', type: 'clip', value: 0.5, custom: false,
    reason: 'lane', required: 10, available: 30, widest: 30, widthControl: 'Apex', side: 'outer',
    nativeLaneGap: 15, laneMinimum: 17.65,
  }).warning;
  assert.equal(usual.setting.field, 'width');
  assert.match(usual.advice, /^Increase Road → Road width/);
});

test('a pocket that meets a sideways-moving slot is described for slot positions, and squeezes keep their words', () => {
  const envelope = { half: 9.8 };
  const road = (slotPosition) => roadOffsetWarning({
    label: 'Road seam 1 · clip', kind: 'straight', end: 'seam', type: 'clip', value: 20, custom: false,
    width: 200, envelope, laneSpace: 13.3, lanes: [0], reason: 'laneSweep', slotPosition,
  }).warning;
  assert.match(road(true).reason, /At the 20 mm offset, the pocket reaches a guide slot wall where the slot moves sideways away from the seam\./);
  assert.match(road(false).reason, /At the 20 mm offset, the pocket reaches a guide slot wall as the lanes change spacing away from the seam\./);
  const side = (slotPosition) => sideMountWarning({
    label: 'Outside border attachment 1 · clip', type: 'clip', value: 0.5, custom: true,
    reason: 'laneSweep', required: 10, available: 30, widest: 30, widthControl: 'Apex', side: 'outer', slotPosition,
  }).warning;
  assert.match(side(true).reason, /the pocket reaches the wall of a guide slot where the slot moves sideways\./);
  assert.match(side(false).reason, /the pocket reaches the wall of a guide slot as the lanes change spacing\./);
});

test('the cross-section diagram draws the slot where it starts', () => {
  const outline = (p) => profileDiagram(trackParameters(p)).match(/<path d="([^"]+)"/)[1];
  // 1.4 px per mm around x = 154: slot walls at 0 -+ 1.5 mm, or 65 -+ 1.5 mm.
  assert.match(outline(road()), /L151\.9 /);
  assert.match(outline(road()), /L156\.1 /);
  const moved = outline(road({ slotPosition: slot(35, 145) }));
  assert.match(moved, /L242\.9 /);
  assert.match(moved, /L247\.1 /);
  assert.doesNotMatch(moved, /L151\.9 /);
  assert.match(profileDiagram(trackParameters(road({ slotPosition: slot(35, 145) }))), /Seen at end A/);
  assert.doesNotMatch(profileDiagram(trackParameters(road({ slotPosition: slot(35) }))), /Seen at end A/);
});
