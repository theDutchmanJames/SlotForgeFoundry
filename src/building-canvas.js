import { sectionPlan, sectionElevation } from './building-section-drawing.js';
import { editStorey, editWalls, changeOpening, repeatOpening, alignOpenings, patchStorey, placeOpening } from './building-edit.js';
import { footprintPoints } from './geometry/footprint-building.js';
import { validateBuilding, garageDoors } from './geometry/building.js';

// The lightweight SVG preview never builds meshes while dragging. Release commits one edit.
export function createBuildingCanvas(host, { getState, commit, onWall, onSection, error }) {
  let mode = 'wall', selected = null, drag = null, preview = null, valid = true;
  const number = n => Math.round(n * 10) / 10;
  function state() { return { ...getState(), ...(preview ? { building: preview } : {}) }; }
  function render() {
    const { building: b, level, wall } = state();
    if (!['garage', 'footprint', 'sections'].includes(b.kind)) { host.innerHTML = '<p class="bd-hint">The drawing editor is available for rectangular and shaped buildings.</p>'; return; }
    const s = editStorey(b, level), walls = editWalls(b, level), current = walls.find(w => w.id === wall) ?? walls[0];
    const selectedOpening = s.openings[selected]?.wall === current.id ? s.openings[selected] : null;
    if (!selectedOpening) selected = null;
    const op = selectedOpening;
    const connected = b.kind === 'sections', plan = connected ? sectionPlan(b,level) : null;
    const elevation = connected ? sectionElevation(b,level,current.id) : null;
    const W = mode === 'wall' ? current.length : connected ? plan.max[0]-plan.min[0] : s.width, H = mode === 'wall' ? elevation?.height ?? s.height : connected ? plan.max[1]-plan.min[1] : s.depth;
    const margin = 24;
    const outline = b.kind === 'footprint' ? footprintPoints(b) : [[0, 0], [s.width, 0], [s.width, s.depth], [0, s.depth]];
    const parts = mode === 'plan'
      ? connected ? plan.html : `<polygon class="bd-drawing-wall" points="${outline.map(p => p.join(',')).join(' ')}"/><circle class="bd-shape-handle" data-shape="size" cx="${W}" cy="${H}" r="5"/><text x="${W / 2}" y="-9" text-anchor="middle">${number(W)} mm</text><text x="${W + 8}" y="${H / 2}">${number(H)} mm</text>${b.kind === 'footprint' && b.shape !== 'rectangle' ? `<circle class="bd-shape-handle" data-shape="wing" cx="${b.wing}" cy="${b.wing}" r="5"/><text x="${b.wing + 8}" y="${b.wing - 8}">Wing ${number(b.wing)} mm</text>` : ''}`
      : `${elevation?.html ?? `<rect class="bd-drawing-wall" width="${W}" height="${H}"/>`}${b.kind === 'garage' && level === 0 && wall === 'front' ? garageDoors(b).map(d => `<rect class="bd-fixed-opening" x="${d.x}" y="${H - d.height}" width="${d.width}" height="${d.height}"/>`).join('') : ''}${s.openings.map((o, i) => o.wall !== current.id ? '' : `<g data-opening="${i}" class="bd-drawing-opening${selected === i ? ' selected' : ''}"><rect x="${o.at - o.width / 2}" y="${H - o.sill - o.height}" width="${o.width}" height="${o.height}"/><text x="${o.at}" y="${H - o.sill - o.height / 2}" text-anchor="middle">${i + 1}</text>${selected === i ? `<rect data-resize="${i}" class="bd-resize" x="${o.at + o.width / 2 - 3}" y="${H - o.sill - o.height - 3}" width="6" height="6"/>` : ''}</g>`).join('')}<text x="${W / 2}" y="-9" text-anchor="middle">${current.name} · ${number(W)} × ${number(H)} mm</text>`;
    host.innerHTML = `<div class="bd-drawing-toolbar"><div class="bd-seg"><button type="button" data-canvas-mode="wall" aria-pressed="${mode === 'wall'}">Wall elevation</button><button type="button" data-canvas-mode="plan" aria-pressed="${mode === 'plan'}">Footprint</button></div><label>Wall <select data-canvas-wall>${walls.map(w => `<option value="${w.id}"${w.id === current.id ? ' selected' : ''}>${w.name} · ${number(w.length)} mm</option>`).join('')}</select></label><button type="button" data-canvas-add="window">Add window</button><button type="button" data-canvas-add="door">Add door</button></div>
      <p class="bd-hint">${mode === 'wall' ? 'Drag an opening to move it; drag its corner to resize. Arrow keys move the selected opening 1 mm; Shift moves 5 mm. Red outlines cannot be applied.' : connected ? 'Select a section in the plan. Drag its corner to resize; the orange handle slides it along its parent. Shared connections are shaded in elevation. Roof profiles are shown; openings stay below the eaves.' : 'Drag the round handles to change the overall size or wing width. Hold Shift to snap to 5 mm. Openings stay at their measured positions; invalid changes are not applied.'}</p>
      <svg class="bd-drawing${valid ? '' : ' invalid'}" tabindex="0" role="img" aria-label="${mode === 'wall' ? 'Wall elevation editor' : 'Building footprint editor'}" viewBox="${(mode === 'plan' && connected ? plan.min[0] : 0)-margin} ${(mode === 'plan' && connected ? plan.min[1] : 0)-margin} ${W + margin * 3} ${H + margin * 2}">${parts}</svg>
      <div class="bd-drawing-properties">${op ? `<strong>${op.type === 'door' ? 'Door' : 'Window'} ${selected + 1}</strong>${[['at','Centre',op.at],['width','Width',op.width],['height','Height',op.height],...(op.type === 'window' ? [['sill','Sill',op.sill]] : [])].map(([key,label,value]) => `<label>${label} <input type="number" step="1" data-opening-field="${key}" value="${value}"> mm</label>`).join('')}<button type="button" data-canvas-delete>Remove selected</button><label>Row count <input type="number" data-repeat-count min="2" max="16" value="3"></label><label>Gap <input type="number" data-repeat-gap min="6" value="10"> mm</label><button type="button" data-canvas-repeat>Repeat to the right</button>` : '<span>Select an opening to resize it, remove it or repeat it.</span>'}<button type="button" data-canvas-align="top">Align window tops</button><button type="button" data-canvas-align="bottom">Align window sills</button></div>`;
  }
  function apply(next) { preview = null; valid = true; const focusCanvas = host.contains(document.activeElement) && !document.activeElement.matches('input,select'); return commit(next).then(() => { if (focusCanvas) host.querySelector('svg')?.focus(); }).catch(e => error(e.message)); }
  function act(fn) { try { return apply(fn()); } catch (e) { error(e.message); } }
  host.addEventListener('click', e => {
    const section = e.target.closest('[data-select-section]');
    if (section && !e.target.hasAttribute('data-shape')) { selected = null; onSection?.(Number(section.dataset.selectSection)); return; }
    const t = e.target.closest('button'); if (!t) return;
    const { building: b, level, wall } = getState();
    if (t.dataset.canvasMode) { mode = t.dataset.canvasMode; render(); }
    else if (t.dataset.canvasAdd) act(() => placeOpening(b, level, wall, t.dataset.canvasAdd));
    else if (t.hasAttribute('data-canvas-repeat')) act(() => repeatOpening(b, level, selected, Number(host.querySelector('[data-repeat-count]').value), Number(host.querySelector('[data-repeat-gap]').value)));
    else if (t.hasAttribute('data-canvas-delete')) act(() => validateBuilding(patchStorey(b, level, { openings: editStorey(b, level).openings.filter((_, i) => i !== selected) })));
    else if (t.dataset.canvasAlign) act(() => alignOpenings(b, level, wall, t.dataset.canvasAlign));
  });
  host.addEventListener('change', e => {
    const { building: b, level } = getState();
    if (e.target.hasAttribute('data-canvas-wall')) { selected = null; onWall(e.target.value); render(); }
    else if (e.target.dataset.openingField) act(() => changeOpening(b, level, selected, { [e.target.dataset.openingField]: e.target.value === '' ? NaN : Number(e.target.value) }));
  });
  const point = (e, svg) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  host.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const opening = e.target.closest('[data-opening]'), shape = e.target.closest('[data-shape]'), svg = e.target.closest('svg');
    if (!svg || (!opening && !shape)) return;
    e.preventDefault();
    const p = point(e, svg), snapshot = structuredClone(getState());
    if (opening) selected = Number(opening.dataset.opening);
    drag = { ...snapshot, start: p, index: selected, resize: e.target.hasAttribute('data-resize'), shape: shape?.dataset.shape, matrix: svg.getScreenCTM().inverse(), moved: false };
    host.setPointerCapture(e.pointerId); render();
  });
  host.addEventListener('pointermove', e => {
    if (!drag) return;
    const svg = host.querySelector('svg'), p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform(drag.matrix), snap = n => Math.round(n / (e.shiftKey ? 5 : 1)) * (e.shiftKey ? 5 : 1);
    const dx = q.x - drag.start.x, dy = q.y - drag.start.y;
    drag.moved ||= Math.abs(dx) + Math.abs(dy) > 0.5;
    const b = drag.building, s = editStorey(b, drag.level);
    let next;
    if (drag.shape) {
      const connected = b.kind === 'sections';
      const patch = drag.shape === 'offset' ? {offset:snap(s.offset+(['front','back'].includes(s.side)?dx:dy))} : drag.shape === 'wing' ? { wing: snap(b.wing + dx) } : { width: snap(s.width + (connected && s.parent && s.side==='left'?-dx:dx)), depth: snap(s.depth + (connected && s.parent && s.side==='front'?-dy:dy)) };
      next = patchStorey(b, drag.level, patch);
    } else {
      const o = s.openings[drag.index];
      const patch = drag.resize ? { width: snap(o.width + dx), at: number(o.at + snap(dx) / 2), height: snap(o.height - dy) } : { at: snap(o.at + dx), ...(o.type === 'window' ? { sill: snap(o.sill - dy) } : {}) };
      next = patchStorey(b, drag.level, { openings: s.openings.map((o, i) => i === drag.index ? { ...o, ...patch } : o) });
    }
    try { preview = validateBuilding(next); valid = true; error(''); }
    catch (err) { valid = false; error(err.message); preview = null; }
    render();
  });
  host.addEventListener('pointerup', e => {
    if (!drag) return;
    const next = preview, changed = drag.moved; drag = null; preview = null;
    if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);
    if (changed && valid && next) apply(next); else { valid = true; render(); }
    host.querySelector('svg')?.focus();
  });
  function cancel() { drag = null; preview = null; valid = true; render(); }
  host.addEventListener('pointercancel', cancel);
  host.addEventListener('lostpointercapture', () => { if (drag) cancel(); });
  host.addEventListener('keydown', e => {
    if (e.target.matches('input,select')) return;
    if (e.key === 'Escape') { cancel(); return; }
    if (mode !== 'wall' || selected === null || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Delete'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const { building: b, level } = getState(), s = editStorey(b, level), o = s.openings[selected], step = e.shiftKey ? 5 : 1;
    if (!o) return;
    act(() => e.key === 'Delete' ? validateBuilding(patchStorey(b, level, { openings: s.openings.filter((_, i) => i !== selected) })) : changeOpening(b, level, selected, e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? { at: o.at + (e.key === 'ArrowLeft' ? -step : step) } : { sill: o.sill + (e.key === 'ArrowUp' ? step : -step) }));
  });
  return { render, cancel };
}
