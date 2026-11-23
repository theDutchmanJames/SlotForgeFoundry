import { faceHinge, throughPartDepth } from './editor.js';
import { faceTrimMetrics } from './face-trim.js';
import {
  nativeBraidLane,
  nativePath,
  nativeTrackPoint,
} from './track.js';
import { importedTrackPaths } from './geometry/import-track.js';
import { apexPositionFor, borderPath } from './geometry/border-profile.js';
import { borderEndProfile, borderSeam } from './geometry/border-ends.js';
import { markingStations, whiteLineLayout } from './geometry/paint-guides.js';
import { startingGridLayout } from './geometry/starting-grid.js';
import { designGuides } from './design-guides.js';
import { laneOffsetAt } from './lane-adjustment.js';
import { hasSlotPosition, slotEdgeName, slotEnds, slotVaries } from './slot-position.js';
import { SPECIAL_PIECES, specialPreview } from './special-pieces.js';
import { featureGuides } from './create-feature-controls.js';
import {
  edgeSelectionLabel,
  edgesForScope,
} from './wall-edge-modify-controls.js';
import { holeModifyGuides, isHoleRim } from './hole-modify.js';
import { healStretchGuides } from './heal-stretch.js';

/** Inspector fields that show the slot and its distance from the road edge. */
export const SLOT_POSITION_FIELDS = Object.freeze([
  'slotPosition',
  'slotEdge',
  'slotStart',
  'slotEnd',
]);

const radians = (d) => (d * Math.PI) / 180;
const fmt = (n) => String(Number(n.toFixed(2)));
const mm = (n) => fmt(n) + ' mm';
const add = (a, b) => a.map((v, i) => v + b[i]);
const scale = (a, k) => a.map((v) => v * k);
const mid = (a, b) => a.map((v, i) => (v + b[i]) / 2);
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const axisNames = ['X', 'Y', 'Z'];
const withZ = (p, z) => [p[0], p[1], z];
const extent = (b) => Math.max(...b.max.map((v, i) => v - b.min[i]));
const framePoint = (f, x, y, z = 0) =>
  add(f.origin, add(scale(f.u, x), add(scale(f.v, y), scale(f.normal, z))));
const label = (id, tone, anchor, text, paths = [], options = {}) => ({
  id,
  tone,
  anchor,
  text,
  paths,
  ...options,
});
const line = (id, tone, points, options = {}) => ({
  id,
  tone,
  paths: [points],
  ...options,
});
const dimension = (id, tone, a, b, text) =>
  label(id, tone, mid(a, b), text, [[a, b]], { dots: [a, b] });
const braidWallDimension = (p, slot, recess) =>
  dimension('braid-wall-width', 'accent', slot, recess, 'Wall beside slot · ' + mm(p.braidGap));
const closed = (loop) => [...loop, loop[0]];
function gridMarkGuide(p, field, { paint, grooves }, id, caption) {
  const showGroove = grooves.length > 0 &&
    ['gridRecessed', 'spPitGridRecessed', 'grooveWidth', 'grooveDepth'].includes(field);
  const z = showGroove ? p.height - p.grooveDepth : p.height;
  const paths = (showGroove ? grooves : paint).map(ring => closed(ring.map(q => withZ(q, z))));
  return label(id, showGroove ? 'cut' : 'reference', paths[0][0],
    showGroove ? 'Paint groove · ' + mm(p.grooveWidth) + ' × ' + mm(p.grooveDepth) : caption, paths);
}

function startingGridGuide(p, field) {
  const grid = p.startingGrid;
  const offset = grid.stagger === 0 ? 'Side by side' : 'Row offset · ' + mm(Math.abs(grid.stagger));
  const text = {
    gridWidth: 'Mark width · ' + mm(grid.width),
    gridThickness: 'Line thickness · ' + mm(grid.thickness),
    gridLegLength: 'Leg length · ' + mm(grid.legLength),
    gridLayout: offset,
    gridStagger: offset,
  }[field] ?? 'Starting grid';
  return gridMarkGuide(p, field, startingGridLayout(p), 'starting-grid', text);
}

function pitGridGuide(p, field, layout, parts) {
  const grid = p.special.pitGrid;
  const separate = p.special.side === 'both' && grid.rightPosition !== undefined;
  let paint = layout.paint;
  let caption = {
    spPitGridWidth: 'Mark width · ' + mm(grid.width),
    spPitGridThickness: 'Line thickness · ' + mm(grid.thickness),
    spPitGridLegLength: 'Leg length · ' + mm(grid.legLength),
  }[field] ?? (separate ? 'Pit grid markers' : 'Pit grid marker · ' + fmt(grid.position) + '% along the bay');
  if (separate && ['spPitGridPosition', 'spPitGridRightPosition'].includes(field)) {
    const right = field === 'spPitGridRightPosition';
    paint = paint.filter(loop => (loop[0][1] < 0) === right);
    caption = (right ? 'Right' : 'Left') + ' pit · ' + fmt(right ? grid.rightPosition : grid.position) + '% along the bay';
  }
  const grooves = parts.find(part => part.pitGridGrooveGuide)?.pitGridGrooveGuide ?? layout.grooves;
  return gridMarkGuide(p, field, { paint, grooves }, 'pit-grid-marker', caption);
}

// Place the label beside the pit box when the divider crosses the middle of the piece.
function pitStripeAnchor(paths) {
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      if (a[0] === 0) return a;
      if ((a[0] < 0) !== (b[0] < 0)) {
        const t = -a[0] / (b[0] - a[0]);
        return [0, a[1] + (b[1] - a[1]) * t, a[2]];
      }
    }
  }
  return paths[0][0];
}
function sample(points, cap) {
  if (points.length <= cap) return points;
  return Array.from(
    { length: cap },
    (_, i) => points[Math.round((i * (points.length - 1)) / (cap - 1))],
  );
}

// The cut outline follows actual mesh triangles. On large jobs retain just the
// movable cutting plane so orbiting and typing never require a heavy mesh scan.
function sectionSegments(part, normal, offset) {
  const { positions, indices } = part;
  if (!positions || !indices || indices.length > 90000) return [];
  const vertex = (i) => [
    positions[3 * i],
    positions[3 * i + 1],
    positions[3 * i + 2],
  ];
  const epsilon = Math.max(1e-9, extent(part.bounds) * 1e-7);
  const paths = [];
  for (let i = 0; i < indices.length; i += 3) {
    const pts = [
      vertex(indices[i]),
      vertex(indices[i + 1]),
      vertex(indices[i + 2]),
    ];
    const d = pts.map((p) => dot(p, normal) - offset);
    if (
      d.every((v) => v > epsilon) ||
      d.every((v) => v < -epsilon) ||
      d.every((v) => Math.abs(v) <= epsilon)
    )
      continue;
    const hit = [];
    for (let j = 0; j < 3; j++) {
      const k = (j + 1) % 3;
      if (Math.abs(d[j]) <= epsilon) hit.push(pts[j]);
      else if (
        (d[j] > epsilon && d[k] < -epsilon) ||
        (d[k] > epsilon && d[j] < -epsilon)
      ) {
        const t = d[j] / (d[j] - d[k]);
        hit.push(pts[j].map((v, n) => v + t * (pts[k][n] - v)));
      }
    }
    if (hit.length === 2 && dist(hit[0], hit[1]) > epsilon) paths.push(hit);
    if (paths.length >= 1600) return []; // The plane remains visible at every resolution.
  }
  return paths;
}

