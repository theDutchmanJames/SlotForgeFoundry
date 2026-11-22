import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Module from 'manifold-3d';
import { toolGuides } from '../src/guide-geometry.js';
import { defaultTrack, buildTrack } from '../src/track.js';
import { parseDrawing } from '../src/imports.js';
import { profileDiagram } from '../src/connection-controls.js';
import { specialTrackParams } from '../src/special-pieces.js';
import { pitBraidLayout } from '../src/geometry/pit-braids.js';

const part = {
  id: 'body',
  bounds: { min: [-30, -20, 0], max: [30, 20, 12] },
  positions: [-3, -4, 0, 3, -4, 0, 3, 4, 0],
  indices: [0, 1, 2],
};
const frame = {
  origin: [7, 4, 2],
  u: [1, 0, 0],
  v: [0, 0, 1],
  normal: [0, -1, 0],
};
const loops = [
  [
    [-2, -1],
    [2, -1],
    [2, 1],
    [-2, 1],
  ],
];
const editor = (tab, op, extra = {}) =>
  toolGuides({ mode: 'editor', tab, op, part, ...extra });
const track = (tab, params, extra = {}) =>
  toolGuides({
    mode: 'track',
    tab,
    track: { params: { ...defaultTrack(), ...params } },
    ...extra,
  });
const find = (items, id) => {
  const g = items.find((s) => s.id === id);
  assert.ok(g, id);
  return g;
};
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, a + ' vs ' + b);

test('straight and angular cutting planes track the actual operation and outline only the required donor ends', () => {
  const guides = editor('split', {
    type: 'split',
    position: 0,
    axis: 'x',
    rebuild: true,
    band: 4,
    keep: 'low',
  });
  assert.ok(find(guides, 'cut-plane').paths[0].every((p) => p[0] === 0));
  assert.deepEqual(find(guides, 'cut-contour').paths, [
    [
      [0, -4, 0],
      [0, 0, 0],
    ],
  ]);
  assert.ok(guides.every((g) => g.id !== 'donor-0'));
  assert.deepEqual(
    [
      ...new Set(
        find(guides, 'donor-1')
          .paths.flat()
          .map((p) => p[0]),
      ),
    ].sort((a, b) => a - b),
    [26, 30],
  );
  const op = {
    type: 'radialSplit',
    center: [-100, 18],
    splitAngle: 15,
    startAngle: 0,
    endAngle: 30,
    keep: 'high',
    rebuild: true,
    bandAngle: 4,
  };
  const radial = editor('split', op);
  for (const [x, y] of find(radial, 'cut-plane').paths[0])
    near((y - 18) / (x + 100), Math.tan((15 * Math.PI) / 180));
  assert.ok(find(radial, 'donor-0').surface);
  assert.ok(radial.every((g) => g.id !== 'donor-30'));
});

test('angled cut and separate addition aids use the local face axes, rotated profile and perpendicular depth', () => {
  const op = {
    type: 'cut',
    frame,
    loops,
    offset: [1, 2],
    scale: 2,
    rotation: 90,
    depth: 3,
    tilt: 45,
    tiltAzimuth: 90,
  };
  const guides = editor('shape', op),
    a = find(guides, 'profile-base').paths[0][0],
    b = find(guides, 'profile-tip').paths[0][0];
  for (const [i, value] of [10, 4, 0].entries()) near(a[i], value);
  for (const [i, value] of [0, 3, 3].entries()) near(b[i] - a[i], value);
  const add = find(
    editor('shape', { ...op, type: 'add', separate: true }),
    'profile-tip',
  );
  assert.match(add.text, /Separate addition/);
  near(add.paths[0][0][1], 1);
});

