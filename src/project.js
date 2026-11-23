import { BRAID_DEFAULTS, defaultTrack, RIB_DEFAULTS } from './track.js';
import { braidRaised } from './geometry/solids.js';
import { validateSpecialType } from './special-pieces.js';
import { currentJointSettings } from './geometry/joint-fit.js';
import { validateConnectorCounts } from './geometry/placements.js';
import { refreshCustomTrack, validateCustomTrack } from './custom-track.js';
import { validateFlatCrossing } from './flat-crossing-validation.js';
import { validateSurfaceEdit } from './mesh-sculpt.js';
import { validateSlotDimensions } from './geometry/shape-profile.js';
import { MAX_SELECTED_FACES, validateFaceProfiles } from './face-selection.js';
import { validFrame, workplaneLabels } from './design.js';
import { validateSketch } from './create-sketch-data.js';
import { validateSketchGrid } from './sketch-grid.js';
import { validateCreation } from './geometry/create-solids.js';
import { isModification, validateModification } from './geometry/modify.js';
import {
  validateCreationFeature,
  repeatableFeature,
} from './geometry/create-features.js';

export function isFlatCrossingProject(project) {
  return (
    project?.mode === 'track' &&
    project.track.params.kind === 'import' &&
    project.track.plan?.flatCrossing?.crossings?.length > 0
  );
}

// A raised land for copper tape would be the lowest thing on the bed of a
// face-down print, so these pieces lie underside down whatever else applies.
export function printsFaceUp(project) {
  const p = project?.mode === 'track' && project.track.params;
  return Boolean(p) && braidRaised(p) && p.braidWidth > 0;
}

export function newProject() {
  return {
    format: 'slotforge-fabrication',
    version: 1,
    name: 'Club bend',
    mode: 'track',
    track: {
      params: {
        ...defaultTrack(),
        kind: 'curve',
        radius: 345,
        width: 110,
        laneSpacing: 50,
        angle: 30,
        joint: 'none',
        borderSide: 'outer',
        borderSegments: 2,
        borderEntry: 12,
        borderApex: 36,
        borderExit: 18,
        borderMount: 'none',
        borderJoint: 'none',
      },
      plan: null,
      sourceName: '',
    },
    editor: {
      source: { label: 'Workshop enclosure', demoVersion: 2 },
      ops: [],
    },
    plate: { width: 200, depth: 200, margin: 0 },
  };
}

const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finiteVector = (v, n) =>
  Array.isArray(v) && v.length === n && v.every(Number.isFinite);
const validId = (id) => typeof id === 'string' && /^[\w.:/-]{1,200}$/.test(id);
// Library records (packs, pieces, STL parts) use the Library's own ids.
const libraryId = (id) => typeof id === 'string' && /^[\w.-]{1,128}$/.test(id);

export function createsSeparateAddition(op) {
  return (
    !!op.separate &&
    (op.type === 'add' ||
      op.type === 'moveFaces' ||
      (op.type === 'tiltFace' && op.angle > 0))
  );
}

function validatePaths(paths, minLength, budget) {
  if (!Array.isArray(paths))
    throw new Error('Project geometry must be a list of paths.');
  for (const path of paths) {
    if (!Array.isArray(path) || path.length < minLength)
      throw new Error('Project contains an incomplete path.');
    budget.points -= path.length;
    if (budget.points < 0)
      throw new Error(
        'Saved project has too many points. Use a smaller model or drawing.',
      );
    if (!path.every((p) => finiteVector(p, 2)))
      throw new Error('Project geometry contains invalid XY coordinates.');
  }
}