function trimGuides(part, op) {
  const { frame } = op;
  const trim = faceTrimMetrics(part.positions, frame, op.trimMode, op.amount);
  if (!trim.valid) return [];
  const local = boxCorners(part.bounds).map((p) => {
    const delta = p.map((v, i) => v - frame.origin[i]);
    return [dot(delta, frame.u), dot(delta, frame.v)];
  });
  const margin = extent(part.bounds) * 0.065;
  const limits = [0, 1].map((i) => {
    const coords = local.map((p) => p[i]);
    return [Math.min(...coords) - margin, Math.max(...coords) + margin];
  });
  const planeOrigin = add(
    frame.origin,
    scale(trim.normal, trim.cut - trim.face),
  );
  const plane = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].map(([x, y]) =>
    add(
      planeOrigin,
      add(scale(frame.u, limits[0][x]), scale(frame.v, limits[1][y])),
    ),
  );
  const datum = op.trimMode === 'remove' ? trim.face : trim.min;
  const datumPoint = add(plane[1], scale(trim.normal, datum - trim.cut));
  return [
    label('trim-plane', 'cut', plane[2], 'Cut plane', [closed(plane)], {
      surface: true,
    }),
    {
      id: 'cut-contour',
      tone: 'cut',
      paths: sectionSegments(part, trim.normal, trim.cut),
      strong: true,
    },
    dimension(
      'trim-distance',
      'reference',
      datumPoint,
      plane[1],
      (op.trimMode === 'remove' ? 'Inward · ' : 'Finished size · ') +
        mm(op.amount),
    ),
  ];
}

function straightSplit(part, op) {
  const { min, max } = part.bounds;
  const axis = axisNames.indexOf(op.axis?.toUpperCase());
  if (axis < 0 || !Number.isFinite(op.position)) return [];
  const a = (axis + 1) % 3,
    b = (axis + 2) % 3,
    margin = extent(part.bounds) * 0.075;
  const point = (cut, x, y) => {
    const p = [];
    p[axis] = cut;
    p[a] = x;
    p[b] = y;
    return p;
  };
  const plane = (cut, pad) =>
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ].map(([x, y]) =>
      point(
        cut,
        x ? max[a] + pad : min[a] - pad,
        y ? max[b] + pad : min[b] - pad,
      ),
    );
  const n = [0, 0, 0];
  n[axis] = 1;
  const face = plane(op.position, margin);
  const aids = [
    label(
      'cut-plane',
      'cut',
      face[2],
      'Cut plane · ' + axisNames[axis] + ' = ' + mm(op.position),
      [closed(face)],
      { surface: true },
    ),
  ];
  aids.push({
    id: 'cut-contour',
    tone: 'cut',
    paths: sectionSegments(part, n, op.position),
    strong: true,
  });
  if (op.rebuild && op.band > 0) {
    const sides = op.keep === 'low' ? [1] : op.keep === 'high' ? [0] : [0, 1];
    for (const side of sides) {
      const end = side ? max[axis] : min[axis],
        inner = end + (side ? -op.band : op.band);
      const outerLoop = plane(end, 0),
        innerLoop = plane(inner, 0);
      const paths = [
        closed(outerLoop),
        closed(innerLoop),
        ...outerLoop.map((p, i) => [p, innerLoop[i]]),
      ];
      aids.push(
        label(
          'donor-' + side,
          'reference',
          mid(outerLoop[2], innerLoop[2]),
          side === sides.at(-1) ? 'Copied end · ' + mm(op.band) : '',
          paths,
          { dashed: true },
        ),
      );
    }
  }
  return aids;
}

function radialSplit(part, op) {
  const { center, splitAngle, startAngle, endAngle } = op;
  if (
    !center?.every(Number.isFinite) ||
    ![splitAngle, startAngle, endAngle].every(Number.isFinite)
  )
    return [];
  const { min, max } = part.bounds,
    [cx, cy] = center;
  const nearest = Math.hypot(
    Math.max(min[0] - cx, 0, cx - max[0]),
    Math.max(min[1] - cy, 0, cy - max[1]),
  );
  const far = Math.hypot(
    Math.max(Math.abs(min[0] - cx), Math.abs(max[0] - cx)),
    Math.max(Math.abs(min[1] - cy), Math.abs(max[1] - cy)),
  );
  const pad = extent(part.bounds) * 0.05,
    lo = Math.max(0, nearest - pad),
    hi = far + pad;
  const polar = (deg, r, z) => [
    cx + r * Math.cos(radians(deg)),
    cy + r * Math.sin(radians(deg)),
    z,
  ];
  const ray = (deg, z) => [polar(deg, lo, z), polar(deg, hi, z)];
  const plane = [
    ...ray(splitAngle, min[2] - pad),
    ...ray(splitAngle, max[2] + pad).reverse(),
  ];
  const normal = [
    -Math.sin(radians(splitAngle)),
    Math.cos(radians(splitAngle)),
    0,
  ];
  const aids = [
    label(
      'cut-plane',
      'cut',
      plane[2],
      'Radial cut · ' + fmt(splitAngle) + '°',
      [closed(plane)],
      { surface: true },
    ),
    {
      id: 'cut-contour',
      tone: 'cut',
      paths: sectionSegments(part, normal, dot(normal, [cx, cy, 0])),
      strong: true,
    },
    {
      id: 'sector',
      tone: 'reference',
      paths: [
        ray(startAngle, max[2]),
        ray(endAngle, max[2]),
        Array.from({ length: 33 }, (_, i) =>
          polar(startAngle + ((endAngle - startAngle) * i) / 32, hi, max[2]),
        ),
      ],
      dashed: true,
    },
  ];
  if (op.rebuild && op.bandAngle > 0) {
    const donors =
      op.keep === 'low'
        ? [endAngle]
        : op.keep === 'high'
          ? [startAngle]
          : [startAngle, endAngle];
    for (const end of donors) {
      const inner = end + (end === startAngle ? 1 : -1) * op.bandAngle,
        z = max[2];
      const boundary = closed([...ray(end, z), ...ray(inner, z).reverse()]);
      aids.push(
        label(
          'donor-' + end,
          'reference',
          polar(inner, hi, z),
          end === donors.at(-1)
            ? 'Copied end · ' + fmt(op.bandAngle) + '°'
            : '',
          [boundary],
          { surface: true },
        ),
      );
    }
  }
  return aids;
}

function shapeGuides(op, part) {
  if (!op?.loops?.length || !op.frame) return [];
  const f = op.frame,
    offset = op.offset ?? [0, 0],
    r = radians(op.rotation ?? 0),
    s = op.scale ?? 1;
  const a = radians(op.tiltAzimuth ?? 0),
    t = Math.tan(radians(op.tilt ?? 0)),
    d =
      op.extent === 'through'
        ? throughPartDepth(part.bounds, f.origin, f.normal)
        : op.depth;
  const normalSign = op.type === 'cut' ? -1 : 1;
  const rise = [d * t * Math.cos(a), d * t * Math.sin(a), normalSign * d];
  const near = [],
    far = [],
    sides = [];
  for (const loop of sample(op.loops, 32)) {
    const bottom = [],
      top = [];
    for (const [x, y] of sample(loop, 64)) {
      const u = offset[0] + s * (x * Math.cos(r) - y * Math.sin(r)),
        v = offset[1] + s * (x * Math.sin(r) + y * Math.cos(r));
      bottom.push(framePoint(f, u, v));
      top.push(framePoint(f, u + rise[0], v + rise[1], rise[2]));
    }
    if (!bottom.length) continue;
    near.push(closed(bottom));
    far.push(closed(top));
    for (let i = 0; i < bottom.length; i += Math.ceil(bottom.length / 4))
      sides.push([bottom[i], top[i]]);
  }
  if (!far.length) return [];
  const tone = normalSign < 0 ? 'cut' : 'add';
  const text =
    (op.extent === 'through'
      ? 'Through part'
      : (normalSign < 0 ? 'Cut' : op.separate ? 'Separate addition' : 'Add') +
        ' · ' +
        mm(d)) + (op.tilt ? ' · ' + fmt(op.tilt) + '°' : '');
  return [
    { id: 'profile-base', tone, paths: near, dashed: true },
    label('profile-tip', tone, far[0][0], text, far, { surface: true }),
    { id: 'extrusion-direction', tone, paths: sides },
  ];
}

