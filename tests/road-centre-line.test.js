import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { buildTrack, defaultTrack, nativeTrackPoint } from '../src/track.js';
import { specialTrackParams } from '../src/special-pieces.js';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { printableSTL } from '../src/kit.js';

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
