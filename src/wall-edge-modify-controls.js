import { choice, field, fmt } from './ui.js';
import {
  compactEdge,
  sameFinishEdge,
  selectedEdgeRefs,
} from './geometry/edge-groups.js';
import {
  add3,
  mul3,
  dot3,
  resolveSeat,
  makeHoleSeat,
  sub3,
  unit3,
  cross3,
} from './geometry/feature-selection.js';

const axes = ['x', 'y', 'z'];
function selectedWalls(ctx) {
  const faces = ctx.regions?.length
    ? ctx.regions
    : ctx.region
      ? [ctx.region]
      : [];
  if (faces.length && ctx.part)
    return faces.every((r) => r?.planar && r.loops?.length)
      ? faces.map((r) => makeHoleSeat(r, ctx.part))
      : [];
  return ctx.op?.walls ?? [];
}
export function wallControls(ctx) {
  const saved = ctx.op ?? {};
  const walls = selectedWalls(ctx),
    count = walls.length;
  const axis =
    saved.axis ??
    ['z', 'y', 'x'].find((k) =>
      walls.every((w) => Math.abs(w.normal[axes.indexOf(k)]) < 1e-4),
    ) ??
    'z';
  const i = axes.indexOf(axis);
  let low = Infinity;
  if (ctx.part)
    for (const wall of walls) {
      try {
        const { edges } = resolveSeat(ctx.part, wall);
        for (const [a] of edges) low = Math.min(low, a[i]);
      } catch {
        /* A history entry may refer to a replaced face. */
      }
    }
  return (
    '<p class="selection-note">' +
    (count
      ? count + ' flat wall' + (count === 1 ? '' : 's') + ' selected'
      : 'Pick a flat wall. Shift-click to include more walls.') +
    '</p>' +
    choice('wallAction', 'Modify', saved.kind ?? 'offset', [
      ['offset', 'Offset wall'],
      ['draft', 'Draft wall'],
    ]) +
    field('wallDistance', 'Offset per wall', saved.distance ?? -0.2) +
    choice('wallAxis', 'Fixed plane', axis, [
      ['z', 'XY plane (Z height)'],
      ['y', 'XZ plane (Y position)'],
      ['x', 'YZ plane (X position)'],
    ]) +
    field(
      'wallBase',
      'Fixed plane position',
      saved.base ??
        (Number.isFinite(low)
          ? Number(low.toFixed(4))
          : (ctx.part?.bounds.min[i] ?? 0)),
    ) +
    field('wallAngle', 'Draft angle', saved.angle ?? 3, '°', {
      min: -84.99,
      max: 84.99,
    }) +
    '<p class="hint" data-wall-hint></p>'
  );
}
export function updateWallControls(form) {
  const f = form.elements;
  if (!f.wallAction) return;
  const draft = f.wallAction.value === 'draft';
  for (const [key, visible] of [
    ['wallDistance', !draft],
    ['wallAxis', draft],
    ['wallBase', draft],
    ['wallAngle', draft],
  ]) {
    f[key].disabled = !visible;
    f[key].closest('label').hidden = !visible;
  }
  form.querySelector('[data-wall-hint]').textContent = draft
    ? 'The wall stays fixed where it meets the reference plane. Above it, a positive angle moves the wall outward from the material.'
    : 'Positive adds material at each picked wall. Negative removes material for clearance. The opposite surface stays fixed unless selected.';
}
export function wallOperation(fields, base, ctx) {
  const walls = selectedWalls(ctx);
  if (!walls.length)
    throw Error(
      'Pick a flat wall, then Shift-click any other walls to include.',
    );
  const kind = fields.wallAction;
  return {
    ...base,
    type: 'wallModify',
    walls,
    kind,
    label:
      (kind === 'draft' ? 'Draft' : 'Offset') +
      (walls.length === 1 ? ' wall' : ' walls'),
    ...(kind === 'draft'
      ? {
          axis: fields.wallAxis,
          base: fields.wallBase,
          angle: fields.wallAngle,
        }
      : { distance: fields.wallDistance }),
  };
}
export function edgesForScope(edges, scope) {
  if (
    scope !== 'corner' ||
    edges.length < 2 ||
    !edges.some((edge) => edge.corner)
  )
    return edges;
  const unique = [];
  for (const edge of edges) {
    if (!edge.corner || !unique.some((other) => sameFinishEdge(other, edge)))
      unique.push(edge);
  }
  return unique;
}
export function pickedOrSavedEdges(ctx, scope) {
  const edges = ctx.edges?.length
    ? ctx.edges
    : ctx.edge
      ? [ctx.edge]
      : (ctx.op?.edges ?? (ctx.op?.edge ? [ctx.op.edge] : []));
  return edgesForScope(edges, scope);
}
export function edgeSelectionLabel(edges, scope = 'corner') {
  const corners =
    scope === 'corner' ? edges.filter((edge) => edge.corner).length : 0;
  const others = edges.length - corners;
  return [
    corners && corners + ' rounded corner' + (corners === 1 ? '' : 's'),
    others && others + ' edge' + (others === 1 ? '' : 's'),
  ]
    .filter(Boolean)
    .join(' and ');
}
export function edgeGroupOperation(fields, base, ctx) {
  const scope = fields.edgeScope ?? 'corner';
  const edges = pickedOrSavedEdges(ctx, scope).map((edge) => {
    const ref = compactEdge(edge);
    if (scope !== 'corner') delete ref.corner;
    return ref;
  });
  const kind = fields.edgeKind;
  if (!edges.length) throw Error('Click near the edge you want to finish.');
  if (
    edges.length === 1 &&
    (scope === 'picked' || (scope === 'corner' && !edges[0].corner))
  )
    return {
      ...base,
      type: 'edgeFinish',
      kind,
      size: fields.edgeSize,
      ...(scope === 'corner' ? { scope } : {}),
      label: kind === 'fillet' ? 'Round edge' : 'Chamfer edge',
      edge: edges[0],
    };
  return {
    ...base,
    type: 'edgeGroup',
    kind,
    size: fields.edgeSize,
    scope,
    edges,
    label:
      (kind === 'fillet' ? 'Round ' : 'Chamfer ') +
      (scope === 'loop'
        ? 'edge loop'
        : scope === 'tangent'
          ? 'tangent chain'
          : scope === 'corner'
            ? edgeSelectionLabel(edges, scope)
            : 'edges'),
  };
}
function edgePath(edge) {
  if (!edge.circle) return [edge.a, edge.b];
  const { center, radius, normal } = edge.circle,
    u = unit3(sub3(edge.a, center)),
    v = cross3(normal, u);
  return Array.from({ length: 65 }, (_, i) => {
    const a = (i * Math.PI) / 32;
    return add3(
      center,
      add3(mul3(u, radius * Math.cos(a)), mul3(v, radius * Math.sin(a))),
    );
  });
}
export function wallEdgeGuides(op, part) {
  if (op.type === 'edgeGroup') {
    let edges = op.edges;
    try {
      edges = selectedEdgeRefs(part, op.edges, op.scope);
    } catch {
      /* Keep picked edges visible. */
    }
    if (!edges?.length) return [];
    return [
      {
        id: 'finish-edge',
        tone: 'reference',
        paths: edges.map(edgePath),
        anchor: mul3(add3(edges[0].a, edges[0].b), 0.5),
        text:
          (op.scope === 'corner'
            ? edgeSelectionLabel(op.edges)
            : edges.length + ' edge' + (edges.length === 1 ? '' : 's')) +
          ' · ' +
          (op.kind === 'fillet' ? 'Radius ' : 'Chamfer ') +
          fmt(op.size) +
          ' mm',
        dots: [],
        strong: true,
      },
    ];
  }
  const paths = [],
    outlines = [],
    dots = [];
  const i = axes.indexOf(op.axis);
  for (const w of op.walls) {
    try {
      const seat = resolveSeat(part, w),
        loaded = seat.edges;
      const projected = (p) =>
        add3(
          p,
          mul3(
            w.normal,
            op.kind === 'offset'
              ? op.distance
              : (p[i] - op.base) * Math.tan((op.angle * Math.PI) / 180),
          ),
        );
      for (const [a, b] of loaded) {
        outlines.push([a, b]);
        paths.push([projected(a), projected(b)]);
      }
      const p = add3(
        seat.pick,
        mul3(w.normal, seat.level - dot3(w.normal, seat.pick)),
      );
      dots.push(p);
      paths.push([p, projected(p)]);
    } catch {
      /* The operation reports an outdated face in the inspector. */
    }
  }
  if (!dots.length) return [];
  const out = [
    {
      id: 'wall-outline',
      tone: 'reference',
      paths: outlines,
      dots: [],
      anchor: dots[0],
      dashed: true,
    },
    {
      id: 'wall-result',
      tone: op.kind === 'offset' && op.distance < 0 ? 'cut' : 'reference',
      paths,
      dots,
      anchor: dots[0],
      text:
        op.kind === 'offset'
          ? fmt(op.distance) + ' mm per wall'
          : 'Draft ' + fmt(op.angle) + '°',
      strong: true,
    },
  ];
  if (op.kind === 'draft' && i >= 0) {
    const others = [0, 1, 2].filter((a) => a !== i),
      box = part.bounds;
    const plane = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ].map((v) => {
      const p = [0, 0, 0];
      p[i] = op.base;
      others.forEach(
        (axis, j) => (p[axis] = v[j] ? box.max[axis] : box.min[axis]),
      );
      return p;
    });
    out.push({
      id: 'wall-fixed-plane',
      tone: 'reference',
      paths: [plane],
      dots: [],
      anchor: plane[0],
      dashed: true,
      text: 'Fixed ' + op.axis.toUpperCase() + ' = ' + fmt(op.base) + ' mm',
    });
  }
  return out;
}
