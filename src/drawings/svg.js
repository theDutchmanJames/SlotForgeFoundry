import { DOMParser } from '@xmldom/xmldom';
import svgpath from 'svgpath';
import { flattenBezier, pointLimit, svgArc } from './curves.js';

const pxMm = 25.4 / 96;
const numberPattern = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const unitMm = {
  px: pxMm,
  mm: 1,
  cm: 10,
  in: 25.4,
  pt: 25.4 / 72,
  pc: 25.4 / 6,
  q: 0.25,
};
const ignored = new Set([
  'defs',
  'metadata',
  'title',
  'desc',
  'style',
  'script',
  'clipPath',
  'mask',
  'marker',
  'pattern',
  'symbol',
]);
const knownLayer =
  /^(SLOT_CENTRES|SLOT_EDGES|BRAID_EDGES|TAPE_EDGES|SURFACE_EDGES|TABLE|SCALE_CHECK|TIMING_LINE|STOCK_SHEET)$/i;

const circuitCoordinates = 'builder-world-positive-y-down';
// Page reductions Circuit offers for its compact SVG export.
const circuitScales = [2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

// A Circuit SVG re-saved in another editor can lose its <metadata> while the
// paths still hold full-size millimetres. Recognise it from Circuit's own
// title/description or its layer names on a reduced page, and keep the drawing
// at full size instead of importing it at 1:N.
function strippedCircuitPage(root) {
  const text = (tag) =>
    root.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
  const title = text('title'),
    desc = text('desc');
  const byText =
    /Coordinates remain full-size millimetres/i.test(desc) ||
    /routed construction/i.test(title) ||
    /^Millimetres; 1 SVG user unit = 1 mm\..*Routed construction paths/i.test(
      desc,
    );
  let byLayers = false,
    denominator = 1;
  const groups = [...root.getElementsByTagName('g')];
  const circuitLayers = groups.filter((g) =>
    knownLayer.test(g.getAttribute('id') || ''),
  ).length;
  const boxText = root.getAttribute('viewBox'),
    widthText = root.getAttribute('width');
  if (boxText && widthText && /mm\s*$/i.test(widthText)) {
    const box = (boxText.match(numberPattern) || []).map(Number);
    const width = parseFloat(widthText);
    if (box.length === 4 && box[2] > 0 && width > 0) {
      const ratio = box[2] / width;
      denominator =
        circuitScales.find((n) => Math.abs(ratio / n - 1) < 1e-4) || 1;
      byLayers = circuitLayers >= 1 && denominator > 1;
    }
  }
  if (!byText && !byLayers) return null;
  const scale = /scale 1:(\d+)/i.exec(title + ' ' + desc)?.[1];
  const reduced = Number(scale) > 1 ? Number(scale) : denominator;
  return {
    transform: 'scale(1 -1)',
    circuit: true,
    circuitOptions: null,
    warning:
      'This Circuit drawing has lost its SlotForge metadata, probably after being saved in another editor.' +
      (reduced > 1
        ? ' Its page was reduced to 1:' + reduced + '; Foundry restored full size.'
        : '') +
      ' Check the imported dimensions, or export again from Circuit.',
  };
}

function numbers(input) {
  const value = input || '';
  if (value.replace(numberPattern, '').replace(/[\s,]/g, ''))
    throw Error('Invalid number list in SVG geometry.');
  return (value.match(numberPattern) || []).map(Number);
}

function lengthMm(value) {
  const match = value
    .trim()
    .match(
      /^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(px|mm|cm|in|pt|pc|q)?$/i,
    );
  if (!match)
    throw Error(
      'SVG lengths must be absolute. Set physical dimensions or convert the shape to paths.',
    );
  return Number(match[1]) * (unitMm[match[2]?.toLowerCase()] || pxMm);
}

function viewport(root) {
  const metadata = root.getElementsByTagName('metadata')[0]?.textContent;
  let meta;
  if (metadata?.trim().startsWith('{')) {
    try {
      meta = JSON.parse(metadata);
    } catch {
      /* Non-Circuit metadata has no effect on geometry. */
    }
  }
  if (meta?.format === 'slotforge.cad') {
    if (meta.version !== 1 || meta.units !== 'mm')
      throw Error('Unsupported Circuit CAD schema or drawing units.');
    if (
      meta.coordinates !== undefined &&
      meta.coordinates !== circuitCoordinates
    )
      throw Error(
        'Unsupported Circuit coordinate convention: ' +
          String(meta.coordinates).slice(0, 60) +
          '. Update Foundry or re-export from Circuit.',
      );
    // Circuit stores full-size world coordinates even when its SVG page is reduced.
    return {
      transform: 'scale(1 -1)',
      circuit: true,
      circuitOptions:
        meta.options && typeof meta.options === 'object' ? meta.options : null,
      circuitMeta: meta,
    };
  }
  const recovered = strippedCircuitPage(root);
  if (recovered) return recovered;
  const boxText = root.getAttribute('viewBox');
  if (!boxText)
    return { transform: 'scale(' + pxMm + ' ' + -pxMm + ')', circuit: false };
  const box = numbers(boxText);
  if (box.length !== 4 || !(box[2] > 0 && box[3] > 0))
    throw Error('Invalid SVG viewBox.');
  const dimension = (key) => {
    const value = root.getAttribute(key);
    if (!value) return undefined;
    if (value.trim().endsWith('%'))
      throw Error(
        'SVG page uses percentage dimensions. Set an absolute width and height before import.',
      );
    return lengthMm(value);
  };
  let width = dimension('width'),
    height = dimension('height');
  width ??= height ? (height * box[2]) / box[3] : box[2] * pxMm;
  height ??= (width * box[3]) / box[2];
  if (!(width > 0 && height > 0)) throw Error('SVG page has no physical size.');
  let sx = width / box[2],
    sy = height / box[3];
  const aspect = root.getAttribute('preserveAspectRatio') || 'xMidYMid meet';
  let dx = 0,
    dy = 0;
  if (!aspect.includes('none')) {
    sx = sy = aspect.includes('slice') ? Math.max(sx, sy) : Math.min(sx, sy);
    dx =
      (width - box[2] * sx) *
      (aspect.includes('xMin') ? 0 : aspect.includes('xMax') ? 1 : 0.5);
    dy =
      (height - box[3] * sy) *
      (aspect.includes('YMin') ? 0 : aspect.includes('YMax') ? 1 : 0.5);
  }
  return {
    transform:
      'matrix(' +
      [sx, 0, 0, -sy, dx - box[0] * sx, box[1] * sy - dy].join(' ') +
      ')',
    circuit: false,
  };
}

function shapePath(el) {
  const tag = el.localName;
  const n = (attr) =>
    el.hasAttribute(attr) ? lengthMm(el.getAttribute(attr)) / pxMm : 0;
  if (tag === 'path') return el.getAttribute('d');
  if (tag === 'line')
    return 'M' + [n('x1'), n('y1')] + 'L' + [n('x2'), n('y2')];
  if (tag === 'polygon' || tag === 'polyline') {
    const xy = numbers(el.getAttribute('points'));
    if (xy.length % 2) throw Error('SVG polygon has an incomplete coordinate.');
    return xy.length >= 4
      ? 'M' + xy.join(' ') + (tag === 'polygon' ? 'Z' : '')
      : '';
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const x = n('cx'),
      y = n('cy');
    const rx = n(tag === 'circle' ? 'r' : 'rx'),
      ry = n(tag === 'circle' ? 'r' : 'ry');
    if (!(rx > 0 && ry > 0)) return '';
    const arc = 'A' + [rx, ry, 0, 0, 1] + ' ';
    return 'M' + [x + rx, y] + arc + [x - rx, y] + arc + [x + rx, y] + 'Z';
  }
  if (tag === 'rect') {
    const x = n('x'),
      y = n('y'),
      w = n('width'),
      h = n('height');
    if (!(w > 0 && h > 0)) return '';
    const rx = Math.min(w / 2, n(el.hasAttribute('rx') ? 'rx' : 'ry'));
    const ry = Math.min(h / 2, n(el.hasAttribute('ry') ? 'ry' : 'rx'));
    if (!(rx > 0 && ry > 0))
      return 'M' + [x, y] + 'h' + w + 'v' + h + 'h' + -w + 'Z';
    const arc = 'a' + [rx, ry, 0, 0, 1] + ' ';
    return (
      'M' +
      [x + rx, y] +
      'h' +
      (w - 2 * rx) +
      arc +
      [rx, ry] +
      'v' +
      (h - 2 * ry) +
      arc +
      [-rx, ry] +
      'h' +
      (2 * rx - w) +
      arc +
      [-rx, -ry] +
      'v' +
      (2 * ry - h) +
      arc +
      [rx, -ry] +
      'Z'
    );
  }
  return undefined;
}

function checkTransform(value) {
  const pattern = /(matrix|translate|rotate|scale|skewX|skewY)\s*\(([^()]*)\)/g;
  const arities = {
    matrix: [6],
    translate: [1, 2],
    rotate: [1, 3],
    scale: [1, 2],
    skewX: [1],
    skewY: [1],
  };
  const rest = value.replace(pattern, (_, name, args) => {
    if (!arities[name].includes(numbers(args).length))
      throw Error('Invalid SVG transform: ' + name);
    return '';
  });
  if (rest.replace(/[\s,]/g, ''))
    throw Error('Unsupported SVG transform: ' + value.slice(0, 60));
  return value;
}

function readPath(data, transforms, layer, store) {
  const path = svgpath(data);
  if (path.err) throw Error('Invalid SVG path: ' + path.err);
  path.abs().unshort().transform(transforms);
  let points = [];
  function add(p) {
    if (++store.pointCount > pointLimit)
      throw Error('Drawing exceeds the point limit. Import a smaller section.');
    points.push(p);
  }
  function finish(closed) {
    if (points.length > 1) store.paths.push({ layer, points, closed });
    points = [];
  }
  path.iterate((segment, _, x, y) => {
    const [cmd, a, b, c, d, e, f, g] = segment;
    if (cmd === 'M') {
      finish(false);
      add([a, b]);
      return;
    }
    if (cmd.toUpperCase() === 'Z') {
      finish(true);
      return;
    }
    if (!points.length) add([x, y]);
    switch (cmd) {
      case 'L':
        add([a, b]);
        break;
      case 'H':
        add([a, y]);
        break;
      case 'V':
        add([x, a]);
        break;
      case 'Q':
        flattenBezier(
          [
            [x, y],
            [a, b],
            [c, d],
          ],
          add,
        );
        break;
      case 'C':
        flattenBezier(
          [
            [x, y],
            [a, b],
            [c, d],
            [e, f],
          ],
          add,
        );
        break;
      case 'A': {
        const arc = svgArc([x, y], a, b, c, Number(d), Number(e), [f, g]);
        for (let i = 1; i < arc.length; i++) add(arc[i]);
        break;
      }
      default:
        throw Error('Unsupported SVG path command: ' + cmd);
    }
  });
  finish(false);
}

export function readSvg(text) {
  if (/<!ENTITY\b/i.test(text))
    throw Error(
      'SVG entity declarations are unsupported. Export plain SVG geometry.',
    );
  const doc = new DOMParser({
    onError(level, msg) {
      if (level !== 'warning') throw Error(msg);
    },
  }).parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (root?.localName !== 'svg')
    throw Error('File does not contain an SVG drawing.');
  const page = viewport(root);
  const store = {
    paths: [],
    pointCount: 0,
    warnings: new Set(page.warning ? [page.warning] : []),
    circuit: page.circuit,
    circuitOptions: page.circuitOptions || null,
    circuitMeta: page.circuitMeta || null,
  };
  function visit(el, transform, layer, depth = 0) {
    if (depth > 128) throw Error('SVG is too deeply nested.');
    if (ignored.has(el.localName)) return;
    const style = el.getAttribute('style') || '';
    if (
      el.getAttribute('display') === 'none' ||
      el.getAttribute('visibility') === 'hidden' ||
      /(?:display:\s*none|visibility:\s*hidden)/i.test(style)
    )
      return;
    if (
      el.hasAttribute('clip-path') ||
      el.hasAttribute('mask') ||
      /(?:clip-path|mask|transform)\s*:/.test(style)
    ) {
      throw Error(
        'Flatten SVG clipping, masks, or CSS transforms to plain paths before import.',
      );
    }
    if (el.hasAttribute('transform'))
      transform += ' ' + checkTransform(el.getAttribute('transform'));
    if (
      el.localName === 'g' &&
      (el.hasAttribute('id') || el.hasAttribute('inkscape:label'))
    ) {
      const id = el.getAttribute('id'),
        label = el.getAttribute('inkscape:label');
      const name = knownLayer.test(label) ? label : id || label;
      if (knownLayer.test(name) || !knownLayer.test(layer)) layer = name;
    }
    if (el.localName === 'g' || el === root) {
      for (let child = el.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1) visit(child, transform, layer, depth + 1);
      }
      return;
    }
    const data = shapePath(el);
    if (data === undefined) {
      store.warnings.add(
        'Skipped SVG element <' +
          el.localName +
          '>. Convert it to paths for import.',
      );
    } else if (data) readPath(data, transform, layer, store);
  }
  visit(root, page.transform, '0');
  return store;
}
