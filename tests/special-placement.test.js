import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { defaultTrack, chooseSegmentation, nativePath } from '../src/track.js';
import { specialTrackParams } from '../src/special-pieces.js';
import { borderDrag } from '../src/border-handles.js';
import { connectorLayout } from '../src/geometry/connector-layout.js';
import {
  pitLayout,
  pitPrintPath,
} from '../src/geometry/special-junction-layout.js';
import { pitBraidLayout } from '../src/geometry/pit-braids.js';

const wasm = await Module();
wasm.setup();
const recipe = (type) =>
  specialTrackParams(type, {
    ...defaultTrack(),
    width: 200,
    laneSpacing: 100,
    borderSide: 'both',
    joint: 'none',
    jointStart: 'none',
    jointEnd: 'none',
    borderMount: 'none',
    borderJoint: 'none',
  });

test('pit connector map follows both independent branches, the widened shoulders and protected seams', () => {
  const p = recipe('pit');
  p.special.side = 'both';
  p.segments = 5;
  const pit = pitLayout(p);
  const printed = pitPrintPath(pit.path, pit.forks, p, pitBraidLayout(p, pit));
  const map = connectorLayout(p, null, 'seam', { index: 1 });
  assert.equal(map.lanes.length, 4);
  assert.deepEqual(map.pointAt(0), printed.atOffset(1 / 5, 0));
  assert.notEqual(map.pointAt(0)[0], (1 / 5 - 0.5) * p.length);
  const side = connectorLayout(p, null, 'side', { side: 'outer', index: 0 });
  const shoulder = printed.point(0.5, p.width / 2);
  assert.ok(
    Math.hypot(...side.pointAt(0.5).map((v, i) => v - shoulder[i])) < 1e-8,
  );
  assert.deepEqual(
    borderDrag(p, 'borderApex', 1, printed.point(0.4, p.width / 2 + 17)),
    {
      outerApexPercent: 40,
      outerApexWidth: 17,
    },
  );
});

test('timing border drag follows its actual seam offset around the measuring station', () => {
  const p = recipe('timing');
  p.segments = 2;
  const at = nativePath(p).point(0.5, p.width / 2 + 19);
  assert.deepEqual(borderDrag(p, 'borderApex', 1, at), {
    outerApexPercent: 50,
    outerApexWidth: 19,
  });
});

test('timing connector picker marks actual sensor mounts and avoids their stock', () => {
  const p = {
    ...recipe('timing'),
    width: 145,
    borderSegments: 1,
    borderMount: 'clips',
    borderEntry: 48,
    borderApex: 48,
    borderExit: 48,
  };
  p.special.sensorSize = 9;
  const map = connectorLayout(p, null, 'side', { side: 'outer', index: 0 });
  assert.equal(map.equipment.length, 4);
  assert.match(map.reason('clip', 0.5), /timing equipment/);
  assert.equal(map.reason('clip', 0.3), null);
});

test('diamond plate fit tests one central block and four arms before adding more cuts', () => {
  const p = {
    ...recipe('diamond'),
    width: 170,
    laneSpacing: 80,
    length: 518,
    borderSide: 'none',
  };
  const result = chooseSegmentation(
    wasm,
    p,
    null,
    { width: 180, depth: 180 },
    'road-1',
  );
  assert.deepEqual(result, { fits: true, key: 'segments', count: 2 });
  const tooSmall = chooseSegmentation(
    wasm,
    { ...p, segments: 2 },
    null,
    { width: 160, depth: 160 },
    'road-1',
  );
  assert.equal(tooSmall.fits, false);
  assert.match(tooSmall.reason, /centre of the diamond/);
});

test('plate fit can split a wide pit down the median for a standard 200 mm bed', () => {
  const p = recipe('pit');
  p.special.side = 'both';
  p.borderSide = 'none';
  const result = chooseSegmentation(
    wasm,
    p,
    null,
    { width: 200, depth: 200 },
    'road-1',
  );
  assert.equal(result.fits, true, result.reason);
  assert.ok(result.count > 1);
});

test('racing corners and the chicane find small-plate cuts past the initial eight candidate counts', () => {
  for (const type of ['chicane', 'duel', 'hairpin']) {
    const p = { ...recipe(type), borderSide: 'none' };
    const result = chooseSegmentation(
      wasm,
      p,
      null,
      { width: 200, depth: 200 },
      'road-1',
    );
    assert.equal(result.fits, true, type + ': ' + result.reason);
    assert.ok(
      result.count > 8 && result.count <= 32,
      type + ': ' + result.count,
    );
  }
});
