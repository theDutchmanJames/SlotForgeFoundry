import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {
  buildTrack,
  defaultTrack,
  nativePath,
  trackParameters,
  validateTrack,
} from '../src/track.js';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { printableSTL } from '../src/kit.js';
import { checkProject, newProject, printsFaceUp } from '../src/project.js';
import {
  SHARED_PROFILE_FIELDS,
  profileFromTrack,
  trackWithProfile,
  validateLibraryProfile,
} from '../src/library-profile.js';
import { plannerPrint } from '../src/planner-source.js';
import { specialTrackParams } from '../src/special-pieces.js';
import { diamondLayout, pointOnAxis } from '../src/geometry/special-junction-layout.js';
import { profileDiagram } from '../src/connection-controls.js';
import { trackInspector } from '../src/inspector.js';
import { toolGuides } from '../src/guide-geometry.js';
import { connectorLayout } from '../src/geometry/connector-layout.js';

const wasm = await Module();
wasm.setup();

const raised = (changes = {}) => ({
  ...defaultTrack(),
  kind: 'straight',
  width: 100,
  lanes: 1,
  length: 100,
  braidStyle: 'raised',
  ...changes,
});
function build(p, inspect) {
  const parts = buildTrack(wasm, p);
  try {
    return inspect(parts);
  } finally {
    parts.forEach((part) => part.solid.delete());
  }
}
// The height of the highest material at a point, seen from above.
const top = (solid, x, y, from = 30) => solid.rayCast([x, y, from], [x, y, -1])[0]?.position[2];
const near = (actual, expected, tolerance = 1e-3) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
const project = (params) => ({ mode: 'track', track: { params } });
// The solid as it lies on the bed, handed to a measurement in place of an STL writer.
const onBed = (part, params, measure, faceDown) =>
  printableSTL(part, (solid) => measure(solid), undefined, project(params), faceDown);
const area = (solid, z) => {
  const cut = solid.slice(z);
  try {
    return cut.area();
  } finally {
    cut.delete();
  }
};

test('a raised land stands on each side of the guide slot and leaves the slot open through it', () => {
  const p = raised({ hollow: false });
  const landTop = p.height + p.braidRaise;
  build(p, ([road]) => {
    assert.equal(road.solid.status(), 'NoError');
    const { min, max } = road.solid.boundingBox();
    near(max[2], landTop, 1e-6);
    // The cutters overrun each end; the land must stop on its own road.
    near(min[0], -p.length / 2, 1e-6);
    near(max[0], p.length / 2, 1e-6);
    near(
      road.solid.volume(),
      p.length * (p.width * p.height - p.slotWidth * p.slotDepth + 2 * p.braidWidth * p.braidRaise),
      0.01,
    );
    for (const side of [-1, 1]) {
      near(top(road.solid, 0, side * 4), landTop);
      near(top(road.solid, 10, side * (p.slotWidth / 2 + 0.05)), landTop);
      near(top(road.solid, 10, side * (p.slotWidth / 2 + p.braidWidth - 0.05)), landTop);
      near(top(road.solid, 10, side * (p.slotWidth / 2 + p.braidWidth + 0.05)), p.height);
    }
    // With no offset the band spans the slot; no land may bridge it.
    for (const y of [0, -1.4, 1.4]) near(top(road.solid, 10, y), p.height - p.slotDepth);
    near(area(road.solid, p.height + p.braidRaise / 2), 2 * p.braidWidth * p.length, 0.01);
  });
});

