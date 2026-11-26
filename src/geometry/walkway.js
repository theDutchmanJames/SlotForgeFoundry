// A walkway bridge between two buildings: a covered, glazed walkway, open at
// its ends where it meets them. A deck with a groove along each edge, a side
// wall standing in each with a band of windows in panes, a roof on top with a
// rail under it inside each wall; on legs at its ends, or resting on the
// buildings. Every part prints flat: the deck the right way up, its grooves
// open on top; the walls outside up; the roof upside down, its rails up; the
// legs stand on their feet. x along it, y
// across (its front side at y = 0), z up.

import { kitShapes } from './kit-shapes.js';
import { buildGarage, buildingLayout as layoutOf, validateBuilding } from './building.js';

export const WALKWAY_DEFAULTS = Object.freeze({
  kind: 'walkway',
  length: 150, // between the buildings it joins
  width: 32, // outside its walls
  height: 30, // its walls, above the deck
  clearance: 70, // the top of the deck above the table: as high as the floor it joins
  waist: 8, // the wall under the windows
  panes: 4, // along each side
  legs: true, // on legs at its ends, or resting on the buildings
  // A tower at each end, the walkway between them through a doorway in
  // each: its size (along the walkway and across it), its walls' height,
  // its roof ('flat' or 'hip': a pyramid on a square tower), a window in its
  // front and back.
  towers: false,
  towerWidth: 60,
  towerDepth: 60,
  towerHeight: 110,
  towerRoof: 'hip',
  towerWindows: true, // windows up the front and back of each tower, one above the other
  // A control cab on top of a tower: a band of glazing leaning out, an open
  // terrace over it under the roof. 'none', 'left', 'right' or 'both'.
  towerCab: 'none',
});
export const WALKWAY_LIMITS = Object.freeze({
  length: [40, 180],
  width: [20, 60],
  height: [20, 60],
  clearance: [20, 250],
  waist: [4, 30],
  panes: [1, 12],
  towerWidth: [60, 120],
  towerDepth: [60, 120],
  towerHeight: [40, 200],
});
export const WALKWAY = Object.freeze({
  wall: 3,
  deck: 4,
  ledge: 2, // the deck and the roof past the walls
  groove: 1.5,
  play: 0.2,
  roof: 3,
  rail: [2, 3], // under the roof inside each wall: wide, deep
  beam: 5, // the wall over the windows
  end: 4, // and at each end of it
  mullion: 3,
  leg: 8,
  foot: [3, 2],
  pair: 36, // at least this wide for two legs at each end
  pin: [4, 1.5],
  cab: { height: 30, waist: 8, panes: 3, lean: 20, terrace: 34, parapet: 14, overhang: 8 }, // a control cab on a tower
  window: { width: 16, height: 22, pitch: 40, top: 40 }, // the windows up a tower: one every pitch, the highest top below its top
});
const LABELS = { length: 'Length', width: 'Width', height: 'Wall height', clearance: 'Height above the table', waist: 'Wall under the windows', panes: 'Panes', towerWidth: 'Tower width', towerDepth: 'Tower depth', towerHeight: 'Tower height' };

/** The walkway as kept: known settings only, each checked. */
export function validateWalkway(input) {
  const w = { ...WALKWAY_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(w)) if (!Object.hasOwn(WALKWAY_DEFAULTS, key)) throw Error('The walkway has an unknown setting: ' + key + '.');
  for (const [key, [min, max]] of Object.entries(WALKWAY_LIMITS))
    if (!Number.isFinite(w[key]) || w[key] < min || w[key] > max) throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + (key === 'panes' ? '' : ' mm') + '.');
  if (!Number.isInteger(w.panes)) throw Error('Panes are a whole number.');
  if (typeof w.legs !== 'boolean') throw Error('Choose whether the walkway stands on legs.');
  for (const key of ['towers', 'towerWindows']) if (typeof w[key] !== 'boolean') throw Error('Choose whether the walkway has ' + (key === 'towers' ? 'towers' : 'tower windows') + '.');
  if (!['flat', 'hip'].includes(w.towerRoof)) throw Error('Choose a flat or a pyramid roof for the towers.');
  if (!['none', 'left', 'right', 'both'].includes(w.towerCab)) throw Error('Choose which tower has a control cab on top.');
  if (w.towerCab !== 'none' && !w.towers) throw Error('A control cab stands on a tower: choose towers too.');
  if (w.towers) {
    if (w.towerDepth < w.width + 10) throw Error('A tower must be at least ' + (w.width + 10) + ' mm deep: 5 mm wider than the walkway each side.');
    const need = w.clearance + w.height + 8;
    if (w.towerHeight < need) throw Error('The towers must be at least ' + need + ' mm high: over the walkway joining them.');
    // Each tower is a building: checked as one.
    for (const t of towerBuildings(w)) validateBuilding(t.building);
  }
  if (w.waist + WALKWAY.beam + 8 > w.height) throw Error('The windows need at least 8 mm: the wall under them can be at most ' + (w.height - WALKWAY.beam - 8) + ' mm.');
  const pane = (w.length - 2 * WALKWAY.end - (w.panes - 1) * WALKWAY.mullion) / w.panes;
  if (pane < 6) throw Error('Too many panes for a walkway ' + w.length + ' mm long.');
  return w;
}

