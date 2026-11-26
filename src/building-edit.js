// Editing operations shared by the wall canvas and its accessible numeric controls.
import { validateBuilding, OPENING_DEFAULTS, wallLength } from './geometry/building.js';
import { sectionPositions, sectionWalls } from './geometry/connected-building.js';
import { footprintWalls } from './geometry/footprint-building.js';

export const editStorey = (b, level) => b.kind === 'sections' ? b.sections[level] : level ? b.upper[level - 1] : b;
export const patchStorey = (b, level, patch) => b.kind === 'sections' ? { ...b, sections: b.sections.map((s,i) => i === level ? { ...s, ...patch } : s) } : level ? { ...b, upper: b.upper.map((s, i) => i === level - 1 ? { ...s, ...patch } : s) } : { ...b, ...patch };
export function editWalls(b, level = 0) {
  if (b.kind === 'sections') return sectionWalls(sectionPositions(b)[level]);
  if (b.kind === 'footprint') return footprintWalls(b).map(w => ({ id: w.id, name: w.name, length: w.length }));
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
  for (let at = o.width / 2 + 9; at <= length - o.width / 2 - 9; at++) {
    try { return validateBuilding(patchStorey(b, level, { openings: [...s.openings, { ...o, at }] })); } catch { /* Try the next millimetre. */ }
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
