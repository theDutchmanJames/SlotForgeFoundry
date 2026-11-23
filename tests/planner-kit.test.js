import test from 'node:test';
import assert from 'node:assert/strict';
import { printGroups } from '../src/planner-kit.js';

// An STL is an 80-byte header, a count and the triangles. Only the triangles
// say whether two parts are the same print.
const stl = (label, body) => {
  const bytes = new Uint8Array(80 + body.length);
  bytes.set(new TextEncoder().encode(label).slice(0, 80));
  bytes.set(body, 80);
  return bytes;
};
const road = (label) => stl(label, [1, 2, 3, 4]);
const key = (label) => stl(label, [9, 9, 9]);

test('the print kit holds every different part once, with its count in the name', () => {
  const groups = printGroups([
    { piece: 'R2 corner', part: 'Road 1', role: 'road', mirror: false, count: 24, bytes: road('R2 corner road 1') },
    { piece: 'R2 corner', part: 'Road 1', role: 'road', mirror: true, count: 12, bytes: road('R2 corner road 1') },
    { piece: 'R2 corner', part: 'Dovetail key', role: 'clip', mirror: false, count: 72, bytes: key('a') },
    { piece: 'Full straight', part: 'Dovetail key', role: 'clip', mirror: false, count: 40, bytes: key('b') },
    { piece: 'Full straight', part: 'Road 1', role: 'road', mirror: false, count: 6, bytes: stl('x', [5, 6, 7, 8]) },
  ]);
  const byFile = Object.fromEntries(groups.map((g) => [g.file, g]));
  assert.deepEqual(Object.keys(byFile).sort(), [
    'hardware/Dovetail-key-x112.stl',
    'track/Full-straight-Road-1-x6.stl',
    'track/R2-corner-Road-1-mirrored-x12.stl',
    'track/R2-corner-Road-1-x24.stl',
  ]);
  assert.equal(byFile['hardware/Dovetail-key-x112.stl'].usedIn, 'R2 corner; Full straight');
  assert.equal(groups.reduce((n, g) => n + g.count, 0), 24 + 12 + 72 + 40 + 6);
});

test('two different parts with the same name get their own files', () => {
  const groups = printGroups([
    { piece: 'Chicane', part: 'Road 1', role: 'road', mirror: false, count: 1, bytes: road('a') },
    { piece: 'Chicane', part: 'Road 1', role: 'road', mirror: false, count: 1, bytes: stl('b', [7, 7, 7, 7]) },
  ]);
  assert.deepEqual(groups.map((g) => g.file), ['track/Chicane-Road-1-x1.stl', 'track/Chicane-Road-1-2-x1.stl']);
});

test('a piece name too long for a file gives up its middle, never its edge or its part', () => {
  const left = 'Full straight slots 25/80/135/190/245/300/355/410-30/85/140/195/250/305/360/415 from left';
  const right = 'Full straight slots 25/80/135/190/245/300/355/410-30/85/140/195/250/305/360/420 from right';
  const groups = printGroups([
    { piece: left, part: 'Road 1', role: 'road', mirror: false, count: 1, bytes: road('a') },
    { piece: right, part: 'Road 1', role: 'road', mirror: false, count: 1, bytes: stl('b', [7, 7, 7, 7]) },
    { piece: left, part: 'Outside border 2', role: 'border', mirror: true, count: 1, bytes: stl('c', [8, 8]) },
  ]);
  assert.deepEqual(groups.map((g) => g.file), [
    'track/Full-straight-slots-25_80_135_190_2...5_140_195_250_305_360_415-from-left-Road-1-x1.stl',
    'track/Full-straight-slots-25_80_135_190_2..._140_195_250_305_360_420-from-right-Road-1-x1.stl',
    'borders/Full-straight-slots-25_80_135_..._195_250_305_360_415-from-left-Outside-border-2-mirrored-x1.stl',
  ]);
  for (const g of groups) assert.ok(g.file.split('/')[1].replace(/(-mirrored)?-x1\.stl$/, '').length <= 80, g.file);
  // The full name stays in the label.
  assert.equal(groups[0].label, left + ' · Road 1');
  // Names that fit are left as they were.
  const short = printGroups([
    { piece: 'Straight slots 35/135 from left', part: 'Road 1', role: 'road', mirror: false, count: 2, bytes: road('d') },
  ]);
  assert.deepEqual(short.map((g) => g.file), ['track/Straight-slots-35_135-from-left-Road-1-x2.stl']);
});

import { kitPieceNames } from '../src/planner-kit.js';
test('pieces that share a name are told apart by their slot position, and only then', () => {
  const piece = (name, slotPosition) => ({ name, track: { params: { slotPosition } } });
  const slot = (startMm, endMm = startMm) => ({ version: 1, edge: 'outer', startMm, endMm });
  assert.deepEqual(
    kitPieceNames({
      s1: piece('Straight'),
      s2: piece('Straight', slot(35)),
      s3: piece('Straight', slot(35, 145.5)),
      s4: piece('Corner', slot(35)),
      s5: piece('Corner', slot(35)),
      s6: piece('Chicane'),
      // A piece and its mirror image: same distance, other edge.
      s7: piece('Bend', slot(35)),
      s8: piece('Bend', { ...slot(35), edge: 'inner' }),
    }),
    {
      s1: 'Straight',
      s2: 'Straight slot 35 from left',
      s3: 'Straight slot 35-145.5 from left',
      s4: 'Corner',
      s5: 'Corner',
      s6: 'Chicane',
      s7: 'Bend slot 35 from left',
      s8: 'Bend slot 35 from right',
    },
  );
});

import { stlVolume, laneLengths, shoppingList } from '../src/planner-kit.js';
function cubeStl(size) {
  const v = [[0,0,0],[size,0,0],[size,size,0],[0,size,0],[0,0,size],[size,0,size],[size,size,size],[0,size,size]];
  const faces = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const bytes = new Uint8Array(84 + 50 * faces.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, faces.length, true);
  faces.forEach((f, i) => f.forEach((k, j) => v[k].forEach((c, n) => view.setFloat32(84 + i * 50 + 12 + j * 12 + n * 4, c, true))));
  return bytes;
}
test('STL volume of a closed cube', () => {
  assert.ok(Math.abs(stlVolume(cubeStl(10)) - 1000) < 1e-6);
});
test('lane lengths keep lane 1 on the same side for mirrored pieces', () => {
  const a = [[0, 0], [100, 0]], b = [[0, 0], [300, 0]];
  assert.deepEqual(laneLengths([{ lanes: [a, b] }, { lanes: [a, b], flip: true }]), [400, 400]);
});
test('shopping list gives weight, spools and braid per lane', () => {
  const text = shoppingList({
    name: 'Test',
    groups: [{ count: 10, volume: 100000 }],
    lanes: [1000, 2000],
    settings: { infill: 50, spoolPrice: 20, braidSpare: 50 },
    material: { name: 'PLA', density: 1.24 },
  });
  assert.match(text, /Estimated weight: 0\.62 kg at 50 % fill/);
  assert.match(text, /Spools of 1 kg: 1/);
  assert.match(text, /Lane 1: slot 1\.00 m → braid 2\.10 m/);
  assert.match(text, /Lane 2: slot 2\.00 m → braid 4\.10 m/);
  assert.match(text, /Total braid: 6\.20 m/);
  assert.match(text, /Filament cost: about 12\.40/);
});