test('a braid offset keeps a road-height wall between the slot and each raised land, on hollow roads too', () => {
  const p = raised({ braidGap: 2, braidRaise: 0.4 });
  build(p, ([road]) => {
    assert.equal(road.solid.status(), 'NoError');
    const inner = p.slotWidth / 2 + p.braidGap;
    for (const side of [-1, 1]) {
      near(top(road.solid, 0, side * (p.slotWidth / 2 + 1)), p.height);
      near(top(road.solid, 0, side * (inner + 0.05)), p.height + 0.4);
      near(top(road.solid, 0, side * (inner + p.braidWidth - 0.05)), p.height + 0.4);
      near(top(road.solid, 0, side * (inner + p.braidWidth + 0.05)), p.height);
    }
    near(top(road.solid, 0, 0), p.height - p.slotDepth);
    // The deck under a land is as thick as anywhere else: nothing was cut.
    const under = road.solid.rayCast([20, inner + 2, 1], [20, inner + 2, 30])[0].position[2];
    near(under, p.height - p.deck);
  });
});

test('raised lands ignore the recess depth in the mesh and in every depth rule', () => {
  const shallow = raised({ hollow: false, braidDepth: 0 });
  const deep = raised({ hollow: false, braidDepth: 9 });
  assert.throws(
    () => validateTrack(trackParameters({ ...deep, braidStyle: 'recessed' })),
    /braid recess must stay within the deck/,
  );
  validateTrack(trackParameters(deep));
  const volumes = [shallow, deep].map((p) => build(p, ([road]) => road.solid.volume()));
  assert.equal(volumes[0], volumes[1]);
  // No pocket roof can meet a land, so a tab may sit under a strip where a
  // deep recess would cut into its socket.
  const jointed = raised({
    hollow: false, slotDepth: 10, braidDepth: 9, braidGap: 1, braidWidth: 20, joint: 'tabs',
    placements: { startTabs: [-14, 14], finishTabs: [-14, 14] },
  });
  assert.throws(
    () => buildTrack(wasm, { ...jointed, braidStyle: 'recessed' }),
    /A connector or its roof intersects a slot, braid recess or another pocket/,
  );
  assert.equal(connectorLayout(jointed, null, 'start').positions.tab.join(), '-14,14');
  build(jointed, ([road]) => {
    assert.equal(road.solid.status(), 'NoError');
    near(road.solid.boundingBox().max[2], jointed.height + jointed.braidRaise, 1e-6);
  });
});

test('braid feeds and their joins to the slot cut straight through a raised land', () => {
  for (const braidGap of [0, 1.5]) {
    const p = raised({
      length: 180, width: 140, lanes: 2, braidGap,
      braidFeedSide: 'left', braidFeedLane: 1, braidFeedStations: [0.25, 0.75],
    });
    build(p, ([road]) => {
      const lane = -p.laneSpacing / 2,
        strip = p.slotWidth / 2 + braidGap + p.braidWidth / 2;
      for (const x of [-45, 45]) {
        assert.equal(top(road.solid, x, lane + strip), undefined, 'the slit is open from above to the table');
        near(top(road.solid, x, lane - strip), p.height + p.braidRaise);
        near(top(road.solid, x, -lane + strip), p.height + p.braidRaise);
        near(top(road.solid, x, lane), p.height - p.slotDepth);
      }
      near(top(road.solid, 0, lane + strip), p.height + p.braidRaise);
    });
  }
});

test('segmented corners with clips and borders print raised lands on every road and none on a border', () => {
  const p = {
    ...defaultTrack(), braidStyle: 'raised', braidRaise: 0.3, braidGap: 0.6,
    segments: 2, joint: 'clips', borderSide: 'outer', borderMount: 'tabs',
    whiteLineRoad: 'both', roadCentreLine: 'dashed',
  };
  build(p, (parts) => {
    for (const part of parts) {
      assert.equal(part.solid.status(), 'NoError', part.id);
      const height = part.solid.boundingBox().max[2];
      if (part.role === 'road') near(height, p.height + 0.3, 1e-6);
      else if (part.role === 'border') near(height, p.height, 1e-6);
    }
    // Paint stays on the road surface, clear of every land.
    const path = nativePath(trackParameters(p));
    for (const road of parts.filter((part) => part.role === 'road'))
      for (const mark of road.kerbMarkings ?? [])
        for (const point of mark.points ?? []) near(point[2], p.height, 1e-6);
    const [x, y] = path.point(0.25, path.laneOffsets(0.25)[0] + p.slotWidth / 2 + 0.6 + 2.5);
    near(top(parts[0].solid, x, y), p.height + 0.3);
  });
});

