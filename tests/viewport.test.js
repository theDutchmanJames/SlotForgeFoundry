import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import init from 'manifold-3d';
import { Viewport } from '../src/viewport.js';
import { creaseLineIndices } from '../src/surface-features.js';
import { createEngine } from '../src/engine.js';
import { newProject } from '../src/project.js';

// Exercise the scene graph without requiring a GPU or a native window.
function viewport(gpu = false) {
  const view = Object.create(Viewport.prototype);
  view.group = new THREE.Group();
  view.scene = new THREE.Scene();
  view.scene.add(view.group);
  view.draw = () => {};
  if (gpu) view.renderer = {};
  return view;
}

function panel(divisions = 1, id = 'panel') {
  const n = divisions + 1;
  const positions = new Float32Array(n * n * 3),
    indices = new Uint32Array(divisions * divisions * 6);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      positions.set([x / divisions, y / divisions, 0], i * 3);
      if (x < divisions && y < divisions)
        indices.set(
          [i, i + 1, i + n + 1, i, i + n + 1, i + n],
          (y * divisions + x) * 6,
        );
    }
  }
  return {
    id,
    role: 'body',
    positions,
    indices,
    bounds: { min: [0, 0, 0], max: [1, 1, 0] },
  };
}

function markedPanel() {
  return {
    ...panel(1, 'border'),
    role: 'border',
    kerbMarkings: [
      {
        color: '#E5484D',
        points: [
          [0, 0, 0],
          [0.5, 0, 0],
          [0.5, 0.25, 0],
          [0, 0.25, 0],
        ],
      },
      {
        color: '#ECE9E2',
        points: [
          [0.5, 0, 0],
          [1, 0, 0],
          [1, 0.25, 0],
          [0.5, 0.25, 0],
        ],
      },
    ],
  };
}

test('flat kerbstones share one depth-tested WebGL draw per border and leave the exact pick mesh intact', () => {
  const part = markedPanel(),
    view = viewport(true);
  view.setParts([part], false);
  const mesh = view.group.children[0],
    paint = mesh.children.find((o) => o.isMesh);
  assert.equal(view.group.children.length, 1);
  assert.equal(mesh.geometry.index.array, part.indices);
  assert.equal(paint.geometry.index.count, 12);
  const points = paint.geometry.getAttribute('position');
  for (let i = 0; i < points.count; i++) assert.equal(points.getZ(i), 0);
  const colors = paint.geometry.getAttribute('color');
  for (const [i, color] of [
    [0, 'e5484d'],
    [4, 'ece9e2'],
  ])
    assert.equal(
      new THREE.Color().fromBufferAttribute(colors, i).getHexString(),
      color,
    );
  assert.equal(paint.material.side, THREE.FrontSide);
  assert.ok(paint.material.depthTest);
  assert.ok(!paint.material.depthWrite);
  view.camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.01, 10);
  view.camera.position.z = 2;
  view.camera.updateMatrixWorld();
  view.pickRay = new THREE.Raycaster();
  assert.equal(
    view.intersectionAt(new THREE.Vector2(-0.4, -0.75)).object,
    mesh,
  );
  view.select(part.id, new Set([part.id]));
  assert.equal(paint.parent.visible, false);
  assert.equal(view.intersectionAt(new THREE.Vector2(-0.4, -0.75)), undefined);
  let released = false;
  paint.geometry.addEventListener('dispose', () => {
    released = true;
    assert.equal(paint.geometry.getAttribute('position'), points);
  });
  view.clearParts();
  assert.ok(released);
});

function pixelViewport(width = 200, height = 100) {
  const view = viewport();
  view.canvas = { width, height };
  view.context = {
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData(image) {
      this.data = image.data;
    },
  };
  view.camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.01, 10);
  view.camera.position.z = 2;
  return view;
}

function pixel(view, x, y) {
  const i = 4 * (view.canvas.width * y + x);
  return Array.from(view.context.data.subarray(i, i + 4));
}

