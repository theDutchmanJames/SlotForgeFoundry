import test from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import init from 'manifold-3d';
import { createEngine } from '../src/engine.js';
import { parseSTL } from '../src/editor.js';
import { newProject } from '../src/project.js';

const wasm = await init();
wasm.setup();

function sectionArea(solid, height) {
  const cut = solid.slice(height);
  try {
    return cut.area();
  } finally {
    cut.delete();
  }
}

test('flat crossing prints each passage and border road-face down, supports base-down, with an assembly map and separate support ZIP', (t) => {
  const project = newProject();
  Object.assign(project.track.params, {
    kind: 'import',
    width: 60,
    lanes: 2,
    laneSpacing: 25,
    segments: 1,
    borderSide: 'outer',
    borderSegments: 1,
    borderEntry: 12,
    borderApex: 12,
    borderExit: 12,
    bridgeSupportCount: 2,
    bridgeClearance: 60,
    bridgeApproaches: false,
  });
  project.track.custom = {
    version: 1,
    radius: 50,
    crossingMode: 'flat-pieces',
    upperPasses: ['first'],
    points: [
      [-225, 0],
      [225, 0],
      [225, 210],
      [0, 210],
      [0, -225],
    ],
  };
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  const parts = engine.build(project);
  const roads = parts.filter((p) => p.role === 'road');
  const supports = parts.filter((p) => p.role === 'support');
  assert.ok(roads.length >= 2);
  assert.equal(supports.length, 2);
  assert.throws(
    () => engine.export({ mode: 'assembly' }),
    /separate road-face-down STLs/,
  );
  const kit = unzipSync(engine.kit());
  const borders = unzipSync(engine.borderSTLs());
  const supportFiles = unzipSync(engine.supportSTLs());
  assert.deepEqual(
    Object.keys(supportFiles).sort(),
    supports.map((p) => p.id + '.stl').sort(),
  );
  const map = strFromU8(kit['assembly.svg']);
  assert.match(map, /Crossing 1 · Section (\d+) over section (\d+)/);
  assert.match(strFromU8(kit['parts.csv']), /Support height \(mm\)/);
  assert.match(strFromU8(kit['parts.csv']), /"72"/);
  for (const part of parts) {
    const bytes = engine.export({ mode: 'printPart', id: part.id });
    const printed = parseSTL(wasm, bytes);
    const assembled = parseSTL(
      wasm,
      engine.export({ mode: 'part', id: part.id }),
    );
    try {
      const { min, max } = printed.boundingBox();
      assert.ok(Math.abs(min[2]) < 1e-5);
      assert.ok(
        Object.entries(kit).some(
          ([n, b]) => n.endsWith('.stl') && Buffer.from(b).equals(bytes),
        ),
      );
      if (part.role === 'support') {
        assert.deepEqual(bytes, supportFiles[part.id + '.stl']);
        assert.equal(max[2], 72);
        assert.ok(
          Math.abs(sectionArea(printed, 0.1) - sectionArea(assembled, 0.1)) <
            0.02,
        );
      } else if (part.role === 'road' || part.role === 'border') {
        const assemblyBounds = assembled.boundingBox();
        const bedArea = sectionArea(printed, 0.1);
        const surfaceArea = sectionArea(assembled, assemblyBounds.max[2] - 0.1);
        assert.ok(
          Math.abs(bedArea - surfaceArea) < 0.02,
          part.name + ' has its driving surface against the bed',
        );
        assert.ok(
          bedArea > sectionArea(assembled, assemblyBounds.min[2] + 0.1),
          'underside and driving surface are distinguishable',
        );
        if (part.role === 'border')
          assert.deepEqual(bytes, borders[part.id + '.stl']);
      }
    } finally {
      printed.delete();
      assembled.delete();
    }
  }
});

test('support-only export explains how to create supports in a project with none', (t) => {
  const engine = createEngine(wasm);
  t.after(() => engine.dispose());
  engine.build(newProject());
  assert.throws(() => engine.supportSTLs(), /enable bridge supports/i);
});
