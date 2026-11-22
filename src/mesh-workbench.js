import './mesh-workbench.css';
import { Viewport } from './viewport.js';
import { mountSectionView } from './section-control.js';
import { meshEdges, meshSignature, weldedMesh } from './mesh-topology.js';
import { faceRuns, growSurfaceSelection } from './mesh-sculpt.js';
import { brushFaces, lassoFaces, visibleFaceMap } from './mesh-paint.js';
import { esc } from './ui.js';

function dialogFrame(title, views, controls) {
  const dialog = document.createElement('dialog');
  dialog.className = 'mesh-workbench';
  dialog.setAttribute('aria-label', title);
  dialog.innerHTML =
    '<header><h2>' +
    title +
    '</h2><button type="button" data-cancel aria-label="Close">×</button></header>' +
    '<div class="mesh-layout"><div class="mesh-views">' +
    views
      .map(
        (name, i) =>
          '<section><header><strong>' +
          name +
          '</strong><span data-mesh-toolbar="' +
          i +
          '"></span></header><div class="mesh-canvas" data-view="' +
          i +
          '"></div></section>',
      )
      .join('') +
    '</div>' +
    '<aside>' +
    controls +
    '<p data-message role="status"></p></aside></div><footer><button type="button" data-cancel>Cancel</button><button type="button" class="primary" data-accept disabled>Apply</button></footer>';
  document.body.append(dialog);
  dialog.showModal();
  const finished = new Promise((resolve) =>
    dialog.addEventListener(
      'close',
      () => resolve(dialog.returnValue === 'ok'),
      { once: true },
    ),
  );
  for (const b of dialog.querySelectorAll('[data-cancel]'))
    b.onclick = () => dialog.close();
  return {
    dialog,
    finished,
    query: (s) => dialog.querySelector(s),
    message: dialog.querySelector('[data-message]'),
    accept: dialog.querySelector('[data-accept]'),
  };
}

function described(mesh) {
  if (mesh.bounds) return mesh;
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const index of mesh.indices)
    for (let j = 0; j < 3; j++) {
      const value = mesh.positions[index * 3 + j];
      min[j] = Math.min(min[j], value);
      max[j] = Math.max(max[j], value);
    }
  return { ...mesh, id: 'review', role: 'body', bounds: { min, max } };
}

function liveTask(run, show, fail) {
  let ticket = 0,
    running = false,
    timer;
  async function launch() {
    const current = ticket;
    running = true;
    try {
      const value = await run();
      if (current === ticket) show(value);
    } catch (error) {
      if (current === ticket) fail(error);
    } finally {
      running = false;
      if (ticket > current) timer = setTimeout(launch, 50);
    }
  }
  return {
    update() {
      ticket++;
      clearTimeout(timer);
      if (!running) timer = setTimeout(launch, 75);
    },
    cancel() {
      clearTimeout(timer);
      ticket = -Infinity;
    },
  };
}