test('selecting either road segment changes only its displayed tint and keeps kerbstone ink intact', () => {
  const first = { ...markedPanel(), id: 'road-1', role: 'road' };
  const second = { ...panel(1, 'road-2'), role: 'road' };
  for (let i = 0; i < second.positions.length; i += 3)
    second.positions[i] += 1;
  second.bounds = { min: [1, 0, 0], max: [2, 1, 0] };
  const view = pixelViewport(200, 100);
  view.camera.right = 2;
  view.camera.updateProjectionMatrix();
  view.setParts([first, second], false);
  view.softwareDraw();
  const unselected = pixel(view, 45, 40);
  const { preview } = view.group.children[0].userData;
  const indices = preview.indices, marks = preview.marks;
  for (const id of ['road-1', 'road-2']) {
    view.select(id, new Set());
    view.softwareDraw();
    const [activeX, otherX] = id === 'road-1' ? [45, 145] : [145, 45];
    const [r, , b] = pixel(view, activeX, 40);
    assert.ok(b - r > 25, 'selection is visibly blue on the unpainted road');
    assert.deepEqual(pixel(view, otherX, 40), unselected);
    assert.deepEqual(pixel(view, 25, 88), [229, 72, 77, 255]);
    assert.deepEqual(pixel(view, 72, 88), [236, 233, 226, 255]);
    assert.equal(preview.indices, indices);
    assert.equal(preview.marks, marks);
  }
  view.clearParts();
});

test('WebGL retints existing track materials and creases while preserving ink, mesh buffers and editor part colours', () => {
  const view = viewport(true);
  view.setParts([markedPanel(), panel(1, 'editor body')], false);
  const [border, body] = view.group.children;
  const edge = border.children.find((item) => item.isLineSegments);
  const ink = border.children.find((item) => item.isMesh);
  const buffer = border.geometry.getAttribute('position');
  const inkColors = Array.from(ink.geometry.getAttribute('color').array);
  const original = border.material.color.getHex();
  const originalEdge = edge.material.color.getHex();
  const bodyColor = body.material.color.getHex();
  view.select('border', new Set());
  assert.notEqual(border.material.color.getHex(), original);
  assert.notEqual(edge.material.color.getHex(), originalEdge);
  view.select('editor body', new Set());
  assert.equal(border.material.color.getHex(), original);
  assert.equal(edge.material.color.getHex(), originalEdge);
  assert.equal(body.material.color.getHex(), bodyColor);
  assert.equal(border.geometry.getAttribute('position'), buffer);
  assert.equal(border.children.length, 2);
  assert.deepEqual(Array.from(ink.geometry.getAttribute('color').array), inkColors);
  view.clearParts();
});

test('software projects only parts inside the view as the track is panned', () => {
  const view = pixelViewport();
  const first = panel(1, 'road-1');
  const second = panel(1, 'road-2');
  first.role = second.role = 'road';
  for (let i = 0; i < second.positions.length; i += 3) second.positions[i] += 3;
  second.bounds = { min: [3, 0, 0], max: [4, 1, 0] };
  view.setParts([first, second], false);
  const [a, b] = view.group.children.map((m) => m.userData.preview);
  view.softwareDraw();
  assert.ok(a.screen);
  assert.equal(b.screen, undefined);
  view.camera.position.x = 3;
  view.softwareDraw();
  assert.ok(b.screen);
  assert.ok(pixel(view, 75, 25)[3] > 0);
  view.clearParts();
});

