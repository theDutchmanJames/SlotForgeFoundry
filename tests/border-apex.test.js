import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import {
  buildTrack,
  defaultTrack,
  validateTrack,
  nativePath,
} from '../src/track.js';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { connectorLayout } from '../src/geometry/connector-layout.js';
import { borderPath, borderWidth } from '../src/geometry/border-profile.js';

const wasm = await init();
wasm.setup();
const base = {
  ...defaultTrack(),
  kind: 'straight',
  length: 200,
  width: 100,
  borderSide: 'both',
  borderSegments: 2,
  borderEntry: 15,
  borderExit: 17,
  apexPosition: 0.38,
  borderApex: 27,
  hollow: false,
};

function build(t, p, plan) {
  const parts = buildTrack(wasm, p, plan);
  t.after(() => parts.forEach((part) => part.solid.delete()));
  return parts;
}

test('independent tapered borders peak at their own stations in exported native and imported STLs', (t) => {
  for (const kind of ['straight', 'import']) {
    const plan =
      kind === 'import'
        ? {
            lanes: [
              [
                [-100, 0],
                [100, 0],
              ],
            ],
          }
        : undefined;
    const p = {
      ...base,
      kind,
      innerApexPosition: 0.27,
      innerApexWidth: 42,
      outerApexPosition: 0.73,
      outerApexWidth: 31,
    };
    const sides = build(t, p, plan);
    for (const [side, sign, segment, fraction, width] of [
      ['inner', -1, 1, 0.27, 42],
      ['outer', 1, 2, 0.73, 31],
    ]) {
      const mesh = parseSTL(
        wasm,
        encodeSTL(
          sides.find((part) => part.id === 'border-' + side + '-' + segment)
            .solid,
        ),
      );
      t.after(() => mesh.delete());
      const y = sign * (50 + width);
      const x = 200 * (fraction - 0.5);
      const hit = (dy) =>
        mesh.rayCast([x, y + sign * dy, 15], [x, y + sign * dy, -1]).length > 0;
      assert.ok(hit(-0.02), kind + ' ' + side + ' measured apex');
      assert.equal(hit(0.02), false, 'STL has the configured apex width');
    }
  }
});

test('changing one side of a painted bend preserves the opposite printable mesh and markings', (t) => {
  const p = {
    ...base,
    kind: 'curve',
    angle: 40,
    kerbEdge: 'free',
    kerbGroove: true,
  };
  const baseline = build(t, p);
  const next = build(t, { ...p, innerApexPosition: 0.817, innerApexWidth: 49 });
  for (const part of baseline.filter((item) =>
    item.id.startsWith('border-outer'),
  )) {
    const after = next.find((item) => item.id === part.id);
    assert.deepEqual(encodeSTL(after.solid), encodeSTL(part.solid));
    assert.deepEqual(after.kerbMarkings, part.kerbMarkings);
  }
  assert.notDeepEqual(
    encodeSTL(next.find((item) => item.id === 'border-inner-2').solid),
    encodeSTL(baseline.find((item) => item.id === 'border-inner-2').solid),
  );
});

test('legacy values apply to either border until its own apex changes', () => {
  const p = { ...base, outerApexPosition: 0.71 };
  assert.equal(borderWidth(base, 0.38, 'inner'), 27);
  assert.equal(borderWidth(p, 0.38, 'inner'), 27);
  assert.equal(borderWidth(p, 0.71, 'outer'), 27);
  assert.ok(borderWidth(p, 0.38, 'outer') < 27);
  const path = nativePath(p);
  assert.equal(borderPath(path, p, 'inner'), path);
  assert.ok(borderPath(path, p, 'outer').stations.includes(0.71));
  assert.throws(
    () => validateTrack({ ...p, innerApexPosition: 0 }),
    /innerApexPosition/,
  );
  assert.throws(
    () => validateTrack({ ...p, outerApexWidth: Infinity }),
    /outerApexWidth/,
  );
});

test('a wide outside apex refines only its free edge and seats on the same chord as the road', (t) => {
  const p = {
    ...base,
    kind: 'curve',
    radius: 180,
    angle: 80,
    whiteLineRoad: 'both',
    whiteLineBorder: 'both',
    whiteLineGroove: true,
  };
  const widened = { ...p, outerApexWidth: 1800, outerApexPosition: 0.683 };
  const curve = nativePath(widened);
  const outer = borderPath(curve, widened, 'outer');
  assert.ok(outer.stations.length > curve.stations.length);
  const maxRadius = p.radius + p.width / 2 + widened.outerApexWidth;
  const turn = (p.angle * Math.PI) / 180;
  for (let i = 1; i < outer.stations.length; i++) {
    const span = outer.stations[i] - outer.stations[i - 1];
    assert.ok(maxRadius * (1 - Math.cos((span * turn) / 2)) <= 0.0250001);
  }
  const apex = widened.outerApexPosition;
  const next = curve.stations.findIndex((s) => s > apex);
  const a = curve.point(curve.stations[next - 1], p.width / 2);
  const b = curve.point(curve.stations[next], p.width / 2);
  const attached = outer.point(apex, p.width / 2);
  const cross =
    (attached[0] - a[0]) * (b[1] - a[1]) - (attached[1] - a[1]) * (b[0] - a[0]);
  assert.ok(
    Math.abs(cross) < 1e-8,
    'added apex station lies on the existing road chord',
  );
  const free = outer.point(apex, p.width / 2 + widened.outerApexWidth);
  assert.ok(
    Math.abs(Math.hypot(free[0], free[1] + p.radius) - maxRadius) < 1e-7,
  );
  const before = build(t, p),
    after = build(t, widened);
  for (const part of before.filter(
    (item) => !item.id.startsWith('border-outer'),
  )) {
    assert.deepEqual(
      encodeSTL(after.find((item) => item.id === part.id).solid),
      encodeSTL(part.solid),
    );
  }
});

test('connector picker widths and warning targets follow the specific border at its seam', () => {
  const p = {
    ...base,
    innerApexPosition: 0.5,
    innerApexWidth: 9,
    outerApexPosition: 0.75,
    outerApexWidth: 52,
    borderEntry: 35,
    borderExit: 35,
    borderJoint: 'clips',
  };
  const layout = (side) => connectorLayout(p, null, 'end', { side, index: 1 });
  assert.equal(layout('inner').length, 9);
  assert.equal(layout('outer').length, borderWidth(p, 0.5, 'outer'));
  assert.throws(
    () => buildTrack(wasm, p),
    (e) =>
      e.warning?.location === 'Inside border · seam 1' &&
      e.warning.setting.field === 'innerApexWidth',
  );
});
