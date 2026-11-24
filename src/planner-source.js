import { buildTrack, chooseSegmentation, fitPlate } from './track.js';
import { checkProject, newProject } from './project.js';
import { SolidWorkshop } from './geometry/solids.js';
import { bridgeBlocks } from './geometry/bridge-supports.js';
import { installPart } from './geometry/bridge-build.js';
import { printableSTL } from './kit.js';
import { encodeSTL } from './editor.js';
import { isScrewClip, screwClipFamily } from './geometry/screw-clip.js';

const middle = (a, b) => a.map((x, i) => (x + b[i]) / 2);
function distanceToPath(q, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i],
      dx = b[0] - a[0],
      dy = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
    best = Math.min(
      best,
      Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy),
    );
  }
  return best;
}

function sectionsFor(parts, p) {
  const sections = [],
    roads = parts.filter((part) => part.role === 'road');
  for (const road of roads) {
    const strip = road.plannerStrip;
    if (!strip)
      throw Error(
        'This drawing has no identifiable road ends. Open a track piece with two road edges in Track Set.',
      );
    // A wide pit prints as two parallel halves at each station. Their lane
    // network and the transverse joint belong to the same placement section.
    const pair = p.special?.type === 'pit' && p.segments > 1 && p.lanes > 1;
    if (pair && sections.at(-1)?.strip === strip) {
      sections.at(-1).parts.push(road.id);
      continue;
    }
    sections.push({ strip, parts: [road.id], road: road.id });
  }
  const axes = sections.map(({ strip }) =>
    strip.sides[0].map((a, i) => middle(a, strip.sides[1][i])),
  );
  const portHardware = {};
  for (const part of parts.filter((v) => v.role !== 'road')) {
    const box = part.solid.boundingBox(),
      q = middle(box.min, box.max);
    let idx = 0,
      best = Infinity;
    for (const [i, line] of axes.entries()) {
      const d = distanceToPath(q, line);
      if (d < best - 0.0001) {
        best = d;
        idx = i;
      }
    }
    // Hardware at a seam is issued with the preceding road, just as in
    // Track Set. The same keeper on a curved seam can lie nearer the next axis.
    const clip = /^road-clip-(\d+)(?:-|$)/.exec(part.id);
    if (clip && !p.special && p.kind !== 'import')
      idx = Math.min(sections.length - 1, Math.max(0, Number(clip[1]) - 1));
    if (part.plannerJoint) {
      const { xy, dir, side } = part.plannerJoint;
      let owner;
      sections.forEach(({ strip }, index) =>
        strip.ports.forEach((port, i) => {
          const outward =
            Math.cos(port.angle) * dir[0] + Math.sin(port.angle) * dir[1];
          if (outward * side < -0.65 && distanceToPath(xy, port.edges) < 0.15)
            owner = { index, i };
        }),
      );
      if (owner) {
        idx = owner.index;
        portHardware[part.id] = owner.i;
      }
    }
    sections[idx].parts.push(part.id);
  }
  const byId = new Map(parts.map((p) => [p.id, p]));
  return sections.map(({ road, strip, parts: ids }) => ({
    ...strip,
    road,
    parts: ids,
    hardwareEnds: Object.fromEntries(
      ids
        .filter((id) => Object.hasOwn(portHardware, id))
        .map((id) => [id, portHardware[id]]),
    ),
    ports: strip.ports.map((port) => ({
      ...port,
      hardware: ids
        .flatMap((id) =>
          byId.get(id).role === 'road' ? (byId.get(id).jointGuides ?? []) : [],
        )
        .filter((g) => distanceToPath(g.point, port.edges) < 0.12)
        .map((g) => ({
          kind: g.kind,
          xy: g.point.slice(0, 2),
          family: g.kind === 'Clip' ? (isScrewClip(p) ? screwClipFamily(p) : p.clipType) : '',
        })),
    })),
  }));
}

