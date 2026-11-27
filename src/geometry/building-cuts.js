// Fitting a building to the print plate: a wall, the base or the roof that
// is longer than the plate is cut into pieces that join like a puzzle. A
// plain wall, the base and the roof join with dovetail tabs cut in the
// plane of the part; a brick or block wall is cut along its joints, stepping
// from course to course, so the seam is one more joint. Every cut can be
// moved within the range where both pieces still fit the plate.

export const JOINT = Object.freeze({
  neck: 6, // dovetail tab, where it leaves its piece
  head: 9, // dovetail tab, at its end
  length: 5, // how far a tab reaches into the next piece
  play: 0.15, // clearance around a tab, each side
  minPiece: 30, // the shortest piece
  edge: 8, // a cut keeps this far from the end of a part
  aside: 4, // and this far from the side of an opening or its frame: it may run through one
});
// The parts that may be cut, and which way: a wall along its length (front,
// front2 for the second storey, ...) and across its height (frontZ), a
// dividing wall or a partition the same way; the base, a floor and the roof
// across (X) and front to back (Y).
const WALL_IDS = ['front', 'back', 'left', 'right'];
const STOREY_NAMES = ['', '', ', storey 2', ', storey 3', ', storey 4'];
export const CUT_KEYS = Object.freeze([
  ...[1, 2, 3, 4].flatMap((s) => WALL_IDS.flatMap((w) => [w + (s > 1 ? s : ''), w + (s > 1 ? s : '') + 'Z'])),
  'baseX',
  'baseY',
  'floor2X',
  'floor2Y',
  'floor3X',
  'floor3Y',
  'floor4X',
  'floor4Y',
  'roofX',
  'roofY',
  ...Array.from({ length: 23 }, (_, i) => i + 1).flatMap((i) => ['divide' + i, 'divide' + i + 'Z']),
  ...Array.from({ length: 24 }, (_, i) => i + 1).flatMap((i) => ['partition' + i, 'partition' + i + 'Z']),
]);
/** What a cut key is called on the page. */
export function cutLabel(key) {
  const m = /^(front|back|left|right)(\d?)(Z?)$/.exec(key);
  if (m) return m[1][0].toUpperCase() + m[1].slice(1) + ' wall' + STOREY_NAMES[Number(m[2] || 1)] + (m[3] ? ', across its height' : '');
  const d = /^divide(\d+)(Z?)$/.exec(key);
  if (d) return 'Dividing wall ' + d[1] + (d[2] ? ', across its height' : '');
  const p = /^partition(\d+)(Z?)$/.exec(key);
  if (p) return 'Partition ' + p[1] + (p[2] ? ', across its height' : '');
  const f = /^(base|roof|floor)(\d?)([XY])$/.exec(key);
  if (!f) return key;
  const name = f[1] === 'floor' ? 'Floor of storey ' + f[2] : f[1] === 'base' ? 'Base' : 'Roof';
  return name + (f[3] === 'X' ? ', across' : ', front to back');
}

/** The settings for the cuts: for each part, where its cuts are, or nothing for the default. */
export function validateCuts(cuts) {
  if (cuts === undefined) return {};
  if (!cuts || typeof cuts !== 'object' || Array.isArray(cuts)) throw Error('The cuts of the building are not readable.');
  const out = {};
  for (const [key, list] of Object.entries(cuts)) {
    if (!CUT_KEYS.includes(key)) throw Error('The building has a cut for an unknown part: ' + key + '.');
    if (!Array.isArray(list) || list.length > 12 || !list.every(Number.isFinite))
      throw Error('The cuts of the ' + cutLabel(key).toLowerCase() + ' are not a list of places.');
    out[key] = [...list].sort((a, b) => a - b);
  }
  return out;
}

/** The plate, less its margin: the longer and the shorter side. */
export function plateRoom(plate) {
  const w = plate.width - 2 * (plate.margin ?? 0),
    d = plate.depth - 2 * (plate.margin ?? 0);
  return { long: Math.max(w, d), short: Math.min(w, d) };
}

// The places along a part where no cut may go, as [from, to] ranges.
function merge(ranges) {
  const sorted = ranges.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
}
const blocked = (at, ranges) => ranges.some(([a, b]) => at > a && at < b);

