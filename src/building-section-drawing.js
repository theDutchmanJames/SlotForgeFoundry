import { sectionPositions, sectionRect, sectionWalls, sectionTop, sectionRoofPlanes, sectionContacts } from './geometry/connected-building.js';
import { esc } from './ui.js';

export function sectionPlan(b,index) {
  const placed=sectionPositions(b), s=placed[index], all=placed.flatMap(s=>sectionRect(s));
  const min=[Math.min(...all.map(p=>p[0])),Math.min(...all.map(p=>p[1]))], max=[Math.max(...all.map(p=>p[0])),Math.max(...all.map(p=>p[1]))];
  const left=s.parent && s.side==='left', front=s.parent && s.side==='front';
  return { min, max, html:placed.map((p,i)=>`<g data-select-section="${i}" class="bd-plan-section${i===index?' selected':''}"><polygon points="${sectionRect(p).map(p=>p.join(',')).join(' ')}"/><text x="${p.x+p.width/2}" y="${p.y+p.depth/2}" text-anchor="middle">${esc(p.name)}</text><text x="${p.x+p.width/2}" y="${p.y+p.depth/2+14}" text-anchor="middle">${p.height} mm · ${p.roofType}</text></g>`).join('')+`<circle class="bd-shape-handle" data-shape="size" cx="${s.x+(left?0:s.width)}" cy="${s.y+(front?0:s.depth)}" r="5"/>`+(s.parent?`<circle class="bd-shape-handle bd-offset-handle" data-shape="offset" cx="${s.x+s.width/2}" cy="${s.y+s.depth/2-20}" r="5"/>`:'') };
}
export function sectionElevation(b,index,wall) {
  const s=sectionPositions(b)[index], w=sectionWalls(s).find(w=>w.id===wall), planes=sectionRoofPlanes(s);
  const stops=[0,w.length];
  for(let i=0;i<planes.length;i++) for(const q of planes.slice(i+1)) {
    const p=planes[i].p, a=p[0]-q.p[0], c=p[1]-q.p[1], d=p[2]-q.p[2], slope=a*w.dir[0]+c*w.dir[1];
    if(Math.abs(slope)>1e-9) {const u=-(a*w.a[0]+c*w.a[1]+d)/slope;if(u>0 && u<w.length)stops.push(u);}
  }
  stops.sort((a,b)=>a-b);
  const top=stops.map(u=>[u,sectionTop(s,w.a[0]+w.dir[0]*u,w.a[1]+w.dir[1]*u)]), height=Math.max(...top.map(p=>p[1]));
  return {height,html:`<polygon class="bd-drawing-wall" points="0,${height} ${top.map(([u,z])=>u+','+(height-z)).join(' ')} ${w.length},${height}"/>`+sectionContacts(b,index).filter(c=>c.wall===wall).map(c=>`<rect class="bd-shared-wall" x="${c.lo}" y="${height-Math.min(s.height,c.other.height)}" width="${c.hi-c.lo}" height="${Math.min(s.height,c.other.height)}"/><text x="${(c.lo+c.hi)/2}" y="${height-8}" text-anchor="middle">Connection</text>`).join('')};
}
