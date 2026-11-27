import { sectionPlan, sectionElevation } from './building-section-drawing.js';
import { editStorey, editWalls, changeOpening, repeatOpening, alignOpenings, patchStorey, placeOpening, mirrorOpenings, spaceOpenings, centreOpenings, moveOpenings, copyOpenings, removeOpenings } from './building-edit.js';
import { footprintPoints, footprintWalls } from './geometry/footprint-building.js';
import { BAY, addBay, chamferCorner, curveWall, moveWall } from './building-outline.js';
import { validateBuilding, garageDoors } from './geometry/building.js';
import { SHELL_FRAME } from './geometry/shell-details.js';

const escText = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
// A frame drawn round its opening (open at the foot for a door), and the bars between its panes.
const framePath = (o, H) => {
  const k = SHELL_FRAME.trim, x = o.at - o.width / 2 - k, y = H - o.sill - o.height - k;
  return `<rect class="bd-drawing-frame" x="${x}" y="${y}" width="${o.width + 2 * k}" height="${o.height + (o.type === 'window' ? 2 * k : k)}"/>`;
};
const barsPath = (o, H) => {
  if (o.type !== 'window') return '';
  const x0 = o.at - o.width / 2, y0 = H - o.sill - o.height, lines = [];
  for (let j = 1; j < (o.across ?? 1); j++) lines.push(`M${x0 + (j * o.width) / o.across} ${y0}V${y0 + o.height}`);
  for (let j = 1; j < (o.up ?? 1); j++) lines.push(`M${x0} ${y0 + (j * o.height) / o.up}H${x0 + o.width}`);
  return lines.length ? `<path class="bd-drawing-bars" d="${lines.join('')}"/>` : '';
};