/**
 * The cuts of one part, length long, whose pieces may be at most maxPiece
 * long (a tab included): the places chosen, or set evenly where nothing is
 * set, and for each cut the range it may move in.
 */
export function planPart(key, length, maxPiece, forbidden, chosen) {
  const reach = maxPiece - JOINT.length;
  if (length <= maxPiece) return { key, length, cuts: [], ranges: [], forbidden: [] };
  const n = Math.ceil(length / reach);
  const no = merge([[-Infinity, JOINT.edge], [length - JOINT.edge, Infinity], ...forbidden]);
  const rangeOf = (cuts, i) => {
    const prev = i ? cuts[i - 1] : 0,
      next = i < cuts.length - 1 ? cuts[i + 1] : length;
    return [Math.max(prev + JOINT.minPiece, next - reach), Math.min(prev + reach, next - JOINT.minPiece)];
  };
  // A place for each cut, evenly spread, moved off anything in the way.
  const settle = (cuts) => {
    for (let i = 0; i < cuts.length; i++) {
      const [lo, hi] = rangeOf(cuts, i);
      if (!blocked(cuts[i], no) && cuts[i] >= lo && cuts[i] <= hi) continue;
      let best = null;
      for (let d = 0; d <= length; d += 0.5)
        for (const at of [cuts[i] - d, cuts[i] + d])
          if (best === null && at >= lo && at <= hi && !blocked(at, no)) best = at;
      if (best === null) return null;
      cuts[i] = best;
    }
    return cuts;
  };
  let cuts;
  if (chosen && chosen.length === n - 1) {
    cuts = [...chosen];
    for (let i = 0; i < cuts.length; i++) {
      const [lo, hi] = rangeOf(cuts, i);
      if (cuts[i] < lo - 1e-9 || cuts[i] > hi + 1e-9)
        throw Error(cutLabel(key) + ': cut ' + (i + 1) + ' at ' + round(cuts[i]) + ' mm leaves a piece that does not fit the plate. Put it between ' + round(lo) + ' and ' + round(hi) + ' mm.');
      if (blocked(cuts[i], no))
        throw Error(cutLabel(key) + ': cut ' + (i + 1) + ' at ' + round(cuts[i]) + ' mm runs ' + (cuts[i] < JOINT.edge || cuts[i] > length - JOINT.edge ? 'too close to the end of the part' : 'along the side of a window, a door or a frame, and would leave a sliver') + '. Move it a little.');
    }
  } else {
    cuts = settle(Array.from({ length: n - 1 }, (_, i) => ((i + 1) * length) / n));
    if (!cuts) throw Error(cutLabel(key) + ' cannot be cut to fit the plate: the windows and doors leave no room for a cut. Move an opening, or use a bigger plate.');
  }
  return { key, length, cuts, ranges: cuts.map((_, i) => rangeOf(cuts, i).map(round)), forbidden: no.filter(([a, b]) => a > -Infinity && b < Infinity) };
}
const round = (v) => Math.round(v * 10) / 10;

/**
 * Where each part of a building is cut to fit the plate. walls: each wall
 * as { key, length, height (as it prints), keepOut along it, keepOutUp
 * across its height; leaning out, scale (how much longer it prints at its
 * top) and stands (how tall it stands, height then as it prints slanted) };
 * flats: the base, the floors and the roof as { name,
 * extent [x, y], scale [x, y] (how much longer it prints than its plan) }.
 */
