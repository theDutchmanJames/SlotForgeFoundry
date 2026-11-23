import './theme.css';
import './style.css';
import './editor-tools.css';
import './property-panel.css';
import { replacePropertyPanel, syncPropertyReadouts } from './property-panel.js';
import { version as appVersion } from '../package.json';
import EngineWorker from './engine.worker.js?worker&inline';
import { Viewport } from './viewport.js';
import { profileWarnings } from './import-profile.js';
import { mountSectionView } from './section-control.js';
import { mountScaleCar } from './scale-car-control.js';
import { mountViewSelector } from './view-selector.js';
import { mountGridControls } from './workplane-grid-controls.js';
import {
  pickedGridSurface,
  savedGridSurface,
  gridCameraFrame,
} from './workplane-grid.js';
import { defaultSketchGrid } from './sketch-grid.js';
import { assemblyTab } from './assembly-controls.js';
import {
  newProject,
  checkProject,
  cleanName,
  isFlatCrossingProject,
  printsFaceUp,
  toBase64,
  autosave,
  recover,
  activeOps,
  keepUnopened,
  readUnopened,
} from './project.js';
import {
  shell,
  setupProjectPanel,
  button,
  tool,
  icon,
  esc,
  fmt,
  field,
  navigationHint,
} from './ui.js';
import {
  trackInspector,
  sectionForField,
  syncPitAssemblyNotes,
  trackNavigation,
  editorInspector,
  editorNavigation,
  faceActions,
  faceInstruction,
  selectionTitle,
  isFaceTool,
  syncFaceLevels,
  syncOperationControls,
  surfaceNote,
} from './inspector.js';
import { plateDiagram } from './plate-preview.js';
import { clipChoices, jointFitDiagram, jointsClipDiagram } from './joint-controls.js';
import { KEEPER_TOOL_FILENAME } from './keeper-tool-stl.js';
import { resolveJointFit } from './geometry/joint-fit.js';
import { clipTypeFromSTL } from './geometry/fork-clip.js';
import { SCREW_SIDE_FIELDS } from './geometry/screw-clip.js';
import { fitPlate } from './geometry/plate.js';
import { defaultTrack, jointSampleChoices } from './track.js';
import { openCustomTrackEditor } from './custom-track-editor.js';
import { openTrackPieceCreator } from './track-piece-creator.js';
import {
  applyThemeState,
  loadTheme,
  paletteOf,
  read as readTheme,
  saveTheme,
  STORAGE_KEY as THEME_STORAGE_KEY,
} from './app-theme.js';
import { packSpecialTrack, SPECIAL_SHORT_NAMES, specialsFor } from './pack-specials.js';
import { specialName } from './special-piece-controls.js';
import { borderRunLength, readTrackShapeFields, suggestedSpacing, syncTrackShapeControls } from './track-shape-controls.js';
import {
  applySlotLanes,
  applySlotMode,
  packApplyNotice,
  packRuleSlotNote,
  showSlotAdvice,
  slotFieldDependencies,
  slotFieldToFocus,
  slotPositionAllowed,
  slotRestoreValues,
  snapSlotField,
} from './slot-position-controls.js';
import { normaliseSlotPosition } from './slot-position.js';
import { gridRestoreValues, gridFieldDependencies, fitUneditedPitGrid } from './starting-grid-controls.js';
import { showFlatImport } from './flat-import-dialog.js';
import { refreshCustomTrack } from './custom-track.js';
import { renderBridgeProfiles } from './bridge-view.js';
import {
  groupTrackParts,
  toggleGroupVisibility,
  trackPartsMarkup,
} from './track-parts.js';
import './track-parts.css';
import { openTrackLibrary } from './library-store.js';
import { createHome } from './home.js';
import { askUser, createLibraryPage } from './library-page.js';
import {
  loadSettings,
  saveSettings,
  renderSettings,
  readSettingsForm,
  syncThemeSettings,
} from './settings.js';
import './settings.css';
import { createPlanner } from './planner-workspace.js';
import { showTrackLibrary } from './library-dialog.js';
import {
  SHARED_PROFILE_FIELDS,
  profileFromTrack,
  starterPack,
  trackWithProfile,
} from './library-profile.js';
import { COLLECTION_RULE_FIELDS, packRuleSlotChanges } from './library-database.js';
import { pieceDetail, sharedLabels, trackThumbnail } from './library-view.js';
import { changeJointCount, parseConnectionControls, syncJointCountControls } from './connection-controls.js';
import { editConnectorPlacement } from './connector-placement.js';
import { createWorkerClient } from './worker-client.js';
import { editSurface, reviewSTL } from './mesh-workbench.js';
import { mountBorderHandles } from './border-handles.js';
import { braidStyleChoices, profileDiagram } from './connection-controls.js';
import { sharedPaintFields, syncCentreSlotNote, syncPaintControls } from './paint-controls.js';
import { createLivePreview } from './live-preview.js';
import { createModelGuides } from './model-guides.js';
import { bindSizeControls } from './resize-part.js';
import { faceTrimMetrics } from './face-trim.js';
import { shapeOutline } from './geometry/shape-profile.js';
import { solidToolOperation, updateSilhouette } from './solid-tool-controls.js';
import { editSketch } from './create-sketch.js';
import { importSketchDrawing } from './create-sketch-data.js';
import { createSolidOperation } from './create-solid-controls.js';
import {
  isHoleRim,
  holeModifyOperation,
  updateHoleModifyControls,
} from './hole-modify.js';
import {
  healStretchOperation,
  updateHealStretchControls,
} from './heal-stretch.js';
import { sameFinishEdge } from './geometry/wall-edge-modify.js';
import { edgesForScope } from './wall-edge-modify-controls.js';
import {
  edgeNearHit,
  mountPickHint,
  toggleMember,
} from './modify-selection.js';
import {
  featureOperation,
  updateFeatureControls,
} from './create-feature-controls.js';
import {
  isSolidTool,
  isFeatureTool,
  featureTab,
  workplane,
  workplaneLabels,
  materializeSketch,
  sketchLines,
  solidNames,
} from './design.js';
import { extrusionGuide } from './design-guides.js';
import { defaultHolePlacement, dot3 } from './geometry/feature-selection.js';
import {
  composeFaceSelection,
  updateFaceSelection,
  sameSelectedFace,
  matchesSavedFaceOutline,
  faceProfiles,
  planFaceHeights,
} from './face-selection.js';
import './workbench.css';
// The SlotForge update check (desktop app only; nothing happens in a browser).
import './update-basics.css';
import './update-window.css';
import './update-ui.js';

const $ = (s) => document.querySelector(s);
$('#app').innerHTML = shell();
setupProjectPanel();
let cancelTimer, unmountHandles;
const { call, stop, promote } = createWorkerClient(
  () => {
    const worker = new EngineWorker();
    worker.postMessage({ type: 'viewport', webgl: Boolean(stage.renderer) });
    return worker;
  },
  () => project,
  (count) => {
    clearTimeout(cancelTimer);
    if (!count) $('#cancel-work').hidden = true;
    else
      cancelTimer = setTimeout(() => {
        $('#cancel-work').hidden = false;
      }, 1200);
  },
);
$('#cancel-work').onclick = () => stop();

// A new project starts with the print plate chosen in Settings.
const freshProject = () => ({ ...newProject(), plate: { ...loadSettings().plate } });
let project = freshProject(),
  parts = [],
  selected = '',
  region = null,
  art = null,
  history = [],
  future = [],
  hidden = new Set();
const expandedPartGroups = new Set();
let trackPartGroups = [];
// The 3D guides were drawn per old tab. Markings and Print borrow the guides
// of the tab their setting came from.
const BORDER_FIELDS = /^(whiteLineBorder|borderLineGroove|kerbEdge|kerbSide|borderSegments)$/;
const SHARED_KERB_FIELDS = /^(kerbWidth|kerbLength|kerbGroove|grooveWidth|grooveDepth)$/;
function guideTab(tab, field, p) {
  if (tab === 'markings' || tab === 'print') {
    if (BORDER_FIELDS.test(field ?? '')) return 'borders';
    // Kerb sizes are shared: show the guides of the border kerbs when the
    // borders carry kerbs, otherwise those of the road.
    if (SHARED_KERB_FIELDS.test(field ?? '') && (p?.kerbEdge ?? 'none') !== 'none')
      return 'borders';
    return 'geometry';
  }
  return tab;
}
let trackTab = 'geometry',
  editorTab = 'select',
  formKind = null,
  splitKind = 'split',
  axis = 'x',
  editing = null,
  tolerance = 8;
let busy = false,
  pickMode = 'select',
  measurePoints = [],
  fileIntent = '',
  noticeTimer,
  saveChain = Promise.resolve(),
  pickGeneration = 0;
let inAction = false,
  starting = true,
  formDrafts = new Map(),
  measurePart = '';
let shownDraft = null,
  activeTrial = null,
  toolArmed = false,
  newEditId;
let historyInput = null,
  displayedHistory = null;
let pickSeed = null,
  selectedFaces = [],
  extendPicks = false,
  selectionReplaced = false,
  selectionQueue = Promise.resolve(),
  queuedRepick = null,
  angleGeneration = 0,
  repickTimer,
  repickError = null;
let formBaselines = {},
  trackFields = new Map(),
  trackBaselines = new Map(),
  previousTrackFields = new Map();
let focusedField = '',
  liveState = 'idle',
  activeWarning = null;
let dialogPlate = null,
  dialogPlateFit = null;
let savedState = 'Local workspace';
let activeSketchId = null,
  finishEdge = null,
  pickedEdges = [],
  previewFitId = null;
const creationDefaults = new Map();
const sketchCache = new WeakMap();
let sketchPlacements = new Map();
function sketchRecord(op) {
  if (!sketchCache.has(op))
    sketchCache.set(op, {
      ...materializeSketch(op),
      planeLabel: workplaneLabels[op.plane],
      target: op.target,
    });
  const sketch = sketchCache.get(op);
  return sketchPlacements.has(op.id)
    ? { ...sketch, frame: sketchPlacements.get(op.id) }
    : sketch;
}
// Earlier steps a new or revised step can build on. Switched-off steps are not
// replayed, so their sketches and features are not offered.
function availableOps() {
  const ops = project.editor.ops;
  const earlier = editing
    ? ops.slice(
        0,
        ops.findIndex((op) => op.id === editing),
      )
    : ops;
  return activeOps({ ...project.editor, ops: earlier });
}
function creationContext() {
  const ops = availableOps(),
    sketches = ops.filter((op) => op.type === 'sketch').map(sketchRecord);
  return {
    sketches,
    parts: historyInput?.parts ?? parts,
    selectedId: selected,
    sketchId:
      sketches.find((s) => s.id === activeSketchId)?.id ?? sketches.at(-1)?.id,
  };
}
function featureContext(op) {
  const saved =
    selectionReplaced &&
    op &&
    ['edge-finish', 'hole-modify', 'wall-modify'].includes(editorTab)
      ? { ...op, edge: null, edges: [], rims: [], walls: [] }
      : op;
  return {
    region,
    part: toolPart(),
    op: saved,
    ops: availableOps(),
    edge: finishEdge,
    edges: pickedEdges,
    rims: pickedEdges.filter(isHoleRim),
    regions: selectedFaces,
    point: pickSeed?.point,
    selectedId: selected,
  };
}
function syncFeatureForm(form, op) {
  if (editorTab === 'hole-modify') updateHoleModifyControls(form);
  else if (editorTab === 'stretch-section' || editorTab === 'heal-feature')
    updateHealStretchControls(form, featureContext(op));
  else updateFeatureControls(form, featureContext(op));
}
function activeEdgeScope() {
  return $('#settings-form [name="edgeScope"]')?.value ?? 'corner';
}
async function nearFinishEdge(part, seed, pixels = 18) {
  if (!part) return null;
  const tolerance =
    (pixels * stage.span) / (stage.camera.zoom * Math.max(1, stage.cssHeight));
  if (!edgeNearHit(part, seed.triangle, seed.point, tolerance)) return null;
  return call('pickEdge', {
    id: part.id,
    historyId: historyInput?.id,
    triangle: seed.triangle,
    point: seed.point,
    tolerance,
  });
}
let assemblyPeers = new Set(),
  assemblyFaces = new Map(),
  pendingMate = null;
const selectedParts = () => {
  const source = historyInput?.parts ?? parts;
  return [selected, ...assemblyPeers]
    .map((id) => source.find((p) => p.id === id))
    .filter(Boolean);
};
const stage = new Viewport($('#viewport'), picked);
mountPickHint(
  stage,
  () =>
    project.mode === 'editor' &&
    pickMode === 'select' &&
    !busy &&
    !inAction &&
    (historyInput?.parts ?? parts).reduce(
      (count, p) => count + (hidden.has(p.id) ? 0 : p.indices.length),
      0,
    ) <= 300000 &&
    [
      'select',
      'hole-modify',
      'edge-finish',
      'wall-modify',
      'heal-feature',
    ].includes(editorTab),
  async (id, triangle, point) => {
    if (editorTab === 'wall-modify' || editorTab === 'heal-feature')
      return 'Face';
    const part = (historyInput?.parts ?? parts).find((p) => p.id === id);
    const edge = await nearFinishEdge(
      part,
      { triangle, point },
      editorTab === 'select' ? 5 : 18,
    );
    return edge
      ? isHoleRim(edge)
        ? 'Hole rim'
        : edge.circle
          ? 'Circular edge'
          : edge.corner && activeEdgeScope() === 'corner'
            ? 'Rounded corner'
            : 'Edge'
      : 'Face';
  },
);
const scaleCar = mountScaleCar(stage, $('#canvas-wrap'), syncPickTools);
mountSectionView(stage, call, $('#view-tools'), $('#canvas-wrap'), () => scaleCar.close());
const surfaceCache = new WeakMap();
let activeGrid = null;
const viewSelector = mountViewSelector(stage, $('#canvas-wrap'), () =>
  gridCameraFrame(activeGrid),
);
function updateGridView() {
  stage.setFaceGrid(
    activeGrid,
    activeGrid?.config.visible ? activeGrid.resolved : null,
  );
  viewSelector.refresh();
}
const gridControls = mountGridControls(
  $('#view-tools'),
  $('#canvas-wrap'),
  updateGridView,
);
function refreshWorkplane() {
  const editor = project.mode === 'editor';
  const face =
    editor &&
    !editing &&
    !hidden.has(selected) &&
    selectedFaces.length === 1 &&
    selectedFaces[0].planar &&
    selectedFaces[0].seed &&
    selectedFaces[0].loops?.length
      ? selectedFaces[0]
      : null;
  const record =
    editor && !face && activeSketchId
      ? project.editor.ops.find(
          (op) => op.id === activeSketchId && op.type === 'sketch',
        )
      : null;
  if (face) {
    if (!surfaceCache.has(face))
      surfaceCache.set(face, pickedGridSurface(face));
    activeGrid = surfaceCache.get(face);
  } else if (record) {
    const sketch = sketchRecord(record);
    if (surfaceCache.get(record)?.frame !== sketch.frame)
      surfaceCache.set(record, savedGridSurface(record, sketch));
    activeGrid = surfaceCache.get(record);
  } else activeGrid = null;
  gridControls(activeGrid, record, editor);
  updateGridView();
}
const setGuides = createModelGuides($('#viewport'), stage, (changed) => {
  // A plane drag updates X and Y together. Store both fields and schedule a
  // single live model rebuild through the normal inspector input handler.
  for (const field of changed.slice(0, -1)) storeField(field);
  changed.at(-1)?.dispatchEvent(new Event('input', { bubbles: true }));
});
const live = createLivePreview({
  build: (trial) => call('preview', trial.next),
  show(trial, result) {
    if (
      project.mode === 'track' &&
      result.length &&
      !result.some((p) => p.id === trial.selectId)
    ) {
      selected = result[0].id;
      trial = { ...trial, selectId: selected };
    }
    shownDraft = { trial, result };
    const frameFirst =
      trial.op?.type === 'createSolid' &&
      !(historyInput?.parts ?? parts).length &&
      previewFitId !== trial.op.id;
    stage.setParts(result, frameFirst, hidden);
    if (frameFirst) previewFitId = trial.op.id;
    stage.select(trial.selectId, hidden);
    if (project.mode === 'editor' && isFaceTool(editorTab)) {
      stage.setPickSource(
        toolPart(),
        historyInput ? [] : parts.map((p) => p.id),
      );
      if (focusedField === 'tolerance' && region)
        stage.highlightRegions(selected, selectedFaces);
    }
    renderParts(result, trial.selectId);
    livePartCount(result.length);
    updateGuides();
  },
  fail: showDraftError,
});
const current = () => parts.find((p) => p.id === selected);
// While revising an operation, its numerical frame and triangle IDs belong
// to the project immediately before that operation.
function toolPart() {
  return historyInput?.parts.find((part) => part.id === selected) ?? current();
}
function moveProfiles(saved) {
  if (!selectionReplaced && saved?.faces) return saved.faces;
  if (region?.planar) return faceProfiles(region);
  if (!selectionReplaced && saved?.frame && saved?.loops)
    return [{ frame: saved.frame, loops: saved.loops }];
  return [];
}
function movePlan(profiles, mode, value) {
  const part = toolPart();
  return part && profiles.length
    ? planFaceHeights(part.positions, profiles, mode, value)
    : null;
}
function faceMoveState(form, saved) {
  const mode = form?.elements.faceMoveMode?.value;
  if (!mode) return {};
  const profiles = moveProfiles(saved);
  const value = (
    mode === 'height' ? form.elements.faceHeight : form.elements.faceDistance
  ).valueAsNumber;
  return { profiles, mode, value, plan: movePlan(profiles, mode, value) };
}
function trimFrame(part, saved) {
  if (editorTab !== 'trim-top') return region ?? saved?.frame;
  if (!part) return null;
  const { min, max } = part.bounds;
  return {
    origin: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, max[2]],
    normal: [0, 0, 1],
    u: [1, 0, 0],
    v: [0, 1, 0],
  };
}
function refreshFaceActions() {
  refreshWorkplane();
  const strip = $('#face-actions');
  if (
    project.mode === 'editor' &&
    !region &&
    activeSketchId &&
    !editing &&
    pickMode === 'select' &&
    (editorTab === 'select' || isSolidTool(editorTab))
  ) {
    strip.hidden = false;
    strip.innerHTML = ['extrude', 'revolve', 'sweep', 'loft']
      .map(
        (tab) =>
          '<button type="button" data-tab="' +
          tab +
          '" class="' +
          (editorTab === tab ? 'active' : '') +
          '">' +
          icon(tab) +
          '<span>' +
          solidNames[tab] +
          '</span></button>',
      )
      .join('');
    return;
  }
  const editingFaces = editorTab === 'select' || isFaceTool(editorTab);
  strip.hidden = !(
    project.mode === 'editor' &&
    editingFaces &&
    (region || pickedEdges.length) &&
    pickMode === 'select' &&
    !editing
  );
  strip.innerHTML = strip.hidden
    ? ''
    : faceActions(editorTab, region, pickedEdges);
}
// Undo keeps up to 30 projects. The embedded source STL (often megabytes of
// base64) is never changed in place (a new source is a new object), so every
// copy shares it instead of duplicating it.
const clone = (p) => {
  const source = p.editor?.source;
  if (!source) return structuredClone(p);
  const copy = structuredClone({ ...p, editor: { ...p.editor, source: null } });
  copy.editor.source = source;
  return copy;
};
// STL parts saved to the Library, by the model source they were saved from.
const savedStlParts = new WeakMap();
const uid = () =>
  globalThis.crypto.randomUUID?.() ??
  Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
function notice(message) {
  const el = $('#notice');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    el.hidden = true;
  }, 12000);
}
function reportActionError(error) {
  if (error.warning && error.warning === activeWarning) {
    $('#live-status')?.focus();
    return;
  }
  notice(error.message ?? String(error));
}
$('#notice').onclick = () => {
  $('#notice').hidden = true;
};
function status(message) {
  $('#status').textContent = message;
}
function clearPick() {
  finishEdge = null;
  pickedEdges = [];
  region = null;
  selectedFaces = [];
  extendPicks = false;
  selectionReplaced = false;
  pickSeed = null;
  repickError = null;
  queuedRepick = null;
  clearTimeout(repickTimer);
  pickGeneration++;
  stage.clearHighlight();
  measurePoints = [];
  $('#model-info').textContent = '';
}
const draftKey = () =>
  [
    project.mode,
    project.mode === 'track' ? trackTab : editorTab,
    project.mode === 'track'
      ? ''
      : (editing ??
        (assemblyTab(editorTab)
          ? [selected, ...[...assemblyPeers].sort()].join(',')
          : isSolidTool(editorTab)
            ? [selected, activeSketchId].join(',')
            : selected)),
  ].join('|');
