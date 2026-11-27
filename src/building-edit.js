// Editing operations shared by the wall canvas and its accessible numeric controls.
import { validateBuilding, OPENING_DEFAULTS, wallLength } from './geometry/building.js';
import { sectionPositions, sectionWalls } from './geometry/connected-building.js';
import { footprintStoreys, storeyWalls } from './geometry/footprint-building.js';

export const editStorey = (b, level) => b.kind === 'sections' ? b.sections[level] : level ? b.upper[level - 1] : b;
export const patchStorey = (b, level, patch) => b.kind === 'sections' ? { ...b, sections: b.sections.map((s,i) => i === level ? { ...s, ...patch } : s) } : level ? { ...b, upper: b.upper.map((s, i) => i === level - 1 ? { ...s, ...patch } : s) } : { ...b, ...patch };
export function editWalls(b, level = 0) {
  if (b.kind === 'sections') return sectionWalls(sectionPositions(b)[level]);
  // A shaped building's walls on the storey: a jettied one's stand out, a little longer.
  if (b.kind === 'footprint') return storeyWalls(b, footprintStoreys(b)[level]).map(w => ({ id: w.id, name: w.name, length: w.length }));
  const s = editStorey(b, level);
  return ['front', 'left', 'back', 'right'].map(id => ({ id, name: id[0].toUpperCase() + id.slice(1), length: wallLength(s, id) }));
}
export function changeOpening(b, level, index, patch) {
  const s = editStorey(b, level);
  if (!s?.openings[index]) throw Error('Select a window or door first.');
  const openings = s.openings.map((o, i) => i === index ? { ...o, ...patch } : o);
  return validateBuilding(patchStorey(b, level, { openings }));
}
export function repeatOpening(b, level, index, count, gap) {
  if (!Number.isInteger(count) || count < 2 || count > 16 || !Number.isFinite(gap) || gap < 6) throw Error('Use 2–16 openings and at least 6 mm between them.');
  const s = editStorey(b, level), o = s.openings[index];
  if (!o) throw Error('Select the first window or door in the row.');
  const copies = Array.from({ length: count - 1 }, (_, i) => ({ ...o, at: o.at + (i + 1) * (o.width + gap) }));
  return validateBuilding(patchStorey(b, level, { openings: [...s.openings, ...copies] }));
}
export function alignOpenings(b, level, wall, edge) {
  const s = editStorey(b, level), windows = s.openings.filter(o => o.wall === wall && o.type === 'window');
  if (windows.length < 2) throw Error('This wall needs at least two windows to align.');
  const target = edge === 'top' ? Math.max(...windows.map(o => o.sill + o.height)) : Math.min(...windows.map(o => o.sill));
  return validateBuilding(patchStorey(b, level, { openings: s.openings.map(o => o.wall === wall && o.type === 'window' ? { ...o, sill: edge === 'top' ? target - o.height : target } : o) }));
}
export function placeOpening(b, level, wall, type = 'window') {
  const s = editStorey(b, level), length = editWalls(b, level).find(w => w.id === wall)?.length;
  if (!length) throw Error('Select a wall first.');
  const o = ['footprint','sections'].includes(b.kind) ? { type, wall, width: type === 'door' ? 28 : 40, height: type === 'door' ? 48 : 30, sill: type === 'door' ? 0 : 20 } : { ...OPENING_DEFAULTS[type], wall };
  if (o.type === 'window') o.sill = Math.max(0, Math.min(o.sill, s.height - o.height - 6));
  // On a short wall, a narrower one: down to 10 mm wide.
  for (const width of [o.width, 30, 20, 14, 10].filter((w, i) => !i || w < o.width))
    for (let at = width / 2 + 9; at <= length - width / 2 - 9; at++) {
      try { return validateBuilding(patchStorey(b, level, { openings: [...s.openings, { ...o, width, at }] })); } catch { /* Try the next millimetre. */ }
    }
  throw Error('There is no room for this opening. Enlarge the wall or move an existing opening.');
}

export function createBuildingHistory(initial, limit = 60) {
  let states = [structuredClone(initial)], position = 0;
  return {
    get canUndo() { return position > 0; },
    get canRedo() { return position + 1 < states.length; },
    commit(value) {
      if (JSON.stringify(value) === JSON.stringify(states[position])) return;
      states.splice(position + 1);
      states.push(structuredClone(value));
      if (states.length > limit) states.shift();
      position = states.length - 1;
    },
    undo() { if (position > 0) position--; return structuredClone(states[position]); },
    redo() { if (position + 1 < states.length) position++; return structuredClone(states[position]); },
    reset(value) { states = [structuredClone(value)]; position = 0; },
  };
}

