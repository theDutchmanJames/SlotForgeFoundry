import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { validateBuilding, buildGarage, printSize, fitsPlate } from '../src/geometry/building.js';
import { footprintWalls } from '../src/geometry/footprint-building.js';
import { planShapes, footprint, overlap, validateBuildings } from '../src/planner-buildings.js';
import { placeOpening, repeatOpening } from '../src/building-edit.js';
import { kitNotes } from '../src/building-kit.js';
const wasm = await Module(); wasm.setup();
const free = parts => parts.forEach(p => p.solid.delete());

for (const shape of ['rectangle','L','U','T']) test(`${shape}: closed solids, non-overlapping walls, and flat parts fit a small plate`, () => {
  let b = validateBuilding({kind:'footprint',shape});
  b = placeOpening(b,0,'edge-1','door');
  b = placeOpening(b,0,'edge-2','window');
  const plate = {width:125,depth:100,margin:3};
  const whole = buildGarage(wasm,b), split = buildGarage(wasm,b,plate);
  try {
    for (const p of split) {
      assert.equal(p.solid.status(),'NoError',p.id);
      const bodies = p.solid.decompose(); assert.equal(bodies.length,1,p.id); bodies.forEach(s=>s.delete());
      assert.ok(fitsPlate(printSize(p),plate),p.id + ': ' + printSize(p));
    }
    for(let i=0;i<whole.length;i++) for(let j=i+1;j<whole.length;j++) {
      const hit=whole[i].solid.intersect(whole[j].solid);
      assert.ok(hit.volume()<0.01,whole[i].id+' intersects '+whole[j].id+' by '+hit.volume());hit.delete();
    }
    const total=ps=>ps.reduce((v,p)=>v+p.solid.volume(),0);
    assert.ok(Math.abs(total(whole)-total(split))<0.1,'splitting preserves material volume');
  } finally {free(whole);free(split);}
});
test('shaped windows cut exactly through their own wall', () => {
  const base=validateBuilding({kind:'footprint'}), opened=placeOpening(base,0,'edge-3');
  const a=buildGarage(wasm,base), b=buildGarage(wasm,opened);
  try {
    const volume=ps=>ps.reduce((v,p)=>v+p.solid.volume(),0), o=opened.openings[0];
    assert.ok(Math.abs(volume(a)-volume(b)-o.width*o.height*base.wall)<0.01);
  }finally{free(a);free(b);}
});
test('invalid shaped geometry and incompatible openings are rejected before meshing',()=>{
  assert.throws(()=>validateBuilding({kind:'footprint',shape:'U',width:150,wing:80}),/recess/);
  assert.throws(()=>validateBuilding({kind:'footprint',wing:NaN}),/wing/);
  assert.throws(()=>validateBuilding({kind:'footprint',upper:[{}]}),/Unknown/);
  let b=placeOpening(validateBuilding({kind:'footprint'}),0,'edge-3');
  assert.throws(()=>repeatOpening(b,0,0,10,10),/corner/);
  b={...b,shape:'rectangle',openings:[{...b.openings[0],wall:'edge-6'}]};
  assert.throws(()=>validateBuilding(b),/wall/);
});
test('planner retains the concave outline and door endpoints; projects round-trip',()=>{
  const b=placeOpening(validateBuilding({kind:'footprint',shape:'L'}),0,'edge-1','door');
  const entry={id:'b-shape',name:'Shaped building',building:b,pose:{x:110,y:90,a:0}};
  validateBuildings(JSON.parse(JSON.stringify([entry])));
  assert.equal(footprint(entry).length,6);
  assert.equal(planShapes(entry).doors.length,1);
  assert.equal(planShapes(entry).storeys[0].length,6);
  assert.equal(footprintWalls(b).length,6);
  assert.match(kitNotes('Test',b,[],{}),/straight glue seams/);
});