// Steps switched off in STL Edit stay in the history but are not replayed.
export function activeOps(editor) {
  if (!editor?.off?.length) return editor?.ops ?? [];
  const off = new Set(editor.off);
  return editor.ops.filter((op) => !off.has(op.id));
}
function checkEditHistory(ops, embeddedLength, empty) {
  const operationIds = new Set(['body']),
    parts = new Set(empty ? [] : ['body']),
    consumed = new Set(),
    shellOperations = new Set();
  const sketches = new Set(),
    repeatable = new Map();
  const budget = { points: 2000000 };
  const isPart = (id) =>
    !consumed.has(id) &&
    (parts.has(id) ||
      (/^.+-[1-9]\d*$/.test(id) &&
        shellOperations.has(id.slice(0, id.lastIndexOf('-')))));
  for (const op of ops) {
    if (
      !record(op) ||
      (![
        'add',
        'cut',
        'moveFaces',
        'hollow',
        'simplify',
        'tiltFace',
        'trimFace',
        'surfaceEdit',
        'split',
        'radialSplit',
        'transform',
        'duplicate',
        'separate',
        'addModel',
        'alignParts',
        'combineParts',
        'sketch',
        'createSolid',
        'hole',
        'edgeFinish',
        'featurePattern',
      ].includes(op.type) &&
        !isModification(op.type))
    ) {
      throw new Error('Saved project contains an unknown edit operation.');
    }
    if (op.curveVersion !== undefined && ![1, 2].includes(op.curveVersion))
      throw new Error('Unknown curve geometry version in the saved edit.');
    const independent =
      op.type === 'addModel' ||
      op.type === 'sketch' ||
      (op.type === 'createSolid' && op.result === 'new');
    if (!independent && (!validId(op.target) || !isPart(op.target)))
      throw new Error('A saved edit refers to a missing target part.');
    if (
      op.faceCount !== undefined &&
      (!Number.isInteger(op.faceCount) ||
        op.faceCount < 1 ||
        op.faceCount > MAX_SELECTED_FACES)
    )
      throw new Error('Invalid number of selected faces in saved edit.');
    if (op.faceRefs !== undefined) {
      if (
        !Array.isArray(op.faceRefs) ||
        !op.faceRefs.length ||
        op.faceRefs.length > MAX_SELECTED_FACES ||
        (op.faceCount !== undefined && op.faceCount !== op.faceRefs.length) ||
        op.faceRefs.some(
          (ref) =>
            !record(ref) ||
            !Number.isSafeInteger(ref.triangle) ||
            ref.triangle < 0 ||
            !finiteVector(ref.point, 3) ||
            (ref.whole !== undefined && typeof ref.whole !== 'boolean') ||
            (ref.feature !== undefined && ref.feature !== 'post') ||
            (ref.tolerance !== undefined &&
              (!Number.isFinite(ref.tolerance) ||
                ref.tolerance < 0 ||
                ref.tolerance >= 90)),
        )
      )
        throw new Error(
          'Invalid saved face selection. Each face needs a triangle and a finite pick point.',
        );
      budget.points -= op.faceRefs.length;
    }
    const isSplit = op.type === 'split' || op.type === 'radialSplit';
    const createsPart =
      (op.type === 'createSolid' && op.result === 'new') ||
      op.type === 'addModel' ||
      op.type === 'duplicate' ||
      op.type === 'separate' ||
      createsSeparateAddition(op) ||
      (isSplit && op.keep === 'both');
    if (
      !validId(op.id) ||
      operationIds.has(op.id) ||
      isPart(op.id) ||
      consumed.has(op.id)
    )
      throw new Error('Each saved edit needs a unique ID.');
    operationIds.add(op.id);
    if (createsPart) {
      if (op.type === 'separate') shellOperations.add(op.id);
      else parts.add(op.id);
    }
    if (op.type === 'sketch') {
      if (
        !validFrame(op.frame) ||
        !Object.hasOwn(workplaneLabels, op.plane) ||
        !Number.isFinite(op.offset) ||
        typeof op.name !== 'string' ||
        !op.name.trim() ||
        op.name.length > 200
      )
        throw Error('The sketch needs a name and a valid workplane.');
      budget.points -= validateSketch(op.sketch);
      if (op.grid !== undefined) validateSketchGrid(op.grid);
      if (op.attachment) {
        const a = op.attachment;
        if (
          op.plane !== 'face' ||
          !isPart(a.partId) ||
          !validFrame({ ...a.seat, origin: op.frame.origin }) ||
          !finiteVector(a.seat?.witness, 3) ||
          ![a.fromU, a.fromV].every((x) =>
            ['min', 'max', 'center'].includes(x),
          ) ||
          ![a.offsetU, a.offsetV].every(Number.isFinite)
        )
          throw Error('The sketch face reference is invalid.');
      }
      if (op.referenceLoops) validatePaths(op.referenceLoops, 3, budget);
      if (budget.points < 0)
        throw Error('This project exceeds the sketch point limit.');
      sketches.add(op.id);
      continue;
    }
    if (
      op.type === 'featurePattern' &&
      repeatable.get(op.sourceId) !== op.target
    )
      throw Error('Select an earlier feature on this part for the pattern.');
    if (repeatableFeature(op)) repeatable.set(op.id, op.target);
    if (op.type === 'createSolid') {
      validateCreation(op);
      const references = op.kind === 'primitive' ? [] : [op.sketchId];
      if (op.kind === 'sweep') references.push(op.pathId);
      if (op.kind === 'loft') references.push(op.sectionId);
      if (references.some((id) => !sketches.has(id)))
        throw Error('Choose sketches that exist before this operation.');
      continue;
    }
    if (isModification(op.type)) {
      if (op.type === 'healFeature')
        validatePaths(op.profile?.loops, 3, budget);
      validateModification(op);
      continue;
    }
    if (['hole', 'edgeFinish', 'featurePattern'].includes(op.type)) {
      validateCreationFeature(op);
      continue;
    }
    if (op.type === 'addModel') {
      if (
        typeof op.data !== 'string' ||
        !op.data.length ||
        op.data.length > 180000000 ||
        typeof op.name !== 'string' ||
        !op.name.trim() ||
        op.name.length > 2048
      )
        throw Error('The added STL needs a file name and embedded model data.');
      embeddedLength += op.data.length;
      if (embeddedLength > 250 * 1024 * 1024)
        throw Error(
          'The embedded models exceed the project file size. Simplify a model before adding it.',
        );
      continue;
    }
    if (op.type === 'combineParts') {
      if (
        !['join', 'subtract', 'intersect'].includes(op.method) ||
        !Array.isArray(op.tools) ||
        !op.tools.length ||
        new Set(op.tools).size !== op.tools.length ||
        op.tools.some((id) => id === op.target || !validId(id) || !isPart(id))
      )
        throw Error(
          'Combine requires two or more distinct parts that exist at this step.',
        );
      for (const id of op.tools) consumed.add(id);
      continue;
    }
    if (op.type === 'alignParts') {
      if (
        !validId(op.reference) ||
        !isPart(op.reference) ||
        op.reference === op.target ||
        !['centres', 'stack', 'faces'].includes(op.alignment) ||
        !Number.isFinite(op.gap)
      )
        throw Error(
          'Alignment needs two distinct parts, a placement and a finite offset.',
        );
      if (
        op.alignment === 'faces' &&
        [op.sourceFace, op.destinationFace].some(
          (f) =>
            !finiteVector(f?.point, 3) ||
            !finiteVector(f?.normal, 3) ||
            Math.hypot(...f.normal) < 1e-10,
        )
      )
        throw Error('Pick a flat face on each part to align them.');
      continue;
    }
    if (op.type === 'surfaceEdit') {
      validateSurfaceEdit(op);
      budget.points -= op.selection.length;
      if (budget.points < 0)
        throw Error('The saved selections exceed the project size limit.');
      continue;
    }
    if (op.type === 'hollow') {
      if (
        !(op.thickness > 0) ||
        !Number.isFinite(op.thickness) ||
        !record(op.frame) ||
        !['origin', 'normal', 'u', 'v'].every((key) =>
          finiteVector(op.frame[key], 3),
        ) ||
        !op.loops?.length
      )
        throw Error(
          'Hollow needs a flat opening and a positive wall thickness.',
        );
      validatePaths(op.loops, 3, budget);
      continue;
    }
    if (op.type === 'simplify') {
      if (
        !(op.deviation > 0) ||
        !Number.isFinite(op.deviation) ||
        (op.triangleTarget != null &&
          (!Number.isSafeInteger(op.triangleTarget) || op.triangleTarget < 4))
      )
        throw Error(
          'Simplify needs a positive surface deviation and a valid triangle target.',
        );
      continue;
    }
    if (op.tool === 'text') {
      if (
        !['add', 'cut'].includes(op.type) ||
        op.profileKind !== 'text' ||
        typeof op.text !== 'string' ||
        !op.text.trim() ||
        op.text.length > 128 ||
        !(op.textHeight > 0) ||
        !Number.isFinite(op.textHeight) ||
        (op.separate != null && typeof op.separate !== 'boolean') ||
        (op.type === 'cut' && op.separate) ||
        !finiteVector(op.userOffset ?? [0, 0], 2) ||
        !finiteVector(op.baseOffset ?? [0, 0], 2)
      )
        throw Error(
          'The text edit needs printable text, a height and placement.',
        );
      if (
        op.textPatch &&
        (!Number.isSafeInteger(op.textPatch.triangle) ||
          op.textPatch.triangle < 0 ||
          !finiteVector(op.textPatch.point, 3) ||
          !(op.textPatch.tolerance >= 0 && op.textPatch.tolerance < 90))
      )
        throw Error('The text edit has an invalid surface reference.');
    }
    if (op.type === 'moveFaces') {
      if (
        !['height', 'offset'].includes(op.moveMode) ||
        !Number.isFinite(op.value) ||
        (op.moveMode === 'height' ? op.value < 0 : op.value === 0)
      )
        throw Error(
          'Choose a signed face offset or a height at or above the part base.',
        );
      if (
        !Array.isArray(op.faces) ||
        !op.faces.length ||
        op.faces.length > MAX_SELECTED_FACES ||
        (op.faceCount != null && op.faceCount !== op.faces.length) ||
        (op.faceRefs != null && op.faceRefs.length !== op.faces.length)
      )
        throw Error(
          'Each selected face needs its own saved outline and starting plane.',
        );
      if (op.separate != null && typeof op.separate !== 'boolean')
        throw Error('The separate part setting must be on or off.');
      if (op.separate && op.moveMode === 'offset' && op.value < 0)
        throw Error('A separate addition requires an outward face offset.');
      for (const face of op.faces) validatePaths(face?.loops, 3, budget);
      validateFaceProfiles(op.faces);
      continue;
    }
    if (op.type === 'transform' || op.type === 'duplicate') {
      if (!finiteVector(op.move, 3))
        throw new Error('Move requires three finite coordinates.');
      if (
        op.type === 'transform' &&
        (!finiteVector(op.rotate, 3) ||
          !Number.isFinite(op.scale) ||
          op.scale <= 0)
      ) {
        throw new Error('Transform requires a valid rotation and scale.');
      }
    }
    if (isSplit && !['low', 'high', 'both'].includes(op.keep))
      throw new Error('Choose which split parts to keep.');
    if (
      op.type === 'split' &&
      (!['x', 'y', 'z'].includes(String(op.axis ?? 'x').toLowerCase()) ||
        !Number.isFinite(op.position))
    ) {
      throw new Error('The split needs a valid axis and cut position.');
    }
    if (
      op.type === 'radialSplit' &&
      (!finiteVector(op.center ?? [0, 0], 2) ||
        ![op.startAngle, op.splitAngle, op.endAngle].every(Number.isFinite))
    ) {
      throw new Error('The radial split needs a valid centre and angles.');
    }
    if (
      isSplit &&
      op.rebuild &&
      !(
        Number.isFinite(op.type === 'split' ? op.band : op.bandAngle) &&
        (op.type === 'split' ? op.band : op.bandAngle) > 0
      )
    ) {
      throw new Error('The rebuild needs a positive end width or angle.');
    }
    if (
      op.type === 'transform' &&
      op.layFlat !== undefined &&
      (!finiteVector(op.layFlat, 3) || Math.hypot(...op.layFlat) <= 1e-12)
    )
      throw new Error('Lay flat needs a valid surface normal.');
    if (['add', 'cut', 'tiltFace', 'trimFace'].includes(op.type)) {
      if (
        !record(op.frame) ||
        !['origin', 'u', 'v', 'normal'].every((k) =>
          finiteVector(op.frame[k], 3),
        )
      ) {
        throw new Error('The edit is missing its surface coordinate frame.');
      }
      if (op.type === 'trimFace') {
        if (
          !['remove', 'remaining'].includes(op.trimMode) ||
          !Number.isFinite(op.amount) ||
          op.amount <= 0
        )
          throw new Error(
            'A trim needs a measurement type and a positive distance.',
          );
        const [x, y, z] = op.frame.normal;
        const length = Math.hypot(x, y, z);
        if (!(length > 0) || !Number.isFinite(length))
          throw new Error('A trim needs a valid surface normal.');
        if (
          (op.reference != null && !['face', 'top'].includes(op.reference)) ||
          (op.reference === 'top' && (x !== 0 || y !== 0 || z <= 0))
        )
          throw new Error('A top trim needs a vertical cut direction.');
        continue;
      }
      if (op.type === 'tiltFace') {
        if (
          !Number.isFinite(op.angle) ||
          Math.abs(op.angle) < 0.001 ||
          Math.abs(op.angle) >= 85
        )
          throw new Error('Invalid face tilt angle.');
        if (
          op.pivotEdge != null &&
          (!Array.isArray(op.pivotEdge) ||
            op.pivotEdge.length !== 2 ||
            !op.pivotEdge.every((p) => finiteVector(p, 2)))
        ) {
          throw new Error('The pivot edge needs two XY endpoints.');
        }
        if (
          op.pivot !== undefined &&
          !['u-min', 'u-max', 'v-min', 'v-max'].includes(op.pivot)
        )
          throw new Error('Invalid face pivot.');
        if (
          ![op.hingeRotation ?? 0, op.pivotOffset ?? 0].every(Number.isFinite)
        )
          throw new Error('Hinge rotation and offset must be finite numbers.');
        if (op.separate != null && typeof op.separate !== 'boolean')
          throw new Error('The separate part setting must be on or off.');
        if (op.separate && op.angle < 0)
          throw new Error(
            'A recessed face removes material. Use a positive angle for a separate wedge.',
          );
      } else {
        if (op.profileKind === 'slot')
          validateSlotDimensions(op.shapeWidth, op.shapeHeight);
        if (
          op.extent != null &&
          (op.type !== 'cut' ||
            op.tool === 'move-face' ||
            !['through', 'distance'].includes(op.extent))
        )
          throw new Error('Choose a valid cut extent.');
        if (
          op.extent !== 'through' &&
          (!Number.isFinite(op.depth) || op.depth <= 0)
        )
          throw new Error('The edit needs a positive depth.');
        if (
          !finiteVector(op.offset ?? [0, 0], 2) ||
          ![
            op.tilt ?? 0,
            op.tiltAzimuth ?? 0,
            op.rotation ?? 0,
            op.scale ?? 1,
          ].every(Number.isFinite) ||
          Math.abs(op.tilt ?? 0) >= 85 ||
          (op.scale ?? 1) <= 0
        )
          throw new Error('The edit needs a valid scale, angle and offset.');
      }
      if (!op.loops?.length)
        throw new Error('The edit needs a closed profile.');
      validatePaths(op.loops, 3, budget);
    }
  }
}

