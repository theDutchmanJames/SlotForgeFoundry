import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import init from 'manifold-3d';
import { packKit } from '../src/kit.js';
import { keeperToolSTL } from '../src/keeper-tool-stl.js';
import { parseSTL, encodeSTL } from '../src/editor.js';
import { newProject } from '../src/project.js';
import { buildTrack } from '../src/track.js';
import { specialTrackParams } from '../src/special-pieces.js';
import { toolGuides } from '../src/guide-geometry.js';

const wasm = await init();
wasm.setup();

test('switching the pit route moves both installed parts and keeps every printable STL identical', (t) => {
  const project = newProject();
  const params = specialTrackParams('pit', project.track.params);
  Object.assign(params, { borderSide: 'none', joint: 'none', jointStart: 'none', jointEnd: 'none' });
  function pack(position) {
    project.track.params = { ...params, special: { ...params.special, turnoutPosition: position } };
    const parts = buildTrack(wasm, project.track.params);
    t.after(() => parts.forEach(part => part.solid.delete()));
    const crank = parts.find(part => part.role === 'turnoutArm');
    const guide = toolGuides({ mode: 'track', tab: 'geometry', track: project.track, part: crank, parts })
      .find(g => g.id === 'pit-eye-clearance-left');
    assert.match(guide.text, /1.4 mm/);
    assert.deepEqual(guide.paths[0][0], guide.paths[0].at(-1), 'closed outline across the full throw');
    const files = unzipSync(packKit(wasm, parts, project, encodeSTL));
    return {
      files,
      blade: parts.find(part => part.role === 'turnout').solid,
      crank: crank.solid,
      eyeGuide: guide,
    };
  }
  const straight = pack('main');
  const diverted = pack('pit');
  assert.deepEqual(straight.eyeGuide.paths[0], diverted.eyeGuide.paths[0], 'the pocket is stationary');
  assert.notDeepEqual(straight.eyeGuide.anchor, diverted.eyeGuide.anchor, 'the dimension follows the eye');
  for (const part of ['blade', 'crank']) {
    const difference = straight[part].subtract(diverted[part]);
    try {
      assert.ok(difference.volume() > 1, 'the ' + part + ' moves in the assembly');
    } finally {
      difference.delete();
    }
  }
  const names = Object.keys(straight.files).filter(name => name.endsWith('.stl')).sort();
  assert.equal(names.filter(name => name.startsWith('parts/V')).length, 1);
  assert.equal(names.filter(name => name.startsWith('parts/K')).length, 1);
  assert.equal(names.filter(name => name.startsWith('parts/J')).length, 1);
  assert.ok(!names.includes('tools/keeper-turning-tool.stl'), 'a track without keepers needs no tool');
  assert.match(strFromU8(straight.files['parts.csv']), /pit-bearing-left/);
  assert.match(strFromU8(straight.files['Assembly notes.txt']), /integral 4 mm pivot pin/);
  assert.match(strFromU8(straight.files['parts.csv']), /pit-crank-left/);
  assert.match(strFromU8(straight.files['Assembly notes.txt']), /eye’s two seated positions is [\d.]+ mm/);
  assert.match(strFromU8(straight.files['Assembly notes.txt']), /3 mm outside diameter and 1 mm above the tab/);
  assert.ok(names.some(name => name.startsWith('parts/T')));
  assert.deepEqual(names, Object.keys(diverted.files).filter(name => name.endsWith('.stl')).sort());
  for (const name of names)
    assert.ok(Buffer.from(straight.files[name]).equals(diverted.files[name]), name + ' changes with flipper position');
});

