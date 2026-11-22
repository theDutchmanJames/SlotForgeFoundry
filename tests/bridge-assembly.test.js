import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { newProject, checkProject } from '../src/project.js';
import { buildTrack, fitPlate } from '../src/track.js';
import { inspectFlatImport } from '../src/drawings/flat-import.js';
import { buildCarRoutes, carPose, nearestCarRoute } from '../src/car-placement.js';

const wasm = await init();
wasm.setup();

test('a separate lower road brushing the entry ramp away from the marked crossing blocks the edit', () => {
  const p = {
    ...newProject().track.params,
    kind: 'import',
    width: 40,
    lanes: 1,
    borderSide: 'none',
    bridgeClearance: 48,
    bridgeSupportCount: 4,
    bridgeApproaches: true,
  };
  const lanes = [
    [
      [-600, 0],
      [600, 0],
    ],
    [
      [-610, 30],
      [-525, 30],
      [-525, 160],
      [0, 160],
      [0, -210],
    ],
  ];
  const { flatCrossing, warning } = inspectFlatImport({ lanes }, p.width, p);
  assert.ok(flatCrossing, warning);
  flatCrossing.crossings[0].upperPass = 'first';
  const plan = {
    lanes,
    flatCrossing,
    outlines: flatCrossing.sections.flatMap((s) => s.outlines),
  };
  assert.throws(() => buildTrack(wasm, p, plan), /intersects.*bridge approach/);
});

test('printed figure eight has six freestanding blocks that bear on the raised roads and clear every lower footprint', (t) => {
  const project = newProject();
  const { track } = project;
  Object.assign(track.params, {
    kind: 'import',
    width: 75,
    height: 10,
    slotDepth: 8,
    laneSpacing: 32,
    borderSide: 'both',
    borderEntry: 5,
    borderExit: 5,
    borderApex: 7,
    segments: 5,
    borderSegments: 5,
    bridgeClearance: 45,
    bridgeSupportCount: 6,
    bridgeApproaches: true,
  });
  track.custom = {
    version: 1,
    crossingMode: 'flat-pieces',
    closed: true,
    upperPasses: ['first'],
    points: [
      [-320, -230],
      [320, 230],
      [320, -230],
      [-320, 230],
    ],
    radius: 80,
  };
  const { plan, params } = checkProject(project).track;
  const parts = buildTrack(wasm, params, plan);
  const solids = parts.map((p) => p.solid);
  t.after(() => solids.forEach((s) => s.delete()));
  const own = (solid) => {
    solids.push(solid);
    return solid;
  };
  const inter = (a, b) => own(a.intersect(b));
  const crossing = plan.flatCrossing.crossings[0];
  const upper = crossing.firstSection;
  const routes = buildCarRoutes({ params, plan }, parts);
  // A click at the crossing can reach either passage, including the
  // underside view. The preview must use the same installed deck as the STL.
  for (const [height, section] of [[65, upper], [10, crossing.secondSection]]) {
    const road = parts.find(p => p.role === 'road' && p.crossingSection === section);
    const hit = nearestCarRoute(routes, [...crossing.point, height], road);
    const route = routes.find(r => r.id === hit.id);
    assert.equal(route.section, section);
    assert.equal(carPose(route, hit.t).position[2], height);
    if (section === upper) {
      const ramp = route.points.findIndex((p, i) => i && p[2] > route.points[i - 1][2] + 0.1);
      assert.ok(ramp > 0);
      const t = (route.distances[ramp] + route.distances[ramp - 1]) / (2 * route.length);
      assert.ok(carPose(route, t).forward[2] > 0);
    }
  }
  const lowerParts = parts.filter((p) => p.crossingSection !== upper);
  const lower = own(
    wasm.CrossSection.union(lowerParts.map((p) => own(p.solid.project()))),
  );
  const upperDecks = own(
    wasm.Manifold.union(
      parts
        .filter((p) => p.crossingSection === upper && p.role === 'road')
        .map((p) => p.solid),
    ),
  );
  const blocks = parts.filter((p) => p.role === 'support');
  assert.equal(blocks.length, 6);
  for (const { solid } of blocks) {
    assert.equal(solid.boundingBox().min[2], 0);
    assert.ok(inter(own(solid.project()), lower).area() < 1e-5);
    assert.ok(inter(upperDecks, solid).volume() < 1e-4);
    assert.ok(
      inter(upperDecks, own(solid.translate([0, 0, 0.06]))).volume() > 0.1,
    );
  }
  const blockHeights = blocks.map((p) => p.solid.boundingBox().max[2]);
  assert.equal(Math.max(...blockHeights), 55);
  assert.ok(blockHeights.filter((z) => z < 54).length >= 4);
  const positions = new Set(parts.map((part) => part.id));
  assert.equal(positions.size, parts.length);
  assert.ok(parts.every((p) => fitPlate(p.footprintXY, 200, 200).fits));
});
