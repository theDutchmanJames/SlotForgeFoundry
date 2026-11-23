import { cleanName } from './project.js';
import { slotTitle } from './slot-position.js';
import { screwName } from './geometry/screw-clip.js';

// The name each layout piece carries in the kit. Pieces that share a name and
// differ in their slot positions say so, so their files and rows read apart:
// "Straight slot 35 from left" and "Straight slots 35/135-55/155 from left".
export function kitPieceNames(sources) {
  const slots = new Map();
  for (const { name, track } of Object.values(sources))
    slots.set(name, (slots.get(name) ?? new Set()).add(slotTitle(track.params)));
  return Object.fromEntries(
    Object.entries(sources).map(([key, { name, track }]) => {
      const slot = slotTitle(track.params);
      return [key, slots.get(name).size > 1 && slot ? name + ' ' + slot : name];
    }),
  );
}

// The print kit holds every different part once, with its count in the file
// name: an R2 road placed 36 times is one "R2-corner-Road-1-x36.stl". Parts
// are matched on their real triangles across the whole layout (the 80-byte
// STL header only carries a label), so the dovetail key every piece uses is
// one file too. A mirrored copy prints differently and keeps its own file.
const KIT_FOLDERS = { road: 'track', border: 'borders', clip: 'hardware', retainer: 'hardware' };
function sameTriangles(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 80; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
// File names are cut at 80 characters. A long piece name (every slot of an
// 8-lane piece at both ends) gives up its middle instead, so its start, its
// last distances with the edge they are measured from, and the part name
// stay in the name.
const FILE_NAME = 80;
function fileBase(piece, part) {
  const whole = piece + '-' + part;
  if (whole.length <= FILE_NAME) return whole;
  const room = FILE_NAME - part.length - 4;
  if (room < 24) return whole;
  const tail = Math.floor(room / 2);
  return piece.slice(0, room - tail).trimEnd() + '...' + piece.slice(-tail).trimStart() + '-' + part;
}
export function printGroups(prints) {
  const groups = [];
  for (const p of prints) {
    const same = groups.find(
      (g) => g.mirror === p.mirror && g.role === p.role && sameTriangles(g.bytes, p.bytes),
    );
    if (same) {
      same.count += p.count;
      same.pieces.add(p.piece);
    } else groups.push({ ...p, pieces: new Set([p.piece]) });
  }
  const taken = new Set();
  return groups.map((g) => {
    const shared = g.pieces.size > 1;
    const base =
      cleanName(shared ? g.part : fileBase(g.piece, g.part)).replace(/\s+/g, '-') +
      (g.mirror ? '-mirrored' : '');
    const folder = KIT_FOLDERS[g.role] ?? 'parts';
    let file = folder + '/' + base + '-x' + g.count + '.stl';
    for (let n = 2; taken.has(file); n++)
      file = folder + '/' + base + '-' + n + '-x' + g.count + '.stl';
    taken.add(file);
    return {
      file,
      bytes: g.bytes,
      count: g.count,
      label: shared ? g.part : g.piece + ' · ' + g.part,
      usedIn: [...g.pieces].join('; '),
    };
  });
}

// Volume of a closed binary STL in mm³ (sum of signed tetrahedra).
export function stlVolume(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.byteLength >= 84 ? view.getUint32(80, true) : 0;
  let sum = 0;
  for (let i = 0, o = 84 + 12; i < count && o + 36 <= bytes.byteLength; i++, o += 50) {
    const f = (k) => view.getFloat32(o + k * 4, true);
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = Array.from({ length: 9 }, (_, k) => f(k));
    sum += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return Math.abs(sum) / 6;
}
const polylineLength = (line) =>
  line.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]) : 0), 0);

// Slot length per lane across the layout. A mirrored placement counts its
// lanes from the other side, so lane 1 stays the same physical lane.
export function laneLengths(sections) {
  const lanes = [];
  for (const { lanes: lines = [], flip } of sections) {
    const ordered = flip ? [...lines].reverse() : lines;
    ordered.forEach((line, i) => (lanes[i] = (lanes[i] ?? 0) + polylineLength(line)));
  }
  return lanes;
}

// Bought hardware for the layout: one wood screw for each half of every
// Kevan Sideclip at a joined end, sized by the piece that half belongs to.
// ends as endsOf() gives them.
export function screwHardware({ ends, joints }) {
  const byName = new Map();
  for (const end of ends) {
    if (!joints.has(end.key)) continue;
    const count = end.hardware.filter(
      (g) => g.kind === 'Clip' && g.family?.startsWith('side-screw'),
    ).length;
    if (!count) continue;
    const name = screwName(end.params);
    byName.set(name, (byName.get(name) ?? 0) + count);
  }
  return [...byName].map(([name, count]) => ({ name, count }));
}

const m = (mm) => (mm / 1000).toFixed(2) + ' m';
// Plain-text shopping list for the print kit.
export function shoppingList({ name, groups, lanes, settings, material, hardware = [] }) {
  const lines = ['SHOPPING LIST · ' + name, ''];
  const volume = groups.reduce((s, g) => s + g.volume * g.count, 0);
  const grams = (volume / 1000) * material.density * (settings.infill / 100);
  lines.push('Filament (' + material.name + ', ' + material.density + ' g/cm³)');
  lines.push('  Printed volume: ' + (volume / 1000).toFixed(0) + ' cm³ over ' + groups.reduce((s, g) => s + g.count, 0) + ' parts');
  lines.push('  Estimated weight: ' + (grams / 1000).toFixed(2) + ' kg at ' + settings.infill + ' % fill');
  lines.push('  Spools of 1 kg: ' + Math.max(1, Math.ceil((grams * 1.1) / 1000)) + ' (10 % extra for purge and failed prints)');
  if (settings.spoolPrice > 0)
    lines.push('  Filament cost: about ' + ((grams / 1000) * settings.spoolPrice).toFixed(2) + ' (at ' + settings.spoolPrice + ' per kg)');
  lines.push('', 'Conductor braid (one strip each side of every slot)');
  if (!lanes.length) lines.push('  No slots in this layout.');
  let total = 0;
  lanes.forEach((len, i) => {
    const need = 2 * (len + settings.braidSpare);
    total += need;
    lines.push('  Lane ' + (i + 1) + ': slot ' + m(len) + ' → braid ' + m(need));
  });
  if (lanes.length) lines.push('  Total braid: ' + m(total) + ' (spare ' + settings.braidSpare + ' mm per strip included)');
  if (hardware.length) {
    lines.push('', 'Screws (one in each piece at every Kevan Sideclip; each cuts its thread into the clip)');
    for (const { name: item, count } of hardware) lines.push('  ' + count + ' × ' + item);
  }
  lines.push('', 'Weights are estimates from the part volumes; your slicer gives the real figure.');
  return lines.join('\r\n') + '\r\n';
}