// An action is running: other clicks and shortcuts wait their turn. The
// attribute lets tests (and assistive tools) see that Foundry is not idle.
function acting(v) {
  inAction = v;
  document.getElementById('app')?.toggleAttribute('data-acting', v);
}
function lock(v) {
  busy = v;
  $('#app').setAttribute('aria-busy', String(v));
  $('#inspector').inert = v;
  if (v) status('Updating geometry…');
}
function persist() {
  const snapshot = project;
  saveChain = saveChain
    .then(() => autosave(snapshot))
    .then(() => {
      savedState = 'Saved on this device';
      if (!busy) status(savedState);
    })
    .catch(() => {
      savedState = 'Use Save to keep a project file';
      if (!busy) status(savedState);
    });
}
async function rebuild(
  next,
  { record = true, fit = false, selectId, save = true, onError } = {},
) {
  if (busy) return false;
  cancelLive();
  lock(true);
  pickGeneration++;
  try {
    const result = await call('build', next);
    sketchPlacements =
      next.mode === 'editor' && next.editor.ops.some((op) => op.attachment)
        ? new Map(await call('sketchPlacements'))
        : new Map();
    if (record) {
      history.push(project);
      if (history.length > 30) history.shift();
      future = [];
    }
    if (fit) {
      hidden.clear();
      expandedPartGroups.clear();
    }
    formDrafts.clear();
    creationDefaults.clear();
    trackFields.clear();
    trackBaselines.clear();
    previousTrackFields.clear();
    toolArmed = false;
    newEditId = null;
    previewFitId = null;
    project = next;
    if (project.mode === 'editor') {
      editorTab = 'select';
      pickMode = 'select';
      art = null;
      formKind = null;
      editing = null;
    }
    parts = result;
    if (!next.editor.ops.some((op) => op.id === activeSketchId) || parts.length)
      activeSketchId = null;
    if (!parts.length && !activeSketchId)
      activeSketchId = next.editor.ops
        .filter((op) => op.type === 'sketch')
        .at(-1)?.id;
    assemblyPeers.clear();
    assemblyFaces.clear();
    pendingMate = null;
    selected = result.some((p) => p.id === (selectId ?? selected))
      ? (selectId ?? selected)
      : result[0]?.id;
    hidden = new Set(
      [...hidden].filter((id) => parts.some((p) => p.id === id)),
    );
    clearPick();
    if (!record || !editing || !next.editor.ops.some((op) => op.id === editing))
      editing = null;
    const drawing = next.editor.ops.find((op) => op.id === activeSketchId);
    stage.setDesignBounds(
      next.mode !== 'editor'
        ? []
        : drawing
          ? sketchLines(sketchRecord(drawing))
          : [
              [
                [-25, -25, 0],
                [25, 25, 0],
              ],
            ],
    );
    stage.setParts(parts, fit, hidden);
    stage.select(selected, hidden);
    render();
    if (save) persist();
    return true;
  } catch (e) {
    if (onError) onError(e);
    else notice(e.message);
    return false;
  } finally {
    lock(false);
    status(savedState);
  }
}
function renderInspector() {
  $('#move-selected').hidden = !(
    project.mode === 'editor' &&
    editorTab === 'select' &&
    pickMode === 'select' &&
    !activeSketchId &&
    !hidden.has(selected) &&
    toolPart()
  );
  if (
    pendingMate &&
    (project.mode !== 'editor' ||
      editorTab !== 'align-parts' ||
      pickMode === 'measure')
  ) {
    pendingMate = null;
    stage.select(selected, hidden, assemblyPeers);
  }
  if (
    historyInput &&
    (historyInput.project !== project || historyInput.id !== editing)
  ) {
    const oldId = historyInput.id;
    clearPick();
    historyInput = null;
    // A successful build already releases its prefix. On a plain tool switch
    // release it here as well so a large mesh stays live only while editing it.
    void call('forgetHistory', oldId).catch(() => {});
    showCommitted();
  }
  unmountHandles?.();
  unmountHandles = null;
  const op = project.editor.ops.find((o) => o.id === editing);
  const draft = inspectorDraft(formDrafts);
  let defaultTrimAmount, trimDimension, defaultFaceHeight;
  if (project.mode === 'editor') {
    $('#workspace-nav').innerHTML = editorNavigation({
      tab: editorTab,
      measuring: pickMode === 'measure',
      hasParts: !!(historyInput?.parts ?? parts).length,
      hasSketches:
        availableOps().some((op) => op.type === 'sketch') &&
        !(
          activeSketchId &&
          !region &&
          !editing &&
          pickMode === 'select' &&
          (editorTab === 'select' || isSolidTool(editorTab))
        ),
    });
    if (editorTab === 'move-face') {
      const plan = movePlan(moveProfiles(op), 'offset', 0);
      const start = plan?.changes[0]?.start;
      if (Number.isFinite(start)) defaultFaceHeight = Number(start.toFixed(6));
    } else if (editorTab === 'trim-top' || editorTab === 'trim-face') {
      const part = toolPart(),
        frame = trimFrame(part, op);
      if (part && frame) {
        const { face, min } = faceTrimMetrics(
          part.positions,
          frame,
          'remove',
          0,
        );
        defaultTrimAmount = +Math.min(2, (face - min) / 2).toPrecision(6);
        trimDimension =
          Math.abs(frame.normal[2]) > 0.999999
            ? 'Finished height'
            : 'Finished thickness';
      }
    }
  }
  refreshFaceActions();
  const display =
    project.mode === 'track' && draft.kind
      ? {
          ...project,
          track: {
            ...project.track,
            params: { ...project.track.params, kind: draft.kind },
          },
        }
      : project;
  if (project.mode === 'track')
    $('#track-sections').innerHTML = trackNavigation(trackTab);
  replacePropertyPanel(
    $('#inspector'),
    project.mode === 'track'
      ? 'track/' + trackTab + '/' + (project.libraryPiece?.pieceId ?? '')
      : 'editor/' + (pickMode === 'measure' ? 'measure' : editorTab),
    project.mode === 'track'
      ? trackInspector(display, trackTab, draft)
      : editorInspector(editorTab, {
          creation: { ...creationContext(), draft },
          features: { ...featureContext(op), draft },
          activeSketch:
            activeSketchId &&
            project.editor.ops.some((op) => op.id === activeSketchId)
              ? sketchRecord(
                  project.editor.ops.find((op) => op.id === activeSketchId),
                )
              : null,
          assemblyParts: selectedParts(),
          assemblyFaces,
          pendingMate,
          assemblyDraft: draft,
          part: toolPart(),
          region,
          selectionCount:
            selectedFaces.length ||
            (!selectionReplaced && op?.tool === 'move-face'
              ? (op.faceCount ?? 1)
              : 0),
          selectionReplaced,
          extendPicks,
          art,
          op,
          profileKind: draft.profileKind ?? formKind,
          defaultTrimAmount,
          defaultFaceHeight,
          trimDimension,
          splitKind: draft.splitKind ?? splitKind,
          axis: draft.axis ?? axis,
          tolerance: selectedFaces[0]?.boundaryAngle ?? tolerance,
          measuring: pickMode === 'measure',
          distance: distanceMeasured(),
          arc: project.editor.source.arc,
        }),
  );
  const form = $('#settings-form');
  formBaselines = {};
  renderBridgeProfiles($('[data-bridge-profile]'), shownDraft?.result ?? parts);
  const creationKey = draftKey();
  if (isSolidTool(editorTab) && !creationDefaults.has(creationKey))
    creationDefaults.set(creationKey, {});
  for (const el of form?.elements ?? []) {
    if (!el.name) continue;
    formBaselines[el.name] = baselineValue(el, op);
    if (project.mode === 'editor' && isSolidTool(editorTab)) {
      const original = creationDefaults.get(creationKey);
      original[el.name] ??= formBaselines[el.name];
      formBaselines[el.name] = original[el.name];
    }
    if (el.name && el.name in draft) {
      if (el.type === 'checkbox') el.checked = draft[el.name];
      else el.value = draft[el.name];
    }
  }
  syncOperationControls(form, faceMoveState(form, op).plan);
  syncTrackShapeControls(form);
  if (isFeatureTool(editorTab) && form) syncFeatureForm(form, op);
  if (form?.elements.trimMode)
    form.dataset.trimMode = form.elements.trimMode.value;
  if (project.mode === 'editor' && editorTab === 'transform')
    bindSizeControls(form, toolPart());
  addRestoreControls(form);
  if (project.mode === 'track' && formDrafts.has(draftKey())) {
    trackFields.set(draftKey(), values(form, false));
    trackBaselines.set(draftKey(), {
      ...trackBaselines.get(draftKey()),
      ...formBaselines,
    });
  }
  if ($('#border-handles')) {
    const form = $('#settings-form'),
      p = { ...project.track.params };
    for (const el of form.elements) {
      if (el.type === 'number' && Number.isFinite(el.valueAsNumber))
        p[el.name] = el.valueAsNumber;
    }
    for (const side of ['outer', 'inner']) {
      const percent = p[side + 'ApexPercent'];
      if (Number.isFinite(percent)) p[side + 'ApexPosition'] = percent / 100;
    }
    p.borderSide = form.elements.borderSide.value;
    const lengths = {};
    for (const side of ['outer','inner'])
      lengths[side] = borderRunLength(project.track,side);
    try { readTrackShapeFields(values(form,false),{ ...project.track,params:p }); } catch { /* The draft status shows incomplete fields. */ }
    unmountHandles = mountBorderHandles($('#border-handles'), p, (changes) => {
      for (const [k, v] of Object.entries(changes)) {
        const el = form.elements[k];
        if (!el) continue;
        el.value = v;
        storeField(el);
        focusedField = k;
      }
      updateRestoreControls();
      refreshLive();
    }, lengths);
  }
  refreshLive();
}
function render() {
  const track = project.mode === 'track';
  $('.workspace').dataset.mode = project.mode;
  $('#creation-label').textContent = track
    ? project.libraryPiece
      ? 'Track pack'
      : 'Create track'
    : 'Model files';
  renderPackRail(track);
  // STL Edit: Save to Library, and what this part is based on.
  $('[data-action="save-stl-part"]').hidden = track;
  const stlLink = $('#stl-link');
  const linkLabel = track
    ? ''
    : project.stlPart?.source?.label
      ? 'Based on ' + project.stlPart.source.label
      : project.stlPart?.basedOn
        ? 'Edited copy of a Library part'
        : '';
  stlLink.hidden = !linkLabel;
  stlLink.textContent = linkLabel;
  $('#parts-heading').textContent = track ? 'Assembly' : 'Parts';
  $('[data-action="new-custom"]').hidden = !track;
  $('[data-action="new-design"]').hidden = track;
  $('#track-sections').hidden = !track;
  $('#workspace-nav').hidden = track;
  const inactiveNav = track ? $('#workspace-nav') : $('#track-sections');
  if (inactiveNav.childElementCount) inactiveNav.replaceChildren();
  $('.track-selection').hidden = !track;
  $('#editor-selection-meta').hidden = track;
  const nameSlot = track ? $('#track-name-slot') : $('#editor-selection-meta');
  const selectedName = $('#selected-name');
  if (selectedName.parentElement !== nameSlot) nameSlot.append(selectedName);
  // Home and the Planner cover the workspace; only one tab is the current one.
  const inWorkspace = !homeOpen && !planning && !libraryOpen && !settingsOpen;
  $('[data-action="mode-track"]').setAttribute('aria-pressed', String(track && inWorkspace));
  $('[data-action="mode-editor"]').setAttribute('aria-pressed', String(!track && inWorkspace));
  $('#project-name').textContent = project.name;
  $('#model-title').textContent = track
    ? !project.libraryPiece &&
      project.track.sourceName &&
      project.track.params.kind === 'import'
      ? project.track.sourceName
      : project.name
    : project.editor.source.empty
      ? project.name
      : project.editor.source.label;
  const rename = $('#rename-project');
  rename.classList.toggle('name-repeated', $('#model-title').textContent === project.name);
  rename.setAttribute('aria-label', 'Rename project ' + project.name);
  $('[data-action="import-context"] span').textContent = track
    ? 'Import Circuit'
    : 'Open STL';
  $('[data-action="import-context"]').title = track
    ? 'Import a Circuit drawing'
    : 'Open an STL as a new model. Use Add model in Parts to add to this project.';
  $('[data-action="mode-track"]').classList.toggle('active', track && inWorkspace);
  $('[data-action="mode-editor"]').classList.toggle('active', !track && inWorkspace);
  $('[data-action="undo"]').disabled = !history.length;
  $('[data-action="redo"]').disabled = !future.length;
  $('#history').innerHTML =
    !track && project.editor.ops.length
      ? '<div class="section-label">Edit history</div>' +
        project.editor.ops
          .map((op, i) => {
            const off = project.editor.off?.includes(op.id);
            return (
              '<div class="op-line' + (off ? ' off' : '') + '"><button class="op-row" data-op="' +
              esc(op.id) +
              '">' +
              icon('layers') +
              esc(i + 1 + '. ' + op.label) +
              '</button><button class="op-tool" data-op-toggle="' +
              esc(op.id) +
              '" title="' +
              (off ? 'Switch this step on' : 'Switch this step off') +
              '" aria-label="' +
              (off ? 'Switch step ' + (i + 1) + ' on' : 'Switch step ' + (i + 1) + ' off') +
              '">' +
              icon(off ? 'eyeoff' : 'eye') +
              '</button><button class="op-tool" data-op-delete="' +
              esc(op.id) +
              '" title="Delete this step" aria-label="Delete step ' +
              (i + 1) +
              '">' +
              icon('close') +
              '</button></div>'
            );
          })
          .join('')
      : '';
  $('#plate-size').textContent =
    fmt(project.plate.width) + ' × ' + fmt(project.plate.depth) + ' mm';
  syncPickTools();
  renderParts(
    shownDraft?.result ?? historyInput?.parts ?? parts,
    shownDraft?.trial.selectId ?? selected,
  );
  renderInspector();
}
function syncPickTools() {
  const modes = [
    ['pick', pickMode === 'select' && !scaleCar.active],
    ['measure', pickMode === 'measure'],
  ];
  for (const [action, active] of modes) {
    const button = $('[data-action="' + action + '"]');
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}
function renderParts(displayParts = parts, displayId = selected) {
  // Follow the last successful build, even while another live edit is pending.
  const displayedTrack = project.mode === 'track'
    ? (shownDraft?.trial.next.track ?? project.track)
    : null;
  scaleCar.update(displayedTrack, displayParts, hidden);
  renderBridgeProfiles($('[data-bridge-profile]'), displayParts);
  const isEditor = project.mode === 'editor';
  const rows =
    isEditor && assemblyTab(editorTab)
      ? (historyInput?.parts ?? parts)
      : displayParts;
  $('#part-count').textContent = rows.length;
  if (!isEditor) {
    const list = $('#parts');
    const focused =
      list.contains(document.activeElement) && document.activeElement.id;
    trackPartGroups = groupTrackParts(rows);
    list.innerHTML = trackPartsMarkup(
      trackPartGroups,
      expandedPartGroups,
      hidden,
      displayId,
    );
    if (focused)
      document.getElementById(focused)?.focus({ preventScroll: true });
  } else {
    $('#parts').innerHTML = rows
      .map(
        (p) =>
          '<div class="part-row ' +
          (p.id === (assemblyTab(editorTab) ? selected : displayId) ||
          assemblyPeers.has(p.id)
            ? 'selected'
            : '') +
          '"><button data-part="' +
          esc(p.id) +
          '"><i class="swatch ' +
          esc(p.role) +
          '"></i><strong>' +
          esc(p.name) +
          '</strong></button>' +
          (rows.length > 1
            ? '<button type="button" class="part-check" data-include-part="' +
              esc(p.id) +
              '" aria-label="Select ' +
              esc(p.name) +
              ' for a part operation" aria-pressed="' +
              String(selected === p.id || assemblyPeers.has(p.id)) +
              '">' +
              (selected === p.id || assemblyPeers.has(p.id) ? '✓' : '') +
              '</button>'
            : '') +
          '<button class="icon-button" data-visible="' +
          esc(p.id) +
          '" title="' +
          (hidden.has(p.id) ? 'Show' : 'Hide') +
          ' ' +
          esc(p.name) +
          '">' +
          icon(hidden.has(p.id) ? 'eyeoff' : 'eye') +
          '</button></div>',
      )
      .join('');
    const sketches = availableOps().filter((op) => op.type === 'sketch');
    if (sketches.length)
      $('#parts').insertAdjacentHTML(
        'beforeend',
        '<div class="section-label">Sketches</div>' +
          sketches
            .map(
              (op) =>
                '<button type="button" class="sketch-row' +
                (op.id === activeSketchId ? ' active' : '') +
                '" data-sketch="' +
                esc(op.id) +
                '">' +
                icon('sketch') +
                esc(op.name) +
                '</button>',
            )
            .join(''),
      );
    const count = selectedParts().length;
    $('#parts').insertAdjacentHTML(
      'beforeend',
      '<div class="assembly-part-actions">' +
        button('add-model', 'Add model', 'plus', 'outline') +
        (count > 1
          ? (count === 2
              ? '<button data-tab="align-parts" type="button">Align</button>'
              : '') +
            '<button data-tab="combine-parts" type="button">Combine</button>'
          : '') +
        '</div>',
    );
  }
  const part = displayParts.find((p) => p.id === displayId) ?? displayParts[0],
    b = part?.bounds;
  const selectedRow =
    part && !isEditor ? document.getElementById('assembly-select-' + part.id) : null;
  $('#selected-name').textContent = selectedRow?.title ?? part?.name ?? '—';
  $('#selected-size').textContent = b
    ? b.max.map((n, i) => fmt(n - b.min[i])).join(' × ') + ' mm'
    : '—';
  const fit = $('#fit-result'),
    bad = displayParts.filter((p) => !p.fit.fits);
  const fitLabel =
    bad.length && bad.length < displayParts.length && part?.fit.fits
      ? bad.length + ' other over plate'
      : bad.length + ' over plate';
  fit.innerHTML =
    icon(bad.length ? 'warning' : 'check') +
    (bad.length ? fitLabel : 'Fits plate');
  fit.title = bad.length
    ? 'Exceeds the print plate: ' + bad.map((p) => p.name).join(', ')
    : 'Check print plate and segmentation';
  fit.classList.toggle('warn', !!bad.length);
  fit.hidden = !displayParts.length;
  $('[data-action="export-menu"]').disabled = !displayParts.length;
  $('[data-action="edit-part"]').disabled = !part;
  $('[data-action="reveal-selected"]').disabled = !part;
  $('#mesh-info').textContent =
    displayParts.length +
    (displayParts.length === 1 ? ' part · ' : ' parts · ') +
    fmt(displayParts.reduce((n, p) => n + p.indices.length / 3, 0)) +
    ' triangles';
}

function selectableParts() {
  return (
    (project.mode === 'track' ? shownDraft?.result : historyInput?.parts) ??
    parts
  );
}

function setPartGroupOpen(id, open) {
  const toggle = $('#parts [data-toggle-part-group="' + CSS.escape(id) + '"]');
  if (!toggle) return;
  if (open) expandedPartGroups.add(id);
  else expandedPartGroups.delete(id);
  toggle.setAttribute('aria-expanded', String(open));
  document.getElementById(toggle.getAttribute('aria-controls')).hidden = !open;
}

function revealTrackPart(id, focus = false) {
  if (project.mode !== 'track' || !id) return;
  const row = $('#parts [data-part="' + CSS.escape(id) + '"]');
  if (!row) return;
  const panelToggle = $('#project-toggle');
  const drawer = panelToggle.getClientRects().length > 0;
  if (focus && drawer && panelToggle.getAttribute('aria-expanded') !== 'true')
    panelToggle.click();
  setPartGroupOpen(row.closest('[data-part-group]').dataset.partGroup, true);
  if (focus) row.focus({ preventScroll: true });
  if (!drawer || panelToggle.getAttribute('aria-expanded') === 'true')
    row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function startMatePick(moving) {
  const target = $('#settings-form').elements.assemblyTarget.value;
  const id = moving ? target : selectedParts().find((p) => p.id !== target)?.id;
  if (!id) return;
  cancelLive();
  pendingMate = id;
  pickGeneration++;
  stage.clearHighlight();
  const onlyChosenPart = new Set(
    (historyInput?.parts ?? parts).filter((p) => p.id !== id).map((p) => p.id),
  );
  stage.select(id, onlyChosenPart);
  renderInspector();
}
function toggleAssemblyMember(id) {
  if (!parts.some((p) => p.id === id) || historyInput) {
    notice('Return to Face editing to change the selected parts.');
    return;
  }
  cancelLive();
  clearPick();
  editing = null;
  pickMode = 'select';
  editorTab = 'select';
  toolArmed = false;
  pendingMate = null;
  assemblyFaces.clear();
  if (id === selected) {
    if (assemblyPeers.size) {
      selected = [...assemblyPeers][0];
      assemblyPeers.delete(selected);
    }
  } else if (!assemblyPeers.delete(id)) assemblyPeers.add(id);
  stage.select(selected, hidden, assemblyPeers);
  render();
}
function choosePart(id, { keepSurface = false } = {}) {
  activeSketchId = null;
  assemblyPeers.clear();
  assemblyFaces.clear();
  pendingMate = null;
  selected = id;
  if (project.mode === 'track') {
    const role = selectableParts().find((part) => part.id === id)?.role;
    if (shownDraft)
      shownDraft = {
        ...shownDraft,
        trial: { ...shownDraft.trial, selectId: id },
      };
    // Selecting a part opens its own section, unless a section that covers
    // every part (Cross-section, Markings, Print) is already open.
    const keep = ['profile', 'markings', 'print'].includes(trackTab);
    if (role === 'border' && !['markings', 'print'].includes(trackTab)) trackTab = 'borders';
    if (role === 'clip' || role === 'retainer') trackTab = 'joints';
    if (['support', 'turnout', 'turnoutArm', 'turnoutBearing', 'motorMount'].includes(role)) trackTab = 'geometry';
    if (role === 'road' && !keep) trackTab = 'geometry';
    focusedField = '';
  }
  if (!keepSurface) {
    clearPick();
    editing = null;
  }
  stage.select(id, hidden);
  render();
}
async function picked(id, triangle, point, { shiftKey = false } = {}) {
  if (busy || inAction) return;
  if (
    project.mode === 'editor' &&
    editorTab === 'align-parts' &&
    pickMode !== 'measure'
  ) {
    if (!pendingMate) {
      notice('Choose Pick moving face or Pick reference face first.');
      return;
    }
    if (pendingMate !== id) {
      notice(
        'Pick a face on ' +
          (selectedParts().find((p) => p.id === pendingMate)?.name ??
            'the requested part') +
          '.',
      );
      return;
    }
    const token = pickGeneration,
      wanted = pendingMate;
    let face;
    try {
      face = await call('pick', {
        id,
        triangle,
        point,
        tolerance: 1,
        historyId: historyInput?.id,
      });
    } catch (err) {
      if (token === pickGeneration && pendingMate === wanted)
        notice(err.message);
      return;
    }
    if (
      token !== pickGeneration ||
      editorTab !== 'align-parts' ||
      pendingMate !== wanted
    )
      return;
    if (!face.planar) {
      notice('Pick a flat face to mate these parts.');
      return;
    }
    assemblyFaces.set(id, { point, normal: face.normal });
    pendingMate = null;
    stage.select(selected, hidden, assemblyPeers);
    stage.highlightFaces(id, face.triangleIndices);
    toolArmed = true;
    renderInspector();
    return;
  }
  if (pickMode === 'measure') {
    if (measurePoints.length === 2 || measurePart !== id) measurePoints = [];
    measurePart = id;
    measurePoints.push(point);
    const d = distanceMeasured();
    $('#model-info').textContent =
      d != null ? fmt(d) + ' mm · point to point' : 'Pick the second point';
    if (project.mode === 'editor') {
      selected = id;
      stage.select(id, hidden);
      renderParts();
      renderInspector();
      if (d != null) status('Measured ' + fmt(d) + ' mm');
    }
    updateGuides();
    return;
  }
  const pickSource = historyInput;
  if (
    !selectableParts().some((p) => p.id === id) ||
    (pickSource && id !== selected) ||
    (shownDraft && project.mode === 'editor' && !isFaceTool(editorTab))
  ) {
    notice('Apply this edit to select its resulting surfaces.');
    return;
  }
  if (project.mode === 'track') {
    if (scaleCar.place(selectableParts().find(p => p.id === id), point)) return;
    choosePart(id);
    revealTrackPart(id);
    return;
  }
  if (!assemblyTab(editorTab) && assemblyPeers.size) {
    assemblyPeers.clear();
    assemblyFaces.clear();
    renderParts();
  }
  const canGroup = [
    'select',
    'move-face',
    'edge-finish',
    'hole-modify',
    'wall-modify',
  ].includes(editorTab);
  if (shiftKey && !canGroup) {
    notice('Use Face editing to select several faces or edges.');
    return;
  }
  const extend = (shiftKey || extendPicks) && canGroup;
  const seed = { id, triangle, point, source: pickSource, project };
  return enqueueSurface(seed, extend);
}

function enqueueSurface(seed, extend, whole = false) {
  repickError = null;
  // Existing members must use the latest boundary angle before deciding
  // whether the new member overlaps one of them.
  if (extend) queueRegroup();
  const fieldAngle = $('#settings-form [name="tolerance"]')?.valueAsNumber;
  const angle = Number.isFinite(fieldAngle) ? fieldAngle : tolerance;
  // A replace supersedes earlier picks. Every additive toggle runs in click
  // order, including when a large mesh takes longer than the next Shift-click.
  const token = extend ? pickGeneration : ++pickGeneration;
  const valid = () =>
    token === pickGeneration &&
    seed.source === historyInput &&
    seed.project === project &&
    !busy &&
    pickMode === 'select';
  const run = async () => {
    if (!valid()) return;
    if (
      extend &&
      editing &&
      !selectedFaces.length &&
      !pickedEdges.length &&
      !selectionReplaced
    )
      throw Error(
        'Click a face to replace the saved selection, then Shift-click to add faces.',
      );
    if (
      extend &&
      (selectedFaces.length || pickedEdges.length) &&
      seed.id !== selected
    )
      throw Error(
        'Choose faces on the same part. Click without Shift to select a different part.',
      );
    const edgeTool = editorTab === 'edge-finish' || editorTab === 'hole-modify';
    const tryEdge =
      !whole &&
      (edgeTool ||
        (editorTab === 'select' &&
          (!extend || pickedEdges.length || !selectedFaces.length)));
    const edge = tryEdge
      ? await nearFinishEdge(
          (historyInput?.parts ?? parts).find((p) => p.id === seed.id),
          seed,
          edgeTool ? 18 : 5,
        )
      : null;
    if (editorTab === 'hole-modify' && !isHoleRim(edge))
      throw Error(
        'Click the circular lip where an existing bore opens onto a flat surface.',
      );
    if (editorTab === 'edge-finish' && !edge)
      throw Error('Click closer to the edge, rounded corner or hole rim.');
    if (extend && pickedEdges.length > 1 && !edge && editorTab === 'select')
      throw Error(
        'Shift-click another edge, or click a face without Shift to start a new selection.',
      );
    const info = await resolveSurface(
      { ...seed, whole: whole || editorTab === 'wall-modify' },
      angle,
    );
    if (!valid()) return;
    const scope = activeEdgeScope();
    const nextEdges = edge
      ? toggleMember(edgesForScope(pickedEdges, scope), edge, extend, (a, b) =>
          sameFinishEdge(a, b, undefined, scope),
        )
      : [];
    let nextFaces, nextRegion;
    if (edge) {
      nextFaces =
        nextEdges.length === 1 && (!extend || !pickedEdges.length)
          ? [info]
          : [];
      nextRegion = nextFaces[0] ?? null;
    } else if (
      editorTab === 'wall-modify' ||
      (editorTab === 'select' &&
        extend &&
        info.planar &&
        !info.feature &&
        selectedFaces.every((face) => face.planar && !face.feature) &&
        (region?.wallGroup ||
          selectedFaces.some(
            (face) => dot3(info.normal, face.normal) < 0.99999,
          )))
    ) {
      if (!info.planar)
        throw Error(
          'Pick a flat wall, then Shift-click any other walls to include.',
        );
      nextFaces = toggleMember(selectedFaces, info, extend, sameSelectedFace);
      nextRegion = wallRegion(nextFaces);
    } else {
      nextFaces = updateFaceSelection(selectedFaces, info, extend);
      nextRegion = composeFaceSelection(nextFaces);
    }
    cancelLive();
    repickError = null;
    if (
      editing &&
      project.editor.ops.find((x) => x.id === editing)?.target !== seed.id
    )
      editing = null;
    selectedFaces = nextFaces;
    pickedEdges = nextEdges;
    region = nextRegion;
    selectionReplaced = true;
    pickSeed = selectedFaces.at(-1)?.seed ?? (nextEdges.length ? seed : null);
    activeSketchId = null;
    finishEdge = pickedEdges.at(-1) ?? null;
    const previousTrim =
      editorTab === 'trim-top' ? formDrafts.get(draftKey()) : null;
    if (isFaceTool(editorTab)) {
      toolArmed = Boolean(region || pickedEdges.length);
      if (editorTab === 'trim-top') {
        formDrafts.delete(draftKey());
        editorTab = 'trim-face';
      }
    }
    selected = seed.id;
    if (previousTrim) formDrafts.set(draftKey(), previousTrim);
    stage.select(selected, hidden);
    stage.highlightRegions(selected, pickedEdges.length ? [] : selectedFaces);
    render();
  };
  selectionQueue = selectionQueue.then(run).catch((error) => {
    if (valid()) notice(error.message);
  });
  return selectionQueue;
}

async function resolveSurface(seed, angle) {
  const { id, triangle, point, source } = seed;
  const info = await call('pick', {
    id,
    triangle,
    point,
    tolerance: angle,
    historyId: source?.id,
    preferPost: !seed.whole,
  });
  const delta = point.map((v, i) => v - info.origin[i]);
  const dot = (axis) => axis.reduce((n, v, i) => n + v * delta[i], 0);
  return {
    ...info,
    partId: id,
    seed,
    anchor: [dot(info.u), dot(info.v)],
    boundaryAngle: angle,
  };
}
function wallRegion(members) {
  const last = members.at(-1);
  if (members.length < 2) return last ?? null;
  if (members.every((face) => dot3(last.normal, face.normal) >= 0.99999))
    return composeFaceSelection(members);
  return { ...last, wallGroup: true, faceCount: members.length };
}

async function regroupSurfaces({ angle, token, version }) {
  const valid = () =>
    token === pickGeneration &&
    version === angleGeneration &&
    !busy &&
    pickMode === 'select';
  if (!valid()) return;
  try {
    let members = [];
    for (const previous of selectedFaces) {
      const face = await resolveSurface(previous.seed, angle);
      if (!valid()) return;
      if (!members.some((member) => sameSelectedFace(member, face)))
        members = updateFaceSelection(members, face, true);
    }
    if (!members.length) return;
    const grouped = composeFaceSelection(members);
    cancelLive();
    selectedFaces = members;
    region = grouped;
    selectionReplaced = true;
    pickSeed = members.at(-1)?.seed ?? null;
    stage.highlightRegions(selected, selectedFaces);
    const note = $('#surface-note');
    if (note) note.textContent = surfaceNote(editorTab, region);
    const title = $('.editor-selection strong');
    if (title)
      title.textContent = selectionTitle(editorTab, region, toolPart());
    const count = $('#selection-count');
    if (count) count.dataset.count = String(members.length);
    refreshFaceActions();
    const lay = $('.editor-home [data-action="lay-flat"]');
    if (lay) lay.disabled = !region?.planar || members.length > 1;
    const instruction = $('.editor-home .editor-instruction');
    if (instruction)
      instruction.textContent = faceInstruction(region?.planar, members.length);
    refreshLive();
  } catch (error) {
    if (!valid()) return;
    repickError = error;
    cancelLive();
    showDraftError(error);
    const apply = $('#settings-form [data-action="apply"]');
    if (apply) apply.disabled = true;
  }
}
// Pointer picks and boundary changes share one ordered queue. Intermediate
// angle requests can expire, while every Shift-click toggle runs once.
function queueRegroup() {
  clearTimeout(repickTimer);
  if (queuedRepick) {
    const request = queuedRepick;
    queuedRepick = null;
    selectionQueue = selectionQueue.then(() => regroupSurfaces(request));
  }
  return selectionQueue;
}
function updateBoundaryAngle(input) {
  repickError = null;
  clearTimeout(repickTimer);
  queuedRepick = null;
  const version = ++angleGeneration;
  if (!input.validity.valid || pickMode !== 'select') {
    refreshLive();
    return;
  }
  live.cancel();
  liveStatus('updating', 'Updating selected surface…');
  queuedRepick = { angle: input.valueAsNumber, token: pickGeneration, version };
  repickTimer = setTimeout(queueRegroup, 130);
}
function distanceMeasured() {
  return measurePoints.length === 2
    ? Math.hypot(...measurePoints[1].map((n, i) => n - measurePoints[0][i]))
    : null;
}
function showDialog(title, body) {
  $('#dialog-content').innerHTML =
    '<header><h2>' +
    esc(title) +
    '</h2>' +
    tool('close-dialog', 'Close dialog', 'close') +
    '</header>' +
    body;
  if (!$('#dialog').open) $('#dialog').showModal();
  updateGuides();
}
function closeDialog() {
  $('#dialog').close();
  dialogPlate = null;
  dialogPlateFit = null;
  updateGuides();
}
const row = (act, title, desc, ic) =>
  '<button class="choice-row" data-action="' +
  act +
  '">' +
  icon(ic) +
  '<span>' +
  esc(title) +
  '<small>' +
  esc(desc) +
  '</small></span>' +
  icon('arrow') +
  '</button>';
function filePick(intent, accept) {
  fileIntent = intent;
  const input = $('#file');
  input.value = '';
  input.accept = accept;
  input.click();
}
function download(name, bytes, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const actions = {};
// The SlotForge app theme, remembered on this device. index.html applies it
// before the first paint; this keeps the switches, Settings and the drawings
// in step with it.
let themeState = loadTheme();
function syncTheme() {
  applyThemeState(themeState);
  for (const b of document.querySelectorAll('[data-action^="theme-"]'))
    b.setAttribute('aria-pressed', String(b.dataset.action === 'theme-' + themeState.theme));
  for (const b of document.querySelectorAll('[data-pick-theme]'))
    b.setAttribute('aria-pressed', String(b.dataset.pickTheme === themeState.theme));
  syncThemeSettings($('#settings-page'), themeState);
  document.dispatchEvent(new CustomEvent('foundry-theme', { detail: themeState.theme }));
}
function chooseTheme(theme, customColors) {
  if (customColors) themeState = { theme: 'custom', customColors };
  else if (theme === 'custom' && !themeState.customColors)
    themeState = { theme, customColors: { ...paletteOf(themeState) } };
  else themeState = { ...themeState, theme };
  saveTheme(themeState);
  syncTheme();
}
syncTheme();
// Another SlotForge app (or window) changed the shared theme.
window.addEventListener('storage', (e) => {
  if (e.key !== THEME_STORAGE_KEY || !e.newValue) return;
  themeState = readTheme(e.newValue);
  syncTheme();
});
actions['theme-light'] = () => chooseTheme('light');
actions['theme-dark'] = () => chooseTheme('dark');
let planner, planning = false;
let home, homeOpen = false;
function markNav(key) {
  for (const k of ['mode-home', 'mode-library', 'mode-settings', 'mode-track', 'mode-editor', 'mode-planner']) {
    const b = $('[data-action="' + k + '"]');
    b.classList.toggle('active', k === key);
    b.setAttribute('aria-pressed', String(k === key));
  }
}
// Home covers the workspace like the Planner does. The project underneath
// stays as it was, so Track Set and STL Edit reopen where they were left.
async function showHome() {
  leavePlanner();
  leaveLibraryPage();
  if (!homeOpen) {
    homeOpen = true;
    $('.workspace').hidden = true;
    $('.statusbar').classList.add('brand-only');
    $('#home').hidden = false;
    document.body.classList.add('at-home');
  }
  markNav('mode-home');
  home ??= createHome({
    host: $('#home'),
    load: async () => {
      const store = await openTrackLibrary();
      const [packs, layouts, stlParts] = await Promise.all([
        store.list(),
        store.layouts(),
        store.stlParts(),
      ]);
      return { packs, layouts, stlParts, plate: project.plate };
    },
    handlers: homeHandlers,
    onError: (err) => notice(err.message),
  });
  await home.show();
}
function leaveHome() {
  if (!homeOpen) return;
  homeOpen = false;
  $('#home').hidden = true;
  $('.workspace').hidden = false;
  $('.statusbar').classList.remove('brand-only');
  document.body.classList.remove('at-home');
  const nav = $('[data-action="mode-home"]');
  nav.classList.remove('active');
  nav.setAttribute('aria-pressed', 'false');
  render();
}
actions['mode-home'] = showHome;

// The Library page covers the workspace like Home does.
let libraryPage,
  libraryOpen = false;
async function showLibraryPage() {
  leavePlanner();
  leaveHome();
  leaveSettingsPage();
  if (!libraryOpen) {
    libraryOpen = true;
    $('.workspace').hidden = true;
    $('.statusbar').classList.add('brand-only');
    $('#library-page').hidden = false;
    document.body.classList.add('at-home');
  }
  markNav('mode-library');
  libraryPage ??= createLibraryPage({
    host: $('#library-page'),
    store: openTrackLibrary,
    handlers: libraryHandlers,
    onError: (err) => notice(err.message),
  });
  await libraryPage.show();
}
function leaveLibraryPage() {
  leaveSettingsPage();
  if (!libraryOpen) return;
  libraryOpen = false;
  $('#library-page').hidden = true;
  $('.workspace').hidden = false;
  $('.statusbar').classList.remove('brand-only');
  document.body.classList.remove('at-home');
  const nav = $('[data-action="mode-library"]');
  nav.classList.remove('active');
  nav.setAttribute('aria-pressed', 'false');
  render();
}
actions['mode-library'] = showLibraryPage;

// Settings covers the workspace too. Changes save as they are made.
let settingsOpen = false,
  settings = loadSettings();
function showSettingsPage() {
  leavePlanner();
  leaveHome();
  leaveLibraryPage();
  settingsOpen = true;
  $('.workspace').hidden = true;
  $('.statusbar').classList.add('brand-only');
  const host = $('#settings-page');
  host.hidden = false;
  document.body.classList.add('at-home');
  markNav('mode-settings');
  settings = loadSettings();
  host.innerHTML = renderSettings(settings, themeState);
  if (desktopUpdates) host.querySelector('.st').append(updatesHolder);
  syncThemeSettings(host, themeState);
  readUnopened()
    .then((kept) => {
      const box = host.querySelector('[data-unopened]');
      if (box) box.hidden = !kept;
    })
    .catch(() => {});
  // Look: theme tiles, your own colours and "start from".
  host.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick-theme]');
    if (pick) chooseTheme(pick.dataset.pickTheme);
    else if (e.target.closest('[data-theme-copy]'))
      chooseTheme('custom', { ...paletteOf(themeState, host.querySelector('[data-theme-from]').value) });
  });
  host.addEventListener('input', (e) => {
    const key = e.target.dataset?.themeColor;
    if (!key) return;
    const own = { ...paletteOf(themeState, themeState.customColors ? 'custom' : themeState.theme) };
    own[key] = e.target.value;
    chooseTheme('custom', own);
  });
  host.querySelector('form').addEventListener('change', (e) => {
    if (e.target.closest('[data-look], [data-updates]')) return;
    const form = e.currentTarget;
    settings = saveSettings(readSettingsForm(form, settings, e.target.name));
    form.elements.printer.value = settings.printer;
    for (const k of ['width', 'depth', 'margin']) form.elements[k].value = settings.plate[k];
  });
}
function leaveSettingsPage() {
  if (!settingsOpen) return;
  settingsOpen = false;
  $('#settings-page').hidden = true;
  $('#settings-page').replaceChildren();
  $('.workspace').hidden = false;
  $('.statusbar').classList.remove('brand-only');
  document.body.classList.remove('at-home');
  const nav = $('[data-action="mode-settings"]');
  nav.classList.remove('active');
  nav.setAttribute('aria-pressed', 'false');
  render();
}
actions['mode-settings'] = showSettingsPage;
// Settings → Updates (desktop app). The card lives in this holder, which is
// put back each time the Settings page is drawn.
const updatesHolder = document.createElement('div');
updatesHolder.className = 'st-updates';
updatesHolder.dataset.updates = '';
const desktopUpdates = Boolean(globalThis.slotforgeDesktop?.updateCheck);
globalThis.UpdateUI?.start({
  settings: updatesHolder,
  say: (message) => notice(message),
  appName: 'Foundry',
  keeps: 'your packs, layouts and STL parts stay where they are',
});
actions['download-unopened'] = async () => {
  const kept = await readUnopened();
  if (!kept) throw Error('There is no unopened project on this device.');
  download(
    cleanName(kept.name || 'Recovered project') + '.slotfab',
    JSON.stringify(kept, null, 2),
    'application/json',
  );
};
actions['settings-plate-to-project'] = async () => {
  await applyForOutput();
  const next = clone(project);
  next.plate = { ...settings.plate };
  let failure = null;
  if (await rebuild(next, { onError: (e) => (failure = e) }))
    notice('The open project now uses the ' + settings.plate.width + ' × ' + settings.plate.depth + ' mm plate.');
  else
    notice(failure?.message ?? 'Another calculation is still running. Try again when it has finished.');
};
actions['packs-dialog'] = () => openLibrary();
// A second click while the Planner is still opening joins that opening.
let openingPlanner = null;
function showPlanner() {
  openingPlanner ??= openPlanner().finally(() => (openingPlanner = null));
  return openingPlanner;
}
async function openPlanner() {
  leaveHome();
  leaveLibraryPage();
  if (!planning) {
    await applyForOutput();
    planner ??= createPlanner({host:$('#track-planner'),call,download,current:()=>project,promote});
    planning = true;
    $('.workspace').hidden = true;
    $('.statusbar').classList.add('brand-only');
    $('#track-planner').hidden = false;
    markNav('mode-planner');
    const output=$('[data-action="export-menu"]');
    output.disabled=false;output.title='Download layout print kit';
    $('[data-action="save"]').setAttribute('aria-label','Save layout');
    try {await planner.show();} catch(err){leavePlanner();throw err;}
  }
}
function leavePlanner() {
  if (!planning) return;
  planning=false;
  $('#track-planner').hidden=true;
  $('.workspace').hidden=false;
  $('.statusbar').classList.remove('brand-only');
  const nav=$('[data-action="mode-planner"]');
  nav.classList.remove('active');nav.setAttribute('aria-pressed','false');
  render();
}
actions['mode-planner']=showPlanner;
actions['view-underside'] = () => stage.view('bottom');
actions['reveal-selected'] = () =>
  revealTrackPart(shownDraft?.trial.selectId ?? selected, true);
