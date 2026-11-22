import assert from 'node:assert/strict';
import test from 'node:test';
import initManifold from 'manifold-3d';
import { buildTestJoint, buildTrack, defaultTrack, nativePath, validateTrack } from '../src/track.js';
import { countedJoint, connectorCount } from '../src/geometry/placements.js';
import { planConnectorRow } from '../src/geometry/connector-counts.js';
import { connectorLayout } from '../src/geometry/connector-layout.js';

const wasm = await initManifold();
wasm.setup();
const straight = {
  ...defaultTrack(), kind: 'straight', width: 200, length: 400, segments: 1,
  borderSide: 'none', laneSpacing: 100, joint: 'clips',
};
const row = (counts, blocked = () => null) => planConnectorRow(
  countedJoint({ ...straight, joint: 'both', connectorCounts: counts }, 'seam'),
  {domain: [-100, 100], length: 200, halfAt: () => 5, blocked, location: 'Road seam 1'},
);
function build(t, params, choice) {
  const parts = choice ? buildTestJoint(wasm, params, choice) : buildTrack(wasm, params);
  t.after(() => parts.forEach(part => part.solid.delete()));
  return parts;
}

test('either kind can occupy the outer pair and midpoint in a five-position mixed row', () => {
  assert.deepEqual(row({seamClips: 3, seamTabs: 2}), {clip: [-72, 0, 72], tab: [-36, 36]});
  assert.deepEqual(row({seamClips: 2, seamTabs: 3}), {tab: [-72, 0, 72], clip: [-36, 36]});
  const adjusted = row({seamClips: 3, seamTabs: 2}, (_, v) => Math.abs(v - 72) < 5 ? 'Slot wall.' : null);
  assert.ok(Math.abs(adjusted.clip[2] - 72) >= 5);
  assert.equal(adjusted.clip[2], -adjusted.clip[0]);
  assert.equal(adjusted.clip[1], 0);
  assert.equal(adjusted.tab[1] * 2, adjusted.clip[2]);
});

test('counts regenerate on width changes, while a blocked centre gives an actionable error', (t) => {
  for (const width of [180, 220]) for (const count of [1, 2, 3]) {
    const p = {...straight, width, connectorCounts: {seamClips: count}};
    const parts = build(t, p);
    const road = parts.find(p => p.role === 'road');
    assert.equal(parts.filter(p => p.role === 'clip').length, count);
    const offsets = road.jointGuides.filter(g => g.point[0] < 0).map(g => g.point[1]);
    const outside = width * 0.36;
    assert.deepEqual(offsets, count === 1 ? [0] : count === 2 ? [-outside, outside] : [-outside, 0, outside]);
  }
  assert.throws(() => buildTrack(wasm, {...straight, lanes: 1, connectorCounts: {seamClips: 1}}), error => {
    assert.match(error.message, /centre position is blocked.*guide slot.*two outside/i);
    assert.equal(error.warning.setting.field, 'count_seamClips');
    return true;
  });
});

test('a braid feed beside one outside mark moves the pair together in the map and printable mesh', t => {
  const p = {...straight, segments: 2, jointStart: 'none', jointEnd: 'none',
    length: 520, width: 150, laneSpacing: 65, braidGap: 15, braidFeedSide: 'both',
    braidFeedLane: 1, braidFeedStations: [0.48], connectorCounts: {seamClips: 2}};
  const map = connectorLayout(p, null, 'seam');
  assert.match(map.reason('clip', -54), /braid pass-through/);
  const [a,b] = map.positions.clip;
  assert.equal(a, -b);
  assert.notEqual(a, -54);
  for (const road of build(t, p).filter(part => part.role === 'road'))
    assert.deepEqual(road.jointGuides.filter(g => g.kind === 'Clip').map(g => g.point[1]), [a,b]);
});

test('external overrides supply enough loose hardware and transfer the chosen count to the joint sample', (t) => {
  const params = {...straight, joint: 'both', connectorCounts: {seamClips: 1, seamTabs: 1, startClips: 3, startTabs: 2}};
  const parts = build(t, params);
  assert.equal(parts.filter(p => p.role === 'clip').length, 3);
  assert.equal(new Set(parts.map(p => p.id)).size, parts.length);
  const sample = build(t, params, 'start');
  assert.equal(sample.filter(p => p.role === 'clip').length, 3);
  assert.equal(sample.flatMap(p => p.jointGuides ?? []).filter(g => g.kind === 'Tab').length, 2);
});

test('repeating a three-segment tight Carrera curve aligns both external ends and all internal mating pairs', t => {
  const p = {...straight, kind: 'curve', radius: 185, angle: 90, laneSpacing: 85,
    segments: 3, clipType: 'carrera-retained', connectorCounts: {seamClips: 2}};
  const path = nativePath(p);
  const roads = build(t, p).filter(part => part.role === 'road');
  function offsets(road, station) {
    const [x, y] = path.point(station, 0), [u, v] = path.point(station, 1);
    const dx = u - x, dy = v - y;
    const values = road.jointGuides.flatMap(({kind, point: [a, b]}) =>
      kind === 'Clip' && Math.abs((a - x) * dy - (b - y) * dx) < 1e-5
        ? [Math.round(((a - x) * dx + (b - y) * dy) * 1e5) / 1e5] : []);
    assert.equal(values.length, 2);
    return values.sort((a, b) => a - b);
  }
  assert.deepEqual(offsets(roads[0], 0), offsets(roads.at(-1), 1));
  for (let i = 1; i < roads.length; i++)
    assert.deepEqual(offsets(roads[i-1], i/3), offsets(roads[i], i/3));
});

test('road-facing and end-facing border joints use their own counts with independent side overrides', (t) => {
  const params = {...straight, joint: 'none', borderSide: 'both', borderMount: 'clips', borderJoint: 'tabs',
    borderEntry: 100, borderApex: 100, borderExit: 100, borderSegments: 1,
    connectorCounts: {sideClips: 2, innerSideClips: 3, endTabs: 2, innerEndTabs: 1}};
  const parts = build(t, params);
  assert.equal(parts.filter(p => p.role === 'clip').length, 5);
  for (const [side, clips, tabs] of [['inner',3,1], ['outer',2,2]]) {
    const border = parts.find(p => p.id.includes(side) && p.role === 'border');
    assert.equal(border.jointGuides.filter(g => g.kind === 'Clip').length, clips);
    assert.equal(border.jointGuides.filter(g => g.kind === 'Tab').length, tabs);
    assert.equal(border.jointGuides.filter(g => g.kind === 'Socket').length, tabs);
  }
});

test('counts are integral, capped per joint and respect scoped manual overrides', () => {
  for (const counts of [{bad: 2}, {seamTabs: 0}, {finishClips: 4}, {sideTabs:1.5}, []])
    assert.throws(() => validateTrack({...straight, connectorCounts: counts}), /counts|1, 2 or 3/);
  assert.throws(() => validateTrack({...straight, joint:'both', connectorCounts:{seamTabs:3,seamClips:3}}), /five/);
  const p = {...straight, borderMount:'clips', placements: {sideClips:[0.4]},
    connectorCounts:{innerSideClips:3, seamClips:2, finishClips:1}};
  assert.equal(connectorCount(p, 'side', 'clip', 'outer'), 1);
  assert.equal(connectorCount(p, 'side', 'clip', 'inner'), 3);
  assert.equal(connectorCount(p, 'start', 'clip'), 2);
  assert.equal(connectorCount(p, 'finish', 'clip'), 1);
});
