import { worldPoint, workplane } from './design.js';

const lengthLabel = (n) => Number(n.toFixed(2)) + ' mm';
function outline(sketch, offset = 0) {
  if (!sketch) return [];
  const paths = [];
  for (const [closed, contours] of [
    [true, sketch.loops],
    [false, sketch.paths],
  ]) {
    for (const points of contours.slice(0, 64)) {
      const stride = Math.max(1, Math.ceil(points.length / 192));
      const path = [];
      for (let i = 0; i < points.length; i += stride)
        path.push(worldPoint(sketch.frame, points[i], offset));
      if (points.length && !closed)
        path.push(worldPoint(sketch.frame, points.at(-1), offset));
      if (closed && path.length) path.push(path[0]);
      if (path.length) paths.push(path);
    }
  }
  return paths;
}
const guide = (id, text, paths, tone = 'reference') => ({
  id,
  text,
  anchor: paths[0][0],
  paths,
  tone,
  strong: true,
});
export function extrusionGuide(sketch, op) {
  const pts = sketch?.loops[0];
  if (!pts?.length || op?.kind !== 'extrude') return null;
  // The arrow is attached to the sketch edge, including for a hollow profile.
  const symmetric = op.direction === 'symmetric';
  const sign =
    op.direction === 'reverse' ||
    (op.direction === 'auto' && op.result === 'cut')
      ? -1
      : 1;
  const factor = symmetric ? 0.5 : sign;
  const start = worldPoint(sketch.frame, pts[0]);
  return {
    frame: sketch.frame,
    start,
    factor,
    distance: op.distance,
    end: start.map((x, i) => x + op.distance * factor * sketch.frame.normal[i]),
  };
}
export function designGuides(ctx) {
  const { op, designSketch: sketch, designSecondary: second } = ctx;
  if (op?.type === 'createSolid' && op.kind === 'primitive') {
    const frame = op.frame ?? workplane('xy'),
      base = [op.x, op.y],
      height = op.shape === 'sphere' ? op.diameter : op.height;
    const h = height * (op.result === 'cut' ? -1 : 1);
    const width = op.shape === 'box' ? op.width : op.diameter;
    return [
      guide(
        'shape-width',
        (op.shape === 'box' ? 'Width ' : 'Ø ') + lengthLabel(width),
        [
          [
            worldPoint(frame, [base[0] - width / 2, base[1]], op.z),
            worldPoint(frame, [base[0] + width / 2, base[1]], op.z),
          ],
        ],
      ),
      guide('shape-height', lengthLabel(height), [
        [worldPoint(frame, base, op.z), worldPoint(frame, base, op.z + h)],
      ]),
    ];
  }
  const lines = outline(sketch);
  if (!lines.length) return [];
  const items = [guide('design-sketch', sketch.name, lines)];
  if (op?.type !== 'createSolid') return items;
  if (op.kind === 'extrude') {
    const g = extrusionGuide(sketch, op);
    if (g) {
      const cap = outline({ ...sketch, paths: [] }, op.distance * g.factor);
      const tone = op.result === 'cut' ? 'cut' : 'add';
      return [
        { ...guide('design-sketch', sketch.name, cap, tone), surface: true },
        {
          ...guide(
            'extrusion-depth',
            lengthLabel(op.distance),
            [[g.start, g.end]],
            tone,
          ),
          anchor: g.start.map((x, i) => (x + g.end[i]) / 2),
        },
      ];
    }
  } else if (op.kind === 'loft' || op.kind === 'sweep') {
    const lines = outline(second, op.kind === 'loft' ? op.sectionOffset : 0);
    if (lines.length)
      items.push(
        guide(
          'design-second',
          op.kind === 'loft' ? 'Second section' : 'Sweep path',
          lines,
          'add',
        ),
      );
  } else if (op.kind === 'revolve') {
    const along = op.axis === 'u' ? 0 : 1;
    let lo = Infinity,
      hi = -Infinity;
    for (const loop of sketch.loops)
      for (const p of loop) {
        lo = Math.min(lo, p[along]);
        hi = Math.max(hi, p[along]);
      }
    const pad = Math.max(3, (hi - lo) * 0.15);
    const ends = [lo - pad, hi + pad].map((t) =>
      worldPoint(
        sketch.frame,
        along === 0 ? [t, op.axisOffset] : [op.axisOffset, t],
      ),
    );
    items.push({
      ...guide('revolve-axis', op.angle + '°', [ends]),
      dashed: true,
    });
  }
  return items;
}
