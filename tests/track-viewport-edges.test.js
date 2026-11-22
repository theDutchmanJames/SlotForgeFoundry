import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import init from 'manifold-3d';
import { createEngine } from '../src/engine.js';
import { parseSTL } from '../src/editor.js';
import { newProject } from '../src/project.js';
import { nativeTrackPoint } from '../src/track.js';
import { Viewport } from '../src/viewport.js';

// The five curved roads have identical cross-sections. Boolean triangulation
// alone puts alternating segments above and below the old preview face limit.
function segmentedBend() {
  const project = newProject();
  Object.assign(project.track.params, {
    radius: 450,
    angle: 95,
    width: 200,
    laneSpacing: 100,
    segments: 5,
    borderSide: 'both',
    borderEntry: 40,
    borderExit: 40,
    borderApex: 50,
    borderSegments: 5,
    kerbEdge: 'free',
    kerbSide: 'both',
    kerbGroove: true,
    kerbLength: 13,
  });
  return project;
}

// Collect outline endpoints in cylindrical coordinates around the bend.
function profileStrokes(mesh, radius) {
  const strokes = [];
  mesh.traverse((object) => {
    if (!object.isLineSegments) return;
    const geometry = object.geometry;
    const position = geometry.getAttribute('position');
    const count = geometry.index?.count ?? position.count;
    const vertex = (i) => {
      const id = geometry.index?.getX(i) ?? i;
      const x = position.getX(id);
      const y = position.getY(id) + radius;
      return {
        offset: Math.hypot(x, y) - radius,
        angle: Math.atan2(x, y),
        z: position.getZ(id),
      };
    };
    for (let i = 0; i < count; i += 2) {
      strokes.push([vertex(i), vertex(i + 1)]);
    }
  });
  return strokes;
}

function checkLip(strokes, offset, z, start, end, label) {
  const spans = [];
  for (const [a, b] of strokes) {
    if (a.z !== z || b.z !== z) continue;
    if (
      Math.abs(a.offset - offset) > 0.03 ||
      Math.abs(b.offset - offset) > 0.03
    )
      continue;
    spans.push([Math.min(a.angle, b.angle), Math.max(a.angle, b.angle)]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  let reached = start;
  for (const [from, to] of spans) {
    assert.ok(from <= reached + 0.00001, label + ' has a gap along the curve');
    reached = Math.max(reached, to);
  }
  assert.ok(reached >= end - 0.00001, label + ' must reach the next seam');
}

for (const braidGap of [0, 2])
test(`a dense segmented bend retains the printed guide and braid edges at ${braidGap} mm offset`, async (t) => {
  const wasm = await init();
  wasm.setup();
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  const project = segmentedBend();
  const p = project.track.params;
  p.braidGap = braidGap;
  const parts = engine.build(project);
  const view = Object.create(Viewport.prototype);
  view.group = new THREE.Group();
  view.scene = new THREE.Scene();
  view.scene.add(view.group);
  view.renderer = {};
  view.draw = () => {};
  view.setParts(parts, false);
  t.after(() => view.clearParts());

  const turn = (p.angle * Math.PI) / 180;
  const roads = parts.filter((part) => part.role === 'road');
  assert.equal(roads.length, 5);
  for (const [i, road] of roads.entries()) {
    const mesh = view.group.children.find(
      (item) => item.userData.id === road.id,
    );
    assert.equal(mesh.geometry.index.array, road.indices);
    assert.equal(mesh.geometry.getAttribute('position').array, road.positions);
    const printed = parseSTL(
      wasm,
      engine.export({ mode: 'part', id: road.id }),
    );
    t.after(() => printed.delete());
    const strokes = profileStrokes(mesh, p.radius);
    const start = (i / p.segments - 0.5) * turn;
    const end = ((i + 1) / p.segments - 0.5) * turn;
    const station = (i + 0.5) / p.segments;
    for (const lane of [-p.laneSpacing / 2, p.laneSpacing / 2]) {
      for (const [distance, z] of [
        [0, p.height - p.slotDepth],
        ...(braidGap > 0 ? [[p.slotWidth / 2 + braidGap / 2, p.height]] : []),
        [p.slotWidth / 2 + braidGap + p.braidWidth / 2, p.height - p.braidDepth],
        [p.slotWidth / 2 + braidGap + p.braidWidth + 1, p.height],
      ]) {
        const [x, y] = nativeTrackPoint(p, station, lane + distance);
        const hit = printed.rayCast([x, y, p.height + 1], [x, y, -1])[0];
        assert.ok(Math.abs(hit.position[2] - z) < 0.001);
      }
      for (const side of [-1, 1]) {
        const lip = lane + (side * p.slotWidth) / 2;
        const inner = lip + side * braidGap;
        const braid = inner + side * p.braidWidth;
        checkLip(strokes, braid, p.height, start, end, road.id + ' braid lip');
        checkLip(
          strokes,
          lip,
          braidGap > 0 ? p.height : p.height - p.braidDepth,
          start,
          end,
          road.id + ' guide lip',
        );
        if (braidGap > 0)
          checkLip(strokes, inner, p.height, start, end, road.id + ' inner braid lip');
      }
    }
  }
});