test('common height guides show real disjoint footprints at one level and signed changes along a side face normal', () => {
  const starts = [10, 12, 14, 16];
  const faces = starts.map((height, i) => ({
    frame: { ...frame, origin: [i * 10, 20 - height, 0] },
    loops,
  }));
  const changes = starts.map((start) => ({
    start,
    end: 12,
    delta: 12 - start,
  }));
  const op = { type: 'moveFaces', moveMode: 'height', value: 12, faces };
  const guides = editor('move-face', op, {
    facePlan: { min: -20, normal: frame.normal, changes },
    faceMoveMode: 'height',
  });
  for (const [i, tone] of ['add', 'reference', 'cut', 'cut'].entries()) {
    const guide = find(guides, 'face-height-' + i);
    assert.equal(guide.tone, tone);
    assert.ok(guide.paths.flat().every((point) => point[1] === 8));
  }
  assert.ok(
    find(guides, 'common-height-plane').paths[0].every((p) => p[1] === 8),
  );
  assert.ok(!guides.some((g) => g.id === 'face-height-1-direction'));
  const offset = editor(
    'move-face',
    { ...op, moveMode: 'offset', value: -2 },
    {
      faceMoveMode: 'offset',
      facePlan: {
        min: -20,
        normal: frame.normal,
        changes: starts.map((start) => ({ start, end: start - 2, delta: -2 })),
      },
    },
  );
  assert.ok(!offset.some((g) => g.id === 'common-height-plane'));
  for (const [i, start] of starts.entries())
    near(find(offset, 'face-height-' + i).anchor[1], 20 - start + 2);
});

test('a through guide follows the tilted cut across the selected part along its local normal', () => {
  const guides = editor('cut-shape', {
    type: 'cut',
    extent: 'through',
    frame,
    loops,
    tilt: 45,
  });
  const start = find(guides, 'profile-base').paths[0][0];
  const end = find(guides, 'profile-tip');
  assert.match(end.text, /Through part/);
  near(end.paths[0][0][1], part.bounds.max[1]);
  near(end.paths[0][0][0] - start[0], part.bounds.max[1] - frame.origin[1]);
});

test('a placed cut shows the selected face perimeter separately from the smaller cutting profile', () => {
  const guides = editor(
    'cut-shape',
    { type: 'cut', profileKind: 'rectangle', frame, loops, depth: 2 },
    {
      region: {
        ...frame,
        planar: true,
        loops: [
          [
            [-5, -4],
            [5, -4],
            [5, 4],
            [-5, 4],
          ],
        ],
      },
    },
  );
  assert.deepEqual(
    find(guides, 'selected-face-perimeter').paths[0][0],
    [2, 4, -2],
  );
  assert.deepEqual(find(guides, 'profile-base').paths[0][0], [5, 4, 1]);
});

test('tilt guides rotate and offset the hinge and clip the footprint at the new hinge', () => {
  const op = {
    type: 'tiltFace',
    frame,
    loops,
    pivot: 'u-min',
    hingeRotation: 90,
    pivotOffset: 1,
    angle: 45,
    separate: true,
  };
  const guides = editor('tilt', op);
  const hinge = find(guides, 'tilt-hinge').paths[0];
  hinge.forEach((p) => {
    near(p[1], 4);
    near(p[2], 2);
  });
  const tilted = find(guides, 'tilted-face');
  assert.match(tilted.text, /Separate wedge/);
  assert.ok(tilted.paths.flat().every((p) => p[2] >= 2 - 1e-6));
  near(Math.min(...tilted.paths.flat().map((p) => p[1])), 3);
  assert.equal(
    find(editor('tilt', { ...op, angle: -45 }), 'tilted-face').tone,
    'cut',
  );
});

test('transform shows rotated scale and translation around the model centre; measurement endpoints override tool guides', () => {
  const guides = editor(
    'transform',
    { type: 'transform', scale: 2, rotate: [0, 0, 90], move: [10, 0, 0] },
    { field: 'scale' },
  );
  const { paths } = find(guides, 'transform-bounds');
  near(Math.min(...paths.flat().map((p) => p[0])), -30);
  near(Math.max(...paths.flat().map((p) => p[1])), 60);
  assert.match(find(guides, 'move-direction').text, /10 mm/);
  const m = editor(
    'transform',
    {},
    {
      measuring: true,
      measurePoints: [
        [0, 0, 0],
        [0, 3, 4],
      ],
    },
  );
  assert.equal(m.length, 1);
  assert.equal(find(m, 'measure-distance').text, '5 mm');
});

