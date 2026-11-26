import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { BUILDING_PRESETS } from '../src/building-presets.js';
import { buildGarage, validateBuilding, printPose, printSize, fitsPlate } from '../src/geometry/building.js';
const wasm=await Module();wasm.setup();

// Detail combinations can pass schema validation yet collide: especially access stairs,
// relief next to framed openings, and serving awnings on adjacent walls.
for(const id of ['race-hq','vip','marshal','timing','classic','container','stall-kiosk']) test(`${id}: detailed preset assembles without collisions and prints as single solids`,()=>{
  const b=validateBuilding(BUILDING_PRESETS.find(p=>p.id===id).building), plate={width:200,depth:200,margin:0};
  const whole=buildGarage(wasm,b), split=buildGarage(wasm,b,plate);
  try {
    for(const p of split){
      assert.equal(p.solid.status(),'NoError',p.id);
      const bodies=p.solid.decompose();assert.equal(bodies.length,1,p.id);bodies.forEach(s=>s.delete());
      assert.ok(fitsPlate(printSize(p),plate),p.id+': '+printSize(p));
    }
    for(let i=0;i<whole.length;i++)for(const q of whole.slice(i+1)){
      const p=whole[i],a=p.solid.boundingBox(),b=q.solid.boundingBox();
      if(a.min.some((n,k)=>n>=b.max[k]-1e-6 || a.max[k]<=b.min[k]+1e-6))continue;
      const hit=p.solid.intersect(q.solid);
      try{assert.ok(hit.volume()<0.05,p.id+' intersects '+q.id+' by '+hit.volume());}finally{hit.delete();}
    }
  }finally{for(const p of [...whole,...split])p.solid.delete();}
});

// As every other kit here is held to: no two parts share more than a speck, and the walls,
// frames, trims, stairs and railings print over no air (the base, floors and roofs print
// over the tops of their pockets, as all of ours do).
const overAir = (part) => {
  const printed = printPose(part);
  const m = printed.getMesh();
  let over = 0;
  for (let i = 0; i < m.triVerts.length; i += 3) {
    const v = [0, 1, 2].map((k) => Array.from(m.vertProperties.subarray(m.triVerts[i + k] * m.numProp, m.triVerts[i + k] * m.numProp + 3)));
    const a = v[1].map((x, j) => x - v[0][j]),
      c = v[2].map((x, j) => x - v[0][j]);
    const n = [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
    const len = Math.hypot(...n);
    if (len && n[2] / len < -0.71 && Math.min(v[0][2], v[1][2], v[2][2]) > 0.05) over += len / 2;
  }
  printed.delete();
  return over;
};
// The seven, the container café, and the container shells on each end and frame only.
const office = BUILDING_PRESETS.find((p) => p.id === 'container').building;
const STRICT = [
  ...['race-hq', 'vip', 'marshal', 'timing', 'classic', 'container', 'stall-kiosk', 'stall-container'].map((id) => [id, BUILDING_PRESETS.find((p) => p.id === id).building]),
  ['office, cargo doors on the right', { ...office, container: 'right', openings: office.openings.filter((o) => o.wall !== 'right') }],
  ['office, frame only', { ...office, container: 'frame' }],
];
test('the detailed presets and container shells: no overlap beyond a speck, and nothing but the base, floors and roofs over air', () => {
  const plate = { width: 200, depth: 200, margin: 0 };
  for (const [id, building] of STRICT) {
    const parts = buildGarage(wasm, building, plate);
    try {
      for (const p of parts.filter((q) => !/^(base|roof|floor)/.test(q.id))) assert.ok(overAir(p) <= 0.5, id + ': ' + p.name + ' prints ' + overAir(p).toFixed(1) + ' mm² over air');
      for (let i = 0; i < parts.length; i++)
        for (let j = i + 1; j < parts.length; j++) {
          const both = parts[i].solid.intersect(parts[j].solid);
          assert.ok(both.volume() < 0.01, id + ': ' + parts[i].name + ' and ' + parts[j].name + ' overlap by ' + both.volume());
          both.delete();
        }
    } finally {
      parts.forEach((p) => p.solid.delete());
    }
  }
});
