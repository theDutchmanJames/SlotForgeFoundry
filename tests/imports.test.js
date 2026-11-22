import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDrawing } from '../src/imports.js';
import { profileWarnings } from '../src/import-profile.js';

const near = (a, b, eps = 1e-5) =>
  assert.ok(Math.abs(a - b) < eps, a + ' differs from ' + b);
const read = (name) =>
  readFileSync(new URL('./drawings/' + name, import.meta.url), 'utf8');
const box = (points) => [
  Math.min(...points.map((p) => p[0])),
  Math.min(...points.map((p) => p[1])),
  Math.max(...points.map((p) => p[0])),
  Math.max(...points.map((p) => p[1])),
];
const area = (path) =>
  Math.abs(
    path.reduce((a, p, i) => {
      const q = path[(i + 1) % path.length];
      return a + p[0] * q[1] - p[1] * q[0];
    }, 0),
  ) / 2;
function dxf(tags, units = 4) {
  return [
    0,
    'SECTION',
    2,
    'HEADER',
    9,
    '$INSUNITS',
    70,
    units,
    0,
    'ENDSEC',
    0,
    'SECTION',
    2,
    'ENTITIES',
    ...tags,
    0,
    'ENDSEC',
    0,
    'EOF',
  ].join('\n');
}

// Both fixtures were produced by SlotForge Circuit's own CAD exporter from
// the same rotated 30 degree routed piece. SVG page size is reduced 10:1.
test('Circuit compact SVG and full-size DXF agree in world-space millimetres, including reflected arcs', () => {
  const svg = parseDrawing(read('circuit-curve-compact.svg'), '.SVG');
  const cad = parseDrawing(read('circuit-curve-mm.dxf'), 'curve.dxf');
  for (const [key, count] of [
    ['lanes', 2],
    ['outlines', 1],
    ['slotEdges', 4],
    ['braidEdges', 8],
    ['shapes', 1],
  ]) {
    assert.equal(svg[key].length, count);
    assert.equal(cad[key].length, count);
    svg[key].forEach((path, i) => {
      assert.equal(path.length, cad[key][i].length);
      path.forEach((p, j) => {
        near(p[0], cad[key][i][j][0]);
        near(p[1], cad[key][i][j][1]);
      });
    });
  }
  const start = svg.lanes[0][0],
    end = svg.lanes[0].at(-1);
  near(
    Math.hypot(end[0] - start[0], end[1] - start[1]),
    2 * 175 * Math.sin(Math.PI / 12),
  );
  assert.deepEqual(svg.inferredWidths, {
    slotWidth: 3,
    braidWidth: 5,
    braidGap: 0.7,
  });
  assert.deepEqual(cad.inferredWidths, svg.inferredWidths);
  assert.deepEqual(svg.openPaths, []); // optional scale bar is a guide only
});

test('nested SVG transforms, physical size, aspect ratio and hidden definitions', () => {
  const svg =
    '<svg width="2in" height="1in" viewBox="0 0 10 10">' +
    '<defs><rect width="9" height="9"/></defs><g display="none"><circle r="5"/></g>' +
    '<g transform="translate(2 3)"><g transform="scale(2)"><path d="M0 0h2v1h-2z"/></g></g></svg>';
  const result = parseDrawing(svg, 'svg');
  assert.equal(result.shapes.length, 1);
  const actual = box(result.shapes[0]);
  [17.78, -12.7, 27.94, -7.62].forEach((n, i) => near(actual[i], n));
});

test('generic artwork keeps nested subpaths and handles rotated ellipses, cubic and quadratic curves', () => {
  const svg =
    '<svg width="100mm" height="100mm" viewBox="0 0 100 100">' +
    '<path d="M0 0H20V20H0Z M5 5h10v10h-10z"/>' +
    '<ellipse cx="50" cy="50" rx="8" ry="3" transform="rotate(90 50 50)"/>' +
    '<path d="M0 30q10 -20 20 0t20 0c1 6 3 6 4 0z"/></svg>';
  const r = parseDrawing(svg, 'svg');
  assert.equal(r.shapes.length, 4);
  near(area(r.shapes[0]), 400);
  near(area(r.shapes[1]), 100);
  near(area(r.shapes[2]), Math.PI * 8 * 3, 0.6);
  assert.ok(r.shapes[3].length > 10);
});

test('DXF lines and arc segments in inch units can form one physical outline', () => {
  const data = dxf(
    [
      0,
      'LINE',
      10,
      -1,
      20,
      0,
      11,
      1,
      21,
      0,
      0,
      'ARC',
      10,
      0,
      20,
      0,
      40,
      1,
      50,
      0,
      51,
      180,
    ],
    1,
  );
  const r = parseDrawing(data, 'dxf');
  assert.equal(r.shapes.length, 1);
  near(area(r.shapes[0]), (Math.PI * 25.4 ** 2) / 2, 2);
  assert.equal(r.openPaths.length, 0);
});