export function planCuts(b, plate, { walls, flats }) {
  const room = plateRoom(plate);
  const cuts = b.cuts ?? {};
  const plan = {};
  for (const w of walls) {
    // A wall lies with its height across the plate if it fits that way;
    // taller than the plate's long side, it is cut across its height too.
    const tall = w.height > room.long;
    // Cut across its height, its bands lie across the plate and its length along it.
    const maxPiece = tall || w.height <= room.short ? room.long : room.short;
    // A wall that leans out prints longer at its top than it is planned, by its scale.
    plan[w.key] = planPart(w.key, w.length, maxPiece / (w.scale ?? 1) - (w.padding ?? 0), w.keepOut, cuts[w.key]);
    // Across its height it is cut where it stands; leaning, each band prints as much longer as the wall slants.
    const stands = w.stands ?? w.height;
    plan[w.key + 'Z'] = planPart(w.key + 'Z', stands, tall ? (room.short * stands) / w.height : Infinity, w.keepOutUp ?? [], cuts[w.key + 'Z']);
  }
  // The base, a floor and the roof are cut one way or both ways. Their long
  // side may lie along either side of the plate: the way with fewer pieces.
  for (const { name, extent: [x, y], scale: [sx, sy] } of flats) {
    const pieces = (len, lim) => (len <= lim ? 1 : Math.ceil(len / (lim - JOINT.length)));
    const ways = [
      [room.long, room.short],
      [room.short, room.long],
    ];
    const [limX, limY] = ways.reduce((best, way) =>
      pieces(x * sx, way[0]) * pieces(y * sy, way[1]) < pieces(x * sx, best[0]) * pieces(y * sy, best[1]) ? way : best,
    );
    plan[name + 'X'] = planPart(name + 'X', x, limX / sx, [], cuts[name + 'X']);
    plan[name + 'Y'] = planPart(name + 'Y', y, limY / sy, [], cuts[name + 'Y']);
  }
  return plan;
}

/* ---------- The seams ---------- */

// A dovetail tab reaching from a cut at u into +u, centred at v.
function tab(u, v) {
  const { neck, head, length } = JOINT;
  return [
    [u - 0.01, v - neck / 2],
    [u + length, v - head / 2],
    [u + length, v + head / 2],
    [u - 0.01, v + neck / 2],
  ];
}

/**
 * The region on the low side of a seam, as one polygon in the 2D frame of
 * the part (u along it, v across): the cut line at u from v0 to v1 with
 * tabs at the places given, or, for a brick or block wall, stepping along
 * its joints from course to course.
 */
export function seamRegion(u, [v0, v1], tabsAt, steps = null) {
  const far = -1e4;
  if (steps) {
    // steps: the rows, each { v: bottom, top, at: the joint chosen in that row }.
    const pts = [[far, v0 - 1]];
    const rows = steps;
    pts.push([rows[0].at, v0 - 1]);
    for (let i = 0; i < rows.length; i++) {
      pts.push([rows[i].at, rows[i].top]);
      const next = rows[i + 1];
      if (next) pts.push([next.at, rows[i].top]);
    }
    pts.push([rows.at(-1).at, v1 + 1], [far, v1 + 1]);
    return [pts];
  }
  const pts = [[far, v0 - 1], [u, v0 - 1]];
  for (const v of [...tabsAt].sort((a, b) => a - b)) {
    const t = tab(u, v);
    pts.push([u, t[0][1]], t[1], t[2], [u, t[3][1]]);
  }
  pts.push([u, v1 + 1], [far, v1 + 1]);
  return [pts];
}

/**
 * Where along a seam its tabs go: the middle of each stretch long enough
 * for one. across: where other seams cross it; gaps: [from, to] stretches
 * with nothing to join (an opening the seam runs through).
 */
export function tabPlaces([v0, v1], across = [], gaps = [], edge = JOINT.edge) {
  const stops = [v0, ...across.filter((c) => c > v0 && c < v1).sort((a, b) => a - b), v1];
  const spans = [];
  for (let i = 0; i < stops.length - 1; i++) {
    let pieces = [[stops[i], stops[i + 1]]];
    for (const [g0, g1] of gaps)
      pieces = pieces.flatMap(([a, b]) => (g1 <= a || g0 >= b ? [[a, b]] : [[a, Math.min(b, g0)], [Math.max(a, g1), b]].filter(([p, q]) => q > p)));
    spans.push(...pieces);
  }
  const out = [];
  for (const [p, q] of spans) {
    const a = p + edge,
      b = q - edge;
    const span = b - a;
    if (span < JOINT.head) continue;
    const count = span > 70 ? 2 : 1;
    for (let k = 0; k < count; k++) out.push(a + (span * (k + 1)) / (count + 1));
  }
  return out;
}
