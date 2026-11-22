import { dot, left, length2, minus, move, unit } from './solids.js';

const BLOCK_DEPTH = 10;
const GAP = 1;
const EPS = 0.000001;

// Each support spans both road walls. All elevations refer to the underside
// of the deck above the table, including on a planar pitched approach.
function roadFrames(section) {
  const [right, leftEdge] = section.sides;
  const centers = right.map((q, i) => move(q, minus(leftEdge[i], q), 0.5));
  const stations = [0];
  for (let i = 1; i < centers.length; i++)
    stations.push(stations[i - 1] + length2(minus(centers[i], centers[i - 1])));
  const length = stations.at(-1);
  const frame = (t) => {
    const distance = t * length;
    let lo = 0,
      hi = stations.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (stations[mid] <= distance) lo = mid;
      else hi = mid;
    }
    const f = (distance - stations[lo]) / (stations[lo + 1] - stations[lo]);
    const at = (line) => move(line[lo], minus(line[lo + 1], line[lo]), f);
    const a = at(right),
      b = at(leftEdge);
    const across = unit(minus(b, a));
    let forward = left(across);
    if (dot(forward, minus(centers[lo + 1], centers[lo])) < 0)
      forward = forward.map((v) => -v);
    return { center: at(centers), forward, walls: [a, b] };
  };
  return { length, frame };
}

function collides(section, others) {
  const box = section.bounds();
  for (const { solid, bounds } of others) {
    if (
      box.max[0] <= bounds.min[0] ||
      box.min[0] >= bounds.max[0] ||
      box.max[1] <= bounds.min[1] ||
      box.min[1] >= bounds.max[1]
    )
      continue;
    const intersection = section.intersect(solid);
    try {
      if (intersection.area() > EPS) return true;
    } finally {
      intersection.delete();
    }
  }
  return false;
}

function supportCandidates(work, geometry, zone, obstacles) {
  const [start, end] = zone.range;
  const { length, frame } = geometry;
  // Both top edges must contact the same planar deck. Keep the full block
  // depth off the boundary between a ramp and its level neighbour.
  const half = BLOCK_DEPTH / 2;
  const a = start + half / length,
    b = end - half / length;
  if (b < a) return [];
  const sampleCount = Math.min(
    2048,
    Math.max(1, Math.ceil(((b - a) * length) / 2)),
  );
  const candidates = [];
  for (let i = 0; i <= sampleCount; i++) {
    const station = a + ((b - a) * i) / sampleCount;
    const { center, forward, walls } = frame(station);
    const corners = [
      move(walls[0], forward, -half),
      move(walls[1], forward, -half),
      move(walls[1], forward, half),
      move(walls[0], forward, half),
    ];
    let top = zone.z,
      gradient = [0, 0],
      low = top,
      high = top;
    if (zone.bearing) {
      const { origin, direction, grade, span } = zone.bearing;
      const ds = corners.map((q) => dot(minus(q, origin), direction));
      if (Math.min(...ds) < -EPS || Math.max(...ds) > span + EPS) continue;
      const heights = ds.map((d) => zone.z + d * grade);
      low = Math.min(...heights);
      high = Math.max(...heights);
      top = zone.z + dot(minus(center, origin), direction) * grade;
      gradient = direction.map((q) => q * grade);
    }
    if (low < 0.8) continue;
    const floor = new work.wasm.CrossSection([corners], 'EvenOdd');
    try {
      if (!collides(floor, obstacles))
        candidates.push({ station, center, gradient, top, low, high, corners });
    } finally {
      floor.delete();
    }
  }
  return candidates;
}

