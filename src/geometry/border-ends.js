import { borderWidth } from './border-profile.js';
import { interpolateStation } from './braid-feeds.js';

export const borderEndShapes = ['rounded', 'tapered', 's-curve'];
const sideName = (side) =>
  side === 'outer' ? 'Outside border' : 'Inside border';

export function validateBorderEnds(ends) {
  if (ends === undefined) return;
  const record = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (
    !record(ends) ||
    Object.keys(ends).some((s) => !['inner', 'outer'].includes(s))
  )
    throw Error('Choose an inside or outside border for the end finish.');
  for (const [side, options] of Object.entries(ends)) {
    if (
      !record(options) ||
      Object.keys(options).some((k) => !['start', 'finish'].includes(k))
    )
      throw Error(sideName(side) + ' needs a start or finish end.');
    for (const [name, end] of Object.entries(options)) {
      if (
        !record(end) ||
        !borderEndShapes.includes(end.shape) ||
        !['short', 'long'].includes(end.length) ||
        !Number.isFinite(end.at) ||
        end.at < 0 ||
        end.at > 1
      )
        throw Error(
          sideName(side) +
            ' ' +
            name +
            ' needs a finish shape, a length and a tip between 0% and 100%.',
        );
    }
    if ((options.start?.at ?? 0) >= (options.finish?.at ?? 1))
      throw Error(
        sideName(side) + ' start tip must come before its finish tip.',
      );
  }
}

// All stations stay in road coordinates, including the seams of a shortened
// border. This keeps its side hardware attached to the correct road segment.
export function borderEndProfile(path, p, side, baseWidth = borderWidth) {
  const ends = p.borderEnds?.[side];
  const start = ends?.start?.at ?? 0,
    finish = ends?.finish?.at ?? 1;
  const width = (t) => baseWidth(p, t, side);
  if (!ends?.start && !ends?.finish)
    return { start, finish, stations: path.stations, path, widthAt: width };
  const sign = side === 'outer' ? 1 : -1,
    edge = (sign * p.width) / 2;
  const edgeLength =
    path.edgeLength?.(sign) ??
    (p.kind === 'straight'
      ? p.length
      : ((p.radius + edge) * p.angle * Math.PI) / 180);
  const tips = [];
  const breaks = new Set([start, finish]);
  for (const [name, dir] of [
    ['start', 1],
    ['finish', -1],
  ]) {
    const end = ends[name];
    if (!end) continue;
    const w = width(end.at);
    if (!(w > 0))
      throw Error(
        sideName(side) +
          ' ' +
          name +
          ' needs a positive border width for the selected finish.',
      );
    const length = w * (end.length === 'long' ? 2 : 1);
    const span = length / edgeLength,
      heel = end.at + dir * span;
    tips.push({ ...end, dir, span, heel, length });
    breaks.add(heel);
    // Angular samples keep the nearly vertical end of a rounded nose smooth.
    const steps = Math.max(
      12,
      Math.ceil(Math.PI / (4 * Math.acos(1 - 0.025 / Math.max(1, length)))),
    );
    for (let i = 1; i < steps; i++) {
      const u = 1 - Math.cos(((i / steps) * Math.PI) / 2);
      breaks.add(end.at + dir * span * u);
    }
  }
  const heelStart = tips.find((e) => e.dir === 1)?.heel ?? start;
  const heelEnd = tips.find((e) => e.dir === -1)?.heel ?? finish;
  if (heelStart > heelEnd - 1e-9)
    throw Error(
      sideName(side) +
        ' has too little length for the selected finish. Move the tips farther apart or choose Short.',
    );
  const widthAt = (t) => {
    if (t < start || t > finish) return 0;
    const full = width(t);
    for (const end of tips) {
      const u = ((t - end.at) * end.dir) / end.span;
      if (u >= 1) continue;
      if (u <= 0) return 0;
      const round = (x) => Math.sqrt(x * (2 - x));
      if (end.shape === 'rounded') return full * round(u);
      const r = Math.min(1.5, full * 0.25, end.length * 0.25);
      const nose = r / end.length;
      if (u < nose) return r * round(u / nose);
      const x = (u - nose) / (1 - nose);
      const fraction = end.shape === 's-curve' ? x * x * (3 - 2 * x) : x;
      return r + (full - r) * fraction;
    }
    return full;
  };
  const seams = Array.from({ length: p.borderSegments + 1 }, (_, i) =>
    i === p.borderSegments
      ? finish
      : start + ((finish - start) * i) / p.borderSegments,
  );
  const stations = [
    ...new Set([
      ...breaks,
      ...seams,
      ...path.stations.filter((t) => t >= start && t <= finish),
    ]),
  ].sort((a, b) => a - b);
  // Sample where the outer paint band reaches the free edge. The rest of a
  // shared line transfers to the road from this point to the end of the tip.
  const paintsSide = (setting) => setting === side || setting === 'both';
  if (paintsSide(p.whiteLineBorder)) {
    const target = p.whiteLineWidth / (paintsSide(p.whiteLineRoad) ? 2 : 1);
    const extra = [];
    for (let i = 1; i < stations.length; i++) {
      let a = stations[i - 1],
        b = stations[i];
      const below = widthAt(a) < target;
      const endBelow = widthAt(b) < target;
      if (below === endBelow) continue;
      for (let k = 0; k < 28; k++) {
        const mid = (a + b) / 2;
        const midBelow = widthAt(mid) < target;
        if (midBelow === below) a = mid;
        else b = mid;
      }
      if (b - stations[i - 1] > 1e-9 && stations[i] - a > 1e-9)
        extra.push((a + b) / 2);
    }
    stations.push(...extra);
    stations.sort((a, b) => a - b);
  }
  const original = new Set(path.stations);
  const shaped = {
    ...path,
    stations,
    borderSeams: seams,
    borderStock: [heelStart, heelEnd],
    borderTipStart: Boolean(ends.start),
    borderTipFinish: Boolean(ends.finish),
    point(t, d) {
      // The road shoulder must follow the existing mesh chord when a new
      // border station subdivides it.
      return original.has(t)
        ? path.point(t, d)
        : interpolateStation(path.stations, t, (i) =>
            path.point(path.stations[i], d),
          );
    },
  };
  return { start, finish, stations, path: shaped, widthAt };
}

export const borderSeam = (path, p, i) =>
  path.borderSeams?.[i] ?? i / p.borderSegments;

export function insideBorderStock(path, t, edgeLength, before, after) {
  if (!path.borderStock) return true;
  const [start, finish] = path.borderStock;
  return (
    (t - start) * edgeLength >= before - 1e-7 &&
    (finish - t) * edgeLength >= after - 1e-7
  );
}
