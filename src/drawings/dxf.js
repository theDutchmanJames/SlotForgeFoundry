import { distance, ellipsePoints, pointLimit, tau } from './curves.js';

const mmPerUnit = {
  1: 25.4,
  2: 304.8,
  3: 1609344,
  4: 1,
  5: 10,
  6: 1000,
  7: 1e6,
  8: 0.0000254,
  9: 0.0254,
  10: 914.4,
  11: 1e-7,
  12: 1e-6,
  13: 0.001,
  14: 100,
  15: 10000,
};
const supported = new Set([
  'LINE',
  'LWPOLYLINE',
  'POLYLINE',
  'VERTEX',
  'SEQEND',
  'ARC',
  'CIRCLE',
  'ELLIPSE',
]);

const metadataComment = 'SlotForge Circuit metadata ';
function parseRecords(text, warnings) {
  const lines = text.trimEnd().split(/\r\n|\n|\r/);
  if (
    lines.length % 2 ||
    lines.at(-2)?.trim() !== '0' ||
    lines.at(-1)?.trim() !== 'EOF'
  ) {
    throw Error('Incomplete ASCII DXF. Save the drawing in ASCII DXF format.');
  }
  let section = '',
    sectionRequested = false,
    headerKey = '',
    units = 0,
    circuit = false,
    circuitMeta = null,
    entity;
  const entities = [];
  for (let i = 0; i < lines.length; i += 2) {
    const tag = lines[i].trim(),
      value = lines[i + 1].trim();
    if (!/^\d{1,4}$/.test(tag)) throw Error('Invalid DXF group code.');
    const code = Number(tag);
    // Circuit labels its CAD exports with a DXF comment in the header.
    if (code === 999 && /^SlotForge Circuit\b/.test(value)) circuit = true;
    // Newer Circuit versions repeat the SVG metadata JSON in one comment.
    if (code === 999 && value.startsWith(metadataComment)) {
      try {
        const meta = JSON.parse(value.slice(metadataComment.length));
        if (meta?.format === 'slotforge.cad') circuitMeta = meta;
      } catch {
        warnings.add('Ignored unreadable SlotForge Circuit metadata in the DXF.');
      }
    }
    if (sectionRequested) {
      if (code !== 2) throw Error('Invalid DXF section name.');
      section = value;
      sectionRequested = false;
      continue;
    }
    if (code === 0 && value === 'SECTION') {
      sectionRequested = true;
      continue;
    }
    if (code === 0 && value === 'ENDSEC') {
      section = '';
      entity = undefined;
      continue;
    }
    if (section === 'HEADER' && code === 9) headerKey = value;
    if (section === 'HEADER' && headerKey === '$INSUNITS' && code === 70)
      units = Number(value);
    if (section !== 'ENTITIES') continue;
    if (code === 0) {
      entity = supported.has(value) ? { type: value, tags: [] } : undefined;
      if (entity) entities.push(entity);
      else
        warnings.add(
          'Skipped DXF entity ' +
            value +
            '. Explode it into 2D curves for import.',
        );
    } else if (entity) {
      entity.tags.push([code, value]);
    }
  }
  return { entities, units, circuit, circuitMeta };
}

const field = (tags, code) => tags.find((t) => t[0] === code)?.[1];
function num(tags, code, fallback = NaN) {
  const raw = field(tags, code);
  if (raw === undefined) return fallback;
  const result = raw === '' ? NaN : Number(raw);
  if (!Number.isFinite(result)) throw Error('Invalid number in DXF geometry.');
  return result;
}
function point(tags, code = 10) {
  return {
    x: num(tags, code),
    y: num(tags, code + 10),
    z: num(tags, code + 20, 0),
  };
}

function vertices(tags) {
  const result = [];
  let current;
  for (const [code, value] of tags) {
    if (![10, 20, 42].includes(code)) continue;
    const coordinate = value === '' ? NaN : Number(value);
    if (!Number.isFinite(coordinate))
      throw Error('Invalid DXF polyline coordinate or bulge.');
    if (code === 10) {
      current = { x: coordinate };
      result.push(current);
    } else if (current) {
      if (code === 20) current.y = coordinate;
      if (code === 42) current.bulge = coordinate;
    }
  }
  if (num(tags, 90, result.length) !== result.length)
    throw Error('DXF polyline has an incomplete vertex list.');
  return result;
}

function decode({ type, tags }) {
  const flags = num(tags, 70, 0);
  const e = {
    type,
    layer: field(tags, 8) || '0',
    shape: !!(flags & 1),
    inPaperSpace: num(tags, 67, 0) === 1,
    visible: !num(tags, 60, 0),
    extrusionDirectionX: num(tags, 210, 0),
    extrusionDirectionY: num(tags, 220, 0),
    extrusionDirectionZ: num(tags, 230, 1),
  };
  if (type === 'LINE') e.vertices = [point(tags), point(tags, 11)];
  if (type === 'LWPOLYLINE') e.vertices = vertices(tags);
  if (type === 'POLYLINE') {
    if (flags & (2 | 4 | 16 | 64))
      throw Error(
        'Convert DXF mesh and fitted polyline entities to ordinary 2D polylines.',
      );
    e.vertices = [];
  }
  if (['ARC', 'CIRCLE', 'ELLIPSE'].includes(type)) {
    e.center = point(tags);
    e.radius = num(tags, 40);
    if (type === 'ARC') {
      e.startAngle = (num(tags, 50) * Math.PI) / 180;
      e.endAngle = (num(tags, 51) * Math.PI) / 180;
    }
    if (type === 'ELLIPSE') {
      e.majorAxisEndPoint = point(tags, 11);
      e.axisRatio = num(tags, 40);
      if (e.majorAxisEndPoint.z !== 0)
        throw Error(
          'Project tilted DXF ellipses onto the XY plane before import.',
        );
      if (!(e.axisRatio > 0 && e.axisRatio <= 1))
        throw Error('Invalid DXF ellipse axis ratio.');
      e.startAngle = num(tags, 41, 0);
      e.endAngle = num(tags, 42, tau);
    }
  }
  return e;
}