async function openLibrary({ collectionId, screen } = {}) {
  const canSavePiece = !planning && !homeOpen && project.mode === 'track';
  const current = () => ({
    track: project.track,
    name: project.name,
    link: canSavePiece ? project.libraryPiece : null,
  });
  const store = await openTrackLibrary();
  await showTrackLibrary({
    store,
    current,
    collectionId,
    screen,
    prepare: applyForOutput,
    canSavePiece,
    download,
    validateTrack: (track) => call('validateLibraryTrack', track),
    createPiece: (collection, save) => drawTrack(false, collection, save),
    openPiece: openPackPiece,
    updateProfile: async (collection, oldRevision) => {
      // A library edit from the STL workspace changes the stored recipes.
      // Only rebuild a linked track when it is the active workpiece.
      if (!canSavePiece) return;
      const link = project.libraryPiece;
      if (
        link?.collectionId !== collection.id ||
        link.revision !== oldRevision ||
        collection.revision !== oldRevision + 1
      )
        return;
      const next = {
        ...project,
        track: trackWithProfile(project.track, collection.profile),
        libraryPiece: { ...link, revision: collection.revision },
      };
      if (
        !(await rebuild(next, {
          onError: (e) => {
            throw e;
          },
        }))
      )
        throw Error('Open the piece to reload its shared profile.');
    },
  });
}
actions['track-library'] = openLibrary;

