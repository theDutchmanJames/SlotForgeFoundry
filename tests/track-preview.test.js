import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import { Group, Scene } from 'three';
import { createEngine } from '../src/engine.js';
import { newProject } from '../src/project.js';
import { creaseLineIndices } from '../src/surface-features.js';
import { PREVIEW_FACES } from '../src/track-preview-budget.js';
import { prepareSoftwareTrack } from '../src/track-preview.js';
import { Viewport } from '../src/viewport.js';

function pointAt(positions, index) {
  return positions.subarray(3 * index, 3 * index + 3);
}

function edgeKey(a, b) {
  return [a.join(','), b.join(',')].sort().join('|');
}

async function checkBendPreview(t, reinforcement) {
  const wasm = await init();
  wasm.setup();
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  const project = newProject();
  const p = project.track.params;
  Object.assign(p, {
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
    reinforcement,
  });
  const parts = engine.build(project);
  const sourceTriangles = parts.reduce((n, part) => n + part.indices.length / 3, 0);
  // The unreinforced fixture exercises decimation. Reinforced stock also
  // welds redundant faces and may already fall within the software budget.
  if (!reinforcement) assert.ok(sourceTriangles > PREVIEW_FACES);
  await prepareSoftwareTrack(parts);
  const triangles = parts.reduce(
    (n, part) => n + (part.previewIndices ?? part.indices).length / 3,
    0,
  );
  assert.ok(triangles <= PREVIEW_FACES);
  const roads = parts.filter((part) => part.role === 'road');
  if (sourceTriangles > PREVIEW_FACES) assert.ok(roads.some((road) => road.previewIndices));
  const viewport = Object.create(Viewport.prototype);
  viewport.group = new Group();
  viewport.scene = new Scene();
  viewport.scene.add(viewport.group);
  viewport.draw = () => {};
  viewport.setParts(parts, false);
  t.after(() => viewport.clearParts());
  for (const [piece, road] of roads.entries()) {
    const sourceLines = creaseLineIndices(road);
    const source = new Set();
    for (let i = 0; i < sourceLines.length; i += 2) {
      source.add(
        edgeKey(
          pointAt(road.positions, sourceLines[i]),
          pointAt(road.positions, sourceLines[i + 1]),
        ),
      );
    }
    const { indices, marks, positions } = viewport.group.children.find(
      (m) => m.userData.id === road.id,
    ).userData.preview;
    const floors = [];
    for (let i = 0; i < indices.length; i += 3)
      for (let j = 0; j < 3; j++) {
        if (!(marks[i / 3] & (1 << j))) continue;
        const a = pointAt(positions, indices[i + j]);
        const b = pointAt(positions, indices[i + ((j + 1) % 3)]);
        assert.ok(
          source.has(edgeKey(a, b)),
          road.id + ' drew a new edge across a flat face',
        );
        if (a[2] === p.height - p.braidDepth && b[2] === a[2])
          floors.push([a, b]);
      }
    for (const lane of [-1, 1])
      for (const lip of [-1, 1]) {
        const radius =
          p.radius + (lane * p.laneSpacing) / 2 + (lip * p.slotWidth) / 2;
        for (let i = 0; i < 50; i++) {
          const station = (piece + (i + 0.5) / 50) / p.segments;
          const angle = ((station - 0.5) * p.angle * Math.PI) / 180;
          const x = radius * Math.sin(angle),
            y = radius * Math.cos(angle) - p.radius;
          assert.ok(
            floors.some(([a, b]) => {
              const dx = b[0] - a[0],
                dy = b[1] - a[1];
              const u = Math.max(
                0,
                Math.min(
                  1,
                  ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy),
                ),
              );
              return Math.hypot(x - a[0] - u * dx, y - a[1] - u * dy) < 0.09;
            }),
            road.id + ' missing a guide lip at ' + station,
          );
        }
      }
  }
}

for (const reinforcement of [false, true]) {
  const label = reinforcement ? 'reinforced' : 'unreinforced';
  test('the software preview keeps the lane lips of a five-piece ' + label + ' bend under budget',
    t => checkBendPreview(t, reinforcement));
}

test('high-index track previews preserve their rim vertices and leave the source index buffer intact', async () => {
  const n = 105,
    offset = 65536;
  const positions = new Float32Array(3 * (offset + n * n));
  const ix = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = offset + y * n + x;
      positions.set([x, y, 0], v * 3);
      if (x + 1 < n && y + 1 < n)
        ix.push(v, v + 1, v + n, v + 1, v + n + 1, v + n);
    }
  const part = { role: 'border', positions, indices: Uint32Array.from(ix) };
  const before = creaseLineIndices(part);
  await prepareSoftwareTrack([part]);
  assert.ok(part.previewIndices instanceof Uint32Array);
  assert.ok(part.previewIndices.length < part.indices.length);
  assert.deepEqual(part.indices, Uint32Array.from(ix));
  const reduced = creaseLineIndices({ ...part, indices: part.previewIndices });
  assert.deepEqual(new Set(reduced), new Set(before));
});
