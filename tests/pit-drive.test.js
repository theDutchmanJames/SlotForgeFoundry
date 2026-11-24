// The motor drive of a pit lane's flipper: a cam slider and an in-line motor
// in the island between the outer main slot and the pit slot.
import assert from 'node:assert/strict';
import test from 'node:test';
import init from 'manifold-3d';
import { SolidWorkshop } from '../src/geometry/solids.js';
import { pitBraidLayout } from '../src/geometry/pit-braids.js';
import { pitDriveLayout } from '../src/geometry/pit-drive.js';
import { maxPitMotorHeight } from '../src/geometry/pit-motor-mount.js';
import { pitLayout, pitPrintPath } from '../src/geometry/special-junction-layout.js';
import { TURNOUT_DRIVE } from '../src/geometry/turnout-drive.js';
import { withPrintableSolid } from '../src/geometry/joints.js';
import { assemblyNotes } from '../src/special-print.js';
import { specialControls } from '../src/special-piece-controls.js';
import { specialAssemblyNotes, specialTrackParams } from '../src/special-pieces.js';
import { buildTrack, defaultTrack, trackParameters, validateTrack } from '../src/track.js';

const wasm = await init();
wasm.setup();

function pit(track = {}, special = {}) {
  const p = specialTrackParams('pit', { ...defaultTrack(), width: 200, laneSpacing: 100, ...track });
  Object.assign(p, track);
  Object.assign(p.special, { motorMount: true, ...special });
  return trackParameters(p);
}
const drivesOf = (p) => {
  const layout = pitLayout(p);
  return layout.forks.map((fork, i) => ({
    fork,
    branch: layout.lanePaths[p.lanes + i],
    drive: pitDriveLayout(p, fork, layout.lanePaths[p.lanes + i]),
  }));
};
function built(p, inspect) {
  const parts = buildTrack(wasm, p),
    work = new SolidWorkshop(wasm);
  try {
    return inspect(parts, work);
  } finally {
    work.close();
    parts.forEach((part) => part.solid.delete());
  }
}
// The lateral position of a lane at x, on its printed chords.
function lateralAt(route, x) {
  const i = route.findIndex(([station]) => station > x);
  if (i <= 0) return route[i === 0 ? 0 : route.length - 1][1];
  const [a, b] = [route[i - 1], route[i]];
  return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
}

test('a pit with a motor gets a slider and an in-line cradle for each flipper, and no pushrod', () => {
  for (const [side, hands] of [['left', ['left']], ['right', ['right']], ['both', ['left', 'right']]]) {
    const p = pit({}, { side });
    assert.doesNotThrow(() => validateTrack(p));
    built(p, (parts) => {
      for (const hand of hands) {
        const ids = ['pit-slider-', 'pit-mount-', 'pit-blade-', 'pit-crank-', 'pit-bearing-'].map((id) => id + hand);
        for (const id of ids) assert.ok(parts.some((part) => part.id === id), id);
        const crank = parts.find((part) => part.id === 'pit-crank-' + hand);
        assert.equal(crank.crankGuide, undefined, 'the crank carries a pin, not an eye for a pushrod');
        assert.match(parts.find((part) => part.id === 'pit-slider-' + hand).name, /pit slider$/);
      }
      assert.equal(parts.filter((part) => part.role === 'turnoutSlider').length, hands.length);
      assert.equal(parts.filter((part) => part.role === 'motorMount').length, hands.length);
      for (const part of parts) assert.equal(part.solid.status(), 'NoError', part.id);
    });
  }
  // Without a motor nothing of the drive is made.
  built(pit({}, { motorMount: false }), (parts) => {
    assert.equal(parts.some((part) => ['turnoutSlider', 'motorMount'].includes(part.role)), false);
    assert.ok(parts.find((part) => part.role === 'turnoutArm').crankGuide);
  });
});

test('the slider and the motor lie in the island, clear of both slots and their braid', () => {
  for (const [name, track, special] of [
    ['10 mm track', { height: 10, slotDepth: 8 }, {}],
    ['12 mm track, right', { height: 12, slotDepth: 7 }, { side: 'right' }],
    ['narrow island', {}, { pitOffset: 45 }],
    ['12 mm stroke', {}, { motorStroke: 12 }],
  ]) {
    const p = pit(track, special);
    const half = p.slotWidth / 2;
    for (const { fork, branch, drive } of drivesOf(p)) {
      const base = branch[0][1];
      assert.equal(drive.base, base, name);
      assert.equal(drive.sign, fork.sign, name);
      for (const [x0, y0, x1, y1] of [...drive.channels, drive.chamber, drive.slide]) {
        // Measured from the main slot towards the pit slot.
        assert.ok(Math.min(y0, y1) >= half + TURNOUT_DRIVE.slotWall - 1e-6, name + ': beside the main slot ' + Math.min(y0, y1));
        for (const x of [x0, x1]) {
          const island = fork.sign * (lateralAt(branch, x) - base);
          assert.ok(Math.max(y0, y1) <= island - half - TURNOUT_DRIVE.slotWall + 1e-6, name + ': beside the pit slot at ' + x);
        }
      }
      // Everything lies before the middle of the pit box.
      assert.ok(drive.start > -p.length / 2 && drive.end < 0, name);
    }
  }
});