// Opens a piece of a pack in Track Set, linked to that pack.
async function openPackPiece(collection, piece) {
  leaveLibraryPage();
  currentPack = collection;
  openTrackLibrary()
    .then((store) => store.layouts())
    .then((layouts) => {
      packLayouts = layouts;
      render();
    })
    .catch(() => {});
  leaveHome();
  leavePlanner();
  await applyForOutput();
  const next = {
    ...project,
    mode: 'track',
    name: piece.name,
    track: trackWithProfile(piece.track, collection.profile),
    libraryPiece: {
      collectionId: collection.id,
      pieceId: piece.id,
      revision: collection.revision,
    },
  };
  trackTab = 'geometry';
  if (!(await rebuild(next, { fit: true, selectId: 'road-1', onError: (e) => { throw e; } })))
    throw Error('The piece could not be opened.');
}
function uniqueName(name, taken) {
  let candidate = name;
  for (let i = 2; taken.includes(candidate); i++) candidate = name + ' ' + i;
  return candidate;
}
// The Library page's shelves. A handler returns true when the shelf
// should be redrawn.
// "Original changed": rebuild an STL part on the current version of the
// pack piece it came from, then replay its edits. Nothing is saved when an
// edit no longer finds its face on the new piece.
// STL Edit history: switch a step off (kept, not replayed) or delete it.
// When later steps need it, the rebuild fails and the model stays as it was.
// Rebuilds a history change. Refused only because of the geometry when the
// build reports why; otherwise another calculation was still running.
async function rebuildHistory(next, refused) {
  let failure = null;
  if (await rebuild(next, { onError: (e) => (failure = e) })) return;
  notice(
    failure
      ? refused + ': a later step depends on it. ' + failure.message
      : 'Another calculation is still running. Try again when it has finished.',
  );
}
async function toggleStep(id) {
  // Apply a pending tool edit first; a rebuild would otherwise drop it.
  await applyForOutput();
  const next = clone(project);
  const off = new Set(next.editor.off ?? []);
  if (off.has(id)) off.delete(id);
  else off.add(id);
  next.editor.off = [...off];
  if (!next.editor.off.length) delete next.editor.off;
  await rebuildHistory(next, 'This step cannot be switched ' + (off.has(id) ? 'off' : 'on'));
}
async function deleteStep(id) {
  const op = project.editor.ops.find((o) => o.id === id);
  if (!op) return;
  const ok = await askUser({
    title: 'Delete this step?',
    text: '"' + op.label + '" is removed from the history. Undo brings it back.',
    confirm: 'Delete step',
    danger: true,
  });
  if (!ok) return;
  await applyForOutput();
  const next = clone(project);
  next.editor.ops = next.editor.ops.filter((o) => o.id !== id);
  if (next.editor.off) {
    next.editor.off = next.editor.off.filter((o) => o !== id);
    if (!next.editor.off.length) delete next.editor.off;
  }
  await rebuildHistory(next, 'This step cannot be deleted');
}
async function rebuildStlPart(id) {
  const store = await openTrackLibrary();
  const saved = await store.stlPart(id);
  const src = saved.source;
  if (!src) throw Error('This part is not linked to a pack piece.');
  const pack = (await store.list()).find((p) => p.id === src.collectionId);
  const piece = pack?.pieces.find((p) => p.id === src.pieceId);
  if (!piece) throw Error('The piece this part came from is no longer in the Library.');
  // Building the part means opening its pack piece. If that fails, the
  // project that was open comes back, with its undo history as it was.
  const before = project;
  const giveBack = async (message) => {
    if (history.at(-1) === before) history.pop();
    await rebuild(before, { record: false, fit: true });
    throw Error(message);
  };
  await openPackPiece(pack, piece);
  const part = parts.find((p) => p.id === src.part);
  if (!part) return giveBack('The piece no longer has the part "' + src.part + '".');
  const bytes = await call('export', { mode: 'part', id: part.id });
  const source = { ...src, revision: pack.revision };
  const next = {
    ...saved.project,
    mode: 'editor',
    editor: {
      ...saved.project.editor,
      source: { ...saved.project.editor.source, data: toBase64(bytes) },
    },
    stlPart: { id: saved.id, name: saved.name, basedOn: saved.basedOn, source },
  };
  let failure = null;
  const ok = await rebuild(next, { fit: true, onError: (e) => (failure = e) });
  if (!ok)
    return giveBack(
      'Some edits no longer fit the changed piece, so the part was kept as it was.' +
        (failure ? ' ' + failure.message : ''),
    );
  await store.saveStlPart({
    id: saved.id,
    name: saved.name,
    basedOn: saved.basedOn,
    source,
    project: { ...next, stlPart: undefined },
  });
  notice(
    'Rebuilt "' + saved.name + '" on the current piece with its ' +
      next.editor.ops.length + (next.editor.ops.length === 1 ? ' edit.' : ' edits.'),
  );
  return false;
}
const libraryHandlers = {
  async 'edit-pack'(id, { packs }) {
    const pack = packs.find((p) => p.id === id);
    if (pack?.pieces.length) await openPackPiece(pack, pack.pieces[0]);
    else await openLibrary({ collectionId: id });
  },
  async 'plan-pack'(id) {
    await showPlanner();
    planner.usePack(id);
  },
  'manage-pack': (id) => openLibrary({ collectionId: id }),
  async 'rename-pack'(id, { packs }) {
    const pack = packs.find((p) => p.id === id);
    const name = await askUser({ title: 'Rename pack', value: pack.name, confirm: 'Rename' });
    if (!name) return false;
    await (await openTrackLibrary()).renamePack(id, name);
    if (currentPack?.id === id) currentPack = null;
    return true;
  },
  async 'duplicate-pack'(id) {
    await (await openTrackLibrary()).duplicatePack(id);
    return true;
  },
  async 'delete-pack'(id, { packs }) {
    const pack = packs.find((p) => p.id === id);
    const ok = await askUser({
      title: 'Delete ' + pack.name + '?',
      text:
        'Its ' +
        pack.pieces.length +
        ' pieces are deleted with it. Layouts planned with this pack keep their own copies. This cannot be undone.',
      confirm: 'Delete pack',
      danger: true,
    });
    if (!ok) return false;
    await (await openTrackLibrary()).deletePack(id);
    if (project.libraryPiece?.collectionId === id) {
      // Save the unlinked project, so a reload does not bring the link back.
      const { libraryPiece: _gone, ...rest } = project;
      project = rest;
      currentPack = null;
      persist();
    }
    return true;
  },
  'open-layout': (id) => homeHandlers.layout({ id }),
  async 'rename-layout'(id) {
    const store = await openTrackLibrary();
    const saved = await store.layout(id);
    const name = await askUser({ title: 'Rename layout', value: saved.name, confirm: 'Rename' });
    if (!name) return false;
    await store.renameLayout(id, name);
    return true;
  },
  async 'delete-layout'(id, { layouts }) {
    const layout = layouts.find((l) => l.id === id);
    const ok = await askUser({
      title: 'Delete ' + layout.name + '?',
      text: 'The layout is removed from the Library. Files you saved or exported stay where they are. This cannot be undone.',
      confirm: 'Delete layout',
      danger: true,
    });
    if (!ok) return false;
    await (await openTrackLibrary()).deleteLayout(id);
    return true;
  },
  'open-part': (id) => homeHandlers.part({ id }),
  'rebuild-part': (id) => rebuildStlPart(id),
  async 'rename-part'(id, { parts }) {
    const part = parts.find((p) => p.id === id);
    const name = await askUser({ title: 'Rename STL part', value: part.name, confirm: 'Rename' });
    if (!name) return false;
    await (await openTrackLibrary()).renameStlPart(id, name);
    return true;
  },
  async 'delete-part'(id, { parts }) {
    const part = parts.find((p) => p.id === id);
    const ok = await askUser({
      title: 'Delete ' + part.name + '?',
      text: 'Parts based on it keep their own model. This cannot be undone.',
      confirm: 'Delete part',
      danger: true,
    });
    if (!ok) return false;
    await (await openTrackLibrary()).deleteStlPart(id);
    return true;
  },
};
const homeHandlers = {
  async edit({ pack }) {
    const store = await openTrackLibrary();
    const collection = (await store.list()).find((c) => c.id === pack);
    if (!collection) throw Error('This pack is no longer in the library.');
    if (collection.pieces.length) await openPackPiece(collection, collection.pieces[0]);
    else await openLibrary({ collectionId: pack });
  },
  async plan({ pack }) {
    await showPlanner();
    planner.usePack(pack);
  },
  library: () => showLibraryPage(),
  'open-file': () => filePick('open', '.stl,.svg,.dxf,.slotfab,.slotplan,.json'),
  async starter({ lanes }) {
    const store = await openTrackLibrary();
    const packs = await store.list();
    const pack = starterPack(Number(lanes));
    const id = await store.createCollection(
      uniqueName(pack.name, packs.map((p) => p.name)),
      pack.profile,
      pack.pieces,
      pack.rules,
    );
    const created = (await store.list()).find((c) => c.id === id);
    await openPackPiece(created, created.pieces[0]);
    notice('New pack "' + created.name + '" added to the Library.');
  },
  scratch: () => openLibrary({ screen: 'new' }),
  circuit: () => filePick('circuit', '.svg,.dxf'),
  'open-stl': () => filePick('stl', '.stl'),
  'new-design': async () => {
    leaveHome();
    await actions['new-design']();
  },
  async layout({ id }) {
    const saved = await (await openTrackLibrary()).layout(id);
    await showPlanner();
    await planner.openFile({ ...saved.data, libraryId: saved.id });
  },
  async part({ id }) {
    const saved = await (await openTrackLibrary()).stlPart(id);
    // Opened from Home or from the Library page: either covers the workspace.
    leaveHome();
    leaveLibraryPage();
    await rebuild(
      {
        ...saved.project,
        stlPart: {
          id: saved.id,
          name: saved.name,
          basedOn: saved.basedOn,
          source: saved.source,
          original: !saved.basedOn && !saved.source && !saved.project.editor.ops.length,
        },
      },
      { fit: true },
    );
  },
  plate: () => actions.plate(),
  'fit-samples': () => actions['fit-samples'](),
  'rebuild-part': ({ id }) => rebuildStlPart(id),
};
async function drawTrack(editingPath, collection, saveToCollection) {
  if (editingPath) await applyForOutput();
  const source =
    collection && project.libraryPiece?.collectionId !== collection.id
      ? (collection.pieces[0]?.track ?? project.track)
      : project.track;
  const { width, lanes, laneSpacing } = source.params;
  const seamClips = collection?.pieces[0]?.track.params.connectorCounts?.seamClips;
  const initial = editingPath
    ? {
        ...source,
        sourceName: project.libraryPiece ? project.name : source.sourceName,
      }
    : {
        sourceName: '',
        plan: null,
        params: {
          ...defaultTrack(),
          ...profileFromTrack(source),
          ...collection?.profile,
          ...(collection?.rules.lanes === 1 && seamClips != null && {
            connectorCounts: { seamClips },
          }),
          kind: 'straight',
          width,
          lanes,
          laneSpacing,
        },
      };
  const creator = editingPath ? openCustomTrackEditor : openTrackPieceCreator;
  const familyKey =
    'foundry.curve-family.' +
    (collection?.id ?? project.libraryPiece?.collectionId ?? 'workspace');
  let familyDefaults;
  try {
    familyDefaults = JSON.parse(localStorage.getItem(familyKey));
  } catch {
    /* Storage can be disabled for offline files. */
  }
  const grid = collection?.pieces.find(
    (piece) => piece.track.params.curveGridRadius,
  )?.track.params.curveGridRadius;
  return creator({
    track: initial,
    collectionName: collection?.name,
    packRules: collection?.rules,
    familyDefaults: {
      ...(source.curveFamily && { ...source.curveFamily, matched: true }),
      ...familyDefaults,
      ...(grid && { gridRadius: grid }),
    },
    onFamilyApplied(settings) {
      try {
        localStorage.setItem(familyKey, JSON.stringify(settings));
      } catch {
        /* Optional drawing preferences. */
      }
    },
    onApply:
      saveToCollection ??
      (async (track) => {
        const next = {
          ...project,
          name: track.sourceName,
          mode: 'track',
          track,
        };
        if (!editingPath) delete next.libraryPiece;
        trackTab = 'geometry';
        return rebuild(next, {
          fit: true,
          selectId: 'road-1',
          onError: (e) => {
            throw e;
          },
        });
      }),
  });
}
actions['new-custom'] = openLibrary;
actions['edit-custom'] = () => drawTrack(true);
const connectorPickerState = {};
actions['place-connectors'] = async () => {
  const form = $('#settings-form');
  const apply = await editConnectorPlacement({
    previous: connectorPickerState,
    getTrack: () => trackFields.size ? candidate(false).next.track : project.track,
    getLive: () => {
      const dirty = trackFields.size > 0;
      let generatedParts;
      if (!dirty && (liveState === 'idle' || liveState === 'ready')) generatedParts = parts;
      else if (liveState === 'ready' && activeTrial && shownDraft?.trial.next === activeTrial.next)
        generatedParts = shownDraft.result;
      return {
        state: liveState,
        dirty,
        parts: generatedParts,
        message: $('#live-status')?.textContent,
      };
    },
    writeFields: (changes) => {
      for (const [key, value] of Object.entries(changes)) {
        const input = form.elements.namedItem(key);
        if (!input)
          throw Error('Cannot update the connector setting ' + key + '.');
        input.value = value;
      }
      for (const key of Object.keys(changes))
        storeField(form.elements.namedItem(key));
      updateRestoreControls();
      refreshLive();
    },
  });
  if (apply) await applyForm();
};
function selectSketch(id, fit = false) {
  const record = project.editor.ops.find(
    (op) => op.type === 'sketch' && op.id === id,
  );
  if (!record) return;
  cancelLive();
  editing = null;
  newEditId = null;
  toolArmed = false;
  editorTab = 'select';
  pickMode = 'select';
  clearPick();
  activeSketchId = id;
  stage.setDesignBounds(sketchLines(sketchRecord(record)));
  if (fit && !parts.length) stage.fit();
  render();
}
async function openSketch(saved = null, importFirst = false, imported) {
  const picked =
    !saved && !editing && region?.planar && selectedFaces.length === 1
      ? region
      : null;
  const face =
    saved?.plane === 'face'
      ? workplane('face', -saved.offset, sketchRecord(saved).frame)
      : picked
        ? (activeGrid?.frame ?? {
            ...workplane('face', 0, picked),
            origin: pickSeed.point,
          })
        : null;
  const referenceLoops =
    saved?.referenceLoops ??
    (picked && activeGrid ? activeGrid.loops : null) ??
    (picked?.loops ?? []).map((loop) =>
      loop.map(([x, y]) => [x - picked.anchor[0], y - picked.anchor[1]]),
    );
  const attachment =
    saved?.attachment ??
    (picked
      ? { ...defaultHolePlacement(picked, toolPart()), partId: selected }
      : null);
  const number =
    project.editor.ops.filter((op) => op.type === 'sketch').length + 1;
  const recordId = saved?.id ?? uid();
  let settings = {
    sketch: saved?.sketch ?? imported?.drawing,
    name: saved?.name ?? imported?.name ?? 'Sketch ' + number,
    plane: saved?.plane ?? (face ? 'face' : 'xy'),
    offset: saved?.offset ?? 0,
    hasFace: !!face,
    grid: saved
      ? (surfaceCache.get(saved)?.config ?? saved.grid ?? defaultSketchGrid())
      : picked
        ? activeGrid?.config
        : undefined,
    referenceLoops,
    importFirst,
  };
  while (true) {
    const drawing = await editSketch(settings);
    if (!drawing) return;
    const { plane, offset, name, entities, grid } = drawing;
    const record = {
      id: recordId,
      type: 'sketch',
      label: name,
      name,
      plane,
      offset,
      frame: workplane(plane, offset, face),
      sketch: { entities },
      grid,
    };
    if (plane === 'face') {
      record.referenceLoops = referenceLoops;
      if (attachment) record.attachment = attachment;
    }
    const ops = saved
      ? project.editor.ops.map((op) => (op.id === saved.id ? record : op))
      : [...project.editor.ops, record];
    let failure;
    if (
      await rebuild(
        { ...project, editor: { ...project.editor, ops } },
        {
          onError: (err) => {
            failure = err.message;
          },
        },
      )
    ) {
      selectSketch(recordId, true);
      return;
    }
    if (!failure) return;
    // Keep the entered dimensions available when a dependent feature cannot rebuild.
    settings = {
      ...settings,
      sketch: { entities },
      grid,
      name,
      plane,
      offset,
      importFirst: false,
      error: failure,
    };
    notice(failure);
  }
}
actions['new-sketch'] = () => openSketch();
actions['import-outline'] = () => openSketch(null, true);
actions['edit-active-sketch'] = () =>
  openSketch(project.editor.ops.find((op) => op.id === activeSketchId));
actions['sketch-on-grid'] = () =>
  activeSketchId ? actions['edit-active-sketch']() : openSketch();
actions['new-design'] = async () => {
  closeDialog();
  const name = 'Untitled design';
  // A new model is not the Library part that was open: drop that link, or
  // Save to Library would overwrite the part with the new model.
  const { stlPart: _openPart, ...rest } = project;
  await rebuild(
    {
      ...rest,
      mode: 'editor',
      name,
      editor: { source: { empty: true, label: name }, ops: [] },
    },
    { fit: true },
  );
};
actions['inspect-stl'] = () => filePick('inspect-stl', '.stl');
async function openSurfaceBrush(saved) {
  cancelLive();
  const target = saved?.target ?? selected;
  const source = saved
    ? (await call('historySource', saved.id)).find((part) => part.id === target)
    : parts.find((part) => part.id === target);
  if (!source) throw Error('Select a part to edit its surface.');
  const id = saved?.id ?? uid();
  function proposed(edit) {
    const op = {
      ...edit,
      id,
      target,
      label: edit.method === 'smooth' ? 'Smooth surface' : 'Remove and patch',
    };
    const ops = saved
      ? project.editor.ops.map((o) => (o.id === id ? op : o))
      : [...project.editor.ops, op];
    return { ...project, editor: { ...project.editor, ops } };
  }
  try {
    await editSurface(
      source,
      saved,
      async (edit) => {
        const next = proposed(edit);
        if (saved) {
          next.editor = {
            ...next.editor,
            ops: next.editor.ops.slice(
              0,
              next.editor.ops.findIndex((o) => o.id === id) + 1,
            ),
          };
          // Switched-off steps after the cut are no longer in the history.
          const kept = new Set(next.editor.ops.map((o) => o.id));
          const off = next.editor.off?.filter((o) => kept.has(o));
          if (off?.length) next.editor.off = off;
          else delete next.editor.off;
        }
        return (await call('preview', next)).find((p) => p.id === target);
      },
      (edit) => rebuild(proposed(edit), { selectId: target }),
      call,
    );
  } finally {
    if (saved) await call('forgetHistory', id);
  }
}
actions['surface-brush'] = () => openSurfaceBrush(null);
async function importFile(file, intent) {
  if (!file || busy) return;
  const ext = file.name.split('.').at(-1).toLowerCase();
  if(ext==='slotplan') {
    if(file.size>64*1024*1024)throw Error('Choose a layout smaller than 64 MB.');
    const data=JSON.parse(await file.text());
    await showPlanner();await planner.openFile(data);return;
  }
  leavePlanner();
  const limit = ['slotfab', 'json'].includes(ext)
    ? 256
    : ext === 'stl'
      ? 96
      : 16;
  if (file.size > limit * 1024 * 1024)
    throw Error(
      'Choose a ' + ext.toUpperCase() + ' file smaller than ' + limit + ' MB.',
    );
  const next = clone(project);
  if (ext === 'slotfab' || ext === 'json') {
    const loaded = checkProject(JSON.parse(await file.text()));
    if (await rebuild(loaded, { fit: true })) {
      editing = null;
      art = null;
      formKind = null;
      render();
    }
  } else if (ext === 'stl') {
    const sourceBytes = new Uint8Array(await file.arrayBuffer());
    const clipType = clipTypeFromSTL(sourceBytes);
    const bytes = await reviewSTL(sourceBytes, call, {
      inspect: intent === 'inspect-stl',
      append: intent === 'add-model',
    });
    if (!bytes) return;
    const data = toBase64(bytes);
    if (intent === 'add-model') {
      const draft = hasLiveEdit() ? candidate() : null;
      const model = draft?.next ?? next;
      const id = uid();
      model.mode = 'editor';
      model.editor.ops.push({
        type: 'addModel',
        id,
        name: file.name,
        data,
        clipType,
        label: 'Add ' + file.name,
      });
      await rebuild(model, { fit: true, selectId: id });
      return;
    }
    next.mode = 'editor';
    next.name = file.name.replace(/\.stl$/i, '');
    // A newly opened STL is not linked to the Library part that was open.
    delete next.stlPart;
    next.editor = {
      source: {
        label: file.name,
        data,
        clipType,
      },
      ops: [],
    };
    if (await rebuild(next, { fit: true })) {
      editing = null;
      art = null;
      formKind = null;
      render();
    }
  } else if (['dxf', 'svg'].includes(ext)) {
    if (
      project.mode === 'editor' &&
      intent !== 'art' &&
      intent !== 'circuit' &&
      (!parts.length || activeSketchId || isSolidTool(editorTab))
    ) {
      const drawing = importSketchDrawing(await file.text(), ext);
      await openSketch(null, false, {
        drawing,
        name: file.name.replace(/\.[^.]+$/, '').slice(0, 120),
      });
      if (drawing.warnings.length) notice(drawing.warnings.join(' '));
      return;
    }
    const drawing = await call('parse', { text: await file.text(), ext });
    if (
      intent === 'art' ||
      (intent !== 'circuit' && project.mode === 'editor')
    ) {
      if (!drawing.shapes.length)
        throw Error('The artwork needs at least one closed outline.');
      const flat = drawing.shapes.flat();
      const b = flat.reduce(
        (b, [x, y]) => [
          Math.min(b[0], x),
          Math.min(b[1], y),
          Math.max(b[2], x),
          Math.max(b[3], y),
        ],
        [Infinity, Infinity, -Infinity, -Infinity],
      );
      const mid = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
      art = {
        name: file.name,
        loops: drawing.shapes.map((loop) =>
          loop.map(([x, y]) => [x - mid[0], y - mid[1]]),
        ),
      };
      if (editorTab !== 'cut-shape') editorTab = 'shape';
      formKind = 'drawing';
      const existing = formDrafts.get(draftKey());
      if (existing) delete existing.profileKind;
      toolArmed =
        !!region || !!project.editor.ops.find((op) => op.id === editing)?.frame;
      renderInspector();
      status(
        'Artwork loaded · ' +
          fmt(b[2] - b[0]) +
          ' × ' +
          fmt(b[3] - b[1]) +
          ' mm. Select a surface.',
      );
    } else {
      if (!drawing.lanes.length)
        throw Error(
          'Export the SLOT_CENTRES layer from Circuit to identify the lanes.',
        );
      drawing.warnings = [
        ...(drawing.warnings || []),
        ...profileWarnings(drawing, next.track.params),
      ];
      const profile = { ...next.track.params, ...drawing.inferredWidths };
      const inspect = (width) =>
        call('flatImport', {
          lanes: drawing.lanes,
          heights: drawing.heights,
          width,
          profile,
        });
      const crossing = await inspect(profile.width);
      if (crossing) {
        const singleLane = drawing.lanes.length === 1 ? drawing.lanes[0] : null;
        const openLane =
          singleLane &&
          Math.hypot(
            singleLane[0][0] - singleLane.at(-1)[0],
            singleLane[0][1] - singleLane.at(-1)[1],
          ) > 1e-5;
        showFlatImport({
          showDialog,
          closeDialog,
          inspect,
          width: profile.width,
          initial: crossing,
          hasDeck: drawing.outlines.length || drawing.tables.length || openLane,
          original: () =>
            installPlan(
              {
                ...drawing,
                outlines: drawing.outlines.length
                  ? drawing.outlines
                  : drawing.tables,
              },
              file.name,
            ),
          apply: (flatCrossing, width) =>
            installPlan(
              {
                ...drawing,
                flatCrossing,
                outlines: flatCrossing.sections.flatMap(
                  (section) => section.outlines,
                ),
              },
              file.name,
              {
                width,
                lanes: Math.max(
                  ...flatCrossing.sections.map((s) => s.lanes.length),
                ),
                bridgeSupportCount: 0,
              },
            ),
          onError: reportActionError,
        });
      } else if (!drawing.outlines.length && drawing.tables.length) {
        showDialog(
          'Use the table outline?',
          '<p class="hint">This drawing contains a table boundary and no separate road outline. Use it as the deck for this import?</p>' +
            button('accept-table', 'Use table as deck', 'check', 'primary'),
        );
        actions['accept-table'] = async () => {
          closeDialog();
          drawing.outlines = drawing.tables;
          await installPlan(drawing, file.name);
        };
      } else await installPlan(drawing, file.name);
    }
    if (drawing.warnings?.length) notice(drawing.warnings.join(' '));
  } else throw Error('Choose an STL, SVG, DXF, or .slotfab project.');
}
async function installPlan(drawing, name, dimensions = {}) {
  // Import-time details (spot heights, where sizes came from) stay out of the
  // saved project; the plan keeps only the geometry it builds from.
  const { heights, profileSource, ...plan } = drawing;
  const next = clone(project);
  delete next.libraryPiece;
  next.mode = 'track';
  next.name = name.replace(/\.[^.]+$/, '');
  next.track = {
    plan,
    sourceName: name,
    params: {
      ...next.track.params,
      ...plan.inferredWidths,
      ...dimensions,
      kind: 'import',
      segments: 1,
      borderSegments: 1,
      borderSide: 'none',
      whiteLineRoad: 'none',
      roadCentreLine: 'none',
      roadKerbSide: 'none',
      whiteLineBorder: 'none',
      joint: 'none',
      jointStart: 'none',
      jointEnd: 'none',
      borderMount: 'none',
      borderJoint: 'none',
    },
  };
  delete next.track.params.borderEnds;
  delete next.track.params.special;
  delete next.track.params.startingGrid;
  delete next.track.params.laneAdjustment;
  delete next.track.params.slotPosition;
  if (await rebuild(next, { fit: true })) {
    trackTab = 'geometry';
    renderInspector();
  }
}
async function openFile(file, intent) {
  if (starting || busy || inAction) {
    notice('Finish the current operation before opening another file.');
    return;
  }
  acting(true);
  leaveHome();
  leaveLibraryPage();
  try {
    await importFile(file, intent);
  } catch (e) {
    notice(e.message);
  } finally {
    acting(false);
  }
}
$('#file').addEventListener('change', () =>
  openFile($('#file').files[0], fileIntent),
);
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length) openFile(e.dataTransfer.files[0], 'open');
});