test('the pit kit prints the mount and shows the measured motor as a guide in both switch positions', (t) => {
  const project = newProject();
  const params = specialTrackParams('pit', project.track.params);
  Object.assign(params, { width: 200, laneSpacing: 100, height: 10, slotDepth: 8, segments: 1,
    borderSide: 'none', joint: 'none', jointStart: 'none', jointEnd: 'none' });
  Object.assign(params.special, { motorMount: true, motorLength: 15, motorWidth: 8, motorHeight: 5,
    motorStroke: 2, eyeDiameter: 1.6, rodDiameter: 1, pitOffset: 100, plungerProjection: 2 });
  let previousPrint, previousRod;
  for (const turnoutPosition of ['main', 'pit']) {
    project.track.params = { ...params, special: { ...params.special, turnoutPosition } };
    const parts = buildTrack(wasm, project.track.params);
    t.after(() => parts.forEach(part => part.solid.delete()));
    const mount = parts.find(part => part.role === 'motorMount');
    assert.ok(mount?.motorGuide, 'the printable cradle supplies the preview dimensions');
    const { caseBounds, rodPath } = mount.motorGuide;
    const size = caseBounds.max.map((v, i) => v - caseBounds.min[i]);
    assert.ok(size.every((v, i) => Math.abs(v - [8, 15, 5][i]) < 1e-6));
    assert.ok(caseBounds.min[2] >= 0 && mount.solid.boundingBox().min[2] >= 0);
    const box = wasm.Manifold.cube(size);
    const caseGauge = box.translate(caseBounds.min);
    try {
      for (const part of parts) {
        const collision = caseGauge.intersect(part.solid);
        try {
          assert.ok(collision.volume() < 0.001, 'motor case hits ' + part.name);
        } finally { collision.delete(); }
      }
    } finally { caseGauge.delete(); box.delete(); }

    const guides = toolGuides({ mode: 'track', tab: 'geometry', track: project.track, parts });
    assert.match(guides.find(g => g.id === 'pit-motor-left').text, /15 × 8 × 5 mm/);
    assert.deepEqual(guides.find(g => g.id === 'pit-pushrod-left').paths, [rodPath]);
    const eye = toolGuides({ mode: 'track', tab: 'geometry', track: project.track, parts, field: 'spEyeDiameter' })
      .find(g => g.id === 'pit-eye-clearance-left');
    assert.match(eye.text, /Clearance above eye · 1.4 mm/);
    const files = unzipSync(packKit(wasm, parts, project, encodeSTL));
    const print = Object.keys(files).filter(name => name.endsWith('.stl')).sort();
    assert.equal(print.length, 5, 'road, blade, bearing, crank and mount each print once');
    const mountFile = print.find(name => name.startsWith('parts/M'));
    assert.ok(mountFile);
    const fromPlate = parseSTL(wasm, files[mountFile]);
    try {
      assert.ok(Math.abs(fromPlate.boundingBox().min[2]) < 1e-5);
    } finally { fromPlate.delete(); }
    assert.deepEqual(JSON.parse(strFromU8(files['project.slotfab'])), project);
    const meshBytes = print.map(name => Buffer.from(files[name]));
    if (previousPrint) {
      for (const [i, bytes] of meshBytes.entries()) {
        assert.ok(bytes.equals(previousPrint[i]), 'switching the route changed ' + print[i]);
      }
      assert.notDeepEqual(rodPath, previousRod, 'the pushrod moves with the selected route');
    }
    previousPrint = meshBytes;
    previousRod = rodPath;
  }
});

