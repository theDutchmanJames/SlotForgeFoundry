import { dot3, cross3, length3, mul3, sub3 } from './vectors.js';

// Recover an open rounded bend in a cyclic outline. The directions are in
// the supporting face's plane. A straight tangent to a short arc can be as
// short as one of its chords, so chord length alone is a poor stopping rule.
export function cornerRun(spans, picked, normal) {
  const at = (i) => spans[((i % spans.length) + spans.length) % spans.length];
  const turn = (a, b) =>
    Math.atan2(dot3(cross3(a.dir, b.dir), normal), dot3(a.dir, b.dir));
  const degrees = Math.PI / 180;
  const start = spans[picked];
  if (!start || spans.length < 4) return null;
  const compatible = (s) =>
    s &&
    s.edge.convex === start.edge.convex &&
    Math.abs(dot3(s.edge.n2, normal) - dot3(start.edge.n2, normal)) < 1e-5;
  function tangent(previous, last, next) {
    if (!compatible(previous) || !compatible(last)) return false;
    const angle = turn(previous, last);
    if (
      Math.abs(angle) > 38 * degrees ||
      Math.abs(angle) < 0.03 * degrees ||
      previous.length > 3 * last.length ||
      last.length > 3 * previous.length
    )
      return false;
    // Circumcircle tangent at the end of chord b. The length ratio also
    // handles unequal sampling around a true circle.
    const end = Math.atan2(
      last.length * Math.sin(angle),
      previous.length + last.length * Math.cos(angle),
    );
    return (
      Math.abs(turn(last, next) - end) <
      Math.min(0.2 * degrees, Math.abs(angle) * 0.075)
    );
  }
  function flat(i) {
    const s = at(i),
      a = at(i - 1),
      b = at(i + 1),
      aa = at(i - 2),
      bb = at(i + 2);
    if (!compatible(s)) return true;
    const lengths = [aa, a, b, bb]
      .filter(compatible)
      .map((x) => x.length)
      .sort((x, y) => x - y);
    if (
      compatible(a) &&
      compatible(b) &&
      lengths.length >= 3 &&
      s.length >
        2.5 *
          Math.max(a.length, b.length, lengths[Math.floor(lengths.length / 2)])
    )
      return true;
    const left = tangent(aa, a, s),
      right = tangent(bb, b, s);
    return (
      (left && right) ||
      (left &&
        (!compatible(b) ||
          Math.abs(turn(s, b)) > 38 * degrees ||
          s.length > 2 * Math.max(aa.length, a.length))) ||
      (right &&
        (!compatible(a) ||
          Math.abs(turn(a, s)) > 38 * degrees ||
          s.length > 2 * Math.max(bb.length, b.length)))
    );
  }
  if (flat(picked)) return null;
  let first = picked,
    last = picked;
  const extend = (i, j) =>
    !flat(j) && Math.abs(turn(at(i), at(j))) <= 38 * degrees;
  const limit = Math.min(spans.length, 2049);
  while (last - first + 1 < limit && extend(last, last + 1)) ++last;
  while (last - first + 1 < limit && extend(first, first - 1)) --first;
  const count = last - first + 1;
  if (count < 3 || count === spans.length || count > 2048) return null;
  const run = Array.from({ length: count }, (_, i) => at(first + i));
  let positive = 0,
    negative = 0;
  for (let i = 1; i < count; i++) {
    const angle = turn(run[i - 1], run[i]);
    positive += Math.max(0, angle);
    negative += Math.max(0, -angle);
  }
  const sweep = Math.abs(positive - negative);
  if (
    sweep < 8 * degrees ||
    sweep > 300 * degrees ||
    Math.min(positive, negative) > 0.32 * Math.max(positive, negative)
  )
    return null;
  // Require a rounded profile across the whole candidate. The tolerance
  // permits short blended arcs, such as a screw boss meeting an enclosure.
  // A reversing S or a zigzag fails the turn or roundness checks.
  const points = [...run.map((s) => s.edge.a), run.at(-1).edge.b];
  const origin = points[0],
    chord = sub3(points.at(-1), origin);
  const length = length3(chord);
  if (length < 1e-8) return null;
  const u = mul3(chord, 1 / length),
    v = cross3(normal, u);
  const xy = points.map((p) => {
    const d = sub3(p, origin);
    return [dot3(d, u), dot3(d, v)];
  });
  const [x, h] = xy.reduce((best, p) =>
    Math.abs(p[1]) > Math.abs(best[1]) ? p : best,
  );
  if (Math.abs(h) < length * 0.01) return null;
  const middle = length / 2,
    y = (x * x + h * h - length * x) / (2 * h),
    r = Math.hypot(middle, y);
  if (
    xy.some(
      ([ax, ay]) =>
        Math.abs(Math.hypot(ax - middle, ay - y) - r) >
        Math.abs(h) * 0.16 + 1e-6,
    )
  )
    return null;
  return run;
}
