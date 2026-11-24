// A sloped straight: a road that bends in height, from level into a climb or
// from a climb back to level.
//
// The piece is first built flat, as any straight, with its slots, braid and
// connectors. Then every part is bent along the curve of the road surface:
// a point keeps its distance along the surface and its depth below it. So
// the slot stays as deep as it was, measured square to the road, and both end
// faces stay square to the road: the level end meets a level piece, and the
// sloped end meets a straight that is tilted to the climb angle.
//
//   up    level at end A, climbing at end B: the foot of a hill
//   down  climbing at end A, level at end B: the top of a hill
//
// Both rise from A to B. A short stretch at each end stays straight, so the
// connectors there are turned as a whole and never bent.

export const SLOPE_FORMS = Object.freeze([
  ['none', 'Level'],
  ['up', 'Level into a climb'],
  ['down', 'Climb back to level'],
]);
export const SLOPE_DEFAULTS = Object.freeze({
  slopeForm: 'none',
  slopeAngle: 8,
  slopeBend: 70,
  slopeFill: true,
  slopeOpen: 25,
});
export const SLOPE_KEYS = Object.freeze(Object.keys(SLOPE_DEFAULTS));
export const SLOPE_LIMITS = Object.freeze({
  slopeAngle: [1, 30],
  slopeBend: [10, 100],
  slopeOpen: [0, 200],
});
// Straight at each end, for the connectors; and the tightest bend a car's
// guide and chassis are asked to follow.
export const SLOPE_LEAD = 15;
export const SLOPE_MIN_RADIUS = 150;

export function slopeSettings(p) {
  return Object.fromEntries(SLOPE_KEYS.map((key) => [key, p[key] ?? SLOPE_DEFAULTS[key]]));
}
export const hasSlope = (p) => (p?.slopeForm ?? 'none') !== 'none';
// A climb from the table stands on a solid base; it is then made without a hollow underside.
export const slopeFilled = (p) => hasSlope(p) && slopeSettings(p).slopeForm === 'up' && slopeSettings(p).slopeFill === true;

const fmt = (value) => String(Number(value.toFixed(1)));
const radians = (degrees) => (degrees * Math.PI) / 180;

/**
 * The curve of the road surface along a piece of this length: where it
 * bends, how tightly, and how far it rises. Lengths are along the surface.
 */
export function slopeProfile(p) {
  const s = slopeSettings(p),
    length = p.length,
    climb = radians(s.slopeAngle);
  const room = length - 2 * SLOPE_LEAD;
  const bend = (room * s.slopeBend) / 100;
  // Where the bend starts: after the level lead of a climb, or so that it
  // ends before the level lead at the top of a hill.
  const start = s.slopeForm === 'down' ? length - SLOPE_LEAD - bend : SLOPE_LEAD;
  const end = start + bend;
  const radius = bend / climb;
  const angleAt = (d) => {
    const along = Math.max(0, Math.min(1, (d - start) / bend));
    return s.slopeForm === 'down' ? climb * (1 - along) : climb * along;
  };
  // Run and rise up to a distance along the surface: straight, arc, straight.
  function at(d) {
    const first = angleAt(0),
      last = angleAt(length);
    if (d <= start) return [d * Math.cos(first), d * Math.sin(first), first];
    const x0 = start * Math.cos(first),
      z0 = start * Math.sin(first);
    const turn = s.slopeForm === 'down' ? -1 : 1;
    const arc = (to) => {
      const a = angleAt(to);
      // The arc from the angle `first` to `a`, with radius `radius`.
      return [x0 + turn * radius * (Math.sin(a) - Math.sin(first)), z0 - turn * radius * (Math.cos(a) - Math.cos(first)), a];
    };
    if (d <= end) return arc(d);
    const [x1, z1] = arc(end);
    return [x1 + (d - end) * Math.cos(last), z1 + (d - end) * Math.sin(last), last];
  }
  const [run, rise] = at(length);
  return { form: s.slopeForm, length, climb, bend, start, end, radius, run, rise, at, angleAt };
}