test('nothing of the drive overlaps in either position, and the slider carries the pin of the crank across', () => {
  for (const [track, special] of [
    [{ height: 10, slotDepth: 8 }, { side: 'left' }],
    [{ height: 12, slotDepth: 7, hollow: false }, { side: 'both', motorStroke: 6 }],
  ]) {
    const positions = {};
    for (const turnoutPosition of ['main', 'pit']) {
      const p = pit(track, { ...special, turnoutPosition });
      built(p, (parts, work) => {
        const moving = parts.filter((part) => ['turnout', 'turnoutArm', 'turnoutSlider'].includes(part.role));
        const fixed = parts.filter((part) => ['road', 'turnoutBearing', 'motorMount'].includes(part.role));
        for (const a of moving)
          for (const b of [...fixed, ...moving.filter((other) => other !== a)]) {
            const volume = work.and(a.solid, b.solid).volume();
            assert.ok(volume < 0.002, turnoutPosition + ': ' + a.id + ' meets ' + b.id + ' (' + volume.toFixed(4) + ' mm³)');
          }
        for (const part of [...moving, ...fixed.filter((item) => item.role !== 'road')])
          assert.ok(part.solid.boundingBox().min[2] > 0, part.id + ' clears the table');
        positions[turnoutPosition] = Object.fromEntries(
          parts.filter((part) => part.role === 'turnoutSlider').map((part) => [part.id, part.solid.boundingBox().min]),
        );
      });
    }
    // Open, the slider has moved by the stroke along the road and not sideways.
    const p = pit(track, special);
    for (const [id, closed] of Object.entries(positions.main)) {
      const open = positions.pit[id];
      assert.ok(Math.abs(open[0] - closed[0] - p.special.motorStroke) < 1e-6, id);
      assert.ok(Math.abs(open[1] - closed[1]) < 1e-6 && Math.abs(open[2] - closed[2]) < 1e-6, id);
    }
  }
});

test('the slider prints upside down and gives the same STL whichever route is selected', () => {
  const sizes = [];
  for (const turnoutPosition of ['main', 'pit'])
    built(pit({}, { turnoutPosition }), (parts) => {
      const slider = parts.find((part) => part.role === 'turnoutSlider');
      withPrintableSolid(slider, (solid) => {
        const { min, max } = solid.boundingBox();
        assert.ok(Math.abs(min[2]) < 1e-9);
        sizes.push([...min, ...max, solid.volume()]);
      }, { sideDown: true });
      // In place it is where it sits in the road.
      withPrintableSolid(slider, (solid) => assert.ok(solid.boundingBox().min[2] > 0.2));
    });
  assert.deepEqual(sizes[0], sizes[1]);
});

test('the island braids start behind the slider and their entry contacts behind the motor', () => {
  for (const pitContactMode of ['wire', 'braid']) {
    const p = pit({ height: 10, slotDepth: 8 }, { pitContactMode });
    const layout = pitLayout(p),
      braids = pitBraidLayout(p, layout);
    const [{ drive }] = drivesOf(p);
    assert.deepEqual(braids.driveSpan, { min: drive.start, max: drive.end });
    const first = (route) => braids.conductors.find((rail) => rail.route === route).points[0][0];
    assert.ok(first('main island') >= drive.mainStripStart - 1e-6, pitContactMode + ' main island ' + first('main island'));
    assert.ok(first('pit island') >= drive.stripStart - 1e-6, pitContactMode + ' pit island ' + first('pit island'));
    // The entry contacts of both island strips lie behind the motor cradle.
    const entries = braids.jumpers.filter((wire) => wire.from[0] < 0);
    assert.equal(entries.length, 2);
    for (const wire of entries)
      assert.ok(wire.from[0] - wire.wireWidth / 2 > drive.end, pitContactMode + ' contact at ' + wire.from[0] + ' behind ' + drive.end);
    // Without a motor the strips are as they were: they start at the split.
    const off = trackParameters({ ...p, special: { ...p.special, motorMount: false } });
    const plain = pitBraidLayout(off, pitLayout(off));
    assert.equal(plain.driveSpan, undefined);
    const plainFirst = plain.conductors.find((rail) => rail.route === 'main island').points[0][0];
    assert.ok(plainFirst <= first('main island') + 1e-6);
    // The far ends, at the merge, do not move.
    const last = (set, route) => set.conductors.find((rail) => rail.route === route).points.at(-1)[0];
    for (const route of ['main island', 'pit island'])
      assert.ok(Math.abs(last(braids, route) - last(plain, route)) < 1e-6, route);
  }
  // A pit without braid still keeps its seams clear of the drive.
  const bare = pit({ braidWidth: 0 });
  assert.ok(pitBraidLayout(bare, pitLayout(bare)).driveSpan);
});

