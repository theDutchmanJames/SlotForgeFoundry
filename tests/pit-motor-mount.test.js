import assert from 'node:assert/strict';
import test from 'node:test';
import init from 'manifold-3d';
import { encodeSTL, parseSTL } from '../src/editor.js';
import { SolidWorkshop } from '../src/geometry/solids.js';
import { pitLayout } from '../src/geometry/special-junction-paths.js';
import { maxPitMotorHeight, pitMotorMountLayout } from '../src/geometry/pit-motor-mount.js';
import { printableSTL } from '../src/kit.js';
import { specialTrackParams } from '../src/special-pieces.js';
import { buildTrack, defaultTrack } from '../src/track.js';

const wasm = await init();
wasm.setup();

function pit(track = {}, special = {}) {
  const p = specialTrackParams('pit', { ...defaultTrack(), ...track });
  Object.assign(p, track);
  Object.assign(p.special, { motorMount: true, ...special });
  return p;
}

function box(work, lo, hi) {
  const block = work.own(wasm.Manifold.cube(hi.map((v,i) => v - lo[i])));
  return work.own(block.translate(lo));
}

function clear(work, a, b, why) {
  const volume = work.and(a, b).volume();
  assert.ok(volume < 0.002, why + ' (' + volume.toFixed(4) + ' mm³)');
}

function printCheck(work, p, part) {
  const bytes = printableSTL(part, encodeSTL, undefined, {mode:'track',track:{params:p}});
  const stl = work.own(parseSTL(wasm, bytes));
  assert.equal(stl.status(), 'NoError');
  const pieces = stl.decompose().map(shell => work.own(shell));
  assert.equal(pieces.length, 1, part.name + ' must print in one piece');
  assert.ok(Math.abs(stl.boundingBox().min[2]) < 1e-5);
}

for (const custom of [false,true]) {
  test(custom ? 'segmented solid pit retains adjustable mirrored motors and full-length plungers' :
    'hollow pit retains the adjustable motor and clears the table in both positions', () => {
    const p = custom
      ? pit({width:200,laneSpacing:100,height:10,slotDepth:8,hollow:false,segments:3},
        {side:'both',motorLength:18,motorWidth:9,motorHeight:5.5,motorStroke:2.6,plungerProjection:3})
      : pit();
    const geometry = pitLayout(p);
    for (const position of ['main','pit']) {
      p.special.turnoutPosition = position;
      const parts = buildTrack(wasm,p), work = new SolidWorkshop(wasm);
      try {
        const roads = parts.filter(part => part.role === 'road');
        if (position === 'main') roads.forEach(part => printCheck(work,p,part));
        const road = work.union(roads.map(part => part.solid));
        for (const [i,fork] of geometry.forks.entries()) {
          const mount = pitMotorMountLayout(p,fork,geometry.lanePaths[p.lanes+i]);
          const tray = parts.find(part => part.id === 'pit-mount-'+fork.side);
          printCheck(work,p,tray);
          const {min,max} = tray.motorGuide.caseBounds;
          const motor = box(work,min,max);
          // Housing ceiling captures the casing when inverted, with a thin
          // shim space for the particular printed motor body.
          const roof = box(work,[min[0],min[1],max[2]+0.21],[max[0],max[1],max[2]+0.81]);
          assert.ok(work.own(roof.subtract(road)).volume() < 0.001, 'roof must retain motor over full body');
          assert.ok(tray.solid.boundingBox().min[2] >= 0.29, 'cradle must clear the table');
          clear(work,tray.solid,motor,'motor fits within the upright corner lips');
          for (const d of [-1.5,0,1.5]) {
            const trayAt = work.own(tray.solid.translate([0,d,0]));
            const motorAt = work.own(motor.translate([0,d,0]));
            clear(work,trayAt,road,'tray has the full screw-slot adjustment');
            clear(work,motorAt,road,'case can move with the tray to each trim limit');
            // Body and cradle together remain accessible from the underside.
            for (const dz of [-1,-3,-5])
              clear(work,work.own(work.union([trayAt,motorAt]).translate([0,0,dz])),road,
                'underside installation path must be clear');
          }
          for (const dy of [-0.35,0.35])
            assert.ok(work.and(work.own(motor.translate([0,dy,0])), tray.solid).volume() > 0.1,
              'positive end shoulders must resist both push and pull');
          const y = fork.sign * mount.centre;
          for (const bx of [mount.x-mount.halfWidth-2.8,mount.x+mount.halfWidth+2.8]) {
            const hits = road.rayCast([bx,y,-1],[bx,y,p.height+1]);
            assert.ok(hits.length >= 2 && hits[0].position[2] > 4.4 && hits.at(-1).position[2] >= p.height-0.001,
              'M2 pilot must accept the retaining screw and remain blind below the surface');
            const shell = work.own(wasm.Manifold.cylinder(1.5,1,1,32));
            for (const trim of [-1.5,0,1.5]) {
              const screw = work.own(shell.translate([bx,y,0.3]));
              clear(work,screw,work.own(tray.solid.translate([0,trim,0])),'the retaining screw keeps full slot travel');
            }
          }
          // Sweep a round gauge along each segment of the actual guide overlay.
          const points = tray.motorGuide.rodPath, radius = mount.settings.rodDiameter/2;
          const ball = work.own(wasm.Manifold.sphere(radius,32));
          for (let i=1;i<points.length;i++) {
            const ends = [points[i-1],points[i]].map(pt=>work.own(ball.translate(pt)));
            const wire = work.own(wasm.Manifold.hull(ends));
            clear(work,wire,road,'hook, low pushrod, riser and plunger must clear the road');
            clear(work,wire,tray.solid,'hook, pushrod and plunger must clear the cradle');
            assert.ok(wire.boundingBox().min[2] >= -1e-6, 'the rod must clear the table');
          }
        }
      } finally {
        work.close();
        parts.forEach(part => part.solid.delete());
      }
    }
  });
}

test('motor fit limits catch excess height, shoulder width and projected plunger length', () => {
  const p=pit({height:10,slotDepth:8});
  assert.ok(Math.abs(maxPitMotorHeight(p)-6.15)<1e-6);
  const layout=pitLayout(p);
  const plan=()=>pitMotorMountLayout(p,layout.forks[0],layout.lanePaths[2]);
  p.special.motorHeight=6.16;
  assert.throws(plan,/6.15 mm high/);
  p.special.motorHeight=5;
  p.special.plungerProjection=40;
  assert.throws(plan,/shoulder/);
  p.special.plungerProjection=2;
  p.special.motorWidth=60;
  assert.throws(plan,/shoulder|approach/);
});

test('the fitted motor warns when a border connection blocks the mount or its lead exit', () => {
  for (const [width, laneSpacing, station, component] of [
    [140, 65, 0.1718, 'motor cradle'],
    [200, 100, 0.1559, 'motor lead exit'],
  ]) {
    const p = pit({ width, laneSpacing, borderSide: 'outer', borderMount: 'clips', clipType: 'draw-key',
      borderEntry: 45, borderApex: 45, borderExit: 45, placements: { outerSideClips: [station, 0.65] } });
    assert.throws(() => buildTrack(wasm, p), error => {
      assert.equal(error.warning.location, 'Outside border attachment 1 · clip 1');
      assert.ok(error.warning.reason.includes('blocks the left pit ' + component));
      assert.equal(error.warning.setting.field, 'place_outerSideClips');
      return true;
    });
    p.placements.outerSideClips[0] = 0.25;
    const parts = buildTrack(wasm, p);
    parts.forEach(part => part.solid.delete());
  }
});
