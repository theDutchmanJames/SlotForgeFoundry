// A row of modern pit garages, each bay a type of its own: 'single' (one
// storey, a solid upstand along the front of its roof, a truss railing round
// the rest), 'box' (a corporate box over the garage: glazing leaning out at
// the top, set back in a frame of tapering side fins under a roof that juts
// out over the pit lane, a balcony slab in front with a railing of bars) or
// 'podium' (a box whose balcony reaches out further as a platform with angled
// sides, the podium on it, the railing round it). Mixed freely in one row; a
// pillar stands out between each two garages.
//
// Each bay is its side profile stretched to the bay's width and prints
// standing on its start, the profile on the plate, so the fins, the leaning
// glazing, the roof's jut and the balcony print straight up. Every bay starts
// with a closed side, as tall as itself and its neighbour before it: the wall
// between two garages with its pillar, the fin of a frame, and where a lower
// bay follows a taller one the taller bay's side. The far end has a panel of
// its own. The bays join end to end with tabs in the back wall. Doors,
// numbers, the podiums and the railings are parts glued on. x along the row,
// y from the front of the garages back (the pit lane at negative y), z up.

import { LETTERING, checkText, nameBoard, nameBoardText } from './lettering.js';
import { kitShapes } from './kit-shapes.js';
import { sevenSegments } from './pit-module.js';

export const BAY_TYPES = Object.freeze([
  ['single', 'Single storey'],
  ['box', 'Corporate box'],
  ['podium', 'Podium'],
]);
export const PIT_BAYS_DEFAULTS = Object.freeze({
  kind: 'pitbays',
  types: Object.freeze(['box', 'box', 'box']), // one per bay, left to right as seen from the lane
  bayWidth: 110,
  depth: 150, // from the front of the garages to the back of the back wall
  baseHeight: 10, // as high as the track
  groundHeight: 65, // floor to the underside of the floor above
  doorWidth: 82,
  doorHeight: 52,
  recess: 4, // the doors set back in the front wall
  door: 'panel', // 'panel' or 'roller'
  pillars: true, // standing out between the garages
  upperHeight: 50, // a box or a podium: its storey, floor to roof
  jut: 24, // how far the roof reaches out over the lane
  setBack: 16, // the foot of a box's glazing behind the front of the garages
  lean: 12, // degrees the glazing leans out at the top
  balcony: 24, // the balcony slab reaching out over the lane
  balconyRailing: true,
  roofRailing: true, // a truss railing round the back and the sides of each roof
  numbers: true,
  firstNumber: 1,
  text: '', // a name board on the wall over the doors, its letters raised or cut, in place of the numbers
  textCut: false, // the name board's letters cut into it, not raised
});
export const PIT_BAYS_LIMITS = Object.freeze({
  bayWidth: [70, 200],
  depth: [60, 300],
  baseHeight: [4, 40],
  groundHeight: [45, 120],
  doorWidth: [30, 180],
  doorHeight: [25, 110],
  recess: [2, 12],
  upperHeight: [30, 90],
  jut: [0, 40],
  setBack: [4, 40],
  lean: [0, 25],
  balcony: [0, 40],
  firstNumber: [0, 76],
});
export const BAYS = Object.freeze({
  shell: 3,
  slab: 4, // the floor over the garage, the balcony
  roof: 4,
  upstand: 8, // along the front of a roof
  side: 8, // the side at the start of each bay: the wall between garages, a fin, a pillar
  pillar: 5, // how far a pillar stands out
  fin: 4, // a fin in front of the foot of the glazing
  column: 4,
  insert: 2,
  glass: 0.8,
  mullion: 5,
  podium: [14, [[14, 9], [12, 6], [12, 4]]], // the platform's reach; the podium's blocks: wide, high (first, second, third)
  tab: [1.8, 8, 4],
  tabPlay: 0.15,
  plaque: [18, 7, 1.5],
  balconyRail: { height: 14, thick: 3, band: 2, post: 2.5, pitch: 22, inset: 1, tab: 1.2, mid: true },
  roofRail: { height: 14, thick: 3, band: 2.5, post: 2.5, pitch: 14, inset: 1, tab: 1.2, truss: true },
  across: 190, // a bay on its end: from the front of what reaches out to the back, at most
  most: 24,
});
const LABELS = {
  bayWidth: 'Bay width',
  depth: 'Depth',
  baseHeight: 'Base height',
  groundHeight: 'Ground floor height',
  doorWidth: 'Door width',
  doorHeight: 'Door height',
  recess: 'Door set back',
  upperHeight: 'Upper storey height',
  jut: 'Roof reaches out',
  setBack: 'Glazing set back',
  lean: 'Glazing lean',
  balcony: 'Balcony reaches out',
  firstNumber: 'First number',
};
const upper = (t) => t !== 'single';
/** How long the name board may be: the row less a little, no longer than it prints flat on the plate. */
const boardWide = (m) => Math.min(m.types.length * m.bayWidth - 10, BAYS.across);

