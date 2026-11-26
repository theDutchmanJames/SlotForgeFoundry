// Orthogonal building kits. Wall identities follow the boundary, including re-entrant corners.
// This generator is deliberately separate from the existing rectangular/storey schema.
import { kitShapes } from './kit-shapes.js';

export const FOOTPRINT_DEFAULTS = Object.freeze({ kind: 'footprint', shape: 'L', width: 220, depth: 180, wing: 80, height: 75, baseHeight: 6, wall: 3, play: 0.2, roof: 3, overhang: 3, openings: [] });
export function footprintPoints(b) {
  const W = b.width, D = b.depth, a = b.wing;
  if (b.shape === 'rectangle') return [[0, 0], [W, 0], [W, D], [0, D]];
  if (b.shape === 'L') return [[0, 0], [W, 0], [W, a], [a, a], [a, D], [0, D]];
  if (b.shape === 'U') return [[0, 0], [W, 0], [W, D], [W - a, D], [W - a, a], [a, a], [a, D], [0, D]];
  return [[0, 0], [W, 0], [W, a], [(W + a) / 2, a], [(W + a) / 2, D], [(W - a) / 2, D], [(W - a) / 2, a], [0, a]];
}
export function footprintWalls(b) {
  const points = footprintPoints(b);
  return points.map((a, i) => {
    const end = points[(i + 1) % points.length], dx = end[0] - a[0], dy = end[1] - a[1], length = Math.hypot(dx, dy);
    return { id: 'edge-' + (i + 1), name: 'Wall ' + (i + 1), a, end, length, dir: [dx / length, dy / length], inward: [-dy / length, dx / length] };
  });
}
// Offset each intersection of perpendicular edges, preserving the boundary's vertex order.
export function footprintOffset(b, amount) {
  const walls = footprintWalls(b);
  return walls.map((w, i) => {
    const prev = walls[(i + walls.length - 1) % walls.length];
    return [w.a[0] - amount * (prev.inward[0] + w.inward[0]), w.a[1] - amount * (prev.inward[1] + w.inward[1])];
  });
}
export function validateFootprint(input) {
  for (const key of Object.keys(input)) if (!Object.hasOwn(FOOTPRINT_DEFAULTS, key)) throw Error('Unknown footprint setting: ' + key);
  const b = { ...FOOTPRINT_DEFAULTS, ...input };
  if (!['rectangle', 'L', 'U', 'T'].includes(b.shape)) throw Error('Choose a rectangular, L, U or T footprint.');
  for (const [key, min, max] of [['width', 100, 1200], ['depth', 100, 1200], ['wing', 40, 500], ['height', 30, 180], ['baseHeight', 4, 20], ['wall', 2, 5], ['play', 0.1, 0.5], ['roof', 2, 5], ['overhang', 0, 12]]) {
    if (!Number.isFinite(b[key]) || b[key] < min || b[key] > max) throw Error(key + ' must be between ' + min + ' and ' + max + ' mm.');
  }
  if (b.shape !== 'rectangle' && (b.wing > b.depth - 30 || b.wing > (b.shape === 'U' ? (b.width - 30) / 2 : b.shape === 'T' ? b.width - 60 : b.width - 30))) throw Error('The wing leaves too little room for the recess. Reduce the wing width or enlarge the building.');
  if (!Array.isArray(b.openings) || b.openings.length > 64) throw Error('Use at most 64 openings.');
  const walls = footprintWalls(b);
  b.openings = b.openings.map((o, i) => {
    if (!o || typeof o !== 'object' || Object.keys(o).some(k => !['wall', 'type', 'at', 'width', 'height', 'sill'].includes(k))) throw Error('Invalid opening ' + (i + 1));
    const w = walls.find(w => w.id === o.wall);
    if (!w || !['window', 'door'].includes(o.type)) throw Error('Choose a wall and an opening type.');
    const p = { ...o, sill: o.type === 'door' ? 0 : o.sill };
    if (![p.at, p.width, p.height, p.sill].every(Number.isFinite) || p.width < 8 || p.height < 8 || p.sill < 0) throw Error('Openings need positive sizes and a position above the floor.');
    if (p.at - p.width / 2 < 9 || p.at + p.width / 2 > w.length - 9) throw Error(w.name + ': keep the opening at least 9 mm from each corner.');
    if (p.sill + p.height > b.height - 6) throw Error(w.name + ': leave at least 6 mm above the opening.');
    return p;
  });
  b.openings.forEach((o, i) => b.openings.slice(i + 1).forEach(p => {
    if (p.wall !== o.wall) return;
    const across = Math.abs(p.at - o.at) - (p.width + o.width) / 2;
    const vertical = Math.max(p.sill - o.sill - o.height, o.sill - p.sill - p.height);
    if (across < 6 && vertical < 6) throw Error('Keep at least 6 mm between openings.');
  }));
  return b;
}
export function footprintLayout(input) {
  const b = validateFootprint(input);
  return { building: b, storeys: [], doors: [], parts: [{ id: 'base', name: 'Shaped base', role: 'buildingBase' }, ...footprintWalls(b).map(w => ({ id: w.id, name: w.name, role: 'wall' })), { id: 'roof', name: 'Shaped flat roof', role: 'roof' }] };
}

