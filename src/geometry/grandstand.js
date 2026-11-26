// A grandstand: rows of seats stepping up from the front, a parapet in
// front of the first row, a back wall, aisles with half steps, and a canopy
// roof on posts if wanted. Straight, or curved round a corner. It is a
// hollow stepped shell, 3 mm thick, cut into sections that each print
// standing on their end: the stepped side lies on the plate and the rows
// rise straight up, so nothing overhangs. The sections join end to end with
// two small tabs; the roof and its posts print flat. Toy proportions for 1:32.

export const GRANDSTAND_DEFAULTS = Object.freeze({
  kind: 'grandstand',
  length: 240, // along the front, at the front for a curved stand
  rows: 6,
  rowDepth: 18,
  rowRise: 9,
  frontHeight: 12, // the first row above the table
  seats: true, // a bench on each row
  aisles: 1, // aisles with half steps, spread evenly
  backHeight: 15, // the back wall above the last row
  roof: 'none', // 'none' or 'canopy'
  roofHeight: 50, // the canopy above the last row
  curve: null, // { radius: at the front, angle: degrees, facing: 'in' | 'out' }
  sectionLength: 120, // the longest section, as it stands on the plate
});
export const GRANDSTAND_LIMITS = Object.freeze({
  length: [60, 1500],
  rows: [1, 20],
  rowDepth: [12, 40],
  rowRise: [5, 25],
  frontHeight: [6, 60],
  aisles: [0, 12],
  backHeight: [6, 60],
  roofHeight: [30, 120],
  sectionLength: [40, 300],
});
export const STAND = Object.freeze({
  shell: 3, // the stepped shell, the parapet and the back wall
  parapet: 8, // above the first row
  bench: [7, 4], // a bench: deep, high, at the back of each row
  aisle: 16, // an aisle, wide
  tab: [1.8, 8, 4], // a tab between two sections: thick, high, long
  tabPlay: 0.15,
  post: 4, // a canopy post, square
  roof: 3, // the canopy, thick
  reach: 6, // the canopy beyond the front row
});
const LABELS = {
  length: 'Length',
  rows: 'Rows',
  rowDepth: 'Row depth',
  rowRise: 'Row rise',
  frontHeight: 'Front row height',
  aisles: 'Aisles',
  backHeight: 'Back wall height',
  roofHeight: 'Canopy height',
  sectionLength: 'Section length',
};

/** The grandstand as kept: known settings only, each checked. */
export function validateGrandstand(input) {
  const g = { ...GRANDSTAND_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(g)) if (!Object.hasOwn(GRANDSTAND_DEFAULTS, key)) throw Error('The grandstand has an unknown setting: ' + key + '.');
  for (const [key, [min, max]] of Object.entries(GRANDSTAND_LIMITS))
    if (!Number.isFinite(g[key]) || g[key] < min || g[key] > max) throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + (key === 'rows' || key === 'aisles' ? '' : ' mm') + '.');
  if (!Number.isInteger(g.rows) || !Number.isInteger(g.aisles)) throw Error('Rows and aisles are whole numbers.');
  if (typeof g.seats !== 'boolean') throw Error('Choose whether the rows have benches.');
  if (!['none', 'canopy'].includes(g.roof)) throw Error('Choose a roof for the grandstand from the list.');
  if (g.curve !== null) {
    const c = g.curve;
    if (!c || typeof c !== 'object' || Object.keys(c).some((k) => !['radius', 'angle', 'facing'].includes(k))) throw Error('The curve of the grandstand is not readable.');
    if (!Number.isFinite(c.radius) || c.radius < 100 || c.radius > 3000) throw Error('The radius must be between 100 and 3000 mm.');
    if (!Number.isFinite(c.angle) || c.angle < 10 || c.angle > 180) throw Error('The angle must be between 10 and 180°.');
    if (!['in', 'out'].includes(c.facing)) throw Error('Choose which way the curved grandstand faces.');
    const depth = standDepth(g);
    if (c.facing === 'out' && c.radius - depth < 30) throw Error('Facing out of the curve, the radius must be at least ' + Math.ceil(depth + 30) + ' mm for these rows.');
    // Its length follows from the curve: along the front.
    g.length = Math.round(((c.radius * c.angle * Math.PI) / 180) * 10) / 10;
    g.curve = { ...c };
  }
  const room = (g.length - g.aisles * STAND.aisle) / (g.aisles + 1);
  if (room < 20) throw Error('Too many aisles for a grandstand ' + g.length + ' mm long: at most ' + Math.max(0, Math.floor((g.length - 20) / (STAND.aisle + 20))) + '.');
  return g;
}