test('track width, radius, live seams, border widths and guide-slot/braid depths match real stations', () => {
  const params = {
    kind: 'curve',
    radius: 300,
    angle: 30,
    width: 100,
    segments: 3,
    borderSide: 'both',
    borderEntry: 12,
    borderApex: 45,
    borderExit: 24,
    apexPosition: 0.6,
  };
  const road = track('geometry', params);
  assert.deepEqual(find(road, 'curve-radius').paths[0][0], [0, -300, 12]);
  assert.equal(find(road, 'road-seams').paths.length, 2);
  const borders = track('borders', params);
  for (const side of [-1, 1])
    near(
      Math.hypot(
        ...find(borders, 'border-apex-' + side).paths[0][0].map(
          (x, i) => x - find(borders, 'border-apex-' + side).paths[0][1][i],
        ),
      ),
      45,
    );
  const slot = find(track('profile', params), 'channel-profile').paths[0];
  assert.deepEqual(
    slot.map((p) => p[2]),
    [11.5, 5, 5, 11.5],
  );
  const shelves = find(
    track('profile', params, { field: 'braidWidth' }),
    'channel-profile',
  ).paths;
  for (const [i, shelf] of shelves.entries()) {
    assert.deepEqual(
      shelf.map((q) => q[2]),
      [12, 11.5, 11.5],
    );
    assert.deepEqual(shelf[2], i ? slot[3] : slot[0]);
  }
  assert.equal(shelves.length, 2);
  assert.ok(
    find(track('profile', { ...params, braidFeedSide: 'both' }), 'braid-feed')
      .dots.length === 4,
  );
});

test('the channel guide follows a skew Circuit end across both recessed shelves', () => {
  const plan = {
    lanes: [
      [
        [5, 0],
        [45, 0],
      ],
    ],
    outlines: [
      [
        [0, -10],
        [40, -10],
        [50, 10],
        [10, 10],
      ],
    ],
  };
  const params = { ...defaultTrack(), kind: 'import', lanes: 1, width: 20 };
  const guides = toolGuides({
    mode: 'track',
    tab: 'profile',
    field: 'braidDepth',
    track: { params, plan },
  });
  const shelves = find(guides, 'channel-profile').paths;
  for (const [i, shelf] of shelves.entries()) {
    const sign = i ? 1 : -1;
    assert.deepEqual(
      shelf.map((p) => p[1]),
      [6.5, 6.5, 1.5].map((n) => n * sign),
    );
    for (const [x, y] of shelf) near(x, 5 + y / 2);
  }
  const offsetGuides = toolGuides({
    mode: 'track', tab: 'profile', field: 'braidGap',
    track: { params: { ...params, braidGap: 2 }, plan },
  });
  const wall = find(offsetGuides, 'braid-wall-width');
  // The end is skew, but the dimension stays perpendicular to the lane.
  assert.deepEqual(wall.paths[0], [[6.75, 1.5, 12], [6.75, 3.5, 12]]);
});