test('clipped selections highlight only the selected patches, including alongside ordinary faces', () => {
  const part = panel();
  const view = pixelViewport(100, 100);
  view.setParts([part], false);
  view.softwareDraw();
  const unselected = pixel(view, 70, 80);
  const patch = (x, y) => {
    const points = [
      [x, y, 0],
      [x + 0.2, y, 0],
      [x + 0.2, y + 0.2, 0],
      [x, y + 0.2, 0],
    ];
    return {
      triangleIndices: [0, 1],
      patches: [
        [points[0], points[1], points[2]],
        [points[0], points[2], points[3]],
      ],
    };
  };
  const bottom = patch(0.25, 0.05);
  view.highlightRegions(part.id, [bottom, patch(0.65, 0.75)]);
  view.softwareDraw();
  assert.equal(view.highlight.geometry.index.count, 12);
  assert.equal(view.highlight.geometry.getAttribute('position').count, 8);
  assert.deepEqual(pixel(view, 70, 80), unselected);
  for (const [x, y] of [
    [34, 88],
    [73, 16],
  ]) {
    const [r, , b] = pixel(view, x, y);
    assert.ok(b > r * 2, 'only the selected patch takes the blue highlight');
  }
  view.highlightRegions(part.id, [{ triangleIndices: [1] }, bottom]);
  view.softwareDraw();
  assert.deepEqual(pixel(view, 70, 80), unselected);
  assert.equal(view.highlight.geometry.index.count, 9);
  const [r, , b] = pixel(view, 15, 25);
  assert.ok(b > r * 2, 'the independent face joins the clipped patch');
  view.clearParts();
});

test('software paint covers only the visible top, including where an inclined part crosses it', () => {
  const part = markedPanel(),
    cover = panel(1, 'inclined cover');
  for (let i = 0; i < cover.positions.length; i += 3)
    cover.positions[i + 2] = cover.positions[i] - 0.75;
  cover.bounds = { min: [0, 0, -0.75], max: [1, 1, 0.25] };
  const view = pixelViewport();
  for (const order of [
    [part, cover],
    [cover, part],
  ]) {
    view.setParts(order, false);
    view.softwareDraw();
    assert.deepEqual(pixel(view, 50, 87), [229, 72, 77, 255]);
    assert.deepEqual(pixel(view, 135, 87), [236, 233, 226, 255]);
    const front = pixel(view, 185, 87);
    assert.ok(
      front[0] < 200 && front[3] === 255,
      'the inclined part occludes the white ink',
    );
  }
  view.select(part.id, new Set([cover.id]));
  view.softwareDraw();
  assert.deepEqual(pixel(view, 185, 87), [236, 233, 226, 255]);
  view.select(part.id, new Set([part.id, cover.id]));
  view.softwareDraw();
  assert.equal(pixel(view, 50, 87)[3], 0);
  view.select(part.id, new Set([cover.id]));
  view.camera.position.set(0, 0, -2);
  view.camera.lookAt(0, 0, 0);
  view.camera.left = -1;
  view.camera.right = 0;
  view.camera.updateProjectionMatrix();
  view.softwareDraw();
  assert.equal(
    pixel(view, 50, 87)[3],
    0,
    'paint cannot show through from underneath',
  );
  view.clearParts();
});

test('software pixels stay continuous across triangulated dark surfaces and adjacent white markings through zoom', () => {
  const part = panel(6);
  part.role = 'road';
  part.kerbMarkings = [
    {
      color: '#ffffff',
      points: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0.5, 0],
      ],
    },
    {
      color: '#ffffff',
      points: [
        [0, 0, 0],
        [1, 0.5, 0],
        [0, 0.5, 0],
      ],
    },
  ];
  const view = pixelViewport(101, 87);
  view.setParts([part], false);
  for (const zoom of [1, 1.15, 2]) {
    view.camera.zoom = zoom;
    view.camera.updateProjectionMatrix();
    view.softwareDraw();
    const road = pixel(view, 50, 20);
    assert.ok(road[0] < 100 && road[3] === 255);
    for (let y = 5; y < 82; y++)
      for (let x = 5; x < 96; x++) {
        if (y < 42) assert.deepEqual(pixel(view, x, y), road);
        if (y > 44) assert.deepEqual(pixel(view, x, y), [255, 255, 255, 255]);
      }
  }
  view.clearParts();
});

