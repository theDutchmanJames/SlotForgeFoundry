// The Buildings page: a building as a kit of parts, made from a few sizes.
// The parts are listed on the left, the model is in the middle (or every
// part on its plate), and the settings are cards on the right. Every change
// rebuilds the model; Save keeps the building in the Library and Export kit
// downloads its STL files with notes on printing and putting it together.
import './buildings.css';
import { zipSync, strToU8 } from 'fflate';
import { esc, fmt, icon } from './ui.js';
import { Viewport } from './viewport.js';
import { kitNotes } from './building-kit.js';
import {
  BUILDING_DEFAULTS,
  BUILDING_LIMITS,
  KIT,
  OPENING_DEFAULTS,
  ROOFS,
  WALLS,
  WALL_NAMES,
  buildingLayout,
  fitsPlate,
  validateBuilding,
  wallLength,
} from './geometry/building.js';

const KEY = 'foundry.building';
const PART_ICONS = { base: 'plate', front: 'box', back: 'box', left: 'box', right: 'box', door: 'layers' };
const field = (name, label, value, [min, max], unit = 'mm', extra = '') =>
  `<label class="bd-row"${extra}><span>${esc(label)}</span><span class="bd-input"><input type="number" name="${name}" value="${esc(String(value))}" min="${min}" max="${max}" step="1"><small>${unit}</small></span></label>`;
const SIDES = [
  ['overhangFront', 'Front'],
  ['overhangBack', 'Back'],
  ['overhangLeft', 'Left'],
  ['overhangRight', 'Right'],
];

/** A place on a wall where a new window or door fits, or null. */
export function freePlace(building, wall, opening) {
  const L = wallLength(building, wall);
  for (let at = opening.width / 2; at <= L - opening.width / 2; at += 1) {
    try {
      validateBuilding({ ...building, openings: [...building.openings, { ...opening, wall, at }] });
      return at;
    } catch {
      // Not here: try further along.
    }
  }
  return null;
}

