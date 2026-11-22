import { choice, details, field, fmt } from './ui.js';
import {
  edgeGroupOperation,
  edgeSelectionLabel,
  pickedOrSavedEdges,
  updateWallControls,
  wallControls,
  wallEdgeGuides,
  wallOperation,
} from './wall-edge-modify-controls.js';
import {
  defaultHolePlacement,
  patternCentre,
  repeatableFeature,
} from './geometry/create-features.js';
import {
  add3,
  sub3,
  mul3,
  cross3,
  length3,
  locateHole,
  unit3,
} from './geometry/feature-selection.js';
export { pickFinishEdge } from './geometry/feature-selection.js';

const axisOptions = [
  ['x', 'X'],
  ['y', 'Y'],
  ['z', 'Z'],
];
const originOptions = [
  ['min', 'Low edge'],
  ['max', 'High edge'],
  ['center', 'Centre'],
];
const holeKinds = {
  plain: 'Plain hole',
  counterbore: 'Counterbore',
  countersink: 'Countersink',
};
const finishKinds = { fillet: 'Round edge', chamfer: 'Chamfer edge' };
const patternKinds = {
  mirror: 'Mirror feature',
  linear: 'Linear pattern',
  circular: 'Circular pattern',
};
const rows = (options) => Object.entries(options);
const cachedPlacements = new WeakMap();
function placement({ region, part, op }) {
  if (region?.planar && part) {
    let prior = cachedPlacements.get(region);
    if (!prior || prior.part !== part) {
      prior = { part, value: defaultHolePlacement(region, part) };
      cachedPlacements.set(region, prior);
    }
    return prior.value;
  }
  return op?.seat ? op : null;
}
function earlierFeatures({ ops = [], op, part }) {
  const index = op ? ops.findIndex((item) => item.id === op.id) : -1;
  return (index < 0 ? ops : ops.slice(0, index)).filter(
    (item) => item.target === part?.id && repeatableFeature(item),
  );
}
const positiveField = (key, label, value, unit = 'mm') =>
  field(key, label, value, unit, { min: 0.001 });
