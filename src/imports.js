import { distance } from './drawings/curves.js';
import { readSvg } from './drawings/svg.js';
import { readDxf } from './drawings/dxf.js';

const joinTolerance = 0.00001; // Circuit uses this tolerance for matching exported endpoints.
const normalizedLayer = (value) =>
  String(value || '0')
    .trim()
    .toUpperCase();

function clean(path) {
  let points = [];
  for (const p of path.points) {
    if (!p.every(Number.isFinite))
      throw Error('Drawing contains an invalid coordinate.');
    if (!points.length || distance(points.at(-1), p) > 1e-9) points.push(p);
  }
  let closed = path.closed;
  if (
    points.length > 2 &&
    distance(points[0], points.at(-1)) <= joinTolerance
  ) {
    points.pop();
    closed = true;
  }
  return { layer: normalizedLayer(path.layer), points, closed };
}

// Join coincident open fragments only at unambiguous two-way junctions.
// R12 drawings often encode one closed outline as independent LINEs and ARCs.
export function joinDrawingPaths(paths) {
  const finished = paths.filter((p) => p.closed && p.points.length > 2);
  const open = paths.filter((p) => !p.closed && p.points.length > 1);
  const cells = new Map();
  function node(point) {
    const x = Math.floor(point[0] / joinTolerance),
      y = Math.floor(point[1] / joinTolerance);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const nodes = cells.get(x + dx + ',' + (y + dy));
        const found = nodes?.find(
          (n) => distance(point, n.point) <= joinTolerance,
        );
        if (found) return found;
      }
    const key = x + ',' + y,
      n = { point, links: [] };
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(n);
    return n;
  }
  const ends = open.map((p, i) => {
    const a = node(p.points[0]),
      b = node(p.points.at(-1));
    a.links.push(i);
    b.links.push(i);
    return [a, b];
  });
  const used = new Set();
  function follow(first, start) {
    let i = first,
      at = start;
    const points = [];
    while (!used.has(i)) {
      used.add(i);
      const forward = ends[i][0] === at,
        p = open[i].points;
      for (let j = points.length ? 1 : 0; j < p.length; j++)
        points.push(p[forward ? j : p.length - j - 1]);
      at = ends[i][forward ? 1 : 0];
      if (at === start || at.links.length !== 2) break;
      i = at.links.find((next) => !used.has(next));
      if (i === undefined) break;
    }
    finished.push(
      clean({ layer: open[first].layer, points, closed: at === start }),
    );
  }
  open.forEach((_, i) => {
    const edge = ends[i].find((n) => n.links.length !== 2);
    if (edge && !used.has(i)) follow(i, edge);
  });
  open.forEach((_, i) => {
    if (!used.has(i)) follow(i, ends[i][0]);
  });
  return finished;
}

// Nearest point of a polyline to p, with its distance.
function nearestOnLine(p, line) {
  let best = Infinity,
    at = line[0];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i],
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      l2 = dx * dx + dy * dy;
    const t = l2
      ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
      : 0;
    const q = [a[0] + t * dx, a[1] + t * dy],
      d = distance(p, q);
    if (d < best) {
      best = d;
      at = q;
    }
  }
  return { d: best, q: at };
}

// Evenly spaced stations along a lane, each with its unit tangent.
function laneStations(lane, count) {
  const lengths = [0];
  for (let i = 1; i < lane.length; i++)
    lengths.push(lengths[i - 1] + distance(lane[i - 1], lane[i]));
  const total = lengths.at(-1);
  if (!(total > 0)) return [];
  const stations = [];
  for (let k = 0; k < count; k++) {
    const target = ((k + 0.5) / count) * total;
    let i = 1;
    while (i < lane.length - 1 && lengths[i] < target) i++;
    const a = lane[i - 1],
      b = lane[i],
      span = lengths[i] - lengths[i - 1];
    if (!(span > 0)) continue;
    const t = (target - lengths[i - 1]) / span;
    stations.push({
      p: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])],
      t: [(b[0] - a[0]) / span, (b[1] - a[1]) / span],
    });
  }
  return stations;
}

