// A pit building made of modules, one for each bay, like a real modern pit
// building: a garage door set back between columns that stand out, a
// lintel over it, a balcony whose front edge is an angled fascia, a lounge
// whose glazing leans out at the top, a roof with a visor sloping up to
// its edge, and railings on the balcony and round the roof. Each bay is the
// building's side profile stretched to the bay's width and prints standing
// on its end, the profile on the plate: every angle in it prints straight
// up. The bays join end to end with two tabs in the back wall; the first
// bay is closed at its start, the far end has a panel of its own. The
// doors, the number plaques and the railings are flat parts glued on.
// x along the row, y from the front of the columns back (the pit lane at
// negative y), z up.

import { kitShapes } from './kit-shapes.js';

export const PIT_MODULE_DEFAULTS = Object.freeze({
  kind: 'pitmodule',
  bays: 3,
  bayWidth: 110,
  depth: 150, // from the front of the columns to the back of the back wall
  baseHeight: 10, // as high as the track, so the doorstep is level with the road
  groundHeight: 65, // from the floor to the underside of the balcony
  doorWidth: 82,
  doorHeight: 52,
  recess: 8, // the doors set back behind the columns
  door: 'panel', // 'panel' or 'roller'
  balcony: 25, // how far the balcony reaches out over the lane
  loungeHeight: 50,
  lean: 15, // degrees the glazing leans out at the top
  visor: 12, // how far the roof reaches out beyond the top of the glazing
  railing: true, // along the front of the balcony
  roofRailing: true, // front and back of the roof
  numbers: true,
  firstNumber: 1,
});
export const PIT_MODULE_LIMITS = Object.freeze({
  bays: [1, 24],
  bayWidth: [70, 200],
  depth: [60, 300],
  baseHeight: [4, 40],
  groundHeight: [45, 120],
  doorWidth: [30, 180],
  doorHeight: [25, 110],
  recess: [3, 15],
  balcony: [8, 40],
  loungeHeight: [30, 90],
  lean: [0, 25],
  visor: [0, 30],
  firstNumber: [0, 76],
});
export const PIT = Object.freeze({
  shell: 3,
  slab: 4, // the balcony floor
  fascia: 8, // the fascia: as high at the front edge
  roof: 4,
  column: 4, // at least this much column at each end of a bay, beside the door's reveal
  glass: 0.8, // the panes of the lounge, set into the glazing
  mullion: 5, // the frame between panes, and at the ends of a bay
  insert: 2, // a door, its plate
  tab: [1.8, 8, 4],
  tabPlay: 0.15,
  plaque: [18, 7, 1.5],
  railBalcony: 2.5, // the balcony railing stands back from the edge, where the fascia slopes away under it
  rail: { height: 15, thick: 3, band: 4, post: 3, pitch: 20, inset: 1, tab: 1.2 },
});
const LABELS = {
  bays: 'Bays',
  bayWidth: 'Bay width',
  depth: 'Depth',
  baseHeight: 'Base height',
  groundHeight: 'Ground floor height',
  doorWidth: 'Door width',
  doorHeight: 'Door height',
  recess: 'Door set back',
  balcony: 'Balcony',
  loungeHeight: 'Lounge height',
  lean: 'Glazing lean',
  visor: 'Visor',
  firstNumber: 'First number',
};

/** The pit building as kept: known settings only, each checked. */
export function validatePitModule(input) {
  const m = { ...PIT_MODULE_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(m)) if (!Object.hasOwn(PIT_MODULE_DEFAULTS, key)) throw Error('The pit building has an unknown setting: ' + key + '.');
  for (const [key, [min, max]] of Object.entries(PIT_MODULE_LIMITS))
    if (!Number.isFinite(m[key]) || m[key] < min || m[key] > max)
      throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + (['bays', 'firstNumber'].includes(key) ? '' : key === 'lean' ? '°' : ' mm') + '.');
  if (!Number.isInteger(m.bays) || !Number.isInteger(m.firstNumber)) throw Error('Bays and the first number are whole numbers.');
  if (!['panel', 'roller'].includes(m.door)) throw Error('Choose an up-and-over or a roller door.');
  for (const key of ['railing', 'roofRailing', 'numbers']) if (typeof m[key] !== 'boolean') throw Error('Choose whether the pit building has ' + key + '.');
  const room = m.bayWidth - 2 * (PIT.column + m.recess + 1);
  if (m.doorWidth > room) throw Error('The door is too wide for a bay of ' + m.bayWidth + ' mm with its reveal: at most ' + room + ' mm.');
  if (m.doorHeight > m.groundHeight - 8) throw Error('The door is too high for the ground floor: at most ' + (m.groundHeight - 8) + ' mm.');
  if (m.depth < m.recess + 3 * PIT.shell + 20) throw Error('The pit building must be at least ' + (m.recess + 3 * PIT.shell + 20) + ' mm deep.');
  return m;
}