function validateForm(form, report) {
  if (form.checkValidity()) return;
  const field = form.querySelector(
    'input:invalid, select:invalid, textarea:invalid',
  );
  if (report && field) {
    // A setting in a collapsed group is opened, so the browser can point
    // at it. A form behind another page (Settings, the Library) cannot
    // take focus; the notice below names the setting instead.
    for (let el = field.parentElement; el && el !== form; el = el.parentElement)
      if (el.tagName === 'DETAILS' && !el.open) el.open = true;
    // An open modal dialog (the Library, say) makes the page behind inert.
    const modal = document.querySelector('dialog:modal');
    if (field.offsetParent !== null && (!modal || modal.contains(field)))
      form.reportValidity();
  }
  const label = field?.labels?.[0]?.firstElementChild?.textContent.trim();
  throw Error(
    [label, field?.validationMessage].filter(Boolean).join(' — ') ||
      'Check the highlighted setting.',
  );
}
function values(form, report = true) {
  if (report) validateForm(form, true);
  const result = {};
  for (const input of form.elements) {
    if (!input.name) continue;
    // A half-typed apex value can remain in the draft while its side is off.
    // Preserve its applied setting if the user saves with that side hidden.
    if (
      input.type === 'number' && input.closest('.border-apex-fields:disabled')
    ) {
      const value = input.valueAsNumber;
      if (!Number.isFinite(value) || value < Number(input.min) || value > Number(input.max))
        continue;
    }
    result[input.name] =
      input.type === 'checkbox'
        ? input.checked
        : input.type === 'number'
          ? input.valueAsNumber
          : input.value;
  }
  return result;
}
function opFromForm(f) {
  const old = project.editor.ops.find((o) => o.id === editing);
  const base = {
    id: old?.id ?? (newEditId ??= uid()),
    target: old?.target ?? selected,
  };
  if (['primitive', 'revolve', 'edge-finish'].includes(editorTab)) {
    if (!old) base.curveVersion = 2;
    else if (old.curveVersion != null) base.curveVersion = old.curveVersion;
  }
  if (isSolidTool(editorTab)) {
    if (editorTab === 'primitive') {
      base.frame =
        old?.frame ?? workplane(region?.planar ? 'face' : 'xy', 0, region);
      if (!old && region?.planar && pickSeed?.point)
        base.frame.origin = pickSeed.point.slice();
    }
    return createSolidOperation(editorTab, f, base);
  }
  if (editorTab === 'hole-modify')
    return holeModifyOperation(f, base, featureContext(old));
  if (editorTab === 'stretch-section' || editorTab === 'heal-feature')
    return healStretchOperation(editorTab, f, base, featureContext(old));
  if (isFeatureTool(editorTab))
    return featureOperation(editorTab, f, base, featureContext(old));
  if (['hollow', 'simplify', 'text'].includes(editorTab))
    return solidToolOperation(editorTab, f, base, region, old);
  if (assemblyTab(editorTab)) {
    const members = selectedParts();
    const target = f.assemblyTarget;
    const others = members.filter((p) => p.id !== target);
    if (members.length < 2 || !members.some((p) => p.id === target))
      throw Error('Select two or more parts in the parts list.');
    if (editorTab === 'combine-parts')
      return {
        ...base,
        target,
        type: 'combineParts',
        method: f.combineMethod,
        tools: others.map((p) => p.id),
        label:
          { join: 'Join', subtract: 'Subtract', intersect: 'Intersect' }[
            f.combineMethod
          ] +
          ' ' +
          members.length +
          ' parts',
      };
    if (members.length !== 2) throw Error('Choose exactly two parts to align.');
    const reference = others[0].id;
    const op = {
      ...base,
      target,
      reference,
      type: 'alignParts',
      alignment: f.alignment,
      gap: f.partGap ?? 0,
      label: 'Align parts',
    };
    if (f.alignment === 'faces') {
      op.sourceFace = assemblyFaces.get(target);
      op.destinationFace = assemblyFaces.get(reference);
      if (!op.sourceFace || !op.destinationFace)
        throw Error('Pick a face on each part to see the alignment.');
    }
    return op;
  }
  if (editorTab === 'trim-face' || editorTab === 'trim-top') {
    const part = toolPart();
    const frame = trimFrame(part, old);
    if (
      !part ||
      !frame ||
      (editorTab === 'trim-face' && region && !region.planar)
    )
      throw Error('Select a flat face to set the cut direction.');
    const measure = faceTrimMetrics(
      part.positions,
      frame,
      f.trimMode,
      f.trimAmount,
    );
    if (!measure.valid) throw Error(measure.issue);
    return {
      ...base,
      type: 'trimFace',
      label: editorTab === 'trim-top' ? 'Cut off top' : 'Trim from face',
      reference: editorTab === 'trim-top' ? 'top' : 'face',
      frame: {
        origin: frame.origin,
        normal: frame.normal,
        u: frame.u,
        v: frame.v,
      },
      trimMode: f.trimMode,
      amount: f.trimAmount,
    };
  }
  if (editorTab === 'move-face') {
    const profiles = moveProfiles(old);
    if (!profiles.length) throw Error('Select a flat face to move.');
    const mode = f.faceMoveMode;
    const value = mode === 'height' ? f.faceHeight : f.faceDistance;
    const plan = movePlan(profiles, mode, value);
    if (!plan?.valid) throw Error(plan?.issue || 'Select a flat face to move.');
    const faceCount = selectedFaces.length || old?.faceCount || profiles.length;
    const refs = selectedFaces.length
      ? selectedFaces.map(({ seed, boundaryAngle, feature }) => ({
          triangle: seed.triangle,
          point: seed.point,
          whole: !!seed.whole,
          tolerance: boundaryAngle,
          ...(feature === 'post' ? { feature } : {}),
        }))
      : old?.faceRefs;
    const common = {
      ...base,
      tool: 'move-face',
      label: faceCount > 1 ? 'Move ' + faceCount + ' faces' : 'Move face',
      faceCount,
      ...(refs ? { faceRefs: refs } : {}),
      separate: !!f.separate && plan.changes.every(({ delta }) => delta >= 0),
    };
    if (
      mode === 'height' ||
      region?.coplanar === false ||
      (!selectionReplaced && old?.type === 'moveFaces')
    ) {
      const op = {
        ...common,
        type: 'moveFaces',
        moveMode: mode,
        value,
        faces: profiles,
      };
      // A legacy edit can have one saved outline for a group whose pick hints
      // no longer resolve. Its entire outline still moves from one known plane.
      if (profiles.length !== faceCount) {
        op.faceCount = profiles.length;
        delete op.faceRefs;
      }
      return op;
    }
    const frame = !selectionReplaced && old?.frame ? old.frame : region;
    return {
      ...common,
      type: value < 0 ? 'cut' : 'add',
      profileKind: 'face',
      depth: Math.abs(value),
      frame: {
        origin: frame.origin,
        normal: frame.normal,
        u: frame.u,
        v: frame.v,
      },
      loops: !selectionReplaced && old?.loops ? old.loops : region.loops,
    };
  }
  if (editorTab === 'split')
    return {
      ...base,
      type: f.splitKind,
      axis: f.axis,
      position: f.position,
      keep: f.keep,
      rebuild: f.rebuild,
      band: f.band,
      center: [f.cx, f.cy],
      startAngle: f.start,
      endAngle: f.end,
      splitAngle: f.splitAngle,
      bandAngle: f.bandAngle,
      label: f.rebuild ? 'Split and rebuild' : 'Split',
    };
  if (editorTab === 'transform')
    return {
      ...old,
      ...base,
      type: 'transform',
      move: [f.mx, f.my, f.mz],
      rotate: [f.rx, f.ry, f.rz],
      scale: f.scale,
      mirror: f.mirror,
      label: old?.label ?? 'Transform',
    };
  if (editorTab === 'tilt') {
    const face = region ?? old?.frame;
    if (!face || (region && !region.planar))
      throw Error('Select a flat face with a straight boundary to tilt.');
    return {
      ...base,
      type: 'tiltFace',
      label: 'Tilt face',
      frame: { origin: face.origin, normal: face.normal, u: face.u, v: face.v },
      loops: region?.loops ?? old?.loops,
      pivot: f.pivot,
      angle: f.faceAngle,
      hingeRotation: f.hingeRotation,
      pivotOffset: f.pivotOffset,
      separate: f.faceAngle > 0 && !!f.separate,
    };
  }
  const frame = region ?? old?.frame;
  if (!frame) throw Error('Click a surface in the viewport first.');
  let loops;
  if (f.profileKind === 'face') {
    if (region && !region.planar)
      throw Error(
        'This selection is curved. Choose a flat face or place a drawn shape on the tangent plane.',
      );
    loops = region?.loops ?? old?.loops;
  } else if (f.profileKind === 'drawing') {
    loops = art?.loops ?? old?.loops;
  } else {
    loops = [shapeOutline(f.profileKind, f.shapeWidth, f.shapeHeight)];
  }
  const baseOffset =
    f.profileKind === 'face'
      ? [0, 0]
      : (region?.anchor ?? old?.baseOffset ?? [0, 0]);
  return {
    ...base,
    type: f.operation,
    label:
      (f.operation === 'cut' ? 'Cut ' : 'Add ') +
      (f.profileKind === 'drawing'
        ? (art?.name ?? old?.artName ?? 'artwork')
        : f.profileKind),
    frame: {
      origin: frame.origin,
      normal: frame.normal,
      u: frame.u,
      v: frame.v,
    },
    loops,
    profileKind: f.profileKind,
    artName: art?.name ?? old?.artName,
    ...(f.operation === 'cut' && f.extent === 'through'
      ? { extent: 'through' }
      : { depth: f.depth }),
    tilt: f.tilt,
    tiltAzimuth: f.azimuth,
    rotation: f.rotation,
    shapeWidth: f.shapeWidth,
    shapeHeight: f.shapeHeight,
    scale: f.drawingScale ?? 1,
    drawingScale: f.drawingScale,
    baseOffset,
    userOffset: [f.dx, f.dy],
    offset: [baseOffset[0] + f.dx, baseOffset[1] + f.dy],
    separate: f.operation === 'add' && f.separate,
  };
}
function candidate(report = true) {
  const form = $('#settings-form');
  validateForm(form, report);
  const fields = values(form, false);
  if (project.mode === 'track') {
    const params = { ...project.track.params };
    let nextTrack = project.track;
    const pages = new Map(trackFields);
    // Visiting a clean component must not add its untouched default fields
    // to another component's pending edit, including in older projects.
    if (!pages.size || pages.has(draftKey())) pages.set(draftKey(), fields);
    for (const [pageKey, page] of pages) {
      for (const [key, value] of Object.entries(
        parseConnectionControls(readTrackShapeFields(page, { ...nextTrack, params }), params, formDrafts.get(pageKey)),
      )) {
        // Both Road and Borders display these dimensions. Only the page
        // holding the edit may replace the applied value.
        if (
          sharedPaintFields.includes(key) &&
          !(key in (formDrafts.get(pageKey) ?? {}))
        )
          continue;
        if (/^crossingUpper\d+$/.test(key)) {
          const index = Number(key.slice('crossingUpper'.length));
          const layout = nextTrack.plan?.flatCrossing;
          if (
            layout?.crossings[index] &&
            layout.crossings[index].upperPass !== value
          ) {
            const crossings = layout.crossings.map((c, i) =>
              i === index ? { ...c, upperPass: value } : c,
            );
            nextTrack = {
              ...nextTrack,
              plan: {
                ...nextTrack.plan,
                flatCrossing: { ...layout, crossings },
              },
            };
            if (nextTrack.custom)
              nextTrack.custom = {
                ...nextTrack.custom,
                upperPasses: crossings.map((c) => c.upperPass),
              };
          }
        } else if (/^(inner|outer)Apex(Width|Percent)$/.test(key)) {
          // Keep inherited values in older projects until this side is edited.
          if (key in (formDrafts.get(pageKey) ?? {})) {
            if (key.endsWith('Percent'))
              params[key.replace('Percent', 'Position')] = value / 100;
            else params[key] = value;
          }
        } else if (key === 'jointFitVersion') {
          if (Number(value) === 2 || params.jointFitVersion != null)
            params.jointFitVersion = Number(value);
        } else if (
          ((key === 'tabThickness' || key === 'screwLength') && !Number.isFinite(value)) ||
          (key === 'mutedPlacements' && !value.length) ||
          (value === '' && ['jointStart', 'jointEnd', 'clipType', ...Object.keys(SCREW_SIDE_FIELDS)].includes(key))
        )
          delete params[key];
        else params[key] = value;
      }
    }
    if (params.jointFitVersion === 1) {
      for (const key of [
        'tabClearance',
        'tabWidth',
        'tabLength',
        'tabThickness',
        'clipType',
      ])
        delete params[key];
    }
    if (params.kind === 'import' && !nextTrack.custom)
      delete params.laneAdjustment;
    // Drawn paths, drawings and special pieces keep a centred slot,
    // whichever page changed the piece. Slots that a new width or spacing
    // puts where a centred piece has them are centred too.
    if (!slotPositionAllowed(params)) delete params.slotPosition;
    else if (params.slotPosition) {
      const slot = normaliseSlotPosition(params);
      if (slot) params.slotPosition = slot;
      else delete params.slotPosition;
    }
    if (nextTrack.curveFamily) {
      const family = nextTrack.curveFamily;
      if (
        params.kind !== 'curve' ||
        Math.abs(
          params.radius -
            (family.r1InnerRadius + (family.index - 0.5) * params.width),
        ) > 1e-6
      ) {
        nextTrack = { ...nextTrack };
        delete nextTrack.curveFamily;
      }
    }
    return {
      next: {
        ...project,
        track: refreshCustomTrack({ ...nextTrack, params }),
      },
      selectId: selected,
    };
  }
  const op = opFromForm(fields);
  const ops = editing
    ? project.editor.ops.map((item) => (item.id === editing ? op : item))
    : [...project.editor.ops, op];
  return {
    next: { ...project, editor: { ...project.editor, ops } },
    op,
    selectId:
      op.separate || (op.type === 'createSolid' && op.result === 'new')
        ? op.id
        : op.target,
  };
}
async function applyForm() {
  await queueRegroup();
  if (repickError && project.mode === 'editor' && isFaceTool(editorTab))
    throw repickError;
  const appliedAngle = $('#settings-form [name="tolerance"]')?.valueAsNumber;
  const { next, selectId } = candidate();
  const previous = new Map();
  if (project.mode === 'track') {
    for (const [key, draft] of formDrafts) {
      const baselines = trackBaselines.get(key);
      if (!baselines) continue;
      const old = Object.fromEntries(
        Object.keys(draft).map((name) => [name, baselines[name]]),
      );
      if ('jointFitVersion' in draft) {
        const fit = resolveJointFit(project.track.params);
        old.clipClearance = fit.clipClearance;
        if (fit.version === 2) old.tabClearance = fit.tabClearance;
      }
      Object.assign(old, gridRestoreValues(project.track.params, next.track.params, draft));
      if ('slotEdge' in baselines)
        Object.assign(old, slotRestoreValues(project.track.params, next.track.params, draft));
      previous.set(key, old);
    }
  }
  if (
    await rebuild(next, {
      selectId,
      fit: !parts.length,
      onError: reportDraftFailure,
    })
  ) {
    if (Number.isFinite(appliedAngle)) tolerance = appliedAngle;
    previousTrackFields = previous;
    editing = null;
    renderInspector();
    return true;
  }
  return false;
}
function hasLiveEdit() {
  return (
    pickMode !== 'measure' &&
    (project.mode === 'track'
      ? trackFields.size > 0
      : editorTab !== 'select' &&
        liveState !== 'unchanged' &&
        toolArmed &&
        (activeTrial || formDrafts.has(draftKey())))
  );
}
async function applyForOutput() {
  await queueRegroup();
  if (hasLiveEdit() && !(await applyForm()))
    throw Error('Fix the live edit or use Restore before exporting or saving.');
}
function livePartCount(count) {
  liveStatus('ready', 'Live · ' + count + (count === 1 ? ' part' : ' parts'));
}
function liveStatus(state, message, warning = null) {
  liveState = state;
  activeWarning = warning;
  const el = $('#live-status');
  if (el) {
    el.dataset.state = state;
    el.toggleAttribute('data-connector-warning', Boolean(warning));
    if (warning) {
      el.innerHTML =
        '<strong>' +
        esc(warning.location) +
        '</strong><p>' +
        esc(warning.reason) +
        '</p><p>' +
        esc(warning.advice) +
        '</p>' +
        (warning.setting
          ? button(
              'show-warning-setting',
              warning.setting.label,
              'arrow',
              'secondary',
            )
          : '');
    } else el.textContent = message;
  }
  const draftKind = activeTrial?.next.track.params.kind;
  const shapeNames = {
    straight: 'straight',
    curve: 'corner',
    import: 'drawn road',
  };
  const failedShapeChange =
    state === 'error' &&
    project.mode === 'track' &&
    draftKind &&
    draftKind !== project.track.params.kind;
  $('#view-model-state').textContent = failedShapeChange
    ? 'Showing applied ' +
      shapeNames[project.track.params.kind] +
      ' · ' +
      shapeNames[draftKind] +
      ' could not build'
    : warning
      ? 'Showing last applied model'
      : 'Solid view';
  $('[data-action="view-fit-warning"]').hidden = !warning;
  const saving = $('[data-action="save"] span');
  const pending = hasLiveEdit();
  if (saving) saving.textContent = pending ? 'Apply & save' : 'Save';
  $('[data-action="save"]').setAttribute('aria-label', pending ? 'Apply changes and save project' : 'Save project');
  const exportMenuButton = $('[data-action="export-menu"]');
  exportMenuButton.title = pending ? 'Choose an export and apply the live edit' : 'Choose STL or print kit';
}
function showCommitted() {
  if (
    project.mode === 'track' &&
    !trackFields.size &&
    !current() &&
    parts.length
  )
    selected = parts[0].id;
  if (!shownDraft && displayedHistory === historyInput) return;
  shownDraft = null;
  displayedHistory = historyInput;
  const sourceParts = historyInput?.parts ?? parts;
  stage.setPickSource(null);
  stage.setParts(sourceParts, false, hidden);
  stage.select(selected, hidden);
  if (region && !pickedEdges.length)
    stage.highlightRegions(selected, selectedFaces);
  renderParts(sourceParts);
}
function cancelLive() {
  live.cancel();
  activeTrial = null;
  showCommitted();
}
function updateGuides() {
  if (editorTab === 'simplify' && project.mode === 'editor')
    void updateSilhouette(
      $('#settings-form'),
      toolPart(),
      shownDraft?.result.find((p) => p.id === selected),
    );
  const savedFace = project.editor.ops.find((op) => op.id === editing);
  const form = $('#settings-form');
  const move = faceMoveState(form, savedFace);
  const face =
    region ??
    (!selectionReplaced
      ? (savedFace?.frame ?? savedFace?.faces?.[0]?.frame)
      : null);
  syncFaceLevels(form, move.plan);
  const trimSize = $('#trim-size');
  if (trimSize) {
    const form = $('#settings-form'),
      part = toolPart(),
      frame = trimFrame(part, savedFace);
    const mode = form.elements.trimMode.value;
    const amount = form.elements.trimAmount;
    amount.labels[0].firstElementChild.textContent =
      form.elements.trimMode.selectedOptions[0].textContent;
    if (part && frame) {
      const m = faceTrimMetrics(
        part.positions,
        frame,
        mode,
        amount.valueAsNumber,
      );
      const result =
        shownDraft && shownDraft.trial === activeTrial
          ? shownDraft.result.find((item) => item.id === selected)
          : null;
      const remaining = result
        ? faceTrimMetrics(result.positions, frame, mode, amount.valueAsNumber)
            .height
        : m.remaining;
      trimSize.textContent =
        (Math.abs(m.normal[2]) > 0.999999
          ? 'Part height'
          : 'Thickness along face normal') +
        ' · ' +
        fmt(m.height) +
        (m.valid ? ' → ' + fmt(remaining) : '') +
        ' mm';
    }
  }
  const sizeChange = $('#face-size-change');
  if (sizeChange) {
    const axis = face?.normal.findIndex((n) => Math.abs(n) > 0.999999);
    const original = toolPart();
    sizeChange.hidden = !(axis >= 0 && original);
    if (!sizeChange.hidden) {
      const result =
        shownDraft?.result.find((part) => part.id === original.id) ?? original;
      const extent = (part) =>
        fmt(part.bounds.max[axis] - part.bounds.min[axis]);
      const before = extent(original),
        after = extent(result);
      sizeChange.textContent =
        ['Part width', 'Part depth', 'Part height'][axis] +
        ' · ' +
        (before === after ? before : before + ' → ' + after) +
        ' mm';
    }
  }
  const creationOp = activeTrial?.op;
  const findSketch = (id) => {
    if (!id || project.mode !== 'editor') return null;
    const record = project.editor.ops.find(
      (o) => o.id === id && o.type === 'sketch',
    );
    return record && sketchRecord(record);
  };
  const designSketch = findSketch(creationOp?.sketchId ?? activeSketchId);
  setGuides({
    designSketch,
    shownMoveOp: shownDraft?.trial.op,
    rigidMoveAllowed: !editing || editing === project.editor.ops.at(-1)?.id,
    designSecondary: findSketch(creationOp?.pathId ?? creationOp?.sectionId),
    extrusion: extrusionGuide(designSketch, creationOp),
    blank: project.mode === 'editor' && !parts.length,
    mode: project.mode,
    tab:
      project.mode === 'track'
        ? guideTab(
            trackTab,
            focusedField,
            (activeTrial ?? shownDraft?.trial)?.next.track.params ?? project.track.params,
          )
        : editorTab,
    part: hidden.has(selected) ? null : toolPart(),
    resultPart: shownDraft?.result.find(
      (p) => p.id === shownDraft.trial.selectId,
    ),
    parts: (shownDraft?.result ?? historyInput?.parts ?? parts).filter(
      (p) => !hidden.has(p.id),
    ),
    track:
      liveState === 'error'
        ? project.track
        : (activeTrial?.next.track ?? project.track),
    op: activeTrial?.op ?? null,
    pickedEdges,
    edgeScope: form?.elements.edgeScope?.value ?? 'corner',
    modifyError: liveState === 'error' ? $('#live-status')?.textContent : '',
    region,
    face,
    facePoint: pickSeed?.point,
    faceDistance: $('#settings-form [name="faceDistance"]')?.valueAsNumber,
    faceProfiles: move.profiles,
    facePlan: move.plan,
    faceMoveMode: move.mode,
    faceHeight: form?.elements.faceHeight?.valueAsNumber,
    measurePoints,
    measuring: pickMode === 'measure',
    field: focusedField,
    plate: dialogPlate ?? project.plate,
    plateFit: dialogPlateFit,
    plateVisible: $('#plate-form') != null && $('#dialog').open,
  });
}
function showDraftError(error) {
  showCommitted();
  liveStatus('error', error.message, error.warning);
  const apply = $('#settings-form [data-action="apply"]');
  if (project.mode === 'editor' && apply) apply.disabled = true;
  updateGuides();
}
function reportDraftFailure(error) {
  if (error.warning) showDraftError(error);
  throw error;
}
function refreshLive() {
  const form = $('#settings-form');
  const isTrack = project.mode === 'track';
  if (!isTrack && (editorTab === 'select' || pickMode === 'measure')) {
    cancelLive();
    liveStatus('idle', 'Live view');
    updateGuides();
    return;
  }
  if (!form || (!parts.length && !isSolidTool(editorTab))) return;
  const wantsSolid =
    pickMode !== 'measure' && (isTrack ? trackFields.size > 0 : toolArmed);
  live.cancel();
  activeTrial = null;
  try {
    if (
      !isTrack &&
      editorTab === 'align-parts' &&
      form.elements.alignment?.value === 'faces' &&
      (pendingMate || !selectedParts().every((p) => assemblyFaces.has(p.id)))
    ) {
      showCommitted();
      liveStatus(
        'idle',
        pendingMate
          ? 'Click a flat face on the visible part.'
          : 'Pick a face on each part.',
      );
      form.querySelector('[data-action="apply"]').disabled = true;
      updateGuides();
      return;
    }
    const move = faceMoveState(
      form,
      project.editor.ops.find((op) => op.id === editing),
    );
    if (move.mode) syncOperationControls(form, move.plan);
    if (!isTrack && isFaceTool(editorTab) && repickError) throw repickError;
    if (
      !isTrack &&
      region &&
      !region.planar &&
      ['trim-face', 'move-face', 'tilt', 'hollow'].includes(editorTab)
    )
      throw Error(
        'Choose a flat face for this tool. Add profile and Cut profile also work on a curved surface.',
      );
    const atCommonHeight =
      move.mode === 'height' &&
      move.value >= 0 &&
      move.plan?.changes.length &&
      move.plan.changes.every(({ delta }) => delta === 0);
    const zeroMove = move.mode === 'offset' && move.value === 0;
    if (
      !zeroMove &&
      !atCommonHeight &&
      (isTrack ||
        editorTab === 'split' ||
        editorTab === 'trim-top' ||
        editorTab === 'transform' ||
        editorTab === 'simplify' ||
        isSolidTool(editorTab) ||
        isFeatureTool(editorTab) ||
        assemblyTab(editorTab) ||
        region ||
        editing)
    )
      activeTrial = candidate(false);
    if (isTrack && trackTab === 'geometry' && activeTrial) {
      fitUneditedPitGrid(form, activeTrial.next.track.params);
      syncPitAssemblyNotes(form, activeTrial.next.track.params);
      showSlotAdvice(form, activeTrial.next.track.params);
    }
    if (isTrack && trackTab === 'profile' && activeTrial) {
      const figure = form.querySelector('figure');
      if (figure) {
        const markup = profileDiagram(activeTrial.next.track.params);
        if (markup) figure.outerHTML = markup;
      }
    }
    if (isTrack && trackTab === 'borders' && activeTrial)
      unmountHandles?.update?.(activeTrial.next.track.params);
    if (isTrack && ['geometry', 'borders', 'markings'].includes(trackTab) && activeTrial) {
      syncPaintControls(form, activeTrial.next.track.params);
      // The hint under Centre line follows a slot position still being edited.
      syncCentreSlotNote(form, activeTrial.next.track.params);
    }
    if (isTrack && trackTab === 'joints' && activeTrial) {
      const figure = form.querySelector('[data-joint-fit]');
      if (figure)
        figure.outerHTML = jointFitDiagram(activeTrial.next.track.params);
      const clip = form.querySelector('[data-clip-diagram]');
      if (clip) {
        const showInstructions = clip.querySelector('.retainer-help')?.open;
        clip.outerHTML = jointsClipDiagram(activeTrial.next.track.params);
        if (showInstructions) form.querySelector('.retainer-help').open = true;
      }
    }
    // Component navigation can change the inspector while the printable geometry
    // and plate stay identical. Compare just the small parameter record. Imported
    // drawing paths and the current plate retain their identity through a draft.
    const displayed = shownDraft?.trial.next;
    if (
      isTrack &&
      wantsSolid &&
      activeTrial &&
      displayed &&
      displayed.plate === activeTrial.next.plate &&
      displayed.track.plan === activeTrial.next.track.plan &&
      JSON.stringify(displayed.track.params) ===
        JSON.stringify(activeTrial.next.track.params)
    ) {
      shownDraft.trial = activeTrial;
      livePartCount(shownDraft.result.length);
    } else if (wantsSolid && activeTrial) {
      liveStatus('updating', 'Updating live geometry…');
      live.schedule(activeTrial);
    } else {
      showCommitted();
      const pickFace =
        !isTrack &&
        !region &&
        !editing &&
        isFaceTool(editorTab) &&
        editorTab !== 'trim-top';
      liveStatus(
        atCommonHeight || zeroMove ? 'unchanged' : 'idle',
        historyInput
          ? 'Viewing the input to this edit'
          : pickFace
            ? 'Click a surface to place this edit.'
            : atCommonHeight
              ? 'The selected faces are already at this height.'
              : zeroMove
                ? 'Drag the arrow or enter a distance.'
                : 'Live view',
      );
    }
  } catch (error) {
    showCommitted();
    liveStatus('error', error.message, error.warning);
  }
  if (!isTrack && form.querySelector('[data-action="apply"]'))
    form.querySelector('[data-action="apply"]').disabled =
      !activeTrial || liveState === 'error';
  syncPackApply(form);
  updateGuides();
}

