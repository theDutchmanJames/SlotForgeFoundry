// A rock gallery on a mountain stage: a half tunnel cut into a cliff, the
// rock face on one side of the road and a row of pillars on the other, open
// to the valley, under a flat roof. It stands in runs that fit the plate:
// for each, the pillars print as one flat frame, the rock face flat, its
// rough top rising above the roof, and the roof in two halves across the
// road. x along the road (the cars drive along x), y across it, the valley
// at negative y and the cliff beyond the road, z up.

import { kitShapes } from './kit-shapes.js';
import { wallJoints } from './building-texture.js';
import { archOutline, checkKeys, checkLimits, cutRun, keepParts, partLines, plateRoom } from './drive-through.js';

export const ROCK_GALLERY_DEFAULTS = Object.freeze({
  kind: 'rockgallery',
  length: 200, // along the road
  span: 220, // between the pillars and the rock: the track and its borders
  clearance: 80, // under the roof
  arches: true, // the openings between the pillars arched, or square
});
export const ROCK_GALLERY_LIMITS = Object.freeze({ length: [80, 1000], span: [140, 300], clearance: [60, 110] });
export const ROCK_GALLERY = Object.freeze({
  pillar: 8, // wide along the road
  pillarDepth: 7, // across it
  bay: 46, // about this far apart
  kerb: 5, // the frame's foot, high
  beam: 10, // over the openings
  arch: 8, // the arches' rise
  rock: 5, // the rock face, thick
  cliff: [22, 40], // its top above the roof, lowest and highest
  step: 12, // the rough top's points this far apart
  ledge: [3, 3], // under the roof's back edge: deep, high
  roof: 4,
  edge: [2.4, 3], // a kerb along the valley side of the roof: wide, high
  overhang: 2,
});
const LABELS = { length: 'Length', span: 'Width of the road', clearance: 'Height under the roof' };

