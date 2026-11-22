import { choice, esc, field, fmt } from './ui.js';
import {
  add3,
  cross3,
  mul3,
  sub3,
  unit3,
} from './geometry/feature-selection.js';
import {
  holeRimReference,
  isHoleRim,
  sameHoleRim,
} from './geometry/hole-modify.js';
export { holeRimReference, isHoleRim, sameHoleRim };

const modes = {
  countersink: 'Countersink',
  counterbore: 'Counterbore',
  resize: 'Resize bore',
  fill: 'Fill hole',
};
function available({ rims, op }) {
  return rims ?? op?.rims ?? [];
}
export function holeModifyControls(ctx) {
  const rims = available(ctx),
    saved = ctx.op ?? {};
  const largest = rims.length
    ? Math.max(...rims.map((r) => r.circle.radius * 2))
    : 3;
  const head =
    saved.headDiameter ?? Number(Math.max(6, largest + 2).toFixed(3));
  const note = !rims.length
    ? 'Click a hole lip. Shift-click more rims to edit them together.'
    : rims.length +
      (rims.length === 1 ? ' hole rim selected' : ' hole rims selected');
  return (
    '<p class="selection-note">' +
    esc(note) +
    '</p>' +
    choice(
      'modifyHoleKind',
      'Operation',
      saved.kind ?? 'countersink',
      Object.entries(modes),
    ) +
    field('modifyHeadDiameter', 'Head diameter', head, 'mm', { min: 0.001 }) +
    field('modifyHeadAngle', 'Included angle', saved.headAngle ?? 90, '°', {
      min: 0.01,
      max: 179.99,
    }) +
    field('modifyHeadDepth', 'Recess depth', saved.headDepth ?? 2, 'mm', {
      min: 0.001,
    }) +
    field(
      'modifyBoreDiameter',
      'Finished bore diameter',
      saved.diameter ?? Number((largest + 1).toFixed(3)),
      'mm',
      { min: 0.001 },
    ) +
    '<svg data-hole-section data-bore="' +
    largest +
    '" viewBox="0 0 200 64" role="img" aria-label="Hole cross-section" style="display:block;width:100%;max-height:76px;margin:.5rem 0">' +
    '<path data-hole-material fill="var(--d-border)" stroke="var(--d-track-edge)" stroke-width="1.4"/>' +
    '<path data-hole-original fill="none" stroke="var(--d-guide)" stroke-dasharray="3 3"/></svg>'
  );
}
export function updateHoleModifyControls(form) {
  if (!form?.elements.modifyHoleKind) return;
  const f = form.elements,
    kind = f.modifyHoleKind.value;
  const recess = kind === 'countersink' || kind === 'counterbore';
  for (const [name, show] of Object.entries({
    modifyHeadDiameter: recess,
    modifyHeadAngle: kind === 'countersink',
    modifyHeadDepth: kind === 'counterbore',
    modifyBoreDiameter: kind === 'resize',
  })) {
    const el = f[name];
    el.disabled = !show;
    el.closest('label').hidden = !show;
  }
  const section = form.querySelector('[data-hole-section]');
  if (!section) return;
  const original = Number(section.dataset.bore);
  const diameter = recess
    ? f.modifyHeadDiameter.valueAsNumber
    : kind === 'resize'
      ? f.modifyBoreDiameter.valueAsNumber
      : original;
  const angle = f.modifyHeadAngle.valueAsNumber;
  const d =
    kind === 'counterbore'
      ? f.modifyHeadDepth.valueAsNumber
      : (diameter - original) / (2 * Math.tan((angle * Math.PI) / 360));
  const valid =
    diameter > 0 &&
    (!recess || (diameter > original && d > 0 && Number.isFinite(d)));
  section.style.visibility = valid ? 'visible' : 'hidden';
  if (!valid) return;
  const scale = Math.min(
    110 / Math.max(original, diameter),
    recess ? 34 / d : Infinity,
  );
  const old = (original * scale) / 2,
    finish = (diameter * scale) / 2,
    top = 9,
    bottom = 58;
  const side = (sign) => {
    const outside = 100 + sign * 88,
      lip = 100 + sign * finish,
      bore = 100 + sign * old;
    let path = 'M ' + outside + ' ' + top + ' H ' + lip;
    if (kind === 'counterbore') path += ' v ' + d * scale + ' H ' + bore;
    if (kind === 'countersink') path += ' L ' + bore + ' ' + (top + d * scale);
    return path + ' V ' + bottom + ' H ' + outside + ' Z';
  };
  section
    .querySelector('[data-hole-material]')
    .setAttribute(
      'd',
      kind === 'fill' ? 'M 12 9 H 188 V 58 H 12 Z' : side(-1) + ' ' + side(1),
    );
  section
    .querySelector('[data-hole-original]')
    .setAttribute(
      'd',
      'M ' + (100 - old) + ' 9 V 58 M ' + (100 + old) + ' 9 V 58',
    );
}
export function holeModifyOperation(fields, base, ctx) {
  const rims = available(ctx);
  if (!rims.length)
    throw Error(
      'Click the lip of an existing cylindrical hole. Shift-click to add more.',
    );
  const kind = fields.modifyHoleKind;
  return {
    ...base,
    type: 'modifyHoles',
    rims: rims.map(holeRimReference),
    kind,
    label:
      modes[kind] + (rims.length > 1 ? ' · ' + rims.length + ' holes' : ''),
    ...(kind === 'resize' ? { diameter: fields.modifyBoreDiameter } : {}),
    ...(kind === 'countersink'
      ? {
          headDiameter: fields.modifyHeadDiameter,
          headAngle: fields.modifyHeadAngle,
        }
      : {}),
    ...(kind === 'counterbore'
      ? {
          headDiameter: fields.modifyHeadDiameter,
          headDepth: fields.modifyHeadDepth,
        }
      : {}),
  };
}
export function holeModifyGuides(op, warningOrMessage) {
  const message = warningOrMessage?.message ?? warningOrMessage;
  const marked =
    typeof message === 'string'
      ? Number(/\bHole (\d+) ·/.exec(message)?.[1])
      : 0;
  return (op?.rims ?? []).map((rim, i) => {
    const { normal, radius, center } = rim.circle;
    const u = unit3(sub3(rim.a, center)),
      v = unit3(cross3(normal, u));
    const ring = (r, depth = 0) =>
      Array.from({ length: 65 }, (_, j) => {
        const angle = (j * Math.PI) / 32;
        return add3(
          sub3(center, mul3(normal, depth)),
          add3(mul3(u, r * Math.cos(angle)), mul3(v, r * Math.sin(angle))),
        );
      });
    const paths = [ring(radius)];
    const outer = (op.headDiameter ?? op.diameter) / 2;
    if (Number.isFinite(outer) && outer > 0) paths.push(ring(outer));
    const depth =
      op.kind === 'counterbore'
        ? op.headDepth
        : (outer - radius) / Math.tan((op.headAngle * Math.PI) / 360);
    if (Number.isFinite(depth) && depth > 0 && outer > radius) {
      const bottom = ring(op.kind === 'counterbore' ? outer : radius, depth);
      paths.push(bottom, [paths[1][0], bottom[0]], [paths[1][32], bottom[32]]);
    }
    const failed = marked === i + 1;
    return {
      id: 'hole-rim-' + (i + 1),
      tone: failed ? 'warning' : 'reference',
      anchor: add3(center, mul3(u, radius)),
      dots: [],
      paths,
      strong: true,
      text:
        (failed ? 'Check hole ' : 'Hole ') +
        (i + 1) +
        ' · Ø ' +
        fmt(2 * radius) +
        ' mm',
    };
  });
}
