import { borderWidth, maxBorderWidth } from './border-profile.js';
import { borderEndProfile } from './border-ends.js';

const cableDepth = 1.35;
const stripGap = 1.5;
const windowHeight = 1.2;
const rect = (x0, y0, x1, y1) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const lanes = (p) =>
  Array.from(
    { length: p.lanes },
    (_, i) => (i - (p.lanes - 1) / 2) * p.laneSpacing,
  );
const isStrip = (p) => p.special.detector === 'strip';
const gateHalf = (p) =>
  isStrip(p)
    ? p.special.stripLength / 2 + stripGap + 2
    : p.special.sensorSize / 2 + p.wall + 1;

export function validateTiming(p) {
  const { detector, stripLength, sensorSize } = p.special;
  if (!['optical', 'strip'].includes(detector))
    throw Error('Choose an optical gate or an isolated dead strip.');
  if (!Number.isFinite(stripLength) || stripLength < 8 || stripLength > 150)
    throw Error('Set sensing strip length between 8 and 150 mm.');
  if (!Number.isFinite(sensorSize) || sensorSize < 1.5 || sensorSize > 10)
    throw Error('Set optical sensor pocket width between 1.5 and 10 mm.');
  if (p.height - p.slotDepth < cableDepth + 0.45)
    throw Error(
      'Leave at least 1.8 mm below the guide slot for the recessed timing cables.',
    );
  if (!isStrip(p)) {
    if (p.slotDepth < p.braidDepth + windowHeight + 1.1)
      throw Error(
        'Deepen the guide slot to leave room for the optical windows below the running braids.',
      );
    const across = p.slotWidth / 2 + 1.2 + sensorSize + p.wall;
    if (
      2 * across >= p.width - (p.lanes - 1) * p.laneSpacing ||
      (p.lanes > 1 && 2 * across >= p.laneSpacing)
    )
      throw Error(
        'The sensor pockets need more road or lane spacing. Reduce their width or widen the road.',
      );
  } else if (p.braidWidth < 1 || p.braidDepth <= 0) {
    throw Error('A dead strip needs recessed braids at least 1 mm wide.');
  }
  // For an even count, move the middle seam toward the start. The timing line stays at X=0.
  const reserve = gateHalf(p) + p.wall + 2,
    span = p.length / p.segments;
  if (span < (p.segments % 2 ? 2 * reserve : reserve + Math.max(8, 2 * p.wall)))
    throw Error(
      'A road seam would pass through the timing equipment. Lengthen the straight, shorten the sensing strip or use fewer road segments.',
    );
}

export function timingFraction(p, t) {
  if (p.segments % 2) return t;
  const midShift = (gateHalf(p) + p.wall + 2) / p.length;
  return t - midShift * Math.max(0, 1 - Math.abs(t - 0.5) * p.segments);
}

function sensorLocation(p, y, sign) {
  return y + sign * (p.slotWidth / 2 + 1.2 + p.special.sensorSize / 2);
}

// XY stock spanning the connector pocket height. The connector picker and
// the printable solids share the optical mount and sensing-contact footprints.
export function timingContactFootprints(p, y, sign) {
  if (!isStrip(p)) {
    const centre = sensorLocation(p, y, sign);
    const half = p.special.sensorSize / 2 + p.wall;
    return [rect(-half, centre - half, half, centre + half)];
  }
  const near = y + sign * (p.slotWidth / 2 + p.braidGap);
  const far = near + sign * p.braidWidth;
  return [-1, 1].flatMap((end) =>
    [-1, 1].map((offset) => {
      const x =
        (end * p.special.stripLength) / 2 + offset * (stripGap / 2 + 0.55);
      return rect(x - 0.46, Math.min(near, far), x + 0.46, Math.max(near, far));
    }),
  );
}

export function timingPlan(p) {
  const half = p.width / 2,
    end = p.length / 2;
  const details = [],
    borders = [];
  const paths = lanes(p).map((y) => {
    if (isStrip(p)) {
      for (const sign of [-1, 1]) {
        const near = y + sign * (p.slotWidth / 2 + p.braidGap);
        for (const x of [-1, 1].map((k) => (k * p.special.stripLength) / 2))
          details.push([
            [x, near],
            [x, near + sign * p.braidWidth],
          ]);
      }
    } else {
      const a = sensorLocation(p, y, -1),
        b = sensorLocation(p, y, 1);
      details.push([
        [0, a],
        [0, b],
      ]);
      for (const Y of [a, b]) {
        const h = p.special.sensorSize / 2,
          loop = rect(-h, Y - h, h, Y + h);
        details.push([...loop, loop[0]]);
      }
    }
    return [
      [-end, y],
      [end, y],
    ];
  });
  const stations = Array.from({ length: 65 }, (_, i) => i / 64);
  const path = {
    stations,
    point: (t, offset) => [(timingFraction(p, t) - 0.5) * p.length, offset],
    tangent: () => [1, 0],
  };
  for (const [side, sign] of [
    ['inner', -1],
    ['outer', 1],
  ]) {
    if (p.borderSide !== side && p.borderSide !== 'both') continue;
    const profile = borderEndProfile(path, p, side, borderWidth);
    const ts = profile.path.stations.filter(
      (t) => t >= profile.start && t <= profile.finish,
    );
    borders.push([
      ...ts.map((t) => path.point(t, sign * half)),
      ...ts
        .slice()
        .reverse()
        .map((t) => path.point(t, sign * (half + profile.widthAt(t)))),
    ]);
  }
  return {
    outlines: [rect(-end, -half, end, half)],
    lanes: paths,
    details,
    borders,
  };
}