test('dense software models retain a filled silhouette and the exact indexed pick surface', () => {
  const part = panel(150),
    view = viewport();
  view.setParts([part], false);
  const mesh = view.group.children[0],
    preview = mesh.userData.preview;
  assert.equal(mesh.geometry.index.array, part.indices);
  assert.ok(preview.indices.length / 3 <= 18000);
  assert.ok(preview.indices.length < part.indices.length);
  let area = 0;
  const point = (i, k) => preview.positions[preview.indices[i] * 3 + k];
  for (let i = 0; i < preview.indices.length; i += 3) {
    area +=
      ((point(i + 1, 0) - point(i, 0)) * (point(i + 2, 1) - point(i, 1)) -
        (point(i + 1, 1) - point(i, 1)) * (point(i + 2, 0) - point(i, 0))) /
      2;
  }
  assert.ok(area > 0.95 && area <= 1.001);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(0.854, 0.823, 1),
    new THREE.Vector3(0, 0, -1),
  );
  const expectedFace =
    (Math.floor(0.823 * 150) * 150 + Math.floor(0.854 * 150)) * 2 + 1;
  assert.equal(
    ray.intersectObjects(view.group.children, false)[0].faceIndex,
    expectedFace,
  );
  view.clearParts();
});

test('large software canvases cap backing pixels while projected guides stay in CSS pixels', () => {
  const view = pixelViewport();
  view.span = 100;
  for (const [w, h] of [
    [1000, 700],
    [3840, 2160],
  ]) {
    view.host = { clientWidth: w, clientHeight: h };
    view.resize();
    assert.ok(view.canvas.width * view.canvas.height <= 2_400_000);
    if (w === 1000)
      assert.deepEqual([view.canvas.width, view.canvas.height], [w, h]);
    assert.ok(Math.abs(view.canvas.width / view.canvas.height - w / h) < 0.002);
    view.camera.updateMatrixWorld();
    const point = view.projectPoint([0, 0, 0]);
    assert.deepEqual([point.x, point.y], [w / 2, h / 2]);
  }
});

test('the software budget covers the entire assembly and keeps small parts detailed', () => {
  const view = viewport(),
    small = panel(1, 'clip');
  view.setParts([panel(110, 'left'), panel(110, 'right'), small], false);
  const counts = view.group.children.map(
    (m) => m.userData.preview.indices.length / 3,
  );
  assert.ok(counts.reduce((a, b) => a + b) <= 18000);
  assert.equal(counts[2], 2);
  view.clearParts();
});

test('flat panels show perimeter edges and omit the internal diagonal in both renderers', () => {
  const part = panel(),
    gpu = viewport(true),
    cpu = viewport();
  gpu.setParts([part], false);
  cpu.setParts([part], false);
  const mesh = gpu.group.children[0],
    outline = mesh.children[0];
  assert.equal(outline.geometry.index.count, 8);
  assert.equal(
    outline.geometry.attributes.position,
    mesh.geometry.attributes.position,
  );
  assert.deepEqual([...cpu.group.children[0].userData.preview.marks], [3, 6]);
  gpu.highlightFaces(part.id, [1]);
  const highlight = gpu.highlight;
  assert.equal(
    highlight.geometry.attributes.position,
    mesh.geometry.attributes.position,
  );
  assert.deepEqual([...highlight.geometry.index.array], [0, 3, 2]);
  gpu.select(part.id, new Set([part.id]));
  assert.equal(highlight.parent.visible, false);
  gpu.clearHighlight();
  assert.equal(highlight.geometry.attributes.position, undefined);
  assert.equal(mesh.geometry.attributes.position.array, part.positions);
  let released = false;
  outline.geometry.addEventListener('dispose', () => {
    released = true;
  });
  gpu.clearParts();
  cpu.clearParts();
  assert.equal(released, true);
});