/** A building's size in a line: a garage's outside, a grandstand's rows and length. */
export function sizeLine(b) {
  if (b.kind === 'gantry') return { start: 'Start gantry', half: 'Half gantry', bridge: 'Footbridge' }[b.type] + ' · span ' + Math.round(b.span) + ' mm';
  if (b.kind === 'pitmodule') return b.bays + (b.bays === 1 ? ' bay' : ' bays') + ' · ' + Math.round(b.bays * b.bayWidth + 3) + ' × ' + Math.round(b.depth) + ' mm';
  if (b.kind !== 'grandstand') return Math.round(b.width) + ' × ' + Math.round(b.depth) + ' mm';
  return b.rows + ' rows · ' + Math.round(b.length) + ' mm' + (b.curve ? ' · curved' : '');
}

/** How deep the stand is, from the front of the parapet to the back of its back wall. */
export const standDepth = (g) => STAND.shell + g.rows * g.rowDepth + STAND.shell;
/** How high its back wall stands: above the last row, or up to the canopy. */
export const standHeight = (g) => g.frontHeight + (g.rows - 1) * g.rowRise + (g.roof === 'canopy' ? g.roofHeight : g.backHeight);

/**
 * The side profile of the stand, in (y from the front, z up): the hollow
 * stepped shell with its parapet and back wall, open underneath, and on
 * top of it the benches, or in an aisle the half steps.
 */
export function profile(g, aisle = false) {
  const s = STAND.shell;
  const rects = [];
  const row = (i) => ({ y0: s + i * g.rowDepth, y1: s + (i + 1) * g.rowDepth, z: g.frontHeight + i * g.rowRise });
  // The solid under the rows, the parapet and the back wall; hollowed below.
  const solid = [[0, 0, s, g.frontHeight + STAND.parapet]];
  for (let i = 0; i < g.rows; i++) {
    const r = row(i);
    solid.push([r.y0, 0, r.y1, r.z]);
  }
  const back = s + g.rows * g.rowDepth;
  solid.push([back, 0, back + s, standHeight(g)]);
  // The hollow under the rows, open to the table: under each row less the
  // shell of its tread, and of its riser, the step up from the row before;
  // under the riser, as high as the row before reaches.
  const hollow = [];
  for (let i = 0; i < g.rows; i++) {
    const r = row(i);
    const y1 = r.y1 + 0.01;
    if (r.z - s > 0.5) hollow.push([i === 0 ? s : r.y0 + s, -1, y1, r.z - s]);
    if (i > 0) {
      const below = row(i - 1).z - s;
      if (below > 0.5) hollow.push([r.y0 - 0.01, -1, r.y0 + s + 0.01, below]);
    }
  }
  // The benches, or the half steps of an aisle.
  for (let i = 0; i < g.rows; i++) {
    const r = row(i);
    if (aisle) rects.push([r.y0 + g.rowDepth / 2, r.z - 0.01, r.y1, r.z + g.rowRise / 2]);
    else if (g.seats) rects.push([r.y1 - STAND.bench[0], r.z - 0.01, r.y1, r.z + STAND.bench[1]]);
  }
  return { solid, hollow, top: rects };
}

/** The parts of a grandstand, without geometry: its sections, and the canopy and its posts. */
export function grandstandLayout(input) {
  const g = validateGrandstand(input);
  const sections = sectionSpans(g);
  const parts = sections.map((_, i) => ({ id: 'stand-' + (i + 1), name: 'Grandstand section ' + (i + 1) + ' of ' + sections.length, role: 'wall' }));
  parts.push({ id: 'end', name: 'End panel', role: 'wall' });
  if (g.roof === 'canopy') {
    canopySpans(g).forEach((_, i, all) => parts.push({ id: 'canopy-' + (i + 1), name: 'Canopy' + (all.length > 1 ? ' ' + (i + 1) + ' of ' + all.length : ''), role: 'roof' }));
    postPlaces(g).forEach((_, i) => parts.push({ id: 'post-' + (i + 1), name: 'Canopy post ' + (i + 1), role: 'frame' }));
  }
  return { building: g, parts, sections };
}

/** Where the aisles are along the front: [from, to] each, spread evenly. */
export function aisleSpans(g) {
  const out = [];
  const step = (g.length - g.aisles * STAND.aisle) / (g.aisles + 1);
  for (let k = 0; k < g.aisles; k++) {
    const from = step * (k + 1) + STAND.aisle * k;
    out.push([from, from + STAND.aisle]);
  }
  return out;
}

/**
 * The sections the stand is cut into, as [from, to] along the front: no
 * longer than sectionLength (along the back for a curve facing in, where
 * it is longest), the cuts kept out of the aisles.
 */
