import './create-sketch.css';
import { esc } from './ui.js';
import { sketchCanvas } from './create-sketch-canvas.js';
import {
  defaultSketchGrid,
  exactGridPitch,
  gridAxisAngle,
  planeToGrid,
  resolveSketchGrid,
} from './sketch-grid.js';
import {
  sketchEntityInGrid,
  sketchEntityOnPlane,
} from './sketch-grid-entities.js';
import {
  importSketchDrawing,
  sketchElementPath,
  sketchPaths,
  validateSketch,
} from './create-sketch-data.js';

const names = {
  select: 'Select',
  line: 'Line',
  arc: 'Arc',
  rectangle: 'Rectangle',
  circle: 'Circle',
  slot: 'Slot',
  lProfile: 'L-profile',
  path: 'Path',
};
const hints = {
  select: 'Click an element to edit its dimensions.',
  line: 'Click the start and end. Continue clicking to join segments. Enter ends the chain.',
  arc: 'Click the start, a point on the arc, and the end.',
  rectangle:
    'Click opposite corners, or enter the lower-left corner and dimensions.',
  circle: 'Click the centre, then a point on the circumference.',
  slot: 'Click the centre, then a tip to set the length and direction.',
  lProfile:
    'Set the two leg lengths and wall thickness, then click the outside corner.',
};
const defaults = {
  line: {
    points: [
      [0, 0],
      [20, 0],
    ],
  },
  arc: {
    points: [
      [0, 0],
      [10, 10],
      [20, 0],
    ],
  },
  rectangle: { x: 0, y: 0, width: 30, height: 18 },
  circle: { x: 0, y: 0, diameter: 12 },
  slot: { x: 0, y: 0, length: 24, width: 6, angle: 0 },
  lProfile: { x: 0, y: 0, width: 40, height: 30, thickness: 4 },
};
const template = (type) => ({ type, ...structuredClone(defaults[type]) });
const fields = {
  rectangle: [
    ['x', 'Corner X'],
    ['y', 'Corner Y'],
    ['width', 'Width'],
    ['height', 'Height'],
    ['angle', 'Angle', '°'],
  ],
  circle: [
    ['x', 'Centre X'],
    ['y', 'Centre Y'],
    ['diameter', 'Diameter'],
  ],
  slot: [
    ['x', 'Centre X'],
    ['y', 'Centre Y'],
    ['length', 'Tip-to-tip length'],
    ['width', 'Width'],
    ['angle', 'Angle', '°'],
  ],
  lProfile: [
    ['x', 'Corner X'],
    ['y', 'Corner Y'],
    ['width', 'Horizontal leg'],
    ['height', 'Vertical leg'],
    ['thickness', 'Wall thickness'],
    ['angle', 'Angle', '°'],
  ],
};
const display = (n) => String(Number(n.toPrecision(12)));
const labelShape = (e, i) =>
  (e.type === 'path'
    ? e.closed
      ? 'Closed outline'
      : 'Open path'
    : names[e.type]) +
  ' ' +
  (i + 1);
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-8;

function drawn(tool, points, draft) {
  const [a, b, c] = points;
  if (!a) return null;
  if (tool === 'lProfile') return { ...draft, x: a[0], y: a[1] };
  if (!b || near(a, b)) return null;
  if (tool === 'line') return { type: tool, points: [a, b] };
  if (tool === 'arc') return c ? { type: tool, points: [a, b, c] } : null;
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  if (tool === 'rectangle') {
    const angle = ((draft.angle ?? 0) * Math.PI) / 180;
    const c = Math.cos(angle),
      s = Math.sin(angle);
    const u = dx * c + dy * s,
      v = -dx * s + dy * c,
      left = Math.min(0, u),
      bottom = Math.min(0, v);
    return {
      type: tool,
      x: a[0] + c * left - s * bottom,
      y: a[1] + s * left + c * bottom,
      width: Math.abs(u),
      height: Math.abs(v),
      ...(draft.angle ? { angle: draft.angle } : {}),
    };
  }
  if (tool === 'circle')
    return { type: tool, x: a[0], y: a[1], diameter: 2 * Math.hypot(dx, dy) };
  if (tool === 'slot')
    return {
      ...draft,
      x: a[0],
      y: a[1],
      length: 2 * Math.hypot(dx, dy),
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    };
  return null;
}

