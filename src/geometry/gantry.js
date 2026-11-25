// Gantries and bridges over the track: a start gantry (two legs and a beam
// with start lights and an advertising board), a half gantry (one leg and a
// beam reaching out over the road) and a footbridge (a walkway between two
// parapet walls, on a staircase at each side). Each part prints without
// supports: legs stand on their feet, a beam lies on its back with its lights
// up, a walkway stands up like a channel, a staircase lies on its side. A part
// longer than the plate is cut, joining with dovetail tabs. Toy proportions
// for 1:32: x across the track, y along it, z up.

import { JOINT, seamRegion, tabPlaces } from './building-cuts.js';

export const GANTRY_TYPES = Object.freeze([
  ['start', 'Start gantry'],
  ['half', 'Half gantry'],
  ['bridge', 'Footbridge'],
]);
export const GANTRY_DEFAULTS = Object.freeze({
  kind: 'gantry',
  type: 'start',
  span: 220, // clear between the legs or the staircases: the track and its borders
  clearance: 70, // clear under the beam or the walkway
  lights: 5, // start lights in the beam
  board: true, // an advertising board on top of the beam
  boardHeight: 20,
  reach: 140, // a half gantry: how far its beam reaches from its leg
  deckWidth: 30, // a footbridge: its walkway, outside its walls
  wallHeight: 14, // and its walls, above the walkway
});
export const GANTRY_LIMITS = Object.freeze({
  span: [60, 1200],
  clearance: [40, 200],
  lights: [0, 10],
  boardHeight: [8, 60],
  reach: [40, 600],
  deckWidth: [20, 80],
  wallHeight: [8, 40],
});
export const GANTRY = Object.freeze({
  leg: 10, // a leg, square
  foot: [24, 3], // its foot plate: square, thick; a half gantry's is wider
  pin: [6, 4], // the pin on top of a leg: square, tall
  play: 0.15,
  beam: [12, 16], // the beam: deep, high
  light: [2.5, 1], // a start light: radius, depth
  board: 3, // the board: thick
  deck: 3, // the walkway, thick, and its walls
  rise: 7, // a step of a staircase at most this high
  tread: 9, // and this deep
  landing: 18, // the top of a staircase, under the end of the walkway
});
const LABELS = {
  span: 'Span',
  clearance: 'Clearance',
  lights: 'Start lights',
  boardHeight: 'Board height',
  reach: 'Reach',
  deckWidth: 'Walkway width',
  wallHeight: 'Wall height',
};

/** The gantry as kept: known settings only, each checked. */
export function validateGantry(input) {
  const g = { ...GANTRY_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(g)) if (!Object.hasOwn(GANTRY_DEFAULTS, key)) throw Error('The gantry has an unknown setting: ' + key + '.');
  if (!GANTRY_TYPES.some(([id]) => id === g.type)) throw Error('Choose a start gantry, a half gantry or a footbridge.');
  for (const [key, [min, max]] of Object.entries(GANTRY_LIMITS))
    if (!Number.isFinite(g[key]) || g[key] < min || g[key] > max) throw Error(LABELS[key] + ' must be between ' + min + ' and ' + max + (key === 'lights' ? '' : ' mm') + '.');
  if (!Number.isInteger(g.lights)) throw Error('Start lights are a whole number.');
  if (typeof g.board !== 'boolean') throw Error('Choose whether the beam has a board.');
  if (g.type === 'start' && g.lights * 8 > g.span) throw Error('There is no room for ' + g.lights + ' start lights on a beam of ' + g.span + ' mm: at most ' + Math.floor(g.span / 8) + '.');
  return g;
}

/** How many steps a footbridge staircase has, and how far it runs out from the track. */
export function stairOf(g) {
  const steps = Math.max(2, Math.ceil(g.clearance / GANTRY.rise));
  return { steps, rise: g.clearance / steps, run: steps * GANTRY.tread + GANTRY.landing };
}
/** The size of a gantry on the table: across the track (x) and along it (y). */
export function gantrySize(g) {
  const L = GANTRY.leg;
  if (g.type === 'bridge') return [2 * stairOf(g).run + g.span, g.deckWidth];
  const foot = g.type === 'half' ? GANTRY.foot[0] + 10 : GANTRY.foot[0];
  if (g.type === 'half') return [Math.max(foot, L + g.reach), foot];
  return [2 * L + g.span + (foot - L), foot];
}
/** Where the feet stand on the table, as rectangles [x0, y0, x1, y1]: only they meet the table beside the track. */
export function gantryFeet(g) {
  const L = GANTRY.leg;
  if (g.type === 'bridge') {
    const { run } = stairOf(g);
    return [[0, 0, run, g.deckWidth], [run + g.span, 0, 2 * run + g.span, g.deckWidth]];
  }
  const f = g.type === 'half' ? GANTRY.foot[0] + 10 : GANTRY.foot[0],
    o = (f - L) / 2;
  if (g.type === 'half') return [[0, 0, f, f]];
  return [[0, 0, f, f], [o + L + g.span - o, 0, o + L + g.span - o + f, f]];
}

