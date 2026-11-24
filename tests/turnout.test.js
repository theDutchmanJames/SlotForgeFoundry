import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { buildTrack, defaultTrack, trackParameters, validateTrack } from '../src/track.js';
import {
  SPECIAL_PIECES,
  specialAssemblyNotes,
  specialPreview,
  specialTrackParams,
} from '../src/special-pieces.js';
import {
  packSpecialTrack,
  plannerCanPlace,
  shelfSpecialsFor,
  specialsFor,
} from '../src/pack-specials.js';
import { plannerSource } from '../src/planner-source.js';
import { groupTrackParts } from '../src/track-parts.js';
import {
  TURNOUT_INSERT,
  TURNOUT_MODES,
  turnoutClearAngle,
  turnoutLayout,
} from '../src/geometry/turnout-layout.js';
import { wiringDiagram } from '../src/special-print.js';
import { buildCarRoutes } from '../src/car-placement.js';

const wasm = await Module();
wasm.setup();

const MODES = TURNOUT_MODES.map(([id]) => id);
const rules = { width: 100, lanes: 1, laneSpacing: 100, r1InnerRadius: 250, angle: 30 };
const straight = {
  ...defaultTrack(),
  kind: 'straight',
  lanes: 1,
  width: 100,
  length: 300,
};
function turnout(special = {}, changes = {}) {
  const p = specialTrackParams('turnout', { ...straight, ...changes }, rules);
  p.special = { ...p.special, ...special };
  return p;
}
function assembly(p, inspect) {
  const parts = buildTrack(wasm, p);
  try {
    return inspect(parts);
  } finally {
    parts.forEach((part) => part.solid.delete());
  }
}
const byRole = (parts, role) => parts.filter((part) => part.role === role);
const near = (actual, expected, tolerance = 1e-3) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    'expected ' + expected + ' ± ' + tolerance + '; measured ' + actual,
  );
// The height of the first surface met from above, or undefined over a hole.
const top = (solid, [x, y]) => solid.rayCast([x, y, 40], [x, y, -5])[0]?.position[2];
function area(a, b) {
  const both = a.intersect(b);
  try {
    return both.area();
  } finally {
    both.delete();
  }
}

test('the turnout is the pack R1 curve, turned through enough pack curves to clear the main road', () => {
  const p = turnout();
  assert.equal(p.kind, 'straight');
  assert.equal(p.segments, 1);
  assert.equal(p.borderSide, 'none');
  near(p.special.turnoutRadius, rules.r1InnerRadius + rules.width / 2, 1e-6);
  // 30° does not clear a 100 mm road on this radius; two curves do.
  const need = turnoutClearAngle(p.width, p.special.turnoutRadius);
  assert.ok(need > 30 && need < 60, 'clear angle ' + need);
  near(p.special.turnoutAngle, 60, 1e-6);
  assert.equal(p.special.turnoutMode, 'digital');
  assert.equal(p.special.turnoutLead, 20);
  assert.doesNotThrow(() => validateTrack(trackParameters(p)));
  // Without pack rules it falls back to 300 mm and a multiple of 30°.
  const loose = specialTrackParams('turnout', straight);
  assert.equal(loose.special.turnoutRadius, 300);
  assert.equal(loose.special.turnoutAngle % 30, 0);
  assert.doesNotThrow(() => validateTrack(trackParameters(loose)));
  // Clips reach further into the entry than tabs, so the branch starts later.
  assert.ok(turnout({}, { joint: 'clips' }).special.turnoutLead > 20);
});