test('the profile schematic and lane guides show two full-height walls with a fixed-width recess', () => {
  const p = { ...defaultTrack(), kind: 'straight', width: 140, lanes: 1,
    slotWidth: 3, braidGap: 2, braidWidth: 5, height: 10, slotDepth: 8, braidDepth: 0.5 };
  const outline = profileDiagram(p).match(/<path d="([^"]+)"/)[1];
  const points = outline.slice(1, -1).split('L').map(point => point.split(' ').map(Number));
  const left = points[0][0], top = points[0][1];
  const scaleX = (Math.max(...points.map(q => q[0])) - left) / p.width;
  const scaleZ = (Math.max(...points.map(q => q[1])) - top) / p.height;
  const section = points.slice(1, 13).map(([x,y]) => [
    (x-left)/scaleX - p.width/2, Number(((y-top)/scaleZ).toFixed(2)),
  ]);
  assert.deepEqual(section, [[-8.5,0],[-8.5,0.5],[-3.5,0.5],[-3.5,0],
    [-1.5,0],[-1.5,8],[1.5,8],[1.5,0],[3.5,0],[3.5,0.5],[8.5,0.5],[8.5,0]]);
  const guides = track('profile', p, { field: 'braidGap' });
  const width = find(guides, 'braid-wall-width').paths[0];
  assert.deepEqual(width.map(q => q[2]), [10, 10]);
  near(Math.hypot(...width[0].map((v,i) => v - width[1][i])), 2);
  const braid = find(guides, 'channel-profile');
  assert.equal(braid.text, 'Braid recess · 5 mm × 0.5 mm');
  for (const shelf of braid.paths) {
    assert.deepEqual(shelf.map(q => q[2]), [10, 9.5, 9.5, 10]);
    near(Math.hypot(...shelf[1].map((v,i) => v - shelf[2][i])), 5);
  }
  assert.deepEqual(find(track('profile',p), 'channel-profile').paths[0].map(q => q[2]), [10, 2, 2, 10]);

  const pit = specialTrackParams('pit', { ...p, lanes: 2, laneSpacing: 65 });
  for (const gap of [2, 0]) {
    const profile = track('profile', { ...pit, braidGap: gap }, { field: 'braidGap' });
    assert.equal(profile.some(g => g.id === 'braid-wall-width'), gap > 0);
    const recess = find(profile, 'special-braid-width').paths[0];
    assert.deepEqual(recess.map(q => q[2]), [9.5, 9.5]);
    near(Math.hypot(...recess[0].map((v,i) => v - recess[1][i])), 5);
  }
});

test('pit contact controls highlight the actual island openings and through-running wire taps', () => {
  const p = specialTrackParams('pit', { ...defaultTrack(), width: 200, laneSpacing: 100 });
  p.special.side = 'both';
  const field = 'spPitContactMode';
  const original = track('profile', p, { field });
  assert.equal(find(original, 'pit-wire-holes').paths.length, 16);
  assert.ok(!original.some(g => g.id === 'pit-braid-pass-throughs'));

  p.special.pitContactMode = 'braid';
  p.special.pitContactLength = 2;
  const { jumpers } = pitBraidLayout(p);
  for (const field of ['spPitContactMode', 'spPitContactLength']) {
    const guides = track('profile', p, { field });
    const slots = find(guides, 'pit-braid-pass-throughs');
    assert.equal(slots.text, 'Braid pass-through · 5 × 2 mm');
    for (const [i, id] of ['pit-braid-pass-throughs', 'pit-wire-holes'].entries()) {
      const expected = jumpers.map(jumper => {
        const path = jumper.openings[i].outline.map(([x, y]) => [x, y, p.height - p.braidDepth]);
        return [...path, path[0]];
      });
      assert.deepEqual(find(guides, id).paths, expected);
    }
  }
  assert.ok(!track('profile', p, { field: 'slotWidth' }).some(g => g.id === 'pit-wire-holes'));
});

test('rejected segment counts and extreme live dimensions never allocate station arrays', () => {
  for (const key of ['lanes', 'segments', 'borderSegments'])
    for (const value of [NaN, Infinity, -4, 1e8]) {
      assert.deepEqual(track('geometry', { [key]: value }), []);
    }
  assert.deepEqual(track('geometry', { kind: 'curve', radius: 1e250 }), []);
  assert.deepEqual(track('geometry', { kind: 'curve', angle: NaN }), []);
});