function planBlocks(work, geometry, zones, obstacles, count) {
  // Establish feasible stations on each side before dividing the requested
  // count. A wide border or an oblique crossing may block only one side.
  const used = [],
    slots = zones.map((zone) => ({
      ...zone,
      count: 0,
      candidates: supportCandidates(work, geometry, zone, obstacles),
    }));
  try {
    // Choose a disjoint pool in route order; quantiles of this pool give
    // even spacing across the printable portions of each approach.
    for (const zone of slots) {
      const pool = [];
      for (const candidate of zone.candidates) {
        if (
          pool.length &&
          (candidate.station - pool.at(-1).station) * geometry.length <
            BLOCK_DEPTH + GAP
        )
          continue;
        const floor = new work.wasm.CrossSection(
          [candidate.corners],
          'EvenOdd',
        );
        try {
          if (collides(floor, used)) continue;
          const clearance = floor.offset(GAP, 'Miter');
          used.push({ solid: clearance, bounds: clearance.bounds() });
          pool.push(candidate);
        } finally {
          floor.delete();
        }
      }
      zone.candidates = pool;
    }
    let remaining = count;
    const allocate = (list, max) => {
      while (remaining && max > 0) {
        const best = list
          .filter((s) => s.count < s.candidates.length)
          .sort(
            (a, b) =>
              a.count - b.count || b.candidates.length - a.candidates.length,
          )[0];
        if (!best) break;
        best.count++;
        remaining--;
        max--;
      }
    };
    const level = slots.filter((s) => s.level);
    allocate(level, 2);
    allocate(
      slots.filter((s) => !s.level),
      remaining,
    );
    allocate(level, remaining);
    if (remaining) return null;
    return slots
      .flatMap((slot) =>
        Array.from({ length: slot.count }, (_, i) => {
          const index = Math.floor(
            ((i + 0.5) * slot.candidates.length) / slot.count,
          );
          return slot.candidates[index];
        }),
      )
      .sort((a, b) => a.station - b.station);
  } finally {
    for (const { solid } of used) solid.delete();
  }
}

export function bridgeBlocks(
  work,
  p,
  section,
  profile,
  { sectionIndex, crossingIndex, obstacles, occupied },
) {
  const count = p.bridgeSupportCount;
  if (!count) return [];
  const geometry = roadFrames(section);
  const crossAt =
    profile.crossingAt ?? (profile.level.start + profile.level.end) / 2;
  const zones = [
    { level: true, z: profile.level.z, range: [profile.level.start, crossAt] },
    { level: true, z: profile.level.z, range: [crossAt, profile.level.end] },
    ...profile.approaches.map((r) => {
      const origin = geometry.frame(r.start).center;
      const direction = minus(geometry.frame(r.end).center, origin);
      const span = length2(direction);
      return {
        level: false,
        range: [r.start, r.end],
        z: r.zStart,
        bearing: {
          origin,
          span,
          direction: unit(direction),
          grade: (r.zEnd - r.zStart) / span,
        },
      };
    }),
  ];
  const forbidden = [obstacles, ...occupied]
    .filter((s) => s && !s.isEmpty())
    .map((solid) => ({ solid, bounds: solid.bounds() }));
  const blocks = planBlocks(work, geometry, zones, forbidden, count);
  if (!blocks)
    throw Error(
      'Crossing ' +
        (crossingIndex + 1) +
        ' has too little clear space for ' +
        count +
        ' bridge supports. Reduce the support count, lengthen the upper passage, or move nearby roads and borders.',
    );
  return blocks.map(({ station, center, gradient, top, low, high, corners }, i) => {
    const floor = work.section([corners]);
    occupied.push(work.own(floor.offset(GAP, 'Miter')));
    const prism = work.prism(floor, 0, top);
    const solid =
      high - low < EPS
        ? prism
        : work.own(
            prism.warp((vertex) => {
              if (vertex[2] > 0)
                vertex[2] = top + dot(minus(vertex, center), gradient);
            }),
          );
    return {
      id: 'support-' + (crossingIndex + 1) + '-' + (i + 1),
      name:
        'Crossing ' +
        (crossingIndex + 1) +
        ' · Support ' +
        (i + 1) +
        ' · ' +
        (high - low < EPS
          ? Number(top.toFixed(1))
          : Number(low.toFixed(1)) + '–' + Number(high.toFixed(1))) +
        ' mm',
      role: 'support',
      station,
      crossingSection: sectionIndex,
      solid,
    };
  });
}