/** The parts of a gantry, without geometry. */
export function gantryLayout(input, plate = null) {
  const g = validateGantry(input);
  const names = {
    start: [['leg-1', 'Leg, left', 'frame'], ['leg-2', 'Leg, right', 'frame'], ['beam', 'Beam', 'roof']],
    half: [['leg-1', 'Leg', 'frame'], ['beam', 'Beam', 'roof']],
    bridge: [['stair-1', 'Staircase, left', 'wall'], ['stair-2', 'Staircase, right', 'wall'], ['deck', 'Walkway', 'floor']],
  }[g.type];
  return { building: g, parts: names.map(([id, name, role]) => ({ id, name, role })) };
}

const box = (Manifold, x0, y0, z0, x1, y1, z1) => Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]);

/**
 * The gantry, built. With a plate, a beam or a walkway longer than it is cut
 * into pieces that join with dovetail tabs.
 */
export function buildGantry(wasm, input, plate = null) {
  const { Manifold, CrossSection } = wasm;
  const g = validateGantry(input);
  const temp = [];
  const own = (s) => (temp.push(s), s);
  const B = (...a) => own(box(Manifold, ...a));
  const minus = (a, ...cuts) => (cuts.length ? own(a.subtract(own(Manifold.union(cuts)))) : a);
  const L = GANTRY.leg,
    [pinW, pinH] = GANTRY.pin,
    pl = GANTRY.play;
  const parts = [];
  try {
    if (g.type === 'bridge') {
      const { steps, rise, run } = stairOf(g);
      const W = g.deckWidth,
        t = GANTRY.deck,
        zTop = g.clearance;
      // A staircase: steps up from the table to its landing, under the end of the walkway.
      const stair = (left) => {
        const blocks = [];
        for (let k = 0; k < steps; k++) {
          const x0 = k * GANTRY.tread,
            z1 = (k + 1) * rise;
          blocks.push(left ? B(x0, 0, 0, run, W, z1) : B(run + g.span, 0, 0, 2 * run + g.span - x0, W, z1));
        }
        return own(Manifold.union(blocks));
      };
      parts.push({ id: 'stair-1', name: 'Staircase, left', role: 'wall', solid: stair(true), lie: [-90, 0, 0], apart: [-15, 0, 0] });
      parts.push({ id: 'stair-2', name: 'Staircase, right', role: 'wall', solid: stair(false), lie: [-90, 0, 0], apart: [15, 0, 0] });
      // The walkway: a floor between two walls, from landing to landing.
      const x0 = run - GANTRY.landing,
        x1 = run + g.span + GANTRY.landing;
      const deck = minus(B(x0, 0, zTop, x1, W, zTop + t + g.wallHeight), B(x0 - 1, t, zTop + t, x1 + 1, W - t, zTop + t + g.wallHeight + 1));
      parts.push(...cutLong({ id: 'deck', name: 'Walkway', role: 'floor', solid: deck, lie: [0, 0, 0], apart: [0, 0, 20] }, [x0, x1], 'xy'));
    } else {
      const half = g.type === 'half';
      const f = half ? GANTRY.foot[0] + 10 : GANTRY.foot[0],
        ft = half ? GANTRY.foot[1] + 1 : GANTRY.foot[1];
      const o = (f - L) / 2;
      const [bd, bh] = GANTRY.beam;
      const legX = half ? [o] : [o, o + L + g.span];
      const zBeam = g.clearance;
      // Legs: a column on a foot plate, a pin on top that the beam drops onto.
      legX.forEach((x, i) => {
        const leg = own(Manifold.union([B(x - o, 0, 0, x - o + f, f, ft), B(x, o, 0, x + L, o + L, zBeam), B(x + (L - pinW) / 2, o + (L - pinW) / 2, zBeam - 0.01, x + (L + pinW) / 2, o + (L + pinW) / 2, zBeam + pinH)]));
        parts.push({ id: 'leg-' + (i + 1), name: half ? 'Leg' : i ? 'Leg, right' : 'Leg, left', role: 'frame', solid: leg, lie: [0, 0, 0], apart: [i ? 12 : -12, 0, 0] });
      });
      // The beam: over the legs, a socket for each pin underneath, the lights in
      // front, a board on top flush with its back.
      const bx0 = half ? o : o,
        bx1 = half ? o + L + g.reach : o + 2 * L + g.span;
      const by0 = o + L / 2 - bd / 2,
        by1 = by0 + bd;
      let beam = B(bx0, by0, zBeam, bx1, by1, zBeam + bh);
      if (g.board) beam = own(beam.add(B(bx0, by1 - GANTRY.board, zBeam + bh - 0.01, bx1, by1, zBeam + bh + g.boardHeight)));
      const sockets = legX.map((x) => B(x + (L - pinW) / 2 - pl, o + (L - pinW) / 2 - pl, zBeam - 1, x + (L + pinW) / 2 + pl, o + (L + pinW) / 2 + pl, zBeam + pinH + 0.2));
      const lights = [];
      if (g.type === 'start' && g.lights) {
        const [r, depth] = GANTRY.light;
        const mid = (o + L + o + L + g.span) / 2,
          gap = 8;
        for (let k = 0; k < g.lights; k++) {
          const x = mid + (k - (g.lights - 1) / 2) * gap;
          lights.push(own(own(Manifold.cylinder(depth + 1, r, r, 24)).rotate([-90, 0, 0]).translate([x, by0 - 1, zBeam + bh / 2])));
        }
      }
      beam = minus(beam, ...sockets, ...lights);
      // It prints on its back: the board flat on the plate, the lights up.
      parts.push(...cutLong({ id: 'beam', name: 'Beam', role: 'roof', solid: beam, lie: [-90, 0, 0], apart: [0, 0, 20] }, [bx0, bx1], 'xz'));
    }
    const keep = new Set(parts.map((p) => p.solid));
    for (const s of temp) if (!keep.has(s)) s.delete();
    return parts;
  } catch (e) {
    for (const s of temp) s.delete();
    throw e;
  }

  // A part longer than the plate, cut across its length (x) into pieces
  // joined by dovetail tabs drawn in the plane it prints in: xy for a
  // walkway standing up, xz for a beam on its back.
  function cutLong(part, [x0, x1], plane) {
    if (!plate) return [part];
    const room = Math.max(plate.width, plate.depth) - 2 * (plate.margin ?? 0) - JOINT.length;
    const n = Math.ceil((x1 - x0) / room - 1e-9);
    if (n < 2) return [part];
    const { min, max } = part.solid.boundingBox();
    const [v0, v1] = plane === 'xy' ? [min[1], max[1]] : [min[2], max[2]];
    const far = 1e4;
    const cuts = Array.from({ length: n - 1 }, (_, i) => x0 + ((i + 1) * (x1 - x0)) / n);
    const lefts = cuts.map((at) => own(new CrossSection(seamRegion(at, [v0, v1], tabPlaces([v0, v1])), 'NonZero')));
    const regions = [...lefts, own(new CrossSection([[[-far, v0 - far], [far, v0 - far], [far, v1 + far], [-far, v1 + far]]], 'NonZero'))].map((region, k) =>
      k ? own(region.subtract(own(lefts[k - 1].offset(JOINT.play, 'Miter', 2)))) : region,
    );
    // A prism through the part for each region: extruded across the plane, turned into place.
    const depth = plane === 'xy' ? [min[2] - 2, max[2] + 2] : [min[1] - 2, max[1] + 2];
    return regions.map((region, k) => {
      let prism = own(own(region.extrude(depth[1] - depth[0])).translate([0, 0, depth[0]]));
      // Into the plane: xy as it is; xz with v up and the extrusion along y.
      if (plane === 'xz') prism = own(prism.transform([1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1]));
      const solid = own(part.solid.intersect(prism));
      return { ...part, id: part.id + '-' + (k + 1), name: part.name + ' ' + (k + 1) + ' of ' + regions.length, solid, apart: [part.apart[0] + (k - (regions.length - 1) / 2) * 6, part.apart[1], part.apart[2]] };
    });
  }
}