function faceHeightGuides(profiles, plan, commonHeight) {
  if (!plan?.changes?.length || profiles.length !== plan.changes.length)
    return [];
  if (plan.valid === false && !plan.changes.every(({ delta }) => delta === 0))
    return [];
  const guides = [];
  const basis = profiles[0].frame;
  const low = [Infinity, Infinity],
    high = [-Infinity, -Infinity];
  const displayed = sample(Array.from(profiles.keys()), 32);
  for (const index of displayed) {
    const { frame, loops } = profiles[index];
    const { delta, end } = plan.changes[index];
    if (!Number.isFinite(delta) || !Number.isFinite(end)) return [];
    const startPaths = [],
      endPaths = [],
      direction = [];
    for (const loop of sample(loops, 16)) {
      if (loop.length < 3) continue;
      const start = sample(loop, 64).map(([x, y]) => framePoint(frame, x, y));
      const finish = start.map((p) => add(p, scale(plan.normal, delta)));
      startPaths.push(closed(start));
      endPaths.push(closed(finish));
      if (delta) direction.push([start[0], finish[0]]);
      if (commonHeight)
        for (const point of finish) {
          const relative = point.map((v, i) => v - basis.origin[i]);
          for (const [i, axis] of [basis.u, basis.v].entries()) {
            const v = dot(relative, axis);
            low[i] = Math.min(low[i], v);
            high[i] = Math.max(high[i], v);
          }
        }
    }
    if (!endPaths.length) continue;
    const tone = delta > 0 ? 'add' : delta < 0 ? 'cut' : 'reference';
    const id = 'face-height-' + index;
    if (delta) {
      guides.push({ id: id + '-start', tone, paths: startPaths, dashed: true });
      guides.push({ id: id + '-direction', tone, paths: direction });
    }
    const change = delta
      ? (delta > 0 ? '+' : '−') + mm(Math.abs(delta))
      : 'At height';
    guides.push(
      label(
        id,
        tone,
        endPaths[0][0],
        displayed.length <= 8 ? 'Face ' + (index + 1) + ' · ' + change : '',
        endPaths,
        { strong: true },
      ),
    );
  }
  if (commonHeight && Number.isFinite(low[0])) {
    const { delta, end } = plan.changes[0];
    const margin = Math.max(high[0] - low[0], high[1] - low[1]) * 0.05;
    const plane = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ].map(([x, y]) =>
      framePoint(
        basis,
        x ? high[0] + margin : low[0] - margin,
        y ? high[1] + margin : low[1] - margin,
        delta,
      ),
    );
    guides.unshift(
      label(
        'common-height-plane',
        'reference',
        plane[2],
        'Target height · ' + mm(end),
        [closed(plane)],
        { dashed: true },
      ),
    );
  }
  return guides;
}

function tiltGuides(op) {
  if (!op?.loops?.length || !op.frame) return [];
  const f = op.frame,
    { direction, start } = faceHinge(op, op.loops),
    slope = Math.tan(radians(op.angle));
  const edge = [-direction[1], direction[0]];
  const capHeights = [],
    outlines = [];
  let low = Infinity,
    high = -Infinity,
    tip,
    maxHeight = -1;
  for (const loop of sample(op.loops, 32)) {
    const samples = sample(loop, 80),
      ring = [];
    for (let i = 0; i < samples.length; i++) {
      const a = samples[i],
        b = samples[(i + 1) % samples.length],
        da = dot(a, direction) - start,
        db = dot(b, direction) - start;
      if (da >= 0) ring.push(a);
      if ((da > 0 && db < 0) || (db > 0 && da < 0))
        ring.push(a.map((x, j) => x + ((b[j] - x) * da) / (da - db)));
    }
    const top = ring.map((p) => {
      const level = Math.max(0, dot(p, direction) - start) * slope,
        world = framePoint(f, ...p, level);
      low = Math.min(low, dot(p, edge));
      high = Math.max(high, dot(p, edge));
      if (Math.abs(level) > maxHeight) {
        maxHeight = Math.abs(level);
        tip = world;
      }
      return world;
    });
    if (top.length) {
      outlines.push(closed(top));
      capHeights.push([framePoint(f, ...ring[0]), top[0]]);
    }
  }
  if (!tip) return [];
  const hinge = (t) =>
    framePoint(
      f,
      direction[0] * start + edge[0] * t,
      direction[1] * start + edge[1] * t,
    );
  return [
    label(
      'tilt-hinge',
      'reference',
      hinge(low),
      'Pivot line',
      [[hinge(low), hinge(high)]],
      { strong: true },
    ),
    label(
      'tilted-face',
      op.angle < 0 ? 'cut' : 'add',
      tip,
      (op.separate && op.angle > 0 ? 'Separate wedge' : 'Face angle') +
        ' · ' +
        fmt(op.angle) +
        '°',
      outlines,
      { surface: true },
    ),
    { id: 'tilt-height', tone: 'reference', paths: capHeights },
  ];
}

function boxCorners(b) {
  return Array.from({ length: 8 }, (_, i) =>
    b.min.map((x, j) => ((i >> j) & 1 ? b.max[j] : x)),
  );
}
function edges(corners) {
  return corners.flatMap((p, i) =>
    [1, 2, 4].filter((bit) => !(i & bit)).map((bit) => [p, corners[i | bit]]),
  );
}
function transformGuides(part, op, field, resultPart) {
  const b = part.bounds,
    c = mid(b.min, b.max),
    corners = boxCorners(b);
  const rot = op?.rotate ?? [0, 0, 0],
    move = op?.move ?? [0, 0, 0],
    s = op?.scale ?? 1;
  function apply(point) {
    const local = point.map((v, i) => (v - c[i]) * s);
    if (op?.mirror) local[0] *= -1;
    for (let axis = 0; axis < 3; axis++) {
      const [u, v] = [(axis + 1) % 3, (axis + 2) % 3],
        cos = Math.cos(radians(rot[axis])),
        sin = Math.sin(radians(rot[axis]));
      [local[u], local[v]] = [
        local[u] * cos - local[v] * sin,
        local[u] * sin + local[v] * cos,
      ];
    }
    return add(add(c, move), local);
  }
  const next =
      op?.layFlat && resultPart
        ? boxCorners(resultPart.bounds)
        : corners.map(apply),
    changed = s !== 1 || op?.mirror || rot.some(Boolean) || move.some(Boolean);
  const bounds = resultPart?.bounds;
  const dimensions = bounds
    ? bounds.max.map((v, i) => v - bounds.min[i])
    : rot.some(Boolean) || op?.layFlat
      ? null
      : b.max.map((v, i) => (v - b.min[i]) * s);
  const size = dimensions ? dimensions.map(fmt).join(' × ') + ' mm' : '';
  const note = field?.match(/^r[xyz]$/)
    ? 'Rotate ' +
      field[1].toUpperCase() +
      ' · ' +
      fmt(rot['xyz'.indexOf(field[1])]) +
      '°'
    : field === 'scale'
      ? 'Scale ×' + fmt(s) + (size ? ' · ' + size : '')
      : field === 'mirror' && op?.mirror
        ? 'Mirrored across local X'
        : size || 'Part bounds';
  const aids = [
    label('transform-bounds', 'reference', next[7], note, edges(next), {
      dashed: true,
    }),
  ];
  if (changed)
    aids.push({
      id: 'original-bounds',
      tone: 'neutral',
      paths: edges(corners),
      dashed: true,
    });
  if (move.some(Boolean))
    aids.push(
      dimension(
        'move-direction',
        'add',
        c,
        add(c, move),
        'Move · ' + mm(Math.hypot(...move)),
      ),
    );
  return aids;
}

