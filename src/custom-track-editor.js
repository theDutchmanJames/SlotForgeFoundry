import './custom-track.css';
import { esc, field } from './ui.js';
import { trackParameters } from './track.js';
import { MAX_PATH_POINTS, refreshCustomTrack } from './custom-track.js';
import {
  creatorLaneControls,
  bindCreatorLaneControls,
} from './creator-lane-controls.js';

const SVG = 'http://www.w3.org/2000/svg';
const pointString = (point) => point.join(',');
const polyline = (points) => points.map(pointString).join(' ');
const rounded = (n) => Number(n.toFixed(3));

export function openCustomTrackEditor({
  track,
  onApply,
  collectionName,
  packRules,
}) {
  const editing = track.params.kind === 'import' && track.custom;
  const p = trackParameters({ ...track.params, kind: 'import' });
  delete p.special;
  delete p.startingGrid;
  // A piece handed over from a plain straight or curve may carry an
  // off-centre slot. A freeform path draws its lanes about the road centre.
  delete p.slotPosition;
  if (packRules)
    Object.assign(p, {
      width: packRules.width,
      lanes: packRules.lanes,
      laneSpacing: packRules.laneSpacing,
    });
  const recipe = editing
    ? structuredClone(track.custom)
    : {
        version: 1,
        radius: Math.max(125, Math.ceil(p.width * 0.75)),
        points: [
          [0, 0],
          [200, 0],
        ],
      };
  const dialog = document.createElement('dialog');
  dialog.className = 'custom-track-editor';
  dialog.setAttribute('aria-labelledby', 'custom-track-title');
  dialog.innerHTML = `
    <header><div><h2 id="custom-track-title">Draw a freeform path</h2>${collectionName ? '<p class="hint">Track pack · ' + esc(collectionName) + '</p>' : ''}</div><button type="button" data-custom="close" aria-label="Close drawing">×</button></header>
    <div class="ct-body"><div class="ct-surface"><svg role="img" aria-label="Road and lane path drawing" tabindex="0" data-custom-canvas>
      <defs><pattern id="ct-grid" patternUnits="userSpaceOnUse"><path fill="none" vector-effect="non-scaling-stroke"/></pattern></defs>
      <rect data-ct-grid fill="url(#ct-grid)"/>
      <g data-ct-world transform="scale(1,-1)"><g data-ct-road></g><polyline data-ct-polygon fill="none" vector-effect="non-scaling-stroke"/><g data-ct-handles></g></g>
    </svg><div class="ct-view"><label><input data-ct-snap type="checkbox" checked> Snap 5 mm</label><button type="button" data-custom="out" aria-label="Zoom out">−</button><button type="button" data-custom="in" aria-label="Zoom in">+</button><button type="button" data-custom="fit">Fit drawing</button></div></div>
    <div class="ct-controls"><label class="ct-name">Piece name<input data-ct-name maxlength="100" class="text" value="${esc(track.sourceName || 'Custom piece')}"></label>
    ${field('ctWidth', 'Road width', p.width, 'mm', { min: 2, max: 5000 })}
    ${field('ctLanes', 'Lanes', p.lanes, '', { min: 1, max: 8, step: 1 })}
    ${field('ctSpacing', 'Lane spacing', p.laneSpacing, 'mm', { min: 0.1, max: 1000 })}
    ${packRules ? '<p class="hint">Change road width, lanes and spacing in Pack rules.</p>' : ''}
    ${creatorLaneControls()}
    ${field('ctRadius', 'Centre bend radius', recipe.radius, 'mm', { min: 0.1, max: 20000 })}
    <label class="ct-loop"><input type="checkbox" data-ct-closed ${recipe.closed ? 'checked' : ''}> Close loop</label>
    <label class="ct-name">When the road crosses itself<select data-ct-crossing-mode><option value="">Flag overlap</option><option value="flat-pieces">Flat pieces on supports</option></select></label>
    <div data-ct-crossings></div>
    <p class="hint">Click the grid to extend the path. Drag a point or enter its coordinates. Bends round off where straight sections meet.</p>
    <label class="ct-name">Selected point<select data-ct-point></select></label>
    ${field('ctX', 'X', 0, 'mm', { min: -20000, max: 20000 })}
    ${field('ctY', 'Y', 0, 'mm', { min: -20000, max: 20000 })}
    <div class="ct-point-buttons"><button type="button" data-custom="add">Add point</button><button type="button" data-custom="remove">Remove point</button></div>
    </div></div><footer><span role="status" data-ct-status></span><button type="button" data-custom="cancel">Cancel</button><button type="button" class="primary" data-custom="apply">${collectionName ? 'Add to pack' : 'Use track piece'}</button></footer>`;
  document.body.append(dialog);
  const $ = (s) => dialog.querySelector(s);
  const input = (name) => dialog.querySelector('[name="' + name + '"]');
  const svg = $('[data-custom-canvas]');
  const select = $('[data-ct-point]');
  const status = $('[data-ct-status]');
  const apply = $('[data-custom="apply"]');
  const readAdjustment = bindCreatorLaneControls(dialog, p.laneAdjustment);
  if (packRules)
    for (const key of ['ctWidth', 'ctLanes', 'ctSpacing'])
      input(key).readOnly = true;
  $('[data-ct-crossing-mode]').value = recipe.crossingMode || '';
  let selected = recipe.points.length - 1,
    camera,
    dragging = false,
    frame = 0,
    committing = false,
    proposed;
  function element(tag, attrs) {
    const item = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs))
      item.setAttribute(key, value);
    return item;
  }
  function setCamera(x, y, width, height) {
    camera = { x, y, width, height };
    svg.setAttribute(
      'viewBox',
      [x - width / 2, -y - height / 2, width, height].join(' '),
    );
    const grid = $('[data-ct-grid]');
    const diagonal = Math.max(width, height) * 6;
    for (const [k, v] of Object.entries({
      x: x - diagonal / 2,
      y: -y - diagonal / 2,
      width: diagonal,
      height: diagonal,
    }))
      grid.setAttribute(k, v);
    const target = width / 24;
    const step =
      [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000].find(
        (s) => s >= target,
      ) ?? 5000;
    const pattern = $('#ct-grid');
    pattern.setAttribute('width', step);
    pattern.setAttribute('height', step);
    pattern.firstElementChild.setAttribute(
      'd',
      'M 0 ' + step + ' V 0 H ' + step,
    );
  }
  function fit() {
    const pts = [...recipe.points, ...(proposed?.plan.outlines.flat() ?? [])];
    const xs = pts.map((q) => q[0]),
      ys = pts.map((q) => q[1]);
    const x0 = Math.min(...xs),
      x1 = Math.max(...xs),
      y0 = Math.min(...ys),
      y1 = Math.max(...ys);
    setCamera(
      (x0 + x1) / 2,
      (y0 + y1) / 2,
      Math.max(160, x1 - x0) * 1.6,
      Math.max(120, y1 - y0) * 1.8,
    );
  }
  function pointFields() {
    const [x, y] = recipe.points[selected];
    input('ctX').value = x;
    input('ctY').value = y;
    if (select.length !== recipe.points.length) {
      select.replaceChildren(
        ...recipe.points.map((_, i) => new Option('Point ' + (i + 1), i)),
      );
    }
    select.value = String(selected);
    $('[data-custom="remove"]').disabled = recipe.points.length <= 2;
    $('[data-custom="add"]').disabled = recipe.points.length >= MAX_PATH_POINTS;
    $('[data-custom="add"]').textContent =
      selected < recipe.points.length - 1 ? 'Insert after' : 'Add point';
  }
  function draw(changed) {
    const road = $('[data-ct-road]');
    let crossingNotice = '';
    const adjustment = readAdjustment(p, changed);
    if (adjustment) p.laneAdjustment = adjustment;
    else delete p.laneAdjustment;
    try {
      if (
        [...dialog.querySelectorAll('input[type="number"]')].some(
          (el) =>
            !el.disabled &&
            (!Number.isFinite(el.valueAsNumber) || !el.validity.valid),
        )
      )
        throw Error(
          'Enter valid dimensions and point coordinates to preview your piece.',
        );
      try {
        proposed = refreshCustomTrack({ ...track, params: p, custom: recipe });
      } catch (err) {
        if (recipe.crossingMode || !err.message.includes('overlaps itself'))
          throw err;
        // Show where the routes cross before the user commits to an overpass.
        proposed = refreshCustomTrack({
          ...track,
          params: p,
          custom: { ...recipe, crossingMode: 'flat-pieces' },
        });
        if (!proposed.plan.flatCrossing?.crossings.length) throw err;
        crossingNotice =
          'Crossing detected. Choose Flat pieces on supports to create separate decks.';
      }
      const plan = proposed.plan;
      road.replaceChildren(
        ...plan.outlines.map((outline) =>
          element('polygon', {
            points: polyline(outline),
            class: 'ct-road',
            'vector-effect': 'non-scaling-stroke',
          }),
        ),
        ...plan.lanes.map((l) =>
          element('polyline', {
            points: polyline(l),
            fill: 'none',
            class: 'ct-lane',
            'vector-effect': 'non-scaling-stroke',
          }),
        ),
      );
      const crossings = plan.flatCrossing?.crossings ?? [];
      for (const c of crossings) {
        const direction = c[c.upperPass + 'Direction'];
        const ends = [-1, 1].map((sign) =>
          c.point.map((v, i) => v + sign * p.width * 0.6 * direction[i]),
        );
        road.append(
          element('polyline', {
            points: polyline(ends),
            class: 'ct-upper-road',
            'stroke-width': Math.max(1, p.width * 0.65),
          }),
        );
        road.append(
          element('polyline', {
            points: polyline(ends),
            class: 'ct-upper-arrow',
            'vector-effect': 'non-scaling-stroke',
          }),
        );
      }
      const choices = $('[data-ct-crossings]');
      if (choices.childElementCount !== crossings.length) {
        choices.replaceChildren(
          ...crossings.map((_, i) => {
            const label = document.createElement('label');
            label.className = 'ct-name';
            label.append('Crossing ' + (i + 1) + ' · upper road');
            const selectPass = document.createElement('select');
            selectPass.dataset.ctPass = i;
            selectPass.add(new Option('First pass along the path', 'first'));
            selectPass.add(new Option('Second pass along the path', 'second'));
            label.append(selectPass);
            return label;
          }),
        );
      }
      crossings.forEach((c, i) => {
        const selector = choices.children[i].querySelector('select');
        selector.value = c.upperPass;
        selector.disabled = Boolean(crossingNotice);
      });
      status.textContent =
        crossingNotice ||
        (crossings.length
          ? 'Highlighted road goes over. Both passages print flat, road-face down.'
          : '');
      status.classList.toggle('ct-error', Boolean(crossingNotice));
    } catch (err) {
      proposed = null;
      road.replaceChildren();
      $('[data-ct-crossings]').replaceChildren();
      status.textContent = err.message;
      status.classList.add('ct-error');
    }
    if (!camera) fit();
    const scale = svg.getScreenCTM()?.a || 1;
    $('[data-ct-polygon]').setAttribute(
      'points',
      polyline(
        recipe.closed ? [...recipe.points, recipe.points[0]] : recipe.points,
      ),
    );
    $('[data-ct-handles]').replaceChildren(
      ...recipe.points.map((q, i) =>
        element('circle', {
          cx: q[0],
          cy: q[1],
          r: 7 / scale,
          'data-ct-index': i,
          class: i === selected ? 'ct-selected' : '',
          'vector-effect': 'non-scaling-stroke',
        }),
      ),
    );
    apply.disabled =
      !proposed ||
      Boolean(crossingNotice) ||
      !$('[data-ct-name]').value.trim() ||
      committing;
  }
  function local(e, snap = $('[data-ct-snap]').checked) {
    const matrix = $('[data-ct-world]').getScreenCTM();
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      matrix.inverse(),
    );
    return [q.x, q.y].map((v) => (snap ? Math.round(v / 5) * 5 : rounded(v)));
  }
  function zoom(factor, x = camera.x, y = camera.y) {
    const f = Math.max(5 / camera.width, Math.min(1e5 / camera.width, factor));
    setCamera(
      x + (camera.x - x) * f,
      y + (camera.y - y) * f,
      camera.width * f,
      camera.height * f,
    );
  }
  function scheduleDraw() {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        draw();
      });
  }
  let pan;
  svg.addEventListener('pointerdown', (e) => {
    if (!committing && (e.button === 1 || (e.button === 0 && e.ctrlKey))) {
      e.preventDefault();
      pan = { x: e.clientX, y: e.clientY, camera, scale: svg.getScreenCTM().a };
      svg.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0 || committing) return;
    const handle = e.target.closest('[data-ct-index]');
    if (handle) {
      selected = Number(handle.dataset.ctIndex);
      dragging = true;
      svg.setPointerCapture(e.pointerId);
    } else if (recipe.points.length < MAX_PATH_POINTS) {
      recipe.points.push(local(e));
      selected = recipe.points.length - 1;
    }
    pointFields();
    draw();
  });
  svg.addEventListener('pointermove', (e) => {
    if (pan && svg.hasPointerCapture(e.pointerId)) {
      setCamera(
        pan.camera.x - (e.clientX - pan.x) / pan.scale,
        pan.camera.y + (e.clientY - pan.y) / pan.scale,
        pan.camera.width,
        pan.camera.height,
      );
      return;
    }
    if (!dragging || !svg.hasPointerCapture(e.pointerId)) return;
    recipe.points[selected] = local(e);
    pointFields();
    scheduleDraw();
  });
  svg.addEventListener('lostpointercapture', () => {
    dragging = false;
    pan = null;
  });
  svg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoom(
        Math.exp(Math.max(-1, Math.min(1, e.deltaY * 0.001))),
        ...local(e, false),
      );
      scheduleDraw();
    },
    { passive: false },
  );
  select.addEventListener('change', () => {
    selected = Number(select.value);
    pointFields();
    draw();
  });
  const params = {
    ctWidth: 'width',
    ctLanes: 'lanes',
    ctSpacing: 'laneSpacing',
  };
  dialog.addEventListener('input', (e) => {
    const key = e.target.name,
      value = e.target.valueAsNumber;
    if (e.target.matches('[data-ct-crossing-mode]')) {
      if (e.target.value) recipe.crossingMode = e.target.value;
      else delete recipe.crossingMode;
    } else if (e.target.matches('[data-ct-closed]')) {
      recipe.closed = e.target.checked;
    } else if (e.target.matches('[data-ct-pass]')) {
      const i = Number(e.target.dataset.ctPass);
      recipe.upperPasses ??= [];
      while (recipe.upperPasses.length <= i) recipe.upperPasses.push('second');
      recipe.upperPasses[i] = e.target.value;
    } else if (key === 'ctX' || key === 'ctY') {
      if (Number.isFinite(value))
        recipe.points[selected][key === 'ctX' ? 0 : 1] = value;
    } else if (key === 'ctRadius') recipe.radius = value;
    else if (Object.hasOwn(params, key)) p[params[key]] = value;
    draw(e.target);
  });
  dialog.addEventListener('click', async (e) => {
    e.stopPropagation();
    const action = e.target.closest('[data-custom]')?.dataset.custom;
    if (!action || committing) return;
    if (action === 'cancel' || action === 'close') {
      dialog.close();
      return;
    }
    if (action === 'fit') fit();
    if (action === 'in' || action === 'out') {
      zoom(action === 'in' ? 0.75 : 1 / 0.75);
    }
    if (action === 'remove' && recipe.points.length > 2) {
      recipe.points.splice(selected, 1);
      selected = Math.min(selected, recipe.points.length - 1);
      pointFields();
    }
    if (action === 'add' && recipe.points.length < MAX_PATH_POINTS) {
      const point = recipe.points[selected],
        next = recipe.points[selected + 1];
      const inserted = next
        ? point.map((n, i) => rounded((n + next[i]) / 2))
        : point.map((n, i) => rounded(2 * n - recipe.points[selected - 1][i]));
      recipe.points.splice(++selected, 0, inserted);
      pointFields();
      fit();
    }
    if (action === 'apply') {
      if (!proposed || apply.disabled) return;
      committing = true;
      apply.disabled = true;
      try {
        const result = await onApply({
          ...proposed,
          sourceName: $('[data-ct-name]').value.trim(),
        });
        if (result === false)
          throw Error(
            'Could not build this track piece with its current settings.',
          );
        dialog.close();
      } catch (err) {
        committing = false;
        draw();
        status.textContent = err.message;
        status.classList.add('ct-error');
      }
      return;
    }
    draw();
  });
  dialog.addEventListener('keydown', (e) => e.stopPropagation());
  dialog.addEventListener('cancel', (e) => {
    if (committing) e.preventDefault();
  });
  dialog.addEventListener(
    'close',
    () => {
      cancelAnimationFrame(frame);
      dialog.remove();
    },
    { once: true },
  );
  dialog.showModal();
  pointFields();
  draw();
  return dialog;
}