test('every insert builds printable solids for a left and a right turnout', () => {
  for (const side of ['left', 'right'])
    for (const mode of MODES)
      for (const hollow of [true, false])
        assembly(turnout({ side, turnoutMode: mode }, { hollow }), (parts) => {
          const label = [side, mode, hollow ? 'hollow' : 'solid'].join(' ');
          for (const part of parts) {
            assert.equal(part.solid.status(), 'NoError', label + ' ' + part.id);
            assert.ok(part.solid.volume() > 0, label + ' ' + part.id);
            assert.equal(part.solid.decompose().length, 1, label + ' ' + part.id + ' is one piece');
          }
          assert.equal(byRole(parts, 'road').length, 1, label);
          const [insert] = byRole(parts, 'turnoutInsert');
          assert.ok(insert, label);
          assert.equal(insert.turnoutMode, mode);
          // It prints on its flat underside, which rests on the table.
          near(insert.solid.boundingBox().min[2], 0, 1e-6);
          const blade = mode === 'digital' || mode === 'manual';
          assert.equal(byRole(parts, 'turnout').length, blade ? 1 : 0, label);
          assert.equal(byRole(parts, 'turnoutArm').length, mode === 'digital' ? 1 : 0, label);
          // A blade turns in its bearing; a hand-set one also has a plain pin.
          assert.equal(
            byRole(parts, 'turnoutBearing').length,
            mode === 'digital' ? 1 : mode === 'manual' ? 2 : 0,
            label,
          );
        });
});

test('the hand-set point has the digital blade and bearing, a pivot pin and no crank or pushrod bay', () => {
  const measure = (mode) =>
    assembly(turnout({ turnoutMode: mode }), (parts) => ({
      blade: byRole(parts, 'turnout')[0].solid.volume(),
      bearing: parts.find((part) => /bearing/.test(part.id)).solid.volume(),
      insert: byRole(parts, 'turnoutInsert')[0].solid.volume(),
      ids: parts.map((part) => part.id),
      upright: parts.find((part) => /pin/.test(part.id))?.printsUpright,
    }));
  const digital = measure('digital'),
    manual = measure('manual');
  near(manual.blade, digital.blade, 1e-3);
  near(manual.bearing, digital.bearing, 1e-3);
  assert.ok(manual.ids.includes('turnout-pin-left'));
  assert.ok(!manual.ids.some((id) => /crank/.test(id)));
  assert.equal(manual.upright, true);
  // No crank bay and no pushrod channel leaves more insert.
  assert.ok(manual.insert > digital.insert + 100);
});

test('the road body is the same solid whichever insert is fitted', () => {
  for (const side of ['left', 'right']) {
    const roads = MODES.map((mode) =>
      assembly(turnout({ side, turnoutMode: mode }, { joint: 'tabs' }), (parts) => {
        const [road] = byRole(parts, 'road');
        const box = road.solid.boundingBox();
        return {
          volume: road.solid.volume(),
          surface: road.solid.surfaceArea(),
          genus: road.solid.genus(),
          box: [...box.min, ...box.max],
        };
      }),
    );
    for (const road of roads.slice(1)) {
      near(road.volume, roads[0].volume, 1e-3);
      near(road.surface, roads[0].surface, 1e-3);
      assert.equal(road.genus, roads[0].genus);
      road.box.forEach((value, i) => near(value, roads[0].box[i], 1e-6));
    }
  }
  // The blade's position does not change the road either.
  const [main, branch] = ['main', 'pit'].map((turnoutPosition) =>
    assembly(turnout({ turnoutPosition }), (parts) => byRole(parts, 'road')[0].solid.volume()),
  );
  near(branch, main, 1e-3);
});

test('no part of a turnout overlaps another, in either blade position', () => {
  // There is no designed interference: every fit is a clearance fit. The
  // detent of the hand-set blade only touches the blade while it is moved.
  for (const mode of MODES)
    for (const turnoutPosition of ['main', 'pit'])
      assembly(turnout({ turnoutMode: mode, turnoutPosition }, { joint: 'clips' }), (parts) => {
        for (let i = 0; i < parts.length; i++)
          for (let j = i + 1; j < parts.length; j++) {
            const both = parts[i].solid.intersect(parts[j].solid);
            try {
              assert.ok(
                both.volume() < 1e-3,
                [mode, turnoutPosition, parts[i].id, parts[j].id, both.volume()].join(' '),
              );
            } finally {
              both.delete();
            }
          }
      });
});

