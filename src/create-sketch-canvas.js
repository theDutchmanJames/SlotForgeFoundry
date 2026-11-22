// Theme colours for the canvas, resolved through the page's CSS so the
// sketch follows Light / Dark (canvas cannot read var() itself).
const themeColors = new Map();
let themeProbe;
if (typeof document !== 'undefined')
  document.addEventListener('foundry-theme', () => themeColors.clear());
function themeColor(name) {
  if (typeof document === 'undefined' || !document.body) return '#888';
  if (themeColors.has(name)) return themeColors.get(name);
  themeProbe ??= document.body.appendChild(document.createElement('span'));
  themeProbe.hidden = true;
  themeProbe.style.color = 'var(' + name + ')';
  const value = getComputedStyle(themeProbe).color || '#888';
  themeColors.set(name, value);
  return value;
}
import {
  sketchAnchors,
  sketchBounds,
  sketchElementPath,
} from './create-sketch-data.js';
import {
  gridSegments,
  gridToPlane,
  outlineCircle,
  outlineHoleCentres,
  planeToGrid,
  snapToGrid,
} from './sketch-grid.js';

function nearestOnSegment(raw, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    len = dx * dx + dy * dy;
  const t = len
    ? Math.min(
        1,
        Math.max(0, ((raw[0] - a[0]) * dx + (raw[1] - a[1]) * dy) / len),
      )
    : 0;
  return [a[0] + dx * t, a[1] + dy * t];
}

function straightSegments(points, closed) {
  const edges = [],
    count = points.length,
    n = closed ? count : count - 1;
  if (count < 2 || (closed && outlineCircle(points))) return edges;
  function gentle(p, a, b) {
    const v = [a[0] - p[0], a[1] - p[1]],
      w = [b[0] - a[0], b[1] - a[1]];
    const l1 = Math.hypot(...v),
      l2 = Math.hypot(...w);
    if (!l1 || !l2 || Math.max(l1, l2) > 1.45 * Math.min(l1, l2)) return false;
    const c = (v[0] * w[0] + v[1] * w[1]) / (l1 * l2);
    return c > 0.93 && c < 0.9999999;
  }
  for (let i = 0; i < n; i++) {
    const a = points[i],
      b = points[(i + 1) % count];
    if (
      (closed || (i > 0 && i + 2 < count)) &&
      gentle(points[(i + count - 1) % count], a, b) &&
      gentle(a, b, points[(i + 2) % count])
    )
      continue;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-9) edges.push([a, b]);
  }
  return edges;
}

function trace(points, closed) {
  const path = new Path2D();
  if (points.length) {
    path.moveTo(...points[0]);
    for (let i = 1; i < points.length; i++) path.lineTo(...points[i]);
    if (closed) path.closePath();
  }
  return path;
}