test('the braid style and raised height are validated, and pit and timing pieces ask for a recess', () => {
  const check = (changes) => validateTrack(trackParameters(raised(changes)));
  check({});
  assert.throws(() => check({ braidStyle: 'proud' }), /Choose a recessed or a raised braid/);
  assert.throws(() => check({ braidRaise: 0.01 }), /braidRaise must be between 0.05 and 0.8/);
  assert.throws(() => check({ braidRaise: 1 }), /braidRaise must be between 0.05 and 0.8/);
  for (const [type, name] of [['pit', 'pit lane'], ['timing', 'timing straight']]) {
    const p = specialTrackParams(type, { ...defaultTrack(), width: 200, laneSpacing: 100 });
    validateTrack(trackParameters(p));
    let error;
    try {
      validateTrack(trackParameters({ ...p, braidStyle: 'raised' }));
    } catch (e) {
      error = e;
    }
    assert.match(error.message, new RegExp('A ' + name + ' cannot have raised lands for copper tape'));
    assert.match(error.message, /Choose Cross-section → Braid recess → Recessed for this piece\./);
    assert.deepEqual(error.warning.setting, { tab: 'profile', field: 'braidStyle', label: 'Edit braid recess' });
  }
});

test('a pack shares the braid style and raised height, and ignores the recess depth while raised', () => {
  for (const key of ['braidStyle', 'braidRaise']) assert.ok(SHARED_PROFILE_FIELDS.includes(key), key);
  const track = { params: raised(), plan: null, sourceName: '' };
  const shared = profileFromTrack(track);
  assert.equal(shared.braidStyle, 'raised');
  assert.equal(shared.braidRaise, 0.2);
  validateLibraryProfile({ ...shared, braidDepth: 9 });
  assert.throws(
    () => validateLibraryProfile({ ...shared, braidStyle: 'recessed', braidDepth: 9 }),
    /braid recess must stay within the deck/,
  );
  assert.throws(() => validateLibraryProfile({ braidStyle: 'proud' }), /Choose a recessed or a raised braid/);
  assert.throws(() => validateLibraryProfile({ braidRaise: 2 }), /braidRaise must be between 0.05 and 0.8 mm/);
  const recessedPiece = { params: { ...defaultTrack(), kind: 'straight' }, plan: null, sourceName: '' };
  const applied = trackWithProfile(recessedPiece, { braidStyle: 'raised', braidRaise: 0.35 });
  assert.equal(applied.params.braidStyle, 'raised');
  assert.equal(applied.params.braidRaise, 0.35);
  // A project saved before the setting existed opens with recessed braids.
  const saved = newProject();
  delete saved.track.params.braidStyle;
  delete saved.track.params.braidRaise;
  const opened = checkProject(saved).track.params;
  assert.equal(opened.braidStyle, 'recessed');
  assert.equal(opened.braidRaise, 0.2);
});