export function validateSlope(p) {
  const s = slopeSettings(p);
  if (s.slopeForm === 'none') return;
  if (!SLOPE_FORMS.some(([id]) => id === s.slopeForm))
    throw Error('Choose Level, Level into a climb or Climb back to level for the slope.');
  if (p.kind !== 'straight' || p.special)
    throw Error('Only a plain straight can be a sloped piece. Set Slope to Level for this piece.');
  for (const [key, name, unit] of [
    ['slopeAngle', 'The climb angle', '°'],
    ['slopeBend', 'The curve', ' %'],
    ['slopeOpen', 'The open length under the high end', ' mm'],
  ]) {
    const [low, high] = SLOPE_LIMITS[key];
    if (!Number.isFinite(s[key]) || s[key] < low || s[key] > high)
      throw Error(name + ' must be between ' + low + ' and ' + high + unit + '.');
  }
  if (typeof s.slopeFill !== 'boolean') throw Error('Choose whether the climb stands on a solid base.');
  if (p.segments !== 1)
    throw Error('A sloped piece prints as one road piece. Set the road Segments to 1.');
  const room = p.length - 2 * SLOPE_LEAD;
  if (room < 20)
    throw Error('A sloped piece needs a road at least ' + (2 * SLOPE_LEAD + 20) + ' mm long.');
  const { radius, bend } = slopeProfile(p);
  if (radius < SLOPE_MIN_RADIUS - 1e-9) {
    // What would do: a longer bend, a longer road, or a smaller angle.
    const need = (SLOPE_MIN_RADIUS * radians(s.slopeAngle) * 100) / room;
    const angle = Math.floor(((bend / SLOPE_MIN_RADIUS) * 180) / Math.PI * 10) / 10;
    throw Error(
      'The road would bend on a radius of ' + fmt(radius) + ' mm, too tight for a car to follow (' + SLOPE_MIN_RADIUS + ' mm at least). ' +
        (need <= 100
          ? 'Set Curve to at least ' + Math.ceil(need) + ' %, or the climb angle to at most ' + angle + '°.'
          : 'Set the climb angle to at most ' + angle + '°, or use a road at least ' +
            Math.ceil(SLOPE_MIN_RADIUS * radians(s.slopeAngle) + 2 * SLOPE_LEAD) + ' mm long.'),
    );
  }
  if ((p.tracksideSide ?? 'none') !== 'none')
    throw Error('A sloped piece cannot have trackside accessories yet. Set Trackside → Barrier side to None for this piece.');
  if ([p.whiteLineRoad, p.whiteLineBorder, p.roadCentreLine, p.roadKerbSide].some((value) => (value ?? 'none') !== 'none') ||
      (p.borderSide !== 'none' && (p.kerbEdge ?? 'none') !== 'none'))
    throw Error('A sloped piece cannot have white lines or kerbstones yet. Switch them off under Markings for this piece.');
  if (p.startingGrid) throw Error('A sloped piece cannot carry a starting grid. Switch one of them off.');
}

/**
 * Bend one finished part of the flat piece along the slope. The flat piece
 * lies from x = -length/2 to length/2 with its road surface at `height`.
 */
export function bendToSlope(work, solid, p, profile = slopeProfile(p)) {
  const { length } = profile,
    top = p.height;
  // Short facets, so that the long flat faces of the road follow the curve.
  const fine = work.own(solid.refineToLength(Math.max(1.5, Math.min(4, profile.radius / 80))));
  return work.own(
    fine.warp((v) => {
      const d = v[0] + length / 2,
        depth = top - v[2];
      // Beyond either end (a clip that reaches out of the end face) the road runs on straight.
      const inside = Math.max(0, Math.min(length, d));
      const [x, z, angle] = profile.at(inside);
      const over = d - inside;
      v[0] = -length / 2 + x + over * Math.cos(angle) + depth * Math.sin(angle);
      v[2] = top + z + over * Math.sin(angle) - depth * Math.cos(angle);
    }),
  );
}

/**
 * The solid base under a climb: from the table up to the underside of the
 * bent road, from where that underside leaves the table to `slopeOpen` short
 * of the high end, so that connectors there stay open from below.
 */
export function slopeBase(work, p, profile = slopeProfile(p)) {
  const { length } = profile,
    { slopeOpen } = slopeSettings(p);
  const from = profile.start,
    to = length - slopeOpen;
  if (to - from < 5) return null;
  // The underside of the road, taken a hair inside it so the two become one.
  const depth = p.height - 0.05;
  const steps = Math.max(8, Math.ceil((to - from) / 2));
  const under = [];
  for (let i = 0; i <= steps; i++) {
    const [x, z, angle] = profile.at(from + ((to - from) * i) / steps);
    under.push([-length / 2 + x + depth * Math.sin(angle), p.height + z - depth * Math.cos(angle)]);
  }
  const loop = [[under[0][0], 0], [under.at(-1)[0], 0], ...under.reverse()];
  const side = work.own(new work.wasm.CrossSection([loop], 'Positive'));
  if (side.isEmpty()) return null;
  const width = p.width;
  // Drawn from the side and pulled across the road.
  return work.own(
    work.own(side.extrude(width)).warp((v) => {
      const across = width / 2 - v[2];
      v[2] = v[1];
      v[1] = across;
    }),
  );
}

/** A bent part prints on its side: the curve of the road is then smooth. */
export function onItsSide(part, wasm) {
  part.printPose = function printPose(callback, sideDown) {
    if (!sideDown) return callback(this.solid);
    const turned = this.solid.rotate([90, 0, 0]);
    const placed = turned.translate([0, 0, -turned.boundingBox().min[2]]);
    try {
      return callback(placed);
    } finally {
      turned.delete();
      placed.delete();
    }
  };
  return part;
}
