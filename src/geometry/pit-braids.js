import { pitLayout } from './special-junction-paths.js';
import { measuredLane } from './import-track.js';
import { pitDriveLayout } from './pit-drive.js';
import { interpolateStation } from './braid-feeds.js';

export const PIT_CONTACT_DEFAULTS = Object.freeze({ pitContactMode: 'wire', pitContactLength: 1.2 });

// Folded braid tails need a printable guide wall beside the full-width opening.
export function pitBraidLandingShift(p) {
  return p.braidWidth > 0 && p.special.pitContactMode === 'braid' ? Math.max(0, 0.8 - p.braidGap) : 0;
}

export function validatePitContacts(s) {
  if (s.pitContactMode !== undefined && !['wire', 'braid'].includes(s.pitContactMode))
    throw Error('Choose round wire holes or braid pass-throughs for the pit contacts.');
  if (s.pitContactMode === 'braid' && s.pitContactLength !== undefined &&
      !(Number.isFinite(s.pitContactLength) && s.pitContactLength >= 0.3 && s.pitContactLength <= 50))
    throw Error('Set the pit braid opening length between 0.3 and 50 mm.');
}

export function wireOpening(xy, radius) {
  return { kind: 'hole', outline: Array.from({length: 32}, (_, i) => [
    xy[0] + radius * Math.cos(2 * Math.PI * i / 32),
    xy[1] + radius * Math.sin(2 * Math.PI * i / 32),
  ]) };
}

// Sample the exact mitered offsets used for the physical shelves. The two
// outside conductors bound a fork. Its inside island needs separate L and R
// pickup surfaces fed from below, as four continuous paired strips on top
// would cross one another and run over the open branch slot.
export function xStation(line, offset, x) {
  let lo = 0,
    hi = 1;
  for (let n = 0; n < 35; n++) {
    const t = (lo + hi) / 2;
    if (line.atOffset(t, offset)[0] < x) lo = t;
    else hi = t;
  }
  return (lo + hi) / 2;
}
export function makeRail(p, line, driver, sign, route, from = 0, to = 1) {
  const near = p.slotWidth / 2 + p.braidGap,
    far = near + p.braidWidth;
  const mid = (sign * (near + far)) / 2;
  const ts = [from, ...line.ts.filter((t) => t > from && t < to), to];
  const edge = (d) => ts.map((t) => line.atOffset(t, d));
  const centre = edge(mid),
    nearEdge = edge(sign * near),
    farEdge = edge(sign * far);
  return {
    driver,
    side: sign > 0 ? 'L' : 'R',
    route,
    points: centre,
    polygon: [...nearEdge, ...farEdge.slice().reverse()],
    turnoutCover: [...edge(0), ...farEdge.slice().reverse()],
    line,
    mid,
    from,
    to,
  };
}

// At each end the braid folds through its own recess and back under the
// same island. Measure the slit length on the braid, including at a bend.
// A pit island is cut at both ends. A turnout's island strip starts at the
// split and runs on to the end of the piece: startOnly folds its first end only.
export function slottedIsland(p, rail, sign, slitLength, shift, { startOnly = false, tooShort } = {}) {
  const { line, from, to, mid } = rail;
  const knots = [from, ...line.ts.filter(t => t > from && t < to), to];
  const endLine = measuredLane(knots.map(t => line.atOffset(t, mid + sign * shift)));
  const length = endLine.total;
  const tail = Math.max(4, p.braidWidth + 1);
  const landing = slitLength + tail;
  const lead = shift > 0 ? Math.max(5, shift * 8) : 0;
  if (length < (startOnly ? 1 : 2) * (landing + lead) + 1)
    throw Error(tooShort ?? 'The pit island is too short for its braid pass-throughs and folded tails. Shorten the pit opening length or lengthen the pit.');
  // Move away from the slot only where a full-width aperture would break
  // its vertical wall. Blend back to the original rail with level tangents.
  const stations = new Set(endLine.ts.map(t => t * length));
  for (const d of [slitLength, landing]) {
    stations.add(d);
    if (!startOnly) stations.add(length - d);
  }
  if (lead) for (let i = 1; i <= 6; i++) {
    stations.add(landing + lead * i / 6);
    if (!startOnly) stations.add(length - landing - lead * i / 6);
  }
  const ordered = [...stations].sort((a, b) => a - b);
  function point(d, side, guide = false) {
    const fromEnd = startOnly ? d : Math.min(d, length - d);
    const u = lead ? Math.max(0, Math.min(1, (fromEnd - landing) / lead)) : 1;
    const offset = guide ? 0 : mid + sign * (shift * (1 - u * u * (3 - 2 * u)) + side);
    return interpolateStation(endLine.ts, d / length, i => line.atOffset(knots[i], offset));
  }
  const half = p.braidWidth / 2;
  function band(a, b, halfWidth) {
    const ds = [a, ...ordered.filter(d => d > a && d < b), b];
    return [...ds.map(d => point(d, -halfWidth)), ...ds.reverse().map(d => point(d, halfWidth))];
  }
  const ends = [[0, slitLength, landing], [length, length - slitLength, length - landing]]
    .slice(0, startOnly ? 1 : 2);
  rail.points = ordered.map(d => point(d, 0));
  rail.polygon = band(0, length, half);
  rail.turnoutCover = [...ordered.map(d => point(d, 0, true)), ...ordered.map(d => point(d, half)).reverse()];
  return ends.map(([tip, fold, tailEnd]) => ({
    xy: point((tip + fold) / 2, 0),
    opening: { kind: 'slot', length: slitLength, outline: band(Math.min(tip, fold), Math.max(tip, fold), half) },
    tailPocket: band(Math.min(tip, tailEnd), Math.max(tip, tailEnd), half + 0.15),
  }));
}