test('the three road ends are where the layout says, each with its own connectors', () => {
  for (const side of ['left', 'right']) {
    const p = turnout({ side }, { joint: 'tabs' });
    const sign = side === 'left' ? 1 : -1;
    const { ends, tangentPoint } = turnoutLayout(p);
    const R = p.special.turnoutRadius,
      sweep = (p.special.turnoutAngle * Math.PI) / 180;
    near(ends.entry.point[0], -p.length / 2, 1e-9);
    near(ends.main.point[0], p.length / 2, 1e-9);
    near(tangentPoint[0], -p.length / 2 + p.special.turnoutLead, 1e-9);
    near(ends.branch.point[0], tangentPoint[0] + R * Math.sin(sweep), 1e-6);
    near(ends.branch.point[1], sign * R * (1 - Math.cos(sweep)), 1e-6);
    near(ends.branch.tangent[0], Math.cos(sweep), 1e-9);
    near(ends.branch.tangent[1], sign * Math.sin(sweep), 1e-9);
    assembly(p, (parts) => {
      const [road] = byRole(parts, 'road');
      const half = p.width / 2 - 3;
      for (const [name, { point, tangent }] of Object.entries(ends)) {
        const across = [-tangent[1], tangent[0]];
        for (const d of [-half, half]) {
          const at = (along) => [
            point[0] + along * tangent[0] + d * across[0],
            point[1] + along * tangent[1] + d * across[1],
          ];
          // Road just inside the end face, nothing just outside it.
          near(top(road.solid, at(-1.5)), p.height, 1e-3);
          assert.equal(top(road.solid, at(0.5)), undefined, side + ' ' + name);
        }
        // Two tabs or sockets on the face of this end.
        const onFace = road.jointGuides.filter(
          (g) =>
            Math.abs((g.point[0] - point[0]) * tangent[0] + (g.point[1] - point[1]) * tangent[1]) < 0.01 &&
            Math.hypot(g.point[0] - point[0], g.point[1] - point[1]) < p.width / 2,
        );
        assert.equal(onFace.length, 2, side + ' ' + name + ' connectors');
      }
    });
  }
});

test('the entry connectors sit where they do on a plain straight of the pack', () => {
  const base = { ...straight, joint: 'clips' };
  const clips = (p) =>
    assembly(p, (parts) =>
      byRole(parts, 'road')[0]
        .jointGuides.filter((g) => g.kind === 'Clip' && Math.abs(g.point[0] + p.length / 2) < 0.01)
        .map((g) => g.point[1]),
    );
  const plain = clips(base);
  for (const side of ['left', 'right']) {
    const mine = clips(turnout({ side }, { joint: 'clips' }));
    assert.equal(mine.length, plain.length);
    mine.forEach((y, i) => near(y, plain[i], 1e-6));
  }
  // The branch end has loose clips of its own.
  assembly(turnout({}, { joint: 'clips' }), (parts) => {
    assert.ok(parts.some((part) => part.id === 'road-clip-1'));
    assert.ok(parts.some((part) => part.id === 'branch-road-clip-1'));
  });
});