test('pieces with raised lands always export driving face up, special pieces and planner prints included', () => {
  const hairpin = {
    ...defaultTrack(), width: 200, laneSpacing: 100, kind: 'curve', radius: 330, angle: 180,
    hollow: false, special: { type: 'hairpin', crossingAt: 0.25, isolation: 2 },
  };
  const footprint = (road) => {
    const section = road.solid.project();
    try {
      return section.area();
    } finally {
      section.delete();
    }
  };
  for (const [params, forced] of [
    [raised({ hollow: false }), false],
    [raised({ hollow: false }), true],
    [{ ...hairpin, braidStyle: 'raised' }, false],
  ]) {
    assert.equal(printsFaceUp(project(params)), true);
    build(params, (parts) => {
      const road = parts.find((part) => part.role === 'road');
      onBed(road, params, (solid) => {
        near(solid.boundingBox().min[2], 0, 1e-6);
        near(solid.boundingBox().max[2], params.height + params.braidRaise, 1e-5);
        // The whole underside lies on the bed, and only the lands reach the top.
        assert.ok(area(solid, 0.1) > 0.9 * footprint(road));
        assert.ok(area(solid, params.height + params.braidRaise / 2) < 0.2 * footprint(road));
      }, forced);
    });
  }
  // Recessed pieces keep their orientation: a special lies face down.
  assert.equal(printsFaceUp(project(hairpin)), false);
  assert.equal(printsFaceUp(project(raised({ braidWidth: 0 }))), false);
  build(hairpin, (parts) => {
    const road = parts.find((part) => part.role === 'road');
    onBed(road, hairpin, (solid) => {
      // Face down, the slots and recesses open onto the bed.
      assert.ok(area(solid, 0.1) < 0.95 * footprint(road));
      assert.ok(area(solid, hairpin.height - 0.1) > 0.95 * footprint(road));
    });
  });
  const track = { params: raised({ hollow: false }), plan: null };
  const [bytes] = plannerPrint(wasm, { track, items: [{ id: 'road-1', mirror: false }] });
  const printed = parseSTL(wasm, bytes);
  try {
    assert.ok(area(printed, 0.1) > 0.9 * 100 * 100);
    near(area(printed, track.params.height + 0.1), 2 * 5 * 100, 0.01);
  } finally {
    printed.delete();
  }
});

test('hairpin, duel and chicane pieces carry raised lands, with the hairpin insulation and feeds cut through them', () => {
  const base = { ...defaultTrack(), width: 200, laneSpacing: 100, braidStyle: 'raised', braidGap: 2 };
  for (const special of [
    { kind: 'curve', radius: 460, angle: 112, special: { type: 'duel', apex: 0.62 } },
    { kind: 'straight', length: 1200, special: { type: 'chicane', hand: 'left', offset: 150, entryRadius: 280, exitRadius: 330 } },
  ])
    build({ ...base, ...special }, (parts) => {
      for (const part of parts.filter((item) => item.role === 'road')) {
        assert.equal(part.solid.status(), 'NoError');
        near(part.solid.boundingBox().max[2], base.height + base.braidRaise, 1e-6);
      }
    });
  const p = { ...base, kind: 'curve', radius: 330, angle: 180, special: { type: 'hairpin', crossingAt: 0.25, isolation: 2 } };
  const path = nativePath(trackParameters(p));
  const landTop = p.height + p.braidRaise;
  build(p, ([road]) => {
    assert.equal(road.solid.status(), 'NoError');
    near(top(road.solid, ...path.point(p.special.crossingAt, 0)), p.height - p.slotDepth);
    for (const [i, lane] of path.measuredLanes.entries()) {
      const [first, last] = path.sites[i][0];
      for (const side of [-1, 1]) {
        const strip = side * (p.slotWidth / 2 + p.braidGap + p.braidWidth / 2);
        for (const [end, dir] of [[first, -1], [last, 1]]) {
          near(top(road.solid, ...lane.atOffset(end + (dir * 8) / lane.total, strip)), landTop);
          near(top(road.solid, ...lane.atOffset(end - (dir * 1.25) / lane.total, strip)), p.height);
          const feed = lane.atOffset(end + (dir * p.braidFeedLength) / (2 * lane.total), strip);
          const seen = top(road.solid, ...feed);
          assert.ok(seen === undefined || seen < p.height - p.deck + 1e-3, 'the terminal opens through the land and the deck');
        }
      }
    }
  });
});

