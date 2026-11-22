const ns = 'http://www.w3.org/2000/svg';
function shape(tag, attrs, parent) {
  const node = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.append(node);
  return node;
}

// The SVG shows the same XY path as the builder. Using CSS pixels for the
// marks keeps a tiny socket selectable on a much longer Circuit drawing.
export function connectorMap(svg, handlers) {
  let layout,
    marks,
    selected,
    showAll = false,
    view,
    drag;
  const drawing = shape('g', {}, svg),
    pins = shape('g', {}, svg);
  function screen([x, y]) {
    return [
      (x - view.x) * view.scale + view.w / 2,
      (view.y - y) * view.scale + view.h / 2,
    ];
  }
  function readPointer(e) {
    const r = svg.getBoundingClientRect();
    return [
      (e.clientX - r.left - view.w / 2) / view.scale + view.x,
      view.y - (e.clientY - r.top - view.h / 2) / view.scale,
    ];
  }
  function poly(points, closed = false) {
    const segments = points.map((point, i) => {
      const [x, y] = screen(point);
      return (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2);
    });
    if (closed) segments.push('Z');
    return segments.join('');
  }
  function drawBase() {
    drawing.replaceChildren();
    pins.replaceChildren();
    view = null;
    if (!layout) return;
    const w = svg.clientWidth,
      h = svg.clientHeight;
    if (w < 1 || h < 1) return;
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    const lines = showAll ? [...layout.outlines, layout.edge] : [layout.edge];
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const points of lines)
      for (const [x, y] of points) {
        x0 = Math.min(x, x0);
        y0 = Math.min(y, y0);
        x1 = Math.max(x, x1);
        y1 = Math.max(y, y1);
      }
    if (!Number.isFinite(x0)) return;
    const pad = showAll ? 0.06 : 0.22,
      span = Math.max(x1 - x0, y1 - y0, 1);
    view = {
      w,
      h,
      x: (x0 + x1) / 2,
      y: (y0 + y1) / 2,
      scale: Math.min(
        (w - 24) / (x1 - x0 + span * pad * 2),
        (h - 24) / (y1 - y0 + span * pad * 2),
      ),
    };
    for (const [i, p] of layout.outlines.entries())
      shape(
        'path',
        { d: poly(p, true), class: i ? 'cp-border' : 'cp-road' },
        drawing,
      );
    for (const p of layout.lanes)
      shape('path', { d: poly(p), class: 'cp-lane' }, drawing);
    for (const piece of layout.equipment)
      shape('path', { d: poly(piece), class: 'cp-equipment' }, drawing);
    const seam = poly(layout.edge);
    shape('path', { d: seam, class: 'cp-edge-halo' }, drawing);
    shape('path', { d: seam, class: 'cp-edge' }, drawing);
    shape(
      'path',
      { d: seam, class: 'cp-edge-hit', 'data-cp-edge': '' },
      drawing,
    );
    drawMarks();
  }
  function drawMarks() {
    pins.replaceChildren();
    if (!view || !marks) return;
    for (const kind of ['clip', 'tab'])
      marks[kind].forEach((value, index) => {
        const [x, y] = screen(layout.pointAt(value)),
          d = (layout.domain[1] - layout.domain[0]) * 0.0005;
        const a = screen(layout.pointAt(Math.max(layout.domain[0], value - d))),
          b = screen(layout.pointAt(Math.min(layout.domain[1], value + d)));
        const degrees = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
        const g = shape(
          'g',
          {
            transform: 'translate(' + x + ' ' + y + ') rotate(' + degrees + ')',
            'data-cp-type': kind,
            'data-cp-index': index,
          },
          pins,
        );
        shape('circle', { r: 13, fill: 'transparent' }, g);
        if (selected?.kind === kind && selected.index === index)
          shape('circle', { r: 11.5, class: 'cp-ring' }, g);
        shape(
          'path',
          {
            d:
              kind === 'clip'
                ? 'M-4 -9H4V-5H2V-2H4V2H2V5H4V9H-4V5H-2V2H-4V-2H-2V-5H-4Z'
                : 'M-6 5V-3L-3 -7H3L6 -3V5Z',
            class: 'cp-' + kind,
          },
          g,
        );
      });
  }
  svg.onpointerdown = (e) => {
    if (!view || drag || e.button !== 0) return;
    const mark = e.target.closest('[data-cp-type]');
    if (!mark && !e.target.closest('[data-cp-edge]')) return;
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    const start = mark
      ? { kind: mark.dataset.cpType, index: Number(mark.dataset.cpIndex) }
      : null;
    drag = {
      start,
      id: e.pointerId,
      client: [e.clientX, e.clientY],
      moved: false,
    };
    if (start) handlers.select(start);
  };
  svg.onpointermove = (e) => {
    if (!drag || drag.id !== e.pointerId || !view || !drag.start) return;
    if (
      !drag.moved &&
      Math.hypot(e.clientX - drag.client[0], e.clientY - drag.client[1]) < 3
    )
      return;
    drag.moved = true;
    handlers.drag(drag.start, layout.valueAt(readPointer(e)), false);
  };
  svg.onpointerup = (e) => {
    if (!drag || drag.id !== e.pointerId || !view) return;
    const { start, moved } = drag;
    drag = null;
    if (svg.hasPointerCapture(e.pointerId))
      svg.releasePointerCapture(e.pointerId);
    const value = layout.valueAt(readPointer(e));
    if (!start) handlers.add(value);
    else if (moved) handlers.drag(start, value, true);
  };
  svg.onlostpointercapture = svg.onpointercancel = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    drag = null;
    handlers.cancel();
  };
  const size = new ResizeObserver(drawBase);
  size.observe(svg);
  return {
    setLayout(next, all) {
      layout = next;
      showAll = all;
      drawBase();
    },
    setMarks(next, pick) {
      marks = next;
      selected = pick;
      drawMarks();
    },
    destroy() {
      size.disconnect();
      svg.onpointerdown =
        svg.onpointerup =
        svg.onpointermove =
        svg.onlostpointercapture =
        svg.onpointercancel =
          null;
    },
  };
}