const legCount = (w) => (w.width >= WALKWAY.pair ? 4 : 2);
/** The parts of a walkway, without geometry. */
export function walkwayLayout(input) {
  const w = validateWalkway(input);
  const parts = [
    ...(w.towers ? towerBuildings(w).flatMap((t) => buildingPartsOf(t)) : []),
    { id: 'deck', name: 'Deck', role: 'floor' },
    { id: 'side-front', name: 'Side, front', role: 'wall' },
    { id: 'side-back', name: 'Side, back', role: 'wall' },
    { id: 'roof', name: 'Roof', role: 'roof' },
  ];
  if (w.legs && !w.towers) for (let i = 0; i < legCount(w); i++) parts.push({ id: 'leg-' + (i + 1), name: 'Leg ' + (i + 1), role: 'frame' });
  return { building: w, parts };
}

/** The walkway on the table, from its own origin: [x0, y0, x1, y1]. */
export function walkwayFootprint(w) {
  const e = WALKWAY.ledge;
  if (!w.towers) return [0, -e, w.length, w.width + e];
  const m = 3,
    y0 = (w.width - w.towerDepth) / 2;
  return [-w.towerWidth - m, Math.min(-e, y0 - m), w.length + w.towerWidth + m, Math.max(w.width + e, y0 + w.towerDepth + m)];
}

/**
 * The towers at the ends: each a building of its own, placed against an end
 * of the walkway, a doorway in its wall facing it as wide and high as the
 * walkway inside, at the height of its deck.
 */
export function towerBuildings(w) {
  const base = 4;
  const doorway = { type: 'window', at: w.towerDepth / 2, width: w.width - 2 * WALKWAY.wall - 2, height: w.height - 2, sill: w.clearance - base, frame: false };
  // Windows up the front and back, one above the other, the highest near the top.
  const W = WALKWAY.window,
    sills = [];
  for (let z = w.towerHeight - W.top; z >= 15; z -= W.pitch) sills.unshift(z);
  const windows = w.towerWindows ? ['front', 'back'].flatMap((wall) => sills.map((sill) => ({ wall, type: 'window', at: w.towerWidth / 2, width: W.width, height: W.height, sill, frame: false }))) : [];
  // On a tower with a cab: the glazing leaning out, the terrace over it.
  const C = WALKWAY.cab;
  const cabbed = (key) => w.towerCab === 'both' || w.towerCab === key;
  const cab = (key) =>
    cabbed(key)
      ? {
          upper: [
            { width: w.towerWidth, depth: w.towerDepth, x: 0, y: 0, height: C.height, open: true, waist: C.waist, panes: C.panes, lean: C.lean },
            { width: w.towerWidth, depth: w.towerDepth, x: 0, y: 0, height: C.terrace, open: true, waist: C.parapet, panes: 1 },
          ],
          overhangFront: C.overhang,
          overhangBack: C.overhang,
          overhangLeft: C.overhang,
          overhangRight: C.overhang,
        }
      : {};
  const tower = (inner, key) => ({
    width: w.towerWidth,
    depth: w.towerDepth,
    height: w.towerHeight,
    baseHeight: base,
    door: 'none',
    roof: w.towerRoof,
    pitch: 30,
    overhangFront: 3,
    overhangBack: 3,
    overhangLeft: 3,
    overhangRight: 3,
    openings: [{ ...doorway, wall: inner }, ...windows],
    ...cab(key),
  });
  const y = (w.width - w.towerDepth) / 2;
  return [
    { key: 'tower1', name: 'Left tower', at: [-w.towerWidth, y], building: tower('right', 'left'), apart: [-30, 0, 0] },
    { key: 'tower2', name: 'Right tower', at: [w.length, y], building: tower('left', 'right'), apart: [30, 0, 0] },
  ];
}
// A tower's parts, named for the tower.
function buildingPartsOf(t) {
  return layoutOf(t.building).parts.map((p) => ({ id: t.key + '-' + p.id, name: t.name + ': ' + p.name.charAt(0).toLowerCase() + p.name.slice(1), role: p.role }));
}

