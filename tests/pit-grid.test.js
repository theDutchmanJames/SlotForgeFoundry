import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'manifold-3d';
import { defaultTrack, buildTrack } from '../src/track.js';
import { specialTrackParams } from '../src/special-pieces.js';
import { pitGridLayout } from '../src/geometry/starting-grid.js';
import { printableSTL } from '../src/kit.js';
import { encodeSTL, parseSTL } from '../src/editor.js';

const wasm = await Module();
wasm.setup();

function pit(side = 'left', lanes = 2) {
  const p = specialTrackParams('pit', {
    ...defaultTrack(), lanes, width: lanes * 100, laneSpacing: 100,
    height: 10, slotDepth: 8, braidGap: 0.6, grooveWidth: 0.8, grooveDepth: 0.4,
  });
  p.length = 900;
  Object.assign(p.special, { side, pitOffset: 200 });
  return p;
}

const mark = { width: 64, thickness: 4, legLength: 36, position: 50, recessed: false };

function close(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 0.002, `${label}: expected ${expected}, got ${actual}`);
}

function bounds(points, axis) {
  const values = points.map(point => point[axis]);
  return [Math.min(...values), Math.max(...values)];
}

test('the pit grid moves along the flat bay, centres on each pit guide and can shrink to a simple bar', () => {
  for (const [side, lanes, centres] of [['left', 1, [200]], ['right', 2, [-250]], ['both', 2, [-250, 250]]]) {
    const p = pit(side, lanes);
    assert.deepEqual(pitGridLayout(p).paint, []);
    for (const [legLength, width] of [[36, 64], [0, 48]]) {
      const centresX = [];
      for (const position of [0, 25, 50, 100]) {
        p.special.pitGrid = { ...mark, width, legLength, position, recessed: true };
        const { paint, grooves } = pitGridLayout(p);
        assert.equal(paint.length, 2 * centres.length, 'two painted halves per pit guide');
        const [back, front] = bounds(paint.flat(), 0);
        close(front - back, legLength + mark.thickness, 'box length');
        const [start, end] = bounds(grooves.flat(), 0);
        const halfBay = 0.145 * p.length;
        assert.ok(start >= -halfBay - 1e-5 && end <= halfBay + 1e-5, 'the entire groove stays in the straight part of the bay');
        centresX.push((back + front) / 2);
        for (const centre of centres) {
          const halves = paint.filter(loop => loop.every(([, y]) => Math.abs(y - centre) <= width / 2 + 1e-5));
          assert.equal(halves.length, 2);
          const [low, high] = bounds(halves.flat(), 1);
          close(low, centre - width / 2, 'lower leg');
          close(high, centre + width / 2, 'upper leg');
          for (const loop of halves) {
            // Both ends of the bar leave room for the guide, braid and groove cap.
            assert.ok(loop.every(([, y]) => Math.abs(y - centre) > 7.1 + p.grooveWidth));
          }
        }
      }
      const [entry, quarter, middle, exit] = centresX;
      assert.ok(exit - entry > 0.29 * p.length - legLength - mark.thickness - 5);
      close(quarter - entry, (exit - entry) / 4, 'quarter of available travel');
      close(middle, 0, 'centred marker');
    }
  }
});

test('mirrored bay markers can sit at opposite ends, while a single bay uses its own position', t => {
  const p = pit('both');
  p.special.pitGrid = { ...mark, position: 0, recessed: true };
  function paintSpan(sign) {
    const points = pitGridLayout(p).paint.flat().filter(([, y]) => sign * y > 0);
    assert.ok(points.length);
    return bounds(points, 0);
  }
  const entry = paintSpan(1);
  assert.deepEqual(paintSpan(-1), entry, 'mirrored pits share the position by default');
  p.special.pitGrid.rightPosition = 100;
  const exit = paintSpan(-1);
  assert.deepEqual(paintSpan(1), entry);
  close(entry[0] - p.grooveWidth, -0.145 * p.length, 'left marker starts at entry');
  close(exit[1] + p.grooveWidth, 0.145 * p.length, 'right marker reaches exit');
  const parts = buildTrack(wasm, p);
  t.after(() => parts.forEach(part => part.solid.delete()));
  const road = parts.find(part => part.role === 'road');
  const solid = parseSTL(wasm, printableSTL(road, encodeSTL, undefined, { mode: 'track', track: { params: p } }));
  t.after(() => solid.delete());
  const { min, max } = road.solid.boundingBox();
  for (const [sign, own, opposite] of [[1, entry, exit], [-1, exit, entry]]) {
    const y = (min[1] + max[1]) / 2 - sign * (250 + 20);
    for (const [front, depth] of [[own[1], p.grooveDepth], [opposite[1], 0]]) {
      const x = front + p.grooveWidth / 2 - (min[0] + max[0]) / 2;
      const hit = solid.rayCast([x, y, -1], [x, y, p.height + 1])[0];
      close(hit?.position[2], depth, 'correct pit has the crossbar groove');
    }
  }
  for (const [side, sign] of [['left', 1], ['right', -1]]) {
    p.special.side = side;
    assert.deepEqual(paintSpan(sign), entry, 'single-side pits only use their main position control');
  }
});