export function buildFootprint(wasm, input, plate = null) {
  const b = validateFootprint(input), temp = [], result = [];
  const own = s => (temp.push(s), s);
  const { poly, box, sweep } = kitShapes(wasm, own);
  const outline = footprintPoints(b), inner = footprintOffset(b, -b.wall), walls = footprintWalls(b);
  const top = b.baseHeight + b.height;
  const room = plate ? [plate.width - 2 * (plate.margin ?? 0), plate.depth - 2 * (plate.margin ?? 0)] : [Infinity, Infinity];
  if (room.some(n => n < 40)) throw Error('Use a print plate with at least 40 mm usable width and depth.');
  // Flat panels split into labelled butt-jointed tiles. No overlap or internal duplicate walls.
  function tiles(solid, part, wall = null) {
    const bb = solid.boundingBox();
    const long = Math.max(...room), short = Math.min(...room);
    let segments;
    if (wall) {
      // Plane cuts along the wall and its height keep every panel printable, even on small beds.
      const nx = plate ? Math.ceil((wall.length + 2 * b.wall) / long) : 1;
      const nz = plate ? Math.ceil((b.height + 2) / short) : 1;
      segments = [];
      for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) {
        const lo = -b.wall + x * (wall.length + 2 * b.wall) / nx, hi = -b.wall + (x + 1) * (wall.length + 2 * b.wall) / nx;
        const z0 = b.baseHeight - 2 + z * (b.height + 2) / nz, z1 = b.baseHeight - 2 + (z + 1) * (b.height + 2) / nz;
        const cutter = sweep([[lo, z0 - 0.00001], [hi, z0 - 0.00001], [hi, z1 + 0.00001], [lo, z1 + 0.00001]], [...wall.dir, 0], [0, 0, 1], [...wall.a, 0], [...wall.inward, 0], -b.wall - 1, 2 * b.wall + 1);
        segments.push(own(solid.intersect(cutter)));
      }
    } else {
      const dx = bb.max[0] - bb.min[0], dy = bb.max[1] - bb.min[1];
      const nx = plate ? Math.ceil(dx / room[0]) : 1, ny = plate ? Math.ceil(dy / room[1]) : 1;
      segments = [];
      for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) segments.push(own(solid.intersect(box(bb.min[0] + x * dx / nx, bb.min[1] + y * dy / ny, bb.min[2] - 1, bb.min[0] + (x + 1) * dx / nx, bb.min[1] + (y + 1) * dy / ny, bb.max[2] + 1))));
    }
    const pieces = [];
    for (const segment of segments) for (const piece of segment.decompose()) {
      if (piece.volume() > 0.001) pieces.push(piece); else piece.delete();
    }
    pieces.forEach((solid, i) => result.push({ ...part, solid, id: part.id + (pieces.length > 1 ? '-' + (i + 1) : ''), name: part.name + (pieces.length > 1 ? ' ' + (i + 1) + ' of ' + pieces.length : '') }));
  }
  try {
    const outer = poly(footprintOffset(b, 3)), grooveOuter = poly(footprintOffset(b, b.play)), grooveInner = poly(footprintOffset(b, -b.wall - b.play));
    const groove = own(own(grooveOuter.subtract(grooveInner)).extrude(2.01)).translate([0, 0, b.baseHeight - 2]); own(groove);
    const base = own(own(outer.extrude(b.baseHeight)).subtract(groove));
    tiles(base, { id: 'base', name: 'Shaped base', role: 'buildingBase', lie: [0, 0, 0], apart: [0, 0, -12] });
    walls.forEach((w, i) => {
      const j = (i + 1) % walls.length;
      let solid = own(poly([outline[i], outline[j], inner[j], inner[i]]).extrude(b.height + 2)).translate([0, 0, b.baseHeight - 2]); own(solid);
      for (const o of b.openings.filter(o => o.wall === w.id)) {
        const z0 = o.type === 'door' ? b.baseHeight - 2.01 : b.baseHeight + o.sill;
        const hole = sweep([[o.at - o.width / 2, z0], [o.at + o.width / 2, z0], [o.at + o.width / 2, b.baseHeight + o.sill + o.height], [o.at - o.width / 2, b.baseHeight + o.sill + o.height]], [...w.dir, 0], [0, 0, 1], [...w.a, 0], [...w.inward, 0], -1, b.wall + 1);
        solid = own(solid.subtract(hole));
      }
      tiles(solid, { id: w.id, name: w.name, role: 'wall', outward: w.inward.map(n => -n), apart: [-w.inward[0] * 20, -w.inward[1] * 20, 8] }, w);
    });
    const roof = own(poly(footprintOffset(b, b.overhang)).extrude(b.roof)).translate([0, 0, top]); own(roof);
    tiles(roof, { id: 'roof', name: 'Shaped flat roof', role: 'roof', lie: [0, 0, 0], apart: [0, 0, 30] });
    return result;
  } catch (err) {
    result.forEach(p => p.solid.delete());
    throw err;
  } finally { temp.forEach(s => s.delete()); }
}