// Several windows and doors of one wall at once: indices into the storey's openings.
function chosenOn(b, level, indices) {
  const s = editStorey(b, level), list = [...new Set(indices)].map((i) => [i, s.openings[i]]);
  if (!list.length || list.some(([, o]) => !o)) throw Error('Select one or more windows or doors first.');
  const wall = list[0][1].wall;
  if (list.some(([, o]) => o.wall !== wall)) throw Error('Select windows and doors of one wall.');
  const length = editWalls(b, level).find((w) => w.id === wall).length;
  return { s, list, wall, length };
}
const round = (n) => Math.round(n * 1e6) / 1e6;
/** A copy of each, mirrored about the middle of the wall; one already there, or in the middle, is not copied. */
export function mirrorOpenings(b, level, indices) {
  const { s, list, length } = chosenOn(b, level, indices);
  const copies = [];
  for (const [, o] of list) {
    const at = round(length - o.at);
    const there = (p) => p.wall === o.wall && p.type === o.type && Math.abs(p.at - at) < 1 && Math.abs(p.sill - o.sill) < 1;
    if (Math.abs(at - o.at) < 1 || s.openings.some(there) || copies.some(there)) continue;
    copies.push({ ...o, at });
  }
  if (!copies.length) throw Error('They are mirrored already.');
  return validateBuilding(patchStorey(b, level, { openings: [...s.openings, ...copies] }));
}
/** Spread along the wall in their order, the gaps between them and at the two ends all the same. */
export function spaceOpenings(b, level, indices) {
  const { s, list, length } = chosenOn(b, level, indices);
  const sorted = [...list].sort((p, q) => p[1].at - q[1].at);
  const gap = (length - sorted.reduce((sum, [, o]) => sum + o.width, 0)) / (sorted.length + 1);
  if (gap <= 0) throw Error('They are wider together than the wall.');
  const at = new Map();
  let u = 0;
  for (const [i, o] of sorted) {
    u += gap;
    at.set(i, round(u + o.width / 2));
    u += o.width;
  }
  return validateBuilding(patchStorey(b, level, { openings: s.openings.map((o, i) => (at.has(i) ? { ...o, at: at.get(i) } : o)) }));
}
/** Moved together so they stand in the middle of the wall. */
export function centreOpenings(b, level, indices) {
  const { s, list, length } = chosenOn(b, level, indices);
  const lo = Math.min(...list.map(([, o]) => o.at - o.width / 2)), hi = Math.max(...list.map(([, o]) => o.at + o.width / 2));
  const by = length / 2 - (lo + hi) / 2, chosen = new Set(list.map(([i]) => i));
  return validateBuilding(patchStorey(b, level, { openings: s.openings.map((o, i) => (chosen.has(i) ? { ...o, at: round(o.at + by) } : o)) }));
}
/** Moved together, along the wall and up it. */
export function moveOpenings(b, level, indices, along, up = 0) {
  const { s, list } = chosenOn(b, level, indices), chosen = new Set(list.map(([i]) => i));
  return validateBuilding(patchStorey(b, level, { openings: s.openings.map((o, i) => (chosen.has(i) ? { ...o, at: round(o.at + along), ...(o.type === 'window' && { sill: round(o.sill + up) }) } : o)) }));
}
/** A copy of each on another wall, as far from its middle as they are from the middle of theirs. */
export function copyOpenings(b, level, indices, to) {
  const { s, list, wall, length } = chosenOn(b, level, indices);
  const target = editWalls(b, level).find((w) => w.id === to);
  if (!target) throw Error('Choose the wall to copy them to.');
  if (to === wall) throw Error('Choose another wall to copy them to.');
  const copies = list.map(([, o]) => ({ ...o, wall: to, at: round(o.at - length / 2 + target.length / 2) }));
  return validateBuilding(patchStorey(b, level, { openings: [...s.openings, ...copies] }));
}
/** All of them gone. */
export function removeOpenings(b, level, indices) {
  const { s, list } = chosenOn(b, level, indices), chosen = new Set(list.map(([i]) => i));
  return validateBuilding(patchStorey(b, level, { openings: s.openings.filter((_, i) => !chosen.has(i)) }));
}
