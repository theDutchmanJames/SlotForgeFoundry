// Glazing: the clear sheet behind each window, as a template to cut from
// clear plastic, drawn full size. A sheet reaches past its opening on every
// side so it can be glued on the inside of its wall, but never onto the next
// window or past the end of the wall.
import { buildingLayout, leanGrow, validateBuilding, WALL_NAMES } from './geometry/building.js';
import { sectionPositions, sectionWalls } from './geometry/connected-building.js';
import { footprintWalls } from './geometry/footprint-building.js';

export const GLAZING = Object.freeze({ overlap: 2, apart: 0.5, page: 180, gap: 4, margin: 10, text: 2.6 });

// How far a sheet can reach past each side of its opening: no more than the
// overlap, and only half the way to the next window, the corner or the floor.
function reaches(o, others, length, height) {
  const { overlap: O, apart } = GLAZING;
  const half = (d) => Math.max(0, Math.min(O, d / 2 - apart / 2));
  const u0 = o.at - o.width / 2, u1 = o.at + o.width / 2, z0 = o.sill, z1 = o.sill + o.height;
  // A wall's inside is shorter than its outside by a wall's thickness at each end.
  let left = Math.min(O, u0 - 3 - apart), right = Math.min(O, length - 3 - u1 - apart);
  let down = Math.min(O, z0), up = Math.min(O, height - z1 - 3);
  for (const p of others) {
    const p0 = p.at - p.width / 2, p1 = p.at + p.width / 2, q0 = p.sill, q1 = p.sill + p.height;
    const side = q0 < z1 + 2 * O && q1 > z0 - 2 * O, above = p0 < u1 + 2 * O && p1 > u0 - 2 * O;
    if (side && p1 <= u0) left = Math.min(left, half(u0 - p1));
    if (side && p0 >= u1) right = Math.min(right, half(p0 - u1));
    if (above && q1 <= z0) down = Math.min(down, half(z0 - q1));
    if (above && q0 >= z1) up = Math.min(up, half(q0 - z1));
  }
  return [left, right, down, up].map((v) => Math.max(0, v));
}

/** The sheets: each { name, points } (a polygon in mm, x across, y up), one per window. */
export function glazingSheets(input) {
  const out = [];
  // As saved, a building can leave out what it has by default: its sizes come from the checked one.
  if (input?.kind && !['garage', 'sections', 'footprint'].includes(input.kind)) return out;
  const b = validateBuilding(input);
  const add = (name, o, others, length, height, warp = null) => {
    const [l, r, d, u] = reaches(o, others, length, height);
    const w0 = o.width + l + r, z0 = o.sill - d, z1 = o.sill + o.height + u;
    // A leaning wall: wider at the top, and longer up its face than it stands.
    const [b0, b1, rise] = warp ? [w0 * warp.at(z0), w0 * warp.at(z1), (z1 - z0) * warp.slope] : [w0, w0, z1 - z0];
    // The narrower bottom centred under the top: a trapezoid, or a rectangle on a wall that stands straight.
    const inset = (b1 - b0) / 2;
    out.push({ name, points: [[inset, 0], [inset + b0, 0], [b1, rise], [0, rise]] });
  };
  const windows = (list, wall) => list.filter((o) => o.wall === wall && o.type === 'window' && !o.counter && !o.flap);
  if (b.kind === 'sections') {
    for (const s of sectionPositions(b))
      for (const w of sectionWalls(s)) windows(s.openings, w.id).forEach((o, i, all) => add(s.name + ', ' + w.id + ' window ' + (i + 1), o, all.filter((p) => p !== o), w.length, s.height));
    return out;
  }
  if (b.kind === 'footprint') {
    for (const w of footprintWalls(b)) windows(b.openings, w.id).forEach((o, i, all) => add(w.name + ', window ' + (i + 1), o, all.filter((p) => p !== o), w.length, b.height));
    return out;
  }
  const { storeys } = buildingLayout(b);
  for (const s of storeys)
    for (const wall of ['front', 'back', 'left', 'right']) {
      const length = wall === 'front' || wall === 'back' ? s.width : s.depth;
      const { f } = leanGrow(s);
      const across = wall === 'front' || wall === 'back' ? s.depth : s.width;
      const warp = f ? { at: (z) => 1 + (f * Math.min(Math.max(z, 0), s.height)) / s.height, slope: Math.hypot(1, ((across / 2) * f) / s.height) } : null;
      windows(s.openings, wall).forEach((o, i, all) => add(WALL_NAMES[wall] + ' window ' + (i + 1) + s.label, o, all.filter((p) => p !== o), length, s.height, warp));
    }
  return out;
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mm = (n) => Math.round(n * 10) / 10;

/** The template: the sheets laid out in rows across a page, each outlined and named, full size in mm. */
export function glazingSvg(title, sheets) {
  const { page, gap, margin, text } = GLAZING;
  let x = 0, y = 0, row = 0;
  const placed = [];
  for (const s of sheets) {
    const w = Math.max(...s.points.map((p) => p[0])), h = Math.max(...s.points.map((p) => p[1]));
    if (x && x + w > page) (x = 0), (y += row + gap + text * 2), (row = 0);
    placed.push({ ...s, x, y, w, h });
    x += Math.max(w, 30) + gap;
    row = Math.max(row, h);
  }
  const width = page + 2 * margin, height = y + row + text * 2 + 2 * margin + 14;
  const body = placed
    .map((s) => `<g transform="translate(${mm(margin + s.x)} ${mm(margin + 14 + s.y)})"><polygon points="${s.points.map(([px, py]) => mm(px) + ',' + mm(s.h - py)).join(' ')}" fill="none" stroke="#000" stroke-width="0.2"/><text x="0" y="${mm(s.h + text * 1.3)}" font-size="${text}" font-family="sans-serif">${esc(s.name)} · ${mm(s.w)} × ${mm(s.h)} mm</text></g>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${mm(width)}mm" height="${mm(height)}mm" viewBox="0 0 ${mm(width)} ${mm(height)}">
<text x="${margin}" y="${margin + 3}" font-size="4" font-family="sans-serif">${esc(title)} · glazing, full size</text>
<text x="${margin}" y="${margin + 8}" font-size="2.6" font-family="sans-serif">Print at 100 % (actual size) and check a sheet with a ruler. Cut clear sheet, 0.3 to 0.5 mm thick, on the lines; glue each behind its window, on the inside of its wall.</text>
${body}
</svg>
`;
}
