import { choice, esc, field, fmt } from './ui.js';
import { faceSupportRange } from './face-trim.js';
import { add3, dot3, mul3 } from './geometry/feature-selection.js';
import {
  planeFrame,
  recognizeHealProfile,
  stretchAxes,
  stretchDirection,
  validateHealStretch,
} from './geometry/heal-stretch.js';

const cachedFeature = new WeakMap();
function featureSelection(ctx) {
  if (!ctx.region && ctx.op?.type === 'healFeature') return ctx.op;
  if (!ctx.region)
    throw Error(
      'Click the flat top of a boss or rib, or the floor of a pocket.',
    );
  const old = cachedFeature.get(ctx.region);
  if (old?.part === ctx.part) {
    if (old.error) throw old.error;
    return old.value;
  }
  try {
    const value = recognizeHealProfile(ctx.part, ctx.region);
    cachedFeature.set(ctx.region, { part: ctx.part, value });
    return value;
  } catch (error) {
    cachedFeature.set(ctx.region, { part: ctx.part, error });
    throw error;
  }
}
const roundField = (n) => Number(n.toPrecision(7));
function axisNormal(ctx) {
  return ctx.region?.planar ? ctx.region.normal : ctx.op?.normal;
}
function planeDefaults(part, n) {
  const { min, max } = faceSupportRange(part.positions, n);
  return [roundField(min + (max - min) / 3), roundField(max - (max - min) / 3)];
}
export function healStretchControls(tab, ctx) {
  if (tab === 'heal-feature') {
    let text;
    try {
      const { supportOffset: offset } = featureSelection(ctx);
      text =
        (offset < 0 ? 'Remove projection' : 'Fill pocket') +
        ' · ' +
        fmt(Math.abs(offset)) +
        ' mm to the surrounding face';
    } catch (error) {
      text = error.message;
    }
    return (
      '<p class="selection-note">' +
      esc(text) +
      '</p><p class="hint">The highlighted outline is healed to the flat surface where its walls end.</p>'
    );
  }
  const saved = ctx.op ?? {};
  const options = Object.keys(stretchAxes).map((axis) => [
    axis,
    axis.toUpperCase(),
  ]);
  if (axisNormal(ctx)) options.push(['face', 'Normal to picked face']);
  const axis =
    saved.axis ??
    Object.keys(stretchAxes).sort((a, b) => {
      const span = (i) =>
        ctx.part ? ctx.part.bounds.max[i] - ctx.part.bounds.min[i] : 0;
      return span('xyz'.indexOf(b)) - span('xyz'.indexOf(a));
    })[0];
  const n = stretchDirection({ axis, normal: axisNormal(ctx) });
  const defaults = ctx.part && n ? planeDefaults(ctx.part, n) : [0, 10];
  return (
    choice('stretchAxis', 'Direction', axis, options) +
    field('stretchStart', 'First plane position', saved.start ?? defaults[0]) +
    field('stretchEnd', 'Second plane position', saved.end ?? defaults[1]) +
    choice('stretchFixed', 'Keep fixed', saved.fixedEnd ?? 'low', [
      ['low', 'Low end'],
      ['high', 'High end'],
    ]) +
    field('stretchChange', 'Length change', saved.change ?? 5) +
    '<p class="hint">Plane positions are measured from the world origin along the chosen direction. Only the section between them changes length. Enter a negative change to shorten it.</p>'
  );
}
export function updateHealStretchControls(form, ctx) {
  const f = form?.elements;
  if (!f?.stretchAxis || !ctx?.part) return;
  const axis = f.stretchAxis.value;
  if (form.dataset.stretchAxis && axis !== form.dataset.stretchAxis) {
    const n = stretchDirection({ axis, normal: axisNormal(ctx) });
    if (n) {
      const [start, end] = planeDefaults(ctx.part, n);
      f.stretchStart.value = start;
      f.stretchEnd.value = end;
    }
  }
  form.dataset.stretchAxis = axis;
}
export function healStretchOperation(tab, fields, base, ctx) {
  if (tab === 'heal-feature') {
    const { profile, supportOffset } = featureSelection(ctx);
    const op = {
      ...base,
      type: 'healFeature',
      label: supportOffset < 0 ? 'Remove projection' : 'Fill pocket',
      profile,
      supportOffset,
    };
    validateHealStretch(op);
    return op;
  }
  const axis = fields.stretchAxis;
  const op = {
    ...base,
    type: 'stretchSection',
    label: 'Stretch section',
    axis,
    ...(axis === 'face' ? { normal: axisNormal(ctx) } : {}),
    fixedEnd: fields.stretchFixed,
    start: fields.stretchStart,
    end: fields.stretchEnd,
    change: fields.stretchChange,
  };
  validateHealStretch(op);
  return op;
}
function point(frame, x, y, z) {
  return add3(
    frame.origin,
    add3(mul3(frame.u, x), add3(mul3(frame.v, y), mul3(frame.normal, z))),
  );
}
const closed = (ring) => [...ring, ring[0]];
export function healStretchGuides(op, part) {
  if (!op || !part) return [];
  if (op.type === 'healFeature') {
    const {
      profile: { frame, loops },
      supportOffset: z,
    } = op;
    return [
      [0, z < 0 ? 'Remove projection' : 'Fill pocket'],
      [z, 'Healed surface'],
    ].map(([level, text], i) => ({
      id: i ? 'heal-landing' : 'heal-face',
      tone: i ? 'reference' : z < 0 ? 'cut' : 'add',
      anchor: point(frame, ...loops[0][0], level),
      text,
      paths: loops.map((loop) =>
        closed(loop.map(([x, y]) => point(frame, x, y, level))),
      ),
      dashed: !!i,
      strong: true,
    }));
  }
  if (op.type !== 'stretchSection') return [];
  const n = stretchDirection(op),
    bounds = part.bounds;
  if (!n || !bounds) return [];
  const { u, v } = planeFrame(n, [0, 0, 0]);
  const center = mul3(add3(bounds.min, bounds.max), 0.5),
    half = bounds.max.map((x, i) => (x - bounds.min[i]) / 2);
  const size = (axis) =>
    axis.reduce((sum, x, i) => sum + Math.abs(x) * half[i], 0) * 1.08;
  const w = size(u),
    h = size(v);
  const fixedLow = op.fixedEnd === 'low';
  return [
    [fixedLow ? op.start : op.end, 'Fixed plane'],
    [fixedLow ? op.end : op.start, 'Moving plane'],
  ].map(([level, text], i) => {
    const frame = {
      u,
      v,
      normal: n,
      origin: add3(center, mul3(n, level - dot3(center, n))),
    };
    const ring = [
      [-w, -h],
      [w, -h],
      [w, h],
      [-w, h],
    ].map(([x, y]) => point(frame, x, y, 0));
    const offset = (fixedLow ? 1 : -1) * op.change;
    return {
      id: i ? 'stretch-moving' : 'stretch-fixed',
      tone: i ? 'accent' : 'reference',
      text: i ? text + ' · ' + fmt(op.change) + ' mm' : text,
      anchor: ring[2],
      paths: [
        closed(ring),
        ...(i ? [[ring[2], add3(ring[2], mul3(n, offset))]] : []),
      ],
      dashed: !i,
      strong: true,
    };
  });
}