test('paint dimensions follow the shared edge and the physical groove sits on the roadward side', () => {
  const p = {
    kind: 'straight',
    width: 100,
    borderSide: 'outer',
    whiteLineRoad: 'both',
    whiteLineBorder: 'outer',
    whiteLineWidth: 4,
    whiteLineGroove: true,
    grooveWidth: 0.6,
    grooveDepth: 0.4,
    kerbEdge: 'road',
    kerbSide: 'outer',
    kerbWidth: 5,
  };
  const lines = track('geometry', p, { field: 'whiteLineRoad' });
  assert.deepEqual(
    find(lines, 'white-line-outer').dots.map((v) => v[1]),
    [48, 52],
  );
  assert.deepEqual(
    find(lines, 'white-line-inner').dots.map((v) => v[1]),
    [-46, -50],
  );
  const groove = find(
    track('geometry', p, { field: 'grooveDepth' }),
    'paint-groove-outer',
  );
  assert.deepEqual(
    groove.dots.map((v) => v.slice(1)),
    [
      [47.7, 12],
      [47.7, 11.6],
    ],
  );
  const kerb = find(track('borders', p, { field: 'kerbWidth' }), 'kerb-road-1');
  assert.deepEqual(
    kerb.dots.map((v) => v[1]),
    [52, 57],
  );
  const borderOnly = { ...p, whiteLineRoad: 'none' };
  const gap = find(
    track('geometry', borderOnly, { field: 'grooveWidth' }),
    'paint-groove-outer',
  );
  assert.deepEqual(
    gap.dots.map((v) => v[1]),
    [50, 50.6],
  );
});

test('each border and its kerbstones have guides at that side’s own apex', () => {
  const p = {
    kind: 'straight', length: 200, width: 100, borderSide: 'both',
    borderEntry: 12, borderExit: 12,
    outerApexWidth: 36, outerApexPosition: 0.65,
    innerApexWidth: 20, innerApexPosition: 0.35,
    kerbEdge: 'free', kerbSide: 'both', kerbWidth: 4,
  };
  const borders = track('borders', p);
  const kerbs = track('borders', p, { field: 'kerbWidth' });
  for (const [sign, x, y, caption] of [
    [1, 30, 86, 'Outside apex · 36 mm at 65%'],
    [-1, -30, -70, 'Inside apex · 20 mm at 35%'],
  ]) {
    const apex = find(borders, 'border-apex-' + sign);
    assert.equal(apex.text, caption);
    near(apex.dots[1][0], x);
    near(apex.dots[1][1], y);
    assert.ok(find(borders, 'border-edge-' + sign).paths[0].some(
      ([a, b]) => Math.abs(a - x) < 1e-8 && Math.abs(b - y) < 1e-8,
    ));
    const kerb = find(kerbs, 'kerb-free-' + sign);
    near(kerb.dots[0][0], x);
    near(kerb.dots[0][1], y);
  }
  // Imported or restored percentages can be a rounding step from a mesh station.
  const rounded = { ...p, outerApexPosition: 0.5 + Number.EPSILON, whiteLineBorder: 'outer' };
  assert.ok(track('borders', rounded, { field: 'kerbWidth' }).length > 0);
});

test('kerb width guides show the usable half-border width and selected side', () => {
  const p = {
    borderSide: 'both',
    kerbSide: 'inner',
    kerbEdge: 'both',
    kerbWidth: 15,
    kerbLength: 12,
    borderEntry: 8,
    borderApex: 10,
    borderExit: 8,
  };
  const guides = track('borders', p, { field: 'kerbWidth' });
  assert.equal(guides.length, 2);
  assert.equal(find(guides, 'kerb-free--1').text, 'Free edge · 5 mm');
  assert.equal(find(guides, 'kerb-road--1').text, 'Road-facing edge · 5 mm');
  const block = find(
    track('borders', p, { field: 'kerbLength' }),
    'kerb-free--1',
  );
  assert.equal(block.text, 'Block length · 12 mm');
  assert.equal(block.paths.length, 0);
});

test('kerb groove fields measure the physical rim even when white lines are off', () => {
  const params = {
    kind: 'straight', width: 80, borderSide: 'outer', kerbSide: 'outer',
    kerbEdge: 'road', kerbGroove: true, grooveWidth: 0.8, grooveDepth: 0.45,
  };
  const width = find(track('borders', params, { field: 'grooveWidth' }), 'kerb-road-1');
  assert.deepEqual(width.dots.map((v) => v.slice(1)), [[40, 12], [40.8, 12]]);
  const depth = find(track('borders', params, { field: 'grooveDepth' }), 'kerb-road-1');
  assert.deepEqual(depth.dots.map((v) => v.slice(1)), [[40.4, 12], [40.4, 11.55]]);
});