test('Closed fills the branch slot to the road surface; Analog and Digital leave it open', () => {
  const p0 = turnout();
  const { fork, branch } = turnoutLayout(p0);
  const floor = p0.height - p0.slotDepth;
  // Points on the branch slot inside the insert, behind the blade pivot.
  const probes = branch.filter(([x]) => x > fork.heel[0] + 3 && x < fork.guardEndX - 3);
  assert.ok(probes.length > 3);
  const mainProbe = [fork.heel[0], 0];
  for (const mode of ['closed', 'analog', 'digital'])
    assembly(turnout({ turnoutMode: mode }), (parts) => {
      const insert = byRole(parts, 'turnoutInsert')[0].solid;
      const road = byRole(parts, 'road')[0].solid;
      for (const q of probes) {
        // The fixed road is open above the branch slot in every mode.
        assert.equal(top(road, q), undefined, mode);
        near(top(insert, q), mode === 'closed' ? p0.height : floor, 1e-3);
      }
      // The main slot stays open in every mode.
      near(top(insert, mainProbe), floor, 1e-3);
      assert.equal(top(road, mainProbe), undefined);
    });
  // Analog has a fixed island between the two slots that reaches the surface.
  assembly(turnout({ turnoutMode: 'analog' }), (parts) => {
    const insert = byRole(parts, 'turnoutInsert')[0].solid;
    // In front of where the blade pivot would be, halfway between the slots.
    const q = branch.find(([x]) => x > fork.heel[0] - 10);
    near(top(insert, [q[0], q[1] / 2]), p0.height, 1e-3);
    assert.equal(top(byRole(parts, 'road')[0].solid, [q[0], q[1] / 2]), undefined);
  });
});

test('the insert goes up into its pocket: at every height it fits the road opening below it', () => {
  for (const side of ['left', 'right'])
    for (const mode of MODES)
      assembly(turnout({ side, turnoutMode: mode }), (parts) => {
        const road = byRole(parts, 'road')[0].solid;
        const insert = byRole(parts, 'turnoutInsert')[0].solid;
        const p = turnout();
        const roofBottom = p.height - p.braidDepth - TURNOUT_INSERT.roof;
        const heights = [0.3, 1.2, 2.2, 3, 4.5, 6, 8, 10, roofBottom - 0.1, roofBottom + 0.1, 11.3, p.height - 0.05];
        // Work down from the top. Everything of the insert above a level has
        // to pass through the road at that level.
        let above = null;
        for (const z of heights.slice().reverse()) {
          const slice = insert.slice(z);
          const next = above ? above.add(slice) : slice;
          if (above) {
            above.delete();
            slice.delete();
          }
          above = next;
          const opening = road.slice(z);
          try {
            assert.ok(area(above, opening) < 0.02, [side, mode, 'z', z, area(above, opening)].join(' '));
          } finally {
            opening.delete();
          }
        }
        above.delete();
        // The block stops at the underside of the fixed roof; only what shows
        // at the road surface comes through.
        const top = insert.boundingBox().max[2];
        if (mode === 'analog' || mode === 'closed') near(top, p.height, 1e-6);
        else near(top, roofBottom, 1e-6);
        // 0.15 mm all round: the insert is narrower than the pocket by twice that.
        const mid = insert.slice(4.5),
          gapProbe = road.slice(4.5);
        const grown = mid.offset(TURNOUT_INSERT.fit - 0.02, 'Round');
        const tight = mid.offset(TURNOUT_INSERT.fit + 0.05, 'Round');
        try {
          assert.ok(area(grown, gapProbe) < 0.02, 'clearance kept');
          assert.ok(area(tight, gapProbe) > 1, 'no more than the clearance');
        } finally {
          for (const s of [mid, gapProbe, grown, tight]) s.delete();
        }
      });
});

test('two M2 screw points hold the insert: a countersunk lug below a blind pilot in the road', () => {
  assembly(turnout(), (parts) => {
    const road = byRole(parts, 'road')[0].solid;
    const insert = byRole(parts, 'turnoutInsert')[0];
    const p = turnout();
    assert.equal(insert.screws.length, 2);
    for (const [x, y] of insert.screws) {
      // From below: straight through the lug, then into the road.
      const up = (solid) => solid.rayCast([x, y, -5], [x, y, 40]);
      assert.equal(up(insert.solid).length, 0, 'clearance hole through the lug');
      const hit = up(road)[0].position[2];
      assert.ok(hit > TURNOUT_INSERT.lugTop + 2.5, 'pilot depth ' + hit);
      assert.ok(hit < p.height - p.braidDepth - 0.9, 'pilot stays blind');
      near(top(road, [x, y]), p.height - (top(road, [x, y]) < p.height - 0.1 ? p.braidDepth : 0), 1e-3);
      // The lug itself, beside the hole.
      near(top(insert.solid, [x + 2.6, y]), TURNOUT_INSERT.lugTop, 1e-3);
    }
  });
});