/** The pit building as kept: known settings only, each checked. */
export function validatePitBays(input) {
  const m = { ...PIT_BAYS_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(m)) if (!Object.hasOwn(PIT_BAYS_DEFAULTS, key)) throw Error('The pit building has an unknown setting: ' + key + '.');
  if (!Array.isArray(m.types) || m.types.length < 1 || m.types.length > BAYS.most) throw Error('A pit building has 1 to ' + BAYS.most + ' bays.');
  m.types.forEach((t, i) => {
    if (!BAY_TYPES.some(([id]) => id === t)) throw Error('Bay ' + (i + 1) + ' must be single storey, a corporate box or a podium.');
  });
  m.types = [...m.types];
  for (const [key, [min, max]] of Object.entries(PIT_BAYS_LIMITS))
    if (!Number.isFinite(m[key]) || m[key] < min || m[key] > max)
      throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + (key === 'firstNumber' ? '' : key === 'lean' ? '°' : ' mm') + '.');
  if (!Number.isInteger(m.firstNumber)) throw Error('The first number is a whole number.');
  if (!['panel', 'roller'].includes(m.door)) throw Error('Choose an up-and-over or a roller door.');
  for (const key of ['pillars', 'balconyRailing', 'roofRailing', 'numbers']) if (typeof m[key] !== 'boolean') throw Error('Choose whether the pit building has ' + key + '.');
  m.text = checkText(m.text, 'The name board');
  if (typeof m.textCut !== 'boolean') throw Error('Choose raised or cut letters for the name board.');
  if (m.text && m.numbers) throw Error('The name board and the bay numbers both go on the wall over the doors: choose one.');
  if (m.text && nameBoardText(m.text, boardWide(m), m.groundHeight - m.doorHeight - 2) < LETTERING.height[0]) throw Error('There is no room for “' + m.text + '” over the doors: make the ground floor higher, the doors lower, or the text shorter.');
  const room = m.bayWidth - 2 * (BAYS.column + m.recess + 1) - BAYS.side;
  if (m.doorWidth > room) throw Error('The door is too wide for a bay of ' + m.bayWidth + ' mm: at most ' + room + ' mm.');
  if (m.doorHeight > m.groundHeight - 12) throw Error('The door is too high for the ground floor: at most ' + (m.groundHeight - 12) + ' mm, room left over it for a number.');
  if (m.depth < m.recess + 3 * BAYS.shell + 20) throw Error('The pit building must be at least ' + (m.recess + 3 * BAYS.shell + 20) + ' mm deep.');
  if (m.types.some(upper)) {
    if (m.setBack + BAYS.shell + 20 > m.depth - BAYS.shell) throw Error('The glazing is set back too far for a building ' + m.depth + ' mm deep.');
    const lean = m.upperHeight * Math.tan((m.lean * Math.PI) / 180);
    if (m.setBack - lean < -m.jut + 3) throw Error('The glazing leans out past the roof: let the roof reach out further, or the glazing lean less.');
  }
  const out = Math.max(m.pillars ? BAYS.pillar : 0, m.types.some(upper) ? Math.max(m.jut, m.balcony) : 0, m.types.includes('podium') ? m.balcony + BAYS.podium[0] : 0);
  if (out + m.depth > BAYS.across) throw Error('A bay stands on its end to print and would be ' + Math.round(out + m.depth) + ' mm long: at most ' + BAYS.across + ' mm, make it less deep or reach out less.');
  const L = pitBaysLevels(m),
    tall = (m.types.some(upper) ? L.roof1 : L.slab1) + BAYS.upstand;
  if (tall > BAYS.across) throw Error('A bay stands on its end to print and would be ' + Math.round(tall) + ' mm high: at most ' + BAYS.across + ' mm, make the base or the storeys lower.');
  if (m.types.includes('podium') && m.balcony < 8) throw Error('A podium needs a balcony of at least 8 mm to stand on.');
  return m;
}

