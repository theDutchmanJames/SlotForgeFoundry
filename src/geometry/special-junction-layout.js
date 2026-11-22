import { borderPath, borderWidth, maxBorderWidth } from './border-profile.js';
import { borderEndProfile, borderSeam } from './border-ends.js';
import { braidSpan } from './solids.js';
import { pitBraidLayout, validatePitContacts } from './pit-braids.js';
import { pitActuatorSpec, turnoutOutline } from './pit-turnout.js';
import { validatePitMotorSettings } from './pit-motor-settings.js';
import { pitMotorMountLayout } from './pit-motor-mount.js';
import { pitWhiteLines } from './pit-white-line.js';
import {
  diamondLayout,
  pitLayout,
  pitPrintPath,
  pointOnAxis,
} from './special-junction-paths.js';
export {
  diamondLayout,
  offsets,
  pitLayout,
  pitPrintPath,
  pointOnAxis,
} from './special-junction-paths.js';

export const sides = (p) =>
  ['inner', 'outer'].filter(
    (s) => p.borderSide === s || p.borderSide === 'both',
  );
export const bandPolygon = (path, t0, t1, lo, hi) => {
  const ts = [t0, ...path.stations.filter((t) => t > t0 && t < t1), t1];
  const edge = (value) =>
    ts.map((t) => path.point(t, typeof value === 'number' ? value : value(t)));
  return [...edge(lo), ...edge(hi).reverse()];
};

function borderPolygons(path, p) {
  return sides(p).flatMap((side) => {
    const profile = borderEndProfile(
      borderPath(path, p, side),
      p,
      side,
      borderWidth,
    );
    const sign = side === 'outer' ? 1 : -1,
      edge = (sign * p.width) / 2;
    return Array.from({ length: p.borderSegments }, (_, i) =>
      bandPolygon(
        profile.path,
        borderSeam(profile.path, p, i),
        borderSeam(profile.path, p, i + 1),
        edge,
        (t) => edge + sign * profile.widthAt(t),
      ),
    );
  });
}

export function diamondJumperSize(p) {
  const depth = Math.min(1.8, p.height - p.slotDepth - 0.45);
  const width = Math.min(2, p.braidWidth * 0.8);
  // Leads of different circuits cross below the deck. Reserve room to stack
  // two insulated wires plus a small clearance above the table face.
  const wireOD = Math.max(
    0,
    Math.floor(100 * (Math.min(width, depth / 2) - 0.1)) / 100,
  );
  return { depth, width, wireOD };
}

export function validateSpecialJunction(p) {
  const s = p.special;
  if (
    !(
      Number.isFinite(p.length) &&
      p.length > 0 &&
      Number.isFinite(p.width) &&
      p.width > 0
    )
  )
    throw Error('Choose a positive road length and width.');
  const outer = ((p.lanes - 1) * p.laneSpacing) / 2;
  const shelf = p.slotWidth / 2 + braidSpan(p);
  if (outer + Math.max(shelf, p.slotWidth / 2 + p.wall) >= p.width / 2)
    throw Error(
      'The outer lane needs more shoulder. Widen the road or reduce lane spacing.',
    );
  if (s.type === 'pit') {
    if (s.pitWhiteLine !== undefined && typeof s.pitWhiteLine !== 'boolean')
      throw Error('Choose on or off for the pit divider stripe.');
    if (s.pitCrossingStyle !== undefined && !['solid', 'dashed'].includes(s.pitCrossingStyle))
      throw Error('Choose solid or dashed pit entry and exit markings.');
    validatePitMotorSettings(s);
    validatePitContacts(s);
    if (!['left', 'right', 'both'].includes(s.side))
      throw Error('Choose a left, right or mirrored pair of pits.');
    if (s.side === 'both' && p.lanes < 2)
      throw Error('Mirrored independent pits need at least two main lanes.');
    if (
      !(
        Number.isFinite(s.pitOffset) &&
        s.pitOffset > Math.max(p.slotWidth + 7, 2 * shelf + 1) &&
        s.pitOffset <= 2000
      )
    )
      throw Error(
        'Increase pit offset until both braid shelves and the turnout pivot clear each other (maximum 2000 mm).',
      );
    const drive = pitActuatorSpec(p);
    if (
      p.slotWidth < 2 ||
      p.slotDepth < 3.2 ||
      p.height - p.slotDepth < drive.minGuideFloor - 1e-9 ||
      p.slotDepth - p.braidDepth < 2.8
    )
      throw Error(
        `The pit turnout needs a guide at least 2 mm wide and 3.2 mm deep, with 2.8 mm below the braid shelf. Leave at least ${Number(drive.minGuideFloor.toFixed(2))} mm under the guide for the underside linkage channel.`,
      );
    if (drive.screwMin > drive.screwMax)
      throw Error('Increase track height and guide depth to leave room for the actuator key and a blind retaining screw below the road surface.');
    if ((0.27 * p.length) ** 2 / (6 * s.pitOffset) < Math.max(14, 3 * shelf))
      throw Error(
        'The pit approach bends too sharply. Lengthen the road or reduce pit offset.',
      );
    const { forks, lanePaths } = pitLayout(p);
    if (s.motorMount)
      forks.forEach((fork, i) => pitMotorMountLayout(p, fork, lanePaths[p.lanes + i]));
    return;
  }
  if (s.type !== 'diamond')
    throw Error('Choose an available special junction.');
  if (
    !(
      Number.isFinite(s.crossingAngle) &&
      s.crossingAngle >= 55 &&
      s.crossingAngle <= 125
    )
  )
    throw Error('Choose a diamond crossing angle between 55° and 125°.');
  if (
    !(Number.isFinite(s.isolation) && s.isolation >= 0.25 && s.isolation <= 40)
  )
    throw Error('Choose 0.25–40 mm of extra braid isolation at the diamond.');
  const { roads, gap } = diamondLayout(p);
  if (
    p.braidWidth &&
    (diamondJumperSize(p).depth < 0.5 || !diamondJumperSize(p).wireOD)
  )
    throw Error(
      'The diamond needs at least 0.95 mm under the guide and braid wide enough for recessed jumper leads. Reduce guide depth or increase track height or braid width.',
    );
  const rad = (s.crossingAngle * Math.PI) / 180;
  if (
    p.braidWidth > 0 &&
    p.lanes > 1 &&
    2 * gap + 4 >= p.laneSpacing / Math.sin(rad)
  )
    throw Error(
      'The insulating gaps would remove the braid between crossings. Increase lane spacing or reduce braid width and isolation.',
    );
  for (const road of roads)
    for (const arm of road.arms) {
      for (const sign of [-1, 1]) {
        const side = sign === 1 ? 'outer' : 'inner';
        const width = sides(p).includes(side) ? maxBorderWidth(p, side) : 0;
        if (arm.reach(sign * (p.width / 2 + width)) < 5)
          throw Error(
            'Lengthen the diamond arms, narrow the borders or bring the crossing angle closer to 90° so its four ends stay clear.',
          );
      }
    }
  if (
    p.lanes > 0 &&
    p.braidWidth > 0 &&
    roads.some((road) =>
      road.laneData.some(({ d, crossings }) =>
        crossings.some(
          (x) =>
            x - gap - 2 <= road.arms[0].seam(d) ||
            x + gap + 2 >= road.arms[1].seam(d),
        ),
      ),
    )
  )
    throw Error(
      'The braid interruptions reach the central crossing edge. Widen the road or reduce lane spacing or braid isolation.',
    );
}