// Leave small insulating lands in the braid shelves whilst the central slot continues through.
export function splitTimingShelf(work, p, shelf) {
  if (!shelf || p.special?.type !== 'timing' || !isStrip(p)) return shelf;
  const ribs = [-1, 1].map((sign) => {
    const x = (sign * p.special.stripLength) / 2;
    return work.section([
      rect(x - stripGap / 2, -p.width, x + stripGap / 2, p.width),
    ]);
  });
  return work.own(shelf.subtract(work.own(work.wasm.CrossSection.union(ribs))));
}

const overlap = (a, b) =>
  a.min.every((v, i) => v < b.max[i] - 1e-5 && a.max[i] > b.min[i] + 1e-5);

export function addTimingHardware(work, p, parts) {
  const box = (x0, y0, x1, y1, z0, z1) =>
    work.prism(work.section([rect(x0, y0, x1, y1)]), z0, z1);
  const road = parts.find(
    (part) =>
      part.role === 'road' &&
      part.section.bounds().min[0] < 0 &&
      part.section.bounds().max[0] > 0,
  );
  if (!road) throw Error('The timing station needs a continuous road section.');
  const blockers = parts
    .flatMap((part) => [...part.cuts, ...(part.drawKeyGuards ?? [])])
    .map((s) => ({ s, b: s.boundingBox() }));
  const intersects = (tool, list) => {
    const b = tool.boundingBox();
    return list.some(
      (item) => overlap(b, item.b) && work.and(tool, item.s).volume() > 1e-5,
    );
  };
  const pads = [],
    cuts = [],
    contacts = [];
  const laneYs = lanes(p);
  const halfSlot = p.slotWidth / 2;
  const beamZ = p.height - (p.slotDepth + p.braidDepth) / 2;
  for (const y of laneYs) {
    const wireEnds = [];
    for (const sign of [-1, 1]) {
      if (!isStrip(p)) {
        const size = p.special.sensorSize,
          Y = sensorLocation(p, y, sign),
          h = size / 2;
        pads.push(
          work.prism(
            work.section(timingContactFootprints(p, y, sign)),
            0,
            p.height,
          ),
        );
        cuts.push(box(-h, Y - h, h, Y + h, -1, beamZ + windowHeight / 2 + 0.2));
        const side = y + sign * (halfSlot - 0.1);
        cuts.push(
          box(
            -windowHeight / 2,
            Math.min(side, Y),
            windowHeight / 2,
            Math.max(side, Y),
            beamZ - windowHeight / 2,
            beamZ + windowHeight / 2,
          ),
        );
        wireEnds.push([0, Y]);
      } else {
        for (const footprint of timingContactFootprints(p, y, sign)) {
          cuts.push(work.prism(work.section([footprint]), -1, p.height + 0.1));
          const [a, , b] = footprint;
          wireEnds.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        }
      }
    }
    contacts.push(wireEnds);
  }
  // Compare the new equipment to existing socket pockets, retainer chambers and user braid feeds.
  const reserved = parts.flatMap((part) => [
    ...part.feedCuts,
    ...(part.drawKeyGuards ?? []),
  ]);
  for (const part of parts)
    for (const cut of part.cuts) {
      // Ordinary guide/shelf tools rise from the slot floor; joint and feed cuts start below it.
      if (cut.boundingBox().min[2] < p.height - p.slotDepth - 0.001)
        reserved.push(cut);
    }
  const keepouts = [...new Set(reserved)].map((s) => ({
    s,
    b: s.boundingBox(),
  }));
  if ([...pads, ...cuts].some((s) => intersects(s, keepouts)))
    throw Error(
      'The timing equipment meets a connector or braid feed. Move the connector or feed away from the finish line.',
    );
  const outer =
    p.width / 2 +
    Math.max(maxBorderWidth(p, 'outer'), maxBorderWidth(p, 'inner')) +
    3;
  // Bus wires sit in an open, recessed trench. Cut the matching outlet in any fitted border too.
  const routes = [];
  for (const [i, ys] of contacts.entries()) {
    const dest = Math.sign(laneYs[i]) || 1;
    const ysOnly = ys.map((pos) => pos[1]),
      outside = dest * outer;
    const firstX = gateHalf(p) + 5;
    const candidates = [
      firstX,
      -firstX,
      firstX + 18,
      -firstX - 18,
      firstX + 36,
      -firstX - 36,
    ];
    let route;
    for (const x of candidates) {
      if (Math.abs(x) + 2 >= p.length / 2 - p.wall) continue;
      const paths = ys.map(([X, Y]) =>
        box(
          Math.min(x, X) - 1.4,
          Y - 1.4,
          Math.max(x, X) + 1.4,
          Y + 1.4,
          -1,
          cableDepth,
        ),
      );
      paths.push(
        box(
          x - 1.4,
          Math.min(outside, ...ysOnly),
          x + 1.4,
          Math.max(outside, ...ysOnly),
          -1,
          cableDepth,
        ),
      );
      const tool = work.union(paths);
      if (!intersects(tool, blockers)) {
        route = tool;
        break;
      }
    }
    if (!route)
      throw Error(
        'The timing cable exits meet connector pockets. Move the road or border connectors away from the timing line.',
      );
    routes.push(route);
  }
  road.additions.push(...pads);
  road.cuts.push(...cuts);
  const trunk = work.union(routes);
  for (const part of parts)
    if (part.role === 'road' || part.role === 'border') part.cuts.push(trunk);
}