test('from above only the slots and the blade show; the braid shelf over the insert is fixed road', () => {
  const p = turnout({}, { braidGap: 1 });
  const { fork } = turnoutLayout(p);
  assembly(p, (parts) => {
    const road = byRole(parts, 'road')[0].solid;
    const insert = byRole(parts, 'turnoutInsert')[0].solid;
    const x = fork.heel[0] - 20;
    const shelf = p.slotWidth / 2 + p.braidGap + p.braidWidth / 2;
    // Outside braid of the main slot: a recess in the road, with the insert below.
    near(top(road, [x, -shelf]), p.height - p.braidDepth, 1e-3);
    near(top(insert, [x, -shelf]), p.height - p.braidDepth - TURNOUT_INSERT.roof, 1e-3);
    // Road surface outside the braid, still over the insert's flank.
    near(top(road, [x, -(p.slotWidth / 2 + 0.5)]), p.height, 1e-3);
  });
});

test('the conductor map, preview and car routes know both routes and the two fed braids', () => {
  const p = turnout();
  const plan = specialPreview(p);
  assert.equal(plan.outlines.length, 1);
  assert.equal(plan.lanes.length, 2);
  assert.equal(plan.turnouts.length, 1);
  assert.equal(plan.conductors.length, 4);
  assert.deepEqual(plan.conductors.map((c) => c.route).sort(), ['branch', 'branch island', 'main', 'main island']);
  assert.equal(plan.jumpers.length, 2);
  // Each inside braid joins the outside braid of the other slot: same polarity.
  const { fork } = turnoutLayout(p);
  for (const jumper of plan.jumpers) {
    assert.ok(jumper.from[0] > fork.guardEndX + TURNOUT_INSERT.margin, 'contact behind the insert');
    near(jumper.to[0], jumper.from[0], 0.05);
  }
  assert.equal(specialPreview(turnout({ turnoutMode: 'analog' })).turnouts.length, 0);
  assert.match(wiringDiagram(p), /Turnout · conductor map/);
  const routes = buildCarRoutes({ params: p });
  assert.deepEqual(routes.map((r) => r.label), ['Straight on', 'Branch']);
  // Braid pass-throughs in place of wire holes.
  const folded = turnout({ pitContactMode: 'braid', pitContactLength: 2 });
  assert.equal(specialPreview(folded).jumpers.filter((j) => j.openings[0].kind === 'slot').length, 2);
  assembly(folded, (parts) => assert.equal(byRole(parts, 'road')[0].solid.status(), 'NoError'));
});

