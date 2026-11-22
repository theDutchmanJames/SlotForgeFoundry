import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectFlatImport } from '../src/drawings/flat-import.js';
import { parseDrawing } from '../src/imports.js';
import { vertexNormals } from '../src/geometry/import-track.js';
import { defaultTrack } from '../src/track.js';
import { checkProject, newProject } from '../src/project.js';
import { importedTrackPaths } from '../src/geometry/import-track.js';

const profile = defaultTrack();
function saved(lanes, flatCrossing) {
  const p = newProject();
  p.track.params.kind = 'import';
  p.track.plan = {
    lanes,
    flatCrossing,
    outlines: flatCrossing.sections.map((s) => s.outlines[0]),
  };
  return JSON.parse(JSON.stringify(p));
}
function cad(paths, ext, closed = false) {
  const points = (p) => p.map((xy) => xy.join(',')).join(' ');
  if (ext === 'svg')
    return `<svg width="400mm" height="400mm" viewBox="0 0 400 400"><g id="SLOT_CENTRES">${paths.map((p) => `<${closed ? 'polygon' : 'polyline'} points="${points(p)}"/>`).join('')}</g></svg>`;
  return [
    0,
    'SECTION',
    2,
    'ENTITIES',
    ...paths.flatMap((p) => [
      0,
      'LWPOLYLINE',
      8,
      'SLOT_CENTRES',
      90,
      p.length,
      70,
      Number(closed),
      ...p.flatMap(([x, y]) => [10, x, 20, y]),
    ]),
    0,
    'ENDSEC',
    0,
    'EOF',
  ].join('\n');
}
for (const ext of ['svg', 'dxf']) {
  test(`${ext} open single-lane figure eight offers two distinct flat passages`, () => {
    const line = [
      [0, 0],
      [200, 200],
      [0, 200],
      [200, 0],
    ];
    const parsed = parseDrawing(cad([line], ext), ext);
    const result = inspectFlatImport(parsed, 30, profile);
    assert.ok(result.flatCrossing, result.warning);
    const { crossings, sections } = result.flatCrossing;
    assert.equal(crossings.length, 1);
    assert.equal(sections.length, 2);
    assert.doesNotThrow(() =>
      checkProject(saved(parsed.lanes, result.flatCrossing)),
    );
    assert.notEqual(crossings[0].firstSection, crossings[0].secondSection);
    assert.deepEqual(sections[0].lanes[0].at(-1), sections[1].lanes[0][0]);
  });
}

test('closed imported offset lanes can start at different vertices and run in opposite directions', () => {
  const base = [
      [0, 0],
      [200, 200],
      [0, 200],
      [200, 0],
    ],
    normals = vertexNormals(base, true);
  const lane = (offset) =>
    base.map((p, i) => p.map((v, d) => v + normals[i][d] * offset));
  const one = lane(-7),
    two = lane(7).reverse();
  // A second lane contains an extra station that must survive in the result.
  two.splice(
    1,
    0,
    two[0].map((v, d) => (v + two[1][d]) / 2),
  );
  const reordered = [...two.slice(2), ...two.slice(0, 2)];
  const parsed = parseDrawing(cad([one, reordered], 'svg', true), 'svg');
  const r = inspectFlatImport(parsed, 48, profile);
  assert.ok(r.flatCrossing, r.warning);
  assert.equal(r.flatCrossing.closed, true);
  assert.doesNotThrow(() => checkProject(saved(parsed.lanes, r.flatCrossing)));
  assert.ok(r.flatCrossing.sections.every(({ lanes }) => lanes.length === 2));
  assert.equal(r.flatCrossing.crossings.length, 1);
  for (const l of parsed.lanes)
    for (const [x, y] of l) {
      assert.ok(
        r.flatCrossing.sections.some((s) =>
          s.lanes.some((v) =>
            v.some((p) => Math.hypot(p[0] - x, p[1] - y) < 1e-5),
          ),
        ),
      );
    }
});

test('two crossing two-lane roads count as one crossing and form independent decks', () => {
  const lanes = [
    [
      [-100, -9],
      [100, -9],
    ],
    [
      [100, 9],
      [-100, 9],
    ],
    [
      [-9, -100],
      [-9, 100],
    ],
    [
      [9, -100],
      [9, 100],
    ],
  ];
  const r = inspectFlatImport({ lanes }, 50, profile);
  assert.ok(r.flatCrossing, r.warning);
  assert.equal(r.flatCrossing.independentRoutes, true);
  assert.doesNotThrow(() => checkProject(saved(lanes, r.flatCrossing)));
  assert.deepEqual(
    r.flatCrossing.sections.map((s) => s.lanes.length),
    [2, 2],
  );
  assert.equal(r.flatCrossing.crossings.length, 1);
  assert.deepEqual(r.flatCrossing.crossings[0].point, [0, 0]);
  assert.deepEqual(
    [
      r.flatCrossing.crossings[0].firstLocal,
      r.flatCrossing.crossings[0].secondLocal,
    ],
    [0.5, 0.5],
  );
});

