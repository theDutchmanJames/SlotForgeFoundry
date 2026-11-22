import assert from 'node:assert/strict';
import test from 'node:test';
import init from 'manifold-3d';
import { newProject } from '../src/project.js';
import { buildTrack } from '../src/track.js';

const wasm = await init();
wasm.setup();
const stock = {
  ...newProject().track.params,
  clipType: 'draw-key',
  borderExit: 20,
  joint: 'clips',
  borderMount: 'clips',
  borderJoint: 'clips',
  clipClearance: 0.03,
  tabWidth: 7,
};
const flat = {
  ...stock,
  kind: 'straight',
  length: 800,
  joint: 'none',
  borderMount: 'none',
  borderEntry: 45,
  borderApex: 45,
  borderExit: 45,
};
function build(params) {
  const parts = buildTrack(wasm, params);
  parts.forEach((part) => part.solid.delete());
  return parts.length;
}
function warning(params) {
  let result;
  assert.throws(
    () => build(params),
    (err) => {
      result = err.warning;
      return result && !!result.reason && !!result.advice;
    },
  );
  return result;
}

test('Club bend warning explains the required border entry width and links to a working setting', () => {
  for (const [gap, required] of [
    [0.03, 19.36],
    [0.15, 19.6],
  ]) {
    const p = { ...stock, clipClearance: gap };
    const w = warning(p);
    assert.equal(w.location, 'Outside border · start');
    assert.ok(
      w.reason.includes('Double-dovetail draw key') &&
        w.reason.includes(required + ' mm') &&
        w.reason.includes('12 mm'),
    );
    assert.match(w.advice, /Borders → Border width → Entry to 20 mm/);
    assert.deepEqual(w.setting, {
      tab: 'borders',
      field: 'borderEntry',
      label: 'Edit entry width',
    });
    assert.ok(build({ ...p, borderEntry: 20 }) > 0);
  }
});

test('a narrow finish, apex, or blended seam directs the user to the controlling widths', () => {
  const finish = warning({ ...flat, borderExit: 13 });
  assert.equal(finish.location, 'Outside border · finish');
  assert.equal(finish.setting.field, 'borderExit');
  const apex = warning({ ...flat, borderApex: 12, apexPosition: 0.5 });
  assert.equal(apex.location, 'Outside border · seam 1');
  assert.equal(apex.setting.field, 'outerApexWidth');
  for (const [position, names] of [
    [0.55, 'Entry and Apex'],
    [0.45, 'Apex and Exit'],
  ]) {
    const blend = warning({ ...flat, borderApex: 12, apexPosition: position });
    assert.equal(blend.location, 'Outside border · seam 1');
    assert.ok(blend.advice.includes(names) && blend.advice.includes('50%'));
  }
});

test('custom end placement distinguishes a nearby edge from overlapping connector supports', () => {
  const edge = warning({
    ...flat,
    borderEntry: 50,
    placements: { endClips: [0.96] },
  });
  assert.equal(edge.setting.field, 'place_endClips');
  assert.match(edge.reason, /96%.*2 mm.*free edge.*9\.68 mm/);
  const crowded = warning({
    ...flat,
    borderEntry: 60,
    placements: { endClips: [0.45, 0.5] },
  });
  assert.match(
    crowded.reason,
    /3 mm.*neighbouring Double-dovetail draw key.*19\.56 mm/,
  );
  assert.match(crowded.advice, /Border end clips/);
  assert.equal(crowded.setting.field, 'place_endClips');
});

test('border segment length gives the measured span and a feasible segment count', () => {
  const p = { ...flat, length: 120, borderSegments: 5 };
  const w = warning(p);
  assert.equal(w.setting.field, 'borderSegments');
  assert.match(w.reason, /24 mm.*Double-dovetail draw key.*30\.06 mm/);
  assert.match(w.advice, /Segments per side to 3 or fewer/);
  assert.ok(build({ ...p, borderSegments: 3 }));
});

test('a curved end can clear the opening while the full pocket crosses the taper', () => {
  const p = {
    ...stock,
    joint: 'none',
    borderMount: 'none',
    borderSegments: 1,
    borderEntry: 25,
    borderApex: 10,
    borderExit: 30,
  };
  const w = warning({ ...p, placements: { endClips: [0.6] } });
  assert.equal(w.location, 'Outside border · start');
  assert.match(w.reason, /60%.*outside the border outline/);
  assert.equal(w.setting.field, 'place_endClips');
  assert.ok(build(p));
});
