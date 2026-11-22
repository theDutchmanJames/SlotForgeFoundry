import { interpolateStation } from './braid-feeds.js';

// Projects saved with a single apex provide the initial value for either side.
export function apexPositionFor(p, side) {
  return p[side + 'ApexPosition'] ?? p.apexPosition ?? 0.5;
}

export function apexWidthFor(p, side) {
  return p[side + 'ApexWidth'] ?? p.borderApex;
}

export function maxBorderWidth(p, side) {
  return Math.max(p.borderEntry, apexWidthFor(p, side), p.borderExit);
}

export function borderWidth(p, t, side) {
  const apex = apexPositionFor(p, side);
  const width = apexWidthFor(p, side);
  const start = t <= apex;
  const u = start ? t / apex : (t - apex) / (1 - apex);
  const smooth = u * u * (3 - 2 * u);
  return start
    ? p.borderEntry + (width - p.borderEntry) * smooth
    : width + (p.borderExit - width) * smooth;
}

export function borderApexStations(path, p, side) {
  return path.borderApexStations?.(side) ?? [apexPositionFor(p, side)];
}

// Subdivide the existing road chord on this side only. Inserting a point on
// the analytic circle here would leave a sliver between two printable parts.
export function borderPath(path, p, side) {
  const peaks = borderApexStations(path, p, side).filter(
    (t) =>
      t > 0 && t < 1 && !path.stations.some((s) => Math.abs(s - t) < 1e-10),
  );
  const extra = new Set(peaks);
  // A much wider outside apex may exceed the radius used to tessellate the
  // original road. Refine this free edge alone to the same 0.025 mm chord sag.
  const half = p.width / 2;
  const widerArc =
    path.pointOnCircle &&
    side === 'outer' &&
    p.outerApexWidth > Math.max(p.borderEntry, p.borderApex, p.borderExit);
  if (widerArc) {
    const radius = p.radius + half + p.outerApexWidth;
    const maxStep =
      (2 * Math.acos(1 - 0.025 / radius)) / ((p.angle * Math.PI) / 180);
    for (let i = 1; i < path.stations.length; i++) {
      const start = path.stations[i - 1],
        span = path.stations[i] - start;
      const count = Math.ceil(span / maxStep - 1e-10);
      for (let j = 1; j < count; j++) {
        const t = start + (span * j) / count;
        if (peaks.every((s) => Math.abs(s - t) >= 1e-10)) extra.add(t);
      }
    }
  }
  if (!extra.size && !widerArc) return path;
  const onChord = (t, offset) =>
    extra.has(t)
      ? interpolateStation(path.stations, t, (i) =>
          path.point(path.stations[i], offset),
        )
      : path.point(t, offset);
  return {
    ...path,
    stations: [...path.stations, ...extra].sort((a, b) => a - b),
    point(t, offset) {
      if (!widerArc || offset <= half) return onChord(t, offset);
      const width = borderWidth(p, t, side);
      if (width <= 0) return onChord(t, offset);
      const weight = Math.min(1, (offset - half) / width);
      const road = onChord(t, half),
        free = path.pointOnCircle(t, half + width);
      return road.map((v, i) => v + weight * (free[i] - v));
    },
  };
}
