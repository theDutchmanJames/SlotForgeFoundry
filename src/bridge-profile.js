// Normalized stations always follow distance along the middle of the printed
// deck, including on a bend whose two side edges have different lengths.
function centerPath(section) {
  const [a, b] = section.sides;
  if (a.length !== b.length || a.length < 2)
    throw Error('The bridge needs paired road edges.');
  const points = a.map((p, i) => [(p[0] + b[i][0]) / 2, (p[1] + b[i][1]) / 2]);
  const distances = [0],
    runs = [];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0],
      dy = points[i][1] - points[i - 1][1];
    const length = Math.hypot(dx, dy),
      start = distances.at(-1);
    if (!(length > 1e-7))
      throw Error('The bridge centreline contains coincident stations.');
    distances.push(start + length);
    const ux = dx / length,
      uy = dy / length,
      last = runs.at(-1);
    if (
      last &&
      last.ux * ux + last.uy * uy > 0 &&
      Math.abs(last.ux * uy - last.uy * ux) < 1e-6
    )
      last.end = start + length;
    else runs.push({ start, end: start + length, ux, uy });
  }
  // Consecutive chords of a tessellated arc are geometry stations, not
  // separate approach straights. Native arcs and Circuit's sampled arcs
  // have short, similarly sized chords with gradual changes of direction.
  const curved = (a, b) => {
    const cosine = a.ux * b.ux + a.uy * b.uy;
    const ratio = (a.end - a.start) / (b.end - b.start);
    return cosine > Math.cos(Math.PI / 10) && ratio > 0.45 && ratio < 2.2;
  };
  const straights = runs.filter(
    (run, i) =>
      !(i && curved(runs[i - 1], run)) &&
      !(i + 1 < runs.length && curved(run, runs[i + 1])),
  );
  return { straights, distances, length: distances.at(-1) };
}

// Bound the occupied interval to within ~0.01 mm on both sides. Include
// each original station and the exact crossing, even on very short spans.
function occupiedSpan(crossingStation, route, width, blocked) {
  const { length, distances } = route;
  const count = Math.min(
    8192,
    Math.max(32, Math.ceil(length / Math.max(1, width / 6))),
  );
  const samples = new Set(distances.map((d) => d / length));
  samples.add(crossingStation);
  for (let i = 0; i <= count; i++) samples.add(i / count);
  const ts = [...samples].sort((a, b) => a - b);
  let first = ts.indexOf(crossingStation),
    last = first;
  if (!blocked(crossingStation))
    throw Error(
      'The upper and lower passages do not meet at the marked crossing.',
    );
  // Other ground-level seams may meet a lower piece at the ends of this
  // section. Only the connected blocked interval surrounding this crossing
  // determines its deck; each additional crossing has its own profile.
  while (first && blocked(ts[first - 1])) first--;
  while (last + 1 < ts.length && blocked(ts[last + 1])) last++;
  function boundary(outside, inside) {
    while (Math.abs(inside - outside) * length > 0.01) {
      const middle = (inside + outside) / 2;
      if (blocked(middle)) inside = middle;
      else outside = middle;
    }
    return outside;
  }
  return [
    first ? boundary(ts[first - 1], ts[first]) : 0,
    last + 1 < ts.length ? boundary(ts[last + 1], ts[last]) : 1,
  ];
}

/** Heights are underside elevations above the table. `blocked(t)` tests the
 * transverse footprint at t against the lower road and its borders. A whole
 * curve can lie on the level deck; only straight pieces take an incline. */
export function bridgeSectionProfile(section, crossing, options) {
  const {
    height,
    clearance,
    width,
    blocked,
    landing = 0,
    maxGrade = Infinity,
  } = options;
  const rise = height + clearance;
  if (
    ![height, clearance, width, landing].every(Number.isFinite) ||
    height <= 0 ||
    clearance < 0 ||
    width <= 0 ||
    landing < 0 ||
    !(maxGrade > 0)
  )
    throw Error(
      'Set positive bridge dimensions and a nonnegative underside clearance.',
    );
  if (options.approaches === false)
    return {
      cuts: [0, 1],
      approaches: [],
      level: { start: 0, end: 1, z: rise },
      heightAt: () => rise,
    };
  const route = centerPath(section);
  const passing = crossing[(options.upperPass ?? crossing.upperPass) + 'Local'];
  if (
    !Number.isFinite(passing) ||
    passing < 0 ||
    passing > 1 ||
    typeof blocked !== 'function'
  )
    throw Error('Choose the upper passage and its lower-road footprint.');
  const [lo, hi] = occupiedSpan(passing, route, width, blocked);
  const firstLimit = lo * route.length - landing,
    lastLimit = hi * route.length + landing;
  const required = Math.max(options.minApproach ?? 2, rise / maxGrade);
  function findRamp(entry) {
    const candidates = entry
      ? route.straights.slice().reverse()
      : route.straights;
    let available = 0;
    for (const run of candidates) {
      const start = entry ? run.start : Math.max(run.start, lastLimit);
      const end = entry ? Math.min(run.end, firstLimit) : run.end;
      available = Math.max(available, end - start);
      if (end - start + 1e-8 < required) continue;
      return {
        start: start / route.length,
        end: end / route.length,
        zStart: entry ? 0 : rise,
        zEnd: entry ? rise : 0,
        grade: rise / (end - start),
      };
    }
    throw Error(
      `The ${entry ? 'entry' : 'exit'} approach needs ${required.toFixed(1)} mm of straight road beyond the bridge landing. Only ${available.toFixed(1)} mm is available. Extend the straight or choose bridge supports only.`,
    );
  }
  const entry = findRamp(true),
    exit = findRamp(false);
  const cuts = [
    ...new Set([0, entry.start, entry.end, exit.start, exit.end, 1]),
  ].sort((a, b) => a - b);
  const level = { start: entry.end, end: exit.start, z: rise };
  function heightAt(t) {
    if (t <= entry.start || t >= exit.end) return 0;
    if (t < entry.end)
      return (rise * (t - entry.start)) / (entry.end - entry.start);
    if (t <= exit.start) return rise;
    return (rise * (exit.end - t)) / (exit.end - exit.start);
  }
  return { cuts, approaches: [entry, exit], level, heightAt };
}