const widthTolerance = 0.02;
const agree = (values) =>
  values.every((v) => Math.abs(v - values[0]) < widthTolerance);

// Measures slot and conductor widths across each lane at stations along its
// length, so closed loops work as well as open pieces. Only edges clearly
// belonging to the lane count: at a crossing or where lanes run close, the
// station is skipped. Every usable station must agree; otherwise the current
// physical profile is kept and the reason is reported.
function inferWidths({ lanes, slotEdges, conductorEdges }) {
  const none = (slot, conductor = 'missing') => ({
    widths: {},
    slot,
    conductor,
  });
  if (!lanes.length) return none('missing');
  if (!slotEdges.length)
    return none('missing', conductorEdges.length ? 'needs-slot' : 'missing');
  if (lanes.length > 32 || slotEdges.length > 128 || conductorEdges.length > 256)
    return none('too-many');
  const samples = [];
  lanes.forEach((lane, index) => {
    for (const { p, t } of laneStations(lane, 12)) {
      let reach = 60;
      lanes.forEach((other, j) => {
        if (j !== index) reach = Math.min(reach, nearestOnLine(p, other).d * 0.45);
      });
      const sides = (edges) => {
        const out = [[], []];
        for (const edge of edges) {
          const { d, q } = nearestOnLine(p, edge);
          if (!(d > 0 && d < reach)) continue;
          const dx = q[0] - p[0],
            dy = q[1] - p[1];
          if (Math.abs(dx * t[0] + dy * t[1]) >= Math.max(0.001, d * 0.1)) continue;
          out[dx * t[1] - dy * t[0] > 0 ? 1 : 0].push(d);
        }
        return out.map((v) => v.sort((a, b) => a - b));
      };
      const [left, right] = sides(slotEdges);
      if (!left.length || !right.length) continue;
      const sample = { slotWidth: left[0] + right[0], centred: Math.abs(left[0] - right[0]) <= widthTolerance };
      const [a, b] = sides(conductorEdges);
      if (
        a.length > 1 &&
        b.length > 1 &&
        Math.abs(a[0] - b[0]) < widthTolerance &&
        Math.abs(a[1] - b[1]) < widthTolerance
      ) {
        const near = (a[0] + b[0]) / 2;
        sample.braidWidth = (a[1] + b[1]) / 2 - near;
        sample.braidGap = near - sample.slotWidth / 2;
      }
      samples.push(sample);
    }
  });
  if (!samples.length) return none('unmeasured', conductorEdges.length ? 'unmeasured' : 'missing');
  if (!samples.every((s) => s.centred) || !agree(samples.map((s) => s.slotWidth)))
    return none('inconsistent', conductorEdges.length ? 'unmeasured' : 'missing');
  // Flattened arcs put chords a fraction of a micron inside the curve.
  const round = (v) => Number(v.toFixed(2));
  const widths = { slotWidth: round(samples[0].slotWidth) };
  let conductor = conductorEdges.length ? 'unmeasured' : 'missing';
  const measured = samples.filter((s) => s.braidWidth !== undefined);
  if (conductorEdges.length && measured.length) {
    const ok =
      measured.length * 2 >= samples.length &&
      measured.every((s) => s.braidWidth > 0 && s.braidGap >= -joinTolerance) &&
      agree(measured.map((s) => s.braidWidth)) &&
      agree(measured.map((s) => s.braidGap));
    if (ok) {
      widths.braidWidth = round(measured[0].braidWidth);
      widths.braidGap = round(Math.max(0, measured[0].braidGap));
      conductor = 'inferred';
    } else conductor = 'inconsistent';
  }
  return { widths, slot: 'inferred', conductor };
}

/**
 * Returns application geometry in millimetres, Y-up. Shape/outlines/table
 * polygons are implicitly closed; closed slot or conductor lines repeat the
 * first vertex. Reference layers (e.g. scale bars) never become geometry.
 */