export function checkProject(p) {
  if (!p || p.format !== 'slotforge-fabrication' || p.version !== 1)
    throw new Error('Choose a SlotForge Foundry v1 project.');
  if (
    !['editor', 'track'].includes(p.mode) ||
    typeof p.name !== 'string' ||
    p.name.length > 2048 ||
    !record(p.track?.params) ||
    !record(p.editor?.source) ||
    typeof p.editor.source.label !== 'string' ||
    !Array.isArray(p.editor.ops) ||
    p.editor.ops.length > 500
  )
    throw new Error('The project is missing its track or editor settings.');
  let params = currentJointSettings(p.track.params);
  if (params.reinforcement === undefined || params.ribSpacing === undefined)
    params = { ...RIB_DEFAULTS, ...params };
  if (params.braidStyle === undefined || params.braidRaise === undefined)
    params = { ...BRAID_DEFAULTS, ...params };
  validateConnectorCounts(params.connectorCounts);
  validateSpecialType(params);
  if (params.special && (p.track.plan || p.track.custom))
    throw Error('The saved piece contains both a special template and a separate drawing.');
  if (params !== p.track.params) p = { ...p, track: { ...p.track, params } };
  const { width, depth, margin } = p.plate ?? {};
  if (
    ![width, depth, margin].every(Number.isFinite) ||
    width <= 0 ||
    depth <= 0 ||
    margin < 0 ||
    2 * margin >= Math.min(width, depth)
  )
    throw new Error('The plate needs a positive usable width and depth.');
  const source = p.editor.source.data;
  if (
    source !== undefined &&
    (typeof source !== 'string' || !source.length || source.length > 180000000)
  ) {
    throw new Error(
      'The embedded STL is empty or exceeds the project size limit.',
    );
  }
  const blank = p.editor.source.empty;
  const demoVersion = p.editor.source.demoVersion;
  if (demoVersion !== undefined && ![1, 2].includes(demoVersion))
    throw Error('Unknown version of the example enclosure.');
  if (
    blank !== undefined &&
    (typeof blank !== 'boolean' || (blank && source !== undefined))
  )
    throw Error('Choose an empty design or an embedded source model.');
  if (p.editor.off !== undefined) {
    // Switched-off steps are not replayed, but they must still be readable
    // steps with their own ids (switching one on replays it).
    if (!p.editor.ops.every((op) => record(op) && validId(op.id)))
      throw Error('The project contains an unreadable edit.');
    const ids = new Set(p.editor.ops.map((op) => op.id));
    if (ids.size !== p.editor.ops.length)
      throw Error('The project contains two edits with the same id.');
    if (
      !Array.isArray(p.editor.off) ||
      p.editor.off.length > 500 ||
      !p.editor.off.every((id) => ids.has(id))
    )
      throw Error('The project lists switched-off edits that do not exist.');
  }
  checkEditHistory(activeOps(p.editor), source?.length ?? 0, blank);
  if (p.libraryPiece !== undefined) {
    const link = p.libraryPiece;
    if (
      !record(link) ||
      !libraryId(link.collectionId) ||
      !libraryId(link.pieceId) ||
      !Number.isSafeInteger(link.revision) ||
      link.revision < 1
    )
      throw Error('The project contains an invalid library piece reference.');
  }
  // STL Edit: the Library STL part this model is, the part it was based on,
  // and the pack piece it came from (Edit as STL).
  if (p.stlPart !== undefined) {
    const link = p.stlPart;
    const okSource = (s) =>
      s == null ||
      (record(s) &&
        libraryId(s.collectionId) &&
        libraryId(s.pieceId) &&
        typeof s.part === 'string' &&
        s.part.length <= 200 &&
        Number.isSafeInteger(s.revision) &&
        (s.label === undefined || (typeof s.label === 'string' && s.label.length <= 400)));
    if (
      !record(link) ||
      (link.id != null && !libraryId(link.id)) ||
      (link.basedOn != null && !libraryId(link.basedOn)) ||
      !okSource(link.source)
    )
      throw Error('The project contains an invalid STL part reference.');
  }
  if (p.track.custom !== undefined) {
    validateCustomTrack(p.track.custom);
    const track = refreshCustomTrack(p.track);
    if (track !== p.track) p = { ...p, track };
  }
  if (p.track.plan != null) {
    if (!record(p.track.plan) || !Array.isArray(p.track.plan.lanes))
      throw new Error('Invalid Circuit drawing in project.');
    const budget = { points: 2000000 };
    for (const k of [
      'lanes',
      'outlines',
      'shapes',
      'braidEdges',
      'tapeEdges',
      'slotEdges',
      'tables',
      'openPaths',
    ]) {
      if (p.track.plan[k] !== undefined)
        validatePaths(
          p.track.plan[k],
          ['outlines', 'shapes', 'tables'].includes(k) ? 3 : 2,
          budget,
        );
    }
    if (p.track.plan.flatCrossing !== undefined)
      validateFlatCrossing(p.track.plan, budget, validatePaths);
  }
  // Only an untouched generated example can gain finer source geometry
  // without changing what an existing face, triangle or edge pick refers to.
  if (
    !blank &&
    !source &&
    demoVersion === undefined &&
    p.editor.ops.length === 0
  )
    return {
      ...p,
      editor: {
        ...p.editor,
        source: { ...p.editor.source, demoVersion: 2 },
      },
    };
  return p;
}

export function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 16384)
    binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(binary);
}
export const fromBase64 = (text) =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
export const cleanName = (value) =>
  String(value)
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .slice(0, 80)
    .trim() || 'Part';

export function openStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('slotforge-fabrication', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('workbench');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function autosave(project) {
  const db = await openStore();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('workbench', 'readwrite');
      tx.objectStore('workbench').put(project, 'last');
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function recover() {
  const db = await openStore();
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction('workbench')
        .objectStore('workbench')
        .get('last');
      request.onsuccess = () =>
        resolve(request.result ? checkProject(request.result) : null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
// The autosave has one slot. When the last project cannot be reopened, a copy
// is kept under its own key before anything new is autosaved over it.
export async function keepUnopened() {
  const db = await openStore();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('workbench', 'readwrite');
      const store = tx.objectStore('workbench');
      let kept = false;
      const request = store.get('last');
      request.onsuccess = () => {
        if (request.result) {
          store.put(request.result, 'unopened');
          kept = true;
        }
      };
      tx.oncomplete = () => resolve(kept);
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function readUnopened() {
  const db = await openStore();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('workbench').objectStore('workbench').get('unopened');
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