test('settings outside what the piece can be are refused in plain words', () => {
  const refuse = (special, changes, message) =>
    assert.throws(
      () => validateTrack(trackParameters({ ...turnout(special), ...changes })),
      message,
    );
  refuse({}, { lanes: 2, laneSpacing: 40 }, /A turnout is a single-lane piece\. This road has 2 lanes/);
  refuse({}, { segments: 2 }, /prints as one road piece/);
  refuse({}, { borderSide: 'both' }, /cannot have borders yet/);
  refuse({}, { braidStyle: 'raised' }, /A turnout cannot have raised lands/);
  refuse({}, { braidFeedSide: 'both' }, /no extra braid openings yet/);
  refuse({ side: 'both' }, {}, /Choose Left or Right/);
  refuse({ turnoutMode: 'servo' }, {}, /Choose Digital, Hand-set point, Analog or Closed/);
  refuse({ turnoutPosition: 'up' }, {}, /Choose Straight on or Branch/);
  refuse({ motorMount: true }, {}, /no motor mount yet/);
  refuse({ turnoutRadius: 20 }, {}, /Branch radius must be between 60 and 5000 mm/);
  refuse({ turnoutAngle: 85 }, {}, /Branch angle must be between 5 and 80°/);
  refuse({ turnoutLead: 5 }, {}, /Lead before the branch must be between 15 and 1000 mm/);
  refuse({ turnoutRadius: 80 }, {}, /Set Branch radius to at least 90 mm/);
  // The two exits must be apart; the message gives the angle that does it.
  refuse({ turnoutAngle: 30 }, {}, /The branch exit overlaps the main road\. Set Branch angle to at least \d+(\.\d)?°/);
  refuse({}, { length: 150 }, /The main road ends before the branch has left it\. Set Main road length to at least \d+ mm/);
  refuse({}, { width: 30 }, /too narrow for the turnout insert and its screws\. Set Road width to at least \d+ mm/);
  refuse({}, { height: 6, slotDepth: 3.5, deck: 1 }, /Leave at least|Set Track height to at least|Increase track height/);
  // Clips at the entry need the insert further in.
  assert.throws(
    () => validateTrack(trackParameters({ ...turnout({ turnoutLead: 20 }), joint: 'clips' })),
    /The insert starts under the connectors of the entry end\. Set Lead before the branch to at least \d+ mm/,
  );
});

test('a multi-lane pack is not offered the turnout and cannot make one', () => {
  assert.ok(shelfSpecialsFor(1).some(([type]) => type === 'turnout'));
  for (const lanes of [2, 3, 4]) assert.ok(!shelfSpecialsFor(lanes).some(([type]) => type === 'turnout'));
  // The shelf name is "Turnout".
  assert.deepEqual(shelfSpecialsFor(1).find(([type]) => type === 'turnout'), ['turnout', 'Turnout']);
  const pack = (lanes) => ({
    rules: { ...rules, lanes, width: lanes === 1 ? 100 : 200 },
    pieces: [{ track: { params: { ...straight, lanes, width: lanes === 1 ? 100 : 200 } } }],
  });
  assert.doesNotThrow(() => validateTrack(trackParameters(packSpecialTrack(pack(1), 'turnout').params)));
  assert.throws(
    () => validateTrack(trackParameters(packSpecialTrack(pack(2), 'turnout').params)),
    /A turnout is a single-lane piece/,
  );
  assert.throws(() => buildTrack(wasm, packSpecialTrack(pack(2), 'turnout').params), /single-lane piece/);
});

test('the Track Planner does not offer the turnout and says why it cannot place one', () => {
  for (const lanes of [1, 2, 4]) assert.ok(!specialsFor(lanes).some(([type]) => type === 'turnout'));
  assert.ok(!SPECIAL_PIECES.some(([type]) => type === 'turnout'));
  const track = { params: turnout(), plan: null };
  assert.equal(plannerCanPlace(track), false);
  assert.equal(plannerCanPlace({ params: straight, plan: null }), true);
  assert.equal(plannerCanPlace({ params: specialTrackParams('pit', { ...straight, width: 200 }) }), true);
  assert.throws(
    () => plannerSource(wasm, { track, plate: { width: 250, depth: 250, margin: 5 } }, () => []),
    /A turnout has three ends\. The Track Planner cannot place it yet/,
  );
});

test('the parts list has a Turnout inserts family and the notes explain the insert and its four kinds', () => {
  assembly(turnout({ turnoutMode: 'manual' }), (parts) => {
    const groups = groupTrackParts(parts);
    const family = groups.find((group) => group.role === 'turnoutInsert');
    assert.equal(family.label, 'Turnout inserts');
    assert.equal(family.parts[0].name, 'Turnout insert · Hand-set point');
  });
  for (const mode of MODES) {
    const notes = specialAssemblyNotes(turnout({ turnoutMode: mode })).join('\n');
    assert.match(notes, /from below/);
    assert.match(notes, /two M2 × 6 mm/i);
    for (const [, name] of TURNOUT_MODES) assert.ok(notes.includes(name), mode + ' mentions ' + name);
  }
});