export function sectionSpans(g) {
  const longest = g.curve ? (g.curve.facing === 'in' ? (g.curve.radius + standDepth(g)) / g.curve.radius : 1) : 1;
  // Its tab reaches into the next section: that counts too.
  const most = g.sectionLength / longest - STAND.tab[2];
  const aisles = aisleSpans(g);
  for (let n = Math.max(1, Math.ceil(g.length / most - 1e-9)); ; n++) {
    const cuts = [];
    for (let i = 1; i < n; i++) {
      let at = (i * g.length) / n;
      // Out of an aisle: to its nearer side, by a little.
      for (const [a, b] of aisles) if (at > a - 1 && at < b + 1) at = at - a < b - at ? a - 1 : b + 1;
      cuts.push(at);
    }
    const edges = [0, ...cuts, g.length];
    const spans = edges.slice(0, -1).map((v, i) => [v, edges[i + 1]]);
    if (spans.every(([a, b]) => b - a <= most + 1e-9) || n > 200) return spans;
  }
}

/** The canopy in pieces no longer than a section. */
export const canopySpans = (g) => sectionSpans(g);
/** Where the canopy posts stand, along the front: at both ends and at every section joint. */
export function postPlaces(g) {
  const spans = sectionSpans(g);
  return [0, ...spans.map(([, b]) => b)].map((at, i, all) => (i === 0 ? at + STAND.post : i === all.length - 1 ? at - STAND.post : at));
}

/**
 * The grandstand, built: each section in its place, x along the front from
 * its left end (for a curve, the arc unrolled onto the curve), y from the
 * front back, z up. Parts as the building kit has them.
 */