function bulgePoints(a, b, bulge) {
  if (!bulge || distance(a, b) < 1e-12) return [a, b];
  const sweep = 4 * Math.atan(bulge);
  const k = (1 / bulge - bulge) / 4;
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const center = [(a[0] + b[0]) / 2 - dy * k, (a[1] + b[1]) / 2 + dx * k];
  const radius = distance(a, center);
  const start = Math.atan2(a[1] - center[1], a[0] - center[0]);
  const points = ellipsePoints(center, radius, radius, 0, start, sweep);
  points[0] = a;
  points[points.length - 1] = b;
  return points;
}

function readEntity(e, scale, remaining) {
  const xy = (p) => [p.x * scale, p.y * scale];
  if (
    e.extrusionDirectionX ||
    e.extrusionDirectionY ||
    (e.extrusionDirectionZ ?? 1) !== 1 ||
    e.is3dPolygonMesh ||
    e.isPolyfaceMesh
  )
    throw Error('Project 3D DXF entities onto the XY plane before import.');
  if (
    e.vertices?.some(
      (p) => Math.abs((p.z || 0) - (e.vertices[0].z || 0)) > 1e-8,
    )
  ) {
    throw Error('Project 3D DXF vertices onto the XY plane before import.');
  }
  const layer = e.layer || '0';
  if (e.type === 'LINE')
    return { layer, points: e.vertices.map(xy), closed: false };
  if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
    const points = [];
    for (let i = 0; i < e.vertices.length; i++) {
      const p = e.vertices[i],
        q = e.vertices[(i + 1) % e.vertices.length];
      points.push(xy(p));
      if (p.bulge && (e.shape || i + 1 < e.vertices.length)) {
        const arc = bulgePoints(xy(p), xy(q), p.bulge);
        for (let j = 1; j < arc.length - 1; j++) points.push(arc[j]);
      }
      if (points.length > remaining)
        throw Error(
          'Drawing exceeds the point limit. Import a smaller section.',
        );
    }
    return { layer, points, closed: !!e.shape };
  }
  if (!['CIRCLE', 'ARC', 'ELLIPSE'].includes(e.type)) return null;
  let rx = e.radius * scale,
    ry = rx,
    rotation = 0;
  if (e.type === 'ELLIPSE') {
    rx = Math.hypot(e.majorAxisEndPoint.x, e.majorAxisEndPoint.y) * scale;
    ry = rx * e.axisRatio;
    rotation = Math.atan2(e.majorAxisEndPoint.y, e.majorAxisEndPoint.x);
  }
  const start = e.startAngle ?? 0,
    end = e.endAngle ?? tau;
  let sweep = end - start;
  const closed = e.type === 'CIRCLE' || Math.abs(Math.abs(sweep) - tau) < 1e-8;
  if (closed) sweep = tau;
  else sweep = ((sweep % tau) + tau) % tau;
  if (!sweep) return null;
  const points = ellipsePoints(xy(e.center), rx, ry, rotation, start, sweep);
  return { layer, points, closed };
}

export function readDxf(text) {
  const warnings = new Set(),
    paths = [];
  const { entities, units, circuit, circuitMeta } = parseRecords(
    text,
    warnings,
  );
  if (circuitMeta && (circuitMeta.version !== 1 || circuitMeta.units !== 'mm'))
    throw Error('Unsupported Circuit CAD schema or drawing units.');
  // A damaged unit header (not a number) is not "no units": refuse it rather
  // than import at a guessed scale.
  if (Number.isNaN(units) || (units && !mmPerUnit[units]))
    throw Error('Unsupported DXF units. Re-export in millimetres.');
  if (!units)
    warnings.add(
      'DXF has no unit declaration. Coordinates were treated as millimetres.',
    );
  let count = 0;
  for (let i = 0; i < entities.length; i++) {
    const e = decode(entities[i]);
    if (e.type === 'POLYLINE') {
      while (entities[i + 1]?.type === 'VERTEX') {
        const { tags } = entities[++i];
        e.vertices.push({ ...point(tags), bulge: num(tags, 42, 0) });
      }
      if (entities[++i]?.type !== 'SEQEND')
        throw Error('DXF polyline is missing its end marker.');
    }
    if (e.inPaperSpace || e.visible === false) continue;
    const path = readEntity(e, mmPerUnit[units] || 1, pointLimit - count);
    if (!path) continue;
    count += path.points.length;
    if (count > pointLimit)
      throw Error('Drawing exceeds the point limit. Import a smaller section.');
    paths.push(path);
  }
  return {
    paths,
    warnings,
    circuit,
    circuitOptions: circuitMeta?.options || null,
    circuitMeta,
  };
}