/* ---------- The pack rail (Track Set) ---------- */

// The pack of the piece being edited, kept for the rail.
let currentPack = null,
  packLayouts = [],
  packLoading = null,
  // A pack the open piece links to but the Library no longer has (deleted
  // here or in another window). Remembered so the rail stops looking for it.
  missingPack = null;
async function loadCurrentPack() {
  const id = project.libraryPiece?.collectionId;
  if (!id) return (currentPack = null);
  packLoading ??= openTrackLibrary()
    .then((store) => Promise.all([store.list(), store.layouts()]))
    .then(([packs, layouts]) => {
      currentPack = packs.find((c) => c.id === id) ?? null;
      missingPack = currentPack ? null : id;
      packLayouts = layouts;
    })
    .finally(() => {
      packLoading = null;
    });
  await packLoading;
  render();
}
function renderPackRail(track) {
  const rail = $('#pack-rail');
  const link = track ? project.libraryPiece : null;
  const actionsBox = $('.creation-actions');
  rail.hidden = !link;
  actionsBox.hidden = Boolean(link);
  if (!link) return;
  if (missingPack === link.collectionId) {
    rail.innerHTML =
      '<p class="hint">This piece’s pack is no longer in the Library. Apply keeps your changes in this project only.</p>';
    return;
  }
  if (currentPack?.id !== link.collectionId) {
    if (!packLoading) loadCurrentPack().catch(reportActionError);
    rail.innerHTML = '<p class="hint">Opening the pack…</p>';
    return;
  }
  const pack = currentPack,
    r = pack.rules ?? {};
  const initials = pack.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
  const pieces = pack.pieces
    .map(
      (p) =>
        '<button type="button" class="pack-piece' +
        (p.id === link.pieceId ? ' active' : '') +
        '" data-pack-piece="' +
        esc(p.id) +
        '"' +
        (p.id === link.pieceId ? ' aria-current="true"' : '') +
        '>' +
        trackThumbnail(p.track, pack.profile) +
        '<span><b>' +
        esc(p.name) +
        '</b><small>' +
        esc(pieceDetail(p.track)) +
        '</small>' +
        usedInNote(p.id) +
        '</span></button>',
    )
    .join('');
  rail.innerHTML =
    '<div class="pack-head"><span class="pack-tile">' +
    esc(initials) +
    '</span><span><b>' +
    esc(pack.name) +
    '</b><small>' +
    esc(fmt(r.width ?? 0) + ' mm · ' + (r.lanes ?? 2) + ' lanes · ' + pack.pieces.length + ' pieces') +
    '</small></span></div>' +
    button('pack-rules', 'Pack rules', 'settings', 'secondary full') +
    '<div class="pack-pieces" role="list">' +
    pieces +
    '</div>' +
    specialShelf(pack, link) +
    '<div class="pack-tools">' +
    button('pack-add-piece', 'Add piece', 'plus', 'secondary') +
    button('track-library', 'Library', 'library', 'quiet') +
    '</div>';
}
// The special pieces this pack can have: the ones it has open as pieces,
// the others are added from its rules with one click.
function specialShelf(pack, link) {
  const tiles = specialsFor(pack.rules?.lanes ?? 2)
    .map(([type, name]) => {
      const owned = pack.pieces.find((p) => p.track.params.special?.type === type);
      // Some rules cannot make every special (a narrow road for the chicane,
      // say). The tile stays; choosing it explains why.
      let picture = '';
      try {
        picture = trackThumbnail(owned?.track ?? packSpecialTrack(pack, type), pack.profile);
      } catch {
        /* Drawn without a picture. */
      }
      const attrs = owned
        ? ' data-pack-piece="' + esc(owned.id) + '"' +
          (owned.id === link.pieceId ? ' aria-current="true"' : '') +
          ' title="Open ' + esc(owned.name) + '"'
        : ' data-add-special="' + esc(type) + '" title="Add a ' + esc(name.toLowerCase()) + ' to this pack"';
      return (
        '<button type="button" class="pack-special' +
        (owned ? ' owned' : '') +
        (owned?.id === link.pieceId ? ' active' : '') +
        '"' +
        attrs +
        '>' +
        picture +
        '<b>' +
        esc(SPECIAL_SHORT_NAMES[type] ?? name) +
        '</b><small>' +
        (owned ? 'In pack' : '+ Add') +
        '</small></button>'
      );
    })
    .join('');
  return (
    '<section class="pack-specials" aria-label="Special pieces"><h3>Special pieces</h3>' +
    '<div class="pack-special-grid">' +
    tiles +
    '</div></section>'
  );
}
// Adds a special piece made from the pack's rules, then opens it.
async function addSpecialToPack(type) {
  const id0 = currentPack?.id;
  if (!id0 || id0 !== project.libraryPiece?.collectionId) return;
  await applyForOutput();
  const store = await openTrackLibrary();
  // The rail's copy can be a save behind; add to the pack as stored.
  const pack = (await store.list()).find((c) => c.id === id0);
  if (!pack) throw Error('This pack is no longer in the Library.');
  const name = uniqueName(specialName(type), pack.pieces.map((p) => p.name));
  const track = trackWithProfile({ ...packSpecialTrack(pack, type), sourceName: name }, pack.profile);
  await call('validateLibraryTrack', track);
  const id = await store.savePiece(pack.id, { name, track }, { expectedRevision: pack.revision });
  const saved = (await store.list()).find((c) => c.id === pack.id);
  await openPackPiece(saved, saved.pieces.find((p) => p.id === id));
}
// "Used in": how many saved layouts place this piece.
function usedInNote(pieceId) {
  const n = packLayouts.filter((l) => l.pieceIds?.includes(pieceId)).length;
  return n ? '<small class="used-in">Used in ' + n + (n === 1 ? ' layout' : ' layouts') + '</small>' : '';
}
async function openPackPieceById(pieceId) {
  const pack = currentPack;
  const piece = pack?.pieces.find((p) => p.id === pieceId);
  if (!piece || pieceId === project.libraryPiece?.pieceId) return;
  await openPackPiece(pack, piece);
}
actions['pack-rules'] = () =>
  openLibrary({ collectionId: project.libraryPiece?.collectionId, screen: 'rules' });
actions['pack-add-piece'] = () =>
  openLibrary({ collectionId: project.libraryPiece?.collectionId });

/* ---------- Pack rules and Apply to collection ---------- */

const PACK_RULE_FIELDS = [...SHARED_PROFILE_FIELDS, ...COLLECTION_RULE_FIELDS];
const PACK_RULE_LABELS = {
  ...sharedLabels,
  width: 'Road width',
  lanes: 'Lane count',
  laneSpacing: 'Lane spacing',
};
// A pack rule's value as people read it: the clip's name, not its id.
function packRuleValue(key, value) {
  if (key === 'clipType')
    return new Map(clipChoices()).get(value) ?? String(value ?? 'off');
  if (key === 'braidStyle') return new Map(braidStyleChoices).get(value) ?? String(value);
  return String(value ?? 'off');
}
// The pack rules a pending edit of a pack piece would change.
function packRuleChanges() {
  if (project.mode !== 'track' || !project.libraryPiece || !activeTrial) return [];
  const before = project.track.params,
    after = activeTrial.next.track.params;
  return PACK_RULE_FIELDS.filter(
    (k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null),
  );
}
function syncPackApply(form = $('#settings-form')) {
  const commit = form?.querySelector('.property-commit');
  const box = form?.querySelector('[data-pack-apply]');
  if (!commit || !box) return;
  const changed = liveState === 'error' ? [] : packRuleChanges();
  commit.classList.toggle('pack-rule', changed.length > 0);
  box.hidden = !changed.length;
  if (!changed.length) return;
  const p = activeTrial.next.track.params;
  box.innerHTML =
    '<b>' +
    (changed.length === 1 ? 'This is a pack rule' : 'These are pack rules') +
    '</b>Every piece in the pack follows them, and so do the layouts planned with it.<ul>' +
    changed
      .map(
        (k) =>
          '<li>' +
          esc(PACK_RULE_LABELS[k] ?? k) +
          ': ' +
          esc(packRuleValue(k, p[k])) +
          '</li>',
      )
      .join('') +
    '</ul>' +
    offCentreLoss(changed, p);
}
// The pieces a new road width, lane count or spacing centres, counted by the
// same test Apply to collection uses, with the rule values it sends.
function offCentreLoss(changed, p) {
  if (!changed.some((k) => COLLECTION_RULE_FIELDS.includes(k))) return '';
  const open = project.libraryPiece?.pieceId;
  const pieces = (currentPack?.pieces ?? []).map((piece) => (piece.id === open ? p : piece.track.params));
  const values = Object.fromEntries(
    COLLECTION_RULE_FIELDS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]),
  );
  return packRuleSlotNote(packRuleSlotChanges(pieces, values));
}
// Applies the edit to this piece, then writes the pack rules into every
// piece of its pack. The library checks all pieces first.
async function applyToCollectionAction() {
  const link = project.libraryPiece;
  if (!link) return applyForm();
  const previous = project;
  if (!(await applyForm())) return;
  const store = await openTrackLibrary();
  const values = Object.fromEntries(
    COLLECTION_RULE_FIELDS.map((k) => [k, project.track.params[k]]),
  );
  let result;
  try {
    result = await store.applyToCollection(
      link.collectionId,
      {
        profile: profileFromTrack(project.track),
        values,
        piece: { id: link.pieceId, track: project.track },
      },
      {
        expectedRevision: Math.max(
          link.revision,
          savedPackRevisions.get(link.collectionId) ?? -Infinity,
        ),
      },
    );
  } catch (err) {
    // The pack refused the rules (another piece cannot take them): this piece
    // goes back too, so it never disagrees with its pack.
    if (history.at(-1) === previous) history.pop();
    await rebuild(previous, { record: false });
    throw err;
  }
  savedPackRevisions.set(link.collectionId, result.revision);
  project = { ...project, libraryPiece: { ...link, revision: result.revision } };
  await savePieceToPack();
  currentPack = null;
  render();
  notice(packApplyNotice(result));
}
// A pack piece is saved into its pack whenever an edit is applied.
// The latest pack revision this window saved. Undo and reload can bring back a
// project whose link still names an older revision of a pack saved since.
const savedPackRevisions = new Map();
async function savePieceToPack() {
  const link = project.libraryPiece;
  if (project.mode !== 'track' || !link) return;
  if (missingPack === link.collectionId) {
    // The pack is gone: the change stays in this project, now unlinked.
    const { libraryPiece: _gone, ...rest } = project;
    project = rest;
    persist();
    render();
    return;
  }
  const expected = Math.max(link.revision, savedPackRevisions.get(link.collectionId) ?? -Infinity);
  const store = await openTrackLibrary();
  await store.savePiece(
    link.collectionId,
    { id: link.pieceId, name: project.name, track: project.track },
    { expectedRevision: expected },
  );
  savedPackRevisions.set(link.collectionId, expected + 1);
  project = { ...project, libraryPiece: { ...link, revision: expected + 1 } };
  persist();
  savedState = 'Saved in the pack';
}
const controlValue = (el) => (el.type === 'checkbox' ? el.checked : el.value);
function baselineValue(el, op) {
  if (el.name === 'assemblyTarget') return op?.target ?? selected;
  if (el.name === 'combineMethod') return op?.method ?? 'join';
  if (el.name === 'alignment') return op?.alignment ?? 'stack';
  if (el.name === 'kind') return project.track.params.kind;
  if (el.name === 'profileKind')
    return formKind ?? op?.profileKind ?? 'rectangle';
  if (el.name === 'splitKind') return splitKind ?? 'split';
  if (el.name === 'axis') return axis ?? 'x';
  return controlValue(el);
}
function equalValue(el, a, b) {
  return el.type === 'number' && a !== '' && b !== ''
    ? Number(a) === Number(b)
    : a === b;
}
function inspectorDraft(records) {
  const local = records.get(draftKey()) ?? {};
  if (project.mode !== 'track' || !['geometry', 'borders', 'markings'].includes(trackTab))
    return local;
  const result = { ...local };
  for (const record of records.values()) {
    for (const name of sharedPaintFields) {
      if (name in record) result[name] = record[name];
    }
  }
  return result;
}
function addRestoreControls(form) {
  for (const el of [...(form?.elements ?? [])]) {
    if (!el.name) continue;
    const label = el.closest('label');
    if (!label) continue;
    const wrap = document.createElement('div');
    wrap.className = 'restorable-field';
    label.before(wrap);
    wrap.append(label);
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'restore-field';
    reset.dataset.restoreField = el.name;
    const name =
      label.firstElementChild?.tagName === 'SPAN'
        ? label.firstElementChild.textContent
        : label.textContent;
    reset.setAttribute('aria-label', 'Restore ' + name.trim());
    reset.innerHTML = icon('reset');
    wrap.append(reset);
  }
  updateRestoreControls();
}
function updateRestoreControls() {
  syncJointCountControls($('#settings-form'));
  syncPropertyReadouts($('#settings-form'));
  const prev = inspectorDraft(previousTrackFields);
  const draft = inspectorDraft(formDrafts);
  for (const btn of $('#settings-form')?.querySelectorAll(
    '[data-restore-field]',
  ) ?? []) {
    const name = btn.dataset.restoreField;
    btn.disabled = !(name in draft || name in prev);
    const value = name in draft ? formBaselines[name] : prev[name];
    btn.title = btn.disabled
      ? 'At the applied value'
      : 'Restore ' + name + ' to ' + value;
  }
  const restore = $('[data-action="restore"]');
  if (restore)
    restore.disabled = !(
      toolArmed ||
      trackFields.size ||
      Object.keys(draft).length ||
      Object.keys(prev).length
    );
}
function storeField(el) {
  const key = draftKey(),
    draft = formDrafts.get(key) ?? {},
    val = controlValue(el);
  if (project.mode === 'track' && sharedPaintFields.includes(el.name)) {
    for (const [otherKey, other] of formDrafts) {
      if (otherKey === key || !(el.name in other)) continue;
      delete other[el.name];
      if (!Object.keys(other).length) {
        formDrafts.delete(otherKey);
        trackFields.delete(otherKey);
        trackBaselines.delete(otherKey);
      }
    }
  }
  if (equalValue(el, val, formBaselines[el.name])) delete draft[el.name];
  else draft[el.name] = val;
  if (Object.keys(draft).length) formDrafts.set(key, draft);
  else formDrafts.delete(key);
  if (project.mode === 'track') {
    if (formDrafts.has(key)) {
      trackFields.set(key, values(el.form, false));
      trackBaselines.set(key, { ...trackBaselines.get(key), ...formBaselines });
    } else {
      trackFields.delete(key);
      trackBaselines.delete(key);
    }
  }
}
function restoreField(name) {
  const el = $('#settings-form')?.elements.namedItem(name);
  if (!el) return;
  const draft = inspectorDraft(formDrafts);
  const target =
    name in draft
      ? formBaselines[name]
      : inspectorDraft(previousTrackFields)[name];
  if (target == null) return;
  if (el.type === 'checkbox') el.checked = target;
  else el.value = target;
  storeField(el);
  if (project.mode === 'track' && !(name in draft)) {
    const previousFields = inspectorDraft(previousTrackFields);
    const related = {
      ...gridFieldDependencies(name, project.track.params, previousFields),
      ...slotFieldDependencies(name, previousFields),
    };
    if (Object.keys(related).length)
      formDrafts.set(draftKey(), { ...related, ...formDrafts.get(draftKey()) });
  }
  if (project.mode === 'editor')
    toolArmed =
      formDrafts.has(draftKey()) ||
      (isFaceTool(editorTab) && Boolean(region || editing));
  if (name === 'tolerance') {
    updateRestoreControls();
    updateBoundaryAngle(el);
    return;
  }
  renderInspector();
}
async function restoreForm() {
  await queueRegroup();
  cancelLive();
  const savedEdit = project.editor.ops.find((op) => op.id === editing);
  if (assemblyTab(editorTab)) {
    pendingMate = null;
    assemblyFaces.clear();
    if (savedEdit?.sourceFace) {
      assemblyFaces.set(savedEdit.target, savedEdit.sourceFace);
      assemblyFaces.set(savedEdit.reference, savedEdit.destinationFace);
    }
    stage.select(selected, hidden, assemblyPeers);
  }
  if (
    savedEdit &&
    (['add', 'cut', 'moveFaces', 'tiltFace', 'trimFace', 'hollow'].includes(
      savedEdit.type,
    ) ||
      featureTab(savedEdit.type))
  ) {
    clearPick();
    await loadSavedEdges(savedEdit);
    art = null;
    formKind = savedEdit.profileKind ?? null;
    await recoverFacePicks(savedEdit);
  }
  const restoreSurface =
    project.mode === 'editor' &&
    !savedEdit &&
    pickSeed &&
    'tolerance' in (formDrafts.get(draftKey()) ?? {});
  const key = draftKey(),
    previous = inspectorDraft(previousTrackFields);
  if (!formDrafts.size && !toolArmed && Object.keys(previous).length) {
    formDrafts.set(key, { ...previous });
  } else if (project.mode === 'track') {
    formDrafts.clear();
    trackFields.clear();
    trackBaselines.clear();
    if (!current() && parts.length) {
      selected = parts[0].id;
      stage.select(selected, hidden);
      renderParts();
    }
  } else formDrafts.delete(key);
  if (savedEdit?.type === 'trimFace')
    editorTab = savedEdit.reference === 'top' ? 'trim-top' : 'trim-face';
  toolArmed = false;
  renderInspector();
  if (restoreSurface) {
    const angle = $('#settings-form [name="tolerance"]');
    angle.value = tolerance;
    updateBoundaryAngle(angle);
  }
}