export function buildGrandstand(wasm, input) {
  const { Manifold, CrossSection } = wasm;
  const { building: g, sections } = grandstandLayout(input);
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const cs = (rects) => own(new CrossSection(rects.map(([a, b, c, d]) => [[a, b], [c, b], [c, d], [a, d]]), 'Positive'));
  const parts = [];
  try {
    // The shell with its benches; or, for an aisle, bare: its half steps are added each on its own.
    const shape = (aisle, withTop = true) => {
      const p = profile(g, aisle);
      let section = p.hollow.length ? own(cs(p.solid).subtract(cs(p.hollow))) : cs(p.solid);
      if (withTop && p.top.length) section = own(section.add(cs(p.top)));
      return section;
    };
    const halfSteps = profile(g, true).top;
    const plain = shape(false),
      bare = shape(true, false);
    // The profile closed, for the ends: the shell without its hollow.
    const closed = (() => {
      const p = profile(g, false);
      return p.top.length ? own(cs(p.solid).add(cs(p.top))) : cs(p.solid);
    })();
    const aisles = aisleSpans(g);
    const D = standDepth(g),
      H = standHeight(g);
    // The stretches of one section: seats and aisles, each its own profile.
    const stretches = ([a, b]) => {
      const out = [];
      let at = a;
      for (const [p, q] of aisles) {
        if (q <= a || p >= b) continue;
        if (p > at) out.push([at, p, false]);
        out.push([Math.max(p, a), Math.min(q, b), true]);
        at = Math.min(q, b);
      }
      if (at < b) out.push([at, b, false]);
      return out;
    };
    // A straight run of the profile from x0 to x1: the profile in (y, z), along x.
    const straightRun = (section, x0, x1) =>
      own(own(section.extrude(x1 - x0)).transform([0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, x0, 0, 0, 1]));
    // On a curve: the profile in (r, z) turned round the centre through the
    // angle of the stretch. Facing in, the front is at the radius; facing
    // out, the back is, and the profile is mirrored.
    const R = g.curve?.radius ?? 0;
    const radial = (section) => {
      if (g.curve.facing === 'in') return own(section.translate([R, 0]));
      return own(own(section.mirror([1, 0])).translate([R, 0]));
    };
    const curvedRun = (section, x0, x1) => {
      const deg = ((x1 - x0) / R) * (180 / Math.PI);
      const swept = own(Manifold.revolve(radial(section), Math.max(3, Math.ceil(deg / 2)), deg));
      return own(swept.rotate([0, 0, (x0 / R) * (180 / Math.PI)]));
    };
    const run = g.curve ? curvedRun : straightRun;
    // The tabs that join one section to the next: in the back wall and in
    // the parapet, reaching from the end of a section into the next.
    const [tt, th, tl] = STAND.tab,
      pl = STAND.tabPlay;
    const tabProfile = (grow) =>
      cs([
        [STAND.shell / 2 - tt / 2 - grow, (g.frontHeight + STAND.parapet) / 2 - th / 2 - grow, STAND.shell / 2 + tt / 2 + grow, (g.frontHeight + STAND.parapet) / 2 + th / 2 + grow],
        [D - STAND.shell / 2 - tt / 2 - grow, H / 2 - th / 2 - grow, D - STAND.shell / 2 + tt / 2 + grow, H / 2 + th / 2 + grow],
      ]);
    const tabs = tabProfile(0),
      sockets = tabProfile(pl);
    sections.forEach(([a, b], i) => {
      // An aisle: the bare rows, and on each a half step. A section prints
      // standing on its start, so where an aisle begins its half steps would
      // stand out over the row below them: each begins with a 45° slope.
      const aisleRun = (p, q, from = p) => {
        const pieces = [run(bare, p, q)];
        for (const [y0, z0, y1, z1] of halfSteps) {
          let step = run(cs([[y0, z0, y1, z1]]), p, q);
          if (g.curve) {
            const th = from / R;
            step = own(step.trimByPlane([-Math.sin(th), Math.cos(th), -1], -z0 / Math.SQRT2));
          } else step = own(step.trimByPlane([1, 0, -1], (from - z0) / Math.SQRT2));
          if (!step.isEmpty()) pieces.push(step);
        }
        return own(Manifold.union(pieces));
      };
      // Each stretch overlaps the next a hair, so on a curve two never meet face to face.
      const eps = 0.02;
      let body = own(
        Manifold.union(stretches([a, b]).map(([p, q, aisle]) => {
          const p0 = p > a ? p - eps : p,
            q0 = q < b ? q + eps : q;
          return aisle ? aisleRun(p0, q0, p) : run(plain, p0, q0);
        })),
      );
      if (i < sections.length - 1) body = own(body.add(run(tabs, b - 0.01, b + tl)));
      if (i > 0) body = own(body.subtract(run(sockets, a - 0.01, a + tl + 0.2)));
      // The first section is closed at its start, the end it prints on.
      if (i === 0) body = own(body.add(run(closed, a, a + STAND.shell)));
      // Where a slope meets a facet of a curve it can leave a speck of nothing: only the section is kept.
      const bodies = body.decompose();
      if (bodies.length > 1) {
        const kept = bodies.filter((piece) => piece.volume() > 1);
        for (const piece of bodies) if (!kept.includes(piece)) piece.delete();
        kept.forEach(own);
        body = kept.length === 1 ? kept[0] : own(Manifold.union(kept));
      } else bodies[0].delete();
      // It prints standing on its end: on a curve, its start turned to lie on the plate.
      const startDeg = g.curve ? (a / R) * (180 / Math.PI) : 0;
      parts.push({
        id: 'stand-' + (i + 1),
        name: 'Grandstand section ' + (i + 1) + ' of ' + sections.length,
        role: 'wall',
        solid: body,
        // Straight: its start face down. Curved: turned so its start lies along x, then stood up on it.
        ...(g.curve ? { turn: [-startDeg, 90] } : { lie: [0, -90, 0] }),
        apart: g.curve ? [0, 0, 0] : [i * 8, 0, 0],
      });
    });
    // The far end closed by a panel of its own, glued on: printed on the
    // section it would have to bridge the hollow, so it prints flat.
    {
      const end = run(closed, g.length, g.length + STAND.shell);
      const endDeg = g.curve ? (g.length / R) * (180 / Math.PI) : 0;
      parts.push({ id: 'end', name: 'End panel', role: 'wall', solid: end, ...(g.curve ? { turn: [-endDeg, 90] } : { lie: [0, -90, 0] }), apart: g.curve ? [0, 0, 0] : [16, 0, 0] });
    }
    // The canopy: a plate over the rows on posts at the back, held by the back wall.
    if (g.roof === 'canopy') {
      const zTop = H,
        front = -STAND.reach;
      const roofCs = cs([[front, zTop, D, zTop + STAND.roof]]);
      canopySpans(g).forEach(([a, b], i, all) => {
        const plate = run(roofCs, a, b);
        parts.push({ id: 'canopy-' + (i + 1), name: 'Canopy' + (all.length > 1 ? ' ' + (i + 1) + ' of ' + all.length : ''), role: 'roof', solid: plate, lie: [0, 0, 0], apart: [0, 0, 30] });
      });
      // Posts under the front edge of the canopy, standing on the table in front of the parapet.
      const postCs = cs([[front + 1, 0, front + 1 + STAND.post, zTop]]);
      postPlaces(g).forEach((at, i) => {
        const post = run(postCs, at - STAND.post / 2, at + STAND.post / 2);
        parts.push({ id: 'post-' + (i + 1), name: 'Canopy post ' + (i + 1), role: 'frame', solid: post, lie: [0, 90, 0], apart: [0, -20, 15] });
      });
    }
    const keep = new Set(parts.map((p) => p.solid));
    for (const s of temp) if (!keep.has(s)) s.delete();
    return parts;
  } catch (e) {
    for (const s of temp) s.delete();
    throw e;
  }
}