test('Club bend outlines follow the slot lips and floor without crossing the guide walls or white stripes', async (t) => {
  const wasm = await init();
  wasm.setup();
  const engine = createEngine(wasm),
    project = newProject();
  t.after(() => engine.dispose());
  const p = project.track.params;
  Object.assign(p, {
    whiteLineRoad: 'both',
    whiteLineGroove: true,
    braidFeedSide: 'both',
    braidFeedLength: 4.3,
  });
  const road = engine.build(project).find((part) => part.role === 'road');
  for (const gpu of [true, false]) {
    const view = viewport(gpu);
    view.setParts([road], false);
    t.after(() => view.clearParts());
    const mesh = view.group.children[0],
      edges = [];
    if (gpu) {
      edges.push(
        ...mesh.children.find((child) => child.isLineSegments).geometry.index
          .array,
      );
    } else {
      const { marks, indices } = mesh.userData.preview;
      for (let i = 0; i < indices.length; i++) {
        const j = i % 3;
        if (marks[(i - j) / 3] & (1 << j))
          edges.push(indices[i], indices[i - j + ((j + 1) % 3)]);
      }
    }
    const a = new THREE.Vector3(),
      b = new THREE.Vector3();
    const floorZ = p.height - p.slotDepth;
    let lipLength = 0,
      floorLength = 0;
    for (let i = 0; i < edges.length; i += 2) {
      a.fromArray(road.positions, 3 * edges[i]);
      b.fromArray(road.positions, 3 * edges[i + 1]);
      const x = (a.x + b.x) / 2,
        y = (a.y + b.y) / 2 + p.radius;
      // Exclude the real vertical edges where the arc terminates.
      if (Math.abs(Math.atan2(x, y)) > ((p.angle * Math.PI) / 180) * 0.45)
        continue;
      const offset = Math.abs(Math.hypot(x, y) - p.radius);
      const margin = p.width / 2 - offset;
      if (a.z === p.height && b.z === p.height)
        assert.ok(
          margin <= 0.1 || margin >= p.whiteLineWidth - 0.1,
          'edge inside the paint',
        );
      const distanceToSlotWall = Math.abs(
        Math.abs(offset - p.laneSpacing / 2) - p.slotWidth / 2,
      );
      if (distanceToSlotWall > 0.05) continue;
      const lipZ = p.height - p.braidDepth;
      if (a.z === lipZ && b.z === lipZ) lipLength += a.distanceTo(b);
      if (a.z === floorZ && b.z === floorZ) floorLength += a.distanceTo(b);
      if (Math.min(a.z, b.z) >= floorZ && Math.abs(a.z - b.z) >= 0.05) {
        // With the braid next to the slot, its feed exposes a real vertical
        // edge at each end of the aperture. Tessellation stations inside
        // that opening must never introduce extra walls or outlines.
        const radians = (p.angle * Math.PI) / 180;
        const t = Math.atan2(x, y) / radians + 0.5;
        const laneRadius =
          p.radius +
          (Math.sign(Math.hypot(x, y) - p.radius) * p.laneSpacing) / 2;
        const fromFeed =
          Math.abs(t - p.braidFeedStations[0]) * radians * laneRadius;
        assert.ok(
          Math.abs(fromFeed - p.braidFeedLength / 2) < 0.005,
          'seam down the guide wall',
        );
      }
    }
    // Four genuine lips and four floor edges run around the inspected arc.
    const arc = (p.radius * p.angle * Math.PI) / 180;
    assert.ok(lipLength > 3 * arc && floorLength > 3 * arc);
  }
});

test('redraw requests coalesce and the viewport stays idle after presenting a frame', () => {
  const previous = globalThis.requestAnimationFrame;
  const scheduled = [];
  globalThis.requestAnimationFrame = (cb) => {
    scheduled.push(cb);
    return 1;
  };
  try {
    const view = Object.create(Viewport.prototype);
    let frames = 0;
    const events = [];
    view.updateDepthRange = () => events.push('depth');
    view.onRender = () => events.push('guides');
    view.softwareDraw = () => {
      frames++;
      events.push('present');
    };
    view.draw();
    view.draw();
    assert.equal(scheduled.length, 1);
    scheduled.shift()();
    assert.equal(frames, 1);
    assert.equal(scheduled.length, 0);
    assert.deepEqual(events, ['depth', 'present', 'guides']);
  } finally {
    if (previous) globalThis.requestAnimationFrame = previous;
    else delete globalThis.requestAnimationFrame;
  }
});

