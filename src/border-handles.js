import { apexPositionFor, apexWidthFor } from './geometry/border-profile.js';
import { borderEndProfile } from './geometry/border-ends.js';
import { endFieldKey } from './track-shape-controls.js';
import { nativePath } from './track.js';
import { pitLayout, pitPrintPath } from './geometry/special-junction-layout.js';
import { pitBraidLayout } from './geometry/pit-braids.js';

const svgNS = 'http://www.w3.org/2000/svg';
const chartWidth = 280,
  chartHeight = 151;
const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
const rounded = (x) => Math.round(x * 10) / 10;
const controls = [
  { key: 'borderEntry', label: 'Entry', station: () => 0 },
  { key: 'borderApex', label: 'Apex', station: apexPositionFor },
  { key: 'borderExit', label: 'Exit', station: () => 1 },
];
const sideName = (sign) => (sign > 0 ? 'outer' : 'inner');
const widthAtHandle = (p, key, side) =>
  key === 'borderApex' ? apexWidthFor(p, side) : p[key];

const guidePaths = new WeakMap();
function guidePath(p) {
  if (!['chicane', 'duel', 'timing', 'pit'].includes(p.special?.type)) return;
  if (!guidePaths.has(p)) {
    // Width edits can be temporarily infeasible. Sample the applied road with
    // no borders, and let the live geometry report the candidate fit error.
    if (p.special.type === 'pit') {
      const pit = pitLayout(p);
      guidePaths.set(p, pitPrintPath(pit.path, pit.forks, p, pitBraidLayout(p, pit)));
    } else guidePaths.set(p, nativePath({ ...p, borderSide: 'none' }));
  }
  return guidePaths.get(p);
}

function stationFor(p,x,y) {
  const path = guidePath(p);
  if (!path) return p.kind === 'curve'
    ? .5 + Math.atan2(x,y+p.radius)/((p.angle*Math.PI)/180)
    : .5 + x/p.length;
  let best = Infinity, station = 0;
  const onPit = p.special.type === 'pit';
  // The pit profile measures lateral offsets on a vertical section, even
  // where a one-sided shoulder temporarily moves the road centre.
  let a = path.point(0,0);
  for(let i=1;i<path.stations.length;i++){
    const t0=path.stations[i-1], t1=path.stations[i], b=path.point(t1,0);
    const dx=b[0]-a[0],dy=onPit ? 0 : b[1]-a[1],norm=dx*dx+dy*dy;
    if(norm>0){
      const f=clamp(((x-a[0])*dx+(y-a[1])*dy)/norm,0,1);
      const d=Math.hypot(x-a[0]-f*dx,onPit ? 0 : y-a[1]-f*dy);
      if(d<best){ best=d; station=t0+f*(t1-t0); }
    }
    a=b;
  }
  return station;
}

function widthLimit(p, key, sign) {
  const hasInner = p.borderSide === 'inner' || p.borderSide === 'both';
  if (p.kind !== 'curve' || !hasInner || (key === 'borderApex' && sign > 0))
    return 2000;
  return clamp(Math.floor((p.radius - p.width / 2 - 0.001) * 10) / 10, 0, 2000);
}

function section(p, t, offset) {
  const path=guidePath(p);
  if(path) return path.point(t,offset);
  if (p.kind !== 'curve') return [(t - 0.5) * p.length, offset];
  const angle = ((p.angle * Math.PI) / 180) * (t - 0.5);
  return [
    (p.radius + offset) * Math.sin(angle),
    (p.radius + offset) * Math.cos(angle) - p.radius,
  ];
}

// A width drag follows the normal to the road at each fixed station. The apex
// can additionally move along its arc (or along the length of a straight).
export function borderDrag(p, key, side, [x, y]) {
  const curved = p.kind === 'curve',
    sweep = (p.angle * Math.PI) / 180;
  let t = key === 'borderEntry' ? 0 : 1;
  const delta = {};
  if (key === 'borderApex') {
    const station = stationFor(p,x,y);
    const percent = clamp(Math.round(100 * station), 1, 99);
    delta[sideName(side) + 'ApexPercent'] = percent;
    t = percent / 100;
  }
  const angle = curved ? sweep * (t - 0.5) : 0;
  const base = section(p, t, (side * p.width) / 2);
  const tangent=guidePath(p)?.tangent(t);
  const [nx,ny]=tangent ? [-tangent[1], tangent[0]] : [Math.sin(angle),Math.cos(angle)];
  const width = side * ((x-base[0])*nx+(y-base[1])*ny);
  const widthKey = key === 'borderApex' ? sideName(side) + 'ApexWidth' : key;
  delta[widthKey] = clamp(rounded(width), 0, widthLimit(p, key, side));
  return delta;
}