// The lightweight SVG preview never builds meshes while dragging. Release commits one edit.
export function createBuildingCanvas(host, { getState, commit, onWall, onSection, error }) {
  let mode = 'wall', selected = null, drag = null, preview = null, valid = true;
  // In the footprint of a shaped building: the wall (by index) or the corner chosen.
  let edge = null, corner = null;
  // The windows and doors chosen on the wall shown; `selected` is the last one clicked, whose sizes are shown.
  let chosen = new Set();
  const number = n => Math.round(n * 10) / 10;
  function state() { return { ...getState(), ...(preview ? { building: preview } : {}) }; }
  function render() {
    const { building: b, level, wall } = state();
    if (!['garage', 'footprint', 'sections'].includes(b.kind)) { host.innerHTML = '<p class="bd-hint">The drawing editor is available for rectangular and shaped buildings.</p>'; return; }
    const s = editStorey(b, level), walls = editWalls(b, level), current = walls.find(w => w.id === wall) ?? walls[0];
    const selectedOpening = s.openings[selected]?.wall === current.id ? s.openings[selected] : null;
    if (!selectedOpening) selected = null;
    chosen = new Set([...chosen].filter((i) => s.openings[i]?.wall === current.id));
    if (selected !== null) chosen.add(selected);
    else if (chosen.size) selected = [...chosen].at(-1);
    const op = selectedOpening;
    const connected = b.kind === 'sections', plan = connected ? sectionPlan(b,level) : null;
    const elevation = connected ? sectionElevation(b,level,current.id) : null;
    const W = mode === 'wall' ? current.length : connected ? plan.max[0]-plan.min[0] : s.width, H = mode === 'wall' ? elevation?.height ?? s.height : connected ? plan.max[1]-plan.min[1] : s.depth;
    const margin = 24;
    const outline = b.kind === 'footprint' ? footprintPoints(b) : [[0, 0], [s.width, 0], [s.width, s.depth], [0, s.depth]];
    const shaped = b.kind === 'footprint';
    if (shaped) {
      const n = outline.length;
      if (edge !== null && edge >= n) edge = null;
      if (corner !== null && corner >= n) corner = null;
    }
    const parts = mode === 'plan'
      ? connected ? plan.html : shaped ? outlineHtml(b, outline) : `<polygon class="bd-drawing-wall" points="${outline.map(p => p.join(',')).join(' ')}"/><circle class="bd-shape-handle" data-shape="size" cx="${W}" cy="${H}" r="5"/><text x="${W / 2}" y="-9" text-anchor="middle">${number(W)} mm</text><text x="${W + 8}" y="${H / 2}">${number(H)} mm</text>${b.kind === 'footprint' && b.shape !== 'rectangle' ? `<circle class="bd-shape-handle" data-shape="wing" cx="${b.wing}" cy="${b.wing}" r="5"/><text x="${b.wing + 8}" y="${b.wing - 8}">Wing ${number(b.wing)} mm</text>` : ''}`
      : `${elevation?.html ?? `<rect class="bd-drawing-wall" width="${W}" height="${H}"/>`}${b.kind === 'garage' && level === 0 && wall === 'front' ? garageDoors(b).map(d => `<rect class="bd-fixed-opening" x="${d.x}" y="${H - d.height}" width="${d.width}" height="${d.height}"/>`).join('') : ''}${s.openings.map((o, i) => o.wall !== current.id ? '' : `<g data-opening="${i}" class="bd-drawing-opening${chosen.has(i) ? ' selected' : ''}">${o.frame ? framePath(o, H) : ''}<rect x="${o.at - o.width / 2}" y="${H - o.sill - o.height}" width="${o.width}" height="${o.height}"/>${o.frame ? barsPath(o, H) : ''}<text x="${o.at}" y="${H - o.sill - o.height / 2}" text-anchor="middle">${i + 1}</text>${selected === i && chosen.size === 1 ? `<rect data-resize="${i}" class="bd-resize" x="${o.at + o.width / 2 - 3}" y="${H - o.sill - o.height - 3}" width="6" height="6"/>` : ''}</g>`).join('')}${(s.lettering ?? []).filter((l) => l.wall === current.id).map((l) => `<text class="bd-drawing-letters" x="${l.at}" y="${H - l.up}" style="font-size:${l.height}px" text-anchor="middle" dominant-baseline="central">${escText(l.text)}</text>`).join('')}<text x="${W / 2}" y="-9" text-anchor="middle">${current.name} · ${number(W)} × ${number(H)} mm</text>`;
    host.innerHTML = `<div class="bd-drawing-toolbar"><div class="bd-seg"><button type="button" data-canvas-mode="wall" aria-pressed="${mode === 'wall'}">Wall elevation</button><button type="button" data-canvas-mode="plan" aria-pressed="${mode === 'plan'}">Footprint</button></div><label>Wall <select data-canvas-wall>${walls.map(w => `<option value="${w.id}"${w.id === current.id ? ' selected' : ''}>${w.name} · ${number(w.length)} mm</option>`).join('')}</select></label><button type="button" data-canvas-add="window">Add window</button><button type="button" data-canvas-add="door">Add door</button></div>
      <p class="bd-hint">${mode === 'plan' && b.kind === 'footprint' ? 'Click a wall to choose it and drag it in or out; its neighbours follow. Click a corner to cut it at 45°. Hold Shift to snap to 5 mm. The round handles set the size and wing of an L, U or T; moving a wall makes it a drawn outline.' : mode === 'wall' ? 'Drag an opening to move it; drag its corner to resize. Arrow keys move the selected opening 1 mm; Shift moves 5 mm. Red outlines cannot be applied.' : connected ? 'Select a section in the plan. Drag its corner to resize; the orange handle slides it along its parent. Shared connections are shaded in elevation. Roof profiles are shown; openings stay below the eaves.' : 'Drag the round handles to change the overall size or wing width. Hold Shift to snap to 5 mm. Openings stay at their measured positions; invalid changes are not applied.'}</p>
      <svg class="bd-drawing${valid ? '' : ' invalid'}" tabindex="0" role="img" aria-label="${mode === 'wall' ? 'Wall elevation editor' : 'Building footprint editor'}" viewBox="${(mode === 'plan' && connected ? plan.min[0] : 0)-margin} ${(mode === 'plan' && connected ? plan.min[1] : 0)-margin} ${W + margin * 3} ${H + margin * 2}">${parts}</svg>
      <div class="bd-drawing-properties">${mode === 'plan' && b.kind === 'footprint' ? outlineTools(b, outline) : op ? `<strong>${op.type === 'door' ? 'Door' : 'Window'} ${selected + 1}</strong>${[['at','Centre',op.at],['width','Width',op.width],['height','Height',op.height],...(op.type === 'window' ? [['sill','Sill',op.sill]] : [])].map(([key,label,value]) => `<label>${label} <input type="number" step="1" data-opening-field="${key}" value="${value}"> mm</label>`).join('')}<label><input type="checkbox" data-opening-frame${op.frame ? ' checked' : ''}> Frame</label>${op.type === 'window' && op.frame ? [['across','Panes across',op.across ?? 1],['up','Panes up',op.up ?? 1]].map(([key,label,value]) => `<label>${label} <input type="number" step="1" min="1" max="6" data-opening-field="${key}" value="${value}"></label>`).join('') : ''}${groupTools(walls, current)}<label>Row count <input type="number" data-repeat-count min="2" max="16" value="3"></label><label>Gap <input type="number" data-repeat-gap min="6" value="10"> mm</label><button type="button" data-canvas-repeat>Repeat to the right</button>` : '<span>Select an opening to resize it, remove it or repeat it. Shift-click to choose several.</span>'}<button type="button" data-canvas-align="top">Align window tops</button><button type="button" data-canvas-align="bottom">Align window sills</button></div>`;
  }
  // What can be done to the windows and doors chosen, together.
  function groupTools(walls, current) {
    const n = chosen.size, others = walls.filter((w) => w.id !== current.id);
    return `<span class="bd-chosen">${n} chosen</span><button type="button" data-canvas-group="mirror">Mirror across the wall</button><button type="button" data-canvas-group="space">Space evenly</button><button type="button" data-canvas-group="centre">Centre on the wall</button>${others.length ? `<label>Copy to <select data-canvas-copy-to>${others.map((w) => `<option value="${w.id}">${w.name}</option>`).join('')}</select></label><button type="button" data-canvas-group="copy">Copy</button>` : ''}<button type="button" data-canvas-group="all">Choose all on this wall</button><button type="button" data-canvas-delete>Remove ${n > 1 ? 'the ' + n : 'selected'}</button>`;
  }
  // The outline: each wall a line to pick and drag, each corner a dot; the size and wing handles for an L, U or T.
  function outlineHtml(b, pts) {
    const n = pts.length, line = (i) => [pts[i], pts[(i + 1) % n]];
    const walls = pts.map((_, i) => { const [p, q] = line(i); return `<line class="bd-edge${edge === i ? ' selected' : ''}" data-shape="edge" data-edge="${i}" x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}"/><text class="bd-edge-name" x="${(p[0] + q[0]) / 2}" y="${(p[1] + q[1]) / 2}" text-anchor="middle">${i + 1}</text>`; }).join('');
    const corners = pts.map((p, k) => `<circle class="bd-corner${corner === k ? ' selected' : ''}" data-corner="${k}" cx="${p[0]}" cy="${p[1]}" r="3.5"/>`).join('');
    const handles = b.shape === 'custom' ? '' : `<circle class="bd-shape-handle" data-shape="size" cx="${b.width}" cy="${b.depth}" r="5"/>${b.shape !== 'rectangle' ? `<circle class="bd-shape-handle" data-shape="wing" cx="${b.wing}" cy="${b.wing}" r="5"/>` : ''}`;
    return `<polygon class="bd-drawing-wall" points="${pts.map((p) => p.join(',')).join(' ')}"/>${walls}${corners}${handles}<text x="${b.width / 2}" y="-9" text-anchor="middle">${number(b.width)} × ${number(b.depth)} mm</text>`;
  }
  function outlineTools(b, pts) {
    if (edge !== null) {
      const w = footprintWalls(b)[edge];
      return `<strong>Wall ${edge + 1} · ${number(w.length)} mm</strong><label>Out by <input type="number" step="1" data-outline-depth value="${BAY.depth}"> mm</label><button type="button" data-outline="bay">Pull out a bay</button><button type="button" data-outline="recess">Push in a recess</button><button type="button" data-outline="out">Move the wall out</button><button type="button" data-outline="in">Move the wall in</button><label>Bulge <input type="number" step="1" data-outline-bulge value="${BAY.bulge}"> mm</label><label>in <input type="number" step="1" min="2" max="16" data-outline-facets value="${BAY.facets}"> walls</label><button type="button" data-outline="curve">Curve the wall</button>`;
    }
    if (corner !== null) return `<strong>Corner ${corner + 1}</strong><label>Cut <input type="number" step="1" data-outline-cut value="${BAY.chamfer}"> mm</label><button type="button" data-outline="chamfer">Cut the corner</button>`;
    return `<span>Click a wall or a corner of the outline.</span><span>${pts.length} walls</span>`;
  }
  function apply(next) { preview = null; valid = true; const focusCanvas = host.contains(document.activeElement) && !document.activeElement.matches('input,select'); return commit(next).then(() => { if (focusCanvas) host.querySelector('svg')?.focus(); }).catch(e => error(e.message)); }
  function act(fn) { try { return apply(fn()); } catch (e) { error(e.message); } }
  host.addEventListener('click', e => {
    const section = e.target.closest('[data-select-section]');
    if (section && !e.target.hasAttribute('data-shape')) { selected = null; onSection?.(Number(section.dataset.selectSection)); return; }
    const dot = e.target.closest('[data-corner]');
    if (dot) { corner = Number(dot.dataset.corner); edge = null; render(); return; }
    const t = e.target.closest('button'); if (!t) return;
    const { building: b, level, wall } = getState();
    if (t.dataset.outline) {
      const w = edge !== null && 'edge-' + (edge + 1), by = Number(host.querySelector('[data-outline-depth]')?.value), cut = Number(host.querySelector('[data-outline-cut]')?.value);
      const kind = t.dataset.outline;
      let next;
      const bulge = Number(host.querySelector('[data-outline-bulge]')?.value), facets = Number(host.querySelector('[data-outline-facets]')?.value);
      try { next = kind === 'chamfer' ? chamferCorner(b, corner, cut) : kind === 'curve' ? curveWall(b, w, bulge, facets) : kind === 'bay' || kind === 'recess' ? addBay(b, w, kind === 'bay' ? by : -by) : moveWall(b, w, kind === 'out' ? by : -by); }
      catch (err) { error(err.message); return; }
      // A bay's face is its third wall, chosen next to drag it further; a cut corner, its new wall.
      if (kind === 'bay' || kind === 'recess') edge += 2;
      if (kind === 'chamfer') { edge = corner; corner = null; }
      apply(next);
      return;
    }
    if (t.dataset.canvasMode) { mode = t.dataset.canvasMode; render(); }
    else if (t.dataset.canvasAdd) act(() => placeOpening(b, level, wall, t.dataset.canvasAdd));
    else if (t.hasAttribute('data-canvas-repeat')) act(() => repeatOpening(b, level, selected, Number(host.querySelector('[data-repeat-count]').value), Number(host.querySelector('[data-repeat-gap]').value)));
    else if (t.hasAttribute('data-canvas-delete')) { const gone = [...chosen]; chosen = new Set(); selected = null; act(() => removeOpenings(b, level, gone)); }
    else if (t.dataset.canvasGroup === 'all') { const s = editStorey(b, level); chosen = new Set(s.openings.map((o, i) => (o.wall === wall ? i : -1)).filter((i) => i >= 0)); selected = [...chosen].at(-1) ?? null; render(); }
    else if (t.dataset.canvasGroup) {
      const list = [...chosen], g = t.dataset.canvasGroup;
      act(() => g === 'mirror' ? mirrorOpenings(b, level, list) : g === 'space' ? spaceOpenings(b, level, list) : g === 'centre' ? centreOpenings(b, level, list) : copyOpenings(b, level, list, host.querySelector('[data-canvas-copy-to]').value));
    }
    else if (t.dataset.canvasAlign) act(() => alignOpenings(b, level, wall, t.dataset.canvasAlign));
  });
  host.addEventListener('change', e => {
    const { building: b, level } = getState();
    if (e.target.hasAttribute('data-canvas-wall')) { selected = null; chosen = new Set(); onWall(e.target.value); render(); }
    // A frame off takes its panes with it: they need its bars.
    else if (e.target.hasAttribute('data-opening-frame')) act(() => changeOpening(b, level, selected, e.target.checked ? { frame: true } : { frame: false, ...(editStorey(b, level).openings[selected].type === 'window' && { across: 1, up: 1 }) }));
    else if (e.target.dataset.openingField) act(() => changeOpening(b, level, selected, { [e.target.dataset.openingField]: e.target.value === '' ? NaN : Number(e.target.value) }));
  });
  const point = (e, svg) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  host.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const opening = e.target.closest('[data-opening]'), shape = e.target.closest('[data-shape]'), svg = e.target.closest('svg');
    if (!svg || (!opening && !shape)) return;
    e.preventDefault();
    const p = point(e, svg), snapshot = structuredClone(getState());
    if (opening) {
      const i = Number(opening.dataset.opening);
      // Shift- or Ctrl-click adds one to those chosen, or takes it away; a click alone chooses it, or keeps the group to drag.
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        if (chosen.has(i) && chosen.size > 1) { chosen.delete(i); selected = [...chosen].at(-1); drag = null; render(); return; }
        chosen.add(i);
      } else if (!chosen.has(i)) chosen = new Set([i]);
      selected = i;
    }
    if (shape?.dataset.shape === 'edge') { edge = Number(shape.dataset.edge); corner = null; onWall?.('edge-' + (edge + 1)); }
    drag = { ...snapshot, start: p, index: selected, group: opening && chosen.size > 1 ? [...chosen] : null, adding: e.shiftKey || e.ctrlKey || e.metaKey, edge, resize: e.target.hasAttribute('data-resize'), shape: shape?.dataset.shape, matrix: svg.getScreenCTM().inverse(), moved: false };
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
    if (drag.shape === 'edge') {
      // Out along the wall's outward normal, as far as the pointer went that way.
      const w = footprintWalls(b)[drag.edge], by = snap(-(dx * w.inward[0] + dy * w.inward[1]));
      try { preview = by ? moveWall(b, w.id, by) : null; valid = true; error(''); }
      catch (err) { valid = false; error(err.message); preview = null; }
      render();
      return;
    } else if (drag.shape) {
      const connected = b.kind === 'sections';
      const patch = drag.shape === 'offset' ? {offset:snap(s.offset+(['front','back'].includes(s.side)?dx:dy))} : drag.shape === 'wing' ? { wing: snap(b.wing + dx) } : { width: snap(s.width + (connected && s.parent && s.side==='left'?-dx:dx)), depth: snap(s.depth + (connected && s.parent && s.side==='front'?-dy:dy)) };
      next = patchStorey(b, drag.level, patch);
    } else if (drag.group && !drag.resize) {
      // The chosen ones together, by whole millimetres (Shift: 5).
      try { preview = moveOpenings(b, drag.level, drag.group, snap(dx), snap(-dy)); valid = true; error(''); }
      catch (err) { valid = false; error(err.message); preview = null; }
      render();
      return;
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
    const next = preview, changed = drag.moved;
    // A click on one of a group, not dragged and not adding to it, chooses that one alone.
    if (!changed && drag.group && !drag.adding) chosen = new Set([drag.index]);
    drag = null; preview = null;
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
    // The keys move, or remove, all those chosen.
    const list = [...chosen];
    if (e.key === 'Delete') { chosen = new Set(); selected = null; act(() => removeOpenings(b, level, list)); return; }
    act(() => moveOpenings(b, level, list, e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0));
  });
  return { render, cancel };
}