test('DXF R12 polylines, generic open paths and layer branching are handled without phantom closing edges', () => {
  const data = dxf([
    0,
    'POLYLINE',
    70,
    1,
    0,
    'VERTEX',
    10,
    0,
    20,
    0,
    0,
    'VERTEX',
    10,
    20,
    20,
    0,
    0,
    'VERTEX',
    10,
    20,
    20,
    20,
    0,
    'SEQEND',
    0,
    'LINE',
    10,
    12,
    20,
    0,
    11,
    13,
    21,
    0,
    0,
    'LINE',
    10,
    12,
    20,
    0,
    11,
    12,
    21,
    1,
    0,
    'LINE',
    10,
    12,
    20,
    0,
    11,
    11,
    21,
    0,
  ]);
  const r = parseDrawing(data, 'dxf');
  assert.equal(r.shapes.length, 1);
  near(area(r.shapes[0]), 200);
  assert.equal(r.openPaths.length, 3);
  assert.match(r.warnings.join(' '), /open/i);
});

test('open SVG strokes stay open and their stroke width is not physical slot width', () => {
  const svg =
    '<svg xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"><g id="layer1" inkscape:label="SLOT_CENTRES"><path d="M0 0h96" fill="none" stroke-width="14"/></g>' +
    '<g id="TABLE"><rect width="192" height="100"/></g></svg>';
  const p = parseDrawing(svg, 'svg');
  near(p.lanes[0][1][0], 25.4);
  assert.equal(p.outlines.length, 0);
  assert.equal(p.tables.length, 1);
  assert.deepEqual(p.shapes, []);
  assert.deepEqual(p.inferredWidths, {});
});

test('incomplete geometry, ambiguous SVG scale and unflattened transforms fail with actionable errors', () => {
  assert.throws(
    () => parseDrawing(dxf([0, 'POLYLINE', 0, 'VERTEX', 10, 1, 20, 2]), 'dxf'),
    /end marker/,
  );
  assert.throws(
    () =>
      parseDrawing(
        '<svg width="5%" viewBox="0 0 50 50"><rect width="10" height="10"/></svg>',
        'svg',
      ),
    /absolute width/,
  );
  assert.throws(
    () =>
      parseDrawing(
        '<svg><rect width="1" height="1" transform="skale(9)"/></svg>',
        'svg',
      ),
    /transform/i,
  );
  assert.throws(
    () =>
      parseDrawing(
        dxf([0, 'LINE', 10, 0, 20, 0, 30, 0, 11, 1, 21, 1, 31, 2]),
        'dxf',
      ),
    /XY plane/,
  );
  assert.throws(
    () =>
      parseDrawing(
        dxf([0, 'LWPOLYLINE', 10, 0, 20, 0, 42, 'q', 10, 10, 20, 10]),
        'dxf',
      ),
    /bulge/,
  );
  assert.throws(
    () => parseDrawing('<svg><text x="4" y="5">27</text></svg>', 'svg'),
    /Convert it to paths/,
  );
});

test('a stripped Circuit SVG keeps full size, and a foreign coordinate convention is refused', () => {
  const svg = read('circuit-curve-compact.svg');
  const reference = parseDrawing(svg, 'svg');
  const stripped = parseDrawing(
    svg
      .replace(/<metadata>.*?<\/metadata>/s, '')
      .replace(/<title>.*?<\/title>/s, '')
      .replace(/<desc>.*?<\/desc>/s, ''),
    'svg',
  );
  assert.match(stripped.warnings.join(' '), /lost its SlotForge metadata.*1:10/);
  near(stripped.lanes[0][0][0], reference.lanes[0][0][0]);
  near(stripped.lanes[0][0][1], reference.lanes[0][0][1]);
  assert.deepEqual(stripped.inferredWidths, reference.inferredWidths);
  assert.throws(
    () =>
      parseDrawing(
        svg.replace('builder-world-positive-y-down', 'builder-world-mirrored'),
        'svg',
      ),
    /coordinate convention/,
  );
});