export function pitBraidLayout(p, geometry = pitLayout(p)) {
  const conductors = [], jumpers = [];
  const result = { conductors, jumpers, protectedEndX: -Infinity };
  const { lanePaths, branches, forks } = geometry;
  // A motor drives each flipper with a slider in its island. Print seams and
  // the island braids keep clear of it, with or without braid.
  const drives = p.special.motorMount
    ? forks.map((fork, i) => pitDriveLayout(p, fork, lanePaths[p.lanes + i]))
    : [];
  if (drives.length)
    result.driveSpan = {
      min: Math.min(...drives.map((drive) => drive.start)),
      max: Math.max(...drives.map((drive) => drive.end)),
    };
  if (!p.braidWidth) return result;
  const port = p.length / 2 + 0.05;
  const lines = lanePaths.slice(0, p.lanes).map((points) =>
    measuredLane([
      [-port, points[0][1]],
      [port, points.at(-1)[1]],
    ]),
  );
  const outer = p.slotWidth / 2 + p.braidGap + p.braidWidth,
    mid = outer - p.braidWidth / 2;
  const viaRadius = Math.min(0.9, 0.24 * p.braidWidth),
    slotted = p.special.pitContactMode === 'braid',
    feedLength = slotted ? p.special.pitContactLength ?? PIT_CONTACT_DEFAULTS.pitContactLength : Math.max(1.2, 2 * (viaRadius + 0.4));
  const shift = pitBraidLandingShift(p);
  const wireWidth = Math.min(1.8, 0.75 * p.braidWidth);
  const wireDepth = Math.min(1.5, (p.height - p.slotDepth) * 0.55);
  for (let i = 0; i < lines.length; i++) {
    const main = lines[i],
      driver = i + 1;
    const forkIndex = branches.findIndex(
      (sign) => i === (sign > 0 ? p.lanes - 1 : 0),
    );
    if (forkIndex < 0) {
      for (const side of [-1, 1])
        conductors.push(makeRail(p, main, driver, side, 'main'));
      continue;
    }
    const sign = branches[forkIndex],
      fork = forks[forkIndex];
    const pts = lanePaths[p.lanes + forkIndex],
      y = pts[0][1];
    const pit = measuredLane([[-port, y], ...pts, [port, y]]);
    const mainOutside = makeRail(p, main, driver, -sign, 'main');
    const pitOutside = makeRail(p, pit, driver, sign, 'pit');
    conductors.push(mainOutside, pitOutside);
    // At the first feasible X the full-width facing conductors have at
    // least 1 mm between them. Allow extra room for their skew cut ends
    // and for the full sweep of the moving blade at its heel.
    let lo = pts[0][0],
      hi = 0;
    for (let n = 0; n < 30; n++) {
      const x = (lo + hi) / 2;
      const landingEdge = outer + shift;
      const t = xStation(pit, -sign * landingEdge, x);
      const gap = sign * (pit.atOffset(t, -sign * landingEdge)[1] - y) - landingEdge;
      if (gap >= 1) hi = x;
      else lo = x;
    }
    const minX = Math.max(
      hi + p.braidWidth / 2 + 1,
      fork.guardEndX + 1 + p.braidWidth / 2,
    );
    // Stagger the jumper pairs so wires running across the underside do not
    // cross, even when a single shallow channel is all the guide floor allows.
    const stagger = feedLength + wireWidth + 1;
    // With a motor the two island strips start where the slider leaves
    // them room, and their entry contacts lie behind the motor. A folded
    // braid tail is its strip's own end, so that strip starts there too.
    const drive = drives[forkIndex];
    const behind = drive ? drive.end + wireWidth / 2 + 1 : -Infinity;
    const mainStart = Math.max(minX, drive?.mainStripStart ?? -Infinity),
      pitStart = Math.max(minX + stagger, drive?.stripStart ?? -Infinity);
    const mainContact = Math.max(mainStart, behind),
      pitContact = Math.max(pitStart, mainContact + (drive ? stagger : 0));
    for (const [line, polarity, route, opposite, x, start, contactX] of [
      [main, sign, 'main island', pitOutside, minX, mainStart, mainContact],
      [pit, -sign, 'pit island', mainOutside, minX + stagger, pitStart, pitContact],
    ]) {
      const centreOffset = polarity * mid;
      const from = xStation(line, centreOffset, slotted ? contactX : start),
        to = xStation(line, centreOffset, -x);
      const half = feedLength / (2 * line.total);
      if (to - from <= 4 * half + 1 / line.total)
        throw Error(
          'The pit is too short for its insulated island conductors and terminals. Lengthen it or increase the pit offset.',
        );
      const island = makeRail(p, line, driver, polarity, route, from, to);
      conductors.push(island);
      const first = xStation(line, centreOffset, contactX) + half;
      if (first + 2 * half >= to - half)
        throw Error('The pit motor leaves too little room for both braid feeds. Lengthen the pit or reduce motor width or stroke.');
      const ends = slotted ? slottedIsland(p, island, polarity, feedLength, shift) :
        [first, to - half].map(station => {
          const xy = line.atOffset(station, centreOffset);
          return { xy, opening: wireOpening(xy, viaRadius) };
        });
      for (const {xy, opening, tailPocket} of ends) {
        const padAt = xStation(opposite.line, opposite.mid, xy[0]);
        const via = opposite.line.atOffset(padAt, opposite.mid);
        jumpers.push({
          driver,
          side: island.side,
          from: xy,
          to: via,
          viaRadius,
          openings: [opening, wireOpening(via, viaRadius)],
          tailPocket,
          wireWidth,
          wireDepth,
        });
      }
      const terminalX = line.atOffset(first + half, centreOffset)[0];
      result.protectedEndX = Math.max(
        result.protectedEndX,
        terminalX + p.wall + outer + 1,
      );
      if (slotted)
        for (const { tailPocket } of ends)
          for (const [x] of tailPocket)
            result.protectedEndX = Math.max(result.protectedEndX, -Math.abs(x) + p.wall + 1);
    }
  }
  return result;
}