export function specialJunctionPlan(p) {
  validateSpecialJunction(p);
  if (p.special.type === 'pit') {
    const raw = pitLayout(p),
      { lanePaths, forks } = raw;
    const electrical = pitBraidLayout(p, raw),
      path = pitPrintPath(raw.path, forks, p, electrical);
    const open = p.special.turnoutPosition === 'pit';
    const turnouts = forks.map((fork) => {
      const outline = turnoutOutline(fork, open ? 1 : 0);
      return { side: fork.side, outline: [...outline, outline[0]],
        guide: open ? fork.pitGuide : fork.mainGuide };
    });
    const stripes = pitWhiteLines(p, raw);
    return {
      outlinePaths: [bandPolygon(path, 0, 1, -p.width / 2, p.width / 2)],
      lanePaths,
      borderPaths: borderPolygons(path, p),
      breaks: [],
      detailPaths: [
        ...turnouts.map((f) => f.outline),
        ...electrical.conductors.map((c) => c.points),
      ],
      jumpers: electrical.jumpers,
      conductors: electrical.conductors.map(({ driver, side, route, points, polygon }) =>
        ({ driver, side, route, points, polygon })),
      turnouts,
      pitWhiteLines: stripes.paint,
      pitWhiteLineGrooves: stripes.grooves,
    };
  }
  const { roads, breaks, gap, lanePaths } = diamondLayout(p);
  const h = p.length / 2,
    w = p.width / 2;
  const ends = [],
    borderPaths = [],
    detailPaths = [];
  for (const road of roads) {
    for (const arm of road.arms) {
      const outer = arm.sign > 0 ? 1 : 0;
      ends.push([
        arm.path.point(1 - outer, -w),
        arm.path.point(outer, -w),
        arm.path.point(outer, w),
        arm.path.point(1 - outer, w),
      ]);
      borderPaths.push(...borderPolygons(arm.path, arm.config));
    }
    for (const { d, crossings } of road.laneData) {
      const trackBraid = p.slotWidth / 2 + p.braidGap + p.braidWidth / 2;
      if (p.braidWidth > 0)
        for (const sign of [-1, 1]) {
          let start = -h;
          for (const x of crossings.concat(h + gap)) {
            detailPaths.push(
              [start, x - gap].map((q) =>
                pointOnAxis(road.axis, q, d + sign * trackBraid),
              ),
            );
            start = x + gap;
          }
        }
    }
  }
  const perimeter = ends.pop();
  const matches = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.001;
  while (ends.length) {
    const end = perimeter.at(-1);
    const index = ends.findIndex(
      (line) => matches(line[0], end) || matches(line.at(-1), end),
    );
    if (index < 0) throw Error('The diamond arm edges did not meet.');
    const [line] = ends.splice(index, 1);
    if (!matches(line[0], end)) line.reverse();
    perimeter.push(...line.slice(1));
  }
  perimeter.pop();
  return {
    outlinePaths: [perimeter],
    borderPaths,
    lanePaths,
    detailPaths,
    breaks,
  };
}