function countInRange(n, max) {
  return Number.isInteger(n) && n > 0 && n <= max;
}

function pitContactGuides(p, jumpers) {
  const z = p.height - p.braidDepth;
  const guides = new Map();
  for (const { openings, viaRadius } of jumpers) {
    for (const opening of openings) {
      const outline = closed(opening.outline.map(point => withZ(point, z)));
      if (!guides.has(opening.kind)) {
        const slot = opening.kind === 'slot';
        const caption = slot
          ? 'Braid pass-through · ' + fmt(p.braidWidth) + ' × ' + mm(opening.length)
          : 'Wire hole · Ø' + mm(2 * viaRadius);
        guides.set(opening.kind, label(slot ? 'pit-braid-pass-throughs' : 'pit-wire-holes',
          slot ? 'cut' : 'reference', outline[0], caption, [], { strong: true }));
      }
      guides.get(opening.kind).paths.push(outline);
    }
  }
  return [...guides.values()];
}

function trackGuides({ track, tab, field, part, parts = [] }) {
  if (!track?.params) return [];
  let p = track.params;
  if (p.special && (tab === 'geometry' || tab === 'profile' ||
      ['diamond','pit'].includes(p.special.type))) {
    if (tab === 'joints') {
      const selected = part?.jointGuides?.length ? [part] : parts;
      return sample(selected.flatMap(item=>item.jointGuides ?? []),24)
        .map((g,i)=>label('special-joint-'+i,'reference',g.point,g.kind,[],{dots:[g.point]}));
    }
    const plan = specialPreview(p);
    const zpath = path=>sample(path,100).map(q=>withZ(q,p.height));
    if (tab==='borders')
      return (plan.borders ?? []).map((loop,i)=>line('special-border-'+i,'add',closed(zpath(loop))));
    const lines = plan.lanes.map(zpath);
    const a = lines[0][0];
    if (tab==='profile') {
      if (plan.jumpers?.length && ['spPitContactMode', 'spPitContactLength'].includes(field))
        return pitContactGuides(p, plan.jumpers);
      const b = withZ(plan.lanes[0][1],p.height);
      const d=dist(a,b);
      if (!d) return [];
      const normal=[(a[1]-b[1])/d,(b[0]-a[0])/d,0];
      const edge=add(a,scale(normal,p.slotWidth/2));
      const guides = [dimension('special-guide-depth','cut',edge,add(edge,[0,0,-p.slotDepth]),'Guide depth · '+mm(p.slotDepth))];
      if (p.braidWidth > 0) {
        const inner = add(edge,scale(normal,p.braidGap));
        const floor = add(inner,[0,0,-p.braidDepth]);
        if (field === 'braidGap' && p.braidGap > 0)
          guides.push(braidWallDimension(p,edge,inner));
        guides.push(dimension('special-braid-width','reference',floor,
          add(floor,scale(normal,p.braidWidth)),'Braid · '+mm(p.braidWidth)));
      }
      return guides;
    }
    if (p.special.type === 'pit' && tab === 'geometry') {
      const grid = p.special.pitGrid;
      const sharedGroove = ['grooveWidth', 'grooveDepth'].includes(field);
      const showMarker = plan.pitGrid?.paint.length && (field?.startsWith('spPitGrid') || (grid.recessed && sharedGroove));
      const markerGuides = showMarker ? [pitGridGuide(p, field, plan.pitGrid, parts)] : [];
      const grooveField = ['roadLineGroove', 'grooveWidth', 'grooveDepth'].includes(field);
      const stripeField = ['spPitWhiteLine', 'spPitCrossingStyle', 'whiteLineWidth'].includes(field) ||
        (p.special.pitCrossingStyle === 'dashed' && ['dashLength', 'dashGap'].includes(field));
      if ((grooveField || stripeField) && plan.pitWhiteLines?.length) {
        const stripe = plan.pitWhiteLines.map(loop => closed(loop.map(q => withZ(q, p.height))));
        const guides = [label('pit-white-line', 'reference', pitStripeAnchor(stripe),
          'Pit lane divider · ' + mm(p.whiteLineWidth), stripe)];
        const grooveLoops = parts.find(part => part.pitGrooveGuide)?.pitGrooveGuide ?? plan.pitWhiteLineGrooves;
        if (grooveField && grooveLoops?.length) {
          const grooves = grooveLoops.map(loop =>
            closed(loop.map(q => withZ(q, p.height - p.grooveDepth))));
          guides.push(label('pit-white-line-groove', 'cut', pitStripeAnchor(grooves),
            'Paint groove · ' + mm(p.grooveWidth) + ' × ' + mm(p.grooveDepth), grooves));
        }
        return [...guides, ...markerGuides];
      }
      if (markerGuides.length) return markerGuides;
    }
    if (plan.turnouts?.length) {
      const linkageField = ['spEyeDiameter', 'spRodDiameter', 'spMotorStroke'].includes(field);
      if (linkageField || part?.role === 'turnoutArm') {
        const cranks = (linkageField ? parts : [part]).filter(item => item.crankGuide);
        if (cranks.length) return cranks.map(({ crankGuide: g }) => {
          const base = withZ(g.eye, g.armTop);
          const top = withZ(g.eye, g.headPocketTop);
          const outline = closed(g.pocketOutline.map(q => withZ(q, g.headPocketTop)));
          return label('pit-eye-clearance-' + g.side, 'reference', top,
            'Clearance above eye · ' + mm(g.headPocketTop - g.armTop), [outline, [base, top]],
            { dots: [base, top] });
        });
      }
      const routeName = p.special.turnoutPosition === 'pit'
        ? 'Pit open · enter pit' : 'Pit closed · main lane';
      // A centreline through the blocked entrance would cross the solid flipper.
      const guides = plan.turnouts.map(({ side, guide }) => {
        const route = zpath(guide);
        return label('pit-flipper-' + side, 'add', route[0], routeName, [route], {strong:true});
      });
      if (p.special.motorMount) {
        for (const mount of parts.filter(item => item.motorGuide)) {
          const { side, caseBounds, rodPath } = mount.motorGuide;
          const size = caseBounds.max.map((n, i) => n - caseBounds.min[i]);
          const body = boxCorners(caseBounds);
          guides.push(
            label('pit-motor-' + side, 'reference', body[7],
              'Motor · ' + [size[1], size[0], size[2]].map(fmt).join(' × ') + ' mm',
              edges(body), { dashed: true }),
            line('pit-pushrod-' + side, 'accent', rodPath, { strong: true }),
          );
        }
      }
      return guides;
    }
    const guides=[{id:'special-routes',tone:'reference',paths:lines,dashed:true}];
    const detail=(plan.details ?? []).map(zpath);
    if(detail.length) guides.push(label('special-details','accent',detail[0][0],
      ({diamond:'Isolated braid ends',hairpin:'Isolated braid ends',timing:p.special.detector==='strip'?'Sensing strip':'Optical gate'})[p.special.type],detail));
    else guides.push(label('special-shape','reference',a,SPECIAL_PIECES.find(([id])=>id===p.special.type)[1]));
    return guides;
  }
  const crossing = p.kind === 'import' ? track.plan?.flatCrossing : undefined;
  if (crossing?.crossings.length) {
    const aids = crossing.crossings.map((c, i) => {
      const base = withZ(c.point, p.height);
      const under = withZ(c.point, p.height + (p.bridgeClearance ?? 60));
      return dimension(
        'bridge-clearance-' + i,
        'reference',
        base,
        under,
        'Crossing ' + (i + 1) + ' · ' + mm(under[2] - base[2]) + ' clear',
      );
    });
    if (part?.role === 'support') {
      const base = mid(part.bounds.min, part.bounds.max);
      base[2] = 0;
      aids.push(
        dimension(
          'support-height',
          'add',
          base,
          withZ(base, part.bounds.max[2]),
          'Block height · ' + mm(part.bounds.max[2]),
        ),
      );
    }
    if (tab === 'joints')
      for (const [i, g] of (part?.jointGuides ?? []).entries())
        aids.push(label('bridge-joint-' + i, 'reference', g.point, g.kind));
    return aids;
  }
  if (
    !countInRange(p.segments, 32) ||
    !countInRange(p.borderSegments, 32) ||
    !countInRange(p.lanes, 8)
  )
    return [];
  if (
    p.kind === 'curve' &&
    (!Number.isFinite(p.radius) ||
      p.radius <= 0 ||
      p.radius > 20000 ||
      !(p.angle > 0 && p.angle < 360))
  )
    return [];
  if (p.kind === 'straight' && !(p.length > 0 && p.length <= 20000)) return [];
  if (tab === 'geometry' && p.startingGrid && field?.startsWith('grid'))
    return [startingGridGuide(p, field)];
  let at = (t, v) => nativeTrackPoint(p, t, v),
    sourcePath,
    measuredLanes,
    laneOffsets,
    native = p.kind !== 'import';
  if (!native) {
    const plan = track.plan;
    if (!plan?.lanes?.length) return [];
    const outlines = plan.outlines ?? [],
      lanes = plan.lanes;
    // Follow imported drawings using the same parameterisation as the road.
    // A whole table or an exceptionally detailed drawing can still show its
    // original lane paths without recovering all of the edge correspondences.
    const sourceLines = () => {
      const paths = sample(lanes, 12).map((lane) =>
        sample(lane, 90).map((q) => withZ(q, p.height)),
      );
      return paths[0]?.length
        ? [
            label(
              'circuit-lanes',
              'reference',
              paths[0][0],
              'Circuit · ' +
                lanes.length +
                ' lane path' +
                (lanes.length === 1 ? '' : 's'),
              paths,
              { dashed: true },
            ),
          ]
        : [];
    };
    const vertices = [...outlines, ...lanes].reduce(
      (n, line) => n + line.length,
      0,
    );
    if (vertices > 12000 || (outlines[0]?.length ?? 0) * lanes.length > 150000)
      return sourceLines();
    const imported = importedTrackPaths(p, plan);
    if (!imported.path) return sourceLines();
    p = imported.p;
    sourcePath = imported.path;
    at = imported.path.point;
    measuredLanes = imported.path.measuredLanes;
    laneOffsets = imported.path.laneOffsets;
  }
  const point = (t, v, z = p.height) => withZ(at(t, v), z);
  const curve = (fn, n = 32) =>
    Array.from({ length: n + 1 }, (_, i) => fn(i / n));
  const half = p.width / 2,
    widthAt = (t) => dist(point(t, -half), point(t, half));
  const borderSides =
    p.borderSide === 'both'
      ? [-1, 1]
      : p.borderSide === 'none'
        ? []
        : [p.borderSide === 'inner' ? -1 : 1];
  const pathsBySide = {};
  const endProfiles = {};
  const pathFor = (side) => {
    sourcePath ??= nativePath(p);
    return (pathsBySide[side] ??= borderPath(sourcePath, p, side));
  };
  const endsFor = (side) =>
    (endProfiles[side] ??= borderEndProfile(pathFor(side), p, side));
  // Only the adjacent two mesh edges determine the stripe at this station.
  // Avoid rebuilding an imported drawing's full marking layout for one guide.
  const paintApex = (side) => {
    const end = endsFor(side);
    const path = end.path;
    const stock = end.path.borderStock ?? [0, 1];
    const apex = Math.min(
      stock[1],
      Math.max(stock[0], apexPositionFor(p, side)),
    );
    const stations = path.stations.includes(apex)
      ? path.stations
      : [...path.stations, apex].sort((a, b) => a - b);
    const i = stations.indexOf(apex);
    return markingStations(
      p,
      {
        ...path,
        stations: stations.slice(i - 1, i + 2),
      },
      side,
    );
  };
  const cross = (t, z = p.height) => [point(t, -half, z), point(t, half, z)];
  const offsets = (t) =>
    laneOffsets
      ? laneOffsets(t)
      : Array.from(
          { length: p.lanes },
          (_, i) => laneOffsetAt(p,i,t),
        );
  const centerline = curve((t) => point(t, 0));
  const guides = [];
  const kerbGrooveField =
    p.kerbGroove && ['kerbGroove', 'grooveWidth', 'grooveDepth'].includes(field);
  const lineField = [
    'whiteLineRoad',
    'whiteLineBorder',
    'roadLineGroove',
    'borderLineGroove',
    'whiteLineWidth',
    'grooveWidth',
    'grooveDepth',
  ].includes(field);
  if (tab === 'geometry' && !lineField) {
    if (!p.roadCentreLine || p.roadCentreLine === 'none') guides.push({
      id: 'road-centre',
      tone: 'reference',
      paths: [centerline],
      dashed: true,
    });
    guides.push(
      dimension(
        'road-width',
        'reference',
        ...cross(0),
        'Road width · ' + mm(widthAt(0)),
      ),
    );
    if (
      p.kind === 'curve' &&
      (!field || ['radius', 'angle', 'kind'].includes(field))
    ) {
      const c = [0, -p.radius, p.height];
      guides.push(
        label(
          'curve-radius',
          'accent',
          point(0.55, 0),
          'Radius · ' + mm(p.radius),
          [[c, point(0.5, 0)]],
          { dashed: true },
        ),
      );
      if (field === 'angle')
        guides.push(
          label(
            'curve-sweep',
            'reference',
            point(1, 0),
            'Sweep · ' + fmt(p.angle) + '°',
            [[point(0, 0), c, point(1, 0)]],
          ),
        );
    }
    if (p.kind === 'straight')
      guides.push(
        dimension(
          'road-length',
          'accent',
          point(0, -half),
          point(1, -half),
          'Length · ' + mm(p.length),
        ),
      );
    if (p.segments > 1)
      guides.push(
        label(
          'road-seams',
          'cut',
          point(1 / p.segments, half),
          p.segments + ' road segments',
          Array.from({ length: p.segments - 1 }, (_, i) =>
            cross((i + 1) / p.segments),
          ),
          { dashed: true },
        ),
      );
    const slotField = SLOT_POSITION_FIELDS.includes(field);
    if (slotField && native && hasSlotPosition(p)) {
      // Measure each end from the edge the distances were typed against.
      const edge = p.slotPosition.edge, side = edge === 'outer' ? half : -half;
      const ends = slotEnds(p), varies = slotVaries(p);
      for (const [id, t, name, distance] of [
        ['slot-start', 0, varies ? 'End A' : 'Slot', ends.start[edge]],
        ...(varies ? [['slot-end', 1, 'End B', ends.end[edge]]] : []),
      ])
        guides.push(
          dimension(
            id,
            'accent',
            point(t, side),
            point(t, offsets(t)[0]),
            name + ' · ' + mm(distance) + ' from the ' + slotEdgeName(p) + ' edge',
          ),
        );
    }
    if (slotField || ['lanes','laneSpacing','laneMode','laneMiddle','laneAnchor'].includes(field)) {
      const o = offsets(0);
      guides.push({
        id: 'lanes',
        tone: 'accent',
        paths: o.map((_, i) =>
          curve((t) =>
            measuredLanes
              ? withZ(measuredLanes[i].at(t), p.height)
              : point(t, laneOffsetAt(p, i, t)),
          ),
        ),
        dashed: true,
      });
      if (o.length > 1)
        guides.push(
          dimension(
            'lane-spacing',
            'accent',
            point(0, o[0]),
            point(0, o[1]),
            'Lane spacing · ' + mm(Math.abs(o[1] - o[0])),
          ),
        );
      if (p.laneAdjustment && o.length > 1) {
        const midOffsets = offsets(0.5);
        guides.push(
          dimension(
            'lane-middle-spacing',
            'accent',
            point(0.5, midOffsets[0]),
            point(0.5, midOffsets[1]),
            'Middle spacing · ' + mm(p.laneAdjustment.spacingMm),
          ),
        );
      }
    }
  } else if (tab === 'profile') {
    const z = p.height,
      right = point(0, half),
      bottom = point(0, half, 0);
    guides.push(
      dimension(
        'track-height',
        'reference',
        bottom,
        right,
        'Height · ' + mm(z),
      ),
    );
    const lane = offsets(0)[0] ?? 0;
    const section = (x, h) => point(0, x, h);
    if (p.hollow && ['hollow', 'deck', 'wall'].includes(field)) {
      const deck = section(-half + p.wall, z - p.deck);
      guides.push(
        dimension(
          'deck',
          'accent',
          section(-half + p.wall, z),
          deck,
          'Deck · ' + mm(p.deck),
        ),
      );
      guides.push(
        dimension(
          'wall',
          'reference',
          section(-half, 0),
          section(-half + p.wall, 0),
          'Wall · ' + mm(p.wall),
        ),
      );
    } else {
      const isBraid =
        p.braidWidth > 0 &&
        field?.toLowerCase().includes('braid') &&
        !field.toLowerCase().includes('feed');
      const w = isBraid ? p.braidWidth : p.slotWidth,
        depth = isBraid ? p.braidDepth : p.slotDepth,
        slotHalf = p.slotWidth / 2,
        inner = slotHalf + p.braidGap,
        shelfZ = p.braidWidth > 0 ? z - p.braidDepth : z;
      const slotLipZ = p.braidGap > 0 ? z : shelfZ;
      let mouth = (offset, height) => section(lane + offset, height);
      let wallStart, wallEnd;
      if (measuredLanes) {
        // A lane can meet a Circuit end obliquely. Its width is measured
        // perpendicular to travel, while the highlighted lip lies on the seam.
        const first = measuredLanes[0];
        const center = first.at(0),
          unitOffset = first.atOffset(0, 1);
        const normal = unitOffset.map((v, i) => v - center[i]);
        const origin = at(0, 0),
          along = sourcePath.normal(0);
        const projection = dot(along, normal);
        if (Math.abs(projection) > 1e-6) {
          const base = dot(
            origin.map((v, i) => v - center[i]),
            normal,
          );
          mouth = (offset, height) =>
            withZ(
              add(origin, scale(along, (offset - base) / projection)),
              height,
            );
          // On a skew end, dimension perpendicular to travel from whichever
          // lip lies farther inside the road. The highlighted profiles still
          // trace the actual end face.
          if (isBraid && field === 'braidGap' && p.braidGap > 0) {
            const slot = mouth(slotHalf, z), recess = mouth(inner, z);
            const tangent = [normal[1], -normal[0]];
            const width = scale(withZ(normal, 0), p.braidGap);
            if (dot([recess[0] - slot[0], recess[1] - slot[1]], tangent) > 0) {
              wallStart = add(recess, scale(width, -1));
              wallEnd = recess;
            } else {
              wallStart = slot;
              wallEnd = add(slot, width);
            }
          }
        }
      }
      const paths = isBraid
        ? [-1, 1].map((sign) => [
            mouth(sign * (inner + w), z),
            mouth(sign * (inner + w), shelfZ),
            mouth(sign * inner, shelfZ),
            ...(p.braidGap > 0 ? [mouth(sign * inner, z)] : []),
          ])
        : [
            [
              mouth(-slotHalf, slotLipZ),
              mouth(-slotHalf, z - depth),
              mouth(slotHalf, z - depth),
              mouth(slotHalf, slotLipZ),
            ],
          ];
      if (isBraid && field === 'braidGap' && p.braidGap > 0)
        guides.push(braidWallDimension(p, wallStart ?? mouth(slotHalf, z), wallEnd ?? mouth(inner, z)));
      guides.push(
        label(
          'channel-profile',
          'cut',
          paths[0][1],
          (isBraid ? 'Braid recess' : 'Guide slot') +
            ' · ' +
            mm(w) +
            ' × ' +
            mm(depth),
          paths,
          { strong: true },
        ),
      );
    }
    if (['left', 'right', 'both'].includes(p.braidFeedSide)) {
      const markers = [];
      sourcePath ??= nativePath(p);
      // The path knows where each lane leaves end A, moved slot included.
      const lanes =
        measuredLanes ??
        sourcePath.laneOffsets(0).map((offset) => nativeBraidLane(p, sourcePath, offset));
      const edge = p.slotWidth / 2 + p.braidGap + p.braidWidth / 2;
      for (const [i, lane] of lanes.entries()) {
        if (p.braidFeedLane && p.braidFeedLane !== i + 1) continue;
        for (const t of (p.braidFeedStations ?? []).slice(0, 8)) {
          for (const sign of p.braidFeedSide === 'both'
            ? [-1, 1]
            : [p.braidFeedSide === 'left' ? 1 : -1]) {
            markers.push(
              withZ(lane.atOffset(t, sign * edge), p.height - p.braidDepth),
            );
          }
        }
      }
      if (markers.length)
        guides.push(
          label(
            'braid-feed',
            'accent',
            markers[0],
            'Braid feed · ' + mm(p.braidFeedLength),
            [],
            { dots: sample(markers, 96) },
          ),
        );
    }
  } else if (
    tab === 'borders' &&
    (field?.startsWith('kerb') || kerbGrooveField) &&
    ['road', 'free', 'both'].includes(p.kerbEdge) &&
    Number.isFinite(p.kerbWidth) &&
    p.kerbWidth > 0 &&
    Number.isFinite(p.kerbLength) &&
    p.kerbLength > 0
  ) {
    for (const sign of borderSides) {
      const side = sign < 0 ? 'inner' : 'outer';
      if (p.kerbSide && p.kerbSide !== 'both' && p.kerbSide !== side) continue;
      const endProfile = endsFor(side);
      const stock = endProfile.path.borderStock ?? [0,1];
      const t = Math.max(stock[0],Math.min(stock[1],apexPositionFor(p, side)));
      const border = endProfile.path;
      const onBorder = (u, offset) => withZ(border.point(u, offset), p.height);
      let base = onBorder(t, sign * half);
      const free = onBorder(t, sign * (half + endProfile.widthAt(t)));
      const line = whiteLineLayout(p, side);
      const reserve = line.borderWidth + line.borderGroove;
      if (reserve) base = withZ(paintApex(side)[1].offset(reserve), p.height);
      const span = dist(base, free);
      if (!(span > 0)) continue;
      const width = Math.min(
        p.kerbWidth,
        span / (p.kerbEdge === 'both' ? 2 : 1),
      );
      for (const edge of p.kerbEdge === 'both'
        ? ['road', 'free']
        : [p.kerbEdge]) {
        const [start, opposite] = edge === 'road' ? [base, free] : [free, base];
        const end = start.map((v, i) => v + ((opposite[i] - v) * width) / span);
        const name = edge === 'road' ? 'Road-facing edge' : 'Free edge';
        const id = 'kerb-' + edge + '-' + sign;
        if (kerbGrooveField) {
          const next = paintApex(side)[2];
          const nextEdge =
            edge === 'free'
              ? onBorder(next.t, sign * (half + endProfile.widthAt(next.t)))
              : withZ(next.offset(reserve), p.height);
          const [dx, dy] = nextEdge.map((v, i) => v - start[i]);
          const length = Math.hypot(dx, dy);
          if (!length) continue;
          const normal = [-dy / length, dx / length, 0];
          const direction =
            dot(normal, opposite.map((v, i) => v - start[i])) >= 0 ? 1 : -1;
          const rim = mid(start, nextEdge);
          const inside = add(rim, scale(normal, direction * p.grooveWidth));
          const top = mid(rim, inside);
          guides.push(
            field === 'grooveWidth'
              ? dimension(id, 'cut', rim, inside, 'Kerb groove width · ' + mm(p.grooveWidth))
              : dimension(id, 'cut', top, add(top, [0, 0, -p.grooveDepth]),
                  'Kerb groove depth · ' + mm(p.grooveDepth)),
          );
        } else if (field === 'kerbLength') {
          const anchor = mid(start, end);
          guides.push(
            label(
              id,
              'reference',
              anchor,
              'Block length · ' + mm(p.kerbLength),
              [],
              { dots: [anchor] },
            ),
          );
        } else
          guides.push(
            dimension(id, 'reference', start, end, name + ' · ' + mm(width)),
          );
      }
    }
  } else if (tab === 'borders' && !lineField) {
    const sides = borderSides;
    if (!sides.length)
      guides.push(
        label(
          'border-edges',
          'reference',
          point(0.5, half),
          'Road edge',
          [curve((t) => point(t, -half)), curve((t) => point(t, half))],
          { dashed: true },
        ),
      );
    for (const sign of sides) {
      const side = sign < 0 ? 'inner' : 'outer';
      const apex = apexPositionFor(p, side);
      const endProfile = endsFor(side);
      const path = endProfile.path;
      const onBorder = (t, offset) => withZ(path.point(t, offset), p.height);
      const base = sign * half;
      const edge = (t) => onBorder(t, base + sign * endProfile.widthAt(t));
      const stations = sample(path.stations, 65);
      const outline = stations.includes(apex) || apex <= endProfile.start || apex >= endProfile.finish
        ? stations
        : [...stations, apex].sort((a, b) => a - b);
      guides.push({
        id: 'border-edge-' + sign,
        tone: 'add',
        paths: [outline.map(edge)],
        strong: true,
      });
      for (const [name, t] of [
        ['Entry', endProfile.start],
        ['Apex', apex],
        ['Exit', endProfile.finish],
      ]) {
        if (t < endProfile.start || t > endProfile.finish) continue;
        const width = endProfile.widthAt(t),
          a = onBorder(t, base),
          b = edge(t),
          id = 'border-' + name.toLowerCase() + '-' + sign;
        if (
          (name === 'Entry' && path.borderTipStart) ||
          (name === 'Exit' && path.borderTipFinish)
        ) {
          const finish =
            p.borderEnds[side][name === 'Entry' ? 'start' : 'finish'];
          guides.push(
            label(id, 'add', b, name + ' tip · ' + finish.shape, [], {
              dots: [b],
            }),
          );
        } else if (name === 'Apex') {
          const sideLabel = side === 'inner' ? 'Inside' : 'Outside';
          const caption =
            sideLabel + ' apex · ' + mm(width) + ' at ' + fmt(t * 100) + '%';
          guides.push(dimension(id, 'add', a, b, caption));
        } else if (sign === sides.at(-1))
          guides.push(dimension(id, 'add', a, b, name + ' · ' + mm(width)));
        else guides.push(line(id, 'add', [a, b], { dots: [a, b] }));
      }
      if (p.borderSegments > 1)
        guides.push({
          id: 'border-seams-' + sign,
          tone: 'neutral',
          dashed: true,
          paths: Array.from({ length: p.borderSegments - 1 }, (_, i) => {
            const t = borderSeam(path,p,i+1);
            return [onBorder(t, base), edge(t)];
          }),
        });
    }
  } else if (lineField && (tab === 'geometry' || tab === 'borders')) {
    if (tab === 'geometry' && p.startingGrid?.recessed && ['grooveWidth', 'grooveDepth'].includes(field))
      guides.push(startingGridGuide(p, field));
    for (const side of ['inner', 'outer']) {
      const line = whiteLineLayout(p, side);
      if (!(line.roadWidth || line.borderWidth)) continue;
      const [, apex, next] = paintApex(side);
      const [dx, dy] = next.edge.map((v, i) => v - apex.edge[i]);
      const length = Math.hypot(dx, dy);
      if (!length) continue;
      // The nominal width is perpendicular to the actual mesh edge. A skewed
      // Circuit end and the bisector at a bend can both give a longer span.
      const outward = apex.offset(1).map((v, i) => v - apex.edge[i]);
      const normal = [-dy / length, dx / length];
      const sign = dot(normal, outward) < 0 ? -1 : 1;
      const center = mid(apex.edge, next.edge);
      const at = (offset) =>
        withZ(add(center, scale(normal, sign * offset)), p.height);
      const start = line.borderGroove - line.roadWidth;
      const end = line.borderGroove + line.borderWidth;
      const groove = line.roadGroove + line.borderGroove;
      if (
        groove &&
        [
          'grooveWidth',
          'grooveDepth',
          'roadLineGroove',
          'borderLineGroove',
        ].includes(field)
      ) {
        const a = at(start - groove),
          b = at(start);
        if (field === 'grooveDepth') {
          const top = mid(a, b),
            floor = add(top, [0, 0, -p.grooveDepth]);
          guides.push(
            dimension(
              'paint-groove-' + side,
              'cut',
              top,
              floor,
              'Groove depth · ' + mm(p.grooveDepth),
            ),
          );
        } else
          guides.push(
            dimension(
              'paint-groove-' + side,
              'cut',
              a,
              b,
              'Groove width · ' + mm(groove),
            ),
          );
      } else {
        guides.push(
          dimension(
            'white-line-' + side,
            'reference',
            at(start),
            at(end),
            'White line · ' + mm(end - start),
          ),
        );
      }
    }
  } else if (tab === 'joints') {
    const seam = (id, t, mode) =>
      label(
        id,
        'reference',
        point(t, -half),
        (t === 0 ? 'Start' : t === 1 ? 'Finish' : 'Seam') +
          ' · ' +
          ({
            none: 'plain',
            tabs: 'tabs',
            clips: 'clips',
            both: 'tabs + clips',
          }[mode] ?? 'plain'),
        [cross(t)],
        { dashed: true },
      );
    guides.push(
      seam('joint-start', 0, p.jointStart ?? p.joint),
      seam('joint-finish', 1, p.jointEnd ?? p.joint),
    );
    if (p.segments > 1)
      guides.push(seam('joint-seam', 1 / p.segments, p.joint));
    // Actual generated positions include the solver's automatic shifts around
    // guide slots, narrow shoulders, and neighbouring mounts.
    const markers = new Map();
    const displayParts = parts.length
      ? [...parts].sort(
          (a, b) => Number(b.id === part?.id) - Number(a.id === part?.id),
        )
      : [part].filter(Boolean);
    for (const component of displayParts)
      for (const g of component.jointGuides ?? []) {
        const key = g.point.join(',');
        if (!markers.has(key)) markers.set(key, g);
      }
    const hardware = sample([...markers.values()], 180);
    for (const [kind, tone] of [
      ['Tab', 'add'],
      ['Socket', 'cut'],
      ['Clip', 'accent'],
    ]) {
      const points = hardware
        .filter((m) => m.kind === kind)
        .map((m) => m.point);
      if (points.length)
        guides.push(
          label('hardware-' + kind, tone, points[0], kind, [], {
            dots: points,
          }),
        );
    }
  }
  return guides;
}

