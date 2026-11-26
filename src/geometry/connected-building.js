// Attached rectangular volumes, with persistent section IDs and independent roofs.
// All coordinates are derived from attachments; a join is an open connection, not two closed kits.
import polygonClipping from 'polygon-clipping';
import { kitShapes } from './kit-shapes.js';
import { SHELL_FINISH_DEFAULTS, SHELL_OPENING_KEYS, SHELL_TEXTURE_DEFAULTS, checkShellFinish, checkShellOpening, checkShellTexture, finishShellWall, shellFrame, trimOf } from './shell-details.js';

export const SECTION_DEFAULTS = Object.freeze({ id: 's1', name: 'Main hall', parent: null, side: 'back', offset: 0, width: 220, depth: 120, height: 80, roofType: 'gable', pitch: 25, ridge: 'width', rises: 'back', overhang: 4, ...SHELL_FINISH_DEFAULTS, openings: [] });
export const CONNECTED_DEFAULTS = Object.freeze({ kind: 'sections', baseHeight: 6, wall: 3, roof: 3, play: 0.2, ...SHELL_TEXTURE_DEFAULTS, sections: [SECTION_DEFAULTS, { ...SECTION_DEFAULTS, id: 's2', name: 'Wing', parent: 's1', width: 100, depth: 100, height: 60, roofType: 'slope', rises: 'front' }] });
export const SIDES = ['front', 'right', 'back', 'left'];
export function sectionPositions(b) {
  const placed = [];
  for (const s of b.sections) {
    const p = placed.find(p => p.id === s.parent);
    const [x, y] = !p ? [0, 0] : s.side === 'front' ? [p.x + s.offset, p.y - s.depth] : s.side === 'back' ? [p.x + s.offset, p.y + p.depth] : s.side === 'left' ? [p.x - s.width, p.y + s.offset] : [p.x + p.width, p.y + s.offset];
    placed.push({ ...s, x, y });
  }
  return placed;
}
export const sectionRect = (s, pad = 0) => [[s.x - pad, s.y - pad], [s.x + s.width + pad, s.y - pad], [s.x + s.width + pad, s.y + s.depth + pad], [s.x - pad, s.y + s.depth + pad]];
export function connectedOutline(b, pad = 0) {
  const union = polygonClipping.union(...sectionPositions(b).map(s => [sectionRect(s, pad)]));
  if (union.length !== 1 || union[0].length !== 1) throw Error('Sections must form one connected building without an enclosed courtyard.');
  return union[0][0].slice(0, -1);
}
export function sectionWalls(s) {
  const pts = sectionRect(s);
  return pts.map((a, i) => {
    const end = pts[(i + 1) % 4], length = Math.hypot(end[0] - a[0], end[1] - a[1]);
    const dir = [(end[0] - a[0]) / length, (end[1] - a[1]) / length];
    return { id: SIDES[i], name: SIDES[i][0].toUpperCase() + SIDES[i].slice(1), a, end, length, dir, inward: [-dir[1], dir[0]] };
  });
}
// Contacts are expressed in each wall's own left-to-right coordinate, including partial joins.
export function sectionContacts(b, index) {
  const placed = sectionPositions(b), s = placed[index], contacts = [];
  for (const other of placed) {
    if (s.id === other.id) continue;
    for (const w of sectionWalls(s)) {
      const axis = w.dir[0] ? 0 : 1, normal = 1 - axis;
      const border = w.a[normal];
      const opposite = normal === 0 ? (w.inward[0] > 0 ? other.x + other.width : other.x) : (w.inward[1] > 0 ? other.y + other.depth : other.y);
      if (Math.abs(border - opposite) > 1e-7) continue;
      const start = axis === 0 ? other.x : other.y, end = start + (axis === 0 ? other.width : other.depth);
      const u = [(start - w.a[axis]) * w.dir[axis], (end - w.a[axis]) * w.dir[axis]].sort((a,b) => a-b);
      const lo = Math.max(0, u[0]), hi = Math.min(w.length, u[1]);
      if (hi - lo > 1e-7) contacts.push({ wall: w.id, lo, hi, other });
    }
  }
  return contacts;
}
// Each plane is z = ax + by + c relative to the base top. A roof is their lower envelope.
export function sectionRoofPlanes(s) {
  const t = Math.tan(s.pitch * Math.PI / 180), H = s.height;
  const planes = { front: [0, t, H - t*s.y], back: [0, -t, H + t*(s.y+s.depth)], left: [t, 0, H - t*s.x], right: [-t, 0, H + t*(s.x+s.width)] };
  const keys = s.roofType === 'flat' ? [] : s.roofType === 'slope' ? [{back:'front',front:'back',right:'left',left:'right'}[s.rises]] : s.roofType === 'gable' ? (s.ridge === 'width' ? ['front','back'] : ['left','right']) : ['front','back','left','right'];
  return keys.length ? keys.map(id => ({ id, p: planes[id] })) : [{ id: 'flat', p: [0,0,H] }];
}
export const sectionTop = (s, x, y) => Math.min(...sectionRoofPlanes(s).map(({p:[a,b,c]}) => a*x+b*y+c));
const keysOnly = (o, defaults, what) => { if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).some(k => !Object.hasOwn(defaults,k))) throw Error('Unknown or invalid ' + what + ' setting.'); };
const range = (v, a, z, label) => { if (!Number.isFinite(v) || v < a || v > z) throw Error(label + ' must be between ' + a + ' and ' + z + ' mm.'); };
export function validateConnected(input) {
  keysOnly(input, CONNECTED_DEFAULTS, 'connected building');
  const b = { ...CONNECTED_DEFAULTS, ...input };
  if (b.kind !== 'sections') throw Error('Invalid connected building kind.');
  for (const [key,lo,hi] of [['baseHeight',4,20],['wall',2,5],['roof',2,5],['play',0.1,0.5]]) range(b[key],lo,hi,key);
  checkShellTexture(b);
  if (!Array.isArray(b.sections) || !b.sections.length || b.sections.length > 8) throw Error('Use between one and eight connected sections.');
  const ids = new Set();
  b.sections = b.sections.map((input,i) => {
    keysOnly(input, SECTION_DEFAULTS, 'section');
    const s = { ...SECTION_DEFAULTS, ...input };
    if (!/^s[1-9]\d{0,5}$/.test(s.id) || ids.has(s.id)) throw Error('Sections need unique persistent IDs.');
    if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 60) throw Error('Give each section a name of 1–60 characters.');
    if (i === 0 ? s.parent !== null : !ids.has(s.parent)) throw Error('Attach each section to an earlier section. The first section is the root.');
    ids.add(s.id);
    for (const [key,lo,hi] of [['width',60,600],['depth',60,600],['height',30,300],['offset',0,600],['overhang',0,12]]) range(s[key],lo,hi,s.name+' '+key);
    if (!Number.isFinite(s.pitch) || s.pitch < 5 || s.pitch > 60) throw Error('Roof pitch must be 5–60 degrees.');
    if (!SIDES.includes(s.side) || !SIDES.includes(s.rises) || !['width','depth'].includes(s.ridge) || !['flat','slope','gable','hip'].includes(s.roofType)) throw Error('Choose valid attachment and roof options.');
    if (!Array.isArray(s.openings) || s.openings.length > 64) throw Error('Use at most 64 openings per section.');
    return { ...s, ...checkShellFinish(s, SIDES, s.height, ' of ' + s.name) };
  });
  const placed = sectionPositions(b);
  for (let i=0;i<placed.length;i++) {
    const s = placed[i], parent = placed.find(p => p.id === s.parent);
    if (parent) {
      const horizontal = ['front','back'].includes(s.side);
      if (s.offset + (horizontal ? s.width : s.depth) > (horizontal ? parent.width : parent.depth) + 1e-7) throw Error(s.name + ' must fit along its parent edge. Reduce its size or attachment offset.');
    }
    for (const o of placed.slice(i+1)) {
      const dx = Math.min(s.x+s.width,o.x+o.width)-Math.max(s.x,o.x), dy = Math.min(s.y+s.depth,o.y+o.depth)-Math.max(s.y,o.y);
      if (dx > 1e-7 && dy > 1e-7) throw Error(s.name + ' overlaps ' + o.name + '. Move the attachment or resize a section.');
      if ((Math.abs(dx)<1e-7 && dy>1e-7 && dy<20) || (Math.abs(dy)<1e-7 && dx>1e-7 && dx<20)) throw Error('An incidental connection needs at least 20 mm of shared wall.');
    }
    const walls = sectionWalls(s), contacts = sectionContacts(b,i);
    b.sections[i].openings = s.openings.map(o => {
      keysOnly(o,Object.fromEntries(SHELL_OPENING_KEYS.map(k=>[k,0])),'opening');
      const w = walls.find(w => w.id===o.wall);
      if (!w || !['door','window'].includes(o.type) || ![o.at,o.width,o.height,o.type==='door'?0:o.sill].every(Number.isFinite) || o.width<8 || o.height<8 || o.sill<0) throw Error('Choose a wall and positive opening dimensions.');
      const p = checkShellOpening({...o,sill:o.type==='door'?0:o.sill}, s.name+' '+w.id+' wall');
      // A frame reaches past the sides and top of its opening: it keeps the same room.
      const t = trimOf(p), lo = p.at-p.width/2-t, hi=p.at+p.width/2+t;
      if (lo<9 || hi>w.length-9) throw Error(s.name+': keep openings'+(t?' and their frames':'')+' 9 mm from corners.');
      if (p.sill+p.height+t>s.height-6) throw Error(s.name+': keep openings'+(t?' and their frames':'')+' 6 mm below the eaves.');
      if (contacts.some(c=>c.wall===p.wall && hi>c.lo-6 && lo<c.hi+6)) throw Error(s.name+': this wall connects to another section. Keep openings at least 6 mm clear of the connection.');
      return p;
    });
    b.sections[i].openings.forEach((o,j,all)=>all.slice(j+1).forEach(p=>{
      const t = trimOf(o)+trimOf(p);
      if(o.wall===p.wall && Math.abs(p.at-o.at)-(p.width+o.width)/2<6+t && Math.max(p.sill-o.sill-o.height,o.sill-p.sill-p.height)<6+t) throw Error('Keep openings'+(t?' and their frames':'')+' at least 6 mm apart.');
    }));
  }
  const outline=connectedOutline(b), xs=outline.map(p=>p[0]), ys=outline.map(p=>p[1]);
  if(Math.max(...xs)-Math.min(...xs)>1800 || Math.max(...ys)-Math.min(...ys)>1800) throw Error('Keep the whole building within 1800 × 1800 mm.');
  return b;
}
export function connectedLayout(input) {
  const b=validateConnected(input);
  return {building:b,storeys:[],doors:[],parts:[{id:'base',name:'Connected base',role:'buildingBase'},...b.sections.flatMap(s=>[...SIDES.map(w=>({id:s.id+'-'+w,name:s.name+' '+w+' wall',role:'wall'})),...s.openings.flatMap((o,i)=>o.frame?[{id:s.id+'-frame-'+(i+1),name:s.name+' '+(o.type==='door'?'door':'window')+' '+(i+1)+' frame',role:'frame'}]:[]),...sectionRoofPlanes({...s,x:0,y:0}).map(p=>({id:s.id+'-roof-'+p.id,name:s.name+' roof '+p.id,role:'roof'}))])]};
}
export function addSection(input, parentIndex, side='back') {
  const b=validateConnected(input), p=b.sections[parentIndex];
  if(!p) throw Error('Select a section to attach to.');
  const id='s'+(Math.max(...b.sections.map(s=>Number(s.id.slice(1))))+1);
  const s={...SECTION_DEFAULTS,id,name:'Section '+id.slice(1),parent:p.id,side,width:Math.min(100,p.width),depth:Math.min(100,p.depth),height:p.height,roofType:'flat',openings:[]};
  return validateConnected({...b,sections:[...b.sections,s]});
}
export function removeSection(input,index) {
  if(index===0) throw Error('Keep the main section.');
  const removed=new Set([input.sections[index]?.id]);
  for(const s of input.sections) if(removed.has(s.parent)) removed.add(s.id);
  return validateConnected({...input,sections:input.sections.filter(s=>!removed.has(s.id))});
}

