import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCarRoutes, carPose, nearestCarRoute } from '../src/car-placement.js';
import { defaultTrack } from '../src/track.js';
import { SPECIAL_PIECES, specialTrackParams } from '../src/special-pieces.js';

const base = { ...defaultTrack(), width: 200, laneSpacing: 100, height: 10 };
function close(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

test('the car follows squeezed guide slots continuously across print seams in real millimetres', () => {
  const params = { ...base, kind: 'straight', length: 600, segments: 4,
    laneAdjustment: { version: 1, mode: 'squeeze', spacingMm: 40, anchor: 'centre' } };
  const [first, second] = buildCarRoutes({ params });
  assert.deepEqual(carPose(first, -1).position, [-300, -50, 10]);
  assert.deepEqual(carPose(first, 2).position, [300, -50, 10]);
  const middle = carPose(first, 0.5);
  close(middle.position[0], 0);
  close(middle.position[1], -20);
  close(carPose(second, 0.5).position[1] - middle.position[1], 40);
  const hit = nearestCarRoute([first, second], [0, 21, 5], { role: 'road' });
  assert.equal(hit.id, second.id);
  close(hit.t, 0.5, 0.001);
  assert.equal(nearestCarRoute([first], [0, 0, 0], { role: 'support' }), null);
});

test('both pit branches and crossing axes are individually available alongside other specials', () => {
  for (const [type] of SPECIAL_PIECES) {
    const params = specialTrackParams(type, base);
    if (type === 'pit') params.special.side = 'both';
    const routes = buildCarRoutes({ params });
    const labels = new Set(routes.map(r => r.label));
    assert.equal(labels.size, routes.length);
    assert.equal(routes.length, type === 'pit' || type === 'diamond' ? 4 : 2);
    for (const route of routes) {
      const pose = carPose(route, 0.63);
      assert.equal(pose.position[2], base.height);
      close(Math.hypot(...pose.forward), 1);
    }
    if (type === 'pit') {
      const left = routes.find(r => r.id === 'pit-left'), right = routes.find(r => r.id === 'pit-right');
      close(carPose(left, 0.5).position[1], base.laneSpacing / 2 + params.special.pitOffset);
      close(carPose(right, 0.5).position[1], -carPose(left, 0.5).position[1]);
      assert.equal(nearestCarRoute(routes, carPose(right, 0.5).position).id, right.id);
    }
    if (type === 'diamond') {
      const a = carPose(routes[0], 0.2), b = carPose(routes[2], 0.2);
      close(a.forward[0], 1);
      close(b.forward[1], 1);
    }
  }
});

test('Circuit imports use the drawn lanes and distance along them, including closed loops and duplicate points', () => {
  const track = { params: { ...base, kind: 'import' }, plan: { lanes: [
    [[0, 0], [1, 0], [1, 0], [40, 0], [40, 40], [0, 40], [0, 0]],
    [[0, 70], [1, 70], [80, 70]],
  ] } };
  const [loop, line] = buildCarRoutes(track);
  assert.deepEqual(carPose(line, 0.5), { position: [40, 70, 10], forward: [1, 0, 0] });
  assert.equal(loop.length, 160);
  assert.deepEqual(carPose(loop, 0), carPose(loop, 1));
  close(carPose(loop, 0).forward[0], Math.SQRT1_2);
  assert.deepEqual(nearestCarRoute([loop, line], [20, 40, 10]), { id: loop.id, t: 0.625 });
  assert.deepEqual(buildCarRoutes({ params: { kind: 'import' }, plan: null }), []);
  const [reversed] = buildCarRoutes({ ...track, plan: { lanes: [[[0, 0], [10, 0], [0, 0]]] } });
  assert.deepEqual(carPose(reversed, 0.5), { position: [10, 0, 10], forward: [-1, 0, 0] });
});
