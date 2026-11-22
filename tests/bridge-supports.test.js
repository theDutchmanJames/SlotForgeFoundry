import assert from 'node:assert/strict';
import test from 'node:test';
import init from 'manifold-3d';
import { SolidWorkshop } from '../src/geometry/solids.js';
import { bridgeBlocks } from '../src/geometry/bridge-supports.js';
import { prepareBridges } from '../src/geometry/bridge-build.js';

const wasm = await init();
wasm.setup();
const section = {
  sides: [
    [
      [-300, -40],
      [300, -40],
    ],
    [
      [-300, 40],
      [300, 40],
    ],
  ],
};
const grade = 0.25;
const profile = {
  crossingAt: 0.5,
  level: { start: 0.3, end: 0.7, z: 45 },
  approaches: [
    { start: 0, end: 0.3, zStart: 0, zEnd: 45, grade },
    { start: 0.7, end: 1, zStart: 45, zEnd: 0, grade: -grade },
  ],
  heightAt: (t) => Math.min(t * 600 * grade, 45, (1 - t) * 600 * grade),
};

test('a skew ramp end warns before producing an uneven lip at either road edge', (t) => {
  const work = new SolidWorkshop(wasm);
  t.after(() => work.close());
  function strip(a, b) {
    return {
      sides: [a, b],
      outlines: [[...a, ...b.slice().reverse()]],
      lanes: [],
      start: 0,
      end: 1,
    };
  }
  const skew = strip(
    [
      [-305, -30],
      [295, -30],
    ],
    [
      [-295, 30],
      [305, 30],
    ],
  );
  const lower = strip(
    [
      [-30, -150],
      [-30, 150],
    ],
    [
      [30, -150],
      [30, 150],
    ],
  );
  const layout = {
    sections: [skew, lower],
    crossings: [
      {
        upperPass: 'first',
        firstLocal: 0.5,
        secondLocal: 0.5,
        firstSection: 0,
        secondSection: 1,
      },
    ],
  };
  const p = {
    height: 10,
    width: 60,
    bridgeClearance: 40,
    bridgeSupportCount: 2,
    borderSide: 'none',
  };
  assert.throws(
    () => prepareBridges(work, layout, p),
    /Crossing 1 has a skewed ramp end/,
  );
  assert.equal(
    prepareBridges(work, layout, { ...p, bridgeApproaches: false }).phases
      .length,
    2,
  );
});

test('six blocks sit either side of the lower deck with level and pitched bearings contacting both walls', (t) => {
  const work = new SolidWorkshop(wasm);
  t.after(() => work.close());
  // The skewed lower road reaches much further beneath one edge of the
  // upper road than beneath the centre. Centrepoint tests miss this case.
  const lower = work.section([
    [
      [-110, -120],
      [-65, -120],
      [120, 120],
      [75, 120],
    ],
  ]);
  const occupied = [];
  const blocks = bridgeBlocks(
    work,
    { bridgeSupportCount: 6 },
    section,
    profile,
    { sectionIndex: 1, crossingIndex: 0, obstacles: lower, occupied },
  );
  assert.equal(occupied.length, 6);
  let descending = 0,
    ascending = 0,
    level = 0;
  for (const block of blocks) {
    assert.equal(block.crossingSection, 1);
    assert.equal(block.solid.status(), 'NoError');
    const { min, max } = block.solid.boundingBox();
    assert.equal(min[2], 0);
    assert.deepEqual([min[1], max[1]], [-40, 40]);
    const projected = work.own(block.solid.project());
    assert.equal(work.own(projected.intersect(lower)).area(), 0);
    const heights = [min[0] + 0.1, max[0] - 0.1].map((x, i) => {
      const y = i ? -39.5 : 39.5;
      const hits = block.solid.rayCast([x, y, 100], [x, y, -1]);
      const top = hits[0].position[2];
      assert.ok(Math.abs(top - profile.heightAt((x + 300) / 600)) < 0.0001);
      return top;
    });
    if (Math.abs(heights[0] - heights[1]) < 0.001) level++;
    else if (heights[1] > heights[0]) ascending++;
    else descending++;
  }
  assert.deepEqual([ascending, level, descending], [2, 2, 2]);
  assert.equal(new Set(blocks.map((b) => b.id)).size, 6);
});

test('reserved blocks and complete lower outlines exclude a placement, and requesting zero never creates risers', (t) => {
  const work = new SolidWorkshop(wasm);
  t.after(() => work.close());
  const area = work.section([
    [
      [-500, -50],
      [500, -50],
      [500, 50],
      [-500, 50],
    ],
  ]);
  const opts = { sectionIndex: 1, crossingIndex: 1, occupied: [area] };
  assert.throws(
    () => bridgeBlocks(work, { bridgeSupportCount: 2 }, section, profile, opts),
    /Crossing 2.*Reduce the support count/,
  );
  assert.equal(opts.occupied.length, 1);
  assert.deepEqual(
    bridgeBlocks(work, { bridgeSupportCount: 0 }, section, profile, opts),
    [],
  );
});

test('rotated bridge supports follow the road, keep a one millimetre gap, and stay above table', (t) => {
  const work = new SolidWorkshop(wasm);
  t.after(() => work.close());
  const turn = ([x, y]) => [(x - y) / Math.SQRT2, (x + y) / Math.SQRT2];
  const rotated = { sides: section.sides.map((line) => line.map(turn)) };
  const obstacles = work.section([
    [
      [-22, -100],
      [-22, 100],
      [22, 100],
      [22, -100],
    ],
  ]);
  const bridge = {
    level: { start: 0, end: 1, z: 32 },
    crossingAt: 0.5,
    approaches: [],
    heightAt: () => 32,
  };
  const blocks = bridgeBlocks(
    work,
    { bridgeSupportCount: 8 },
    rotated,
    bridge,
    { sectionIndex: 0, crossingIndex: 0, obstacles, occupied: [] },
  );
  for (const [i, b] of blocks.entries()) {
    const floor = work.own(b.solid.project());
    assert.equal(work.own(floor.intersect(obstacles)).area(), 0);
    assert.ok(Math.abs(floor.area() - 800) < 0.001);
    for (const other of blocks.slice(0, i)) {
      const padded = work.own(
        work.own(other.solid.project()).offset(0.99, 'Miter'),
      );
      assert.equal(work.own(floor.intersect(padded)).area(), 0);
    }
  }
});