export function buildConnected(wasm,input,plate=null) {
  const b=validateConnected(input), sections=sectionPositions(b), temp=[], result=[];
  const own=s=>(temp.push(s),s), {poly,box,sweep}=kitShapes(wasm,own), Manifold=wasm.Manifold;
  const trim=(s,n,off)=>own(s.trimByPlane(n,off/Math.hypot(...n)));
  const room=plate?[plate.width-2*(plate.margin??0),plate.depth-2*(plate.margin??0)]:[Infinity,Infinity];
  if(room.some(n=>n<40 || Number.isNaN(n))) throw Error('Use a print plate with at least 40 mm usable width and depth.');
  const cap=(solid,s,extra=0)=>{
    for(const {p:[a,c,d]} of sectionRoofPlanes(s)) solid=trim(solid,[a,c,-1],-(b.baseHeight+d+extra));
    return solid;
  };
  const tiles=(solid,part)=>{
    // Cut in print coordinates, so a steep roof really fits, not merely its XY projection.
    const lie=part.lie, flat=own(solid.rotate(lie)), bb=flat.boundingBox(), dx=bb.max[0]-bb.min[0],dy=bb.max[1]-bb.min[1];
    const nx=plate?Math.max(1,Math.ceil(dx/room[0])):1, ny=plate?Math.max(1,Math.ceil(dy/room[1])):1, pieces=[];
    for(let x=0;x<nx;x++) for(let y=0;y<ny;y++) {
      const chunk=own(flat.intersect(box(bb.min[0]+x*dx/nx,bb.min[1]+y*dy/ny,bb.min[2]-1,bb.min[0]+(x+1)*dx/nx,bb.min[1]+(y+1)*dy/ny,bb.max[2]+1)));
      for(const piece of chunk.decompose()) {
        own(piece);
        if(piece.volume()>0.001) pieces.push(piece.rotate(lie.map(n=>-n)));
      }
    }
    pieces.forEach((solid,i)=>result.push({...part,solid,id:part.id+(pieces.length>1?'-'+(i+1):''),name:part.name+(pieces.length>1?' '+(i+1)+' of '+pieces.length:'')}));
  };
  try {
    const roofs=[];
    for(const s of sections) {
      const planes=sectionRoofPlanes(s), oh=s.overhang;
      for(const face of planes) {
        const [a,c,d]=face.p, thick=b.roof*Math.hypot(a,c,1);
        let panel=box(s.x-oh,s.y-oh,0,s.x+s.width+oh,s.y+s.depth+oh,2000);
        panel=trim(panel,[-a,-c,1],b.baseHeight+d);
        panel=trim(panel,[a,c,-1],-(b.baseHeight+d+thick));
        // Equal-pitch panels meet at mitred ridges/hips with no overlap.
        for(const other of planes) if(other!==face) {
          const [u,v,w]=other.p;
          panel=trim(panel,[u-a,v-c,0],d-w);
        }
        // Eaves stop at adjoining footprints; the higher wall closes the step in the roof.
        for(const o of sections) if(o.id!==s.id) panel=own(panel.subtract(box(o.x,o.y,-1,o.x+o.width,o.y+o.depth,2001)));
        for(const r of roofs) panel=own(panel.subtract(r.solid));
        const deg=Math.atan(Math.hypot(a,c))*180/Math.PI;
        roofs.push({solid:panel,id:s.id+'-roof-'+face.id,name:s.name+' roof '+face.id,role:'roof',lie:c?[-Math.sign(c)*deg,0,0]:[0,Math.sign(a)*deg,0],apart:[0,0,35]});
      }
    }
    const wallParts=[], frames=[];
    for(let i=0;i<sections.length;i++) {
      const s=sections[i], pts=sectionRect(s), inner=sectionRect(s,-b.wall), contacts=sectionContacts(b,i);
      for(const [k,w] of sectionWalls(s).entries()) {
        const j=(k+1)%4;
        let solid=cap(own(own(poly([pts[k],pts[j],inner[j],inner[k]]).extrude(1900)).translate([0,0,b.baseHeight-2])),s);
        for(const contact of contacts.filter(c=>c.wall===w.id)) {
          const cut=sweep([[contact.lo,-10],[contact.hi,-10],[contact.hi,1900],[contact.lo,1900]],[...w.dir,0],[0,0,1],[...w.a,0],[...w.inward,0],-0.01,b.wall+0.01);
          // The higher wall starts at the lower roof's underside. Its vertical face meets
          // the roof's full edge thickness, rather than touching only along a fragile line.
          solid=own(solid.subtract(cap(cut,contact.other)));
        }
        for(const o of s.openings.filter(o=>o.wall===w.id)) {
          const z0=b.baseHeight+(o.type==='door'?-2.01:o.sill), z1=b.baseHeight+o.sill+o.height;
          solid=own(solid.subtract(sweep([[o.at-o.width/2,z0],[o.at+o.width/2,z0],[o.at+o.width/2,z1],[o.at-o.width/2,z1]],[...w.dir,0],[0,0,1],[...w.a,0],[...w.inward,0],-1,b.wall+1)));
        }
        // The texture, clear of the openings, their frames and the joins to other sections; up to the ridge.
        const rise=s.roofType==='flat'?0:Math.tan(s.pitch*Math.PI/180)*Math.max(s.width,s.depth);
        solid=finishShellWall(wasm,own,solid,w,{floor:b.baseHeight,top:b.baseHeight+s.height+rise,openings:s.openings.filter(o=>o.wall===w.id),avoid:contacts.filter(c=>c.wall===w.id).map(c=>[c.lo,c.hi])},b,s);
        for(const r of roofs) solid=own(solid.subtract(r.solid));
        const lie=w.inward[1]>0?[-90,0,0]:w.inward[1]<0?[90,0,0]:w.inward[0]>0?[0,90,0]:[0,-90,0];
        wallParts.push({solid,id:s.id+'-'+w.id,name:s.name+' '+w.name.toLowerCase()+' wall',role:'wall',lie,apart:[-w.inward[0]*20,-w.inward[1]*20,8]});
        // A frame prints face up, like its wall, glued on round its opening.
        s.openings.forEach((o,n)=>{
          if(o.wall!==w.id || !o.frame) return;
          frames.push({solid:shellFrame(o,w,b.baseHeight,{sweep,own,Manifold}),id:s.id+'-frame-'+(n+1),name:s.name+' '+(o.type==='door'?'door':'window')+' '+(n+1)+' frame',role:'frame',lie,apart:[-w.inward[0]*28,-w.inward[1]*28,8]});
        });
      }
    }
    // One base for the whole building. Grooves follow only surviving wall feet; joins have no trench.
    const outer=own(wasm.CrossSection.union(sections.map(s=>poly(sectionRect(s,3)))));
    let base=own(outer.extrude(b.baseHeight));
    for(const w of wallParts) {
      const foot=own(w.solid.slice(b.baseHeight-1));
      if (foot.isEmpty()) continue;
      const clearance=own(foot.offset(b.play,'Miter'));
      const groove=own(own(clearance.extrude(2.01)).translate([0,0,b.baseHeight-2]));
      base=own(base.subtract(groove));
    }
    tiles(base,{id:'base',name:'Connected base',role:'buildingBase',lie:[0,0,0],apart:[0,0,-12]});
    for(const p of [...wallParts,...frames,...roofs]) if(p.solid.volume()>0.001) tiles(p.solid,p);
    return result;
  } catch(e) { result.forEach(p=>p.solid.delete()); throw e; }
  finally { temp.forEach(s=>s.delete()); }
}