test('a paint-only pit grid adds white marks to the pit road while preserving all printable solids', t => {
  const p = pit('right', 1);
  const plain = buildTrack(wasm, p);
  t.after(() => plain.forEach(part => part.solid.delete()));
  p.special.pitGrid = { ...mark, position: 75 };
  const painted = buildTrack(wasm, p);
  t.after(() => painted.forEach(part => part.solid.delete()));
  assert.deepEqual(painted.map(p => p.id), plain.map(p => p.id));
  painted.forEach((part, i) => {
    assert.deepEqual(encodeSTL(part.solid), encodeSTL(plain[i].solid));
    assert.ok(!plain[i].kerbMarkings?.length);
    if (part.role !== 'road') assert.ok(!part.kerbMarkings?.length);
  });
  const ink = painted.flatMap(part => part.kerbMarkings ?? []);
  assert.ok(ink.length);
  assert.ok(ink.every(triangle => triangle.color === '#FFFFFF'));
  const positions = ink.flatMap(triangle => triangle.points);
  const [back, front] = bounds(positions, 0);
  assert.ok(back > 0, '75% puts the complete mark on the exit side of the bay');
  close(front - back, mark.legLength + mark.thickness, 'paint length in the viewport');
  const [low, high] = bounds(positions, 1);
  close(low, -232, 'lower tip');
  close(high, -168, 'upper tip');
});

test('printed pit-grid grooves wrap both legs and bar ends, clear the braids and run continuously across a seam', t => {
  const p = pit('left');
  Object.assign(p, { segments: 2, borderSegments: 2, whiteLineRoad: 'both', roadCentreLine: 'dashed', roadLineGroove: true });
  Object.assign(p.special, { pitWhiteLine: true, pitCrossingStyle: 'dashed', pitGrid: { ...mark, recessed: true } });
  const parts = buildTrack(wasm, p);
  t.after(() => parts.forEach(part => part.solid.delete()));
  const roads = parts.filter(p => p.role === 'road');
  const boxes = roads.map(part => part.solid.boundingBox())
    .filter(({ min, max }) => min[1] < 250 && max[1] > 250);
  assert.ok(boxes.some(box => Math.abs(box.max[0]) < 0.001));
  assert.ok(boxes.some(box => Math.abs(box.min[0]) < 0.001));
  const meshes = roads.map(part => {
    const solid = parseSTL(wasm, printableSTL(part, encodeSTL, undefined, { mode: 'track', track: { params: p } }));
    t.after(() => solid.delete());
    const { min, max } = part.solid.boundingBox();
    return { solid, cx: (min[0] + max[0]) / 2, cy: (min[1] + max[1]) / 2 };
  });
  function depth(x, deltaY, expected) {
    const hits = meshes.flatMap(({ solid, cx, cy }) => {
      const xy = [x - cx, cy - (250 + deltaY)];
      return solid.rayCast([...xy, -1], [...xy, p.height + 1]).map(hit => hit.position[2]);
    });
    close(Math.min(...hits), expected, `re-imported pit STL at x=${x}, y=${250 + deltaY}`);
  }
  // The 40 mm box is centred on x=0. Ends of the legs are at -20;
  // the crossbar occupies 16–20. The printed seam crosses both legs at 0.
  for (const sign of [-1, 1]) {
    for (const [x, expected] of [[-21, 0], [-20.4, 0.4], [-19.8, 0], [19.8, 0], [20.4, 0.4], [21, 0]])
      depth(x, sign * 30, expected);
    for (const x of [-0.2, 0.2])
      for (const [offset, expected] of [[27, 0], [27.6, 0.4], [28.2, 0], [31.8, 0], [32.4, 0.4], [33, 0]])
        depth(x, sign * offset, expected);
    for (const [x, expected] of [[15, 0], [15.6, 0.4], [16.4, 0], [19.8, 0], [20.4, 0.4]])
      depth(x, sign * 20, expected);
    for (const [offset, expected] of [[0, 8], [4, 0.5], [7.3, 0], [7.8, 0.4], [8.5, 0]])
      depth(18, sign * offset, expected);
  }
});

test('invalid pit marker dimensions and positions are rejected before printing', () => {
  const p = pit();
  for (const fields of [{ position: -1 }, { position: 101 }, { position: NaN },
    { thickness: 0 }, { width: 14 }, { legLength: p.length }]) {
    p.special.pitGrid = { ...mark, ...fields };
    assert.throws(() => pitGridLayout(p), Error, JSON.stringify(fields));
  }
  p.special.side = 'both';
  for (const rightPosition of [-1, 101, NaN, '50', null]) {
    p.special.pitGrid = { ...mark, rightPosition };
    assert.throws(() => pitGridLayout(p), /position/i);
  }
});