function focusTrackSetting(target) {
  if (!target || project.mode !== 'track') return;
  // A warning names the old tab; markings and segments now have sections.
  const section = sectionForField(target.field, target.tab);
  if (trackTab !== section) {
    trackTab = section;
    renderInspector();
  }
  const form = $('#settings-form');
  // A slot warning names slot 1 of one lane mode; the other may be shown.
  const control = form?.elements.namedItem(slotFieldToFocus(form, target.field));
  if (!control) return;
  for (
    let section = control.closest('details');
    section;
    section = section.parentElement?.closest('details')
  )
    section.open = true;
  control.focus();
  if (
    control instanceof HTMLInputElement &&
    ['number', 'text'].includes(control.type)
  )
    control.select();
}
function exportMenu() {
  const visibleModel = shownDraft?.result ?? parts;
  const part = visibleModel.find(
    (p) => p.id === (shownDraft?.trial.selectId ?? selected),
  );
  const borders = visibleModel.filter((p) => p.role === 'border');
  const supports = visibleModel.filter((p) => p.role === 'support');
  const track = project.mode === 'track';
  const hasKeepers = track && visibleModel.some((p) => p.role === 'retainer');
  const flatCrossing = isFlatCrossingProject(shownDraft?.trial.next ?? project);
  const marked = track && visibleModel.some((p) => p.kerbMarkings?.length);
  const faceUp = printsFaceUp(shownDraft?.trial.next ?? project);
  const faceUpNote = faceUp
    ? '<p class="hint">Road and border STLs lie underside-down on the print bed, so the raised lands for copper tape print on top.</p>'
    : '';
  const otherOutputs = flatCrossing
    ? (faceUp ? '<p class="hint">Raised lands for copper tape print on top, so road and border STLs lie underside-down on the print bed.'
      : '<p class="hint">Road and border STLs lie surface-down on the print bed.') +
      ' Print both passages separately and assemble the upper passage on bridge supports.</p>'
    : '<details class="export-other"><summary>Other STL outputs' +
      icon('down') +
      '</summary>' +
      row(
        'export-assembly',
        'Assembled model · STL',
        'One file with the parts in their assembled positions.',
        'layers',
      ) +
      (track
        ? ''
        : row(
            'export-additions',
            'Additions only · STL',
            'Material outside the original STL.',
            'plus',
          ) +
          row(
            'export-base',
            'Modified base · STL',
            'Omit detachable additions.',
            'box',
          )) +
      '</details>';
  showDialog(
    'Export STLs',
    (hasLiveEdit()
      ? '<p class="export-note">Exporting project parts will apply the current edit.</p>'
      : '') +
      '<div class="print-choices">' +
      row(
        'export-part',
        'Selected part · STL',
        (part?.name ?? 'Current part') + ' on the print plane.',
        'part',
      ) +
      (track && borders.length
        ? row(
            'export-borders',
            'Borders only · ZIP',
            borders.length +
              (borders.length === 1 ? ' border segment' : ' border segments') +
              ', each in its own STL.',
            'layers',
          )
        : '') +
      (track && supports.length
        ? row(
            'export-supports',
            'Bridge supports only · ZIP',
            supports.length +
              (supports.length === 1 ? ' support' : ' supports') +
              ', each in its own STL.',
            'layers',
          )
        : '') +
      row(
        'export-kit',
        'All printable parts · ZIP',
        hasKeepers
          ? 'Part STLs, keeper tool, print quantities, assembly map and editable project.'
          : 'Separate STLs, print quantities, assembly map and editable project.',
        'kit',
      ) +
      (hasKeepers
        ? row('export-keeper-tool', 'Keeper tool · STL',
          'An angled key for turning the retaining clips from underneath.', 'export')
        : '') +
      '</div>' +
      otherOutputs +
      (flatCrossing ? '' : faceUpNote) +
      (marked
        ? '<p class="hint">STLs carry the shape and any enabled paint grooves. The colours shown on the model are a painting guide.</p>'
        : ''),
  );
}
function plateMenu() {
  const part =
      shownDraft?.result.find((x) => x.id === shownDraft.trial.selectId) ??
      current(),
    p = project.plate;
  const bedParts = shownDraft?.result ?? parts;
  const bad = bedParts.filter((x) => !x.fit.fits);
  showDialog(
    'Print plate',
    '<div id="plate-drawing">' +
      (part ? plateDiagram(part, p) : '') +
      '</div>' +
      '<form id="plate-form">' +
      field('width', 'Plate width', p.width) +
      field('depth', 'Plate depth', p.depth) +
      field('margin', 'Margin per edge', p.margin) +
      '</form>' +
      (part
        ? '<p id="plate-readout" class="selection-note">' +
          esc(part.name) +
          ' · ' +
          (part.fit.fits ? 'Fits' : 'Exceeds plate') +
          ' at ' +
          fmt(part.fit.angle) +
          '°<br>' +
          fmt(part.fit.width) +
          ' × ' +
          fmt(part.fit.depth) +
          ' mm footprint</p>'
        : '') +
      '<p class="hint" id="plate-overflow">' +
      (bad.length
        ? 'Oversized parts: ' + esc(bad.map((x) => x.name).join(', '))
        : '') +
      '</p>' +
      button(
        'apply-plate',
        hasLiveEdit() ? 'Apply edit and save plate' : 'Save plate',
        'check',
        'primary',
      ) +
      (project.mode === 'track'
        ? button('suggest', 'Suggest segments', 'split', 'secondary')
        : ''),
  );
  const suggest = $('#dialog [data-action="suggest"]');
  if (suggest)
    suggest.hidden = !bad.some((p) => p.role === 'road' || p.role === 'border');
  const footprints = bedParts.map((item) => [item, item.footprintXY]);
  $('#plate-form').addEventListener('input', (e) => {
    const bed = values(e.currentTarget, false);
    try {
      const fits = footprints.map(([item, hull]) => ({
        item,
        fit: fitPlate(hull, bed.width, bed.depth, bed.margin),
      }));
      const { fit } = fits.find((x) => x.item === part) ?? {};
      if (!fit) return;
      dialogPlate = bed;
      dialogPlateFit = fit;
      $('#plate-drawing').innerHTML = plateDiagram(part, bed);
      $('#plate-readout').textContent =
        part.name +
        ' · ' +
        (fit.fits ? 'Fits' : 'Exceeds plate') +
        ' at ' +
        fmt(fit.angle) +
        '° · ' +
        fmt(fit.width) +
        ' × ' +
        fmt(fit.depth) +
        ' mm';
      const over = fits.filter((x) => !x.fit.fits);
      if (suggest)
        suggest.hidden = !over.some(
          ({ item }) => item.role === 'road' || item.role === 'border',
        );
      $('#plate-overflow').textContent = over.length
        ? 'Oversized parts: ' + over.map((x) => x.item.name).join(', ')
        : '';
    } catch (error) {
      dialogPlate = null;
      dialogPlateFit = null;
      if (suggest) suggest.hidden = true;
      $('#plate-drawing').replaceChildren();
      // With no part selected there is no readout; show the reason below.
      const readout = $('#plate-readout');
      if (readout) readout.textContent = error.message;
      $('#plate-overflow').textContent = readout ? '' : error.message;
    }
    updateGuides();
  });
}
function openMenu() {
  showDialog(
    'Open or create',
    row(
      'browse',
      'Open project or model',
      'Foundry project or layout, STL, SVG or DXF',
      'open',
    ) +
      row(
        'new-design',
        'New design',
        'Start with an empty STL workspace.',
        'sketch',
      ) +
      row(
        'fresh',
        'New project',
        'Start with a bend and an example enclosure.',
        'plus',
      ) +
      row(
        'about',
        'Workbench guide',
        'Controls, project files, and component credits.',
        'info',
      ),
  );
}
Object.assign(actions, {
  'add-model': () => filePick('add-model', '.stl'),
  'pick-moving-face': () => startMatePick(true),
  'pick-reference-face': () => startMatePick(false),
  'close-dialog': closeDialog,
  open: openMenu,
  'export-menu': exportMenu,
  plate: plateMenu,
  browse: () => {
    closeDialog();
    filePick('open', '.stl,.svg,.dxf,.slotfab,.slotplan,.json');
  },
  about: () =>
    showDialog(
      'Workbench guide',
      '<p>Click a face in the STL editor to open its action bar. Trim cuts across the entire part parallel to that face. Push / pull moves material inside its outline. Add profile and Cut profile place a shape on the selected surface.</p><p>To shorten a part vertically, choose <b>Cut off top</b> in the sidebar and enter the amount to remove or the finished height.</p><p>Left-drag to orbit, middle-drag to pan, and scroll to zoom. Change a setting to see the guide and live result. Apply records your edit. Restore returns to the applied geometry.</p><p>Save an editable <b>.slotfab</b> project. Export a selected STL for slicing or a kit with an assembly map and quantities. STL coordinates use millimetres.</p><p class="hint">SlotForge Foundry ' +
        appVersion +
        ' · Local browser edition</p>' +
        ($('#component-notices')
          ? '<details><summary>Component credits</summary><pre style="white-space:pre-wrap;font-size:10px">' +
            esc($('#component-notices').content.textContent) +
            '</pre></details>'
          : ''),
    ),
  fresh: async () => {
    closeDialog();
    art = null;
    editing = null;
    formKind = null;
    await rebuild(freshProject(), { fit: true });
  },
  'import-context': () =>
    project.mode === 'track'
      ? filePick('circuit', '.svg,.dxf')
      : filePick('stl', '.stl'),
  'import-shape': () => filePick('art', '.svg,.dxf'),
  save: async () => {
    await applyForOutput();
    download(
      cleanName(project.name) + '.slotfab',
      JSON.stringify(project),
      'application/json',
    );
    status('Project file saved');
  },
  rename: () =>
    showDialog(
      'Rename project',
      '<input id="new-name" class="text" aria-label="Project name" maxlength="100" value="' +
        esc(project.name) +
        '">' +
        button('apply-name', 'Rename', null, 'primary full'),
    ),
  'apply-name': async () => {
    const name = $('#new-name').value.trim() || project.name;
    closeDialog();
    // A rebuild clears pending edits: apply them before renaming.
    await applyForOutput();
    const next = clone(project);
    next.name = name;
    await rebuild(next);
  },
  'apply-plate': async () => {
    const fromDraft = hasLiveEdit();
    const next = fromDraft ? candidate().next : clone(project);
    next.plate = values($('#plate-form'));
    checkProject(next);
    closeDialog();
    await rebuild(next, {
      onError: fromDraft ? reportDraftFailure : undefined,
    });
  },
  suggest: async () => {
    const next = hasLiveEdit() ? candidate().next : clone(project);
    next.plate = values($('#plate-form'));
    checkProject(next);
    const bed = next.plate;
    const shown = shownDraft?.result ?? parts;
    const oversized = shown.filter(
      (part) =>
        !fitPlate(part.footprintXY, bed.width, bed.depth, bed.margin).fits,
    );
    const divisible = oversized.filter(
      (part) => part.role === 'road' || part.role === 'border',
    );
    const bad = divisible.find((part) => part.id === selected) ?? divisible[0];
    if (!bad) return;
    const answer = await call('suggest', {
      id: bad.id,
      params: next.track.params,
      plate: bed,
      plan: next.track.plan,
    });
    if (!answer.fits) {
      notice(answer.reason);
      $('#plate-overflow').textContent = answer.reason;
      return;
    }
    const diamond = next.track.params.special?.type === 'diamond';
    const setting = diamond
      ? answer.key === 'segments'
        ? answer.count === 1 ? 'one whole crossing' : 'one centre block and ' + (answer.count - 1) + ' section' + (answer.count === 2 ? '' : 's') + ' on each arm'
        : answer.count + ' border segment' + (answer.count === 1 ? '' : 's') + ' per arm'
      : answer.count + ' segments';
    showDialog(
      'Split to fit',
      '<p>' +
        esc(bad.name) +
        ' fits the ' +
        fmt(bed.width) +
        ' × ' +
        fmt(bed.depth) +
        ' mm plate with ' + esc(setting) + ', including its connectors.</p>' +
        button(
          'apply-suggestion',
          diamond ? 'Apply plate and segmentation' : 'Apply plate and ' + answer.count + ' segments',
          'split',
          'primary',
        ),
    );
    actions['apply-suggestion'] = async () => {
      closeDialog();
      next.track.params[answer.key] = answer.count;
      await rebuild(next, { fit: true });
    };
  },
  'mode-track': () => switchMode('track'),
  'mode-editor': () => switchMode('editor'),
  'scale-car': () => {
    if (scaleCar.active) { scaleCar.close(); return; }
    if (pickMode === 'measure') {
      pickMode = 'select';
      clearPick();
      render();
      $('#view-hint').textContent = navigationHint;
    }
    scaleCar.open();
  },
  fit: () => stage.fitView(true),
  pick: () => {
    scaleCar.close();
    pickMode = 'select';
    if (project.mode === 'editor') {
      cancelLive();
      editing = null;
      editorTab = 'select';
      toolArmed = false;
    }
    clearPick();
    render();
    $('#view-hint').textContent = navigationHint;
  },
  measure: () => {
    scaleCar.close();
    cancelLive();
    if (project.mode === 'editor') {
      editing = null;
      editorTab = 'select';
      toolArmed = false;
    }
    pickMode = 'measure';
    clearPick();
    render();
    $('#view-hint').textContent = 'Click two points on the model';
  },
  'multi-pick': () => {
    extendPicks = !extendPicks;
    const control = $('[data-action="multi-pick"]');
    control?.setAttribute('aria-pressed', String(extendPicks));
  },
  'whole-face': () => pickSeed && enqueueSurface(pickSeed, false, true),
  'use-adjacent-face': () => {
    pickedEdges = [];
    finishEdge = null;
    stage.highlightRegions(selected, selectedFaces);
    renderInspector();
  },
  // In Track Set an applied edit of a pack piece is saved into its pack.
  apply: async () => {
    const pieceOnly = project.mode === 'track' && project.libraryPiece && !packRuleChanges().length;
    if ((await applyForm()) && pieceOnly) await savePieceToPack();
  },
  'apply-collection': applyToCollectionAction,
  'view-fit-warning': () => $('#live-status')?.focus(),
  'show-warning-setting': () => focusTrackSetting(activeWarning?.setting),
  'line-dimensions': () =>
    focusTrackSetting({ tab: 'geometry', field: 'whiteLineWidth' }),
  restore: restoreForm,
  'cancel-op': () => {
    cancelLive();
    formDrafts.delete(draftKey());
    editing = null;
    assemblyPeers.clear();
    assemblyFaces.clear();
    editorTab = 'select';
    toolArmed = false;
    clearPick();
    art = null;
    formKind = null;
    renderInspector();
  },
  calibrate: () => {
    const dist = distanceMeasured();
    if (!(dist > 0) || measurePart !== selected)
      throw Error(
        'Choose Measure in the viewport and pick two points on the selected part.',
      );
    showDialog(
      'Calibrate scale',
      '<p class="hint">Measured distance: ' +
        fmt(dist) +
        ' mm</p><form id="scale-form">' +
        field('known', 'Actual distance', +dist.toFixed(3)) +
        '</form><p id="calibration-result" class="selection-note" role="status">Scale × 1</p>' +
        button('apply-calibration', 'Scale selected part', 'check', 'primary'),
    );
    const calibrationForm = $('#scale-form');
    calibrationForm.addEventListener('input', () => {
      live.cancel();
      const scale = calibrationForm.elements.known.valueAsNumber / dist;
      if (!(scale > 0 && Number.isFinite(scale))) {
        showCommitted();
        $('#calibration-result').textContent = 'Enter a positive distance.';
        return;
      }
      const op = {
        type: 'transform',
        id: (newEditId ??= uid()),
        target: selected,
        scale,
        rotate: [0, 0, 0],
        move: [0, 0, 0],
        label: 'Calibrate size',
      };
      const next = {
        ...project,
        editor: { ...project.editor, ops: [...project.editor.ops, op] },
      };
      activeTrial = { next, op, selectId: selected };
      $('#calibration-result').textContent =
        'Scale × ' +
        fmt(scale) +
        ' · ' +
        current()
          .bounds.max.map((v, i) => fmt((v - current().bounds.min[i]) * scale))
          .join(' × ') +
        ' mm';
      live.schedule(activeTrial);
    });
    $('#dialog').addEventListener(
      'close',
      () => {
        if (!busy && $('#scale-form') === calibrationForm) {
          cancelLive();
          refreshLive();
        }
      },
      { once: true },
    );
    actions['apply-calibration'] = async () => {
      const n = values($('#scale-form')).known;
      if (!(n > 0)) throw Error('Enter a positive distance.');
      closeDialog();
      await transformPart({ scale: n / dist, label: 'Calibrate size' });
    };
  },
  'lay-flat': async () => {
    if (!region?.planar)
      throw Error('Select a flat face to rest on the plate.');
    await transformPart({ layFlat: region.normal, label: 'Lay face on plate' });
  },
  undo: async () => {
    if (!history.length) return;
    const prev = history.at(-1),
      old = project;
    if (
      await rebuild(prev, { record: false, fit: prev.mode !== project.mode })
    ) {
      history.pop();
      future.push(old);
      render();
    }
  },
  redo: async () => {
    if (!future.length) return;
    const next = future.at(-1),
      old = project;
    if (
      await rebuild(next, { record: false, fit: next.mode !== project.mode })
    ) {
      future.pop();
      history.push(old);
      render();
    }
  },
  'edit-part': async () => {
    await applyForOutput();
    const part = current();
    if (!part) return;
    const bytes = await call('export', { mode: 'part', id: part.id });
    const next = clone(project),
      p = next.track.params;
    next.mode = 'editor';
    next.editor = {
      source: { label: part.name, data: toBase64(bytes) },
      ops: [],
    };
    // A part of a pack piece stays linked to it in the Library.
    const link = project.libraryPiece;
    next.stlPart = link
      ? {
          source: {
            collectionId: link.collectionId,
            pieceId: link.pieceId,
            part: part.id,
            revision: link.revision,
            label: project.name + ' · ' + part.name,
          },
        }
      : {};
    if (part.role === 'clip') {
      const sourceType = clipTypeFromSTL(bytes);
      if (sourceType) next.editor.source.clipType = sourceType;
    }
    if (p.kind === 'curve' && !p.special && part.role === 'road') {
      const idx = Number(part.id.split('-').at(-1)) - 1,
        step = p.angle / p.segments,
        start = 90 + p.angle / 2 - step * (idx + 1);
      next.editor.source.arc = {
        center: [0, -p.radius],
        start,
        end: start + step,
        mid: start + step / 2,
      };
    }
    if (await rebuild(next, { fit: true })) {
      editing = null;
      formKind = null;
      art = null;
      renderInspector();
    }
  },
  // STL Edit: keep this model in the Library as an STL part. The first save
  // makes it; later saves update it. An edited copy of a Library part keeps a
  // link to the part it was based on.
  'save-stl-part': async () => {
    if (project.mode !== 'editor' || !parts.length)
      throw Error('Open or create a model before saving it to the Library.');
    await applyForOutput();
    const store = await openTrackLibrary();
    // Undo steps share the model's source object, so a part saved from this
    // model is found again even when Undo restored a project without its link.
    let link = project.stlPart ?? savedStlParts.get(project.editor.source) ?? {};
    const edited = project.editor.ops.length > 0;
    // An original (an uploaded STL) is never overwritten: its edits become a
    // new part based on it.
    if (link.id && link.original && edited)
      link = { basedOn: link.id, name: link.name + ' (edited)' };
    const name =
      link.name ??
      (project.editor.source.empty ? project.name : project.editor.source.label) +
        (link.source && edited ? ' (edited)' : '');
    const original = !edited && !link.source && !link.basedOn;
    const id = await store.saveStlPart({
      id: link.id ?? undefined,
      name,
      basedOn: link.basedOn ?? null,
      source: link.source ?? null,
      project: { ...project, stlPart: undefined },
    });
    const stlPart = { ...link, id, name, original };
    project = { ...project, stlPart };
    savedStlParts.set(project.editor.source, stlPart);
    persist();
    notice('Saved to the Library as "' + name + '".');
  },
  'export-kit': async () => {
    closeDialog();
    await applyForOutput();
    download(
      cleanName(project.name) + '-kit.zip',
      await call('kit', null),
      'application/zip',
    );
    status('Printable parts exported');
  },
  'export-borders': async () => {
    closeDialog();
    await applyForOutput();
    download(
      cleanName(project.name) + '-borders.zip',
      await call('borderSTLs', null),
      'application/zip',
    );
    status('Border STLs exported');
  },
  'export-supports': async () => {
    closeDialog();
    await applyForOutput();
    download(
      cleanName(project.name) + '-bridge-supports.zip',
      await call('supportSTLs', null),
      'application/zip',
    );
    status('Bridge support STLs exported');
  },
  'export-keeper-tool': async () => {
    if ($('#dialog').open) closeDialog();
    download(KEEPER_TOOL_FILENAME, await call('keeperToolSTL', null), 'model/stl');
    status('Keeper tool STL exported');
  },
  'fit-samples': async () => {
    const { next } = candidate();
    download(
      cleanName(project.name) + '-fit-samples.zip',
      await call('fitSamples', next.track.params),
      'application/zip',
    );
    status('Connector fit samples exported');
  },
  'export-crossing-sample': async () => {
    const { next } = candidate();
    download(cleanName(next.name) + '-crossing-test.stl',
      await call('crossingSample',next.track.params),'model/stl');
    status('Crossing test STL exported');
  },
  'test-joint': () => {
    const { next } = candidate(),
      p = next.track.params;
    if (p.kind === 'import')
      throw Error(
        'Joint samples currently use a generated straight or circular bend.',
      );
    const options = jointSampleChoices(p);
    if (!options.length) throw Error('Choose tabs or clips for a joint first.');
    showDialog(
      'Export a test joint',
      '<p class="hint">Print short mating sections with the current clearance and connector positions.</p>' +
        options
          .map(([key, type, name]) => row('coupon-' + key, name, type, 'join'))
          .join(''),
    );
    for (const [key] of options)
      actions['coupon-' + key] = async () => {
        closeDialog();
        download(
          cleanName(project.name) + '-test-' + key + '.zip',
          await call('testJoint', { params: p, which: key }),
          'application/zip',
        );
      };
  },
  duplicate: async () => {
    const next = clone(project),
      part = current(),
      id = uid();
    next.editor.ops.push({
      id,
      target: selected,
      type: 'duplicate',
      label: 'Duplicate part',
      move: [part.bounds.max[0] - part.bounds.min[0] + 5, 0, 0],
    });
    await rebuild(next, { fit: true, selectId: id });
  },
  'separate-shells': async () => {
    const next = clone(project);
    next.editor.ops.push({
      id: uid(),
      target: selected,
      type: 'separate',
      label: 'Separate shells',
    });
    await rebuild(next);
  },
});
async function transformPart(extra) {
  const next = clone(project);
  next.editor.ops.push({
    type: 'transform',
    id: uid(),
    target: selected,
    scale: 1,
    rotate: [0, 0, 0],
    move: [0, 0, 0],
    ...extra,
  });
  await rebuild(next, { fit: true });
}
for (const mode of ['part', 'assembly', 'additions', 'base'])
  actions['export-' + mode] = async () => {
    if ($('#dialog').open) closeDialog();
    await applyForOutput();
    const data = await call('export', {
      mode: mode === 'part' ? 'printPart' : mode,
      id: selected,
    });
    download(
      cleanName(mode === 'part' ? current().name : project.name + '-' + mode) +
        '.stl',
      data,
      'model/stl',
    );
    status('Exported ' + mode + ' STL');
  };