function describeEdgeSelection(edges, scope) {
  if (!edges.length) return 'Click near an edge on the model.';
  if (edges.length > 1) return edgeSelectionLabel(edges, scope) + ' selected';
  const [edge] = edges;
  if (edge.circle)
    return 'Circular rim · Ø ' + fmt(2 * edge.circle.radius) + ' mm';
  if (edge.corner && scope === 'corner')
    return (
      '1 rounded corner selected · ' +
      fmt(edge.corner.length) +
      ' mm along edge'
    );
  return (
    (edge.convex ? 'Outside' : 'Inside') +
    ' edge · ' +
    fmt(length3(sub3(edge.b, edge.a))) +
    ' mm'
  );
}
export function featureControls(tab, ctx) {
  const saved = ctx.op ?? {};
  if (tab === 'wall-modify') return wallControls(ctx);
  if (tab === 'hole') {
    const p = placement(ctx) ?? {};
    return (
      choice('holeKind', 'Hole', saved.kind ?? 'plain', rows(holeKinds)) +
      positiveField('boreDiameter', 'Bore diameter', saved.diameter ?? 3) +
      choice('holeExtent', 'Extent', saved.extent ?? 'through', [
        ['through', 'Through part'],
        ['blind', 'Blind depth'],
      ]) +
      positiveField('holeDepth', 'Total depth', saved.depth ?? 6) +
      positiveField('headDiameter', 'Head diameter', saved.headDiameter ?? 6) +
      positiveField('headDepth', 'Head recess depth', saved.headDepth ?? 2) +
      field('headAngle', 'Included head angle', saved.headAngle ?? 90, '°', {
        min: 1,
        max: 179,
      }) +
      details(
        'Hole centre',
        choice(
          'holeFromU',
          'Horizontal reference',
          saved.fromU ?? p.fromU ?? 'min',
          originOptions,
        ) +
          field(
            'holeU',
            'Horizontal distance',
            saved.offsetU ?? p.offsetU ?? 0,
          ) +
          choice(
            'holeFromV',
            'Vertical reference',
            saved.fromV ?? p.fromV ?? 'min',
            originOptions,
          ) +
          field('holeV', 'Vertical distance', saved.offsetV ?? p.offsetV ?? 0) +
          '<p class="hint">Distances follow the selected face’s horizontal and vertical extents as it changes size.</p>',
        true,
      )
    );
  }
  if (tab === 'edge-finish') {
    const scope =
      saved.scope ?? (saved.type === 'edgeFinish' ? 'picked' : 'corner');
    const edges = pickedOrSavedEdges(ctx, scope);
    return (
      '<p class="selection-note" data-edge-description>' +
      describeEdgeSelection(edges, scope) +
      '</p>' +
      choice('edgeScope', 'Selection', scope, [
        ['corner', 'Edge or rounded corner'],
        ['picked', 'Individual segment'],
        ['loop', 'Entire face perimeter'],
        ['tangent', 'Tangent chain'],
      ]) +
      choice('edgeKind', 'Finish', saved.kind ?? 'fillet', rows(finishKinds)) +
      positiveField('edgeSize', 'Radius', saved.size ?? 1) +
      '<p class="hint">Click a rounded corner once to follow the bend. Shift-click to add or remove another corner or edge.</p>'
    );
  }
  const sources = earlierFeatures(ctx).map((item) => [
    item.id,
    item.label ?? item.type,
  ]);
  const center = ctx.part?.bounds?.min.map(
    (x, i) => (x + ctx.part.bounds.max[i]) / 2,
  ) ?? [0, 0, 0];
  return (
    (sources.length
      ? ''
      : '<p class="selection-note">Add or cut a feature on this part first. Its copies will follow edits to the original.</p>') +
    choice(
      'patternSource',
      'Original feature',
      saved.sourceId ?? sources.at(-1)?.[0],
      sources,
    ) +
    choice(
      'patternKind',
      'Pattern',
      saved.kind ?? 'mirror',
      rows(patternKinds),
    ) +
    choice('patternAxis', 'Axis', saved.axis ?? 'x', axisOptions) +
    field('patternCount', 'Total instances', saved.count ?? 3, '', {
      step: 1,
      min: 2,
      max: 256,
    }) +
    field('patternSpacing', 'Spacing', saved.spacing ?? 5) +
    field('patternAngle', 'Sweep', saved.angle ?? 360, '°', {
      min: -360,
      max: 360,
    }) +
    choice('patternCenterMode', 'Centre', saved.centerMode ?? 'part', [
      ['part', 'Follow part centre'],
      ['custom', 'World coordinates'],
    ]) +
    ['X', 'Y', 'Z']
      .map((name, i) =>
        field(
          'patternCenter' + name,
          name + ' coordinate',
          saved.center?.[i] ?? Number(center[i].toFixed(4)),
        ),
      )
      .join('')
  );
}
export function updateFeatureControls(form, ctx) {
  if (!form) return;
  updateWallControls(form);
  const f = form.elements;
  const row = (name, visible) => {
    const el = f.namedItem(name);
    if (el) {
      el.closest('label').hidden = !visible;
      el.disabled = !visible;
    }
  };
  if (f.holeKind) {
    row('holeDepth', f.holeExtent.value === 'blind');
    row('headDiameter', f.holeKind.value !== 'plain');
    row('headDepth', f.holeKind.value === 'counterbore');
    row('headAngle', f.holeKind.value === 'countersink');
  }
  if (f.edgeKind) {
    f.edgeSize.closest('label').firstElementChild.textContent =
      f.edgeKind.value === 'fillet' ? 'Radius' : 'Chamfer distance';
    if (ctx)
      form.querySelector('[data-edge-description]').textContent =
        describeEdgeSelection(
          pickedOrSavedEdges(ctx, f.edgeScope.value),
          f.edgeScope.value,
        );
  }
  if (f.patternKind) {
    const kind = f.patternKind.value,
      custom = f.patternCenterMode.value === 'custom';
    f.patternAxis.closest('label').firstElementChild.textContent =
      kind === 'mirror'
        ? 'Mirror plane normal'
        : kind === 'linear'
          ? 'Direction'
          : 'Rotation axis';
    row('patternCount', kind !== 'mirror');
    row('patternSpacing', kind === 'linear');
    row('patternAngle', kind === 'circular');
    row('patternCenterMode', kind !== 'linear');
    for (const name of ['X', 'Y', 'Z'])
      row(
        'patternCenter' + name,
        custom &&
          kind !== 'linear' &&
          (kind === 'mirror'
            ? name.toLowerCase() === f.patternAxis.value
            : name.toLowerCase() !== f.patternAxis.value),
      );
  }
}
export function featureOperation(tab, fields, base, ctx) {
  if (tab === 'wall-modify') return wallOperation(fields, base, ctx);
  if (tab === 'edge-finish') return edgeGroupOperation(fields, base, ctx);
  if (tab === 'hole') {
    const p = placement(ctx);
    if (!p) throw Error('Click a flat face at the centre of the hole.');
    return {
      ...base,
      type: 'hole',
      label: holeKinds[fields.holeKind],
      kind: fields.holeKind,
      seat: p.seat,
      diameter: fields.boreDiameter,
      extent: fields.holeExtent,
      fromU: fields.holeFromU,
      fromV: fields.holeFromV,
      offsetU: fields.holeU,
      offsetV: fields.holeV,
      ...(fields.holeExtent === 'blind' ? { depth: fields.holeDepth } : {}),
      ...(fields.holeKind === 'counterbore'
        ? { headDiameter: fields.headDiameter, headDepth: fields.headDepth }
        : {}),
      ...(fields.holeKind === 'countersink'
        ? { headDiameter: fields.headDiameter, headAngle: fields.headAngle }
        : {}),
    };
  }
  if (!fields.patternSource)
    throw Error('Choose an earlier feature to repeat.');
  const kind = fields.patternKind;
  return {
    ...base,
    type: 'featurePattern',
    kind,
    label: patternKinds[kind],
    sourceId: fields.patternSource,
    axis: fields.patternAxis,
    ...(kind !== 'mirror' ? { count: fields.patternCount } : {}),
    ...(kind === 'linear' ? { spacing: fields.patternSpacing } : {}),
    ...(kind === 'circular' ? { angle: fields.patternAngle } : {}),
    ...(kind !== 'linear' ? { centerMode: fields.patternCenterMode } : {}),
    ...(kind !== 'linear' && fields.patternCenterMode === 'custom'
      ? { center: ['X', 'Y', 'Z'].map((k) => fields['patternCenter' + k]) }
      : {}),
  };
}
export function featureGuides(op, part) {
  if (!op || !part) return [];
  if (op.type === 'edgeGroup' || op.type === 'wallModify')
    return wallEdgeGuides(op, part);
  if (op.type === 'edgeFinish' && op.edge) {
    const { a, b, circle } = op.edge;
    let outline = [a, b];
    if (circle) {
      const u = unit3(sub3(a, circle.center)),
        v = unit3(cross3(circle.normal, u));
      outline = Array.from({ length: 73 }, (_, i) =>
        add3(
          circle.center,
          mul3(
            add3(
              mul3(u, Math.cos((i * Math.PI) / 36)),
              mul3(v, Math.sin((i * Math.PI) / 36)),
            ),
            circle.radius,
          ),
        ),
      );
    }
    return [
      {
        id: 'finish-edge',
        tone: 'reference',
        anchor: mul3(add3(a, b), 0.5),
        text:
          (op.kind === 'fillet' ? 'Radius ' : 'Chamfer ') +
          fmt(op.size) +
          ' mm',
        paths: [outline],
        dots: circle ? [] : [a, b],
        strong: true,
      },
    ];
  }
  if (op.type === 'hole') {
    let p;
    try {
      p = locateHole(part, op, false);
    } catch {
      return [];
    }
    const { u, v, normal } = op.seat;
    function ring(r) {
      return Array.from({ length: 49 }, (_, i) =>
        add3(
          p,
          add3(
            mul3(u, r * Math.cos((i * Math.PI) / 24)),
            mul3(v, r * Math.sin((i * Math.PI) / 24)),
          ),
        ),
      );
    }
    const paths = [ring(op.diameter / 2)];
    if (op.kind !== 'plain') paths.push(ring(op.headDiameter / 2));
    if (op.extent === 'blind') paths.push([p, sub3(p, mul3(normal, op.depth))]);
    const guides = [
      {
        id: 'hole-location',
        tone: 'cut',
        anchor: p,
        dots: [p],
        paths,
        text: 'Ø ' + fmt(op.diameter) + ' mm',
        strong: true,
      },
    ];
    for (const [axis, dir, from, offset] of [
      ['U', u, op.fromU, op.offsetU],
      ['V', v, op.fromV, op.offsetV],
    ]) {
      if (!Number.isFinite(offset) || Math.abs(offset) < 1e-7) continue;
      const ref = sub3(p, mul3(dir, from === 'max' ? -offset : offset));
      guides.push({
        id: 'hole-' + axis.toLowerCase(),
        tone: 'reference',
        anchor: mul3(add3(p, ref), 0.5),
        dots: [ref],
        paths: [[ref, p]],
        text: axis + ' · ' + fmt(Math.abs(offset)) + ' mm',
        dashed: true,
      });
    }
    return guides;
  }
  if (op.type === 'featurePattern') {
    const a = ['x', 'y', 'z'].indexOf(op.axis);
    if (a < 0) return [];
    const p = patternCentre(op, part.bounds),
      dir = [0, 0, 0];
    dir[a] = Math.max(
      2,
      length3(sub3(part.bounds.max, part.bounds.min)) * 0.35,
    );
    if (op.kind === 'mirror') {
      const b = (a + 1) % 3,
        c = (a + 2) % 3;
      const outline = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
        [-1, -1],
      ].map(([u, v]) => {
        const pos = [...p];
        pos[b] += u * dir[a];
        pos[c] += v * dir[a];
        return pos;
      });
      return [
        {
          id: 'mirror-plane',
          tone: 'reference',
          anchor: p,
          paths: [outline],
          dots: [p],
          text: 'Mirror plane',
          dashed: true,
        },
      ];
    }
    return [
      {
        id: 'pattern-axis',
        tone: 'reference',
        anchor: p,
        paths: [[sub3(p, dir), add3(p, dir)]],
        dots: [p],
        text:
          op.kind === 'linear'
            ? fmt(op.spacing) + ' mm spacing'
            : 'Rotation axis',
        dashed: true,
      },
    ];
  }
  return [];
}
