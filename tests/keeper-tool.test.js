import assert from 'node:assert/strict';
import test from 'node:test';
import init from 'manifold-3d';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { KEEPER_LIFT } from '../src/geometry/keeper-dimensions.js';
import { KEEPER_TOOL } from '../src/geometry/keeper-tool.js';
import { SolidWorkshop } from '../src/geometry/solids.js';
import { keeperToolSTL } from '../src/keeper-tool-stl.js';
import { defaultTrack, buildTrack } from '../src/track.js';
import { printableSTL } from '../src/kit.js';

const wasm = await init();
wasm.setup();

// Recover the drive axis from the exported blade, independent of where the
// STL writer places the handle on the plate.
function printedDriver(work) {
  const tool = work.own(parseSTL(wasm, keeperToolSTL(wasm)));
  const blade = work.own(tool.slice(KEEPER_TOOL.shoulderHeight + 0.20));
  const { min, max } = blade.bounds();
  return work.own(tool.translate([-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, 0]));
}

test('the keeper tool STL has a single shell and a supported flat print pose', t => {
  const work = new SolidWorkshop(wasm);
  t.after(() => work.close());
  const tool = printedDriver(work);
  assert.equal(tool.decompose().map(shell => work.own(shell)).length, 1);
  assert.equal(tool.status(), 'NoError');
  const { min, max } = tool.boundingBox();
  assert.ok(Math.abs(min[2]) < 0.001, 'the STL sits on the print plane');
  assert.ok(max[2] < 5.81, 'the bare tool can slide under a road raised 6 mm');
  assert.ok(max[0] - min[0] <= 200 && max[1] - min[1] <= 200, 'fits the standard 200 mm plate');
  const neckCenterX = z => {
    const bounds = work.own(tool.slice(z)).bounds();
    return (bounds.min[0] + bounds.max[0]) / 2;
  };
  const run = neckCenterX(4.65) - neckCenterX(3.75);
  assert.ok(Math.abs(Math.atan2(0.90, run) * 180 / Math.PI - 80) < 0.1,
    'the centre of the printed neck rises at 80 degrees to the handle');
  let below = work.own(tool.slice(0.01));
  assert.ok(below.area() > 300, 'a broad handle face prints against the bed');
  for (let z = 0.21; z < max[2]; z += 0.20) {
    const layer = work.own(tool.slice(z));
    assert.ok(work.own(layer.subtract(below)).area() < 0.01,
      `no unsupported shoulder or drive overhang at Z=${z.toFixed(2)}`);
    below = layer;
  }
});

function printedKeeper(work, part, project) {
  const bytes = printableSTL(part, encodeSTL, undefined, project);
  const fromPlate = work.own(parseSTL(wasm, bytes));
  const upright = work.own(fromPlate.rotate([180, 0, 0]));
  return work.own(upright.translate([0, 0, part.solid.boundingBox().min[2] - upright.boundingBox().min[2]]));
}

for (const clipType of ['draw-key', 'carrera-retained']) {
  test(`printed angled tool installs and releases every ${clipType} keeper from the side of a 200 mm road`, t => {
    const p = { ...defaultTrack(), kind: 'straight', length: 400, width: 200,
      laneSpacing: 100, segments: 2, height: 10, slotDepth: 8, clipType,
      joint: 'clips', jointStart: 'none', jointEnd: 'none', placements: { seamClips: [0] } };
    const parts = buildTrack(wasm, p), work = new SolidWorkshop(wasm);
    t.after(() => { work.close(); parts.forEach(part => part.solid.delete()); });
    const tool = printedDriver(work);
    const lockedTool = work.own(tool.rotate([0, 0, -45]));
    const project = { mode: 'track', track: { params: p } };
    const keepers = parts.filter(part => part.role === 'retainer');
    assert.equal(keepers.length, clipType === 'draw-key' ? 1 : 2);

    for (const keeper of keepers) {
      const { min, max } = keeper.solid.boundingBox();
      const centerX = (min[0] + max[0]) / 2;
      const fixed = work.union(parts.filter(part => part !== keeper).map(part => part.solid));
      const key = printedKeeper(work, keeper, project);
      const mouthZ = key.rayCast([0, 1.2, -1], [0, 1.2, 5])[0].position[2];
      const ceilingZ = key.rayCast([0, 0, -1], [0, 0, 5])[0].position[2];
      const toolZ = mouthZ - KEEPER_TOOL.shoulderHeight;
      const at = (solid, angle, z) => work.own(work.own(solid.rotate([0, 0, angle])).translate([centerX, 0, z]));
      const collision = (a, b) => Math.abs(work.and(a, b).volume());

      const engaged = at(lockedTool, 0, toolZ), seated = at(key, 0, 0);
      const engagement = engaged.boundingBox().max[2] - mouthZ;
      assert.ok(engagement >= 0.70 && ceilingZ - engaged.boundingBox().max[2] >= 0.08,
        'the drive engages most of the blind slot and leaves clearance at its floor');
      assert.ok(collision(engaged, seated) < 0.001, 'the aligned blade fits the keeper slot');
      assert.ok(collision(work.own(engaged.translate([0, 0, 0.08])), seated) > 0.15,
        'the shoulder supports the keeper before the blade bottoms');
      for (const angle of [-10, 10])
        assert.ok(collision(at(lockedTool, angle, toolZ), seated) > 0.015, 'the blade transmits torque in each direction');

      // With the keeper wings aligned to the open entrance, carry it in
      // beneath the solid road, then push vertically into the turn chamber.
      const entryZ = -0.20 - key.boundingBox().max[2];
      const carried = work.union([at(key, -90, entryZ), at(lockedTool, -90, toolZ + entryZ)]);
      assert.ok(carried.boundingBox().max[2] < -0.19 && carried.boundingBox().min[2] > -7.95,
        'tool and loose keeper slide in with an 8 mm local lift');
      for (let step = 0; step <= 12; step++) {
        const z = entryZ + (KEEPER_LIFT - entryZ) * step / 12;
        assert.ok(collision(at(key, -90, z), fixed) < 0.001, 'the keeper enters the pocket from below');
        assert.ok(collision(at(lockedTool, -90, toolZ + z), fixed) < 0.001, 'the driver can follow the keeper into its seat');
      }

      // In road coordinates a release turns from 0 to -90 degrees. Reach
      // past the same long edge at both stops and at every sampled angle.
      for (let angle = -90; angle <= 0; angle += 5) {
        const driver = at(lockedTool, angle, toolZ + KEEPER_LIFT);
        assert.ok(collision(driver, fixed) < 0.001, 'the lifted tool clears road, main clip and neighbouring keepers');
        assert.ok(collision(driver, at(key, angle, KEEPER_LIFT)) < 0.001, 'keeper and tool rotate together');
        assert.ok(driver.boundingBox().min[1] < -p.width / 2 - 12, 'the grip projects past the roadside');
        assert.ok(driver.boundingBox().min[2] > -5.95, 'the tool turns with the track just 6 mm above the table');
      }
    }
  });
}