test('no print seam divides the slider or the motor, whatever the segment count', () => {
  for (const segments of [2, 3, 4]) {
    const p = pit({ segments, length: 900 });
    const layout = pitLayout(p),
      braids = pitBraidLayout(p, layout);
    const path = pitPrintPath(layout.path, layout.forks, p, braids);
    const [{ drive }] = drivesOf(p);
    for (const t of path.cuts.slice(1, -1)) {
      const x = (t - 0.5) * p.length;
      assert.ok(x < drive.start || x > drive.end, segments + ' segments: a seam at ' + x);
    }
    built(p, (parts) => {
      assert.equal(parts.filter((part) => part.role === 'turnoutSlider').length, 1);
      for (const part of parts) assert.equal(part.solid.status(), 'NoError', part.id);
    });
  }
});

test('a motor or an island that does not fit is refused in the words of a pit lane', () => {
  const refuse = (track, special, text) =>
    assert.throws(() => validateTrack(pit(track, special)), text, JSON.stringify([track, special]));
  refuse({}, { motorStroke: 1 }, /Usable stroke must be between 2 and 12 mm/);
  refuse({}, { motorStroke: 13 }, /Usable stroke must be between 2 and 12 mm/);
  refuse({}, { turnoutPlay: 0.9 }, /Pin play must be between 0.05 and 0.6 mm/);
  // A 40 mm motor fits a 100 mm island; a 90 mm one does not.
  assert.doesNotThrow(() => validateTrack(pit({}, { motorWidth: 40 })));
  refuse({}, { motorWidth: 90 }, /too narrow for the slider and its motor\. Increase Pit lane offset, lengthen the pit/);
  // A long motor still fits along the pit box; one with a long plunger as well does not.
  assert.doesNotThrow(() => validateTrack(pit({}, { motorLength: 140 })));
  refuse({}, { motorLength: 150, plungerProjection: 100 }, /The pit box ends before the motor does\. Lengthen the pit, or use a shorter motor or stroke/);
  const low = pit({ height: 10, slotDepth: 8 });
  refuse({ height: 10, slotDepth: 8 }, { motorHeight: maxPitMotorHeight(low) + 1.5 }, /Reduce Body height or increase Track height/);
  // None of these names a setting that only a turnout has.
  for (const special of [{ motorWidth: 90 }, { motorLength: 150, plungerProjection: 100 }])
    assert.throws(() => validateTrack(pit({}, special)), (error) => !/Branch (radius|angle)|Main road length/.test(error.message));
  // The same pit without the motor is fine.
  assert.doesNotThrow(() => validateTrack(pit({}, { motorMount: false, motorWidth: 90, motorStroke: 30 })));
});

test('the controls, the notes and the preview speak of the slider when the motor is on', () => {
  const on = pit(),
    off = pit({}, { motorMount: false });
  const markup = specialControls(on);
  assert.match(markup, /name="spMotorMount" checked/);
  assert.match(markup, /data-manual-fields hidden/);
  assert.match(markup, /Plunger eye diameter/);
  assert.match(markup, /name="spTurnoutPlay"/);
  assert.match(markup, /name="spMotorStroke"[^>]*min="2"[^>]*max="12"/);
  assert.match(markup, /between the main slot and the pit slot/);
  const plain = specialControls(off);
  assert.match(plain, /data-manual-fields>/);
  assert.match(plain, /Crank hole diameter/);
  assert.match(plain, /data-motor-fields hidden/);
  const steps = specialAssemblyNotes(on).join('\n');
  assert.match(steps, /Lay the slider in its channel between the main slot and the pit slot/);
  assert.match(steps, /No wire has to be bent/);
  assert.doesNotMatch(steps, /pushrod/i);
  assert.match(specialAssemblyNotes(off).join('\n'), /bent pushrod/);
  const sheet = assemblyNotes(on);
  assert.match(sheet, /The slider moves 2 mm\. Its slot has a/);
  assert.match(sheet, /The motor body is 15 × 8 × 5 mm/);
  assert.doesNotMatch(sheet, /pushrod/i);
  assert.match(assemblyNotes(off), /eye for a bent pushrod/);
  // The cradle carries the measured motor for the preview, in line with the slider.
  built(on, (parts) => {
    const { caseBounds, rodPath } = parts.find((part) => part.role === 'motorMount').motorGuide;
    const size = caseBounds.max.map((v, i) => v - caseBounds.min[i]);
    assert.deepEqual(size.map((v) => Number(v.toFixed(6))), [15, 8, 5]);
    assert.equal(rodPath[0][1], rodPath[1][1], 'the plunger runs along the road');
    assert.ok(rodPath[0][0] < rodPath[1][0]);
  });
});
