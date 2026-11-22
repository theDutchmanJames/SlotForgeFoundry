import { laneOffsetAt } from './lane-adjustment.js';
import { nativeTrackPoint } from './track.js';
import { specialPreview } from './special-pieces.js';
import { startingGridLayout } from './geometry/starting-grid.js';

const digits = (n) => Number(n.toFixed(3));
const pointList = (points) =>
  points.map(([x, y]) => digits(x) + ',' + digits(-y)).join(' ');

export function piecePreview(p) {
  if (p.special) return specialFootprint(p);
  const steps = Math.max(
    1,
    p.kind === 'curve' ? Math.ceil(p.angle) : 1,
    p.laneAdjustment ? 120 : 1,
  );
  const sample = (offset) =>
    Array.from({ length: steps + 1 }, (_, i) => {
      const t = i / steps;
      return nativeTrackPoint(p, t, offset(t));
    });
  const outline = [
    ...sample(() => -p.width / 2),
    ...sample(() => p.width / 2).reverse(),
  ];
  const xs = outline.map((q) => q[0]),
    ys = outline.map((q) => -q[1]);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  const width = Math.max(...xs) - x,
    height = Math.max(...ys) - y;
  const pad = Math.max(width, height) * 0.1;
  const lengths = [];
  const marks = Array.from({ length: p.lanes }, (_, lane) => {
    const path = sample((t) => laneOffsetAt(p, lane, t));
    const length = p.laneAdjustment
      ? path
          .slice(1)
          .reduce(
            (sum, q, i) =>
              sum + Math.hypot(q[0] - path[i][0], q[1] - path[i][1]),
            0,
          )
      : p.kind === 'curve'
        ? ((p.radius + laneOffsetAt(p, lane, 0)) * p.angle * Math.PI) / 180
        : p.length;
    lengths.push(length);
    return (
      '<polyline class="ct-lane" fill="none" vector-effect="non-scaling-stroke" points="' +
      pointList(path) +
      '"/>'
    );
  });
  const grid = p.startingGrid ? startingGridLayout(p).paint : [];
  return {
    viewBox: [x - pad, y - pad, width + 2 * pad, height + 2 * pad].join(' '),
    marks:
      '<polygon class="ct-road" vector-effect="non-scaling-stroke" points="' +
      pointList(outline) +
      '"/>' +
      grid.map(loop => '<polygon class="ct-starting-grid" points="' + pointList(loop) + '"/>').join('') +
      marks.join(''),
    lengths,
  };
}

function specialFootprint(p) {
  const {
    outlines,
    lanes,
    details = [],
    borders = [],
    breaks = [],
    turnouts = [],
    pitWhiteLines = [],
    pitGrid,
  } = specialPreview(p);
  const paths = [...outlines, ...borders, ...lanes, ...details];
  let xmin = Infinity,
    xmax = -Infinity,
    ymin = Infinity,
    ymax = -Infinity;
  for (const path of paths)
    for (const [x, y] of path) {
      xmin = Math.min(xmin, x);
      xmax = Math.max(xmax, x);
      ymin = Math.min(ymin, -y);
      ymax = Math.max(ymax, -y);
    }
  const w = xmax - xmin,
    h = ymax - ymin,
    margin = Math.max(w, h) * 0.08;
  const mark = (tag, cls, path) =>
    '<' +
    tag +
    ' class="' +
    cls +
    '" ' +
    (tag === 'polyline' ? 'fill="none" ' : '') +
    'vector-effect="non-scaling-stroke" points="' +
    pointList(path) +
    '"/>';
  const distance = (points) =>
    points
      .slice(1)
      .reduce(
        (sum, p, i) =>
          sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]),
        0,
      );
  return {
    viewBox: [
      xmin - margin,
      ymin - margin,
      w + margin * 2,
      h + margin * 2,
    ].join(' '),
    marks:
      borders.map((path) => mark('polygon', 'ct-border', path)).join('') +
      outlines.map((path) => mark('polygon', 'ct-road', path)).join('') +
      pitWhiteLines.map((path) => mark('polygon', 'ct-pit-divider', path)).join('') +
      (pitGrid?.paint ?? []).map((path) => mark('polygon', 'ct-starting-grid', path)).join('') +
      lanes.map((path) => mark('polyline', 'ct-lane', path)).join('') +
      details.slice(turnouts.length).map((path) => mark('polyline', 'ct-detail', path)).join('') +
      turnouts.map(({ outline, guide }) =>
        mark('polygon', 'ct-flipper', outline) + mark('polyline', 'ct-flipper-route', guide),
      ).join('') +
      breaks
        .map(
          ({ x, y, radius }) =>
            '<circle class="ct-break" cx="' +
            digits(x) +
            '" cy="' +
            digits(-y) +
            '" r="' +
            digits(radius) +
            '"/>',
        )
        .join(''),
    lengths: lanes.map(distance),
  };
}

export function matchingFamilyPreview(r1, width, selected) {
  const count = Math.max(4, selected);
  const format = (n) => Number(n.toFixed(2)).toString();
  const outline = [],
    rows = [];
  for (let i = 1; i <= count; i++) {
    const inner = r1 + (i - 1) * width,
      outer = inner + width;
    outline.push(
      '<path class="' +
        (i === selected ? 'chosen' : '') +
        '" d="M0 ' +
        -outer +
        'A' +
        outer +
        ' ' +
        outer +
        ' 0 0 1 ' +
        outer +
        ' 0H' +
        inner +
        'A' +
        inner +
        ' ' +
        inner +
        ' 0 0 0 0 ' +
        -inner +
        'Z"/>',
    );
    rows.push(
      '<tr' +
        (i === selected ? ' class="chosen"' : '') +
        '><th scope="row">R' +
        i +
        '</th><td>' +
        format(inner) +
        '</td><td>' +
        format(outer) +
        '</td></tr>',
    );
  }
  const extent = r1 + count * width;
  return {
    diagram:
      '<svg aria-label="Nested road edges, R' +
      selected +
      ' selected" role="img" viewBox="' +
      [-extent * 0.03, -extent * 1.03, extent * 1.06, extent * 1.06].join(' ') +
      '">' +
      outline.join('') +
      '</svg>',
    table:
      '<table><thead><tr><th>Radius</th><th>Inner · mm</th><th>Outer · mm</th></tr></thead><tbody>' +
      rows.join('') +
      '</tbody></table>',
  };
}