test('malformed crossing data cannot redirect sides, invent intersections or silently discard crossings', () => {
  const lanes = [
    [
      [-200, 0],
      [200, 0],
    ],
    [
      [0, -200],
      [0, 200],
    ],
  ];
  const { flatCrossing } = inspectFlatImport({ lanes }, 50, profile);
  const changes = [
    (f) => {
      f.sections[1].sides[0][0][0] += 12;
    },
    (f) => {
      f.sections[1].lanes[0].pop();
    },
    (f) => {
      f.sections[0].start = 0.9;
    },
    (f) => {
      f.crossings[0].firstLocal = 0.2;
    },
    (f) => {
      f.crossings[0].firstSection = 2;
    },
    (f) => {
      f.crossings[0].point[0] = 12;
    },
    (f) => {
      f.crossings[0].upperPass = 'both';
    },
    (f) => {
      f.crossings[0].firstDirection.reverse();
    },
    (f) => {
      f.crossings[0].secondDirection = [1e100, 0];
    },
    (f) => {
      f.crossings.push(f.crossings[0]);
    },
    (f) => {
      f.crossings = [];
    },
    (f) => {
      f.sections = Array(66).fill(f.sections[0]);
    },
    (f) => {
      f.independentRoutes = 'yes';
    },
  ];
  for (const change of changes) {
    const p = saved(lanes, flatCrossing);
    change(p.track.plan.flatCrossing);
    assert.throws(() => checkProject(p), /crossing|path/i);
  }
  const ordinary = { lanes: [lanes[0]], outlines: [], sides: [[[NaN, 0]], []] };
  assert.equal(
    importedTrackPaths(profile, ordinary).path.widthAt(0),
    profile.width,
  );
});

test('plain roads retain the existing import flow and disconnected arms are actionable', () => {
  assert.equal(
    inspectFlatImport(
      {
        lanes: [
          [
            [0, 0],
            [10, 0],
          ],
          [
            [0, 8],
            [10, 8],
          ],
        ],
      },
      30,
      profile,
    ),
    null,
  );
  const rays = [
    [-50, -50],
    [50, -50],
    [50, 50],
    [-50, 50],
  ].map((end) => [[0, 0], end]);
  assert.match(
    inspectFlatImport({ lanes: rays }, 24, profile).warning,
    /continuous SLOT_CENTRES/,
  );
  assert.match(
    inspectFlatImport(
      {
        lanes: [
          [
            [0, 0],
            [200, 200],
            [0, 200],
            [200, 0],
          ],
        ],
      },
      4,
      profile,
    ).warning,
    /width above/,
  );
});

test('Circuit spot heights choose which passage goes over at a crossing', () => {
  const line = [
    [0, 0],
    [200, 200],
    [0, 200],
    [200, 0],
  ];
  const lower = [
      [0, 0, 0],
      [50, 50, 0],
      [150, 150, 0],
    ],
    upper = [
      [50, 150, 42],
      [150, 50, 42],
      [200, 0, 42],
    ];
  // A sample at the crossing point itself belongs to both passes; ignore it.
  const atCrossing = [[100, 100, 999]];
  for (const [heights, expected] of [
    [[...lower, ...upper, ...atCrossing], 'second'],
    [
      [
        ...lower.map(([x, y]) => [x, y, 42]),
        ...upper.map(([x, y]) => [x, y, 0]),
        ...atCrossing,
      ],
      'first',
    ],
  ]) {
    const result = inspectFlatImport({ lanes: [line], heights }, 30, profile);
    assert.ok(result.flatCrossing, result.warning);
    const [c] = result.flatCrossing.crossings;
    assert.equal(c.upperPass, expected);
    assert.equal(c.circuitHeightDifference, 42);
    assert.match(result.heightNote, /upper pass at the crossing \(42 mm/);
  }
  // Level heights leave the user's default choice in place.
  const level = inspectFlatImport(
    { lanes: [line], heights: lower.concat(upper).map(([x, y]) => [x, y, 5]) },
    30,
    profile,
  );
  assert.equal(level.flatCrossing.crossings[0].upperPass, 'second');
  assert.equal(level.heightNote, undefined);
});