test('a live rigid translation moves the on-screen mesh and its pick surface without rewriting the part', () => {
  const view = pixelViewport(),
    part = panel(),
    original = part.positions.slice();
  view.setParts([part], false);
  view.pickRay = new THREE.Raycaster();
  view.setPickSource(part);
  const mesh = view.group.children[0],
    neutral = mesh.userData.preview.palette;
  view.setDisplayTranslation(part.id, [0.6, 0, 0], true);
  assert.notEqual(mesh.userData.preview.palette, neutral);
  view.softwareDraw();
  const left = new THREE.Vector2(-0.5, 0);
  assert.equal(view.intersectionAt(left, true), undefined);
  assert.equal(view.intersectionAt(left).object, view.pickMesh);
  const alpha = (x) => view.context.data[4 * (view.canvas.width * 50 + x) + 3];
  assert.equal(alpha(35), 0);
  assert.equal(alpha(160), 255);
  view.setDisplayTranslation(part.id, [0, 0, 0]);
  assert.equal(mesh.userData.preview.palette, neutral);
  view.softwareDraw();
  assert.equal(alpha(35), 255);
  assert.deepEqual(part.positions, original);
  view.setPickSource(null);
  view.clearParts();
});

test('transferred crease indices handle empty outlines and vertex 65535 without index truncation', () => {
  const part = panel();
  const small = creaseLineIndices(part);
  assert.ok(small instanceof Uint16Array);
  assert.equal(small.length, 8);
  const empty = creaseLineIndices({ ...part, indices: new Uint32Array() });
  assert.equal(empty.length, 0);

  const positions = new Float32Array(65536 * 3);
  positions[3] = 1;
  positions[65535 * 3 + 1] = 1;
  const wide = creaseLineIndices({ positions, indices: [0, 1, 65535] });
  const transferred = structuredClone(wide, { transfer: [wide.buffer] });
  assert.equal(wide.byteLength, 0);
  assert.ok(transferred instanceof Uint32Array);
  assert.deepEqual([...transferred], [0, 1, 1, 65535, 65535, 0]);
});

test('whole track sections reuse their edge buffer and clipped tracks derive edges from their new skin and cap', (t) => {
  const view = viewport(true);
  t.after(() => view.clearParts());
  const original = { ...panel(), role: 'road' };
  original.creaseLines = creaseLineIndices(original);
  view.setParts([original], false);
  const plane = { axis: 2, position: 0, high: true };
  const line = (mesh) => mesh.children.find((child) => child.isLineSegments);
  view.showSection([{ id: original.id, whole: true }], plane);
  assert.equal(
    line(view.sectionGroup.children[0]).geometry.index.array,
    original.creaseLines,
  );

  // This retessellated skin exceeds the software preview triangle budget.
  const { id, positions, indices } = panel(100);
  view.showSection([{ id, positions, indices, capIndices: indices.slice(0, 3) }], plane);
  const [skinMesh, cap] = view.sectionGroup.children;
  const edges = line(skinMesh);
  assert.equal(edges.geometry.index.count, 4 * 100 * 2);
  assert.equal(edges.geometry.attributes.position.array, positions);
  assert.equal(line(cap).geometry.index.count, 6);
  assert.equal(edges.material.depthTest, true);
  assert.equal(edges.material.depthWrite, false);
  assert.equal(edges.material.depthFunc, THREE.LessEqualDepth);
  view.clearSection();
  assert.equal(
    line(view.group.children[0]).geometry.index.array,
    original.creaseLines,
  );
});

