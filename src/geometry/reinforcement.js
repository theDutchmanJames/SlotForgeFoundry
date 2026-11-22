import { interpolateStation } from './braid-feeds.js';
import { ribHardwareKeepouts } from './rib-clearances.js';
import { left, length2, minus, move, unit } from './solids.js';

// Keep the two actual mesh edges at each path station, including shaped
// border ends and skewed cuts. A shared centreline cannot describe all of
// those shapes. Distances follow the longer edge through each interval.
export function ribRun(section, edges) {
  const distances = [0];
  for (let i = 1; i < edges.length; i++) {
    const step = Math.max(...edges[i].map((point, side) => length2(minus(point, edges[i - 1][side]))));
    distances.push(distances[i - 1] + step);
  }
  return { section, edges, distances };
}

export function registerRibRun(p, part, path, start, end, offsets) {
  if (!p.reinforcement || !p.hollow) return;
  const stations = [start, ...path.stations.filter(t => t > start && t < end), end];
  part.ribRuns = [ribRun(part.section, stations.map(t => offsets(t).map(d => path.point(t, d))))];
}

// An imported outline without two identifiable road ends still has a deck
// and perimeter walls. Span its shorter dimension and clip at its actual rim.
function panelRun(section) {
  const { min: [x0, y0], max: [x1, y1] } = section.bounds();
  const edges = x1 - x0 >= y1 - y0
    ? [[[x0, y0], [x0, y1]], [[x1, y0], [x1, y1]]]
    : [[[x0, y0], [x1, y0]], [[x0, y1], [x1, y1]]];
  return ribRun(section, edges);
}

function transverseStrip(run, distance, thickness) {
  const [a, b] = [0, 1].map(side =>
    interpolateStation(run.distances, distance, i => run.edges[i][side]));
  const across = unit(minus(b, a));
  if (!across[0] && !across[1]) return null;
  const along = left(across);
  // Overlap the material at both ends of an oblique wall. The part outline
  // clips the strip flush, including the two sides of a split pit lane.
  const low = move(a, across, -thickness), high = move(b, across, thickness);
  const half = thickness / 2;
  return [move(low, along, -half), move(high, along, -half),
    move(high, along, half), move(low, along, half)];
}

function bestStrip(work, run, distance, bayLength, thickness, obstacle) {
  const ideal = transverseStrip(run, distance, thickness);
  if (!ideal || !obstacle) return ideal;
  // Keep adjacent ribs ordered with at least one wall thickness of air.
  const travel = Math.max(0, Math.min(0.4 * bayLength, bayLength / 2 - thickness));
  let best = ideal, leastBlocked = Infinity;
  for (let i = 0; i <= 8; i++) {
    for (const sign of i === 0 ? [0] : [-1, 1]) {
      const loop = i === 0 ? ideal : transverseStrip(run, distance + sign * travel * i / 8, thickness);
      if (!loop) continue;
      const strip = new work.wasm.CrossSection([loop], 'EvenOdd');
      const overlap = strip.intersect(obstacle);
      const area = overlap.area();
      overlap.delete();
      strip.delete();
      if (area < 1e-8) return loop;
      if (area < leastBlocked) {
        leastBlocked = area;
        best = loop;
      }
    }
  }
  return best;
}

export function addReinforcement(work, p, part) {
  if (!p.hollow || !p.reinforcement) return;
  const runs = part.ribRuns ?? [panelRun(part.section)];
  let obstacles;
  let insideRim;
  const sections = [];
  for (const run of runs) {
    const length = run.distances.at(-1);
    const bays = Math.ceil(length / Math.max(p.ribSpacing, 3 * p.wall) - 1e-8);
    if (bays < 2) continue; // The existing end walls already support this span.
    // End the rib within the perimeter wall. Running it all the way to the
    // outline splits exterior faces at every row without adding material.
    insideRim ??= work.own(part.section.offset(-p.wall / 2, 'Miter'));
    const domain = run.section === part.section ? insideRim : work.own(run.section.intersect(insideRim));
    if (domain.isEmpty()) continue;
    obstacles ??= ribHardwareKeepouts(work, p, part);
    const blocked = obstacles.length ? work.own(obstacles[0].intersect(domain)) : null;
    const obstacle = blocked && !blocked.isEmpty() ? blocked : null;
    const strips = [];
    for (let row = 1; row < bays; row++) {
      const loop = bestStrip(work, run, row * length / bays, length / bays, p.wall, obstacle);
      if (loop) strips.push(loop);
    }
    if (!strips.length) continue;
    // NonZero unites intersecting rows on tight inside bends.
    const ribs = work.own(new work.wasm.CrossSection(strips, 'NonZero'));
    let local = work.own(ribs.intersect(domain));
    if (obstacle) local = work.own(local.subtract(obstacle));
    if (!local.isEmpty()) sections.push(local);
  }
  if (!sections.length) return;
  let footprint = sections.length === 1 ? sections[0] : work.own(work.wasm.CrossSection.union(sections));
  // On shallow guide slots, stop at the side of a suspended sleeve instead
  // of adding material below its floor. The rib and sleeve share a wall.
  if (part.ribSleeves?.length)
    footprint = work.own(footprint.subtract(work.own(work.wasm.CrossSection.union(part.ribSleeves))));
  if (!footprint.isEmpty()) {
    part.additions.push(work.prism(footprint, 0, p.height - p.deck));
    // Merge redundant subdivisions where webs meet the deck, rim and sleeves
    // before milling the top face and connector openings.
    const blank = work.own(work.union(part.additions).asOriginal());
    part.additions = [work.own(blank.simplify())];
  }
}