function readDrawingLayers(text, extension) {
  if (typeof text !== 'string' || !text.trim())
    throw Error('Drawing is empty.');
  if (text.length > 16000000)
    throw Error(
      'Drawing is too large. Export a smaller section or fewer layers.',
    );
  const ext = String(extension).toLowerCase().split('.').pop();
  text = text.replace(/^\uFEFF/, '');
  if (ext !== 'svg' && ext !== 'dxf')
    throw Error('Choose an SVG or ASCII DXF drawing.');
  const input = ext === 'svg' ? readSvg(text) : readDxf(text);
  const circuit = {
    found: !!input.circuit,
    options: input.circuitOptions || null,
    meta: input.circuitMeta || null,
  };
  const byLayer = new Map();
  for (const raw of input.paths) {
    const p = clean(raw);
    if (p.points.length < 2) continue;
    if (!byLayer.has(p.layer)) byLayer.set(p.layer, []);
    byLayer.get(p.layer).push(p);
  }
  return { byLayer, warnings: input.warnings, circuit };
}

// The universal sketch editor also accepts open and closed artwork on layers
// whose names have a special meaning only in Track builder.
export function readSketchPaths(text, extension) {
  const { byLayer, warnings } = readDrawingLayers(text, extension);
  const paths = [];
  for (const fragments of byLayer.values())
    for (const path of joinDrawingPaths(fragments)) paths.push(path);
  if (!paths.length)
    throw Error(['No usable artwork in this drawing.', ...warnings].join(' '));
  return { paths, warnings: [...warnings] };
}

export function parseDrawing(text, extension) {
  const { byLayer, warnings, circuit } = readDrawingLayers(text, extension);
  const result = {
    shapes: [],
    outlines: [],
    lanes: [],
    slotEdges: [],
    braidEdges: [],
    tapeEdges: [],
    tables: [],
    openPaths: [],
    warnings: [],
    units: 'mm',
  };
  for (const [layer, fragments] of byLayer) {
    if (['SCALE_CHECK', 'TIMING_LINE', 'STOCK_SHEET'].includes(layer)) continue;
    for (const p of joinDrawingPaths(fragments)) {
      if (p.points.length < (p.closed ? 3 : 2)) continue;
      const line = p.closed ? [...p.points, p.points[0]] : p.points;
      switch (layer) {
        case 'SLOT_CENTRES':
          result.lanes.push(line);
          break;
        case 'SLOT_EDGES':
          result.slotEdges.push(line);
          break;
        case 'BRAID_EDGES':
          result.braidEdges.push(line);
          break;
        case 'TAPE_EDGES':
          result.tapeEdges.push(line);
          break;
        case 'TABLE':
          if (p.closed) result.tables.push(p.points);
          else warnings.add('The TABLE layer contains an open outline.');
          break;
        case 'SURFACE_EDGES':
          if (p.closed) {
            result.outlines.push(p.points);
            result.shapes.push(p.points);
          } else
            warnings.add(
              'Open road outline. Close the SURFACE_EDGES contour in Circuit.',
            );
          break;
        default:
          if (p.closed) result.shapes.push(p.points);
          else result.openPaths.push(p.points);
      }
    }
  }
  if (result.openPaths.length)
    warnings.add(
      'Open artwork paths have no filled area. Close or outline the strokes to extrude them.',
    );
  if (
    ![
      result.shapes,
      result.lanes,
      result.slotEdges,
      result.braidEdges,
      result.tapeEdges,
      result.tables,
      result.openPaths,
    ].some((a) => a.length)
  ) {
    throw Error(
      ['No usable 2D geometry in this drawing.', ...warnings].join(' '),
    );
  }
  // Braid lies in a recess; copper tape is stuck onto the road surface.
  const conductorType = result.braidEdges.length
    ? 'braid'
    : result.tapeEdges.length
      ? 'tape'
      : null;
  if (result.braidEdges.length && result.tapeEdges.length)
    warnings.add(
      'The drawing has both braid and copper tape edges. Foundry used the braid edges for the conductor recesses.',
    );
  const inferred = inferWidths({
    lanes: result.lanes,
    slotEdges: result.slotEdges,
    conductorEdges: conductorType === 'tape' ? result.tapeEdges : result.braidEdges,
  });
  result.inferredWidths = inferred.widths;
  if (conductorType === 'tape' && inferred.conductor === 'inferred')
    // Tape needs its measured position for reference but no recess.
    result.inferredWidths.braidDepth = 0;
  result.profileSource = {
    circuit: circuit.found,
    exportOptions: circuit.options,
    slot: inferred.slot,
    conductor: inferred.conductor,
    conductorType,
  };
  applyCircuitProfile(result, circuit.meta, warnings);
  const heights = circuitHeights(circuit.meta);
  if (heights) result.heights = heights;
  result.warnings = [...warnings];
  return result;
}