function plateGuide(part, plate, fit = part?.fit) {
  if (!part?.positions || !fit || !plate || !part.positions.length) return [];
  const a = radians(fit.angle),
    c = Math.cos(a),
    s = Math.sin(a);
  let xmin = Infinity,
    xmax = -Infinity,
    ymin = Infinity,
    ymax = -Infinity;
  const hull = part.footprintXY;
  const n = hull?.length ?? part.positions.length / 3;
  for (let i = 0; i < n; i++) {
    const x = hull ? hull[i][0] : part.positions[i * 3],
      y = hull ? hull[i][1] : part.positions[i * 3 + 1],
      u = c * x - s * y,
      v = s * x + c * y;
    xmin = Math.min(xmin, u);
    xmax = Math.max(xmax, u);
    ymin = Math.min(ymin, v);
    ymax = Math.max(ymax, v);
  }
  const world = (u, v) => [c * u + s * v, -s * u + c * v, part.bounds.min[2]];
  const cx = (xmin + xmax) / 2,
    cy = (ymin + ymax) / 2;
  const corners = (m) =>
    closed(
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([x, y]) =>
        world(cx + x * (plate.width / 2 - m), cy + y * (plate.depth / 2 - m)),
      ),
    );
  const outer = corners(0),
    tone = fit.fits ? 'reference' : 'cut';
  const result = [
    label(
      'print-plate',
      tone,
      outer[0],
      'Print plate · ' + fmt(plate.width) + ' × ' + mm(plate.depth),
      [outer],
    ),
  ];
  if (plate.margin)
    result.push(
      line('plate-margin', tone, corners(plate.margin), { dashed: true }),
    );
  return result;
}

