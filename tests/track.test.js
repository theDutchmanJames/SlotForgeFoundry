import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Module from 'manifold-3d';
import {
  buildTrack,
  buildTestJoint,
  borderWidth,
  chooseSegmentation,
  defaultTrack,
  fitPlate,
  nativeTrackPoint,
} from '../src/track.js';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { plateDiagram } from '../src/plate-preview.js';
import {
  parseConnectionControls,
  profileDiagram,
} from '../src/connection-controls.js';
import { parseDrawing } from '../src/imports.js';
import { importedTrackPaths } from '../src/geometry/import-track.js';
import { trackInspector, trackNavigation } from '../src/inspector.js';

const wasm = await Module();
wasm.setup();

test('every piece setting lives in exactly one section, once', () => {
  const project = { track: { params: { ...defaultTrack(), borderSide: 'outer' } } };
  const owners = new Map();
  const components = [
    ...trackNavigation('geometry').matchAll(/data-tab="([^"]+)"/g),
  ].map(([, id]) => id);
  assert.deepEqual(components, ['geometry', 'profile', 'borders', 'markings', 'trackside', 'joints', 'print']);
  for (const component of components) {
    const controls = trackInspector(project, component).matchAll(
      /\bname="([^"]+)"/g,
    );
    for (const [, name] of controls)
      owners.set(name, [...(owners.get(name) ?? []), component]);
  }
  const shared = [...owners].filter(([, tabs]) => tabs.length > 1);
  assert.deepEqual(Object.fromEntries(shared), {}, 'a setting shown twice');
  for (const [component, settings] of Object.entries({
    geometry: ['kind', 'radius', 'angle', 'width', 'lanes', 'laneSpacing'],
    trackside: ['tracksideSide', 'tracksideShape', 'tracksideRise', 'tracksideTabs', 'tracksideSegments', 'tracksideEnds', 'tracksideEndShape', 'tracksideFaceAngle'],
    markings: [
      'whiteLineRoad',
      'roadCentreLine',
      'roadLineGroove',
      'whiteLineBorder',
      'borderLineGroove',
      'roadKerbSide',
      'kerbEdge',
      'kerbWidth',
      'kerbLength',
      'kerbGroove',
      'whiteLineWidth',
      'grooveWidth',
      'grooveDepth',
    ],
    borders: [
      'innerApexWidth',
      'innerApexPercent',
      'outerApexWidth',
      'outerApexPercent',
    ],
    profile: ['braidFeedSide', 'slotDepth', 'deck'],
    joints: ['clipType', 'borderMount', 'joint', 'borderJoint'],
    print: ['segments', 'borderSegments'],
  })) {
    for (const setting of settings)
      assert.deepEqual(owners.get(setting), [component], setting);
  }
});

function checkBuild(profile, inspect, plan) {
  const parts = buildTrack(wasm, profile, plan);
  try {
    inspect(parts);
  } finally {
    parts.forEach((p) => p.solid.delete());
  }
}

function sample(solid, [x, y, z]) {
  const cube = wasm.Manifold.cube([0.1, 0.1, 0.1], true);
  const probe = cube.translate([x, y, z]);
  const common = probe.intersect(solid);
  try {
    return common.volume() > 0.0005;
  } finally {
    common.delete();
    probe.delete();
    cube.delete();
  }
}

