import { esc } from './ui.js';
import { SIDES } from './geometry/connected-building.js';

// Settings for the selected section. Selection itself is view state, not a geometry edit.
export function sectionFields(b,index) {
  const s=b.sections[index];
  const select=(key,label,options,value)=>`<label class="bd-row"><span>${label}</span><select name="cs-${key}">${options.map(([id,name])=>`<option value="${esc(id)}"${id===value?' selected':''}>${esc(name)}</option>`).join('')}</select></label>`;
  const number=(key,label,value,min,max,step=1)=>`<label class="bd-row"><span>${label}</span><span class="bd-input"><input name="cs-${key}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"><small>${key==='pitch'?'°':'mm'}</small></span></label>`;
  return `<h3>Connected sections</h3><div class="bd-section-list">${b.sections.map((p,i)=>`<button type="button" data-bd-section="${i}" aria-pressed="${index===i}">${esc(p.name)}</button>`).join('')}</div>
    <label class="bd-row"><span>Section name</span><input name="cs-name" maxlength="60" value="${esc(s.name)}"></label>
    ${index?select('parent','Attach to',b.sections.slice(0,index).map(p=>[p.id,p.name]),s.parent)+select('side','Parent side',SIDES.map(id=>[id,id]),s.side)+number('offset','Offset along parent',s.offset,0,600):'<p class="bd-hint">Main section · all wings follow their parent when resized.</p>'}
    ${[['width','Width',60,600],['depth','Depth',60,600],['height','Eave height',30,300]].map(([k,l,a,z])=>number(k,l,s[k],a,z)).join('')}
    <h3>Section roof</h3>${select('roofType','Roof',[['flat','Flat'],['slope','Lean-to'],['gable','Gable'],['hip','Hip / pyramid']],s.roofType)}
    ${number('pitch','Pitch',s.pitch,5,60)}${select('ridge','Gable ridge',[['width','Along width'],['depth','Along depth']],s.ridge)}${select('rises','Lean-to rises to',SIDES.map(id=>[id,id]),s.rises)}${number('overhang','Eave overhang',s.overhang,0,12)}
    <div class="bd-section-actions">${SIDES.map(side=>`<button type="button" data-bd-section-add="${side}"${b.sections.length>=8?' disabled':''}>Attach ${side}</button>`).join('')}<button type="button" data-bd-section-remove${index===0?' disabled':''}>Remove section + children</button></div>
    <p class="bd-hint">Up to eight sections. Attachments stay on their parent edge; offset is measured from the parent's left/front corner. Shared wall areas open into the next section. Roofs meet with trimmed eaves and vertical steps. Use Draw to resize sections and arrange exterior openings. Removing a section removes its children; Undo restores them.</p>
    <h3>Whole kit</h3>${[['baseHeight','Base height',4,20,1],['wall','Wall thickness',2,5,0.1],['roof','Roof thickness',2,5,0.1],['play','Groove clearance',0.1,0.5,0.05]].map(([k,l,a,z,t])=>number(k,l,b[k],a,z,t)).join('')}
    <p class="bd-hint">Panels split to fit the plate, including pitched roof panels laid flat. Join numbered pieces with straight glue seams. No roof locating frame. Sections share one floor level and have plain walls; roof intersections use stepped joins rather than continuous valleys.</p>`;
}
export function readSectionFields(form,b,index) {
  const s={...b.sections[index]}, next={...b};
  for(const key of ['name','parent','side','roofType','ridge','rises']) if(form.elements['cs-'+key]) s[key]=form.elements['cs-'+key].value;
  for(const key of ['width','depth','height','offset','pitch','overhang']) if(form.elements['cs-'+key]) {const v=form.elements['cs-'+key].value;s[key]=v===''?NaN:Number(v);}
  for(const key of ['baseHeight','wall','roof','play']) {const v=form.elements['cs-'+key].value;next[key]=v===''?NaN:Number(v);}
  return {...next,sections:b.sections.map((p,i)=>i===index?s:p)};
}