/** Build the active tool's world-space annotations independently of the camera. */
export function toolGuides(context) {
  const {
    part,
    op,
    tab,
    region,
    measurePoints = [],
    measuring,
    plateVisible,
    plate,
  } = context;
  if (plateVisible)
    return plateGuide(
      context.resultPart ?? part,
      plate,
      context.plateFit ?? undefined,
    );
  if (measuring) {
    if (measurePoints.length === 1)
      return [
        label(
          'measure-first',
          'reference',
          measurePoints[0],
          'First point',
          [],
          { dots: measurePoints },
        ),
      ];
    if (measurePoints.length === 2)
      return [
        dimension(
          'measure-distance',
          'reference',
          ...measurePoints,
          mm(dist(...measurePoints)),
        ),
      ];
    return [];
  }
  if (context.mode === 'track') return trackGuides(context);
  if (op?.type === 'createSolid' || (context.designSketch && !op))
    return designGuides(context);
  if (op?.type === 'modifyHoles')
    return holeModifyGuides(op, context.modifyError);
  if (op?.type === 'healFeature' || op?.type === 'stretchSection')
    return healStretchGuides(op, part);
  if (
    [
      'hole',
      'edgeFinish',
      'featurePattern',
      'wallModify',
      'edgeGroup',
    ].includes(op?.type)
  )
    return featureGuides(op, part);
  if (!part?.bounds) return [];
  if (
    !op &&
    ['select', 'edge-finish', 'hole-modify'].includes(tab) &&
    context.pickedEdges?.length
  ) {
    const scope = context.edgeScope ?? 'corner';
    const edges = edgesForScope(context.pickedEdges, scope);
    if (edges.every(isHoleRim))
      return holeModifyGuides({ rims: edges }, context.modifyError);
    return edges.flatMap((edge, i) =>
      featureGuides({ type: 'edgeFinish', edge }, part).map((g) => ({
        ...g,
        id: 'picked-edge-' + i,
        ...(scope === 'corner' && edge.cornerPath
          ? {
              paths: [edge.cornerPath],
              dots: [edge.cornerPath[0], edge.cornerPath.at(-1)],
            }
          : {}),
        text:
          i === 0
            ? scope === 'corner' && edges.some((item) => item.corner)
              ? edgeSelectionLabel(edges) + ' selected'
              : edges.length === 1
                ? 'Selected edge'
                : edges.length + ' edges selected'
            : '',
      })),
    );
  }
  if (op?.type === 'alignParts' && op.alignment === 'faces') {
    const destination = op.destinationFace.point;
    const result = add(destination, scale(op.destinationFace.normal, op.gap));
    return [
      label(
        'alignment-contact',
        'reference',
        result,
        op.gap ? 'Face gap · ' + mm(op.gap) : 'Faces aligned',
        [[destination, result]],
        { dots: op.gap ? [destination, result] : [result] },
      ),
    ];
  }
  if (op?.type === 'trimFace') return trimGuides(part, op);
  if (tab === 'hollow' && op?.frame && op?.loops?.length) {
    const paths = sample(op.loops, 32).map((loop) =>
      closed(sample(loop, 128).map(([x, y]) => framePoint(op.frame, x, y))),
    );
    return [
      label(
        'shell-opening',
        'cut',
        paths[0][0],
        'Opening · ' + mm(op.thickness) + ' walls',
        paths,
        { strong: true },
      ),
    ];
  }
  if (tab === 'split' && op)
    return op.type === 'radialSplit'
      ? radialSplit(part, op)
      : straightSplit(part, op);
  if (tab === 'transform')
    return transformGuides(part, op, context.field, context.resultPart);
  if (
    tab === 'move-face' &&
    (op?.type === 'moveFaces' || context.faceMoveMode === 'height') &&
    context.facePlan
  ) {
    return faceHeightGuides(
      context.faceProfiles ?? op?.faces ?? [],
      context.facePlan,
      context.faceMoveMode === 'height' || op?.moveMode === 'height',
    );
  }
  if (tab === 'move-face' && op) {
    const guides = shapeGuides(op, part);
    const tip = guides.find((guide) => guide.id === 'profile-tip');
    if (tip)
      tip.text =
        (op.type === 'cut' ? 'Inward · ' : 'Outward · ') + mm(op.depth);
    return guides;
  }
  if (op?.type === 'tiltFace') return tiltGuides(op);
  if (['add', 'cut'].includes(op?.type)) {
    const guides = shapeGuides(op, part);
    if (op.profileKind !== 'face' && region?.planar && region.loops?.length) {
      const perimeter = sample(region.loops, 32)
        .filter((loop) => loop.length >= 3)
        .map((loop) =>
          closed(sample(loop, 64).map(([x, y]) => framePoint(region, x, y))),
        );
      guides.unshift({
        id: 'selected-face-perimeter',
        tone: 'reference',
        paths: perimeter,
      });
    }
    return guides;
  }
  if (region?.origin) {
    const anchor = context.facePoint ?? region.origin;
    const selectionLabel =
      region.faceCount > 1
        ? region.faceCount + ' faces selected'
        : region.feature === 'post'
          ? 'Screw post top'
          : region.planar
            ? 'Selected face'
            : 'Tangent plane';
    return [
      label('selection', 'reference', anchor, selectionLabel, [], {
        dots: [anchor],
      }),
    ];
  }
  return [];
}