async function switchMode(mode) {
  leaveHome();
  leaveLibraryPage();
  leavePlanner();
  if (project.mode === mode) return;
  const next = { ...project, mode };
  if (await rebuild(next, { fit: true })) {
    art = null;
    formKind = null;
    editing = null;
    renderInspector();
  }
}
// Stored loops define the edit even if an earlier edit changes triangle IDs.
// Reuse pick hints for Shift-click only after matching the actual saved outline.
async function recoverFacePicks(op) {
  const walls = op.type === 'wallModify';
  if (
    !historyInput ||
    (!walls && (op.tool !== 'move-face' || !op.faceRefs?.length))
  )
    return;
  const token = pickGeneration;
  try {
    const members = [];
    const refs = walls
      ? await call('wallPicks', {
          id: op.target,
          historyId: op.id,
          walls: op.walls,
        })
      : op.faceRefs;
    for (const ref of refs) {
      const seed = {
        id: op.target,
        triangle: ref.triangle,
        point: ref.point,
        whole: walls || ref.whole,
        source: historyInput,
        project,
      };
      const member = await resolveSurface(
        seed,
        walls ? 0 : (ref.tolerance ?? tolerance),
      );
      if (token !== pickGeneration) return;
      members.push(member);
    }
    const result = walls ? wallRegion(members) : composeFaceSelection(members);
    const matches =
      walls ||
      (op.faces
        ? op.faces.length === members.length &&
          op.faces.every(({ frame, loops }, i) =>
            matchesSavedFaceOutline(members[i], frame, loops),
          )
        : matchesSavedFaceOutline(result, op.frame, op.loops));
    if (!matches) return;
    selectedFaces = members;
    region = result;
    pickSeed = members.at(-1).seed;
    stage.highlightRegions(selected, selectedFaces);
  } catch {
    // The numerical edit remains available on its original saved geometry.
  }
}
async function loadSavedEdges(op) {
  const refs = op.rims ?? op.edges ?? (op.edge ? [op.edge] : []);
  pickedEdges = refs;
  if (refs.length) {
    const token = pickGeneration;
    try {
      const resolved = await call('restoredEdges', {
        id: op.target,
        historyId: op.id,
        edges: refs,
      });
      if (token !== pickGeneration) return;
      pickedEdges = resolved;
    } catch {
      // Retain the saved references so a changed input can be corrected.
    }
  }
  finishEdge = pickedEdges.at(-1) ?? null;
}
async function fromHistory(id) {
  const op = project.editor.ops.find((o) => o.id === id);
  if (!op) return;
  if (op.type === 'sketch') return openSketch(op);
  if (op.type === 'surfaceEdit') return openSurfaceBrush(op);
  if (
    ![
      'transform',
      'combineParts',
      'alignParts',
      'split',
      'radialSplit',
      'cut',
      'add',
      'tiltFace',
      'trimFace',
      'moveFaces',
      'hollow',
      'simplify',
      'createSolid',
      'hole',
      'edgeFinish',
      'featurePattern',
    ].includes(op.type) &&
    !featureTab(op.type)
  ) {
    notice('Use Undo to reverse this operation.');
    return;
  }
  clearPick();
  cancelLive();
  const token = pickGeneration,
    applied = project;
  const sourceParts =
    historyInput?.id === id && historyInput.project === applied
      ? historyInput.parts
      : await call('historySource', id);
  if (project !== applied || pickGeneration !== token) {
    void call('forgetHistory', id).catch(() => {});
    return;
  }
  historyInput = { id, project: applied, parts: sourceParts };
  toolArmed = false;
  editing = id;
  selected = op.target ?? sourceParts[0]?.id;
  activeSketchId = op.sketchId ?? null;
  await loadSavedEdges(op);
  assemblyPeers = new Set(op.tools ?? (op.reference ? [op.reference] : []));
  assemblyFaces.clear();
  pendingMate = null;
  if (op.sourceFace) {
    assemblyFaces.set(op.target, op.sourceFace);
    assemblyFaces.set(op.reference, op.destinationFace);
  }
  art = null;
  formKind = op.profileKind;
  if (['split', 'radialSplit'].includes(op.type)) {
    splitKind = op.type;
    axis = op.axis ?? 'x';
  }
  editorTab =
    op.type === 'createSolid'
      ? op.kind
      : (featureTab(op.type) ??
        (['hollow', 'simplify'].includes(op.type)
          ? op.type
          : op.tool === 'text'
            ? 'text'
            : op.type === 'combineParts'
              ? 'combine-parts'
              : op.type === 'alignParts'
                ? 'align-parts'
                : op.type === 'trimFace'
                  ? op.reference === 'top'
                    ? 'trim-top'
                    : 'trim-face'
                  : op.tool === 'move-face'
                    ? 'move-face'
                    : ['split', 'radialSplit'].includes(op.type)
                      ? 'split'
                      : op.type === 'tiltFace'
                        ? 'tilt'
                        : op.type === 'transform'
                          ? 'transform'
                          : op.type === 'cut'
                            ? 'cut-shape'
                            : 'shape'));
  stage.select(selected, hidden);
  showCommitted();
  await recoverFacePicks(op);
  if (token !== pickGeneration || historyInput?.id !== id) return;
  render();
}
document.addEventListener('submit', (e) => {
  e.preventDefault();
  if (
    !busy &&
    !inAction &&
    e.target.id === 'settings-form' &&
    (project.mode === 'track' || editorTab !== 'select')
  )
    // Enter does what the visible Apply button does.
    Promise.resolve(
      packRuleChanges().length ? applyToCollectionAction() : actions.apply(),
    ).catch(reportActionError);
});
document.addEventListener('click', async (e) => {
  const el = e.target.closest('button');
  if(el?.closest('#track-planner') || (planning && planner.busy))return;
  if (!el || el.disabled || busy || inAction || starting) return;
  const nextTab = el.dataset.tab ?? el.dataset.returnTab ?? el.dataset.openTool;
  acting(true);
  try {
    if (el.dataset.togglePartGroup) {
      setPartGroupOpen(
        el.dataset.togglePartGroup,
        el.getAttribute('aria-expanded') !== 'true',
      );
    } else if (el.dataset.visibleGroup) {
      const group = trackPartGroups.find(
        ({ id }) => id === el.dataset.visibleGroup,
      );
      if (project.mode === 'track' && group) {
        toggleGroupVisibility(group, hidden);
        stage.select(selected, hidden);
        renderParts(selectableParts(), shownDraft?.trial.selectId ?? selected);
        updateGuides();
      }
    } else if (el.dataset.sketch) {
      selectSketch(el.dataset.sketch);
    } else if (el.dataset.moveSign) {
      const distance = el.form.elements.faceDistance;
      distance.value =
        Number(el.dataset.moveSign) * (Math.abs(distance.valueAsNumber) || 1);
      distance.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (
      el.dataset.includePart ||
      (el.dataset.part && e.shiftKey && project.mode === 'editor')
    ) {
      toggleAssemblyMember(el.dataset.includePart ?? el.dataset.part);
    } else if (el.dataset.restoreField) restoreField(el.dataset.restoreField);
    else if (planning && ['save','export-menu'].includes(el.dataset.action)) await planner.action(el.dataset.action);
    else if (planning && el.dataset.action==='open') filePick('open','.slotplan,.slotfab,.stl,.svg,.dxf');
    else if (el.dataset.packPiece) await openPackPieceById(el.dataset.packPiece);
    else if (el.dataset.addSpecial) await addSpecialToPack(el.dataset.addSpecial);
    else if (el.dataset.action) await actions[el.dataset.action]?.();
    else if (nextTab) {
      if (project.mode === 'editor') cancelLive();
      pendingMate = null;
      stage.select(selected, hidden, assemblyPeers);
      if (assemblyTab(nextTab)) {
        clearPick();
        assemblyFaces.clear();
      }
      // A click on a dense mesh can still be resolving when the user chooses
      // a face tool. The pending pick belongs to the same committed surface.
      if (project.mode !== 'editor' || !isFaceTool(nextTab)) pickGeneration++;
      newEditId = null;
      focusedField = el.dataset.openTool === 'transform' ? 'mx' : '';
      if (project.mode === 'editor' && nextTab === 'select') {
        formDrafts.delete(draftKey());
        formKind = null;
        art = null;
      }
      editing = null;
      if (project.mode === 'track') trackTab = nextTab;
      else {
        editorTab = nextTab;
        if (!['select', 'edge-finish', 'hole-modify'].includes(editorTab)) {
          pickedEdges = [];
          finishEdge = null;
        }
        if (!isSolidTool(editorTab)) activeSketchId = null;
        if (editorTab === 'edge-finish' && !pickedEdges.length && pickSeed) {
          try {
            finishEdge = await nearFinishEdge(toolPart(), pickSeed);
            pickedEdges = finishEdge ? [finishEdge] : [];
          } catch (err) {
            finishEdge = null;
            notice(err.message);
          }
        }
        if (editorTab === 'trim-top') clearPick();
        toolArmed =
          editorTab !== 'select' &&
          (editorTab === 'split' ||
            isSolidTool(editorTab) ||
            isFeatureTool(editorTab) ||
            editorTab === 'simplify' ||
            assemblyTab(editorTab) ||
            editorTab === 'trim-top' ||
            formDrafts.has(draftKey()) ||
            (isFaceTool(editorTab) && !!region));
        if (pickMode === 'measure') {
          pickMode = 'select';
          measurePoints = [];
          $('[data-action="pick"]').classList.add('active');
          $('[data-action="measure"]').classList.remove('active');
          $('#view-hint').textContent = navigationHint;
        }
      }
      renderInspector();
      if (project.mode === 'editor') {
        ($('.property-scroll') ?? $('.inspector')).scrollTop = 0;
        const distance = $(
          '#settings-form [name="trimAmount"], #settings-form [name="faceDistance"]:enabled, #settings-form [name="faceHeight"]:enabled',
        );
        if (distance && window.matchMedia('(pointer: fine)').matches) {
          distance.focus({ preventScroll: true });
          distance.select();
        }
      }
    } else if (el.dataset.part) {
      if (
        (project.mode === 'track' ? selectableParts() : parts).some(
          (p) => p.id === el.dataset.part,
        )
      ) {
        if (project.mode === 'editor') cancelLive();
        toolArmed = false;
        if (project.mode === 'editor') {
          editorTab = 'select';
          pickMode = 'select';
        }
        choosePart(el.dataset.part);
      } else notice('Apply this edit to select the new part.');
    } else if (el.dataset.visible) {
      const id = el.dataset.visible;
      hidden.has(id) ? hidden.delete(id) : hidden.add(id);
      if (id === selected) {
        clearPick();
      }
      stage.select(selected, hidden);
      if (project.mode === 'track') {
        renderParts(selectableParts(), shownDraft?.trial.selectId ?? selected);
        updateGuides();
      } else render();
    } else if (el.dataset.opToggle) await toggleStep(el.dataset.opToggle);
    else if (el.dataset.opDelete) await deleteStep(el.dataset.opDelete);
    else if (el.dataset.op) await fromHistory(el.dataset.op);
  } catch (err) {
    reportActionError(err);
  } finally {
    acting(false);
  }
});
$('#inspector').addEventListener('click', (e) => {
  const button = e.target.closest('[data-auto-count]');
  if (!button || busy) return;
  const select = button.form.elements.namedItem('count_' + button.dataset.autoCount);
  changeJointCount(select, storeField, true);
  updateRestoreControls();
  refreshLive();
});
$('#inspector').addEventListener('input', (e) => {
  if (busy) return;
  // The Centred / Off-centre switch has no name: it sets the edge field.
  const el = applySlotMode(e.target) ?? e.target;
  if (!el.name) return;
  // The Lanes choice of Slot position carries the distances into the other
  // mode; those fields are part of the edit.
  for (const filled of applySlotLanes(el, el.form.elements.namedItem('laneSpacing')?.valueAsNumber))
    storeField(filled);
  changeJointCount(el, storeField);
  if (/^place_(inner|outer)/.test(el.name)) {
    const mutes = el.form.elements.placementMutes;
    if (mutes?.value) {
      mutes.value = mutes.value
        .split(',')
        .filter((key) => key !== el.name.slice(6))
        .join(',');
      storeField(mutes);
    }
  }
  if (el.name === 'trimMode') {
    const part = toolPart(),
      saved = project.editor.ops.find((op) => op.id === editing);
    const frame = trimFrame(part, saved),
      amount = el.form.elements.trimAmount;
    if (part && frame && Number.isFinite(amount.valueAsNumber)) {
      const m = faceTrimMetrics(
        part.positions,
        frame,
        el.form.dataset.trimMode,
        amount.valueAsNumber,
      );
      const converted = el.value === 'remaining' ? m.remaining : m.face - m.cut;
      amount.value = converted > 0 ? String(+converted.toPrecision(10)) : '';
      storeField(amount);
    }
    el.form.dataset.trimMode = el.value;
  }
  focusedField = el.name;
  if (el.name === 'laneMode' && el.value !== 'uniform') {
    const middle = el.form.elements.laneMiddle;
    const spacing = el.form.elements.laneSpacing.valueAsNumber;
    if (
      el.value === 'spread'
        ? middle.valueAsNumber <= spacing
        : middle.valueAsNumber >= spacing
    ) {
      middle.value = suggestedSpacing(spacing, el.value);
      storeField(middle);
    }
  }
  syncTrackShapeControls(el.form);
  storeField(el);
  if (el.name === 'tolerance') {
    updateRestoreControls();
    updateBoundaryAngle(el);
    return;
  }
  if (
    project.mode === 'editor' &&
    editorTab !== 'select' &&
    el.name !== 'tolerance'
  )
    toolArmed = true;
  if (!el.form.elements.faceMoveMode) syncOperationControls(el.form);
  if (isFeatureTool(editorTab))
    syncFeatureForm(
      el.form,
      project.editor.ops.find((op) => op.id === editing),
    );
  updateRestoreControls();
  refreshLive();
});
$('#inspector').addEventListener('focusin', (e) => {
  if (e.target.name) {
    focusedField = e.target.name;
    if (shownDraft && region) {
      if (focusedField === 'tolerance')
        stage.highlightRegions(selected, selectedFaces);
      else stage.clearHighlight();
    }
    updateGuides();
  }
});
$('#inspector').addEventListener('change', (e) => {
  if (e.target.matches('[data-silhouette-view]')) {
    updateGuides();
    return;
  }
  const name = e.target.name;
  // A committed slot distance shows the half millimetre it is stored at.
  if (project.mode === 'track' && !busy && snapSlotField(e.target)) {
    storeField(e.target);
    updateRestoreControls();
    // The snap can undo the edit, so the status and Save label follow it.
    refreshLive();
  }
  if (
    isSolidTool(editorTab) &&
    [
      'primitiveShape',
      'creationResult',
      'profileSketch',
      'loftSketch',
    ].includes(name)
  ) {
    renderInspector();
    return;
  }
  if (['assemblyTarget', 'alignment', 'combineMethod'].includes(name)) {
    pendingMate = null;
    stage.select(selected, hidden, assemblyPeers);
    renderInspector();
    return;
  }
  if (['kind', 'profileKind', 'splitKind', 'axis'].includes(name))
    renderInspector();
  if (
    trackTab === 'borders' &&
    project.mode === 'track' &&
    name === 'borderSide'
  )
    renderInspector();
});
document.addEventListener('keydown', (e) => {
  if (busy || inAction || starting || document.querySelector('dialog[open]'))
    return;
  if(planning) {
    if(e.target.matches('input,textarea,select'))return;
    const command=e.ctrlKey||e.metaKey;
    const key=command ? ({s:'save',o:'open',z:e.shiftKey?'redo':'undo',y:'redo'})[e.key.toLowerCase()]
      : e.key==='Delete'?'remove':null;
    if(key){e.preventDefault();if(key==='open')filePick('open','.slotplan');else planner.action(key);}
    return;
  }
  if (e.key === 'Escape' && scaleCar.active && !e.target.matches('select')) {
    scaleCar.close();
    $('[data-action="scale-car"]').focus();
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape' && project.mode === 'editor') {
    // Escape in a field only leaves the field; the next one closes the tool.
    if (e.target.matches('input,textarea,select')) {
      e.target.blur();
      e.preventDefault();
      return;
    }
    if (editorTab !== 'select' || pickMode === 'measure')
      $('.editor-back')?.click();
    else if (region) {
      clearPick();
      render();
    }
    e.preventDefault();
    return;
  }
  if (e.target.matches('input,textarea,select')) return;
  if (e.key === 'Escape' && (shownDraft || liveState === 'updating')) {
    Promise.resolve()
      .then(restoreForm)
      .catch(reportActionError);
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    const key = e.key.toLowerCase(),
      action =
        key === 's'
          ? 'save'
          : key === 'o'
            ? 'open'
            : key === 'z'
              ? e.shiftKey
                ? 'redo'
                : 'undo'
              : key === 'y'
                ? 'redo'
                : null;
    if (action) {
      e.preventDefault();
      // The same guard as a click: no other action runs alongside.
      acting(true);
      Promise.resolve()
        .then(() => actions[action]())
        .catch(reportActionError)
        .finally(() => acting(false));
    }
  }
});
$('#dialog').addEventListener('click', (e) => {
  if (e.target === $('#dialog')) {
    const r = $('#dialog').getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      closeDialog();
  }
});
$('#dialog').addEventListener('close', () => {
  dialogPlate = null;
  dialogPlateFit = null;
  updateGuides();
});

async function start() {
  let restored = null,
    unopened = false;
  try {
    restored = await recover();
  } catch {
    savedState = 'Use Save to keep a project file';
    unopened = true;
  }
  if (
    restored &&
    (await rebuild(restored, { record: false, fit: true, save: false }))
  )
    return;
  if (restored) unopened = true;
  // Keep the project that did not open before the next autosave replaces it.
  if (unopened && (await keepUnopened().catch(() => false)))
    notice(
      'Your last project could not be reopened. A copy is kept on this device: Settings → Download the last project.',
    );
  await rebuild(freshProject(), { record: false, fit: true, save: false });
}
// Foundry opens on Home. A link ending in #track, #editor or #planner opens
// that workspace directly (used by bookmarks and the browser tests).
start()
  .then(() => {
    const open = location.hash.slice(1);
    if (open === 'planner') return showPlanner();
    if (open !== 'track' && open !== 'editor') return showHome();
  })
  .catch(reportActionError)
  .finally(() => {
    starting = false;
  });