test('Circuit guides follow the same real millimetre drawing in SVG and DXF and hardware markers match generated coordinates', async () => {
  const params = { ...defaultTrack(), kind: 'import', borderSide: 'outer' };
  const load = async (name, ext) =>
    parseDrawing(
      await readFile(new URL('./drawings/' + name, import.meta.url), 'utf8'),
      ext,
    );
  const svg = await load('circuit-curve-compact.svg', 'svg'),
    dxf = await load('circuit-curve-mm.dxf', 'dxf');
  const road = (plan) =>
    toolGuides({ mode: 'track', tab: 'geometry', track: { params, plan } });
  const a = find(road(svg), 'road-width'),
    b = find(road(dxf), 'road-width');
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 3; j++)
      assert.ok(Math.abs(a.paths[0][i][j] - b.paths[0][i][j]) < 0.15);
  const wasm = await Module();
  wasm.setup();
  const p = {
    ...defaultTrack(),
    kind: 'straight',
    joint: 'both',
    width: 100,
    lanes: 1,
    laneSpacing: 40,
  };
  const parts = buildTrack(wasm, p);
  try {
    const hardware = track('joints', p, { parts });
    const g = find(hardware, 'hardware-Clip').dots;
    assert.ok(g.length >= 2);
    assert.ok(
      g.every((pt) => Math.abs(pt[1]) > 1),
      'automatic clip markers move clear of the centre guide slot',
    );
    assert.deepEqual(
      g,
      parts[0].jointGuides.filter((m) => m.kind === 'Clip').map((m) => m.point),
    );
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
});

test('a braid feed guide marks the middle of the actual shelf at a Circuit corner', () => {
  const params = {
    ...defaultTrack(),
    kind: 'import',
    width: 30,
    lanes: 1,
    braidFeedSide: 'both',
    braidFeedStations: [0.5],
  };
  const plan = {
    lanes: [
      [
        [-50, 0],
        [0, 0],
        [0, 50],
      ],
    ],
    outlines: [],
  };
  const guides = toolGuides({
    mode: 'track',
    tab: 'profile',
    track: { params, plan },
  });
  const d = params.slotWidth / 2 + params.braidGap + params.braidWidth / 2;
  const z = params.height - params.braidDepth;
  const [right, left] = find(guides, 'braid-feed').dots;
  for (const [actual, expected] of [
    [right, [d, -d, z]],
    [left, [-d, d, z]],
  ])
    actual.forEach((value, i) => near(value, expected[i]));
});

test('print plate guides account for optimal bed rotation, margin and raised geometry', () => {
  const p = {
    ...part,
    bounds: { min: [40, 20, 5], max: [60, 80, 10] },
    positions: [40, 20, 5, 60, 20, 5, 60, 80, 10, 40, 80, 10],
    fit: { angle: 90, fits: true },
  };
  const guides = toolGuides({
    mode: 'editor',
    part: p,
    plateVisible: true,
    plateFit: null,
    plate: { width: 70, depth: 30, margin: 2 },
  });
  const rectangle = find(guides, 'print-plate').paths[0];
  near(Math.min(...rectangle.map((p) => p[0])), 35);
  near(Math.max(...rectangle.map((p) => p[1])), 85);
  near(Math.min(...find(guides, 'plate-margin').paths[0].map((p) => p[0])), 37);
  assert.ok(rectangle.every((p) => p[2] === 5));
  const changed = toolGuides({
    mode: 'editor',
    part: p,
    plateVisible: true,
    plate: { width: 10, depth: 20 },
    plateFit: { angle: 0, fits: false },
  });
  assert.equal(find(changed, 'print-plate').tone, 'cut');
  near(Math.min(...changed[0].paths[0].map((p) => p[0])), 45);
});