// Cache projected geometry and snap candidates until the sketch changes.
// The view only redraws after an edit, pointer movement, pan, or zoom.
export function sketchCanvas(
  canvas,
  { click, move, hover, grid, snap, gridPick, gridDensity },
) {
  const ctx = canvas.getContext('2d');
  let shapes = [],
    filled = new Path2D(),
    refs = [],
    projected = null,
    refClip = new Path2D(),
    holes = [],
    axisEdges = null,
    refEdges = null,
    gridCache = null,
    anchors = [],
    selected = -1,
    vertex = null,
    ghost = null,
    cursor = null,
    pivot = null;
  let width = 1,
    height = 1,
    scale = 4,
    centre = [0, 0],
    frame = 0,
    drag = null;
  function request() {
    if (!frame) frame = requestAnimationFrame(draw);
  }
  const screen = (p) => [
    (p[0] - centre[0]) * scale + width / 2,
    height / 2 - (p[1] - centre[1]) * scale,
  ];
  const world = (x, y) => [
    (x - width / 2) / scale + centre[0],
    (height / 2 - y) / scale + centre[1],
  ];
  function dimension(a, b, offset, label) {
    const A = screen(a),
      B = screen(b),
      dx = B[0] - A[0],
      dy = B[1] - A[1],
      length = Math.hypot(dx, dy);
    if (length < 14) return;
    const nx = -dy / length,
      ny = dx / length,
      ax = A[0] + nx * offset,
      ay = A[1] + ny * offset,
      bx = B[0] + nx * offset,
      by = B[1] + ny * offset;
    ctx.strokeStyle = themeColor('--d-guide');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    for (const [x, y] of [
      [ax, ay],
      [bx, by],
    ]) {
      ctx.moveTo(x - nx * 3, y - ny * 3);
      ctx.lineTo(x + nx * 3, y + ny * 3);
    }
    ctx.stroke();
    ctx.font = '12px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tx = (ax + bx) / 2,
      ty = (ay + by) / 2,
      w = ctx.measureText(label).width + 6;
    ctx.fillStyle = themeColor('--d-paper');
    ctx.fillRect(tx - w / 2, ty - 8, w, 16);
    ctx.fillStyle = themeColor('--d-ink');
    ctx.fillText(label, tx, ty);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  function dimensions(e) {
    if (!e) return;
    const mm = (n) => Number(n.toFixed(3)) + ' mm';
    const { x, y } = e;
    if (e.type === 'rectangle' || e.type === 'lProfile') {
      const a = ((e.angle ?? 0) * Math.PI) / 180,
        c = Math.cos(a),
        s = Math.sin(a);
      const at = (u, v) => [x + c * u - s * v, y + s * u + c * v];
      dimension(at(0, 0), at(e.width, 0), 17, mm(e.width));
      dimension(at(0, 0), at(0, e.height), -21, mm(e.height));
      if (e.type === 'lProfile')
        dimension(
          at(0, e.height),
          at(e.thickness, e.height),
          -14,
          mm(e.thickness),
        );
    } else if (e.type === 'circle')
      dimension(
        [x - e.diameter / 2, y],
        [x + e.diameter / 2, y],
        0,
        'Ø ' + mm(e.diameter),
      );
    else if (e.type === 'slot') {
      const a = ((e.angle ?? 0) * Math.PI) / 180,
        dx = (e.length * Math.cos(a)) / 2,
        dy = (e.length * Math.sin(a)) / 2;
      dimension([x - dx, y - dy], [x + dx, y + dy], -15, mm(e.length));
    } else if (e.type === 'line') {
      const [a, b] = e.points;
      dimension(a, b, 14, mm(Math.hypot(a[0] - b[0], a[1] - b[1])));
    }
  }
  function drawGrid(g) {
    if (!g.visible) {
      gridDensity(0);
      return;
    }
    if (
      !gridCache ||
      gridCache.g !== g ||
      gridCache.scale !== scale ||
      gridCache.centre !== centre ||
      gridCache.width !== width ||
      gridCache.height !== height
    ) {
      const corners = [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
      ].map((p) => planeToGrid(g, world(...p)));
      const { xmin, xmax, ymin, ymax } = sketchBounds([corners]);
      const bounds = { min: [xmin, ymin], max: [xmax, ymax] };
      const { lines, stride } = gridSegments(g, bounds, {
        pixelsPerMm: scale,
        minPixels: 12,
        maxLines: 160,
      });
      const mesh = new Path2D();
      for (const [a, b] of lines) {
        mesh.moveTo(...a);
        mesh.lineTo(...b);
      }
      const axes = new Path2D();
      axes.moveTo(...gridToPlane(g, [xmin, 0]));
      axes.lineTo(...gridToPlane(g, [xmax, 0]));
      axes.moveTo(...gridToPlane(g, [0, ymin]));
      axes.lineTo(...gridToPlane(g, [0, ymax]));
      gridCache = { g, scale, centre, width, height, mesh, axes, stride };
    }
    gridDensity(gridCache.stride > 1 ? gridCache.stride * g.pitch : 0);
    ctx.save();
    if (refs.length) ctx.clip(refClip, 'evenodd');
    ctx.lineWidth = 0.8 / scale;
    ctx.strokeStyle = themeColor('--line');
    ctx.stroke(gridCache.mesh);
    ctx.lineWidth = 1.3 / scale;
    ctx.strokeStyle = themeColor('--d-guide');
    ctx.stroke(gridCache.axes);
    ctx.restore();
  }
  function datumMarker(g) {
    const [x, y] = screen(g.origin);
    if (x < -35 || x > width + 35 || y < -35 || y > height + 35) return;
    ctx.font = '11px system-ui';
    ctx.save();
    ctx.translate(x, y);
    for (const [axis, label] of [
      [g.xAxis, 'X'],
      [g.yAxis, 'Y'],
    ]) {
      const dx = axis[0],
        dy = -axis[1];
      ctx.strokeStyle = themeColor('--d-focus');
      ctx.fillStyle = themeColor('--d-focus');
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(dx * 19, dy * 19);
      ctx.moveTo(dx * 14 - dy * 3, dy * 14 + dx * 3);
      ctx.lineTo(dx * 19, dy * 19);
      ctx.lineTo(dx * 14 + dy * 3, dy * 14 - dx * 3);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, dx * 26, dy * 26);
    }
    ctx.restore();
  }
  function draw() {
    frame = 0;
    const ratio = canvas.width / width;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const [ox, oy] = screen([0, 0]);
    ctx.translate(ox, oy);
    ctx.scale(scale, -scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const g = grid();
    drawGrid(g);
    ctx.lineWidth = 1.2 / scale;
    ctx.setLineDash([5 / scale, 4 / scale]);
    ctx.strokeStyle = themeColor('--d-muted');
    for (const r of refs) ctx.stroke(r.path);
    ctx.setLineDash([]);
    ctx.fillStyle = '#239e8425';
    ctx.fill(filled, 'evenodd');
    shapes.forEach((s, i) => {
      ctx.strokeStyle = i === selected ? themeColor('--d-focus') : themeColor('--d-ink');
      ctx.lineWidth = (i === selected ? 2.7 : 1.7) / scale;
      ctx.stroke(s.path);
    });
    if (gridPick() === 'axis' && cursor?.edge) {
      ctx.strokeStyle = themeColor('--d-warn');
      ctx.lineWidth = 3 / scale;
      ctx.stroke(trace(cursor.edge, false));
    }
    if (ghost?.points.length) {
      ctx.strokeStyle = themeColor('--d-warn');
      ctx.lineWidth = 1.8 / scale;
      ctx.setLineDash([6 / scale, 3 / scale]);
      ctx.stroke(trace(ghost.points, ghost.closed));
      ctx.setLineDash([]);
    }
    if (pivot) {
      ctx.fillStyle = themeColor('--d-warn');
      ctx.beginPath();
      ctx.arc(...pivot, 3 / scale, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (g.visible || gridPick()) datumMarker(g);
    if (gridPick() === 'origin') {
      ctx.beginPath();
      ctx.strokeStyle = themeColor('--d-focus');
      ctx.lineWidth = 1.3;
      for (const h of holes) {
        const [x, y] = screen(h.point);
        if (x < 0 || x > width || y < 0 || y > height) continue;
        ctx.moveTo(x - 4, y);
        ctx.lineTo(x + 4, y);
        ctx.moveTo(x, y - 4);
        ctx.lineTo(x, y + 4);
      }
      ctx.stroke();
    }
    dimensions(ghost?.entity ?? shapes[selected]?.entity);
    const selectedPoint =
      vertex == null ? null : shapes[selected]?.entity.points?.[vertex];
    if (selectedPoint) {
      const [x, y] = screen(selectedPoint);
      ctx.fillStyle = themeColor('--panel');
      ctx.strokeStyle = themeColor('--d-focus');
      ctx.lineWidth = 2;
      ctx.fillRect(x - 3, y - 3, 6, 6);
      ctx.strokeRect(x - 3, y - 3, 6, 6);
    }
    if (cursor && hover()) {
      const [x, y] = screen(cursor.point);
      ctx.strokeStyle = themeColor('--d-focus');
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x - 4, y - 4, 8, 8);
      if (cursor.label) {
        ctx.fillStyle = themeColor('--d-ink');
        ctx.font = '12px system-ui';
        ctx.fillText(cursor.label, x + 9, y - 7);
      }
    }
  }
  function data(entities, referenceLoops, focus, closedLoops) {
    selected = focus;
    filled = new Path2D();
    for (const loop of closedLoops) filled.addPath(trace(loop, true));
    shapes = entities.map((entity) => {
      const path = sketchElementPath(entity);
      return { ...path, entity, path: trace(path.points, path.closed) };
    });
    if (projected !== referenceLoops) {
      projected = referenceLoops;
      refs = referenceLoops
        .filter((points) => points.length >= 2)
        .map((points) => ({ points, path: trace(points, true) }));
      refClip = new Path2D();
      refEdges = null;
      for (const ref of refs) refClip.addPath(ref.path);
      holes = outlineHoleCentres(referenceLoops);
    }
    axisEdges = null;
    anchors = holes.map((h) => [h.point, 'Hole centre']);
    shapes.forEach((s, i) => {
      for (const anchor of sketchAnchors(entities[i], s)) anchors.push(anchor);
    });
    for (const ref of refs) {
      const bounds = sketchBounds([ref.points]);
      anchors.push([
        [(bounds.xmin + bounds.xmax) / 2, (bounds.ymin + bounds.ymax) / 2],
        'Face centre',
      ]);
      for (const p of ref.points) anchors.push([p, 'Face corner']);
    }
    anchors.sort((a, b) => a[0][0] - b[0][0]);
    request();
  }
  function fit() {
    const b = sketchBounds([...shapes, ...refs].map((s) => s.points));
    const w = b ? Math.max(b.xmax - b.xmin, 6) : 100,
      h = b ? Math.max(b.ymax - b.ymin, 6) : 70;
    centre = b ? [b.xmin / 2 + b.xmax / 2, b.ymin / 2 + b.ymax / 2] : [0, 0];
    scale = Math.max(
      1e-10,
      Math.min(1e8, (width / w) * 0.78, (height / h) * 0.78),
    );
    request();
  }
  function snapped(raw, snap) {
    if (!snap) return { point: raw, label: '' };
    const reach = 9 / scale,
      xMin = raw[0] - reach,
      xMax = raw[0] + reach;
    let lo = 0,
      hi = anchors.length,
      best = null,
      limit = reach;
    const zero = grid().origin,
      toZero = Math.hypot(raw[0] - zero[0], raw[1] - zero[1]);
    if (toZero < reach) {
      best = { point: zero, label: 'Grid zero' };
      limit = toZero;
    }
    while (lo < hi) {
      const m = Math.floor((lo + hi) / 2);
      if (anchors[m][0][0] < xMin) lo = m + 1;
      else hi = m;
    }
    for (let i = lo; i < anchors.length && anchors[i][0][0] <= xMax; i++) {
      const [p, label] = anchors[i],
        d = Math.hypot(p[0] - raw[0], p[1] - raw[1]);
      if (d < limit) {
        best = { point: p, label };
        limit = d;
      }
    }
    if (best) return best;
    for (const ref of refs) {
      let a = ref.points.at(-1);
      for (const b of ref.points) {
        if (
          Math.min(a[0], b[0]) - limit <= raw[0] &&
          Math.max(a[0], b[0]) + limit >= raw[0] &&
          Math.min(a[1], b[1]) - limit <= raw[1] &&
          Math.max(a[1], b[1]) + limit >= raw[1]
        ) {
          const dx = b[0] - a[0],
            dy = b[1] - a[1],
            len = dx * dx + dy * dy;
          const t = len
            ? Math.min(
                1,
                Math.max(
                  0,
                  ((raw[0] - a[0]) * dx + (raw[1] - a[1]) * dy) / len,
                ),
              )
            : 0;
          const p = [a[0] + dx * t, a[1] + dy * t],
            d = Math.hypot(p[0] - raw[0], p[1] - raw[1]);
          if (d < limit) {
            best = { point: p, label: 'Face edge' };
            limit = d;
          }
        }
        a = b;
      }
    }
    return best ?? { point: snapToGrid(grid(), raw), label: 'Grid' };
  }
  function target(raw, useSnap) {
    const mode = gridPick(),
      reach = 9 / scale;
    if (mode === 'axis') {
      refEdges ??= refs.flatMap((ref) => straightSegments(ref.points, true));
      axisEdges ??= shapes.flatMap((shape) =>
        ['circle', 'arc'].includes(shape.entity.type)
          ? []
          : straightSegments(shape.points, shape.closed),
      );
      let limit = reach,
        best = null;
      for (const group of [refEdges, axisEdges])
        for (const edge of group) {
          const [a, b] = edge;
          if (
            raw[0] < Math.min(a[0], b[0]) - limit ||
            raw[0] > Math.max(a[0], b[0]) + limit ||
            raw[1] < Math.min(a[1], b[1]) - limit ||
            raw[1] > Math.max(a[1], b[1]) + limit
          )
            continue;
          const point = nearestOnSegment(raw, a, b),
            d = Math.hypot(raw[0] - point[0], raw[1] - point[1]);
          if (d < limit) {
            limit = d;
            // Give equally oriented edges the same +X regardless of STL winding.
            const dx = b[0] - a[0],
              dy = b[1] - a[1];
            const reverse =
              Math.abs(dx) > Math.hypot(dx, dy) * 1e-8 ? dx < 0 : dy < 0;
            best = {
              point,
              edge: reverse ? [b, a] : edge,
              label: '+X along edge',
            };
          }
        }
      return best ?? { point: raw, label: '' };
    }
    if (mode === 'origin' && useSnap) {
      let best = null,
        distance = Infinity;
      for (const h of holes) {
        const d = Math.hypot(raw[0] - h.point[0], raw[1] - h.point[1]);
        if (d <= h.radius + reach && d < distance) {
          distance = d;
          best = h;
        }
      }
      if (best) return { point: best.point, label: 'Hole centre' };
      // A picked origin should allow an arbitrary point between grid lines.
      const result = snapped(raw, true);
      return result.label === 'Grid'
        ? { point: raw, label: 'Set zero' }
        : result;
    }
    return snapped(raw, useSnap && snap());
  }
  function hit(raw) {
    ctx.save();
    ctx.resetTransform();
    ctx.lineWidth = 12 / scale;
    let inside = -1,
      edge = -1;
    for (let i = shapes.length - 1; i >= 0; i--) {
      if (ctx.isPointInStroke(shapes[i].path, ...raw)) {
        edge = i;
        break;
      }
      if (
        inside < 0 &&
        shapes[i].closed &&
        ctx.isPointInPath(shapes[i].path, ...raw, 'evenodd')
      )
        inside = i;
    }
    ctx.restore();
    return edge < 0 ? inside : edge;
  }
  const xy = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button > 1) return;
    if (e.button === 1 || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      drag = { start: xy(e), centre: [...centre], id: e.pointerId };
      canvas.setPointerCapture(e.pointerId);
    } else {
      const raw = world(...xy(e)),
        v = target(raw, hover() && !e.altKey);
      click(v.point, hover() ? null : hit(raw), v);
      request();
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = xy(e);
    if (drag) {
      centre = [
        drag.centre[0] - (x - drag.start[0]) / scale,
        drag.centre[1] + (y - drag.start[1]) / scale,
      ];
      request();
      return;
    }
    const v = target(world(x, y), hover() && !e.altKey);
    cursor = hover() ? v : null;
    move(v.point);
    request();
  });
  function release() {
    drag = null;
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => {
    cursor = null;
    move(null);
    request();
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const [x, y] = xy(e),
        p = world(x, y);
      const next = Math.max(
        scale * 0.25,
        Math.min(scale * 4, scale * Math.exp(-e.deltaY * 0.0015)),
      );
      const maxScale = 1e8,
        minScale = 1e-10;
      scale = Math.max(minScale, Math.min(maxScale, next));
      const q = world(x, y);
      centre = [centre[0] + p[0] - q[0], centre[1] + p[1] - q[1]];
      request();
    },
    { passive: false },
  );
  function resize() {
    const r = canvas.getBoundingClientRect();
    width = Math.max(1, r.width);
    height = Math.max(1, r.height);
    const dpr = Math.min(1.75, devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    request();
  }
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  return {
    data,
    fit,
    request,
    select(id) {
      selected = id;
      request();
    },
    vertex(index) {
      vertex = index;
      request();
    },
    guide(path, start) {
      ghost = path;
      pivot = start;
      request();
    },
    dispose() {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