const positive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const nonNegative = (v) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;

// Circuit's metadata names the routed profile it was designed with. Those
// exact values beat measured edges; a disagreement means the drawing was
// edited after export, so it is reported rather than silently resolved.
function applyCircuitProfile(result, meta, warnings) {
  const profiles = Array.isArray(meta?.routedProfiles)
    ? meta.routedProfiles.filter((p) => p && typeof p === 'object')
    : [];
  if (!profiles.length) return;
  if (profiles.length > 1) {
    warnings.add(
      'This Circuit layout uses ' +
        profiles.length +
        ' different routed profiles. Foundry imports one profile per piece, so it used the measured edges or kept the current sizes. Check Cross-section.',
    );
    return;
  }
  const p = profiles[0];
  const tape = p.conductor === 'tape';
  const fromMeta = {};
  if (positive(p.roadWidthMm)) fromMeta.width = p.roadWidthMm;
  if (positive(p.slotWidthMm)) fromMeta.slotWidth = p.slotWidthMm;
  if (positive(p.slotDepthMm)) fromMeta.slotDepth = p.slotDepthMm;
  if (positive(p.conductorWidthMm)) fromMeta.braidWidth = p.conductorWidthMm;
  if (nonNegative(p.conductorGapMm)) fromMeta.braidGap = p.conductorGapMm;
  if (tape) fromMeta.braidDepth = 0;
  else if (nonNegative(p.recessDepthMm)) fromMeta.braidDepth = p.recessDepthMm;
  if (!Object.keys(fromMeta).length) return;
  const measured = result.inferredWidths;
  const differs = ['slotWidth', 'braidWidth', 'braidGap'].filter(
    (k) =>
      measured[k] !== undefined &&
      fromMeta[k] !== undefined &&
      Math.abs(measured[k] - fromMeta[k]) >= 0.02,
  );
  if (differs.length)
    warnings.add(
      'The drawn edges differ from the Circuit profile it was exported with (' +
        differs.join(', ') +
        '). Foundry used the Circuit profile.',
    );
  result.inferredWidths = { ...measured, ...fromMeta };
  const source = result.profileSource;
  if (fromMeta.slotWidth !== undefined) source.slot = 'metadata';
  if (fromMeta.braidWidth !== undefined) {
    source.conductor = 'metadata';
    source.conductorType = tape ? 'tape' : 'braid';
  }
}

// Spot heights along the slot centrelines, converted to Foundry's Y-up world.
function circuitHeights(meta) {
  if (!Array.isArray(meta?.heights) || !meta.heights.length) return null;
  if (meta.heights.length > 20000) return null;
  const out = [];
  for (const h of meta.heights)
    if (
      Array.isArray(h) &&
      h.length >= 3 &&
      h.slice(0, 3).every((v) => typeof v === 'number' && Number.isFinite(v))
    )
      out.push([h[0], -h[1], h[2]]);
  return out.length ? out : null;
}