// Where the legs stand under the deck, near the ends: two at each end inside the walls, or one in the middle.
function legSpots(w) {
  const g = WALKWAY.leg / 2,
    t = WALKWAY.wall;
  const xs = [WALKWAY.end + g, w.length - WALKWAY.end - g],
    ys = legCount(w) === 4 ? [t + 2 + g, w.width - t - 2 - g] : [w.width / 2];
  return xs.flatMap((x) => ys.map((y) => [x, y]));
}

/** The walkway, built where it stands. */
export function buildWalkway(wasm, input) {
  const { Manifold } = wasm;
  const w = validateWalkway(input);
  const temp = [];
  const own = (x) => (temp.push(x), x);
  const { box } = kitShapes(wasm, own);
  const minus = (a, ...cuts) => (cuts.length ? own(a.subtract(own(Manifold.union(cuts)))) : a);
  const { wall: t, deck: dk, ledge: e, groove: g, play: c, roof: rt, beam, end, mullion, leg, foot: [ft, pad], pin: [pw, ph] } = WALKWAY;
  const L = w.length,
    W = w.width,
    z0 = w.clearance,
    zTop = z0 + w.height;
  const parts = [];
  try {
    // The deck: a groove along each edge for a wall, pockets under it for the legs' pins.
    const grooves = [box(-1, -c, z0 - g, L + 1, t + c, z0 + 1), box(-1, W - t - c, z0 - g, L + 1, W + c, z0 + 1)];
    const pockets = w.legs ? legSpots(w).map(([x, y]) => box(x - pw / 2 - 0.15, y - pw / 2 - 0.15, z0 - dk - 0.01, x + pw / 2 + 0.15, y + pw / 2 + 0.15, z0 - dk + ph + 0.2)) : [];
    parts.push({ id: 'deck', name: 'Deck', role: 'floor', solid: minus(box(0, -e, z0 - dk, L, W + e, z0), ...grooves, ...pockets), lie: [0, 0, 0], apart: [0, 0, 0] });
    // The sides: from the bottom of the groove to the roof, a band of windows in panes.
    const pane = (L - 2 * end - (w.panes - 1) * mullion) / w.panes;
    for (const [id, name, y0, out] of [['side-front', 'Side, front', 0, [0, -1, 0]], ['side-back', 'Side, back', W - t, [0, 1, 0]]]) {
      const windows = Array.from({ length: w.panes }, (_, k) => {
        const x0 = end + k * (pane + mullion);
        return box(x0, y0 - 1, z0 + w.waist, x0 + pane, y0 + t + 1, zTop - beam);
      });
      parts.push({ id, name, role: 'wall', solid: minus(box(0, y0, z0 - g, L, y0 + t, zTop), ...windows), outward: out, apart: [0, out[1] * 15, 8] });
    }
    // The roof: a plate over the walls, a rail under it just inside each, holding them apart.
    const [rw, rd] = WALKWAY.rail;
    const roof = own(Manifold.union([box(0, -e, zTop, L, W + e, zTop + rt), box(end, t + c, zTop - rd, L - end, t + c + rw, zTop + 0.01), box(end, W - t - c - rw, zTop - rd, L - end, W - t - c, zTop + 0.01)]));
    parts.push({ id: 'roof', name: 'Roof', role: 'roof', solid: roof, flip: true, apart: [0, 0, 20] });
    // The legs: from the table to the deck's underside, a pin up into it.
    if (w.legs && !w.towers) {
      const h = z0 - dk;
      legSpots(w).forEach(([x, y], i) => {
        const g2 = leg / 2;
        const solid = own(Manifold.union([box(x - g2 - pad, y - g2 - pad, 0, x + g2 + pad, y + g2 + pad, ft), box(x - g2, y - g2, ft - 0.01, x + g2, y + g2, h), box(x - pw / 2, y - pw / 2, h - 0.01, x + pw / 2, y + pw / 2, h + ph)]));
        parts.push({ id: 'leg-' + (i + 1), name: 'Leg ' + (i + 1), role: 'frame', solid, lie: [0, 0, 0], apart: [0, 0, -10] });
      });
    }
    // The towers: built as buildings, moved to the ends, their parts named for them.
    const towerParts = [];
    if (w.towers)
      for (const t of towerBuildings(w)) {
        const made = buildGarage(wasm, t.building);
        for (const p of made) {
          const moved = own(p.solid.translate([t.at[0], t.at[1], 0]));
          p.solid.delete();
          towerParts.push({ ...p, id: t.key + '-' + p.id, name: t.name + ': ' + p.name.charAt(0).toLowerCase() + p.name.slice(1), solid: moved, apart: (p.apart ?? [0, 0, 0]).map((v, i) => v + t.apart[i]) });
        }
      }
    parts.unshift(...towerParts);
    const keep = new Set(parts.map((p) => p.solid));
    for (const x of new Set(temp)) if (!keep.has(x)) x.delete();
    return parts;
  } catch (err) {
    for (const x of new Set(temp)) x.delete();
    throw err;
  }
}