test('the enclosure stays within the depth range across a small scale change and zoom, including when it crosses the eye', async (t) => {
  const wasm = await init();
  wasm.setup();
  const engine = createEngine(wasm),
    project = newProject();
  t.after(() => engine.dispose());
  project.mode = 'editor';
  const before = engine.build(project);
  project.editor.ops.push({
    type: 'transform',
    id: 'scale',
    target: 'body',
    scale: 1.04,
    rotate: [0, 0, 0],
    move: [0, 0, 0],
  });
  const after = engine.build(project);
  for (const gpu of [true, false]) {
    const view = viewport(gpu);
    view.camera = new THREE.OrthographicCamera(-75, 75, 50, -50, 0.1, 200);
    view.host = { clientWidth: 600, clientHeight: 400 };
    view.cssWidth = 600;
    view.cssHeight = 400;
    view.span = 100;
    view.camera.up.set(0, 0, 1);
    const target = new THREE.Vector3(0, 0, 8),
      towardsEye = new THREE.Vector3(0.68, -1, 0.95).normalize();
    view.camera.position.copy(target).addScaledVector(towardsEye, 150);
    view.camera.lookAt(target);
    const point = [11, -8, 16];
    for (const [step, parts] of [before, after].entries()) {
      view.setParts(parts, false);
      if (step === 1) {
        view.camera.position.copy(target).addScaledVector(towardsEye, 30);
        view.camera.zoom = 1.15;
        view.camera.updateProjectionMatrix();
      }
      view.camera.updateMatrixWorld();
      const oldXY = view.projectPoint(point);
      view.updateDepthRange();
      const newXY = view.projectPoint(point);
      assert.ok(
        Math.abs(newXY.x - oldXY.x) + Math.abs(newXY.y - oldXY.y) < 1e-7,
      );
      for (const part of parts) {
        for (let i = 0; i < part.positions.length; i += 3) {
          const vertex = new THREE.Vector3()
            .fromArray(part.positions, i)
            .project(view.camera);
          assert.ok(vertex.z > -1 && vertex.z < 1);
        }
      }
      const mid = view.projectPoint(target.toArray());
      assert.ok(
        mid.visible &&
          Math.abs(mid.x - 300) < 1e-6 &&
          Math.abs(mid.y - 200) < 1e-6,
      );
    }
    view.clearParts();
  }
});

test('live face picking uses the committed mesh, respects visibility, and releases the pick mesh when the draft ends', () => {
  const view = viewport(),
    stock = panel(10),
    draft = panel(1);
  view.camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.01, 10);
  view.camera.position.z = 2;
  view.camera.updateMatrixWorld();
  view.pickRay = new THREE.Raycaster();
  view.setParts([draft], false);
  view.setPickSource(stock);
  const ndc = new THREE.Vector2(0.37, 0.15);
  const face = view.intersectionAt(ndc);
  assert.equal(face.object.userData.id, stock.id);
  assert.ok(face.faceIndex > 1);
  view.highlightFaces(stock.id, [face.faceIndex]);
  assert.equal(view.highlight.userData.preview.positions.length, 9);
  assert.deepEqual(
    [...view.highlight.geometry.index.array],
    [...stock.indices.slice(face.faceIndex * 3, face.faceIndex * 3 + 3)],
  );
  const pickGeometry = face.object.geometry;
  let disposed = 0;
  pickGeometry.addEventListener('dispose', () => disposed++);
  view.setPickSource(stock);
  assert.equal(view.pickMesh.geometry, pickGeometry);
  view.select(stock.id, new Set([stock.id]));
  assert.equal(view.intersectionAt(ndc), undefined);
  view.select(stock.id, new Set());
  view.setPickSource(null);
  assert.equal(disposed, 1);
  assert.ok(view.intersectionAt(ndc).faceIndex <= 1);
  view.clearParts();
});

test('face tools can target a nearer existing part through a live preview, while history picks stay on their source', () => {
  const view = viewport();
  const source = panel(),
    peer = panel(1, 'peer'),
    pending = panel(1, 'pending');
  for (const [part, height] of [
    [peer, 0.4],
    [pending, 0.8],
  ]) {
    for (let i = 2; i < part.positions.length; i += 3)
      part.positions[i] = height;
    part.bounds = { min: [0, 0, height], max: [1, 1, height] };
  }
  view.camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.01, 10);
  view.camera.position.z = 2;
  view.camera.updateMatrixWorld();
  view.pickRay = new THREE.Raycaster();
  view.setParts([source, peer, pending], false);
  const ndc = new THREE.Vector2(-0.2, 0.3);
  view.setPickSource(source, [source.id, peer.id]);
  assert.equal(view.intersectionAt(ndc).object.userData.id, peer.id);
  view.select(source.id, new Set([peer.id]));
  assert.equal(view.intersectionAt(ndc).object, view.pickMesh);
  view.select(source.id, new Set());
  view.setPickSource(source);
  assert.equal(view.intersectionAt(ndc).object, view.pickMesh);
  view.setPickSource(null);
  view.clearParts();
});