test('Circuit DXF exports are recognised, and missing edge layers are explained', () => {
  const dxf = parseDrawing(read('circuit-curve-mm.dxf'), 'dxf');
  assert.equal(dxf.profileSource.circuit, true);
  assert.equal(dxf.profileSource.slot, 'inferred');
  assert.equal(dxf.profileSource.conductor, 'inferred');
  assert.deepEqual(profileWarnings(dxf, { slotWidth: 3, braidWidth: 5, braidGap: 0 }), []);
  // Only the slot centrelines: Circuit's default export.
  const bare = parseDrawing(
    read('circuit-curve-compact.svg').replace(
      /<g id="(?!SLOT_CENTRES)[A-Z_]+".*?<\/g>/gs,
      '',
    ),
    'svg',
  );
  assert.deepEqual(bare.inferredWidths, {});
  const notes = profileWarnings(bare, { slotWidth: 3.2, braidWidth: 6, braidGap: 1 });
  assert.equal(notes.length, 1);
  assert.match(notes[0], /no slot edges.*3\.2 mm.*6 mm wide, 1 mm from the slot.*Circuit’s CAD export/);
});

test('copper tape edges size the conductor without cutting a recess', () => {
  const svg = read('circuit-curve-compact.svg')
    .replaceAll('id="BRAID_EDGES"', 'id="TAPE_EDGES"');
  const drawing = parseDrawing(svg, 'svg');
  assert.equal(drawing.braidEdges.length, 0);
  assert.equal(drawing.tapeEdges.length, 8);
  assert.deepEqual(drawing.inferredWidths, {
    slotWidth: 3,
    braidWidth: 5,
    braidGap: 0.7,
    braidDepth: 0,
  });
  assert.equal(drawing.profileSource.conductorType, 'tape');
});

test('a Circuit routed profile in the metadata sets slot, depth and conductor sizes', () => {
  const svg = read('circuit-curve-compact.svg');
  const meta = (extra) =>
    svg.replace(/<metadata>(.*?)<\/metadata>/s, (_, json) => {
      const m = JSON.parse(json.replaceAll('&quot;', '"'));
      return (
        '<metadata>' +
        JSON.stringify({ ...m, ...extra }).replaceAll('"', '&quot;') +
        '</metadata>'
      );
    });
  const profile = {
    slotWidthMm: 3,
    slotDepthMm: 8,
    conductor: 'braid',
    conductorWidthMm: 5,
    conductorGapMm: 0.7,
    recessDepthMm: 0.8,
  };
  const withProfile = parseDrawing(
    meta({ routedProfiles: [profile], heights: [[1, 2, 30]] }),
    'svg',
  );
  assert.deepEqual(withProfile.inferredWidths, {
    slotWidth: 3,
    slotDepth: 8,
    braidWidth: 5,
    braidGap: 0.7,
    braidDepth: 0.8,
  });
  assert.equal(withProfile.profileSource.slot, 'metadata');
  assert.deepEqual(withProfile.heights, [[1, -2, 30]]); // Circuit's Y points down
  // Fits a 12 mm track; on a 7.5 mm track the 8 mm slot depth is refused.
  assert.deepEqual(
    profileWarnings(withProfile, { height: 12, slotDepth: 7, braidDepth: 0.5, hollow: true, wall: 2, deck: 2 }),
    [],
  );
  const shallow = parseDrawing(meta({ routedProfiles: [profile] }), 'svg');
  const notes = profileWarnings(shallow, { height: 7.5, slotDepth: 5, braidDepth: 0.5, hollow: false });
  assert.match(notes[0], /8 mm slot depth does not fit the current 7\.5 mm/);
  assert.equal(shallow.inferredWidths.slotDepth, undefined);
  // Edited edges that disagree with the profile are reported.
  const edited = parseDrawing(
    meta({ routedProfiles: [{ ...profile, slotWidthMm: 3.5 }] }),
    'svg',
  );
  assert.equal(edited.inferredWidths.slotWidth, 3.5);
  assert.match(edited.warnings.join(' '), /differ from the Circuit profile.*slotWidth/);
  // Two profiles: fall back to the measured edges.
  const mixed = parseDrawing(
    meta({ routedProfiles: [profile, { ...profile, slotWidthMm: 4 }] }),
    'svg',
  );
  assert.equal(mixed.inferredWidths.slotWidth, 3);
  assert.match(mixed.warnings.join(' '), /2 different routed profiles/);
});

test('Circuit metadata in a DXF comment is read like the SVG metadata', () => {
  const dxf = read('circuit-curve-mm.dxf').replace(
    /999\r?\nSlotForge Circuit - routed construction geometry\r?\n/,
    (m) =>
      m +
      '999\nSlotForge Circuit metadata ' +
      JSON.stringify({
        format: 'slotforge.cad',
        version: 1,
        units: 'mm',
        routedProfiles: [{ slotWidthMm: 3, conductor: 'tape', conductorWidthMm: 5, conductorGapMm: 0.7 }],
      }) +
      '\n',
  );
  const drawing = parseDrawing(dxf, 'dxf');
  assert.equal(drawing.inferredWidths.braidDepth, 0);
  assert.equal(drawing.profileSource.conductorType, 'tape');
});
