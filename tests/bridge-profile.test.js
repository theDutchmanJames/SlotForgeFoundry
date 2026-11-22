import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeSectionProfile } from '../src/bridge-profile.js';
import { vertexNormals } from '../src/geometry/import-track.js';

const near = (v, wanted, tolerance = 1e-5) =>
  assert.ok(Math.abs(v - wanted) <= tolerance, `${v} differs from ${wanted}`);
function section(points, width = 40) {
  const normals = vertexNormals(points);
  return {
    sides: [-1, 1].map((s) =>
      points.map((p, i) =>
        p.map((v, k) => v + ((s * width) / 2) * normals[i][k]),
      ),
    ),
  };
}
const crossing = { upperPass: 'first', firstLocal: 0.5, secondLocal: 0.25 };
const options = {
  height: 10,
  clearance: 50,
  width: 40,
  landing: 15,
  blocked: (t) => t > 0.46 && t < 0.54,
};

test('deck clears the full crossing and lands on two straight approach blocks at graduated heights', () => {
  const road = section([
    [-500, 0],
    [-390, 0],
    [-18, 0],
    [0, 0],
    [400, 0],
    [500, 0],
  ]);
  const p = bridgeSectionProfile(road, crossing, options);
  near(p.level.start, 0.445, 0.00002);
  near(p.level.end, 0.555, 0.00002);
  assert.deepEqual(p.cuts, [0, p.level.start, p.level.end, 1]);
  near(p.heightAt(0), 0);
  near(p.heightAt(0.5), 60);
  near(p.heightAt(1), 0);
  near(p.heightAt(p.level.start / 2), 30);
  near(p.heightAt((1 + p.level.end) / 2), 30);
  assert.deepEqual(
    p.approaches.map(({ zStart, zEnd }) => [zStart, zEnd]),
    [
      [0, 60],
      [60, 0],
    ],
  );
  near(p.approaches[0].grade, 60 / 445, 0.00001);
});

test('a curved overpass stays entirely level and places inclined straights outside of the bend', () => {
  const quarter = Array.from({ length: 21 }, (_, i) => {
    const phi = ((i / 20 - 1) * Math.PI) / 2;
    return [100 * Math.cos(phi), 100 + 100 * Math.sin(phi)];
  });
  const points = [[-600, 0], ...quarter, [100, 700]];
  const road = section(points);
  const p = bridgeSectionProfile(road, crossing, {
    ...options,
    blocked: (t) => Math.abs(t - 0.5) < 0.008,
    landing: 10,
  });
  const arc = 20 * 200 * Math.sin(Math.PI / 80),
    total = 1200 + arc;
  near(p.level.start, 600 / total);
  near(p.level.end, (600 + arc) / total);
  near(p.heightAt(0.5), 60);
  assert.ok(p.approaches.every((a) => Math.abs(a.grade - 0.1) < 1e-6));
});

test('short straight hints identify which approach needs more length; deck-only omits ramps', () => {
  const short = section([
    [0, 0],
    [200, 0],
  ]);
  assert.throws(
    () => bridgeSectionProfile(short, crossing, { ...options, maxGrade: 0.15 }),
    /entry approach needs 400\.0 mm/,
  );
  const deck = bridgeSectionProfile(short, crossing, {
    ...options,
    approaches: false,
  });
  assert.deepEqual(deck.cuts, [0, 1]);
  assert.deepEqual(deck.approaches, []);
  assert.equal(deck.heightAt(0), 60);
  assert.equal(deck.heightAt(1), 60);
});

test('ground-level seams of a closed figure eight do not enlarge the crossing deck', () => {
  const road = section([
    [-500, 0],
    [500, 0],
  ]);
  const p = bridgeSectionProfile(road, crossing, {
    ...options,
    blocked: (t) => t < 0.02 || t > 0.98 || Math.abs(t - 0.5) < 0.04,
  });
  near(p.level.start, 0.445, 0.00002);
  near(p.level.end, 0.555, 0.00002);
  near(p.heightAt(0), 0);
  near(p.heightAt(1), 0);
});