/** Heights and how far the glazing leans out, from the settings. */
export function pitBaysLevels(m) {
  const floor = m.baseHeight,
    slab0 = floor + m.groundHeight,
    slab1 = slab0 + BAYS.slab,
    roof0 = slab1 + m.upperHeight,
    roof1 = roof0 + BAYS.roof;
  const lean = m.upperHeight * Math.tan((m.lean * Math.PI) / 180);
  return { floor, door: floor + m.doorHeight, slab0, slab1, roof0, roof1, lean };
}

/** The railings of each bay: on its balcony, round its roof, as [id, name]. */
function railRuns(m, t, i) {
  const k = i + 1,
    out = [];
  if (m.balconyRailing && upper(t) && m.balcony > 0) {
    if (t === 'podium') out.push(['rail-' + k + '-1', 'Podium railing, left ' + k], ['rail-' + k + '-2', 'Podium railing, front ' + k], ['rail-' + k + '-3', 'Podium railing, right ' + k]);
    else out.push(['rail-' + k, 'Balcony railing ' + k]);
  }
  if (m.roofRailing) out.push(['roofback-' + k, 'Roof railing, back ' + k], ['roofleft-' + k, 'Roof railing, left ' + k], ['roofright-' + k, 'Roof railing, right ' + k]);
  return out;
}

/** The parts of a pit building, without geometry. */
export function pitBaysLayout(input) {
  const m = validatePitBays(input);
  const n = m.types.length;
  const name = (t) => BAY_TYPES.find(([id]) => id === t)[1].toLowerCase();
  const parts = m.types.map((t, i) => ({ id: 'bay-' + (i + 1), name: 'Bay ' + (i + 1) + ' of ' + n + ', ' + name(t), role: 'wall' }));
  parts.push({ id: 'end', name: 'End panel', role: 'wall' });
  for (let i = 0; i < n; i++) parts.push({ id: 'door-' + (i + 1), name: (m.door === 'panel' ? 'Up-and-over door ' : 'Roller door ') + (i + 1), role: 'door' });
  if (m.numbers) for (let i = 0; i < n; i++) parts.push({ id: 'number-' + (i + 1), name: 'Bay number ' + (m.firstNumber + i), role: 'frame' });
  if (m.text) parts.push({ id: 'name', name: 'Name board', role: 'frame' });
  m.types.forEach((t, i) => {
    if (t === 'podium') parts.push({ id: 'podium-' + (i + 1), name: 'Podium ' + (i + 1), role: 'floor' });
  });
  m.types.forEach((t, i) => parts.push(...railRuns(m, t, i).map(([id, nm]) => ({ id, name: nm, role: 'frame' }))));
  return { building: m, parts };
}

