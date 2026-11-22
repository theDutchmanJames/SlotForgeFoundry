import { attachBraidFeeds } from './braid-feeds.js';

export function insulatedHairpinShelves(work, p, path, tools) {
  for (const [a, b] of path.protectedStations) {
    for (let i = 1; i < p.segments; i++) {
      if (i / p.segments >= a && i / p.segments <= b)
        throw Error(
          'Road seam ' +
            i +
            ' passes through a hairpin crossover or its braid terminals. Choose a different road segment count, move the crossing, or use Fit to plate.',
        );
    }
  }
  if (!p.braidWidth) return;
  tools.forEach((entry, i) => {
    const lane = path.measuredLanes[i];
    // Larger than the cut shelf. The first and last cross-sections give all
    // four braid ends a square shoulder following the actual slot tangent.
    const half = p.slotWidth / 2 + p.braidGap + p.braidWidth + 1;
    const masks = path.sites[i].map(([a, b]) => {
      const ts = [a, ...lane.ts.filter((t) => t > a && t < b), b];
      return work.section([
        [
          ...ts.map((t) => lane.atOffset(t, -half)),
          ...ts.reverse().map((t) => lane.atOffset(t, half)),
        ],
      ]);
    });
    entry[2] = work.own(
      entry[2].subtract(work.own(work.wasm.CrossSection.union(masks))),
    );
  });
  const first = work.own(tools[0][2].offset(p.special.isolation / 2));
  const second = work.own(tools[1][2].offset(p.special.isolation / 2));
  if (work.own(first.intersect(second)).area() > 0.0001)
    throw Error(
      'The insulated braid ends are too close together. Increase lane spacing or steepen the crossing.',
    );
}

export function hairpinWireProfile(p) {
  const deep = Math.min(3, p.height - p.slotDepth - 0.45);
  const shallow = deep / 2,
    width = Math.min(2.4, p.braidWidth * 0.8);
  const maxDiameter =
    Math.floor(10 * Math.min(shallow - 0.12, width - 0.15)) / 10;
  return { deep, shallow, width, maxDiameter };
}

export function hairpinFeeds(work, p, path, roads) {
  if (!p.braidWidth) return;
  const wires = hairpinWireProfile(p);
  if (wires.maxDiameter < 0.3)
    throw Error(
      'The hairpin needs room under the guide floor for two insulated jumper wires. Increase track height or braid width, or reduce guide depth.',
    );
  path.measuredLanes.forEach((lane, i) => {
    const feedLength = p.braidFeedLength;
    const half = feedLength / (2 * lane.total);
    if (
      p.braidFeedSide !== 'none' &&
      (!p.braidFeedLane || p.braidFeedLane === i + 1) &&
      p.braidFeedStations.some((t) =>
        path.sites[i].some(([a, b]) => t + half >= a && t - half <= b),
      )
    )
      throw Error(
        'A manual braid pass-through falls in an insulated hairpin crossing. Move it along the powered part of the lane.',
      );
    const braidFeedStations = path.sites[i].flatMap(([a, b]) => [
      a - half,
      b + half,
    ]);
    attachBraidFeeds(
      work,
      { ...p, braidFeedSide: 'both', braidFeedLane: 0, braidFeedStations },
      roads,
      [lane],
    );
    // Seat lane 1 deep and lane 2 shallow. At a crossing their insulated
    // wires stack within the road envelope. The slot floor retains a roof.
    path.sites[i].forEach(([a, b], j) => {
      const start = a - half,
        finish = b + half;
      const stations = [
        start,
        ...lane.ts.filter((t) => t > start && t < finish),
        finish,
      ];
      const crossing =
        j === 0 ? p.special.crossingAt : 1 - p.special.crossingAt;
      const road = roads[Math.floor(crossing * p.segments)];
      for (const sign of [-1, 1]) {
        const mid = sign * (p.slotWidth / 2 + p.braidGap + p.braidWidth / 2);
        const boundary = (d) => stations.map((t) => lane.atOffset(t, mid + d));
        const trench = work.section([
          [
            ...boundary(-wires.width / 2),
            ...boundary(wires.width / 2).reverse(),
          ],
        ]);
        if (work.own(trench.subtract(road.section)).area() > 0.00001)
          throw Error(
            'A hairpin wire channel reaches a road seam. Move the crossing or choose a different road segment count.',
          );
        road.cuts.push(
          work.prism(trench, -1, i === 0 ? wires.deep : wires.shallow),
        );
      }
    });
  });
}