export function pitBraidSections(work, p, layout) {
  if (!layout.conductors.length) return { recess: null, cover: null };
  const union = (outline) => work.own(work.wasm.CrossSection.union(
    layout.conductors.map(rail => work.section([outline(rail)])),
  ));
  // The flipper swings beneath the fixed shoulder and braid. Cutting only
  // the braid polygon leaves a full-height land above that same pocket.
  const cover = union(rail => rail.turnoutCover);
  const recess = p.braidGap > 0 || p.special.pitContactMode === 'braid'
    ? union(rail => p.braidGap > 0 || rail.route.endsWith('island') ? rail.polygon : rail.turnoutCover)
    : cover;
  return { recess, cover };
}

export function cutPitBraidFeeds(work, p, roads, layout) {
  const userFeeds = new Map(roads.map(road => [road, road.feedCuts.slice()]));
  for (const { from, to, openings, tailPocket, wireWidth, wireDepth } of layout.jumpers) {
    const x = to[0];
    const road = roads.find((part) => {
      const bounds = part.section.bounds();
      return x >= bounds.min[0] && x <= bounds.max[0];
    });
    for (const { outline } of openings) {
      const via = work.section([outline]);
      if (!road || work.own(via.subtract(road.section)).area() > 0.00001)
        throw Error('A pit contact falls on a print seam. Change the road segment count.');
      const cut = work.prism(via, -1, p.height + 1);
      if (road.feedCuts.some(other => work.and(cut, other).volume() > 0.001))
        throw Error('A pit contact overlaps another braid pass-through. Move the manual feed or shorten its opening.');
      road.feedCuts.push(cut);
      road.cuts.push(cut);
    }
    if (tailPocket) {
      const seat = work.section([tailPocket]);
      if (work.own(seat.subtract(road.section)).area() > 0.00001)
        throw Error('A folded pit braid reaches a road seam. Shorten the opening or use fewer segments.');
      const depth = Math.max(wireDepth, p.braidDepth + 0.2);
      if (depth + p.braidDepth + 0.6 > p.height)
        throw Error('The folded pit braid needs more room below its recess. Increase track height or reduce braid depth.');
      const tailCut = work.prism(seat, -1, depth);
      if (userFeeds.get(road).some(cut => work.and(tailCut, cut).volume() > 0.001))
        throw Error('A manual braid feed enters the pit braid tail pocket. Move the manual feed away from the pit contact.');
      road.cuts.push(tailCut);
      // Give the folded tail a backing surface at the same height on a
      // hollow print as on a solid one. All guide and pocket cuts still apply.
      if (p.hollow) {
        const backing = work.own(seat.offset(0.35, 'Round'));
        road.additions.push(work.prism(backing, depth, p.height - p.deck / 2));
      }
    }
    const [y0, y1] = [from[1], to[1]].sort((a, b) => a - b);
    const h = wireWidth / 2;
    const trench = work.section([
      [
        [x - h, y0 - h],
        [x + h, y0 - h],
        [x + h, y1 + h],
        [x - h, y1 + h],
      ],
    ]);
    const wireCut = work.prism(trench, -1, wireDepth);
    if (tailPocket && userFeeds.get(road).some(cut => work.and(wireCut, cut).volume() > 0.001))
      throw Error('A manual braid feed enters the pit jumper channel. Move the manual feed away from the pit contact.');
    road.cuts.push(wireCut);
  }
}