function numberField(key, label, value, unit = 'mm') {
  return (
    '<label class="sk-number"><span>' +
    esc(label) +
    '</span><input type="number" step="any" data-key="' +
    key +
    '" value="' +
    esc(display(value)) +
    '"><small>' +
    unit +
    '</small></label>'
  );
}

export async function editSketch({
  sketch,
  grid: savedGrid = sketch?.grid,
  referenceLoops = [],
  planeLabel = 'Selected face',
  title = 'Edit sketch',
  importFirst = false,
  error = '',
  plane = sketch?.plane ?? 'xy',
  offset = sketch?.offset ?? 0,
  name = sketch?.name ?? 'Sketch',
  hasFace = false,
} = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'create-sketch';
  dialog.setAttribute('aria-label', title);
  dialog.innerHTML =
    '<header><h2>' +
    esc(title) +
    '</h2><button type="button" data-sk-cancel aria-label="Close sketch">×</button></header>' +
    '<div class="sk-setup"><label>Name <input data-sk-name maxlength="120"></label><label>Workplane <select data-sk-plane><option value="xy">XY · Top</option><option value="xz">XZ · Front</option><option value="yz">YZ · Side</option>' +
    (hasFace || plane === 'face'
      ? '<option value="face">' + esc(planeLabel) + '</option>'
      : '') +
    '</select></label><label>Plane offset <input data-sk-offset type="number" step="any"> mm</label></div>' +
    '<div class="sk-tools" aria-label="Sketch tools">' +
    Object.entries(names)
      .filter(([key]) => key !== 'path')
      .map(
        ([key, label]) =>
          '<button type="button" data-sk-tool="' +
          key +
          '">' +
          label +
          '</button>',
      )
      .join('') +
    '<button type="button" data-sk-import>Import SVG/DXF</button><input type="file" data-sk-file accept=".svg,.dxf" hidden></div>' +
    '<div class="sk-layout"><div class="sk-view"><div class="sk-viewtools"><label>Square size <input type="number" data-sk-grid min=".001" step="any" list="sk-pitches"> mm</label><datalist id="sk-pitches"><option value="1"></option><option value="2"></option><option value="5"></option><option value="10"></option><option value="20"></option></datalist><label><input type="checkbox" data-sk-visible> Grid</label><label><input type="checkbox" data-sk-snap> Snap</label><button type="button" data-sk-fit>Fit sketch</button></div>' +
    '<div class="sk-grid-tools"><label>Grid zero <select data-sk-placement><option value="balanced">Equal edge margins</option><option value="corner">From lower-left corner</option><option value="workplane">Workplane origin</option><option value="custom">Picked point</option></select></label><button type="button" data-sk-zero aria-pressed="false">Set zero</button><button type="button" data-sk-align aria-pressed="false">Align X to edge</button><button type="button" data-sk-reverse title="Reverse the positive X direction">Reverse X</button><button type="button" data-sk-exact>Exact fit</button></div>' +
    '<canvas tabindex="0" aria-label="Sketch workplane"></canvas><div class="sk-grid-info" data-sk-grid-info aria-live="polite"></div><div class="sk-viewfooter"><span data-sk-position></span><span data-sk-density hidden></span><span>Middle-drag to pan · Scroll to zoom</span></div></div>' +
    '<aside><label class="sk-element-list">Elements <select data-sk-list></select></label><label data-sk-jump-label hidden>Element number <input type="number" data-sk-jump min="1" step="1"></label><section data-sk-properties></section><p class="sk-hint" data-sk-hint></p><button type="button" data-sk-project>Use face outline</button></aside></div>' +
    '<div class="sk-status" role="status" data-sk-status></div><footer><div><button type="button" data-sk-undo>Undo</button><button type="button" data-sk-redo>Redo</button></div>' +
    '<div><button type="button" data-sk-cancel>Cancel</button><button type="button" class="primary" data-sk-finish>Finish sketch</button></div></footer>';
  document.body.append(dialog);
  const $ = (selector) => dialog.querySelector(selector);
  const canvas = $('canvas'),
    list = $('[data-sk-list]'),
    panel = $('[data-sk-properties]'),
    status = $('[data-sk-status]'),
    finish = $('[data-sk-finish]');
  const nameInput = $('[data-sk-name]'),
    planeInput = $('[data-sk-plane]'),
    offsetInput = $('[data-sk-offset]'),
    gridInput = $('[data-sk-grid]'),
    snap = $('[data-sk-snap]'),
    gridPlacement = $('[data-sk-placement]'),
    gridVisible = $('[data-sk-visible]');
  planeInput.value = plane;
  offsetInput.value = offset;
  nameInput.value = name;
  let entities = structuredClone(sketch?.entities ?? []),
    selected = -1,
    tool = 'select',
    draft = null,
    pending = [],
    cursor = null;
  let undo = [],
    redo = [],
    result = null,
    currentVertex = 0,
    invalid = '',
    summary = '',
    editStart = null,
    closed = false,
    chainStart = null;
  let view,
    contours,
    pickGrid = null,
    gridResolved,
    gridSource,
    gridRefs;
  const emptyRefs = [];
  const activeRefs = () =>
    planeInput.value === 'face' ? referenceLoops : emptyRefs;
  let gridConfig = savedGrid ?? defaultSketchGrid(activeRefs());
  let gridInputInvalid = false;
  const planeGrids = new Map();
  const snapshot = () => ({ entities, gridConfig, plane: planeInput.value });
  const active = () => (selected >= 0 ? entities[selected] : draft);
  const history = (snapshot) => {
    undo.push(snapshot);
    if (undo.length > 50) undo.shift();
    redo = [];
  };
  function backup() {
    if (editStart && editStart.entities !== entities) history(editStart);
    editStart = null;
  }
  function saveEntities(next) {
    backup();
    history(snapshot());
    entities = next;
  }
  function updateGrid(writePitch = true) {
    const refs = activeRefs();
    if (gridSource !== gridConfig || gridRefs !== refs) {
      gridResolved = resolveSketchGrid(gridConfig, refs);
      gridSource = gridConfig;
      gridRefs = refs;
    }
    if (writePitch) {
      gridInput.value = display(gridConfig.pitch);
      gridInputInvalid = false;
    }
    snap.checked = gridConfig.snap;
    gridVisible.checked = gridConfig.visible;
    gridPlacement.value = gridConfig.placement;
    const bounded = !!activeRefs().length;
    for (const opt of gridPlacement.options)
      opt.disabled = !bounded && ['corner', 'balanced'].includes(opt.value);
    $('[data-sk-exact]').hidden = !bounded;
    $('[data-sk-zero]').setAttribute(
      'aria-pressed',
      String(pickGrid === 'origin'),
    );
    $('[data-sk-align]').setAttribute(
      'aria-pressed',
      String(pickGrid === 'axis'),
    );
    const summary = $('[data-sk-grid-info]');
    if (pickGrid === 'origin')
      summary.textContent =
        'Click a hole rim or centre, a corner, or a point for zero. Alt-click for a free point.';
    else if (pickGrid === 'axis')
      summary.textContent =
        'Click a straight edge to set +X. Reverse X flips its direction.';
    else {
      const { columns, rows, margins } = gridResolved;
      const angle = Number((gridConfig.angle % 360).toFixed(3));
      const mm = (n) => Number(n.toFixed(4));
      const marginsText = !bounded
        ? ''
        : gridConfig.placement === 'balanced'
          ? ' · Edge margins ' +
            mm(margins[0]) +
            ' mm X, ' +
            mm(margins[1]) +
            ' mm Y'
          : gridConfig.placement === 'corner'
            ? ' · Remaining ' +
              mm(margins[2]) +
              ' mm X, ' +
              mm(margins[3]) +
              ' mm Y'
            : '';
      summary.textContent =
        (bounded
          ? columns +
            ' × ' +
            rows +
            ' whole squares in face bounds' +
            marginsText +
            ' · '
          : '') +
        '+X at ' +
        angle +
        '°';
    }
    canvas.style.cursor =
      pickGrid || tool !== 'select' ? 'crosshair' : 'default';
    view?.request();
  }
  function setGrid(next, { writePitch = true, record = true } = {}) {
    backup();
    if (record) history(snapshot());
    const localDraft = draft && sketchEntityInGrid(draft, gridResolved);
    gridConfig = { ...gridConfig, ...next };
    pickGrid = null;
    updateGrid(writePitch);
    if (localDraft) draft = sketchEntityOnPlane(localDraft, gridResolved);
    if (cursor) refreshGuide(cursor);
    properties();
    updateStatus();
  }
  function pickDatum(mode) {
    if (invalid || gridInputInvalid) {
      updateStatus();
      return;
    }
    pickGrid = pickGrid === mode ? null : mode;
    pending = [];
    chainStart = null;
    view.guide(null, null);
    updateGrid(false);
  }
  function updateStatus(extra = '') {
    const configError = !nameInput.value.trim()
      ? 'Give the sketch a name.'
      : gridInputInvalid
        ? 'Enter a finite square size of at least 0.001 mm.'
        : !Number.isFinite(offsetInput.valueAsNumber)
          ? 'Enter a plane offset in millimetres.'
          : '';
    status.textContent =
      invalid ||
      configError ||
      extra ||
      summary ||
      'Draw a shape or import a vector outline.';
    status.classList.toggle('sk-error', Boolean(invalid || configError));
    finish.disabled = !!(invalid || configError) || !entities.length;
    $('[data-sk-undo]').disabled = !undo.length && !editStart;
    $('[data-sk-redo]').disabled = !redo.length;
    $('[data-sk-project]').hidden = !activeRefs().length;
  }
  function info() {
    summary = '';
    if (entities.length) {
      const { loops, paths } = contours;
      const label = (n, s) => n + ' ' + s + (n === 1 ? '' : 's');
      summary =
        label(loops.length, 'closed outline') +
        ' · ' +
        label(paths.length, 'open path');
    }
    updateStatus();
  }
  function model() {
    contours = entities.length
      ? sketchPaths({ entities })
      : { loops: [], paths: [] };
    view.data(entities, activeRefs(), selected, contours.loops);
    // A large vector drawing can contain thousands of disconnected outlines.
    // Keep the element picker small, with numerical access to every element.
    const first = Math.max(0, selected - 75),
      last = Math.min(entities.length, first + 150);
    list.innerHTML =
      '<option value="-1">Choose element…</option>' +
      entities
        .slice(first, last)
        .map(
          (e, j) =>
            '<option value="' +
            (first + j) +
            '">' +
            esc(labelShape(e, first + j)) +
            '</option>',
        )
        .join('');
    $('[data-sk-jump-label]').hidden = entities.length <= 150;
    $('[data-sk-jump]').max = String(entities.length);
    list.value = String(selected);
    info();
  }
  function properties() {
    for (const b of dialog.querySelectorAll('[data-sk-tool]'))
      b.setAttribute('aria-pressed', String(b.dataset.skTool === tool));
    $('[data-sk-hint]').textContent = hints[tool];
    const entity = active();
    const e = entity && sketchEntityInGrid(entity, gridResolved);
    view.vertex(e?.type === 'path' ? currentVertex : null);
    if (!e) {
      panel.replaceChildren();
      return;
    }
    let inputs = '';
    if (e.points) {
      if (e.type === 'path') {
        currentVertex = Math.min(
          e.points.length - 1,
          Math.max(0, currentVertex),
        );
        inputs +=
          '<label class="sk-number"><span>Vertex</span><input data-sk-vertex type="number" min="1" max="' +
          e.points.length +
          '" value="' +
          (currentVertex + 1) +
          '"><small>/ ' +
          e.points.length +
          '</small></label>';
      }
      const indices =
        e.type === 'path' ? [currentVertex] : e.points.map((_, i) => i);
      for (const i of indices) {
        const prefix =
          e.type === 'path'
            ? 'Vertex'
            : (e.type === 'arc'
                ? ['Start', 'On arc', 'End']
                : ['Start', 'End'])[i];
        inputs +=
          numberField('p' + i + 'x', prefix + ' X', e.points[i][0]) +
          numberField('p' + i + 'y', prefix + ' Y', e.points[i][1]);
      }
      if (e.type === 'line') {
        const [[ax, ay], [bx, by]] = e.points;
        inputs +=
          numberField('lineLength', 'Length', Math.hypot(bx - ax, by - ay)) +
          numberField(
            'lineAngle',
            'Angle',
            (Math.atan2(by - ay, bx - ax) * 180) / Math.PI,
            '°',
          );
      }
      if (e.type === 'path' && e.points.length >= 3)
        inputs +=
          '<label><input data-sk-closed type="checkbox" ' +
          (e.closed ? 'checked' : '') +
          '> Closed outline</label>';
    } else
      for (const [key, label, unit] of fields[e.type])
        inputs += numberField(key, label, e[key] ?? 0, unit);
    panel.innerHTML =
      '<h3>' +
      esc(selected >= 0 ? labelShape(e, selected) : names[tool]) +
      '</h3>' +
      inputs +
      (selected < 0
        ? '<button type="button" data-sk-add>Add at coordinates</button>'
        : '<button type="button" data-sk-delete>Delete element</button>');
  }
  function resetTool(kind, index = -1) {
    backup();
    invalid = '';
    tool = kind;
    pickGrid = null;
    selected = index;
    draft =
      kind === 'select'
        ? null
        : sketchEntityOnPlane(template(kind), gridResolved);
    pending = [];
    chainStart = null;
    cursor = null;
    currentVertex = 0;
    canvas.style.cursor = kind === 'select' ? 'default' : 'crosshair';
    if (index >= 0 && !list.querySelector('option[value="' + index + '"]'))
      model();
    list.value = String(index);
    $('[data-sk-jump]').value = index < 0 ? '' : String(index + 1);
    view.select(index);
    view.guide(null, null);
    updateGrid(false);
    properties();
    updateStatus();
  }
  function commitShape(e) {
    const next = [...entities, e];
    validateSketch({ entities: next });
    saveEntities(next);
    invalid = '';
    selected = next.length - 1;
    model();
  }
  function drawnInGrid(points) {
    const local = drawn(
      tool,
      points.map((p) => planeToGrid(gridResolved, p)),
      draft && sketchEntityInGrid(draft, gridResolved),
    );
    return local ? sketchEntityOnPlane(local, gridResolved) : null;
  }
  function refreshGuide(p) {
    cursor = p;
    const last = pending.at(-1);
    let guide = null;
    if (!pickGrid && tool !== 'select' && p) {
      try {
        const e = drawnInGrid([...pending, p]);
        if (e) guide = { ...sketchElementPath(e), entity: e };
      } catch {
        /* The next point can complete a transient zero-width shape. */
      }
      if (!guide && last) guide = { points: [...pending, p], closed: false };
    }
    view.guide(guide, last);
    const local = p && planeToGrid(gridResolved, p);
    $('[data-sk-position]').textContent = local
      ? 'X ' +
        Number(local[0].toFixed(3)) +
        ' · Y ' +
        Number(local[1].toFixed(3)) +
        ' mm'
      : '';
  }
  function click(p, hit, target) {
    if (pickGrid === 'origin') {
      setGrid({ origin: [...p], placement: 'custom' });
      return;
    }
    if (pickGrid === 'axis') {
      if (!target?.edge) {
        updateStatus('Click closer to a straight edge on the face or sketch.');
        return;
      }
      const [a, b] = target.edge;
      const angle = gridAxisAngle(a, b);
      if (angle != null) setGrid({ angle });
      return;
    }
    if (tool === 'select') {
      resetTool('select', hit ?? -1);
      return;
    }
    const needed = tool === 'arc' ? 3 : tool === 'lProfile' ? 1 : 2;
    if (pending.length < needed - 1) {
      if (tool === 'line') chainStart = p;
      pending.push(p);
      refreshGuide(p);
      return;
    }
    try {
      const e = drawnInGrid([...pending, p]);
      if (!e) return;
      commitShape(e);
      if (tool === 'line') {
        if (chainStart && near(chainStart, p)) {
          resetTool('select', selected);
          return;
        }
        pending = [p];
        selected = -1;
        list.value = '-1';
        view.select(-1);
        properties();
        refreshGuide(p);
      } else resetTool('select', selected);
    } catch (error) {
      invalid = error.message;
      updateStatus();
    }
  }
  function patchEntity(input) {
    const entity = active();
    if (!entity) return;
    const e = sketchEntityInGrid(entity, gridResolved);
    let edited = { ...e };
    // Read the whole form, including other still-focused or invalid fields.
    if (e.points) edited.points = e.points.slice();
    for (const field of panel.querySelectorAll('input[data-key]')) {
      const key = field.dataset.key,
        v = field.valueAsNumber;
      if (!Number.isFinite(v))
        throw Error('Enter a number for each dimension.');
      if (key === 'lineLength' || key === 'lineAngle') continue;
      const p = key.match(/^p(\d+)([xy])$/);
      if (p) {
        const i = Number(p[1]);
        edited.points[i] = [...edited.points[i]];
        edited.points[i][p[2] === 'x' ? 0 : 1] = v;
      } else edited[key] = v;
    }
    if (e.type === 'line') {
      if (['lineLength', 'lineAngle'].includes(input.dataset.key)) {
        const length = panel.querySelector(
          '[data-key=lineLength]',
        ).valueAsNumber;
        if (length <= 0) throw Error('Enter a positive line length.');
        const angle =
          (panel.querySelector('[data-key=lineAngle]').valueAsNumber *
            Math.PI) /
          180;
        const [x, y] = edited.points[0];
        edited.points[1] = [
          x + length * Math.cos(angle),
          y + length * Math.sin(angle),
        ];
        panel.querySelector('[data-key=p1x]').value = display(
          edited.points[1][0],
        );
        panel.querySelector('[data-key=p1y]').value = display(
          edited.points[1][1],
        );
      } else {
        const [[ax, ay], [bx, by]] = edited.points;
        panel.querySelector('[data-key=lineLength]').value = display(
          Math.hypot(bx - ax, by - ay),
        );
        panel.querySelector('[data-key=lineAngle]').value = display(
          (Math.atan2(by - ay, bx - ax) * 180) / Math.PI,
        );
      }
    }
    if (input.matches('[data-sk-closed]')) edited.closed = input.checked;
    edited = sketchEntityOnPlane(edited, gridResolved);
    sketchElementPath(edited);
    if (selected >= 0) {
      editStart ??= snapshot();
      const next = entities.slice();
      next[selected] = edited;
      validateSketch({ entities: next });
      entities = next;
      invalid = '';
      model();
    } else {
      draft = edited;
      invalid = '';
      updateStatus();
      if (cursor) refreshGuide(cursor);
    }
  }
  async function importFile(file) {
    if (!file) return;
    try {
      const imported = importSketchDrawing(await file.text(), file.name);
      if (closed) return;
      const next = [
        ...entities,
        ...imported.entities.map((e) => sketchEntityOnPlane(e, gridResolved)),
      ];
      validateSketch({ entities: next });
      saveEntities(next);
      resetTool('select', next.length - 1);
      model();
      view.fit();
      if (imported.warnings.length) updateStatus(imported.warnings.join(' '));
    } catch (error) {
      if (!closed) {
        updateStatus(error.message);
        status.classList.add('sk-error');
      }
    }
  }
  dialog.showModal();
  updateGrid();
  const densityLabel = $('[data-sk-density]');
  let shownSpacing = 0;
  view = sketchCanvas(canvas, {
    click,
    move: refreshGuide,
    hover: () => !!pickGrid || tool !== 'select',
    grid: () => gridResolved,
    gridPick: () => pickGrid,
    gridDensity(spacing) {
      if (spacing === shownSpacing) return;
      shownSpacing = spacing;
      densityLabel.hidden = !spacing;
      densityLabel.textContent = spacing
        ? 'Grid lines shown every ' + display(spacing) + ' mm'
        : '';
    },
    snap: () => snap.checked,
  });
  function undoEdit(backward) {
    backup();
    const stack = backward ? undo : redo,
      other = backward ? redo : undo;
    if (!stack.length) return;
    other.push(snapshot());
    const before = stack.pop();
    entities = before.entities;
    gridConfig = before.gridConfig;
    planeInput.value = before.plane;
    plane = before.plane;
    updateGrid();
    resetTool('select');
    model();
  }
  dialog.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.hasAttribute('data-sk-zero')) pickDatum('origin');
      else if (b.hasAttribute('data-sk-align')) pickDatum('axis');
      else if (b.hasAttribute('data-sk-reverse'))
        setGrid({ angle: (gridConfig.angle + 180) % 360 });
      else if (b.hasAttribute('data-sk-exact')) {
        const pitch = exactGridPitch(activeRefs(), gridConfig.angle);
        if (pitch == null || pitch < 0.001) {
          updateStatus(
            'These extents do not have an exact fit at 0.001 mm precision. Choose a pitch and keep equal edge margins.',
          );
          return;
        }
        setGrid({ pitch, placement: 'corner' });
      } else if (b.hasAttribute('data-sk-tool')) resetTool(b.dataset.skTool);
      else if (b.hasAttribute('data-sk-add')) {
        if (invalid) return;
        commitShape(draft);
        resetTool('select', selected);
        view.fit();
      } else if (b.hasAttribute('data-sk-delete')) {
        saveEntities(entities.filter((_, i) => i !== selected));
        resetTool('select');
        model();
      } else if (b.hasAttribute('data-sk-project')) {
        const next = [
          ...entities,
          ...activeRefs().map((points) => ({
            type: 'path',
            points: points.map((p) => p.slice()),
            closed: true,
          })),
        ];
        validateSketch({ entities: next });
        saveEntities(next);
        resetTool('select', next.length - 1);
        model();
      } else if (b.hasAttribute('data-sk-fit')) view.fit();
      else if (b.hasAttribute('data-sk-undo')) undoEdit(true);
      else if (b.hasAttribute('data-sk-redo')) undoEdit(false);
      else if (b.hasAttribute('data-sk-import')) $('[data-sk-file]').click();
      else if (b.hasAttribute('data-sk-cancel')) dialog.close();
      else if (b.hasAttribute('data-sk-finish')) {
        if (finish.disabled) return;
        result = {
          entities,
          grid: gridConfig,
          plane: planeInput.value,
          offset: offsetInput.valueAsNumber,
          name: nameInput.value.trim(),
        };
        validateSketch(result);
        dialog.close();
      }
    } catch (error) {
      invalid = error.message;
      updateStatus();
    }
  });
  list.onchange = () => resetTool('select', Number(list.value));
  $('[data-sk-jump]').onchange = (event) => {
    const value = event.target.valueAsNumber;
    if (Number.isInteger(value) && value >= 1 && value <= entities.length)
      resetTool('select', value - 1);
  };
  panel.addEventListener('input', (event) => {
    const input = event.target;
    if (input.matches('[data-sk-vertex]')) return;
    try {
      patchEntity(input);
    } catch (error) {
      invalid = error.message;
      updateStatus();
    }
  });
  panel.addEventListener('change', (event) => {
    if (event.target.matches('[data-sk-vertex]')) {
      currentVertex = Math.min(
        active().points.length - 1,
        Math.max(0, (event.target.valueAsNumber || 1) - 1),
      );
      currentVertex = Math.round(currentVertex);
      properties();
    } else {
      backup();
      updateStatus();
    }
  });
  nameInput.oninput = offsetInput.oninput = () => updateStatus();
  planeInput.onchange = () => {
    // A workplane change is its own undo step; otherwise undoing the next
    // drawing step would also switch the workplane back.
    history({ entities, gridConfig, plane });
    planeGrids.set(plane, gridConfig);
    plane = planeInput.value;
    gridConfig = planeGrids.get(plane) ?? defaultSketchGrid(activeRefs());
    updateGrid();
    resetTool('select', selected);
    view.data(entities, activeRefs(), selected, contours.loops);
    view.fit();
    updateStatus();
  };
  gridInput.oninput = () => {
    const p = gridInput.valueAsNumber;
    gridInputInvalid = !Number.isFinite(p) || p < 0.001;
    if (gridInputInvalid) {
      updateStatus();
      return;
    }
    if (gridConfig.pitch !== p) setGrid({ pitch: p }, { writePitch: false });
    else updateStatus();
  };
  gridPlacement.onchange = () => {
    if (gridPlacement.value === 'custom') {
      gridPlacement.value = gridConfig.placement;
      pickDatum('origin');
    } else setGrid({ placement: gridPlacement.value });
  };
  snap.onchange = () => setGrid({ snap: snap.checked }, { writePitch: false });
  gridVisible.onchange = () =>
    setGrid({ visible: gridVisible.checked }, { writePitch: false });
  $('[data-sk-file]').onchange = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    importFile(file);
  };
  dialog.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undoEdit(!e.shiftKey);
    } else if (e.key === 'Enter' && pending.length) {
      e.preventDefault();
      resetTool('select', entities.length - 1);
    }
  });
  dialog.addEventListener('cancel', (event) => {
    if (pickGrid) {
      event.preventDefault();
      pickGrid = null;
      updateGrid(false);
      updateStatus();
    } else if (pending.length) {
      event.preventDefault();
      resetTool('select', entities.length - 1);
    }
  });
  const finished = new Promise((resolve) =>
    dialog.addEventListener('close', () => resolve(result), { once: true }),
  );
  try {
    model();
    resetTool('select', entities.length === 1 ? 0 : -1);
    view.fit();
    if (error) {
      updateStatus(error);
      status.classList.add('sk-error');
    }
    if (importFirst) $('[data-sk-file]').click();
    return await finished;
  } finally {
    closed = true;
    view.dispose();
    dialog.remove();
  }
}
