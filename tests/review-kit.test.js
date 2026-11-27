// Kit notes and kit file names, as found in review: a roofless or open-sided
// building, a sawtooth on a shaped footprint, an up-and-over door, and part
// names that are no good as file names.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildingLayout, validateBuilding } from '../src/geometry/building.js';
import { validateFootprint } from '../src/geometry/footprint-building.js';
import { BUILDING_PRESETS } from '../src/building-presets.js';
import { fileSafe, kitNotes, kitStlName } from '../src/building-kit.js';

const notesOf = (b, name = 'Test') => kitNotes(name, b, buildingLayout(b).parts, {});
const section = (notes, title) => notes.split('\n' + title + '\n')[1].split('\n\n')[0];

test('a building with its roof left out has no roof to print or glue', () => {
  const b = validateBuilding(BUILDING_PRESETS.find((p) => p.id === 'ruined-townhouse').building);
  assert.ok(b.leaveOut.includes('roof'));
  const notes = notesOf(b, 'Ruined townhouse');
  assert.doesNotMatch(notes, /Lay the roof|Drop the roof|roof panel|The roof prints|The roof\b.*right way up/);
  assert.match(notes, /open to the sky/);
  // Its floors and their frames still print the right way up.
  assert.match(section(notes, 'Printing'), /The floors and their frames print the right way up/);
  assert.match(notes, /Stand the four walls of the ground floor/);
});

test('walls left out are neither counted nor named in the kit', () => {
  const b = validateBuilding({ width: 120, depth: 180, height: 75, door: 'none', leaveOut: ['front', 'left'] });
  const notes = notesOf(b);
  assert.match(notes, /Stand the two walls, the back and right, in the groove of the base\./);
  assert.match(notes, /the front and left walls are left out/);
  assert.doesNotMatch(notes, /four walls|garage door opening/);
  // The back and right still meet at a corner.
  assert.match(notes, /mitred corners meet/);
  // Opposite walls only: no corner to glue.
  const two = notesOf(validateBuilding({ width: 120, depth: 180, height: 75, door: 'none', leaveOut: ['front', 'back'] }));
  assert.doesNotMatch(two, /mitred corners meet/);
  assert.match(two, /Glue the walls into the groove\./);
  const one = notesOf(validateBuilding({ width: 120, depth: 180, height: 75, door: 'none', leaveOut: ['front', 'back', 'left'] }));
  assert.match(one, /Stand the right wall in the groove/);
  assert.match(one, /Glue the wall into the groove\./);
  assert.match(one, /It has one wall, the right; the front, back and left walls are left out\./);
});

test('a whole building still has its roof step', () => {
  const notes = notesOf(validateBuilding({ width: 120, depth: 180, height: 75 }));
  assert.match(notes, /Stand the four walls in the groove/);
  assert.match(notes, /roof on the walls|Drop the roof on/);
  assert.doesNotMatch(notes, /left out|open to the sky/);
});

test('an up-and-over door has a step saying where it goes', () => {
  const b = validateBuilding({ width: 120, depth: 180, height: 75, door: 'panel' });
  assert.ok(buildingLayout(b).parts.some((p) => p.id === 'door' && /Up-and-over/.test(p.name)));
  assert.match(notesOf(b), /Glue the up-and-over door behind its opening, standing on the floor of the base, its panelled face out/);
  const two = validateBuilding({ width: 200, depth: 180, height: 75, door: 'panel', doorWidth: 70, rooms: { along: 'width', sizes: [100, 100] } });
  assert.match(notesOf(two), /Glue each up-and-over door behind its opening, standing on the floor of its room/);
  assert.doesNotMatch(notesOf(b), /roller door/);
});

test('a sawtooth on a shaped footprint is teeth and north lights, not a flat roof', () => {
  const b = validateFootprint({ kind: 'footprint', shape: 'rectangle', width: 220, depth: 180, roofShape: 'sawtooth', teeth: 3, pitch: 25 });
  const parts = buildingLayout(b).parts;
  assert.deepEqual(parts.filter((p) => /^(roof|light)-/.test(p.id)).map((p) => p.id), ['roof-1', 'light-1', 'roof-2', 'light-2', 'roof-3']);
  const notes = kitNotes('Saw', b, parts, {});
  assert.doesNotMatch(notes, /Assemble the roof flat|the roof flat/);
  assert.match(notes, /A sawtooth roof of 3 teeth at 25°/);
  assert.match(notes, /each roof tooth flat on its underside, each north light flat, its glazed face up/);
  assert.match(notes, /Lay the roof teeth on the walls in order from the front, tooth 1 first/);
  assert.match(notes, /Stand each north light upright between its tooth and the next/);
  // One tooth: no north lights.
  const one = validateFootprint({ ...b, teeth: 1 });
  const oneNotes = kitNotes('Saw', one, buildingLayout(one).parts, {});
  assert.doesNotMatch(oneNotes, /north light/i);
  assert.match(oneNotes, /Lay the roof tooth on the walls/);
});

test('every part of a kit has a file name that unzips on Windows', () => {
  const bad = /[\\/:*?"<>|]|[. ]\.stl$/;
  assert.equal(kitStlName(0, 'Left tower: base plate'), '01 Left tower- base plate.stl');
  assert.equal(kitStlName(11, 'A "sign" / board? <1> | *. '), '12 A -sign- - board- -1- - -.stl');
  assert.equal(kitStlName(2, '...'), '03 Part.stl');
  assert.equal(fileSafe('My: shed. '), 'My- shed');
  assert.equal(fileSafe(''), 'Building');
  // The walkway with its towers, whose parts are named "Left tower: …".
  const w = validateBuilding({ kind: 'walkway', towers: true });
  const names = buildingLayout(w).parts.map((p, i) => kitStlName(i, p.name));
  assert.ok(buildingLayout(w).parts.some((p) => p.name.includes(':')), 'the walkway has a part named with a colon');
  for (const n of names) assert.doesNotMatch(n.slice(0, -4), bad, n);
  // And every preset's parts.
  for (const p of BUILDING_PRESETS) {
    let b;
    try {
      b = validateBuilding(p.building);
    } catch {
      continue;
    }
    buildingLayout(b).parts.forEach((q, i) => assert.doesNotMatch(kitStlName(i, q.name).slice(0, -4), /[\\/:*?"<>|]|[. ]$/, p.id + ': ' + q.name));
  }
});
