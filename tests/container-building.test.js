import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { BUILDING_PRESETS } from '../src/building-presets.js';
import { buildGarage, validateBuilding, printSize, fitsPlate, buildingCuts } from '../src/geometry/building.js';
const wasm = await Module(); wasm.setup();
const preset = id => BUILDING_PRESETS.find(p => p.id === id).building;
const office = preset('container');
const checkParts = (b, plate) => {
  const parts = buildGarage(wasm, b, plate);
  try {
    for (const p of parts) {
      assert.equal(p.solid.status(), 'NoError', p.id);
      assert.ok(p.solid.volume() > 0, p.id);
      const bodies = p.solid.decompose();
      try { assert.equal(bodies.length, 1, p.id); } finally { bodies.forEach(s => s.delete()); }
      assert.ok(fitsPlate(printSize(p), plate), p.id + ': ' + printSize(p));
    }
    for (let i = 0; i < parts.length; i++) for (const q of parts.slice(i + 1)) {
      const p = parts[i], a = p.solid.boundingBox(), b = q.solid.boundingBox();
      if (a.min.some((n,k) => n >= b.max[k] - 1e-6 || a.max[k] <= b.min[k] + 1e-6)) continue;
      const hit = p.solid.intersect(q.solid);
      try { assert.ok(hit.volume() < 0.01, p.id + '/' + q.id + ': ' + hit.volume()); } finally { hit.delete(); }
    }
  } finally { parts.forEach(p => p.solid.delete()); }
};
for (const id of ['container', 'stall-container']) test(id + ': detailed kit fits and assembles', () => checkParts(preset(id), {width:200, depth:200}));
test('Office panels split on a small plate without separating the relief', () => checkParts(office, {width:120, depth:120}));
test('Long container with cargo doors on the other end splits cleanly', () => checkParts({...office, width:380, container:'right', openings:[]}, {width:200, depth:200, margin:3}));
test('At the plate boundary the planner allows for projecting corner posts', () => {
  const b = {...office, width:200, openings:[]}, plate = {width:200, depth:200};
  assert.ok(buildingCuts(b, plate).front.cuts.length);
  checkParts(b, plate);
});
test('Frame-only shell stays usable with openings at both ends', () => checkParts({...office, container:'frame', openings:[...office.openings, {wall:'left',type:'window',at:38,width:30,height:25,sill:30,frame:true}]}, {width:200,depth:200}));
test('Legacy buildings opt out; details add geometry to walls and roof', () => {
  assert.equal(validateBuilding({}).container, 'none');
  const old = buildGarage(wasm, {...office, container:'none'}), detailed = buildGarage(wasm, office);
  try {
    for (const id of ['front','back','left','right','roof'])
      assert.ok(detailed.find(p=>p.id===id).solid.volume() > old.find(p=>p.id===id).solid.volume(), id);
  } finally { [...old,...detailed].forEach(p=>p.solid.delete()); }
});
test('Reject cargo-end openings and conflicting shell options with useful errors', () => {
  assert.throws(()=>validateBuilding({...office, container:'right'}), /cargo-door end/);
  assert.throws(()=>validateBuilding({...office, container:'wrong'}), /container details/);
  assert.throws(()=>validateBuilding({...office, roof:'gable'}), /one enclosed storey/);
  assert.throws(()=>validateBuilding({...office, cornice:3}), /Container rails/);
  assert.throws(()=>validateBuilding({...office, overhangLeft:0}), /2 mm overhang/);
  assert.throws(()=>validateBuilding({...office, openings:[{wall:'front',type:'window',at:21,width:24,height:25,sill:30,frame:true}]}), /7 mm/);
  assert.throws(()=>validateBuilding({...office, openings:[{wall:'front',type:'window',at:95,width:60,height:30,sill:43,frame:true}]}), /top rail/);
});
