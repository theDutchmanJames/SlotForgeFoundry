import {
  Box,
  House,
  Route,
  Layers,
  Download,
  Save,
  FolderOpen,
  Undo2,
  Redo2,
  FileUp,
  Eye,
  EyeOff,
  Scan,
  Compass,
  SquareSplitHorizontal,
  Ruler,
  MousePointer2,
  SlidersHorizontal,
  PackageOpen,
  Scissors,
  Move3d,
  ChevronDown,
  Check,
  Grid2X2,
  Plus,
  RotateCcw,
  TriangleAlert,
  Paintbrush,
  ArrowUpRight,
  FileBox,
  Focus,
  Waypoints,
  X,
  Info,
  PencilRuler,
  Cylinder,
  Rotate3d,
  Spline,
  Layers2,
  CircleDot,
  Blend,
  LibraryBig,
  Pencil,
  CarFront,
  Fence,
} from 'lucide';

export const navigationHint =
  'Drag to orbit · Middle-drag to pan · Scroll to zoom';

const symbols = {
  box: Box,
  home: House,
  track: Route,
  layers: Layers,
  export: Download,
  save: Save,
  open: FolderOpen,
  undo: Undo2,
  redo: Redo2,
  import: FileUp,
  eye: Eye,
  eyeoff: EyeOff,
  fit: Scan,
  view: Compass,
  section: SquareSplitHorizontal,
  measure: Ruler,
  select: MousePointer2,
  settings: SlidersHorizontal,
  kit: PackageOpen,
  split: Scissors,
  move: Move3d,
  down: ChevronDown,
  check: Check,
  plate: Grid2X2,
  plus: Plus,
  reset: RotateCcw,
  warning: TriangleAlert,
  arrow: ArrowUpRight,
  part: FileBox,
  focus: Focus,
  join: Waypoints,
  markings: Paintbrush,
  close: X,
  info: Info,
  sketch: PencilRuler,
  extrude: Cylinder,
  revolve: Rotate3d,
  sweep: Spline,
  loft: Layers2,
  hole: CircleDot,
  edge: Blend,
  pattern: Grid2X2,
  library: LibraryBig,
  pencil: Pencil,
  car: CarFront,
  trackside: Fence,
};
export function icon(name) {
  return (
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (symbols[name] || [])
      .map(
        ([tag, at]) =>
          '<' +
          tag +
          ' ' +
          Object.entries(at)
            .filter(([k]) => k !== 'key')
            .map(([k, v]) => k + '="' + v + '"')
            .join(' ') +
          '/>',
      )
      .join('') +
    '</svg>'
  );
}
export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
export function button(action, label, glyph, cls = '') {
  return (
    '<button type="button" data-action="' +
    action +
    '" class="' +
    cls +
    '">' +
    (glyph ? icon(glyph) : '') +
    '<span>' +
    esc(label) +
    '</span></button>'
  );
}
export function tool(action, label, glyph) {
  return (
    '<button type="button" class="icon-button" data-action="' +
    action +
    '" aria-label="' +
    esc(label) +
    '" title="' +
    esc(label) +
    '">' +
    icon(glyph) +
    '</button>'
  );
}
export const fmt = (value) =>
  Number.isFinite(value)
    ? Number(value.toFixed(2)).toLocaleString('en-US', {
        maximumFractionDigits: 2,
      })
    : '—';
export function field(key, label, value, unit = 'mm', opts = {}) {
  return (
    '<label class="field"><span>' +
    esc(label) +
    '</span><span class="input-wrap"><input type="number" name="' +
    key +
    '" value="' +
    esc(value) +
    '" step="' +
    (opts.step ?? 'any') +
    '" ' +
    (opts.min != null ? 'min="' + opts.min + '"' : '') +
    (opts.max != null ? ' max="' + opts.max + '"' : '') +
    (opts.optional
      ? ' placeholder="' + esc(opts.placeholder ?? '') + '"'
      : ' required') +
    '><small>' +
    esc(unit) +
    '</small></span></label>'
  );
}
export function choice(key, label, value, options) {
  return (
    '<label class="field"><span>' +
    esc(label) +
    '</span><select name="' +
    key +
    '">' +
    options
      .map(
        ([k, v]) =>
          '<option value="' +
          esc(k) +
          '" ' +
          (value === k ? 'selected' : '') +
          '>' +
          esc(v) +
          '</option>',
      )
      .join('') +
    '</select></label>'
  );
}
export function check(key, label, checked) {
  return (
    '<label class="check"><input type="checkbox" name="' +
    key +
    '" ' +
    (checked ? 'checked' : '') +
    '>' +
    esc(label) +
    '</label>'
  );
}
export function details(label, body, open = false, readout = '') {
  return (
    '<details ' +
    (open ? 'open' : '') +
    '><summary>' +
    '<span>' + esc(label) + '</span>' +
    (readout ? '<small data-property-readout="' + esc(readout) + '"></small>' : '') +
    icon('down') +
    '</summary><div class="details-body">' +
    body +
    '</div></details>'
  );
}

