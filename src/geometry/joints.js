import { left, move } from './solids.js';
import { forkClipPair } from './fork-clip.js';
import { currentJointSettings, resolveJointFit } from './joint-fit.js';

function toolsAt(work, point, dir) {
  const across = left(dir);
  const shape = (loop, lo, hi) =>
    work.prism(
      work.section([
        loop.map(([x, y]) => move(move(point, dir, x), across, y)),
      ]),
      lo,
      hi,
    );
  return {
    shape,
    box: (x0, x1, y0, y1, z0, z1) =>
      shape(
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ],
        z0,
        z1,
      ),
  };
}

function anchor(work, part, pad, p) {
  for (const feed of part?.feedCuts ?? []) {
    const collision = work.and(feed, pad);
    if (!collision.isEmpty() && collision.volume() > 0.001)
      throw new Error(
        'A braid pass-through intersects a connector support. Move its station or the connector.',
      );
  }
  if (part && p.hollow) {
    const limits = work.prism(part.section, 0, p.height);
    part.additions.push(work.and(pad, limits));
    // Tab supports can sit above the bed, outside the open-bottom cutter list.
    if (p.reinforcement) (part.ribKeepouts ??= []).push(work.own(pad.project()));
  }
}

// Placement offsets catch most conflicts cheaply. A deep braid shelf, or an
// oblique imported lane, can still cross a pocket or pierce its thin roof.
function ensureJointStock(work, part, envelope) {
  const bounds = envelope.boundingBox();
  for (const earlier of part.cuts) {
    const cut = earlier.boundingBox();
    if (
      cut.max.some(
        (max, i) => max <= bounds.min[i] || cut.min[i] >= bounds.max[i],
      )
    )
      continue;
    if (work.and(earlier, envelope).volume() > 0.001)
      throw Error(
        'A connector or its roof intersects a slot, braid recess or another pocket. ' +
          'Move the connector or reduce the recess depth.',
      );
  }
}

/** Mating local coordinate: the first body occupies x<0 and points towards x>0. */
export function tabPair(work, p, point, dir, first, second) {
  const fit = resolveJointFit(p);
  const {
    version,
    tabClearance: c,
    tabWidth,
    tabLength: end,
    tabBottom: bottom,
    tabTop: top,
    tabRootLength,
    tabRootSupportDepth,
    tabSocketSupportDepth,
    tabSupportHalfWidth,
  } = fit;
  if (first)
    (first.jointGuides ??= []).push({
      kind: 'Tab',
      point: [...point, top],
    });
  if (second)
    (second.jointGuides ??= []).push({
      kind: 'Socket',
      point: [...point, top],
    });
  const { box, shape } = toolsAt(work, point, dir);
  const half = tabWidth / 2;
  const shoulder = end * 0.75;
  const tip = half * (2.2 / 3);
  if (first) {
    anchor(
      work,
      first,
      box(
        -tabRootSupportDepth,
        0,
        -half - 1.5,
        half + 1.5,
        bottom - 1,
        p.height,
      ),
      p,
    );
    if (version === 2)
      ensureJointStock(
        work,
        first,
        box(-tabRootLength, 0, -half, half, bottom, top + 0.4),
      );
    first.additions.push(
      shape(
        [
          [-tabRootLength, -half],
          [shoulder, -half],
          [end, -tip],
          [end, tip],
          [shoulder, half],
          [-tabRootLength, half],
        ],
        bottom,
        top,
      ),
    );
  }
  if (second) {
    anchor(
      work,
      second,
      box(
        version === 2 ? -tabRootLength - c : 0,
        tabSocketSupportDepth,
        -tabSupportHalfWidth,
        tabSupportHalfWidth,
        Math.max(
          0,
          bottom - (version === 2 ? Math.max(0.4, p.wall) + c : p.wall),
        ),
        p.height,
      ),
      p,
    );
    if (version === 1) {
      second.cuts.push(
        box(-1, end + c, -half - c, half + c, bottom - c, top + c),
      );
    } else {
      // Intersect the offset side, tapered flank and end planes. Adding c to
      // their Y coordinates alone would make the diagonal faces tighter.
      const slope = (half - tip) / (end - shoulder);
      const normal = Math.hypot(1, slope);
      const corner = shoulder + (c * (normal - 1)) / slope;
      const tipWidth = tip + c * (normal - slope);
      const side = [
        [-tabRootLength - c, half + c + 0.3],
        [0, half + c + 0.3],
        [0.8, half + c],
        [corner, half + c],
        [end + c, tipWidth],
      ];
      const loop = [...side, ...side.map(([x, y]) => [x, -y]).reverse()];
      ensureJointStock(work, second, shape(loop, bottom - c, top + c + 0.4));
      second.cuts.push(shape(loop, bottom - c, top + c));
    }
  }
}

/** Make matching open pockets and their removable hardware on a track seam. */
export function clipPair(
  work,
  p,
  point,
  dir,
  first,
  second,
  loose,
  id,
  externalKeeper,
) {
  for (const part of [first, second])
    if (part)
      (part.jointGuides ??= []).push({ kind: 'Clip', point: [...point, 0] });
  const settings = currentJointSettings(p);
  return forkClipPair(
    work,
    settings,
    resolveJointFit(settings),
    point,
    dir,
    first,
    second,
    loose,
    id,
    {
      anchor,
      ensureJointStock,
      externalKeeper,
    },
  );
}

/** Use the printable orientation and unloaded shape when exporting hardware. */
export function withPrintableSolid(part, callback, { sideDown = false } = {}) {
  return part.printPose
    ? part.printPose(callback, sideDown)
    : callback(part.solid);
}