function svgOverlay(host) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('mesh-overlay');
  svg.setAttribute('aria-hidden', 'true');
  host.append(svg);
  return svg;
}
function overlayPath(svg, points, close, accent = false, existing) {
  const path = existing ?? document.createElementNS(svg.namespaceURI, 'path');
  const coords = points.map(
    ([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1),
  );
  path.setAttribute('d', coords.join(' ') + (close ? 'Z' : ''));
  path.setAttribute('class', accent ? 'accent' : '');
  if (!existing) svg.append(path);
  return path;
}

export async function reviewSTL(
  bytes,
  call,
  { inspect = false, append = false } = {},
) {
  const usable = await call('checkSTL', bytes);
  if (!inspect && usable) return bytes;
  const source = await call('inspectSTL', bytes);
  const flipCount = source.components.reduce((n, c) => n + c.flipped, 0);
  const count = (n, singular, plural = singular + 's') =>
    n + ' ' + (n === 1 ? singular : plural);
  const base = described(source);
  const { dialog, finished, query, message, accept } = dialogFrame(
    'Inspect and repair STL',
    ['Mesh inspection'],
    '<p>' +
      count(source.loops.length, 'open boundary', 'open boundaries') +
      ' · ' +
      count(source.components.length, 'connected component') +
      ' · ' +
      count(flipCount, 'inconsistent triangle') +
      '</p>' +
      (source.openChains || source.nonManifold || source.conflicts
        ? '<p>' +
          source.openChains +
          ' branched boundaries · ' +
          source.nonManifold +
          ' non-manifold edges · ' +
          source.conflicts +
          ' winding conflicts</p>'
        : '') +
      (source.loops.length
        ? '<p>Click an outlined opening to choose its patch. Click a surface to inspect its component.</p>'
        : '') +
      (source.loops.length
        ? '<label>Boundary <input type="number" data-loop value="1" min="1" max="' +
          source.loops.length +
          '"></label><label><input type="checkbox" data-fill> Fill this boundary</label>'
        : '') +
      (flipCount
        ? '<label><input type="checkbox" data-winding> Correct inconsistent winding</label>'
        : '') +
      '<label>Component <input type="number" data-shell min="1" max="' +
      source.components.length +
      '" value="1"></label>' +
      '<output data-shell-info></output><label><input type="checkbox" data-isolate> Isolate this component for inspection</label>' +
      '<label><input type="checkbox" data-remove> Remove this component</label>' +
      '<label><input type="checkbox" data-reverse> Reverse this component’s winding</label>',
  );
  accept.textContent = append ? 'Add to project' : 'Open as new model';
  const host = query('[data-view]'),
    view = new Viewport(host, (_id, face) => {
      if (view.sectionPlane) return;
      const sourceFace = visibleMesh.sourceFaces?.[face] ?? face;
      if (sourceFace < 0 || !Number.isInteger(source.component[sourceFace]))
        return;
      query('[data-shell]').value = source.component[sourceFace] + 1;
      selectedShell = true;
      controls();
      draw();
    }),
    svg = svgOverlay(host);
  mountSectionView(view, call, query('[data-mesh-toolbar]'), host);
  const choices = {
    fill: new Set(),
    remove: new Set(),
    reverse: new Set(),
    winding: false,
  };
  const payload = () => ({
    ...choices,
    fill: [...choices.fill],
    remove: [...choices.remove],
    reverse: [...choices.reverse],
  });
  const altered = () =>
    choices.fill.size ||
    choices.remove.size ||
    choices.reverse.size ||
    choices.winding;
  const shell = () => Number(query('[data-shell]').value) - 1,
    loop = () => Number(query('[data-loop]')?.value) - 1;
  const setChoice = (set, index, value) =>
    value ? set.add(index) : set.delete(index);
  let current = base,
    visibleMesh = base,
    selectedShell = false,
    changed = [],
    resultBytes,
    accepted = false;
  function draw() {
    let mesh = current;
    if (query('[data-isolate]').checked) {
      const indices = [],
        sourceFaces = [];
      for (let f = 0; f < source.component.length; f++)
        if (source.component[f] === shell()) {
          const k = 3 * f;
          indices.push(
            source.indices[k],
            source.indices[k + 1],
            source.indices[k + 2],
          );
          sourceFaces.push(f);
        }
      mesh = indices.length
        ? described({
            positions: source.positions,
            indices: Uint32Array.from(indices),
            sourceFaces,
          })
        : base;
    }
    visibleMesh = mesh;
    view.setParts(mesh.indices.length ? [mesh] : [], false);
    const highlights = new Set(mesh === current ? changed : []);
    if (flipCount || (selectedShell && source.components.length > 1)) {
      for (let i = 0; i < mesh.indices.length / 3; i++) {
        const sourceFace = mesh.sourceFaces?.[i] ?? i;
        if (
          sourceFace >= 0 &&
          (source.orient[sourceFace] ||
            (selectedShell && source.component[sourceFace] === shell()))
        )
          highlights.add(i);
      }
    }
    if (highlights.size) view.highlightFaces(mesh.id, [...highlights]);
  }
  function controls() {
    const c = source.components[shell()];
    if (!c) return;
    query('[data-shell-info]').textContent =
      c.triangles.toLocaleString() +
      ' triangles · ' +
      (c.closed ? 'closed shell' : 'open surface');
    query('[data-remove]').checked = choices.remove.has(c.id);
    query('[data-reverse]').checked = choices.reverse.has(c.id);
    if (query('[data-fill]'))
      query('[data-fill]').checked = choices.fill.has(loop());
  }
  // A preview or ResizeObserver can deliver a frame between pointerdown and
  // pointerup. Preserve the hit target while updating its projected geometry.
  const rimPaths = new Map();
  view.onRender = () => {
    svg.style.display = view.sectionPlane ? 'none' : '';
    if (view.sectionPlane) return;
    const selected = loop();
    const shown = new Set();
    // Keep dense damaged scans interactive. The numerical boundary picker can
    // focus any opening outside the currently displayed neighborhood.
    const first = Math.max(0, selected - 90),
      last = Math.min(source.loops.length, first + 180);
    for (let i = first; i < last; i++) {
      const vertices = source.loops[i],
        id = source.loopComponents[i];
      if (
        !vertices.length ||
        choices.fill.has(i) ||
        choices.remove.has(id) ||
        (query('[data-isolate]').checked && shell() !== id)
      )
        continue;
      const points = [];
      for (
        let j = 0;
        j < vertices.length;
        j += Math.max(
          1,
          Math.ceil(vertices.length / (i === selected ? 1200 : 90)),
        )
      ) {
        const v = vertices[j] * 3,
          p = view.projectPoint(source.positions.subarray(v, v + 3));
        points.push([p.x, p.y]);
      }
      const path = overlayPath(
        svg,
        points,
        true,
        i === selected,
        rimPaths.get(i),
      );
      path.dataset.boundary = i;
      rimPaths.set(i, path);
      shown.add(i);
    }
    for (const [i, path] of rimPaths) {
      if (shown.has(i)) continue;
      path.remove();
      rimPaths.delete(i);
    }
  };
  svg.addEventListener('click', (event) => {
    const path = event.target.closest('[data-boundary]');
    if (!path) return;
    const i = Number(path.dataset.boundary);
    query('[data-loop]').value = i + 1;
    query('[data-shell]').value = source.loopComponents[i] + 1;
    selectedShell = false;
    controls();
    draw();
    query('[data-fill]')?.focus({ preventScroll: true });
  });
  const task = liveTask(
    () => call('previewSTLRepair', payload()),
    (preview) => {
      changed = preview.changed;
      current = preview.indices.length
        ? described(preview)
        : { ...base, indices: new Uint32Array() };
      draw();
      message.textContent = preview.issue || 'Closed solid ready to import.';
      accept.disabled = !!preview.issue;
      dialog.dataset.reviewState = 'ready';
    },
    (error) => {
      current = base;
      changed = [];
      draw();
      message.textContent = error.message;
      accept.disabled = true;
      dialog.dataset.reviewState = 'error';
    },
  );
  function update() {
    dialog.dataset.reviewState = 'checking';
    accept.disabled = true;
    message.textContent = 'Checking the mesh…';
    task.update();
  }
  controls();
  view.setParts([base], true);
  query('[data-loop]')?.addEventListener('input', () => {
    controls();
    view.draw();
  });
  query('[data-shell]').oninput = () => {
    selectedShell = true;
    controls();
    draw();
  };
  query('[data-isolate]').onchange = draw;
  for (const [selector, set, index] of [
    ['[data-fill]', choices.fill, loop],
    ['[data-remove]', choices.remove, shell],
    ['[data-reverse]', choices.reverse, shell],
  ]) {
    const el = query(selector);
    if (el)
      el.onchange = () => {
        setChoice(set, index(), el.checked);
        query('[data-isolate]').checked = false;
        update();
      };
  }
  const winding = query('[data-winding]');
  if (winding)
    winding.onchange = () => {
      choices.winding = winding.checked;
      update();
    };
  accept.onclick = async () => {
    accept.disabled = true;
    try {
      resultBytes =
        altered() || !usable ? await call('finishSTLRepair', payload()) : bytes;
      accepted = true;
      dialog.close('ok');
    } catch (error) {
      message.textContent = error.message;
      update();
    }
  };
  update();
  try {
    return (await finished) && accepted ? resultBytes : null;
  } finally {
    task.cancel();
    view.dispose();
    dialog.remove();
    await call('closeSTLReview').catch(() => {});
  }
}

export async function editSurface(part, saved, preview, commit, call) {
  const { dialog, finished, query, message, accept } = dialogFrame(
    'Edit a surface',
    ['Selection', 'Live result'],
    '<p>' +
      esc(part.name) +
      '</p><label>Selection tool <select data-paint><option value="brush">Brush</option><option value="lasso">Lasso</option><option value="orbit">Orbit</option></select></label>' +
      '<label>Brush radius (px) <input data-radius type="number" min="2" max="120" value="22"></label>' +
      '<label><input type="checkbox" data-erase> Erase from selection</label>' +
      '<div class="mesh-row"><button type="button" data-grow>Grow</button><button type="button" data-shrink>Shrink</button><button type="button" data-clear>Clear</button></div>' +
      '<output data-count></output><label>Action <select data-method><option value="smooth">Smooth</option><option value="patch">Remove and patch</option></select></label>' +
      '<div data-smooth><label>Strength <input type="number" min="0.01" max="1" step="0.05" value="0.4" data-strength></label>' +
      '<label>Passes <input type="number" min="1" max="25" value="3" data-passes></label>' +
      '<label><input type="checkbox" checked data-protect> Protect sharp edges</label></div>',
  );
  const source = new Viewport(query('[data-view="0"]'), () => {}),
    result = new Viewport(query('[data-view="1"]'), () => {});
  const canvas = source.canvas,
    overlay = svgOverlay(source.host);
  query('[data-paint]').onchange = () => {
    query('[data-radius]').disabled = query('[data-paint]').value !== 'brush';
    canvas.style.cursor =
      query('[data-paint]').value === 'orbit' ? 'grab' : 'crosshair';
  };
  query('[data-paint]').onchange();
  mountSectionView(result, call, query('[data-mesh-toolbar="1"]'), result.host);
  source.setParts([part], true);
  result.setParts([part], true);
  let selection = new Set(),
    adjacency,
    depthMap,
    viewKey,
    gesture,
    ticket = 0,
    lastOp = null;
  const sourceKey = meshSignature(part);
  if (saved) {
    query('[data-method]').value = saved.method;
    if (saved.method === 'smooth') {
      query('[data-passes]').value = saved.iterations;
      query('[data-strength]').value = saved.strength;
      query('[data-protect]').checked = saved.protectEdges;
    }
    if (sourceKey === saved.sourceKey)
      for (let i = 0; i < saved.selection.length; i += 2)
        for (let j = 0; j < saved.selection[i + 1]; j++)
          selection.add(saved.selection[i] + j);
  }
  function operation() {
    return {
      type: 'surfaceEdit',
      method: query('[data-method]').value,
      sourceKey,
      selection: faceRuns(selection),
      iterations: query('[data-passes]').valueAsNumber,
      strength: query('[data-strength]').valueAsNumber,
      protectEdges: query('[data-protect]').checked,
    };
  }
  const task = liveTask(
    async () => {
      if (!selection.size) return null;
      const op = operation();
      return { mesh: await preview(op), op };
    },
    (value) => {
      if (!value) {
        result.setParts([part], false);
        return;
      }
      result.setParts([value.mesh], false);
      accept.disabled = false;
      lastOp = value.op;
      message.textContent = 'Live result ready.';
    },
    (error) => {
      result.setParts([part], false);
      message.textContent = error.message;
      accept.disabled = true;
      lastOp = null;
    },
  );
  function highlight() {
    source.highlightFaces(part.id, [...selection]);
    query('[data-count]').textContent =
      selection.size.toLocaleString() + ' triangles selected';
  }
  function refresh() {
    highlight();
    accept.disabled = true;
    lastOp = null;
    query('[data-smooth]').hidden = query('[data-method]').value !== 'smooth';
    message.textContent = selection.size
      ? 'Updating live result…'
      : 'Drag over the visible surface to select triangles.';
    task.update();
  }
  function extend(shrink) {
    if (!adjacency) {
      const mesh = weldedMesh(part);
      adjacency = meshEdges(mesh.indices, mesh.positions.length / 3).twins;
    }
    selection = growSurfaceSelection(selection, adjacency, shrink);
    refresh();
  }
  query('[data-grow]').onclick = () => extend(false);
  query('[data-shrink]').onclick = () => extend(true);
  query('[data-clear]').onclick = () => {
    selection.clear();
    refresh();
  };
  for (const name of ['method', 'passes', 'strength', 'protect'])
    query('[data-' + name + ']').oninput = refresh;
  function local(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  function radius() {
    return Math.min(
      120,
      Math.max(2, query('[data-radius]').valueAsNumber || 22),
    );
  }
  function mark(f) {
    if (gesture.erase) selection.delete(f);
    else selection.add(f);
  }
  function stroke(point) {
    if (gesture.kind === 'lasso') {
      const previous = gesture.points.at(-1);
      if (
        !previous ||
        Math.hypot(previous[0] - point[0], previous[1] - point[1]) >= 2
      )
        gesture.points.push(point);
      overlay.replaceChildren();
      overlayPath(overlay, gesture.points, true);
    } else {
      const previous = gesture.points[0] ?? point;
      const steps = Math.max(
        1,
        Math.ceil(
          Math.hypot(point[0] - previous[0], point[1] - previous[1]) /
            Math.max(1, radius() / 2),
        ),
      );
      for (let j = 1; j <= steps; j++)
        brushFaces(
          depthMap,
          previous[0] + ((point[0] - previous[0]) * j) / steps,
          previous[1] + ((point[1] - previous[1]) * j) / steps,
          radius(),
          mark,
        );
      gesture.points[0] = point;
      overlay.replaceChildren();
      const circle = document.createElementNS(overlay.namespaceURI, 'circle');
      circle.setAttribute('cx', point[0]);
      circle.setAttribute('cy', point[1]);
      circle.setAttribute('r', radius());
      overlay.append(circle);
      if (!ticket)
        ticket = requestAnimationFrame(() => {
          ticket = 0;
          highlight();
        });
    }
  }
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      const kind = query('[data-paint]').value;
      if (e.button !== 0 || kind === 'orbit' || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const key = [
        source.cssWidth,
        source.cssHeight,
        ...source.camera.projectionMatrix.elements,
        ...source.camera.matrixWorldInverse.elements,
      ].join(',');
      if (key !== viewKey) {
        depthMap = visibleFaceMap(
          part,
          source.camera,
          source.cssWidth,
          source.cssHeight,
        );
        viewKey = key;
      }
      canvas.setPointerCapture(e.pointerId);
      gesture = {
        id: e.pointerId,
        kind,
        points: [],
        erase: query('[data-erase]').checked || e.altKey,
      };
      stroke(local(e));
      accept.disabled = true;
      lastOp = null;
    },
    true,
  );
  canvas.addEventListener(
    'pointermove',
    (e) => {
      if (!gesture || gesture.id !== e.pointerId) return;
      e.stopImmediatePropagation();
      stroke(local(e));
    },
    true,
  );
  function finish(e) {
    if (!gesture || gesture.id !== e.pointerId) return;
    e.stopImmediatePropagation();
    if (gesture.kind === 'lasso' && e.type === 'pointerup')
      lassoFaces(depthMap, gesture.points, mark);
    gesture = null;
    overlay.replaceChildren();
    refresh();
  }
  canvas.addEventListener('pointerup', finish, true);
  canvas.addEventListener('pointercancel', finish, true);
  canvas.addEventListener('lostpointercapture', finish, true);
  // Matching camera directions keeps the before/after geometry easy to compare.
  source.controls.addEventListener('change', () => {
    result.camera.position.copy(source.camera.position);
    result.camera.quaternion.copy(source.camera.quaternion);
    result.camera.zoom = source.camera.zoom;
    result.span = source.span;
    result.controls.target.copy(source.controls.target);
    result.camera.updateMatrixWorld();
    result.resize();
  });
  accept.textContent = 'Apply surface edit';
  accept.onclick = async () => {
    if (!lastOp) return;
    accept.disabled = true;
    try {
      if (await commit(lastOp)) dialog.close('ok');
      else {
        message.textContent = 'The edit could not be applied to this history.';
        accept.disabled = false;
      }
    } catch (error) {
      message.textContent = error.message;
      accept.disabled = false;
    }
  };
  refresh();
  try {
    return await finished;
  } finally {
    task.cancel();
    if (ticket) cancelAnimationFrame(ticket);
    source.dispose();
    result.dispose();
    dialog.remove();
  }
}