function svgElement(name, attrs, parent) {
  const el = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  parent.append(el);
  return el;
}

/**
 * Mount an interactive top view into an empty host. Imported alignments use
 * a labelled, straightened width profile. onChange receives form field values
 * for the shared ends or the selected side's apex while dragging.
 * Update the matching inputs in place in that callback. Remount when other
 * controls change the plan. The returned function removes this view.
 */
export function mountBorderHandles(host, params, onChange, lengths = {}) {
  const p = { ...params, borderEnds:structuredClone(params.borderEnds) };
  if (p.kind === 'import') p.length = Math.max(90, 1.8 * p.width);
  const sides =
    p.borderSide === 'both'
      ? [1, -1]
      : p.borderSide === 'outer'
        ? [1]
        : p.borderSide === 'inner'
          ? [-1]
          : [];
  const svg = svgElement(
    'svg',
    {
      viewBox: '0 0 ' + chartWidth + ' ' + chartHeight,
      width: '100%',
      role: 'group',
      'aria-label':
        p.kind === 'import'
          ? 'Straightened border width profile'
          : 'Track border in plan view',
    },
    host,
  );
  svg.style.cssText =
    'display:block;background:var(--d-paper);border-radius:6px;touch-action:none;user-select:none';
  const road = svgElement(
    'path',
    { fill: 'var(--d-track)', stroke: 'var(--d-track-edge)', 'stroke-width': 0.8 },
    svg,
  );
  const borders = sides.map((side) => ({
    side,
    element: svgElement(
      'path',
      { fill: 'var(--d-border)', stroke: 'var(--d-track-edge)', 'stroke-width': 0.8 },
      svg,
    ),
  }));
  const labels = svgElement(
    'g',
    {
      'pointer-events': 'none',
      'font-family': 'system-ui,sans-serif',
      'font-size': 9,
      fill: 'var(--d-ink)',
    },
    svg,
  );
  const handles = [],
    handleMap = new Map();
  for (const side of sides)
    for (const control of controls) {
      const sideKey = sideName(side);
      const name =
        (side === 1 ? 'Outside' : 'Inside') +
        ' ' +
        control.label.toLowerCase() +
        ' width';
      const circle = svgElement(
        'circle',
        {
          r: 6,
          fill: 'var(--panel)',
          stroke: 'var(--d-focus)',
          'stroke-width': 2,
          tabindex: 0,
          role: 'slider',
          'aria-label': name,
          'aria-valuemin': 0,
          'aria-valuemax': widthLimit(p, control.key, side),
        },
        svg,
      );
      circle.style.cursor = 'grab';
      if (control.key === 'borderApex')
        circle.setAttribute(
          'aria-description',
          'Left and right change position. Up and down change width.',
        );
      svgElement('title', {}, circle).textContent =
        name +
        (control.key === 'borderApex'
          ? ' · drag along the road to move the apex'
          : '');
      const label =
        side === sides[0] || control.key === 'borderApex'
          ? svgElement(
              'text',
              {
                'text-anchor': 'middle',
                stroke: 'var(--d-paper)',
                'stroke-width': 2,
                'paint-order': 'stroke',
              },
              labels,
            )
          : null;
      if (label)
        label.textContent =
          control.key === 'borderApex' && sides.length === 2
            ? side > 0
              ? 'Outside apex'
              : 'Inside apex'
            : control.label;
      const h = { ...control, side, sideKey, circle, label };
      handles.push(h);
      handleMap.set(circle, h);
    }
  for (const side of sides)
    for (const end of ['start', 'finish']) {
      const sideKey = sideName(side),
        name = (side > 0 ? 'Outside' : 'Inside') + ' ' + end + ' tip';
      const circle = svgElement(
        'circle',
        {
          r: 6,
          fill: 'var(--d-paper)',
          stroke: 'var(--d-focus)',
          'stroke-width': 2,
          tabindex: 0,
          role: 'slider',
          'aria-label': name,
          'aria-valuemin': 0,
          'aria-valuemax': lengths[sideKey],
        },
        svg,
      );
      circle.style.cursor = 'grab';
      svgElement('title', {}, circle).textContent =
        name + ' · drag along the road';
      const h = {
        side,
        sideKey,
        end,
        circle,
        station: () => p.borderEnds?.[sideKey]?.[end]?.at,
      };
      handles.push(h);
      handleMap.set(circle, h);
    }
  const caption = svgElement(
    'text',
    {
      x: chartWidth / 2,
      y: chartHeight - 4,
      fill: 'var(--d-muted)',
      'font-family': 'system-ui,sans-serif',
      'font-size': 9,
      'text-anchor': 'middle',
    },
    svg,
  );
  caption.textContent = !sides.length
    ? 'Choose a border side to set widths'
    : p.kind === 'import'
      ? 'Straightened profile · drag points to shape border'
      : 'Drag points to shape the border';
  let transform, drag;
  const roadStations = Array.from({ length: 65 }, (_, i) => i / 64);
  const edge = (side, stations) =>
    stations.map((t) => section(p, t, (side * p.width) / 2));
  const roadLoop = [
    ...edge(1, roadStations),
    ...edge(-1, roadStations).reverse(),
  ];
  function redraw(fit) {
    const shapes = new Map();
    const strips = borders.map(({ side }) => {
      const sideKey = sideName(side);
      const baseStations = [
        ...new Set([...roadStations, apexPositionFor(p, sideKey)]),
      ].sort((a, b) => a - b);
      const path = {
        stations: baseStations,
        point: (t, o) => section(p, t, o),
        edgeLength: () => lengths[sideKey] ?? p.length,
      };
      let shape;
      try {
        shape = borderEndProfile(path, p, sideKey);
      } catch {
        return [];
      } // The live status explains when the ends do not fit.
      shapes.set(sideKey, shape);
      const stations = shape.stations;
      const free = stations.map((t) =>
        section(p, t, side * (p.width / 2 + shape.widthAt(t))),
      );
      return [...edge(side, stations), ...free.reverse()];
    });
    if (fit) {
      const all = roadLoop.concat(...strips),
        xs = all.map((q) => q[0]),
        ys = all.map((q) => q[1]);
      const left = Math.min(...xs),
        right = Math.max(...xs),
        bottom = Math.min(...ys),
        top = Math.max(...ys);
      // Keep the opposite handle in place while the new outline still fits.
      if (
        !transform ||
        transform.x + left * transform.s < 12 ||
        transform.x + right * transform.s > chartWidth - 12 ||
        transform.y - top * transform.s < 12 ||
        transform.y - bottom * transform.s > chartHeight - 20
      ) {
        const s = Math.min(
          (chartWidth - 54) / Math.max(right - left, 1),
          (chartHeight - 48) / Math.max(top - bottom, 1),
        );
        transform = {
          s,
          x: chartWidth / 2 - (s * (left + right)) / 2,
          y: (chartHeight - 12) / 2 + (s * (bottom + top)) / 2,
        };
      }
    }
    const screen = ([x, y]) => [
      transform.x + x * transform.s,
      transform.y - y * transform.s,
    ];
    const path = (loop) =>
      loop.length
        ? 'M' +
          loop.map((q) => screen(q).map(rounded).join(',')).join('L') +
          'Z'
        : '';
    road.setAttribute('d', path(roadLoop));
    borders.forEach((b, i) => b.element.setAttribute('d', path(strips[i])));
    for (const h of handles) {
      const t = h.station(p, h.sideKey);
      const shape = shapes.get(h.sideKey);
      const tipAtEnd =
        h.key === 'borderEntry'
          ? 'start'
          : h.key === 'borderExit'
            ? 'finish'
            : null;
      const visible =
        Number.isFinite(t) &&
        shape &&
        t >= shape.start &&
        t <= shape.finish &&
        !(tipAtEnd && p.borderEnds?.[h.sideKey]?.[tipAtEnd]);
      h.circle.style.display = visible ? '' : 'none';
      if (h.label) h.label.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const width = h.end ? 0 : shape.widthAt(t),
        [x, y] = screen(section(p, t, h.side * (p.width / 2 + width)));
      h.circle.setAttribute('cx', x);
      h.circle.setAttribute('cy', y);
      if (h.end) {
        const distance = rounded(t * lengths[h.sideKey]);
        h.circle.setAttribute('aria-valuenow', distance);
        h.circle.setAttribute('aria-valuetext', distance + (p.special?.type === 'diamond' ? '% along the arm' : ' mm from start'));
        continue;
      }
      h.circle.setAttribute('aria-valuenow', width);
      h.circle.setAttribute(
        'aria-valuetext',
        width +
          ' mm' +
          (h.key === 'borderApex'
            ? ' at ' + Number((t * 100).toFixed(4)) + '%'
            : ''),
      );
      if (h.label) {
        h.label.setAttribute('x', clamp(x, 16, chartWidth - 16));
        h.label.setAttribute(
          'y',
          clamp(y + (h.side === 1 ? -10 : 15), 10, chartHeight - 15),
        );
      }
    }
  }
  function local(event) {
    const pos = svg.createSVGPoint();
    pos.x = event.clientX;
    pos.y = event.clientY;
    const q = pos.matrixTransform(svg.getScreenCTM().inverse());
    return [
      (q.x - transform.x) / transform.s,
      (transform.y - q.y) / transform.s,
    ];
  }
  function change(h, delta) {
    const isApex = h.key === 'borderApex';
    const widthKey = isApex ? h.sideKey + 'ApexWidth' : h.key;
    const width = delta[widthKey];
    const positionKey = h.sideKey + 'ApexPercent';
    const percent = delta[positionKey];
    const changed = {};
    if (width !== undefined && widthAtHandle(p, h.key, h.sideKey) !== width) {
      p[widthKey] = width;
      changed[widthKey] = width;
    }
    if (
      percent !== undefined &&
      apexPositionFor(p, h.sideKey) !== percent / 100
    ) {
      p[h.sideKey + 'ApexPosition'] = percent / 100;
      changed[positionKey] = percent;
    }
    if (!Object.keys(changed).length) return;
    redraw(false);
    onChange(changed);
  }
  function moveTip(h, t) {
    const total = lengths[h.sideKey];
    if (!(total > 0)) return;
    const distance = clamp(rounded(t * total), 0, total);
    p.borderEnds[h.sideKey][h.end].at = distance / total;
    redraw(false);
    onChange({
      [endFieldKey(h.sideKey, h.end) + 'Distance']: Number(distance.toFixed(6)),
    });
  }
  svg.addEventListener('pointerdown', (event) => {
    const h = handleMap.get(event.target);
    if (!h || drag || event.button !== 0) return;
    const at = local(event),
      point = section(
        p,
        h.station(p, h.sideKey),
        h.side * (p.width / 2 + (h.end ? 0 : widthAtHandle(p, h.key, h.sideKey))),
      );
    drag = {
      h,
      id: event.pointerId,
      dx: point[0] - at[0],
      dy: point[1] - at[1],
    };
    svg.setPointerCapture(event.pointerId);
    h.circle.focus();
    event.preventDefault();
  });
  svg.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const [x, y] = local(event),
      h = drag.h;
    if (h.end) {
      moveTip(h, stationFor(p,x+drag.dx,y+drag.dy));
    } else change(h, borderDrag(p, h.key, h.side, [x + drag.dx, y + drag.dy]));
  });
  const endDrag = (event) => {
    if (drag?.id === event.pointerId) {
      drag = null;
      redraw(true);
    }
  };
  svg.addEventListener('lostpointercapture', endDrag);
  svg.addEventListener('keydown', (event) => {
    const h = handleMap.get(event.target);
    if (
      !h ||
      !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
    )
      return;
    const horizontal = ['ArrowLeft', 'ArrowRight'].includes(event.key);
    if (h.end) {
      if (!horizontal) return;
      event.preventDefault();
      moveTip(h,h.station()+(event.key === 'ArrowLeft' ? -1 : 1)/lengths[h.sideKey]);
      return;
    }
    if (horizontal && h.key !== 'borderApex') return;
    event.preventDefault();
    if (horizontal) {
      const t = h.station(p, h.sideKey);
      const percent = clamp(
        100 * t + (event.key === 'ArrowLeft' ? -1 : 1),
        1,
        99,
      );
      change(h, {
        [h.sideKey + 'ApexPercent']: Number(percent.toPrecision(12)),
      });
    } else {
      const width =
        widthAtHandle(p, h.key, h.sideKey) +
        (event.key === 'ArrowDown' ? -1 : 1);
      const key = h.key === 'borderApex' ? h.sideKey + 'ApexWidth' : h.key;
      change(h, { [key]: clamp(width, 0, widthLimit(p, h.key, h.side)) });
    }
    redraw(true);
  });
  redraw(true);
  const remove = () => svg.remove();
  remove.update = (values) => {
    if (drag) return;
    p.borderEnds = structuredClone(values.borderEnds);
    for (const key of ['borderEntry', 'borderExit']) {
      if (Number.isFinite(values[key])) p[key] = values[key];
    }
    for (const side of sides.map(sideName)) {
      p[side + 'ApexWidth'] = apexWidthFor(values, side);
      p[side + 'ApexPosition'] = apexPositionFor(values, side);
    }
    redraw(true);
  };
  return remove;
}