export function createBuildingsPage({ host, call, store, download, notice, plate, density }) {
  let building = load(),
    name = building.name ?? 'Garage',
    savedId = building.savedId ?? null,
    parts = [],
    sizes = {},
    view = 'model',
    wall = 'left',
    selected = null,
    viewport = null,
    serial = 0,
    timer = 0,
    fitted = false;
  delete building.name;
  delete building.savedId;
  building = safe(building);

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) ?? {};
    } catch {
      return {};
    }
  }
  function safe(b) {
    try {
      return validateBuilding(b);
    } catch {
      return validateBuilding({});
    }
  }
  function remember() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...building, name, savedId }));
    } catch {
      // Storage can be off; the building is still on the page.
    }
  }
  const $ = (s) => host.querySelector(s);

  host.innerHTML = `<div class="bd">
<aside class="bd-col" aria-label="The building and its parts">
  <div class="bd-card-head"><span class="bd-tile">${icon('building')}</span><span><b>One-car garage</b><small>Toy proportions for 1:32</small></span></div>
  <div class="bd-group">Parts of the kit</div>
  <div class="bd-parts" role="list"></div>
  <div class="bd-group">Your buildings</div>
  <div class="bd-saved"></div>
  <div class="bd-group">Coming later</div>
  <p class="bd-later">Brick and concrete walls, storeys, and clipping to the track.</p>
</aside>
<section class="bd-centre">
  <header><div class="bd-title"><small class="sf-eyebrow">Buildings</small><input name="buildingName" aria-label="Building name" maxlength="120"></div>
    <span class="bd-pill" data-bd-fit></span>
    <div class="bd-seg" role="group" aria-label="View"><button type="button" data-bd-view="model">Model</button><button type="button" data-bd-view="plate">Parts on the plate</button></div>
  </header>
  <div class="bd-stage"><div class="bd-model"></div><div class="bd-plates" hidden></div><div class="bd-message" role="status" hidden></div></div>
  <footer><div class="bd-chips" data-bd-chips></div><span class="bd-grow"></span>
    <button type="button" class="sf-btn ghost" data-bd="new">${icon('plus')}New building</button>
    <button type="button" class="sf-btn soft" data-bd="save">${icon('library')}Save to Library</button>
    <button type="button" class="sf-btn primary" data-bd="export">${icon('export')}Export kit</button></footer>
</section>
<aside class="bd-panel" aria-label="Settings">
  <div class="sf-eyebrow">Building</div><h2 data-bd-name></h2>
  <form class="bd-form" autocomplete="off">
    <section class="bd-box"><h3>Size</h3>
      ${field('width', 'Width', building.width, BUILDING_LIMITS.width)}
      ${field('depth', 'Depth', building.depth, BUILDING_LIMITS.depth)}
      ${field('height', 'Wall height', building.height, BUILDING_LIMITS.height)}
      <p class="bd-hint">Outside the walls, up to the eaves. A one-car garage of 120 × 180 mm and 75 mm high takes practically any 1:32 slot car.</p></section>
    <section class="bd-box"><h3>Roof</h3>
      <div class="bd-seg bd-wide" role="group" aria-label="Roof">${ROOFS.map(([id, label]) => `<button type="button" data-bd-roof="${id}">${label}</button>`).join('')}</div>
      ${field('pitch', 'Pitch', building.pitch, BUILDING_LIMITS.pitch, '°', ' data-bd-for="slope gable"')}
      <label class="bd-row" data-bd-for="gable"><span>Ridge runs</span><select name="ridge"><option value="depth">Front to back</option><option value="width">Side to side</option></select></label>
      <label class="bd-row" data-bd-for="slope"><span>Rises towards</span><select name="rises">${WALLS.map((w) => `<option value="${w}">The ${w}</option>`).join('')}</select></label>
      <div class="bd-sub">Overhang</div>
      <div class="bd-sides">${SIDES.map(([k, label]) => field(k, label, building[k], BUILDING_LIMITS[k])).join('')}</div>
      <p class="bd-hint">How far the roof reaches past each wall. A sloped or two-sided roof lies on the walls, which follow it; a flat roof has a lip under it that holds the walls square.</p></section>
    <section class="bd-box"><h3>Garage door</h3>
      ${field('doorWidth', 'Width', building.doorWidth, BUILDING_LIMITS.doorWidth)}
      ${field('doorHeight', 'Height', building.doorHeight, BUILDING_LIMITS.doorHeight)}
      <label class="bd-row"><span>Door</span><select name="door"><option value="roller">Roller door</option><option value="open">Open, no door</option></select></label>
      <p class="bd-hint">The opening starts at the top of the base, so a car rolls straight in from the road.</p></section>
    <section class="bd-box"><h3>Windows and doors</h3>
      <div class="bd-seg bd-wide" role="group" aria-label="Wall">${WALLS.map((w) => `<button type="button" data-bd-wall="${w}">${WALL_NAMES[w]}</button>`).join('')}</div>
      <div class="bd-openings"></div>
      <div class="bd-adds"><button type="button" class="bd-add" data-bd-add="window">${icon('plus')}Window</button><button type="button" class="bd-add" data-bd-add="door">${icon('plus')}Door</button></div>
      <p class="bd-hint">Each is a hole in the wall. Place is the middle of the opening, measured from the left end of the wall as you look at it from outside. A frame is a part of its own, glued on around the opening.</p></section>
    <section class="bd-box"><h3>Base</h3>
      ${field('baseHeight', 'Height', building.baseHeight, BUILDING_LIMITS.baseHeight)}
      <p class="bd-hint">Make it as high as your track, so the doorstep is level with the road. It stands on the table, hollow underneath.</p></section>
    <section class="bd-box"><h3>Walls</h3>
      <p class="bd-hint">Walls ${KIT.wall} mm thick, mitred at the corners so the outside has no seam, standing ${KIT.groove} mm deep in a groove of the base.</p></section>
    <p class="bd-error" role="alert" hidden></p>
  </form>
</aside></div>`;

  const form = $('.bd-form');

  // The windows and doors of the chosen wall, each a small card.
  function drawOpenings() {
    const rows = building.openings
      .map((o, i) => [o, i])
      .filter(([o]) => o.wall === wall)
      .map(
        ([o, i]) => `<div class="bd-opening" data-op="${i}">
  <div class="bd-op-head">${icon(o.type === 'door' ? 'open' : 'view')}<b>${o.type === 'door' ? 'Door' : 'Window'}</b><span class="bd-grow"></span>
    <button type="button" class="bd-remove" data-bd-remove="${i}" title="Remove" aria-label="Remove this ${o.type}">${icon('close')}</button></div>
  ${field('at', 'Place', o.at, [0, wallLength(building, o.wall)])}
  ${field('opWidth', 'Width', o.width, [8, wallLength(building, o.wall)])}
  ${field('opHeight', 'Height', o.height, [8, building.height])}
  ${o.type === 'window' ? field('sill', 'Up from the floor', o.sill, [0, building.height]) : ''}
  <label class="bd-check"><input type="checkbox" name="frame"${o.frame ? ' checked' : ''}><span>Frame</span></label>
</div>`,
      );
    $('.bd-openings').innerHTML = rows.join('') || '<p class="bd-hint">No windows or doors in the ' + wall + ' wall.</p>';
    for (const b of host.querySelectorAll('[data-bd-wall]')) b.setAttribute('aria-pressed', String(b.dataset.bdWall === wall));
  }
  function readForm() {
    const e = form.elements;
    const num = (el) => (el.value === '' ? NaN : Number(el.value));
    const openings = building.openings.map((o, i) => {
      const row = form.querySelector('[data-op="' + i + '"]');
      if (!row) return o;
      const get = (n) => row.querySelector('[name="' + n + '"]');
      return {
        ...o,
        at: num(get('at')),
        width: num(get('opWidth')),
        height: num(get('opHeight')),
        ...(o.type === 'window' && { sill: num(get('sill')) }),
        frame: get('frame').checked,
      };
    });
    return {
      ...building,
      width: num(e.width),
      depth: num(e.depth),
      height: num(e.height),
      doorWidth: num(e.doorWidth),
      doorHeight: num(e.doorHeight),
      baseHeight: num(e.baseHeight),
      pitch: num(e.pitch),
      overhangFront: num(e.overhangFront),
      overhangBack: num(e.overhangBack),
      overhangLeft: num(e.overhangLeft),
      overhangRight: num(e.overhangRight),
      door: e.door.value,
      ridge: e.ridge.value,
      rises: e.rises.value,
      openings,
    };
  }
  function message(text) {
    const box = $('.bd-message');
    box.textContent = text ?? '';
    box.hidden = !text;
  }
  function showError(text) {
    const box = $('.bd-error');
    box.textContent = text ?? '';
    box.hidden = !text;
  }
  function sync() {
    $('[data-bd-name]').textContent = name || 'Building';
    for (const b of host.querySelectorAll('[data-bd-view]')) b.setAttribute('aria-pressed', String(b.dataset.bdView === view));
    for (const b of host.querySelectorAll('[data-bd-roof]')) b.setAttribute('aria-pressed', String(b.dataset.bdRoof === building.roof));
    for (const el of host.querySelectorAll('[data-bd-for]')) el.hidden = !el.dataset.bdFor.split(' ').includes(building.roof);
    $('.bd-model').hidden = view !== 'model';
    $('.bd-plates').hidden = view !== 'plate';
    const layout = buildingLayout(building);
    const bed = plate();
    const fits = (p) => !sizes[p.id] || fitsPlate(sizes[p.id], bed);
    const big = layout.parts.filter((p) => !fits(p));
    const pill = $('[data-bd-fit]');
    pill.textContent = big.length
      ? big.length + (big.length === 1 ? ' part is' : ' parts are') + ' larger than the plate'
      : 'Fits a ' + fmt(bed.width) + ' × ' + fmt(bed.depth) + ' plate';
    pill.classList.toggle('warn', big.length > 0);
    $('.bd-parts').innerHTML = layout.parts
      .map(
        (p) =>
          `<button type="button" class="bd-part${p.id === selected ? ' active' : ''}${fits(p) ? '' : ' big'}" data-bd-part="${p.id}">${icon(PART_ICONS[p.id] ?? (p.role === 'roof' ? 'building' : p.role === 'frame' ? 'view' : 'box'))}<span><b>${esc(p.name)}</b><small>${sizes[p.id] ? sizes[p.id].map((v) => fmt(v)).join(' × ') + ' mm' : '…'}</small></span></button>`,
      )
      .join('');
    const grams = (parts.reduce((sum, p) => sum + p.volume, 0) / 1000) * density();
    $('[data-bd-chips]').innerHTML =
      '<span>' + layout.parts.length + ' parts</span>' +
      (parts.length ? '<span>≈ ' + Math.round(grams) + ' g filament</span>' : '') +
      '<span>No supports</span>';
    drawPlates(layout, bed);
  }
  // Every part on a plate of its own, as it lies when printed.
  function drawPlates(layout, bed) {
    const s = 0.9;
    $('.bd-plates').innerHTML = layout.parts
      .filter((p) => sizes[p.id])
      .map((p) => {
        const size = sizes[p.id];
        const [x, y] = size[0] <= bed.width - 2 * (bed.margin ?? 0) ? size : [size[1], size[0]];
        const fits = fitsPlate(size, bed);
        return (
          '<figure class="bd-plate' + (fits ? '' : ' big') + '"><svg viewBox="0 0 ' + bed.width * s + ' ' + bed.depth * s +
          '" role="img" aria-label="' + esc(p.name) + ' on the plate"><rect class="bd-bed" width="' + bed.width * s + '" height="' + bed.depth * s + '" rx="6"/>' +
          '<rect class="bd-piece" x="' + ((bed.width - Math.min(x, bed.width)) / 2) * s + '" y="' + ((bed.depth - Math.min(y, bed.depth)) / 2) * s +
          '" width="' + Math.min(x, bed.width) * s + '" height="' + Math.min(y, bed.depth) * s + '" rx="2"/></svg><figcaption><b>' + esc(p.name) +
          '</b><small>' + size.map((v) => fmt(v)).join(' × ') + ' mm' + (fits ? '' : ' · larger than the plate') + '</small></figcaption></figure>'
        );
      })
      .join('');
  }
  // Takes a building as the page now has it, and builds it.
  async function rebuild(next = readForm()) {
    const mine = ++serial;
    try {
      next = validateBuilding(next);
    } catch (err) {
      showError(err.message);
      return;
    }
    showError('');
    building = next;
    remember();
    sync();
    message('Building the parts…');
    try {
      const made = await call('buildingParts', { building, plate: plate() });
      if (mine !== serial) return;
      parts = made;
      sizes = Object.fromEntries(made.map((p) => [p.id, p.print]));
      message('');
      if (view === 'model') show();
      sync();
    } catch (err) {
      if (mine === serial) message(err.message);
    }
  }
  function show() {
    viewport ??= new Viewport($('.bd-model'), (id) => choose(id));
    viewport.resize();
    viewport.setParts(parts, !fitted);
    fitted = true;
    viewport.select(selected ?? undefined, new Set());
  }
  function choose(id) {
    selected = selected === id ? null : id;
    viewport?.select(selected ?? undefined, new Set());
    sync();
  }
  async function listSaved() {
    try {
      const saved = await (await store()).buildings();
      $('.bd-saved').innerHTML = saved.length
        ? saved
            .map(
              (b) =>
                `<button type="button" class="bd-part${b.id === savedId ? ' active' : ''}" data-bd-open="${esc(b.id)}">${icon('building')}<span><b>${esc(b.name)}</b><small>${fmt(b.building.width)} × ${fmt(b.building.depth)} mm</small></span></button>`,
            )
            .join('')
        : '<p class="bd-later">Buildings you save appear here and in the Library.</p>';
    } catch (err) {
      $('.bd-saved').innerHTML = '<p class="bd-later">' + esc(err.message) + '</p>';
    }
  }
  function fill(b) {
    for (const k of ['width', 'depth', 'height', 'doorWidth', 'doorHeight', 'baseHeight', 'pitch', 'overhangFront', 'overhangBack', 'overhangLeft', 'overhangRight'])
      form.elements[k].value = b[k];
    for (const k of ['door', 'ridge', 'rises']) form.elements[k].value = b[k];
    $('[name="buildingName"]').value = name;
    drawOpenings();
  }
  async function exportKit() {
    const files = await call('buildingKit', { building });
    const layout = buildingLayout(building);
    const zip = { 'README.txt': strToU8(kitNotes(name, layout, sizes)) };
    files.forEach((f, i) => (zip[String(i + 1).padStart(2, '0') + ' ' + f.name + '.stl'] = f.bytes));
    download((name || 'Building').replace(/[\\/:*?"<>|]+/g, '-') + ' kit.zip', zipSync(zip, { level: 6 }), 'application/zip');
    notice('Kit downloaded: ' + files.length + ' STL files and the notes for printing and putting it together.');
  }
  async function save() {
    const s = await store();
    savedId = await s.saveBuilding({ id: savedId ?? undefined, name: name || 'Building', building, updated: Date.now() });
    remember();
    await listSaved();
    notice('Saved in the Library: ' + (name || 'Building') + '.');
  }
  async function addOpening(type) {
    const current = readForm();
    const opening = { ...OPENING_DEFAULTS[type] };
    let base;
    try {
      base = validateBuilding(current);
    } catch (err) {
      showError(err.message);
      return;
    }
    const at = freePlace(base, wall, opening);
    if (at === null) {
      showError('There is no room for a ' + type + ' of ' + opening.width + ' mm in the ' + wall + ' wall. Make the wall longer, or the other openings smaller.');
      return;
    }
    building = { ...base, openings: [...base.openings, { ...opening, wall, at }] };
    drawOpenings();
    await rebuild(building);
  }

  form.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => rebuild(), 250);
  });
  form.addEventListener('change', () => {
    clearTimeout(timer);
    rebuild();
  });
  $('[name="buildingName"]').addEventListener('input', (e) => {
    name = e.target.value.trim();
    remember();
    $('[data-bd-name]').textContent = name || 'Building';
  });
  host.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.bdView) {
        view = b.dataset.bdView;
        sync();
        if (view === 'model' && parts.length) show();
      } else if (b.dataset.bdRoof) {
        const next = { ...readForm(), roof: b.dataset.bdRoof };
        fitted = false;
        await rebuild(next);
      } else if (b.dataset.bdWall) {
        const next = readForm();
        wall = b.dataset.bdWall;
        try {
          building = validateBuilding(next);
        } catch {
          // Keep the last good building; the error stays in view.
        }
        drawOpenings();
      } else if (b.dataset.bdAdd) await addOpening(b.dataset.bdAdd);
      else if (b.dataset.bdRemove !== undefined) {
        const next = readForm();
        next.openings = next.openings.filter((_, i) => i !== Number(b.dataset.bdRemove));
        building = { ...building, openings: next.openings };
        drawOpenings();
        await rebuild({ ...next });
      } else if (b.dataset.bdPart) choose(b.dataset.bdPart);
      else if (b.dataset.bdOpen) await open(b.dataset.bdOpen);
      else if (b.dataset.bd === 'export') await exportKit();
      else if (b.dataset.bd === 'save') await save();
      else if (b.dataset.bd === 'new') {
        building = validateBuilding({});
        name = 'Garage';
        savedId = null;
        fitted = false;
        fill(building);
        await rebuild(building);
        await listSaved();
      }
    } catch (err) {
      notice(err.message);
    }
  });
  async function open(id) {
    const saved = await (await store()).building(id);
    building = saved.building;
    name = saved.name;
    savedId = saved.id;
    fitted = false;
    fill(building);
    await rebuild(building);
    await listSaved();
  }

  return {
    async show() {
      fill(building);
      await Promise.all([rebuild(building), listSaved()]);
    },
    open,
    resize: () => viewport?.resize(),
  };
}
