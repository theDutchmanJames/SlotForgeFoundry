import { nativePath, trackParameters } from './track.js';
import { laneOffsetAt } from './lane-adjustment.js';
import { diamondLayout, pitLayout } from './geometry/special-junction-paths.js';
import { independentSpans, sectionStations } from './geometry/bridge-sections.js';
import { interpolateStation } from './geometry/braid-feeds.js';

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function measuredRoute(id, label, line, height, section) {
  const points = [], distances = [];
  let length = 0;
  for (const [x, y, z = height] of line) {
    const point = [x, y, z];
    if (!point.every(Number.isFinite)) return null;
    if (points.length) {
      const step = distance(point, points.at(-1));
      if (step < 1e-7) continue;
      length += step;
    }
    points.push(point);
    distances.push(length);
  }
  if (!length) return null;
  return { id, label, section, points, distances, length,
    closed: points.length > 2 && distance(points[0], points.at(-1)) < 1e-6 };
}

function bridgeRoutes(p, layout, parts) {
  const { sections, crossings } = independentSpans(layout);
  const elevated = new Set(crossings.map(c => c[c.upperPass + 'Section']));
  const profiles = new Map(parts.filter(part => part.bridgeDiagram)
    .map(part => [part.crossingSection, part.bridgeDiagram.path]));
  return sections.flatMap((section, i) => {
    const profile = profiles.get(i);
    // Only the built bridge knows the actual approach and landing stations.
    if (elevated.has(i) && !profile) return [];
    const metric = sectionStations(section.sides);
    const cuts = (profile ?? []).map(([t]) => t);
    const stations = [...new Set([...metric.stations, ...cuts])].sort((a, b) => a - b);
    return section.lanes.map((lane, j) => {
      const line = stations.map(t => {
        const z = profile ? interpolateStation(cuts, t, k => profile[k])[1] : 0;
        return [...metric.at(lane, t), p.height + z];
      });
      return measuredRoute(`passage-${i + 1}-lane-${j + 1}`,
        `Passage ${i + 1} · Lane ${j + 1}`, line, p.height, i);
    }).filter(Boolean);
  });
}

// Called on enabling the preview or changing the displayed road. Neither
// moving the car nor changing its scale regenerates any track geometry.
export function buildCarRoutes(track, parts = []) {
  if (!track?.params) return [];
  const p = trackParameters(track.params);
  const crossing = track.plan?.flatCrossing;
  if (p.kind === 'import' && crossing?.crossings?.length) return bridgeRoutes(p, crossing, parts);

  let lanes;
  if (p.kind === 'import') lanes = track.plan?.lanes ?? [];
  else if (p.special?.type === 'pit') lanes = pitLayout(p).lanePaths;
  else if (p.special?.type === 'diamond') lanes = diamondLayout(p).lanePaths;
  else {
    const path = nativePath(p);
    lanes = path.laneCurves ?? Array.from({ length: p.lanes }, (_, i) =>
      path.stations.map(t => path.point(t, laneOffsetAt(p, i, t))));
  }
  return lanes.map((line, i) => {
    const number = i + 1;
    if (p.special?.type === 'pit' && i >= p.lanes) {
      const left = p.special.side === 'left' || (p.special.side === 'both' && i === p.lanes);
      return measuredRoute(left ? 'pit-left' : 'pit-right', left ? 'Left pit' : 'Right pit', line, p.height);
    }
    const label = p.special?.type === 'diamond'
      ? `Road ${Math.floor(i / p.lanes) + 1} · Lane ${i % p.lanes + 1}` : `Lane ${number}`;
    return measuredRoute('lane-' + number, label, line, p.height);
  }).filter(Boolean);
}

function pointAtDistance(route, at) {
  let lo = 0, hi = route.points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (route.distances[mid] < at) lo = mid;
    else hi = mid;
  }
  const a = route.points[lo], b = route.points[hi];
  const u = (at - route.distances[lo]) / (route.distances[hi] - route.distances[lo]);
  return a.map((n, i) => n + (b[i] - n) * u);
}

export function carPose(route, t) {
  if (!route) return null;
  const s = clamp(Number.isFinite(t) ? t : 0.5, 0, 1) * route.length;
  const at = d => pointAtDistance(route, route.closed
    ? ((d % route.length) + route.length) % route.length : clamp(d, 0, route.length));
  // Centre a short chord on the guide, including either side of a mesh
  // vertex. The unit vector carries pitch on inclined bridge approaches.
  const delta = Math.min(1, route.length / 8);
  const position = pointAtDistance(route, s);
  let a = at(s - delta);
  const b = at(s + delta);
  // A drawn cusp can double back over its own chord. Use the outgoing
  // segment in that case so even a direction reversal has a finite heading.
  if (distance(a, b) < 1e-7) a = position;
  const size = distance(a, b);
  return { position, forward: size ? b.map((v, i) => (v - a[i]) / size) : [1, 0, 0] };
}

export function nearestCarRoute(routes, hitPoint, part) {
  if (!hitPoint || (part && part.role !== 'road')) return null;
  const [x, y, z] = hitPoint;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  let nearest = null, best = Infinity;
  for (const route of routes) {
    if (part?.crossingSection != null && route.section !== part.crossingSection) continue;
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const lengthSquared = dx * dx + dy * dy;
      if (lengthSquared < 1e-14) continue;
      const u = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / lengthSquared, 0, 1);
      // Hits can land inside a recessed guide. XY fixes the station while
      // elevation distinguishes overlapping roads at the same XY position.
      const heightError = Number.isFinite(z) ? a[2] + u * (b[2] - a[2]) - z : 0;
      const error = (a[0] + u * dx - x) ** 2 + (a[1] + u * dy - y) ** 2 + heightError ** 2;
      if (error >= best) continue;
      const travel = route.distances[i - 1] + u * (route.distances[i] - route.distances[i - 1]);
      nearest = { id: route.id, t: travel / route.length };
      best = error;
    }
  }
  return nearest;
}