export function plannerSource(
  wasm,
  { track, plate, autoFit = true, mirrorPockets = false },
  describe,
) {
  const project = checkProject({
    ...newProject(),
    track: structuredClone(track),
    plate,
  });
  const p = project.track.params,
    plan = project.track.plan;
  // A turnout prints as one road piece: it is never cut to fit a plate.
  const whole = p.special?.type === 'turnout';
  if (whole) autoFit = false;
  let parts = [],
    warning = '';
  const free = () => {
    for (const part of parts) part.solid.delete();
    parts = [];
  };
  const build = () => {
    free();
    parts = buildTrack(wasm, p, plan, undefined, undefined, {
      planning: true,
      mirrorPockets,
    });
  };
  const fits = (part) =>
    fitPlate(part.footprintXY, plate.width, plate.depth, plate.margin).fits;
  function alignBorderCuts() {
    if (
      p.borderSide === 'none' ||
      p.borderEnds ||
      p.special?.type === 'diamond'
    )
      return;
    const perRoad = Math.min(
      Math.ceil(p.borderSegments / p.segments),
      Math.floor(32 / p.segments),
    );
    p.borderSegments = perRoad * p.segments;
  }
  try {
    // Matching border seams allow a partial corner to keep its own borders.
    if (autoFit) alignBorderCuts();
    let firstError;
    try {
      build();
    } catch (err) {
      firstError = err;
    }
    if (
      autoFit &&
      (firstError || parts.some((v) => v.role === 'road' && !fits(v)))
    ) {
      const answer = chooseSegmentation(wasm, p, plan, plate, 'road-1');
      if (answer.fits) {
        p.segments = answer.count;
        alignBorderCuts();
        build();
      } else if (firstError) throw firstError;
      else warning = answer.reason;
    } else if (firstError) throw firstError;
    if (autoFit && parts.some((v) => v.role === 'border' && !fits(v))) {
      const answer = chooseSegmentation(
        wasm,
        p,
        plan,
        plate,
        parts.find((v) => v.role === 'border').id,
      );
      if (answer.fits) {
        p.borderSegments = answer.count;
        alignBorderCuts();
        build();
      } else warning = answer.reason;
    }
    if (whole && parts.some((v) => v.role === 'road' && !fits(v)))
      warning = 'A turnout prints as one road piece, and this one is larger than the print plate.';
    const sections = sectionsFor(parts, p);
    const meshes = describe(parts, project);
    meshes.forEach((m, i) => {
      m.outline = parts[i].outline;
    });
    return { track: project.track, sections, meshes, warning };
  } finally {
    free();
  }
}

// Rebuild the original parts for printing, then apply the requested handedness
// in their flat print pose. Keep generated connector-specific print poses.
export function plannerPrint(wasm, { track, items }) {
  const variants = new Map();
  try {
    return items.map(({ id, mirror, pose }) => {
      if (!variants.has(mirror)) {
        const parts = buildTrack(
          wasm,
          track.params,
          track.plan,
          undefined,
          undefined,
          { mirrorPockets: mirror },
        );
        variants.set(mirror, new Map(parts.map((part) => [part.id, part])));
      }
      const byId = variants.get(mirror);
      const original = byId.get(id);
      if (!original)
        throw Error('A requested print segment is absent from the recipe.');
      const work = new SolidWorkshop(wasm);
      try {
        const part = {
          ...original,
          kerbMarkings: undefined,
          jointGuides: undefined,
        };
        const loose = part.role === 'clip' || part.role === 'retainer';
        if (pose?.slope && !loose)
          installPart(work, part, pose, track.params.height);
        const bytes = printableSTL(
          part,
          mirror && !loose
            ? (solid, header) => {
                const mirrored = work.own(solid.mirror([0, 1, 0]));
                return encodeSTL(mirrored, header);
              }
            : encodeSTL,
          part.clipType,
          { mode: 'track', track },
          true,
        );
        return bytes;
      } finally {
        work.close();
      }
    });
  } finally {
    for (const byId of variants.values())
      for (const part of byId.values()) part.solid.delete();
  }
}

export function plannerSupports(wasm, { requests, plate }, describe) {
  const work = new SolidWorkshop(wasm),
    occupied = [],
    blocks = [];
  try {
    for (const [index, r] of requests.entries()) {
      const { start, end } = r;
      const slope = start !== end;
      const correction = r.correction || 0;
      const profile = {
        level: { start: 0, end: slope ? 0 : 1, z: start },
        approaches: slope
          ? [
              {
                start: 0,
                end: 1,
                zStart: start + correction,
                zEnd: end + correction,
              },
            ]
          : [],
      };
      const obstacles = r.obstacles.length
        ? work.own(
            wasm.CrossSection.union(
              r.obstacles.map((loops) => work.section(loops)),
            ),
          )
        : null;
      blocks.push(
        ...bridgeBlocks(
          work,
          { bridgeSupportCount: r.count, bridgeSupportStyle: r.style, bridgePegSize: r.peg },
          { sides: r.sides },
          profile,
          { crossingIndex: index, sectionIndex: r.node, obstacles, occupied },
        ),
      );
    }
    return describe(blocks, { plate }).map((m, i) => ({
      ...m,
      stl: printableSTL(blocks[i], encodeSTL),
    }));
  } finally {
    work.close();
  }
}