function near(actual, expected, tolerance = 1e-5) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected}`,
  );
}

test('solid straight volume and hollow straight section reflect all slot, deck, and braid depths', () => {
  const p = {
    ...defaultTrack(),
    kind: 'straight',
    width: 100,
    lanes: 1,
    length: 100,
  };
  checkBuild({ ...p, hollow: false }, ([road]) => {
    const removed =
      p.length * (p.slotWidth * p.slotDepth + 2 * p.braidWidth * p.braidDepth);
    near(road.solid.volume(), p.width * p.length * p.height - removed, 0.01);
  });
  checkBuild(p, ([road]) => {
    const s = road.solid;
    assert.equal(
      sample(s, [0, 0, 6]),
      false,
      'guide blade has a clear channel',
    );
    assert.equal(
      sample(s, [0, 0, 4]),
      true,
      'guide channel has a supporting floor',
    );
    assert.equal(sample(s, [0, 0, 2]), false, 'air under the sleeve');
    assert.equal(sample(s, [0, 4, 11.8]), false, 'shallow braid recess');
    assert.equal(sample(s, [0, 4, 11]), true, 'braid rests on solid material');
    assert.equal(sample(s, [0, 23, 11.8]), true, 'running surface');
    assert.equal(sample(s, [12, 23, 5]), false, 'hollow under deck between ribs');
    assert.equal(sample(s, [0, 49, 5]), true, 'outer side wall');
  });
});

test('mated curved roads, tapered borders, and separate spring clips are closed, connected, and collision-free', () => {
  const p = {
    ...defaultTrack(),
    radius: 310,
    angle: 45,
    segments: 2,
    joint: 'both',
    borderSide: 'both',
    borderEntry: 40,
    borderApex: 49,
    borderExit: 42,
    borderSegments: 2,
    borderMount: 'both',
    borderJoint: 'both',
  };
  checkBuild(p, (parts) => {
    assert.equal(parts.filter((x) => x.role === 'road').length, 2);
    assert.equal(parts.filter((x) => x.role === 'border').length, 4);
    assert.ok(parts.some((x) => x.role === 'clip'));
    for (const part of parts) {
      const shells = part.solid.decompose();
      try {
        assert.equal(
          shells.length,
          1,
          part.id + ' must be one printable component',
        );
      } finally {
        shells.forEach((s) => s.delete());
      }
      assert.equal(part.solid.status(), 'NoError');
    }
    for (let i = 0; i < parts.length; ++i)
      for (let j = i + 1; j < parts.length; ++j) {
        const common = parts[i].solid.intersect(parts[j].solid);
        try {
          assert.ok(
            common.volume() < 0.001,
            'overlap between ' + parts[i].id + ' and ' + parts[j].id,
          );
        } finally {
          common.delete();
        }
      }
    assert.equal(borderWidth(p, 0), p.borderEntry);
    assert.equal(borderWidth(p, 0.5), p.borderApex);
    assert.equal(borderWidth(p, 1), p.borderExit);
  });
});

test('mating end cutout and protruding tab retain clearance; tabs count towards plate dimensions', () => {
  const p = {
    ...defaultTrack(),
    kind: 'straight',
    length: 199,
    width: 95,
    laneSpacing: 40,
    joint: 'tabs',
    connectorOffset: 36,
  };
  checkBuild(p, ([road]) => {
    assert.equal(sample(road.solid, [-97, 36, 5.5]), false);
    assert.equal(sample(road.solid, [103, 36, 5.5]), true);
    assert.equal(fitPlate(road.footprintXY, 200, 100).fits, false);
  });
  checkBuild({ ...p, segments: 2 }, (parts) => {
    assert.ok(parts.every((road) => fitPlate(road.footprintXY, 200, 100).fits));
  });
});

test('a narrow piece fits only after rotation; extremely large pieces and margins are rejected', () => {
  assert.equal(
    fitPlate(
      [
        [0, 0],
        [112, 0],
        [112, 12],
        [0, 12],
      ],
      100,
      100,
    ).fits,
    true,
  );
  assert.equal(
    fitPlate(
      [
        [0, 0],
        [140, 0],
        [140, 12],
        [0, 12],
      ],
      100,
      100,
    ).fits,
    false,
  );
  assert.equal(
    fitPlate(
      [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      100,
      100,
      0.01,
    ).fits,
    false,
  );
  assert.throws(() => fitPlate([], 200, 200), /empty/i);
  assert.throws(() => fitPlate([[0, 0]], 200, 200, 101), /plate dimensions/i);
});

test('segment preview rebuilds connector ends and checks each finished road, without changing border segmentation', () => {
  const profile = {
    kind: 'straight',
    length: 398,
    width: 95,
    laneSpacing: 40,
    joint: 'tabs',
    connectorOffset: 36,
    borderSide: 'outer',
    borderSegments: 1,
  };
  const plate = { width: 200, depth: 100, margin: 0 };
  // Two 199 mm bodies would fit until their male tabs are included.
  const result = chooseSegmentation(wasm, profile, null, plate, 'road-1');
  assert.deepEqual(result, { fits: true, key: 'segments', count: 3 });
  assert.equal(profile.borderSegments, 1);
  const impossible = chooseSegmentation(
    wasm,
    { ...profile, width: 350 },
    null,
    plate,
    'road-1',
  );
  assert.equal(impossible.fits, false);
  assert.match(impossible.reason, /width/);
});

test('plate diagram draws the projected triangle outline and marks overflow', () => {
  const part = {
    positions: new Float32Array([
      0, 0, 0, 80, 0, 0, 80, 80, 0, 30, 20, 0, 0, 80, 0,
    ]),
    indices: new Uint32Array([0, 1, 3, 1, 2, 3, 0, 3, 4]),
    footprintXY: [
      [0, 0],
      [80, 0],
      [80, 80],
      [0, 80],
    ],
  };
  const svg = plateDiagram(part, { width: 30, depth: 30, margin: 1 });
  assert.match(svg, /part exceeds usable area/);
  // The fifth corner is the inward notch, which the convex bed-fit hull omits.
  const path = svg.match(/<path d="([^"]+)"/)[1];
  assert.equal(path.split('L').length, 5);
  const dense = {
    ...part,
    indices: {
      length: 300000,
      get 0() {
        throw Error('Dense mesh was traversed on the UI thread');
      },
    },
  };
  const densePreview = plateDiagram(dense, { width: 30, depth: 30, margin: 1 });
  assert.match(densePreview, /Outer footprint/);
  assert.match(densePreview, /part exceeds usable area/);
  assert.match(svg, /mask="url\(#sf-bed-\d+-overflow\)"/);
});

test('exact plate orientation search checks between edge events on rectangular beds', () => {
  const triangle = [
    [0, 0],
    [85, 0],
    [0, 80],
  ];
  const optimum = fitPlate(triangle, 78, 101, 0);
  assert.ok(optimum.fits);
  const angle = (optimum.angle * Math.PI) / 180;
  const rotated = triangle.map(([x, y]) => [
    x * Math.cos(angle) - y * Math.sin(angle),
    x * Math.sin(angle) + y * Math.cos(angle),
  ]);
  for (const [i, limit] of [
    [0, 78],
    [1, 101],
  ]) {
    const span =
      Math.max(...rotated.map((p) => p[i])) -
      Math.min(...rotated.map((p) => p[i]));
    assert.ok(span < limit + 1e-5);
    near(span, i ? optimum.depth : optimum.width);
  }
});

test('the same real Circuit section in compact SVG and DXF generates equivalent road, border and clip geometry', async () => {
  const signatures = [];
  for (const file of ['circuit-curve-mm.dxf', 'circuit-curve-compact.svg']) {
    const contents = await readFile(
      new URL('drawings/' + file, import.meta.url),
      'utf8',
    );
    const plan = parseDrawing(contents, file);
    const profile = {
      kind: 'import',
      segments: 2,
      borderSide: 'both',
      borderSegments: 2,
      joint: 'both',
      ...plan.inferredWidths,
    };
    checkBuild(
      profile,
      (parts) => {
        assert.equal(parts.filter((p) => p.role === 'road').length, 2);
        assert.equal(parts.filter((p) => p.role === 'border').length, 4);
        signatures.push(parts.map((p) => p.solid.volume()));
      },
      plan,
    );
  }
  signatures[0].forEach((v, i) => near(v, signatures[1][i], 0.05));
});

test('printed tracks use the saved offset as wall width and keep each braid recess at its specified width', async () => {
  assert.equal(defaultTrack().braidGap, 0);
  const file = 'circuit-curve-mm.dxf';
  const plan = parseDrawing(
    await readFile(new URL('drawings/' + file, import.meta.url), 'utf8'),
    file,
  );
  const layouts = [
    { kind: 'straight', braidGap: 0 },
    { kind: 'curve', braidGap: 0.4 },
    { kind: 'straight', braidGap: 2, braidWidth: 5 },
    { kind: 'import', ...plan.inferredWidths },
  ];
  for (const layout of layouts) {
    const p = { ...defaultTrack(), lanes: 1, ...layout };
    const imported = p.kind === 'import';
    const lanes = imported
      ? importedTrackPaths(p, plan).path.measuredLanes.map(
          (lane) => (t, d) => lane.atOffset(t, d),
        )
      : [(t, d) => nativeTrackPoint(p, t, d)];
    checkBuild(
      p,
      ([road]) => {
        const printed = parseSTL(wasm, encodeSTL(road.solid));
        try {
          for (const point of lanes)
            for (const t of [0.1, 0.47, 0.88])
              for (const sign of [-1, 1]) {
                const half = p.slotWidth / 2,
                  inner = half + p.braidGap,
                  outer = inner + p.braidWidth;
                for (const [offset, height] of [
                  [half - 0.12, p.height - p.slotDepth],
                  ...(p.braidGap ? [[half + 0.11, p.height], [inner - 0.11, p.height]] : []),
                  [inner + 0.11, p.height - p.braidDepth],
                  [outer - 0.12, p.height - p.braidDepth],
                  [outer + 0.12, p.height],
                ]) {
                  const xy = point(t, sign * offset);
                  const hit = printed.rayCast(
                    [...xy, p.height + 1],
                    [...xy, -1],
                  )[0];
                  assert.ok(hit);
                  near(hit.position[2], height);
                }
              }
        } finally {
          printed.delete();
        }
      },
      imported ? plan : undefined,
    );
  }
});

test('reject profiles that pierce the base, fold a tight inner border or place sockets through slots', () => {
  assert.throws(() => buildTrack(wasm, { slotDepth: 11.5 }), /below the guide/);
  assert.throws(
    () => buildTrack(wasm, { radius: 90, borderSide: 'inner', borderApex: 30 }),
    /centre of the bend/,
  );
  assert.throws(
    () => buildTrack(wasm, { joint: 'tabs', connectorOffset: 32.5 }),
    /Tab offset from centre/,
  );
});

test('a disabled braid ignores its saved offset when fitting the remaining guide slots', () => {
  const p = { ...defaultTrack(), kind: 'straight', width: 40, laneSpacing: 20, braidWidth: 0, braidGap: 30 };
  checkBuild(p, ([road]) => {
    for (const y of [-10, 10]) {
      const top = (offset) => road.solid.rayCast([0, y + offset, p.height + 1], [0, y + offset, -1])[0].position[2];
      near(top(0), p.height - p.slotDepth);
      near(top(p.slotWidth / 2 + 0.1), p.height);
    }
  });
});

test('changing a shared quantity clears only its per-side count overrides', () => {
  const track = { connectorCounts: {
    seamClips: 3, innerSideClips: 1, outerSideClips: 2, innerSideTabs: 2,
  } };
  const fields = { count_seamClips: '3', count_sideClips: '2', place_seamTabs: '0' };
  const result = parseConnectionControls(fields, track, {count_sideClips: '2'});
  assert.deepEqual(result.connectorCounts, { seamClips: 3, sideClips: 2, innerSideTabs: 2 });
  assert.deepEqual(result.placements, { seamTabs: [0] });
  assert.equal(track.connectorCounts.innerSideClips, 1);
  const legacy = parseConnectionControls({ count_seamClips: '', place_seamTabs: '' });
  assert.equal(legacy.connectorCounts, undefined);
});

test('manual road and shoulder layouts position real geometry at signed offsets and percent stations', () => {
  const fields = parseConnectionControls({
    place_startTabs: '-59, 19',
    place_finishTabs: '-18,58',
    place_seamTabs: '-58,50',
    place_startClips: '2',
    place_seamClips: '12',
    place_finishClips: '0',
    place_sideTabs: '22,79',
    place_sideClips: '49',
    place_endTabs: '25',
    place_endClips: '69',
  });
  const p = {
    ...defaultTrack(),
    ...fields,
    clipType: 'draw-key',
    kind: 'straight',
    length: 240,
    segments: 2,
    borderSide: 'outer',
    borderSegments: 2,
    borderEntry: 36,
    borderApex: 36,
    borderExit: 36,
    joint: 'both',
    borderMount: 'both',
    borderJoint: 'both',
  };
  checkBuild(p, (parts) => {
    const get = (id) => parts.find((x) => x.id === id).solid;
    assert.equal(
      sample(get('road-1'), [-119, -59, 5]),
      false,
      'start socket at chosen offset',
    );
    assert.equal(
      sample(get('road-1'), [-119, -48, 5]),
      true,
      'wall beside the socket stays closed',
    );
    assert.equal(
      sample(get('road-1'), [3, -58, 5]),
      true,
      'internal seam tab at its own offset',
    );
    assert.equal(
      sample(get('road-2'), [123, 58, 5]),
      true,
      'outside finish tab at separate offset',
    );
    assert.equal(
      sample(get('road-1'), [-93.6, 73, 5]),
      true,
      'side tab at 22%',
    );
    const centre = (id, axis) => {
      const b = get(id).boundingBox();
      return (b.min[axis] + b.max[axis]) / 2;
    };
    near(centre('side-clip-outer-1', 0), -61.2, 0.001);
    near(centre('road-clip-1', 1), 12, 0.001);
    near(centre('end-clip-outer-1', 1), 70 + 36 * 0.69, 0.001);
  });
  assert.throws(
    () =>
      buildTrack(wasm, {
        ...p,
        placements: { ...p.placements, seamClips: [-58] },
      }),
    /overlaps the space reserved for another connector/,
  );
  assert.throws(
    () =>
      buildTrack(wasm, {
        ...p,
        placements: { ...p.placements, sideClips: [0.22] },
      }),
    /too close/,
  );
  assert.throws(
    () => parseConnectionControls({ place_endTabs: '90,' }),
    /commas/,
  );
  assert.throws(
    () => parseConnectionControls({ place_sideTabs: '0, 100' }),
    /percentages/,
  );
});

test('profile drawing changes for a solid deck and reports the schematic imported-lane slice', () => {
  const p = defaultTrack();
  const outline = (q) => profileDiagram(q).match(/<path d="([^"]+)"/)[1];
  assert.notEqual(outline(p), outline({ ...p, hollow: false }));
  assert.notEqual(outline(p), outline({ ...p, slotWidth: 5 }));
  assert.match(
    profileDiagram({ ...p, kind: 'import' }),
    /One-lane profile detail/,
  );
});

test('braid feeds open only the chosen shelf and lane and keep the guide slot supported', () => {
  const fields = parseConnectionControls({
    braidFeedSide: 'left',
    braidFeedLane: 1,
    feedPercent: '25, 75',
  });
  const p = {
    ...defaultTrack(),
    ...fields,
    kind: 'straight',
    length: 180,
    braidGap: 0.4,
  };
  checkBuild(p, ([road]) => {
    for (const x of [-45, 45]) {
      assert.equal(
        sample(road.solid, [x, -28, 11]),
        false,
        'chosen braid floor opens',
      );
      assert.equal(
        sample(road.solid, [x, -37, 11]),
        true,
        'opposite shelf stays intact',
      );
      assert.equal(
        sample(road.solid, [x, 37, 11]),
        true,
        'other lane stays intact',
      );
      assert.equal(
        sample(road.solid, [x, -30.8, 7]),
        true,
        'the specified feed offset preserves the slot wall below the braid shelf',
      );
      assert.equal(
        sample(road.solid, [x, -32.5, 4]),
        true,
        'slot floor remains solid',
      );
      assert.equal(
        sample(road.solid, [x, -32.5, 7]),
        false,
        'guide channel stays open',
      );
    }
    assert.equal(
      sample(road.solid, [0, -28, 11]),
      true,
      'braid still has support between openings',
    );
  });
  assert.throws(
    () => buildTrack(wasm, { ...p, braidFeedStations: [0.5], segments: 2 }),
    /end wall or segment seam/,
  );
  assert.throws(
    () => buildTrack(wasm, { ...p, braidFeedStations: [0.25, 0.252] }),
    /pass-throughs overlap/,
  );
});

test('the full braid opening runs vertically through hollow and solid roads in the exported STL', () => {
  const p = {
    ...defaultTrack(),
    kind: 'straight',
    lanes: 1,
    braidFeedSide: 'left',
    braidFeedStations: [0.5],
    braidFeedLength: 4.5,
    braidWidth: 5.5,
  };
  for (const [hollow, braidGap] of [
    [true, 0],
    [false, 0],
    [true, 0.4],
    [false, 0.4],
  ]) {
    const inside = p.slotWidth / 2 + braidGap;
    checkBuild({ ...p, hollow, braidGap }, ([road]) => {
      const printed = parseSTL(wasm, encodeSTL(road.solid));
      // A rigid rectangular gauge just inside all four edges must reach from
      // above the braid recess to below the table plane without touching stock.
      const gauge = wasm.Manifold.cube(
        [p.braidFeedLength - 0.02, p.braidWidth - 0.02, p.height + 2],
        true,
      );
      const placed = gauge.translate([
        0,
        inside + p.braidWidth / 2,
        p.height / 2,
      ]);
      const interference = placed.intersect(printed);
      try {
        near(interference.volume(), 0, 1e-7);
        // The slit ends and outer wall remain supported. At zero offset
        // its inner edge opens straight into the guide above the slot floor.
        const z = p.height - p.braidDepth - 0.3;
        for (const x of [-1, 1]) {
          assert.equal(
            sample(printed, [
              x * (p.braidFeedLength / 2 + 0.12),
              inside + 1,
              z,
            ]),
            true,
          );
        }
        assert.equal(sample(printed, [0, inside - 0.12, z]), braidGap > 0);
        assert.equal(sample(printed, [0, inside - 0.12, p.height - 0.1]), braidGap > 0);
        assert.equal(
          sample(printed, [0, inside - 0.12, p.height - p.slotDepth - 0.2]),
          true,
        );
        assert.equal(
          sample(printed, [0, inside + p.braidWidth + 0.12, z]),
          true,
        );
      } finally {
        interference.delete();
        placed.delete();
        gauge.delete();
        printed.delete();
      }
    });
  }
});

test('both braid apertures on a bend follow the lane in XY and stay straight down', () => {
  const t = 0.31;
  const p = {
    ...defaultTrack(),
    kind: 'curve',
    lanes: 1,
    angle: 70,
    braidFeedSide: 'both',
    braidFeedStations: [t],
    braidFeedLength: 6,
  };
  const length = (p.radius * p.angle * Math.PI) / 180;
  const edge = p.slotWidth / 2 + p.braidGap;
  checkBuild(p, ([road]) => {
    for (const side of [-1, 1]) {
      for (const along of [-2.6, 0.13, 2.6]) {
        for (const across of [0.15, p.braidWidth / 2, p.braidWidth - 0.15]) {
          const xy = nativeTrackPoint(
            p,
            t + along / length,
            side * (edge + across),
          );
          assert.equal(
            road.solid.rayCast([...xy, p.height + 1], [...xy, -1]).length,
            0,
          );
        }
      }
      const outside = nativeTrackPoint(p, t + 3.3 / length, side * (edge + 1));
      assert.equal(
        sample(road.solid, [...outside, p.height - p.braidDepth - 0.3]),
        true,
      );
    }
    const centre = nativeTrackPoint(p, t, 0);
    assert.equal(
      sample(road.solid, [...centre, p.height - p.slotDepth - 0.3]),
      true,
    );
  });
});

test('Circuit feeds follow both mitered braid shelves without piercing the slot floor at a corner', () => {
  const open = [
    [-50, 0],
    [0, 0],
    [0, 50],
  ];
  const loop = [...open, [-50, 50], [-50, 0]];
  const outlines = [
    [
      [-60, -20],
      [20, -20],
      [20, 60],
      [-60, 60],
    ],
  ];
  for (const [lane, station] of [
    [open, 0.5],
    [loop, 0.25],
  ]) {
    const p = {
      ...defaultTrack(),
      kind: 'import',
      braidFeedSide: 'both',
      braidFeedStations: [station],
      braidFeedLength: 3,
      braidGap: 0.4,
    };
    checkBuild(
      p,
      ([road]) => {
        const hits = (x, y) =>
          road.solid.rayCast([x, y, p.height + 1], [x, y, -1]);
        for (const sign of [-1, 1]) {
          // At this right-angle turn each physical miter is offset by the full
          // shelf distance along both coordinates. A unit bisector erases part
          // of the slot floor at 1.4 mm and the wall beside each edge.
          near(
            hits(-sign * 1.4, sign * 1.42)[0].position[2],
            p.height - p.slotDepth,
          );
          near(
            hits(-sign * 1.72, sign * 1.74)[0].position[2],
            p.height,
          );
          for (const d of [2.0, 3.1, 6.7])
            assert.equal(hits(-sign * d, sign * (d + 0.03)).length, 0);
        }
      },
      { outlines, lanes: [lane] },
    );
  }
});

test('joint sample keeps the real profile and offset, only the internal mating hardware, and curve radius', () => {
  const p = {
    ...defaultTrack(),
    kind: 'straight',
    length: 630,
    joint: 'none',
    jointStart: 'both',
    placements: { startTabs: [-57, 20], startClips: [0] },
    borderSide: 'outer',
    braidFeedSide: 'both',
  };
  const sampleParts = buildTestJoint(wasm, p);
  try {
    assert.equal(sampleParts.length, 4);
    assert.equal(sampleParts.filter((p) => p.role === 'road').length, 2);
    assert.equal(sampleParts.filter((p) => p.role === 'clip').length, 1);
    assert.equal(sampleParts.filter((p) => p.role === 'retainer').length, 1);
    const first = sampleParts[0].solid,
      second = sampleParts[1].solid;
    near(first.boundingBox().min[0], -24);
    near(second.boundingBox().max[0], 24);
    assert.ok(sample(first, [3, -57, 5]));
    assert.equal(sample(second, [3, -57, 5]), false);
  } finally {
    sampleParts.forEach((part) => part.solid.delete());
  }
  const curved = buildTestJoint(wasm, { ...p, kind: 'curve', joint: 'clips' });
  try {
    const b = curved[0].solid.boundingBox();
    assert.ok(
      b.min[1] < -p.width / 2,
      'native bend geometry and radius are preserved',
    );
  } finally {
    curved.forEach((part) => part.solid.delete());
  }
  assert.throws(
    () => buildTestJoint(wasm, defaultTrack()),
    /Choose tabs or clips/,
  );
});

test('a corner over 355° with end connectors is refused with a clear reason', () => {
  const base = { ...defaultTrack().params, kind: 'curve', radius: 400, segments: 1, joint: 'tabs' };
  assert.throws(() => buildTrack(wasm, { ...base, angle: 358 }), /at most 355°/);
  const plain = buildTrack(wasm, { ...base, angle: 358, joint: 'none' });
  plain.forEach((part) => part.solid.delete());
});