/** The pit building, built: each bay in its place along the row. */
export function buildPitBays(wasm, input) {
  const { Manifold, CrossSection } = wasm;
  const m = validatePitBays(input);
  const L = pitBaysLevels(m);
  const s = BAYS.shell,
    D = m.depth,
    W = m.bayWidth,
    F = BAYS.side,
    n = m.types.length;
  const temp = [];
  const own = (x) => (temp.push(x), x);
  const { box, poly, railing } = kitShapes(wasm, own);
  const rect = (y0, z0, y1, z1) => poly([[y0, z0], [y1, z0], [y1, z1], [y0, z1]]);
  const union = (list) => own(CrossSection.union(list.filter(Boolean)));
  // A profile in (y, z) stretched along x from x0 to x1.
  const run = (cs, x0, x1) => own(own(cs.extrude(x1 - x0)).transform([0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, x0, 0, 0, 1]));
  const parts = [];
  try {
    // The profiles of each type: what stands, and its outline closed (for the side at a bay's start).
    const gTop = m.setBack - L.lean; // the front of the glazing at its top
    const ground = rect(0, 0, D, L.slab1);
    const garage = rect(m.recess + s, -1, D - s, L.slab0);
    const pillar = m.pillars ? rect(-BAYS.pillar, 0, 0.01, L.slab0) : null;
    const balcony = m.balcony > 0 ? rect(-m.balcony, L.slab0, 0.01, L.slab1) : null;
    const back = rect(D - s, L.slab1 - 0.01, D, L.roof0 + 0.01);
    const roof = rect(-m.jut, L.roof0, D, L.roof1);
    const roofUp = rect(-m.jut, L.roof1 - 0.01, -m.jut + 4, L.roof1 + BAYS.upstand);
    const flatUp = rect(0, L.slab1 - 0.01, 4, L.slab1 + BAYS.upstand);
    const glazing = poly([[m.setBack, L.slab1 - 0.01], [m.setBack + s, L.slab1 - 0.01], [gTop + s, L.roof0 + 0.01], [gTop, L.roof0 + 0.01]]);
    // The fin: from a little in front of the foot of the glazing, widening up to the front of the roof.
    const fin = poly([[m.setBack - BAYS.fin, L.slab1 - 0.01], [D, L.slab1 - 0.01], [D, L.roof1], [-m.jut, L.roof1], [-m.jut, L.roof0]]);
    const boxBody = own(union([ground, balcony, glazing, back, roof, roofUp]).subtract(garage));
    const profile = { single: own(union([ground, flatUp]).subtract(garage)), box: boxBody, podium: boxBody };
    const closedBox = union([ground, balcony, fin, roofUp, pillar]);
    const closed = { single: union([ground, flatUp, pillar]), box: closedBox, podium: closedBox };
    // The door's reveal: through the front wall, its sides at 45°, as wide as the door at the back.
    const reveal = (cx) => {
      const r = m.recess + 1,
        h = m.doorWidth / 2;
      const cs = poly([[cx - h - r, -1], [cx + h + r, -1], [cx + h, m.recess], [cx - h, m.recess]]);
      return own(own(cs.extrude(m.doorHeight)).translate([0, 0, L.floor]));
    };
    // A pane: sunk into the leaning glazing, its sides at 45° into the glass, a sill and a head of 3 mm.
    const H = m.upperHeight,
      len = Math.hypot(L.lean, H);
    const tg = [-L.lean / len, H / len],
      ng = [H / len, L.lean / len]; // up the glass, into it
    const at = (u, d) => [m.setBack + tg[0] * u + ng[0] * d, L.slab1 + tg[1] * u + ng[1] * d];
    const pane = (a, b) => {
      const g = BAYS.glass;
      let cut = run(poly([at(3, -0.5), at(3, g), at(len - 3, g), at(len - 3, -0.5)]), a - 1, b + 1);
      const k = Math.hypot(1, ng[0], ng[1]),
        p0 = ng[0] * m.setBack + ng[1] * L.slab1;
      cut = own(cut.trimByPlane([1 / k, -ng[0] / k, -ng[1] / k], (a - p0) / k));
      return own(cut.trimByPlane([-1 / k, -ng[0] / k, -ng[1] / k], (-b - p0) / k));
    };
    const tabsAt = (i) => {
      const spots = [[D - s / 2, L.slab0 / 2]];
      if (upper(m.types[i]) && upper(m.types[i - 1])) spots.push([D - s / 2, (L.slab1 + L.roof0) / 2]);
      return spots;
    };
    const tabs = (spots, grow) => union(spots.map(([y, z]) => rect(y - BAYS.tab[0] / 2 - grow, z - BAYS.tab[1] / 2 - grow, y + BAYS.tab[0] / 2 + grow, z + BAYS.tab[1] / 2 + grow)));
    // A podium's platform: from the balcony's edge out, its sides at 45°.
    const [reach] = BAYS.podium;
    const platformAt = (x0, x1) => {
      const cs = poly([[x0, -m.balcony + 0.01], [x1, -m.balcony + 0.01], [x1 - reach, -m.balcony - reach], [x0 + reach, -m.balcony - reach]]);
      return own(own(cs.extrude(BAYS.slab)).translate([0, 0, L.slab0]));
    };
    const M = BAYS.mullion;
    for (let i = 0; i < n; i++) {
      const t = m.types[i];
      const x0 = i * W,
        x1 = x0 + W,
        cx = x0 + (W + F) / 2;
      let body = run(profile[t], x0, x1);
      // Its side at the start: closed, as tall as itself and the bay before it.
      const side = i ? union([closed[t], closed[m.types[i - 1]]]) : closed[t];
      body = own(body.add(run(side, x0, x0 + F)));
      if (t === 'podium') body = own(body.add(platformAt(x0 + F, x1)));
      const cuts = [reveal(cx)];
      if (upper(t)) cuts.push(pane(x0 + F + M, cx - M / 2), pane(cx + M / 2, x1 - M));
      body = own(body.subtract(own(Manifold.union(cuts))));
      // Tabs into the next bay, sockets for the one before.
      if (i < n - 1) body = own(body.add(run(tabs(tabsAt(i + 1), 0), x1 - 0.01, x1 + BAYS.tab[2])));
      if (i > 0) body = own(body.subtract(run(tabs(tabsAt(i), BAYS.tabPlay), x0 - 0.01, x0 + BAYS.tab[2] + 0.2)));
      parts.push({ id: 'bay-' + (i + 1), name: '', role: 'wall', solid: body, lie: [0, -90, 0], apart: [i * 10, 0, 0] });
    }
    const X = n * W;
    parts.push({ id: 'end', name: 'End panel', role: 'wall', solid: run(closed[m.types[n - 1]], X, X + F), lie: [0, -90, 0], apart: [n * 10 + 10, 0, 0] });
    // The doors: a plate at the back of each reveal, panels or the ribs of a roller door.
    for (let i = 0; i < n; i++) {
      const cx = i * W + (W + F) / 2,
        dx0 = cx - m.doorWidth / 2,
        dx1 = cx + m.doorWidth / 2;
      let plate = box(dx0, m.recess - BAYS.insert, L.floor, dx1, m.recess, L.door);
      const marks = [];
      if (m.door === 'panel') for (const k of [1, 2, 3]) marks.push(box(dx0 - 1, m.recess - BAYS.insert - 1, L.floor + (k * m.doorHeight) / 4 - 0.5, dx1 + 1, m.recess - BAYS.insert + 0.6, L.floor + (k * m.doorHeight) / 4 + 0.5));
      else for (let z = L.floor + 2.5; z + 1.6 <= L.door; z += 5) marks.push(box(dx0 + 0.5, m.recess - BAYS.insert - 1, z, dx1 - 0.5, m.recess - BAYS.insert + 0.01, z + 1.6));
      plate = m.door === 'panel' ? own(plate.subtract(own(Manifold.union(marks)))) : own(plate.add(own(Manifold.union(marks))));
      parts.push({ id: 'door-' + (i + 1), name: '', role: 'door', solid: plate, outward: [0, -1, 0], apart: [0, 20, 0] });
    }
    // A name board over the doors, in the middle of the row: on the front
    // wall, or where it reaches across a pillar between two garages, on the
    // fronts of the pillars, so it does not run through them.
    if (m.text) {
      const { solid, width, height } = nameBoard(wasm, own, m.text, nameBoardText(m.text, boardWide(m), L.slab0 - L.door - 2), m.textCut);
      const mid = (n * W + F) / 2;
      const across = m.pillars && Array.from({ length: n - 1 }, (_, i) => (i + 1) * W).some((x) => mid - width / 2 < x + F && mid + width / 2 > x);
      const y0 = across ? -BAYS.pillar : 0;
      parts.push({ id: 'name', name: 'Name board', role: 'frame', solid: own(solid.transform([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, mid, y0, (L.door + L.slab0) / 2 - height / 2, 1])), outward: [0, -1, 0], apart: [0, -12, 0] });
    }
    // Numbers: a plaque on the front wall over each door, its number raised in seven segments.
    if (m.numbers) {
      const [pw, ph, pt] = BAYS.plaque;
      for (let i = 0; i < n; i++) {
        const cx = i * W + (W + F) / 2,
          zc = (L.door + L.slab0) / 2;
        const B = (u0, v0, w0, u1, v1, w1) => box(u0, v0, w0, u1, v1, w1);
        const local = own(Manifold.union([B(-pw / 2, -ph / 2, 0, pw / 2, ph / 2, pt), ...sevenSegments(String(m.firstNumber + i), B, { cv: 0, dw: 4, dh: 5, st: 0.9, gap: 1.4, w0: pt - 0.01, w1: pt + 0.8 })]));
        // u along x, v up, w out of the front wall.
        parts.push({ id: 'number-' + (i + 1), name: '', role: 'frame', solid: own(local.transform([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, cx, 0, zc, 1])), outward: [0, -1, 0], apart: [0, -12, 0] });
      }
    }
    // A podium on each podium's platform: three blocks, the winner's in the middle.
    m.types.forEach((t, i) => {
      if (t !== 'podium') return;
      const [, blocks] = BAYS.podium;
      const cx = i * W + (W + F) / 2,
        yc = -m.balcony - 2,
        d = 10; // on the platform, clear of its railing
      const [[w1, h1], [w2, h2], [w3, h3]] = blocks;
      const solid = own(Manifold.union([box(cx - w1 / 2, yc - d / 2, L.slab1, cx + w1 / 2, yc + d / 2, L.slab1 + h1), box(cx - w1 / 2 - w2 + 0.01, yc - d / 2, L.slab1, cx - w1 / 2 + 0.01, yc + d / 2, L.slab1 + h2), box(cx + w1 / 2 - 0.01, yc - d / 2, L.slab1, cx + w1 / 2 + w3 - 0.01, yc + d / 2, L.slab1 + h3)]));
      parts.push({ id: 'podium-' + (i + 1), name: '', role: 'floor', solid, lie: [0, 0, 0], apart: [0, -10, 10] });
    });
    // Railings: bars along a balcony or round a podium's platform; a truss round the back and the sides of each roof.
    for (let i = 0; i < n; i++) {
      const t = m.types[i];
      const x0 = i * W + F,
        x1 = (i + 1) * W;
      const top = upper(t) ? L.roof1 : L.slab1,
        front = (upper(t) ? -m.jut : 0) + 4; // behind the upstand
      const BR = BAYS.balconyRail,
        RR = BAYS.roofRail;
      const side = RR.inset + RR.thick + 0.2;
      const runs = {};
      const y0 = -m.balcony;
      if (t === 'podium') {
        const a = [x0 + 0.1, y0],
          b = [x0 + reach, y0 - reach],
          c = [x1 - reach, y0 - reach],
          e = [x1 - 0.1, y0];
        const seg = (p, q) => {
          const dd = [q[0] - p[0], q[1] - p[1]],
            l = Math.hypot(...dd);
          const dir = [dd[0] / l, dd[1] / l];
          // In towards the building: the left of the way along, as the platform runs round.
          return { from: p, dir, len: l, inward: [-dir[1], dir[0]], z: L.slab1, spec: BR };
        };
        Object.assign(runs, { ['rail-' + (i + 1) + '-1']: seg(a, b), ['rail-' + (i + 1) + '-2']: seg(b, c), ['rail-' + (i + 1) + '-3']: seg(c, e) });
        for (const r of Object.values(runs)) {
          // Short of the corners, so two panels do not meet in one another.
          r.from = [r.from[0] + r.dir[0] * 3, r.from[1] + r.dir[1] * 3];
          r.len -= 6;
        }
      } else runs['rail-' + (i + 1)] = { from: [x0 + 0.1, y0], dir: [1, 0], len: x1 - x0 - 0.2, inward: [0, 1], z: L.slab1, spec: BR };
      runs['roofback-' + (i + 1)] = { from: [x1 - 0.1, D], dir: [-1, 0], len: x1 - x0 - 0.2, inward: [0, -1], z: top, spec: RR };
      runs['roofleft-' + (i + 1)] = { from: [x0, D - side], dir: [0, -1], len: D - side - front - 0.2, inward: [1, 0], z: top, spec: RR };
      runs['roofright-' + (i + 1)] = { from: [x1, front + 0.2], dir: [0, 1], len: D - side - front - 0.2, inward: [-1, 0], z: top, spec: RR };
      for (const [id] of railRuns(m, t, i)) {
        const r = runs[id];
        const { panel, pockets } = railing({ ...r, inset: r.spec.inset, spec: r.spec });
        parts[i].solid = own(parts[i].solid.subtract(own(Manifold.union(pockets))));
        parts.push({ id, name: '', role: 'frame', solid: panel, outward: [-r.inward[0], -r.inward[1], 0], apart: [-r.inward[0] * 10, -r.inward[1] * 10, 15] });
      }
    }
    // Their names, as laid out.
    const layout = pitBaysLayout(m).parts;
    const names = new Map(layout.map((p) => [p.id, p.name]));
    for (const p of parts) p.name = names.get(p.id) ?? p.name;
    const order = layout.map((p) => p.id);
    parts.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const keep = new Set(parts.map((p) => p.solid));
    for (const x of new Set(temp)) if (!keep.has(x)) x.delete();
    return parts;
  } catch (e) {
    for (const x of new Set(temp)) x.delete();
    throw e;
  }
}
