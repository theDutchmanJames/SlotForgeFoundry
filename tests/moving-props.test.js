// The props with moving parts and the machinery: a boom turning on a loose pin, a poster insert that
// slides out between its frame's back and front, start lights bored for LEDs, brushes apart from their portal.
import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { PROPS, placeProp } from '../src/geometry/props.js';

const wasm = await Module();
wasm.setup();
const placed = (type) => {
  const temp = [];
  const parts = placeProp(wasm, (s) => (temp.push(s), s), { type, x: 0, y: 0, rotation: 0 }, 0);
  return { parts, part: (name) => parts.find((p) => p.name === name).solid, done: () => temp.forEach((s) => { try { s.delete(); } catch {} }) };
};
const touch = (a, b) => {
  const x = a.intersect(b),
    v = x.volume();
  x.delete();
  return v;
};

test('the moving parts and machinery are in their groups', () => {
  const group = (g) => PROPS.filter((p) => p.group === g).map((p) => p.id);
  assert.deepEqual(group('Moving parts'), ['boom-gate', 'drag-tree', 'poster-frame']);
  assert.deepEqual(group('Machinery'), ['tunnel-fan', 'gantry-crane', 'turntable', 'wash-gantry', 'monorail', 'impact-block', 'spray-arch', 'speaker-post', 'wheel-stop', 'roller-bed']);
});

test('the boom turns on a pin loose in its post and its boom', () => {
  const g = placed('boom-gate');
  try {
    assert.deepEqual(g.parts.map((p) => p.name), ['post', 'boom', 'pin']);
    const pin = g.part('pin');
    assert.equal(touch(pin, g.part('post')), 0);
    assert.equal(touch(pin, g.part('boom')), 0);
    // The pin runs through both: its shaft reaches from the post's front through the boom.
    const [p, b, s] = ['post', 'boom', 'pin'].map((n) => g.part(n).boundingBox());
    assert.ok(s.min[1] <= p.min[1] + 0.01 && s.max[1] > b.max[1]);
  } finally {
    g.done();
  }
});

test('the poster insert slides out of the top of its frame, clear of the back and the front', () => {
  const g = placed('poster-frame');
  try {
    const insert = g.part('insert');
    assert.equal(touch(insert, g.part('back')), 0);
    assert.equal(touch(insert, g.part('front')), 0);
    assert.equal(touch(g.part('back'), g.part('front')), 0);
    // Nothing over it: moved up out of the frame, it meets nothing on the way.
    const out = insert.translate([0, 0, 40]);
    const hull = wasm.Manifold.hull([insert, out]);
    assert.equal(touch(hull, g.part('back')), 0);
    assert.equal(touch(hull, g.part('front')), 0);
    [out, hull].forEach((s) => s.delete());
  } finally {
    g.done();
  }
});

test('the start lights have a bore for each of fourteen LEDs, the brushes stand clear of their portal', () => {
  const g = placed('drag-tree');
  try {
    // Each bore a hole through the plate: genus counts them.
    assert.equal(g.part('lights').genus(), 14);
  } finally {
    g.done();
  }
  const w = placed('wash-gantry');
  try {
    for (const b of ['brush 1', 'brush 2']) assert.equal(touch(w.part(b), w.part('portal')), 0);
  } finally {
    w.done();
  }
});