/** Heights and the front of the lounge, from the settings. */
export function pitLevels(m) {
  const floor = m.baseHeight,
    slab0 = floor + m.groundHeight,
    slab1 = slab0 + PIT.slab,
    roof0 = slab1 + m.loungeHeight,
    roof1 = roof0 + PIT.roof;
  const lean = m.loungeHeight * Math.tan((m.lean * Math.PI) / 180);
  return { floor, door: floor + m.doorHeight, slab0, slab1, roof0, roof1, lean, front: -Math.max(m.balcony, lean + m.visor) };
}

/** The parts of a pit building, without geometry. */
export function pitModuleLayout(input) {
  const m = validatePitModule(input);
  const parts = [];
  for (let i = 0; i < m.bays; i++) parts.push({ id: 'bay-' + (i + 1), name: 'Bay ' + (i + 1) + ' of ' + m.bays, role: 'wall' });
  parts.push({ id: 'end', name: 'End panel', role: 'wall' });
  for (let i = 0; i < m.bays; i++) parts.push({ id: 'door-' + (i + 1), name: (m.door === 'panel' ? 'Up-and-over door ' : 'Roller door ') + (i + 1), role: 'door' });
  if (m.numbers) for (let i = 0; i < m.bays; i++) parts.push({ id: 'number-' + (i + 1), name: 'Bay number ' + (m.firstNumber + i), role: 'frame' });
  for (let i = 0; i < m.bays; i++) {
    if (m.railing) parts.push({ id: 'rail-' + (i + 1), name: 'Balcony railing ' + (i + 1), role: 'frame' });
    if (m.roofRailing) {
      parts.push({ id: 'roofrail-' + (i + 1), name: 'Roof railing, front ' + (i + 1), role: 'frame' });
      parts.push({ id: 'roofback-' + (i + 1), name: 'Roof railing, back ' + (i + 1), role: 'frame' });
    }
  }
  return { building: m, parts };
}

const SEGMENTS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];

/**
 * A number in seven segments, as boxes made by `box(u0, v0, w0, u1, v1, w1)`:
 * digits dw wide and dh high, strokes st thick, gap apart, centred on
 * (cu, cv), standing from w0 to w1.
 */
export function sevenSegments(text, box, { cu = 0, cv, dw, dh, st, gap, w0, w1 }) {
  const total = text.length * dw + (text.length - 1) * gap;
  const bits = [];
  [...text].forEach((ch, k) => {
    const x = cu - total / 2 + k * (dw + gap),
      zz = cv - dh / 2;
    const seg = { a: [x, zz + dh - st, x + dw, zz + dh], g: [x, zz + dh / 2 - st / 2, x + dw, zz + dh / 2 + st / 2], d: [x, zz, x + dw, zz + st], f: [x, zz + dh / 2, x + st, zz + dh], b: [x + dw - st, zz + dh / 2, x + dw, zz + dh], e: [x, zz, x + st, zz + dh / 2], c: [x + dw - st, zz, x + dw, zz + dh / 2] };
    for (const name of SEGMENTS[Number(ch)]) {
      const [u0, v0, u1, v1] = seg[name];
      bits.push(box(u0, v0, w0, u1, v1, w1));
    }
  });
  return bits;
}

