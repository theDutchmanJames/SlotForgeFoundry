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

test('the car rides an off-centre slot, follows its S from end A to end B and stays square to both joints', () => {
  const slot = (edge, startMm, endMm = startMm) => ({ version: 1, edge, startMm, endMm });
  const single = { ...base, kind: 'straight', length: 300, lanes: 1 };
  // 35 mm from the left edge of a 200 mm road is 65 mm left of its centre.
  for (const [edge, y] of [['outer', 65], ['inner', -65]]) {
    const [route, ...others] = buildCarRoutes({ params: { ...single, slotPosition: slot(edge, 35) } });
    assert.deepEqual(others, []);
    assert.equal(route.length, 300);
    for (const t of [0, 0.3, 1])
      assert.deepEqual(carPose(route, t), { position: [300 * t - 150, y, 10], forward: [1, 0, 0] });
  }
  const params = { ...single, segments: 2, slotPosition: slot('outer', 35, 145) };
  const [route] = buildCarRoutes({ params });
  assert.deepEqual(carPose(route, 0).position, [-150, 65, 10]);
  assert.deepEqual(carPose(route, 1).position, [150, -45, 10]);
  // The slot is longer than the road it crosses, and symmetric about its middle.
  assert.ok(route.length > 326 && route.length < 327.5, String(route.length));
  const middle = carPose(route, 0.5);
  close(middle.position[0], 0, 1e-3);
  close(middle.position[1], 10, 1e-3);
  // Mid-way it runs to the right at 1.875 × 110 / 300 across the road.
  close(middle.forward[1] / middle.forward[0], -1.875 * 110 / 300, 1e-3);
  for (const t of [0, 1]) close(carPose(route, t).forward[0], 1, 1e-6);
  // Every point of the route is on the slot, not on a chord between sparse stations.
  for (const [x, y] of route.points) {
    const u = x / 300 + 0.5;
    close(y, 65 - 110 * u ** 3 * (10 - 15 * u + 6 * u * u), 1e-9);
  }
  assert.ok(route.points.length > 30);
  const hit = nearestCarRoute([route], [0, 12, 5], { role: 'road' });
  close(hit.t, 0.5, 0.01);
  // On a curve the slot keeps its distance from the inner edge all the way round.
  const [bend] = buildCarRoutes({ params: { ...single, kind: 'curve', radius: 300, angle: 90, slotPosition: slot('inner', 35) } });
  close(bend.length, 235 * Math.PI / 2, 0.01);
  for (const [x, y] of bend.points) close(Math.hypot(x, y + 300), 235, 1e-9);
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