export const BRAND_SLOGAN = 'FORGED LAYER BY LAYER';

export function shell() {
  const brandIcon = new URL('../assets/slotforge-foundry.svg?inline', import.meta.url);
  // Light lettering for the dark theme, dark lettering for the light one.
  const wordmark = new URL('../assets/brand/foundry-dark.svg?inline', import.meta.url);
  const wordmarkLight = new URL('../assets/brand/foundry-light.svg?inline', import.meta.url);
  // The SlotForge App Collection mark, bottom right like the other apps.
  const collectionMark = new URL('../assets/brand/slotforge-dark.svg?inline', import.meta.url);
  const collectionMarkLight = new URL('../assets/brand/slotforge-light.svg?inline', import.meta.url);
  return `<header class="appbar">
  <div class="brand" role="img" aria-label="SlotForge Foundry"><img class="brand-icon" src="${esc(brandIcon.href)}" width="42" height="42" alt=""><span class="brand-copy"><span class="brand-wordmark"><img class="wm-dark" src="${esc(wordmark.href)}" width="590" height="89" alt=""><img class="wm-light" src="${esc(wordmarkLight.href)}" width="590" height="89" alt=""></span><small>${BRAND_SLOGAN}</small></span></div>
  <nav aria-label="Workspaces and library">${button('mode-home', 'Home', 'home')}${button('mode-track', 'Track Set', 'layers')}${button('mode-planner', 'Track Planner', 'track')}${button('mode-editor', 'STL Edit', 'box')}<button type="button" data-action="mode-library" aria-pressed="false">${icon('library')}<span>Library</span></button><button type="button" data-action="mode-settings" aria-pressed="false" title="Settings">${icon('settings')}<span>Settings</span></button></nav>
  <div class="app-actions" role="group" aria-label="Project files"><button type="button" class="quiet" data-action="open" title="Open project or model" aria-label="Open project or model">${icon('open')}<span>Open</span></button>${button('save', 'Save', 'save', 'quiet')}<i aria-hidden="true"></i>${button('export-menu', 'Export STLs', 'export', 'primary')}<span class="tone-switch" role="group" aria-label="Theme"><button type="button" data-action="theme-light" aria-pressed="false" title="Light theme">☼ Light</button><button type="button" data-action="theme-dark" aria-pressed="true" title="Dark theme">☾ Dark</button></span></div>
</header>
<main class="workspace"><aside id="project-panel" class="sidebar" aria-label="Workspace tools, parts and history">
<div class="creation-panel"><div class="side-header"><h2 id="creation-label">Create track</h2><button type="button" id="project-close" class="icon-button" aria-label="Close tools and parts">${icon('close')}</button></div><div id="pack-rail" hidden></div><div class="creation-actions">${button('new-custom', 'Track packs', 'layers')}${button('new-design', 'New design', 'plus')}${button('import-context', 'Import Circuit', 'import')}</div></div>
<div id="workspace-nav" hidden></div>
<div class="section-label parts-heading"><span id="parts-heading">Assembly</span><span id="part-count"></span></div><div id="parts"></div><div id="history"></div><div class="side-fill"></div><button class="plate-card" data-action="plate"><span class="plate-icon">${icon('plate')}</span><span><small>Print plate</small><b id="plate-size">200 × 200 mm</b></span>${icon('settings')}</button></aside>
<section class="stage"><div class="stage-head"><button type="button" id="project-toggle" class="outline" aria-expanded="false" aria-controls="project-panel">${icon('layers')} Tools &amp; parts</button><div class="stage-heading"><h1 id="model-title"></h1><button type="button" id="rename-project" data-action="rename" title="Rename project"><span id="project-name"></span>${icon('pencil')}</button></div><div class="history-actions" role="group" aria-label="Edit history">${tool('undo', 'Undo', 'undo')}${tool('redo', 'Redo', 'redo')}</div><span id="stl-link" class="stl-link" hidden></span>${button('save-stl-part', 'Save to Library', 'library', 'secondary')}</div>
<div id="track-sections"></div>
<div id="canvas-wrap"><div id="viewport"></div>
<div class="track-selection" role="group" aria-label="Selected track part"><button type="button" class="part-location" data-action="reveal-selected" title="Show selected part in assembly" aria-label="Show selected part in assembly">${icon('part')}<span id="track-name-slot"></span>${icon('down')}</button>${button('edit-part', 'Edit as STL', 'arrow', 'part-transfer')}</div>
<div class="view-style"><span class="status-dot"></span><span id="view-model-state">Solid view</span><button type="button" data-action="view-fit-warning" hidden>View warning</button></div>
<div id="face-actions" hidden></div><div id="view-tools"><button type="button" data-action="scale-car" aria-pressed="false" aria-controls="scale-car-panel" title="Place a scale car on the track" hidden>${icon('car')} Scale car</button>${tool('pick', 'Select surface or part', 'select')}${tool('measure', 'Measure two points', 'measure')}<i></i>${tool('fit', 'Fit all', 'fit')}</div>
<div class="canvas-foot"><span class="axis"><b>X</b><b>Y</b><b>Z</b></span><span id="view-hint">${navigationHint}</span></div><div id="model-info"></div></div>
<div class="part-summary"><div id="editor-selection-meta">${icon('part')}<strong id="selected-name">—</strong></div><div class="dimensions"><small>Dimensions · X × Y × Z</small><strong id="selected-size">—</strong></div><button type="button" id="move-selected" data-open-tool="transform" class="part-output" aria-label="Move selected part" title="Move selected part" hidden>${icon('move')}<span>Move</span></button><button data-action="plate" class="fit-result" id="fit-result"></button></div></section>
<aside class="inspector" aria-label="Tool settings"><div id="inspector"></div></aside></main>
<main id="track-planner" hidden aria-label="Track Planner"></main><main id="home" hidden aria-label="Home"></main><main id="library-page" hidden aria-label="Library"></main><main id="settings-page" hidden aria-label="Settings"></main>
<footer class="statusbar"><span id="status" role="status">Opening workbench…</span><button type="button" id="cancel-work" hidden>Cancel calculation</button><span id="mesh-info"></span><span class="units">mm</span><span class="sf-footer-brand"><img class="wm-dark" src="${esc(collectionMark.href)}" width="621" height="90" alt="SlotForge App Collection"><img class="wm-light" src="${esc(collectionMarkLight.href)}" width="621" height="90" alt="SlotForge App Collection"></span></footer>
<div id="notice" role="alert" hidden></div><dialog id="dialog"><div id="dialog-content"></div></dialog><input id="file" type="file" hidden>`;
}