test('a raised diamond interrupts every land at its insulating gaps and feeds each end from below', () => {
  const p = {
    ...specialTrackParams('diamond', { ...defaultTrack(), width: 200, laneSpacing: 100, height: 10, slotDepth: 8 }),
    hollow: false, braidGap: 2, braidStyle: 'raised', braidDepth: 3,
  };
  const { roads, gap } = diamondLayout(p);
  const strip = p.slotWidth / 2 + p.braidGap + p.braidWidth / 2;
  const landTop = p.height + p.braidRaise;
  build(p, (parts) => {
    for (const part of parts.filter((item) => item.role === 'road'))
      assert.equal(part.solid.status(), 'NoError');
    const core = parts.find((part) => part.id === 'road-1') ?? parts[0];
    const printed = parseSTL(wasm, encodeSTL(core.solid));
    try {
      near(printed.boundingBox().max[2], landTop, 1e-5);
      for (const { axis, laneData } of roads)
        for (const { d, crossings } of laneData)
          for (const crossing of crossings) {
            const at = (x, y = d) => top(printed, ...pointOnAxis(axis, x, y));
            near(at(crossing), p.height - p.slotDepth);
            for (const sign of [-1, 1])
              for (const side of [-1, 1]) {
                const y = d + side * strip;
                near(at(crossing + sign * (gap - 0.5), y), p.height);
                // The feed is as short as on a braid laid flush: the ignored depth adds nothing.
                assert.equal(at(crossing + sign * (gap + 0.6), y), undefined);
                near(at(crossing + sign * (gap + 2), y), landTop);
                near(at(crossing + sign * (gap + 2), d + side * (p.slotWidth / 2 + 1)), p.height);
              }
          }
    } finally {
      printed.delete();
    }
  });
});

test('the cross-section, its controls and the 3D guides follow the braid style', () => {
  const recessed = { ...defaultTrack(), kind: 'straight' };
  const lifted = { ...recessed, braidStyle: 'raised', braidRaise: 0.6 };
  const outline = (p) => /<path d="([^"]+)"/.exec(profileDiagram(p))[1];
  const heights = (p) => outline(p).slice(1, -1).split('L').map((xy) => Number(xy.split(' ')[1]));
  // Paper Y grows downwards: a land draws above the road line, a recess below it.
  const roadLine = heights(recessed)[0];
  assert.ok(Math.min(...heights(recessed)) === roadLine);
  assert.ok(Math.min(...heights(lifted)) < roadLine);
  assert.match(profileDiagram(lifted), /Copper tape/);
  assert.match(profileDiagram(recessed), />Braid</);

  const form = (p) => trackInspector({ track: { params: p } }, 'profile');
  const group = (html, style) =>
    new RegExp('<fieldset class="border-apex-fields" data-braid-style="' + style + '"( hidden disabled)?>').exec(html);
  assert.match(form(recessed), /<option value="raised" >Raised land for copper tape/);
  assert.equal(group(form(recessed), 'recessed')[1], undefined);
  assert.equal(group(form(recessed), 'raised')[1], ' hidden disabled');
  assert.equal(group(form(lifted), 'recessed')[1], ' hidden disabled');
  assert.equal(group(form(lifted), 'raised')[1], undefined);
  assert.match(form(lifted), /name="braidRaise" value="0.6"[^>]*min="0.05" max="0.8"/);
  assert.match(form(lifted), /always export driving face up/);

  const guide = (p, field) =>
    toolGuides({ mode: 'track', tab: 'profile', field, track: { params: p } }).find((g) => g.id === 'channel-profile');
  const cut = guide(recessed, 'braidDepth'),
    land = guide(lifted, 'braidRaise');
  assert.match(cut.text, /^Braid recess · 5 mm × 0.5 mm$/);
  assert.match(land.text, /^Raised land · 5 mm × 0.6 mm$/);
  const zs = (g) => g.paths.flat().map((point) => point[2]);
  assert.equal(Math.min(...zs(cut)), recessed.height - 0.5);
  assert.equal(Math.max(...zs(land)), lifted.height + 0.6);
  assert.equal(Math.min(...zs(land)), lifted.height);
});
