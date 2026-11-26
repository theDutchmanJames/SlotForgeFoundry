import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { validateBuilding, buildGarage, printSize, fitsPlate } from '../src/geometry/building.js';
import { SECTION_DEFAULTS, sectionPositions, sectionContacts, connectedOutline, addSection, removeSection } from '../src/geometry/connected-building.js';
import { placeOpening, patchStorey } from '../src/building-edit.js';
import { planShapes, validateBuildings, footprint } from '../src/planner-buildings.js';
import { kitNotes } from '../src/building-kit.js';
const wasm=await Module();wasm.setup();
const free=ps=>ps.forEach(p=>p.solid.delete());
const single=patch=>validateBuilding({kind:'sections',sections:[{...SECTION_DEFAULTS,...patch}]});
const check=ps=>{
  assert.ok(ps.some(p=>p.id.startsWith('base')),'base is present');
  for(const p of ps) {
    assert.equal(p.solid.status(),'NoError',p.id);assert.ok(p.solid.volume()>0,p.id);
    const pieces=p.solid.decompose();assert.equal(pieces.length,1,p.id);pieces.forEach(p=>p.delete());
  }
  for(let i=0;i<ps.length;i++) for(const p of ps.slice(i+1)) {const hit=ps[i].solid.intersect(p.solid);try{assert.ok(hit.volume()<0.02,ps[i].id+' intersects '+p.id+' by '+hit.volume());}finally{hit.delete();}}
};
for(const roofType of ['flat','slope','gable','hip']) for(const orientation of [0,1]) test(`${roofType} orientation ${orientation}: roof panels are flat, solid, non-overlapping and fit a small plate`,()=>{
  const b=single({roofType,pitch:50,width:180,depth:120,ridge:orientation?'depth':'width',rises:orientation?'left':'front'}), plate={width:100,depth:85,margin:3};
  const whole=buildGarage(wasm,b),split=buildGarage(wasm,b,plate);
  try {
    check(whole);
    for(const p of split){assert.equal(p.solid.status(),'NoError',p.id);assert.ok(fitsPlate(printSize(p),plate),p.id+': '+printSize(p));}
    for(const p of whole.filter(p=>p.role==='roof')) assert.ok(Math.abs(printSize(p)[2]-b.roof)<0.11,p.id+' roof lies flat');
    const volume=ps=>ps.reduce((v,p)=>v+p.solid.volume(),0);
    assert.ok(Math.abs(volume(whole)-volume(split))<0.05,'tiling preserves material');
  } finally {free(whole);free(split);}
});
for(const side of ['front','right','back','left']) test(`partial ${side} join: common floor stays open, wall feet are grooved, mixed roofs do not collide`,()=>{
  const root={...SECTION_DEFAULTS,width:180,depth:180,height:115,roofType:'hip'};
  const b=validateBuilding({kind:'sections',sections:[root,{...SECTION_DEFAULTS,id:'s2',name:'Wing',parent:'s1',side,offset:25,width:100,depth:100,height:60,roofType:'gable'}]});
  const ps=buildGarage(wasm,b),placed=sectionPositions(b),w=sectionContacts(b,0)[0];
  try {
    check(ps);assert.equal(w.hi-w.lo,100);
    const s=placed[1];let x,y;
    if(side==='front'||side==='back'){x=s.x+50;y=side==='front'?0:180;}else{x=side==='left'?0:180;y=s.y+50;}
    const probe0=wasm.Manifold.cube([8,8,25]), probe=probe0.translate([x-4,y-4,b.baseHeight+5]);probe0.delete();
    try{for(const p of ps){const hit=p.solid.intersect(probe);assert.ok(hit.volume()<0.001,'connection is open: '+p.id);hit.delete();}}finally{probe.delete();}
  }finally{free(ps);}
});
test('equal-height flat attachments remove both internal walls and retain a continuous base',()=>{
  const a={...SECTION_DEFAULTS,width:120,depth:120,roofType:'flat'},b=validateBuilding({kind:'sections',sections:[a,{...a,id:'s2',name:'Wing',parent:'s1'}]});
  const ps=buildGarage(wasm,b);try{check(ps);assert.ok(!ps.some(p=>p.id==='s1-back'||p.id==='s2-front'));assert.equal(ps.filter(p=>p.role==='buildingBase').length,1);}finally{free(ps);}
});
test('connected windows cut their section only; shared walls reject openings',()=>{
  const b=validateBuilding({kind:'sections'}),opened=placeOpening(b,1,'back','window');
  assert.throws(()=>validateBuilding(patchStorey(b,1,{openings:[{type:'door',wall:'front',at:50,width:28,height:48,sill:0}]})),/connection/);
  const ps=buildGarage(wasm,b),qs=buildGarage(wasm,opened);
  try{const volume=xs=>xs.reduce((v,p)=>v+p.solid.volume(),0);assert.ok(Math.abs(volume(ps)-volume(qs)-40*30*b.wall)<0.01);}finally{free(ps);free(qs);}
});
test('a stepped roof meets a solid wall face through its full edge thickness',()=>{
  const a={...SECTION_DEFAULTS,width:120,depth:120,height:120,roofType:'flat'};
  const b=validateBuilding({kind:'sections',sections:[a,{...a,id:'s2',name:'Low wing',parent:'s1',height:60}]});
  const ps=buildGarage(wasm,b), cube=wasm.Manifold.cube([10,1,2]), probe=cube.translate([50,119,66.5]);cube.delete();
  try{const wall=ps.find(p=>p.id==='s1-back'),hit=wall.solid.intersect(probe);try{assert.ok(Math.abs(hit.volume()-20)<0.001,'full roof edge has a wall behind it');}finally{hit.delete();}check(ps);}finally{probe.delete();free(ps);}
});
test('attachments follow parent resizing; IDs survive edits; deleting a branch removes descendants',()=>{
  let b=validateBuilding({kind:'sections'});b=addSection(b,1,'back');
  const before=sectionPositions(b), next=validateBuilding(patchStorey(b,0,{depth:150})), after=sectionPositions(next);
  assert.equal(after[2].y-before[2].y,30);assert.deepEqual(next.sections.map(s=>s.id),b.sections.map(s=>s.id));
  assert.equal(removeSection(b,1).sections.length,1);assert.throws(()=>removeSection(b,0),/main/);
});
test('invalid topology and unknown settings are rejected without modifying input',()=>{
  const b=validateBuilding({kind:'sections'}),frozen=JSON.stringify(b);
  assert.throws(()=>validateBuilding({...b,sections:[...b.sections,{...b.sections[1],id:'s3'}]}),/overlaps/);
  assert.throws(()=>validateBuilding(patchStorey(b,1,{offset:200})),/parent edge/);
  assert.throws(()=>validateBuilding(patchStorey(b,0,{parent:'s2'})),/earlier/);
  assert.throws(()=>validateBuilding(patchStorey(b,1,{id:'s1'})),/unique/);
  assert.throws(()=>validateBuilding(patchStorey(b,1,{pitch:NaN})),/pitch/);
  assert.throws(()=>validateBuilding({...b,unexpected:1}),/Unknown/);
  assert.throws(()=>validateBuilding(patchStorey(b,1,{unexpected:1})),/Unknown/);
  assert.equal(JSON.stringify(b),frozen);
});
test('planner and kit notes retain sections, concave boundaries, doors and individual roof settings',()=>{
  const b=placeOpening(validateBuilding({kind:'sections'}),0,'front','door'), e={id:'b-connected',name:'Halls',building:b,pose:{x:10,y:20,a:0.5}};
  validateBuildings(JSON.parse(JSON.stringify([e])));assert.equal(connectedOutline(b).length,6);assert.equal(footprint(e).length,6);
  assert.equal(planShapes(e).storeys.length,2);assert.equal(planShapes(e).doors.length,1);
  assert.match(kitNotes('Halls',b,[],{}),/pitch 25 degrees/);assert.match(kitNotes('Halls',b,[],{}),/stepped joins/);
});