test('kit counts equal generated clips across placements, includes assembly locations, project and printable geometry', (t) => {
  const project = newProject();
  project.name = 'Club <bend> & clips';
  Object.assign(project.track.params, {
    segments: 2,
    joint: 'clips',
    borderMount: 'clips',
    borderJoint: 'clips',
    borderEntry: 55,
    borderApex: 55,
    borderExit: 55,
  });
  const parts = buildTrack(wasm, project.track.params);
  t.after(() => parts.forEach((p) => p.solid.delete()));
  const clips = parts.filter((p) => p.role === 'clip');
  const retainers = parts.filter((p) => p.role === 'retainer');
  assert.ok(clips.length >= 3);
  assert.equal(retainers.length, clips.length);
  const files = unzipSync(packKit(wasm, parts, project, encodeSTL));
  assert.deepEqual(JSON.parse(strFromU8(files['project.slotfab'])), project);
  const list = strFromU8(files['parts.csv']);
  assert.ok(list.includes('"' + clips[0].name + '"'));
  assert.equal(files['Clip attribution.txt'], undefined);
  assert.match(strFromU8(files['Fitting the clips.txt']), /quarter.turn/i);
  assert.deepEqual(files['tools/keeper-turning-tool.stl'], keeperToolSTL(wasm));
  assert.match(strFromU8(files['Fitting the clips.txt']), /tools\/keeper-turning-tool\.stl/);
  for (const [group, prefix] of [[clips, 'C'], [retainers, 'R']]) {
    assert.ok(list.includes('","' + group.length + '","' + group.map((p) => p.id).join(' | ') + '"'));
    assert.equal(Object.keys(files).filter((f) => f.startsWith('parts/' + prefix)).length, 1);
  }
  const map = strFromU8(files['assembly.svg']);
  assert.ok(map.includes('Club &lt;bend&gt; &amp; clips'));
  assert.equal((map.match(/<path /g) || []).length, parts.length);
  assert.ok(map.includes('C1 + R1'));
  for (const [name, bytes] of Object.entries(files))
    if (name.endsWith('.stl')) {
      const solid = parseSTL(wasm, bytes);
      try {
        assert.ok(Math.abs(solid.boundingBox().min[2]) < 1e-5);
      } finally {
        solid.delete();
      }
    }
});

test('a complete Carrera joint exports two keepers, marks both seats, and credits the original fork', (t) => {
  const project = newProject();
  Object.assign(project.track.params, {
    kind: 'straight', segments: 2, borderSide: 'none',
    joint: 'clips', jointStart: 'none', jointEnd: 'none', clipType: 'carrera-retained',
  });
  const parts = buildTrack(wasm, project.track.params);
  t.after(() => parts.forEach((p) => p.solid.delete()));
  const files = unzipSync(packKit(wasm, parts, project, encodeSTL));
  const keepers = parts.filter((p) => p.role === 'retainer');
  assert.equal(keepers.length, 2);
  assert.deepEqual(files['tools/keeper-turning-tool.stl'], keeperToolSTL(wasm));
  assert.ok(Object.keys(files).filter((f) => f.startsWith('parts/R')).length === 1);
  const list = strFromU8(files['parts.csv']);
  assert.ok(list.includes('","2","' + keepers.map((p) => p.id).join(' | ') + '"'));
  const map = strFromU8(files['assembly.svg']);
  assert.equal((map.match(/>R1<\/text>/g) ?? []).length, 2);
  assert.match(strFromU8(files['Fitting the clips.txt']), /two retainers.*15 mm/i);
  assert.match(strFromU8(files['Clip attribution.txt']), /URSUS/);
});

test('same-size bodies with different geometry are not pooled; file names, CSV and SVG escape input', (t) => {
  const project = newProject();
  project.mode = 'editor';
  const cube = wasm.Manifold.cube([4, 2, 1]);
  const other = wasm.Manifold.cube([2, 4, 1]);
  t.after(() => {
    cube.delete();
    other.delete();
  });
  const files = unzipSync(
    packKit(
      wasm,
      [
        { id: 'p1', name: '=sum(A1)', role: 'body', solid: cube },
        { id: 'p2', name: '</path>/../../Other', role: 'body', solid: other },
      ],
      project,
      encodeSTL,
    ),
  );
  assert.equal(
    Object.keys(files).filter((n) => n.startsWith('parts/')).length,
    2,
  );
  assert.ok(Object.keys(files).every((n) => !n.includes('/../')));
  assert.ok(strFromU8(files['parts.csv']).includes('"\'=sum(A1)"'));
  assert.ok(strFromU8(files['assembly.svg']).includes('&lt;/path&gt;'));
  assert.ok(!strFromU8(files['assembly.svg']).includes('</path>/../../Other'));
});