export function setupProjectPanel() {
  const panel = document.getElementById('project-panel');
  const toggle = document.getElementById('project-toggle');
  const close = document.getElementById('project-close');
  const compact = matchMedia('(max-width: 830px)');
  function setOpen(open, returnFocus = false) {
    panel.classList.toggle('project-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) close.focus();
    else if (returnFocus && compact.matches) toggle.focus();
  }
  toggle.addEventListener('click', () =>
    setOpen(!panel.classList.contains('project-open')),
  );
  close.addEventListener('click', () => setOpen(false, true));
  panel.addEventListener('click', (event) => {
    if (
      compact.matches &&
      event.target.closest(
        '#workspace-nav button, .creation-actions button, [data-part], #parts [data-tab], [data-op]',
      )
    )
      setOpen(false, true);
  });
  compact.addEventListener('change', () => setOpen(false));
  document.addEventListener('pointerdown', (event) => {
    if (
      panel.classList.contains('project-open') &&
      !panel.contains(event.target) &&
      !toggle.contains(event.target)
    )
      setOpen(false);
  });
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key === 'Escape' &&
        panel.classList.contains('project-open') &&
        !document.querySelector('dialog[open]')
      ) {
        setOpen(false, true);
        event.stopPropagation();
      }
    },
    true,
  );
}