/** The pit building, built: each bay in its place along the row. */
export function buildPitModule(wasm, input) {
  const { Manifold, CrossSection } = wasm;
  const m = validatePitModule(input);
  const L = pitLevels(m);
  const s = PIT.shell,
    D = m.depth,
    W = m.bayWidth;
  const temp = [];
  const own = (x) => (temp.push(x), x);
  // An outline, whichever way round it is written: counter-clockwise, or it would be empty.
  const poly = (pts) => {
    let twice = 0;
    for (let i = 0; i < pts.length; i++) twice += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
    return own(new CrossSection([twice < 0 ? [...pts].reverse() : pts], 'Positive'));
  };
  const rect = (y0, z0, y1, z1) => poly([[y0, z0], [y1, z0], [y1, z1], [y0, z1]]);
  const union = (list) => own(CrossSection.union(list));
  // A profile in (y, z) stretched along x from x0 to x1.
  const run = (cs, x0, x1) => own(own(cs.extrude(x1 - x0)).transform([0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, x0, 0, 0, 1]));
  const box = (x0, y0, z0, x1, y1, z1) => own(Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]));
  const parts = [];
  try {
    const bal = m.balcony,
      gTop = -L.lean; // the front of the glazing at its top
    // The profile, in pieces that the bays share.
    const back = rect(D - s, 0, D, L.roof1);
    const slab = union([rect(0, L.slab0, D, L.slab1), poly([[0, L.slab0 - PIT.fascia + PIT.slab], [-bal + 6, L.slab0 - PIT.fascia + PIT.slab], [-bal, L.slab1], [0, L.slab1]])]);
    const roof = union([rect(gTop, L.roof0, D, L.roof1), poly([[gTop - m.visor, L.roof1 - 2.5], [gTop, L.roof0], [gTop, L.roof1], [gTop - m.visor, L.roof1]])]);
    // The glazing: a band leaning out from the balcony to the roof.
    const glazing = poly([[0, L.slab1], [s, L.slab1], [s + gTop, L.roof0], [gTop, L.roof0]]);
    // Hollow: the ground floor behind the doors, open to the table; the lounge behind its glass.
    const hollow = union([
      rect(m.recess + s, -1, D - s, L.slab0),
      poly([[s + 0.01, L.slab1], [D - s, L.slab1], [D - s, L.roof0], [s + gTop + 0.01, L.roof0]]),
    ]);
    const closed = own(union([rect(0, 0, D, L.slab0), slab, glazing, roof, back]));
    const profile = own(closed.subtract(hollow));
    // The door's reveal: set back between the columns, its sides at 45°, so
    // the opening is wider at the front than at the door and every face
    // prints standing. The doorway is as wide as the door at the back.
    const reveal = (cx) => {
      const r = m.recess + 1,
        h = m.doorWidth / 2;
      const cs = poly([[cx - h - r, -1], [cx + h + r, -1], [cx + h, m.recess], [cx - h, m.recess]]);
      return own(own(cs.extrude(m.doorHeight)).translate([0, 0, L.floor]));
    };
    // A pane: set in the glazing by PIT.glass, its sides at 45° into the
    // glass, between a sill and a head of 3 mm.
    const H = m.loungeHeight,
      len = Math.hypot(L.lean, H);
    const t = [-L.lean / len, H / len],
      n = [H / len, L.lean / len]; // up the glass, into it
    const at = (u, d) => [t[0] * u + n[0] * d, L.slab1 + t[1] * u + n[1] * d];
    const pane = (a, b) => {
      const g = PIT.glass,
        u0 = 3,
        u1 = len - 3;
      let cut = run(poly([at(u0, -0.5), at(u0, g), at(u1, g), at(u1, -0.5)]), a - 1, b + 1);
      const k = Math.hypot(1, n[0], n[1]),
        p0 = n[1] * L.slab1;
      cut = own(cut.trimByPlane([1 / k, -n[0] / k, -n[1] / k], (a - p0) / k));
      return own(cut.trimByPlane([-1 / k, -n[0] / k, -n[1] / k], (-b - p0) / k));
    };
    const M = PIT.mullion;
    const tabs = (grow) => [
      [D - s / 2, L.slab0 / 2],
      [D - s / 2, (L.slab1 + L.roof0) / 2],
    ].map(([y, z]) => rect(y - PIT.tab[0] / 2 - grow, z - PIT.tab[1] / 2 - grow, y + PIT.tab[0] / 2 + grow, z + PIT.tab[1] / 2 + grow));
    for (let i = 0; i < m.bays; i++) {
      const x0 = i * W,
        x1 = x0 + W,
        cx = x0 + W / 2;
      // The bay: the profile stretched to its width, the door's reveal and
      // two panes cut in, a mullion at each end and in the middle.
      let body = run(profile, x0, x1);
      body = own(body.subtract(own(Manifold.union([reveal(cx), pane(x0 + M, cx - M / 2), pane(cx + M / 2, x1 - M)]))));
      // Tabs into the next bay, sockets for the one before; the first bay closed at its start.
      if (i < m.bays - 1) body = own(body.add(run(union(tabs(0)), x1 - 0.01, x1 + PIT.tab[2])));
      if (i > 0) body = own(body.subtract(run(union(tabs(PIT.tabPlay)), x0 - 0.01, x0 + PIT.tab[2] + 0.2)));
      if (i === 0) body = own(body.add(run(closed, x0, x0 + s)));
      parts.push({ id: 'bay-' + (i + 1), name: 'Bay ' + (i + 1) + ' of ' + m.bays, role: 'wall', solid: body, lie: [0, -90, 0], apart: [i * 10, 0, 0] });
    }
    const X = m.bays * W;
    parts.push({ id: 'end', name: 'End panel', role: 'wall', solid: run(closed, X, X + s), lie: [0, -90, 0], apart: [m.bays * 10 + 10, 0, 0] });
    // The doors: a plate in each recess, panels or the ribs of a roller door, facing out.
    for (let i = 0; i < m.bays; i++) {
      const cx = i * W + W / 2,
        dx0 = cx - m.doorWidth / 2,
        dx1 = cx + m.doorWidth / 2;
      let plate = box(dx0, m.recess - PIT.insert, L.floor, dx1, m.recess, L.door);
      const marks = [];
      if (m.door === 'panel') for (const k of [1, 2, 3]) marks.push(box(dx0 - 1, m.recess - PIT.insert - 1, L.floor + (k * m.doorHeight) / 4 - 0.5, dx1 + 1, m.recess - PIT.insert + 0.6, L.floor + (k * m.doorHeight) / 4 + 0.5));
      else for (let z = L.floor + 2.5; z + 1.6 <= L.door; z += 5) marks.push(box(dx0 + 0.5, m.recess - PIT.insert - 1, z, dx1 - 0.5, m.recess - PIT.insert + 0.01, z + 1.6));
      plate = m.door === 'panel' ? own(plate.subtract(own(Manifold.union(marks)))) : own(plate.add(own(Manifold.union(marks))));
      parts.push({ id: 'door-' + (i + 1), name: (m.door === 'panel' ? 'Up-and-over door ' : 'Roller door ') + (i + 1), role: 'door', solid: plate, outward: [0, -1, 0], apart: [0, 20, 0] });
    }
    // Bay numbers: a plaque on the angled fascia of the balcony, over each door, its number raised in seven segments.
    if (m.numbers) {
      const [pw, ph, pt] = PIT.plaque;
      const z0 = L.slab0 - PIT.fascia + PIT.slab,
        y0 = -bal + 6;
      // The fascia's plane: up it from (y0, z0) to (-bal, slab1).
      const up = [0, -6, L.slab1 - z0],
        ul = Math.hypot(up[1], up[2]);
      const v = [0, up[1] / ul, up[2] / ul],
        n = [0, -v[2], v[1]]; // out of the fascia, towards the lane
      for (let i = 0; i < m.bays; i++) {
        const number = String(m.firstNumber + i);
        const cx = i * W + W / 2;
        const B = (u0, v0, w0, u1, v1, w1) => own(Manifold.cube([u1 - u0, v1 - v0, w1 - w0]).translate([u0, v0, w0]));
        const bits = [B(-pw / 2, (ul - ph) / 2, 0, pw / 2, (ul + ph) / 2, pt), ...sevenSegments(number, B, { cv: ul / 2, dw: 4, dh: 5, st: 0.9, gap: 1.4, w0: pt - 0.01, w1: pt + 0.8 })];
        const local = own(Manifold.union(bits));
        // u along x, v up the fascia, w out of it.
        const placed = own(local.transform([1, 0, 0, 0, ...v, 0, ...n, 0, cx, y0, z0, 1]));
        const deg = (Math.atan2(n[1], n[2]) * 180) / Math.PI;
        parts.push({ id: 'number-' + (i + 1), name: 'Bay number ' + number, role: 'frame', solid: placed, lie: [deg, 0, 0], apart: [0, -12, 0] });
      }
    }
    // Railings: flat panels, a solid band, posts and a top rail, two tabs
    // down into pockets: along the front of the balcony and round the roof.
    const R = PIT.rail;
    const { railing: panelAlong } = kitShapes(wasm, own);
    const railing = (x0, x1, y, z, out, inset = R.inset) => panelAlong({ from: [x0, y], dir: [1, 0], len: x1 - x0, inward: [0, out < 0 ? 1 : -1], z, inset, spec: R });
    const railings = [];
    for (let i = 0; i < m.bays; i++) {
      const x0 = i * W + 0.1,
        x1 = (i + 1) * W - 0.1;
      if (m.railing) railings.push({ id: 'rail-' + (i + 1), name: 'Balcony railing ' + (i + 1), ...railing(x0, x1, -bal, L.slab1, -1, PIT.railBalcony), out: [0, -1, 0], on: 'bay' });
      if (m.roofRailing) {
        railings.push({ id: 'roofrail-' + (i + 1), name: 'Roof railing, front ' + (i + 1), ...railing(x0, x1, gTop - m.visor, L.roof1, -1), out: [0, -1, 0], on: 'bay' });
        railings.push({ id: 'roofback-' + (i + 1), name: 'Roof railing, back ' + (i + 1), ...railing(x0, x1, D, L.roof1, 1), out: [0, 1, 0], on: 'bay' });
      }
    }
    // Their pockets go into the bays they stand on: each railing on its own bay.
    for (const r of railings) {
      const k = Number(r.id.split('-').at(-1)) - 1;
      const bay = parts[k];
      bay.solid = own(bay.solid.subtract(own(Manifold.union(r.pockets))));
      parts.push({ id: r.id, name: r.name, role: 'frame', solid: r.panel, outward: r.out, apart: [0, r.out[1] * 10, 15] });
    }
    const keep = new Set(parts.map((p) => p.solid));
    for (const x of new Set(temp)) if (!keep.has(x)) x.delete();
    return parts;
  } catch (e) {
    for (const x of new Set(temp)) x.delete();
    throw e;
  }
}