export function validateRockGallery(input) {
  const g = { ...ROCK_GALLERY_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  checkKeys(g, ROCK_GALLERY_DEFAULTS, 'rock gallery');
  checkLimits(g, ROCK_GALLERY_LIMITS, LABELS);
  if (typeof g.arches !== 'boolean') throw Error('Choose arched or square openings.');
  return g;
}
/** On the table: [x0, y0, x1, y1], from the roof's edge over the valley to the back of the rock. */
export const rockGalleryFootprint = (g) => [0, -ROCK_GALLERY.pillarDepth - ROCK_GALLERY.overhang, g.length, g.span + ROCK_GALLERY.rock];

// The rough top of the rock, the same at every join: its height at x.
const cliffTop = (g, x) => {
  const R = ROCK_GALLERY;
  const at = (k) => {
    let a = (Math.imul(k + 7919, 2654435761) ^ 0x5bd1e995) >>> 0;
    a = (Math.imul(a ^ (a >>> 15), 2246822519) ^ (a >>> 13)) >>> 0;
    return R.cliff[0] + ((a % 1000) / 1000) * (R.cliff[1] - R.cliff[0]);
  };
  const k = Math.floor(x / R.step),
    f = x / R.step - k;
  return g.clearance + R.roof + at(k) * (1 - f) + at(k + 1) * f;
};

const pieceName = (what, i, n) => what + (n > 1 ? ' ' + (i + 1) + ' of ' + n : '');
export function rockGalleryLayout(input, plate = null) {
  const g = validateRockGallery(input);
  const runs = cutRun(g.length, plateRoom(plate));
  const parts = [];
  runs.forEach((_, i) => {
    const s = runs.length > 1 ? '-' + (i + 1) : '';
    parts.push(
      { id: 'pillars' + s, name: pieceName('Pillars', i, runs.length), role: 'wall' },
      { id: 'rock' + s, name: pieceName('Rock face', i, runs.length), role: 'wall' },
      { id: 'roof-valley' + s, name: pieceName('Roof, valley side', i, runs.length), role: 'roof' },
      { id: 'roof-rock' + s, name: pieceName('Roof, rock side', i, runs.length), role: 'roof' },
    );
  });
  return { building: g, parts };
}

export function buildRockGallery(wasm, input, plate = null) {
  const g = validateRockGallery(input);
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const { box, poly, sweep } = kitShapes(wasm, own);
  const { Manifold, CrossSection } = wasm;
  const R = ROCK_GALLERY;
  const runs = cutRun(g.length, plateRoom(plate));
  const rect = (u0, v0, u1, v1) => poly([[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  const C = g.clearance,
    P = R.pillar,
    pd = R.pillarDepth,
    S = g.span;
  const parts = [];
  try {
    runs.forEach(([a, b], i) => {
      const s = runs.length > 1 ? '-' + (i + 1) : '';
      const n = runs.length;
      // The pillars: half a pillar at each end of the run, so two runs make a whole one where they meet.
      const bays = Math.max(1, Math.round((b - a) / R.bay)),
        bw = (b - a) / bays;
      const holes = [];
      for (let k = 0; k < bays; k++) {
        // A whole pillar at each end of the gallery.
        const u0 = a + k * bw + (k === 0 && a === 0 ? P : P / 2),
          u1 = a + (k + 1) * bw - (k === bays - 1 && b >= g.length - 1e-6 ? P : P / 2),
          top = C - R.beam;
        const rise = Math.min(R.arch, (u1 - u0) / 2);
        holes.push(g.arches ? poly(archOutline(u0, u1, top - rise, rise, R.kerb)) : rect(u0, R.kerb, u1, top));
      }
      const frame = sweep(own(rect(a, 0, b, C).subtract(own(CrossSection.union(holes)))), [1, 0, 0], [0, 0, 1], [0, -pd, 0], [0, 1, 0], 0, pd);
      parts.push({ id: 'pillars' + s, name: pieceName('Pillars', i, n), role: 'wall', solid: frame, outward: [0, -1, 0], apart: [0, -24, 0] });
      // The rock face: its rough top above the roof, its stones on the road's side, a ledge for the roof.
      const pts = [[a, 0], [b, 0], [b, cliffTop(g, b)]];
      for (let x = Math.floor(b / R.step) * R.step; x > a + 1e-6; x -= R.step) if (x < b - 1e-6) pts.push([x, cliffTop(g, x)]);
      pts.push([a, cliffTop(g, a)]);
      let rock = sweep(poly(pts), [1, 0, 0], [0, 0, 1], [0, S, 0], [0, 1, 0], 0, R.rock);
      const top = Math.max(...pts.map((q) => q[1]));
      const joints = wallJoints(wasm, own, 'gallery-rock-' + i, { length: b - a, bottom: 0, top, frame: { a: [a, S], dir: [1, 0], inward: [0, 1] }, ceil: top }, [[0, C - R.ledge[1] - 0.5, b - a, C + R.roof + 0.5]], { textureScale: 170, textureJoint: 0.8, textureDepth: 0.8 }, 'stone');
      if (joints) rock = own(rock.subtract(joints));
      rock = own(Manifold.union([rock, box(a, S - R.ledge[0], C - R.ledge[1], b, S + 0.01, C)]));
      parts.push({ id: 'rock' + s, name: pieceName('Rock face', i, n), role: 'wall', solid: rock, outward: [0, -1, 0], apart: [0, 24, 0] });
      // The roof, in two across the road, on the pillars and the ledge; a kerb along its valley edge.
      const o = R.overhang,
        mid = S / 2;
      const valley = own(Manifold.union([box(a, -pd - o, C, b, mid, C + R.roof), box(a, -pd - o, C + R.roof - 0.01, b, -pd - o + R.edge[0], C + R.roof + R.edge[1])]));
      parts.push({ id: 'roof-valley' + s, name: pieceName('Roof, valley side', i, n), role: 'roof', solid: valley, lie: [0, 0, 0], apart: [0, -12, 30] });
      parts.push({ id: 'roof-rock' + s, name: pieceName('Roof, rock side', i, n), role: 'roof', solid: box(a, mid, C, b, S, C + R.roof), lie: [0, 0, 0], apart: [0, 12, 30] });
    });
    return keepParts(temp, parts);
  } catch (e) {
    for (const x of temp) x.delete();
    throw e;
  }
}

export function rockGalleryNotes(name, g, parts, sizes, fmt) {
  return [
    name + ' · SlotForge Foundry rock gallery kit',
    '',
    'A rock gallery ' + fmt(g.length) + ' mm long over a road ' + fmt(g.span) + ' mm wide, ' + fmt(g.clearance) + ' mm high under its roof: the rock face on one side, a row of pillars' + (g.arches ? ' and arches' : '') + ' open to the valley on the other.',
    '',
    'Parts, as they lie on the plate:',
    partLines(parts, sizes, fmt),
    '',
    'Printing',
    '- Every part prints without supports. The pillars and the rock face lie flat, their faces to the road up; the roof lies flat.',
    '',
    'Putting it together',
    '1. Stand the rock face along the far side of the track and the pillars along the near side, each run end to end with the next.',
    '2. Lay the roof on them, the rock side on the ledge along the rock face, the valley side on the pillars, its kerb to the valley.',
    'Paint the rock grey and brown, the pillars and the roof concrete grey; scatter loose stones and earth on the roof.',
  ].join('\n');
}
