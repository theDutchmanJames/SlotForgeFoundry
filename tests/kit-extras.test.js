// A kit's extras: its parts as one 3MF on plates, its footprint on A4 sheets,
// and the fit test that finds the joint clearance.
import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { unzipSync, strFromU8 } from 'fflate';
import { buildGarage, buildingLayout, printPose, validateBuilding } from '../src/geometry/building.js';
import { encodeSTL } from '../src/editor.js';
import { footprintSheets, kit3mf, packParts, stlMesh, SHEET } from '../src/kit-extras.js';
import { fitClearances } from '../src/geometry/fit-test.js';
import { footprint } from '../src/planner-buildings.js';
import { kitNotes } from '../src/building-kit.js';
import { checkKit } from './print-checks.js';

const wasm = await Module();
wasm.setup();
const PLATE = { width: 200, depth: 200, margin: 0 };
const kitOf = (b) => {
  const parts = buildGarage(wasm, b, PLATE);
  try {
    return parts.map((p) => {
      const printed = printPose(p);
      try {
        return { name: p.name, bytes: encodeSTL(printed, p.name), volume: printed.volume() };
      } finally {
        printed.delete();
      }
    });
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
};
const volumeOf = ({ verts, tris }) => tris.reduce((v, [a, b, c]) => {
  const [p, q, r] = [verts[a], verts[b], verts[c]];
  return v + (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6;
}, 0);

test('an STL read back: the same solid, its corners welded', () => {
  for (const f of kitOf({ door: 'none' })) {
    const mesh = stlMesh(f.bytes);
    assert.ok(Math.abs(volumeOf(mesh) - f.volume) < 0.01 * f.volume + 0.01, f.name + ' volume');
    assert.ok(mesh.verts.length < mesh.tris.length, f.name + ' welded');
  }
});

test('parts packed on plates: none over the edge, none on another, every part placed', () => {
  const files = kitOf({ door: 'none', upper: [{ height: 60 }], roof: 'gable' });
  const parts = files.map((f) => ({ name: f.name, mesh: stlMesh(f.bytes) }));
  const placed = packParts(parts, PLATE);
  assert.equal(placed.filter(Boolean).length, parts.length);
  for (const q of placed) assert.ok(q.x + q.size[0] <= 200 + 1e-6 && q.y + q.size[1] <= 200 + 1e-6, q.part.name + ' on its plate');
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++) {
      const [a, b] = [placed[i], placed[j]];
      if (a.plate !== b.plate) continue;
      const apart = a.x + a.size[0] <= b.x || b.x + b.size[0] <= a.x || a.y + a.size[1] <= b.y || b.y + b.size[1] <= a.y;
      assert.ok(apart, a.part.name + ' and ' + b.part.name + ' overlap on plate ' + (a.plate + 1));
    }
  assert.ok(Math.max(...placed.map((q) => q.plate)) >= 1, 'a kit this big takes more than one plate');
});

test('the kit as a 3MF: a model of millimetres, an object for each part, each placed', () => {
  const files = kitOf({ door: 'none', roof: 'hip', width: 120, depth: 150 });
  const { bytes, plates } = kit3mf('Hut & co', files.map((f) => ({ name: f.name, mesh: stlMesh(f.bytes) })), PLATE);
  const zip = unzipSync(bytes);
  assert.deepEqual(Object.keys(zip).sort(), ['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
  const model = strFromU8(zip['3D/3dmodel.model']);
  assert.match(model, /<model unit="millimeter"/);
  assert.match(model, /<metadata name="Title">Hut &amp; co<\/metadata>/);
  assert.equal((model.match(/<object /g) ?? []).length, files.length);
  assert.equal((model.match(/<item /g) ?? []).length, files.length);
  assert.ok(plates >= 1);
  // Every triangle names corners that are there.
  for (const obj of model.split('<object ').slice(1)) {
    const n = (obj.match(/<vertex /g) ?? []).length;
    const most = Math.max(...[...obj.matchAll(/v[123]="(\d+)"/g)].map((m) => Number(m[1])));
    assert.ok(most < n);
  }
});

test('the footprint on A4 sheets: enough of them, each with its crosses, at full size', () => {
  const small = footprintSheets('Hut', footprint({ building: validateBuilding({ width: 120, depth: 100 }), pose: { x: 0, y: 0, a: 0 } }));
  assert.equal(small.length, 1);
  assert.match(small[0].svg, /width="210mm" height="297mm" viewBox="0 0 210 297"/);
  assert.match(small[0].svg, /sheet 1 of 1/);
  assert.match(small[0].svg, /10 mm/);
  const big = footprintSheets('Pits', footprint({ building: validateBuilding({ width: 450, depth: 200 }), pose: { x: 0, y: 0, a: 0 } }));
  const across = Math.ceil((450 + 2 * 3 + 20 - SHEET.overlap) / (SHEET.width - 2 * SHEET.margin - SHEET.overlap));
  assert.ok(big.length >= across, big.length + ' sheets for 470 mm');
  for (const s of big) assert.equal((s.svg.match(/<path d="M/g) ?? []).length, 1 + 4 + 1, 'the scale bar, four corner crosses and the middle');
});

test('the fit test: three grooves round the clearance, a wall strip, printing clean, with its notes', () => {
  assert.deepEqual(fitClearances({ play: 0.2 }), [0.1, 0.2, 0.3]);
  assert.deepEqual(fitClearances({ play: 0.1 }), [0.05, 0.1, 0.2]);
  const parts = buildGarage(wasm, { kind: 'fittest', play: 0.25 }, PLATE);
  try {
    checkKit(parts, PLATE, 'fit test: ');
    // The block lost three grooves: deeper as they widen.
    assert.equal(parts.length, 2);
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
  const b = validateBuilding({ kind: 'fittest', play: 0.25 });
  const notes = kitNotes('Fit test', b, buildingLayout(b).parts, {});
  assert.match(notes, /a clearance of 0.15, 0.25 and 0.35 mm each side/);
  assert.match(notes, /Set Joint clearance on your buildings to that number/);
  assert.throws(() => validateBuilding({ kind: 'fittest', play: 0.6 }), /0.1 to 0.5 mm/);
});
