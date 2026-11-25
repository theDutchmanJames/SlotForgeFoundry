import { validateLibraryTrack } from './library-profile.js';
import { plannerSource, plannerSupports, plannerPrint } from './planner-source.js';
import { crossingCoupon } from './special-print.js';
import { buildGarage, buildingLayout, printPose } from './geometry/building.js';
import {
  buildTrack,
  fitPlate,
  chooseSegmentation,
  buildTestJoint,
} from './track.js';
import {
  parseSTL,
  encodeSTL,
  makeDemo,
  applyEdit,
  additionsOnly,
  surfaceRegion,
  editWithAddedProfile,
  editFaceHeights,
} from './editor.js';
import { activeOps,
  checkProject,
  createsSeparateAddition,
  fromBase64,
  isFlatCrossingProject,
  printsFaceUp,
} from './project.js';
import { parseDrawing } from './imports.js';
import { inspectFlatImport } from './drawings/flat-import.js';
import { packKit, packBarrierSTLs, packBorderSTLs, packSupportSTLs, printableSTL } from './kit.js';
import { packFitSamples } from './fit-samples.js';
import { keeperToolSTL } from './keeper-tool-stl.js';
import { footprintHull } from './geometry/plate.js';
import { withPrintableSolid } from './geometry/joints.js';
import { clipSTLHeader } from './geometry/clip-types.js';
import { postOnFace } from './geometry/post-selection.js';
import { meshReviewMethods } from './mesh-repair.js';
import { createSectionStore } from './geometry/section-view.js';
import { materializeSketch } from './design.js';
import { createSolid, applyCreationResult } from './geometry/create-solids.js';
import {
  applyCreationFeature,
  repeatableFeature,
} from './geometry/create-features.js';
import {
  locateHole,
  pickFinishEdge,
  resolveFinishEdge,
  topology,
  withRoundedCorner,
} from './geometry/feature-selection.js';
import { wallPickSeeds } from './geometry/wall-edge-modify.js';
import { isModification, applyModification } from './geometry/modify.js';
import { stretchReference } from './geometry/heal-stretch.js';
import {
  alignmentMatrix,
  combineBodies,
  verifyAlignmentFace,
} from './geometry/assembly.js';

function rotationToPlate(normal, op) {
  if (
    !Array.isArray(normal) ||
    normal.length !== 3 ||
    !normal.every(Number.isFinite) ||
    Math.hypot(...normal) < 1e-10
  )
    throw new Error('Pick a face with a valid normal to lay flat.');
  let [x, y, z] = normal;
  if (op.mirror) x = -x;
  const rotatePair = (a, b, deg) => {
    const angle = (deg * Math.PI) / 180;
    const c = Math.cos(angle),
      s = Math.sin(angle);
    return [a * c - b * s, a * s + b * c];
  };
  // Manifold's Euler angles rotate about global X, then Y, then Z.
  [y, z] = rotatePair(y, z, op.rotate[0]);
  [z, x] = rotatePair(z, x, op.rotate[1]);
  [x, y] = rotatePair(x, y, op.rotate[2]);
  const length = Math.hypot(x, y, z),
    horizontal = Math.hypot(x, y);
  const a = horizontal > 1e-12 * length ? -y / horizontal : 1;
  const b = horizontal > 1e-12 * length ? x / horizontal : 0;
  const c = -z / length,
    s = horizontal / length,
    t = 1 - c;
  // Shortest rotation from the face normal to (0,0,-1), column major.
  return [
    t * a * a + c,
    t * a * b,
    -s * b,
    0,
    t * a * b,
    t * b * b + c,
    s * a,
    0,
    s * b,
    -s * a,
    c,
    0,
    0,
    0,
    0,
    1,
  ];
}

function originalDifference(wasm, part, own) {
  if (!part.base) return part.solid;
  if (part.extra !== undefined) return part.extra;
  const delta = own(additionsOnly(wasm, part.solid, part.base));
  return delta.isEmpty() ? null : delta;
}

function transformPair(wasm, part, op, own, moveTools) {
  const box = part.solid.boundingBox();
  const centre = box.min.map((v, i) => (v + box.max[i]) / 2);
  const flatten = op.layFlat == null ? null : rotationToPlate(op.layFlat, op);
  const place = (solid) => {
    let placed = own(solid.translate(centre.map((n) => -n)));
    if (op.mirror) placed = own(placed.mirror([1, 0, 0]));
    placed = own(placed.scale(op.scale));
    placed = own(placed.rotate(op.rotate));
    if (flatten) placed = own(placed.transform(flatten));
    return own(placed.translate(centre.map((n, i) => n + op.move[i])));
  };
  let solid = place(part.solid);
  let base =
    part.base === part.solid ? solid : part.base ? place(part.base) : null;
  // Evaluate material differences before a rotation. Subtracting two large,
  // independently rotated surfaces can leave floating-point slivers.
  const priorExtra = originalDifference(wasm, part, own);
  let extra =
    priorExtra === part.solid ? solid : priorExtra ? place(priorExtra) : null;
  let floorShift;
  if (flatten) {
    // Use the edited body's floor for both solids, even if a bottom-side
    // addition has made its bounds different from the original reference.
    const shift = (floorShift = [0, 0, -solid.boundingBox().min[2]]);
    const same = base === solid,
      extraSame = extra === solid;
    solid = own(solid.translate(shift));
    if (base) base = same ? solid : own(base.translate(shift));
    if (extra) extra = extraSame ? solid : own(extra.translate(shift));
  }
  moveTools((tool) => {
    const moved = place(tool);
    return floorShift ? own(moved.translate(floorShift)) : moved;
  });
  return { solid, base, extra };
}

function splitReference(base, op, keep, own) {
  if (!base) return null;
  let normal, offset;
  if (op.type === 'split') {
    normal = [0, 0, 0];
    // Saved projects may spell the axis 'X'; the split itself accepts that.
    const index = ['x', 'y', 'z'].indexOf(String(op.axis ?? 'x').toLowerCase());
    if (index < 0) throw Error('The split needs a valid axis and cut position.');
    normal[index] = 1;
    offset = op.position;
  } else {
    const angle = (op.splitAngle * Math.PI) / 180;
    normal = [-Math.sin(angle), Math.cos(angle), 0];
    const centre = op.center ?? [0, 0];
    offset = normal[0] * centre[0] + normal[1] * centre[1];
  }
  const sign = keep === 'low' ? -1 : 1;
  // The copied end is new material. Only the ordinary cut region of the
  // original is the reference for deciding which material was added here.
  const result = own(
    base.trimByPlane(
      normal.map((n) => sign * n),
      sign * offset,
    ),
  );
  return result.isEmpty() ? null : result;
}

// resume (optional) continues from the state a previous run reached after its
// first resume.count steps; out (optional) receives the state after the last
// step so a later run can continue from it.
function editBodies(wasm, source, editor, loadAddedModel, placements, resume, out) {
  const bodies = resume
    ? new Map(resume.bodies)
    : new Map(
    source
      ? [
          [
            'body',
            {
              id: 'body',
              name: editor.source.label,
              role: 'body',
              clipType: editor.source.clipType,
              solid: source,
              base: source,
              extra: null,
            },
          ],
        ]
      : [],
  );
  const sketches = new Map(resume?.sketches),
    seeds = new Map();
  const lastUse = new Map();
  for (const op of editor.ops)
    if (op.type === 'featurePattern') lastUse.set(op.sourceId, op.id);
  function moveSeeds(target, transform) {
    for (const seed of seeds.values())
      if (seed.target === target) seed.tool = transform(seed.tool);
  }
  const owned = new Set();
  const own = (value) => {
    owned.add(value);
    return value;
  };
  const discardExcept = (keep) => {
    for (const solid of owned)
      if (!keep.has(solid)) {
        solid.delete();
        owned.delete(solid);
      }
  };
  function requireNewPart(id) {
    if (typeof id !== 'string' || !id || bodies.has(id))
      throw new Error('The new part ID is already in use or missing.');
  }
  for (const op of resume ? editor.ops.slice(resume.count) : editor.ops) {
    try {
      if (op.type === 'sketch') {
        const sketch = materializeSketch(op);
        if (op.attachment) {
          const host = bodies.get(op.attachment.partId);
          if (!host)
            throw Error('The sketch workplane needs its original part.');
          const anchor = locateHole(host.solid, op.attachment, false);
          sketch.frame = {
            ...op.frame,
            origin: anchor.map((x, i) => x + op.offset * op.frame.normal[i]),
          };
          placements?.set(op.id, sketch.frame);
        }
        sketches.set(op.id, sketch);
        continue;
      }
      const part = bodies.get(op.target);
      const newSolid = op.type === 'createSolid' && op.result === 'new';
      if (!part && op.type !== 'addModel' && !newSolid)
        throw new Error('The target of this edit no longer exists.');
      let seed;
      if (op.type === 'createSolid') {
        const tool = createSolid(wasm, op, sketches, own);
        if (newSolid) {
          requireNewPart(op.id);
          bodies.set(op.id, {
            id: op.id,
            name: op.label,
            role: 'body',
            solid: tool,
            base: tool,
            extra: null,
          });
        } else {
          const solid = applyCreationResult(part.solid, tool, op.result, own);
          bodies.set(part.id, {
            ...part,
            solid,
            extra:
              op.result === 'cut' && part.extra
                ? own(part.extra.intersect(solid))
                : op.result === 'cut'
                  ? part.extra
                  : undefined,
          });
          seed = { tool, mode: op.result, target: part.id };
        }
      } else if (isModification(op.type)) {
        const solid = applyModification(wasm, part.solid, op, own);
        if (op.type === 'stretchSection') {
          const stretch = (ref) => stretchReference(wasm, ref, op, own);
          const base =
            part.base === part.solid ? solid : part.base && stretch(part.base);
          const before = originalDifference(wasm, part, own);
          const extra =
            before === part.solid ? solid : before && stretch(before);
          bodies.set(part.id, { ...part, solid, base, extra });
          moveSeeds(part.id, stretch);
        } else {
          bodies.set(part.id, { ...part, solid, extra: undefined });
        }
      } else if (['hole', 'edgeFinish', 'featurePattern'].includes(op.type)) {
        const result = applyCreationFeature(wasm, part.solid, op, seeds, own);
        const extra =
          result.mode === 'cut' && part.extra
            ? own(part.extra.intersect(result.solid))
            : result.mode === 'cut'
              ? part.extra
              : undefined;
        bodies.set(part.id, { ...part, solid: result.solid, extra });
        seed = { ...result, target: part.id };
      } else if (op.type === 'addModel') {
        requireNewPart(op.id);
        const solid = own(loadAddedModel(op.data));
        bodies.set(op.id, {
          id: op.id,
          name: op.name,
          role: 'body',
          clipType: op.clipType,
          solid,
          base: solid,
          extra: null,
        });
      } else if (op.type === 'alignParts') {
        const reference = bodies.get(op.reference);
        if (!reference)
          throw Error('The alignment reference no longer exists.');
        if (op.alignment === 'faces') {
          verifyAlignmentFace(part, op.sourceFace);
          verifyAlignmentFace(reference, op.destinationFace);
        }
        const matrix = alignmentMatrix(
          part.solid.boundingBox(),
          reference.solid.boundingBox(),
          op,
        );
        const solid = own(part.solid.transform(matrix));
        const base =
          part.base === part.solid
            ? solid
            : part.base && own(part.base.transform(matrix));
        const before = originalDifference(wasm, part, own);
        const extra =
          before === part.solid
            ? solid
            : before && own(before.transform(matrix));
        bodies.set(part.id, { ...part, solid, base, extra });
        moveSeeds(part.id, (tool) => own(tool.transform(matrix)));
      } else if (op.type === 'combineParts') {
        const tools = op.tools.map((id) => {
          const tool = bodies.get(id);
          if (!tool) throw Error('A selected part no longer exists.');
          return tool;
        });
        bodies.set(
          part.id,
          combineBodies(wasm, part, tools, op.method, own, (body) =>
            originalDifference(wasm, body, own),
          ),
        );
        for (const tool of tools) bodies.delete(tool.id);
      } else if (op.type === 'separate') {
        const shells = part.solid.decompose().map(own);
        if (shells.length < 2)
          throw new Error('This part contains one connected shell.');
        for (let i = 1; i < shells.length; i++) requireNewPart(op.id + '-' + i);
        shells.forEach((solid, i) => {
          const id = i ? op.id + '-' + i : part.id;
          const base =
            part.base === part.solid
              ? solid
              : part.base
                ? own(solid.intersect(part.base))
                : null;
          const extra = part.extra
            ? own(solid.intersect(part.extra))
            : part.extra;
          bodies.set(id, {
            ...part,
            id,
            name: part.name + ' ' + (i + 1),
            solid,
            base,
            extra,
          });
        });
      } else if (op.type === 'duplicate') {
        requireNewPart(op.id);
        const solid = own(part.solid.translate(op.move));
        const base =
          part.base === part.solid
            ? solid
            : part.base
              ? own(part.base.translate(op.move))
              : null;
        const difference = originalDifference(wasm, part, own);
        const extra = difference ? own(difference.translate(op.move)) : null;
        bodies.set(op.id, {
          ...part,
          id: op.id,
          name: part.name + ' copy',
          solid,
          base,
          extra,
        });
      } else if (op.type === 'split' || op.type === 'radialSplit') {
        if (op.keep === 'both') requireNewPart(op.id);
        const keeps = op.keep === 'both' ? ['low', 'high'] : [op.keep];
        for (const keep of keeps) {
          const solid = own(applyEdit(wasm, part.solid, { ...op, keep }));
          const base =
            !op.rebuild && part.base === part.solid
              ? solid
              : splitReference(part.base, op, keep, own);
          const id = op.keep === 'both' && keep === 'high' ? op.id : part.id;
          const name =
            op.keep === 'both'
              ? part.name + (keep === 'low' ? ' A' : ' B')
              : part.name;
          const extra = op.rebuild
            ? undefined
            : part.extra
              ? splitReference(part.extra, op, keep, own)
              : part.extra;
          bodies.set(id, { ...part, id, name, solid, base, extra });
        }
      } else if (op.type === 'transform') {
        bodies.set(part.id, {
          ...part,
          ...transformPair(wasm, part, op, own, (transform) =>
            moveSeeds(part.id, transform),
          ),
        });
      } else {
        const separate = createsSeparateAddition(op);
        let profile = null;
        if (op.type === 'moveFaces')
          profile = editFaceHeights(wasm, part.solid, op, own);
        else if (
          op.type === 'add' &&
          (separate || (op.tool === 'move-face' && op.faceRefs?.length))
        )
          profile = editWithAddedProfile(wasm, part.solid, op, own);
        if (separate) {
          requireNewPart(op.id);
          const extra =
            profile?.addition ??
            own(
              additionsOnly(
                wasm,
                own(applyEdit(wasm, part.solid, op)),
                part.solid,
              ),
            );
          if (extra.isEmpty())
            throw new Error('The addition did not create a separate part.');
          bodies.set(op.id, {
            id: op.id,
            name:
              op.type === 'tiltFace' ? 'Tilt wedge' : op.label || 'Attachment',
            role: 'addition',
            clipType: part.clipType,
            solid: extra,
            base: null,
          });
        } else {
          const edited =
            profile?.edited ?? own(applyEdit(wasm, part.solid, op));
          const removing =
            profile?.removing ||
            op.type === 'cut' ||
            op.type === 'trimFace' ||
            op.type === 'hollow' ||
            op.type === 'simplify' ||
            (op.type === 'tiltFace' && op.angle < 0);
          let extra;
          if (profile?.addition) {
            let prior = originalDifference(wasm, part, own);
            if (prior && removing) prior = own(prior.intersect(edited));
            const gained =
              part.base && part.base !== part.solid
                ? own(profile.addition.subtract(part.base))
                : profile.addition;
            extra = prior ? own(prior.add(gained)) : gained;
          } else if (removing)
            extra = part.extra ? own(part.extra.intersect(edited)) : part.extra;
          bodies.set(part.id, { ...part, solid: edited, extra });
        }
      }
      if (lastUse.has(op.id) && repeatableFeature(op)) {
        if (!seed) {
          const edited = bodies.get(part.id).solid;
          const mode = op.type === 'cut' ? 'cut' : 'join';
          seed = {
            mode,
            target: part.id,
            tool: own(
              mode === 'cut'
                ? part.solid.subtract(edited)
                : edited.subtract(part.solid),
            ),
          };
        }
        seeds.set(op.id, {
          mode: seed.mode,
          tool: seed.tool,
          target: seed.target,
        });
      }
      if (lastUse.get(op.sourceId) === op.id) seeds.delete(op.sourceId);
      const keep = new Set(
        [...bodies.values()].flatMap((p) => [p.solid, p.base, p.extra]),
      );
      for (const seed of seeds.values()) keep.add(seed.tool);
      discardExcept(keep);
    } catch (error) {
      discardExcept(new Set());
      throw new Error((op.label || 'Edit') + ' — ' + error.message);
    }
  }
  // A run can be continued only when no repeat seed is waiting for a later step.
  if (out)
    out.fold = seeds.size
      ? null
      : { bodies: new Map(bodies), sketches: new Map(sketches), count: editor.ops.length };
  return [...bodies.values()];
}
// Each worker owns one active assembly. Replacement is atomic on a failed rebuild.
export function createEngine(wasm) {
  const sections = createSectionStore(wasm);
  let state = null;
  let history = null;
  const stats = { builds: 0, resumed: 0, adopted: 0 };
  // The last live preview, kept so Apply on the same project adopts it instead
  // of building it again. It may share solids with state, so it is dropped
  // before state changes.
  let pending = null;
  function dropPending() {
    if (!pending) return;
    release(pending.next, pending.retained, pending.shared);
    pending = null;
  }
  // A project's identity: its JSON without embedded models, plus those models
  // compared by string equality (they can be megabytes).
  function projectKey(project) {
    const data = [];
    const text = JSON.stringify(project, (k, v) => {
      if (k === 'data' && typeof v === 'string') {
        data.push(v);
        return data.length;
      }
      return v;
    });
    return { text, data };
  }
  const sameKey = (a, b) =>
    a.text === b.text && a.data.length === b.data.length && a.data.every((d, i) => d === b.data[i]);
  const imported = new Map();
  function loadAddedModel(data) {
    if (!imported.has(data))
      imported.set(data, parseSTL(wasm, fromBase64(data)));
    // Each build owns its handle. Manifold shares the underlying immutable mesh.
    return imported.get(data).translate([0, 0, 0]);
  }
  // Keeps the added models the applied project or the pending live preview
  // use; a model only the preview has so far must not be parsed again on
  // every keystroke.
  function pruneImports(...projects) {
    const used = new Set(
      projects.flatMap((project) =>
        project?.mode === 'editor'
          ? project.editor.ops
              .filter((op) => op.type === 'addModel')
              .map((op) => op.data)
          : [],
      ),
    );
    for (const [data, solid] of imported)
      if (!used.has(data)) {
        solid.delete();
        imported.delete(data);
      }
  }
  const solidsOf = (s) => {
    const all = new Set(
      s ? s.parts.flatMap((p) => [p.solid, p.base, p.extra]).filter(Boolean) : [],
    );
    if (s?.source) all.add(s.source);
    return all;
  };
  // Deletes the solids of s, except those still used elsewhere (the retained
  // source, or solids an incremental build shares with the other state).
  function release(s, retained, shared) {
    if (!s) return;
    const unique = solidsOf(s);
    unique.delete(retained);
    if (shared) for (const solid of solidsOf(shared)) unique.delete(solid);
    unique.forEach((solid) => solid.delete());
  }
  // Ops compared by content; embedded model data by string equality.
  const opText = (op) => JSON.stringify(op, (k, v) => (k === 'data' ? undefined : v));
  const sameOp = (a, b) => a === b || (a.data === b.data && opText(a) === opText(b));
  // A build that only adds one step after the committed history continues from
  // the committed result instead of replaying every step from the source.
  function resumable(project, ops, sourceKey, retainedSource) {
    const fold = state?.fold;
    if (!fold || state.project.mode !== 'editor' || state.sourceKey !== sourceKey)
      return null;
    if (project.editor.source.empty ? state.source : !retainedSource) return null;
    if (opText(project.editor.source) !== opText(state.project.editor.source)) return null;
    const done = activeOps(state.project.editor);
    if (done.length !== fold.count || ops.length !== fold.count + 1) return null;
    const next = ops.at(-1);
    if (next.type === 'featurePattern') return null;
    for (let i = 0; i < done.length; i++) if (!sameOp(done[i], ops[i])) return null;
    return fold;
  }
  function describeParts(parts, project) {
    return parts.map((part) => {
      const solid = part.solid;
      if (solid.isEmpty() || solid.status() !== 'NoError')
        throw new Error('The operation produced an empty or invalid part.');
      const mesh = solid.getMesh();
      const positions = new Float32Array(mesh.numVert * 3);
      for (let i = 0; i < mesh.numVert; i++)
        positions.set(
          mesh.vertProperties.subarray(i * mesh.numProp, i * mesh.numProp + 3),
          i * 3,
        );
      const bounds = solid.boundingBox();
      const footprint =
        part.footprintXY ??
        footprintHull(
          Array.from({ length: mesh.numVert }, (_, i) => [
            positions[i * 3],
            positions[i * 3 + 1],
          ]),
        );
      const fit = fitPlate(
        footprint,
        project.plate.width,
        project.plate.depth,
        project.plate.margin,
      );
      return {
        id: part.id,
        name: part.name,
        role: part.role,
        fabricationKey: part.fabricationKey,
        clipType: part.clipType,
        jointGuides: part.jointGuides,
        motorGuide: part.motorGuide,
        crankGuide: part.crankGuide,
        pitGrooveGuide: part.pitGrooveGuide,
        pitGridGrooveGuide: part.pitGridGrooveGuide,
        bridgeDiagram: part.bridgeDiagram,
        crossingSection: part.crossingSection,
        kerbMarkings: part.kerbMarkings,
        footprintXY: footprint,
        printContours: part.printContours,
        positions,
        indices: new Uint32Array(mesh.triVerts),
        bounds,
        fit,
        volume: solid.volume(),
      };
    });
  }
  function forgetHistory(id) {
    if (!history || (id && history.id !== id)) return;
    release(history, state.source);
    history = null;
  }
  function historyInput(id) {
    if (history?.id === id) return history.parts;
    const editor = state?.project.mode === 'editor' && state.project.editor;
    const index = editor ? editor.ops.findIndex((op) => op.id === id) : -1;
    if (index < 0)
      throw Error('This edit is no longer in the applied history.');
    const parts = editBodies(
      wasm,
      state.source,
      {
        ...editor,
        ops: activeOps({ ...editor, ops: editor.ops.slice(0, index) }),
      },
      loadAddedModel,
    );
    forgetHistory();
    history = { id, parts };
    return parts;
  }
  function build(project, commit = true) {
    project = checkProject(project);
    const key = projectKey(project);
    if (commit && pending && sameKey(pending.key, key)) {
      // Apply after a live preview of the same project: adopt the preview.
      const adopted = pending;
      pending = null;
      try {
        const result = describeParts(adopted.next.parts, project);
        forgetHistory();
        release(state, adopted.retained, adopted.next);
        state = { ...adopted.next, project };
        stats.adopted++;
        return result;
      } catch (e) {
        release(adopted.next, adopted.retained, adopted.shared);
        throw e;
      } finally {
        pruneImports(state?.project, pending?.next.project);
      }
    }
    dropPending();
    const asset = project.editor.source;
    const sourceKey = asset.data ?? asset.demoVersion ?? 1;
    // Both live and applied edits can reuse the same immutable original STL.
    const retainedSource =
      project.mode === 'editor' &&
      state?.source &&
      !asset.empty &&
      state.sourceKey === sourceKey
        ? state.source
        : null;
    let source, parts, next, resume;
    const placements = new Map(),
      out = {};
    try {
      if (project.mode === 'editor') {
        source = asset.empty
          ? null
          : (retainedSource ??
            (asset.data
              ? parseSTL(wasm, fromBase64(asset.data))
              : makeDemo(wasm, asset.demoVersion ?? 1)));
        const ops = activeOps(project.editor);
        resume = resumable(project, ops, sourceKey, retainedSource);
        stats.builds++;
        if (resume) stats.resumed++;
        if (resume) for (const [k, v] of state.placements) placements.set(k, v);
        parts = editBodies(
          wasm,
          source,
          { ...project.editor, ops },
          loadAddedModel,
          placements,
          resume,
          out,
        );
      } else parts = buildTrack(wasm, project.track.params, project.track.plan);
      next = {
        source,
        placements,
        sourceKey: project.mode === 'editor' ? sourceKey : undefined,
        parts,
        project,
        fold: out.fold ?? null,
      };
      const result = describeParts(parts, project);
      if (commit) {
        forgetHistory();
        release(state, retainedSource, resume && next);
        state = next;
      } else {
        pending = { key, next, retained: retainedSource, shared: resume ? state : null };
      }
      return result;
    } catch (e) {
      if (next) release(next, retainedSource, resume && state);
      else if (source !== retainedSource) source?.delete();
      throw e;
    } finally {
      pruneImports(state?.project, pending?.next.project);
    }
  }
  function find(id) {
    const part = state?.parts.find((p) => p.id === id);
    if (!part) throw new Error('Select a part first.');
    return part;
  }
  function exported(mode, id) {
    const single = mode === 'part' || mode === 'printPart' ? find(id) : null;
    if (mode === 'printPart')
      return printableSTL(single, encodeSTL, single.clipType, state.project);
    if (mode === 'assembly' && isFlatCrossingProject(state?.project))
      throw Error(
        'Export All printable parts for separate ' +
          (printsFaceUp(state.project) ? 'road' : 'road-face-down') +
          ' STLs, supports and the crossing assembly map.',
      );
    if (mode === 'part')
      return withPrintableSolid(single, (solid) =>
        encodeSTL(solid, clipSTLHeader(single.clipType)),
      );
    if (mode === 'additions') {
      if (state.project.mode !== 'editor')
        throw new Error('Additions only is available in the STL editor.');
      const additions = [],
        temporary = [];
      let clipType;
      try {
        for (const part of state.parts) {
          const difference = originalDifference(wasm, part, (s) => {
            temporary.push(s);
            return s;
          });
          if (difference && !difference.isEmpty() && difference.volume() > 0) {
            additions.push(difference);
            clipType ??= part.clipType;
          }
        }
        if (!additions.length)
          throw new Error('There is no added material to export.');
        const result = wasm.Manifold.union(additions);
        temporary.push(result);
        return encodeSTL(result, clipSTLHeader(clipType));
      } finally {
        temporary.forEach((s) => s.delete());
      }
    }
    const included = state.parts.filter(
      (p) => mode !== 'base' || p.role !== 'addition',
    );
    if (!included.length)
      throw Error('Create or add a solid before exporting an STL.');
    const union = wasm.Manifold.union(included.map((p) => p.solid));
    try {
      return encodeSTL(
        union,
        clipSTLHeader(included.find((p) => p.clipType)?.clipType),
      );
    } finally {
      union.delete();
    }
  }
  function kit() {
    if (!state.parts.length)
      throw Error('Create or add a solid before exporting a kit.');
    return packKit(wasm, state.parts, state.project, encodeSTL);
  }
  function pickPart(id, historyId) {
    const part = historyId
      ? historyInput(historyId).find((p) => p.id === id)
      : find(id);
    if (!part) throw Error('Select a part that exists at this step.');
    return part;
  }
  function pickedSurface({
    id,
    triangle,
    tolerance,
    historyId,
    point,
    preferPost,
  }) {
    const part = pickPart(id, historyId);
    const region = surfaceRegion(part.solid, triangle, tolerance);
    return preferPost ? (postOnFace(wasm, region, point) ?? region) : region;
  }
  function describeEdge(edge) {
    const {
      a,
      b,
      n1,
      n2,
      convex,
      witness,
      circle,
      centerWitness,
      halfEdge,
      corner,
      cornerPath,
    } = edge;
    return {
      a,
      b,
      n1,
      n2,
      convex,
      witness,
      circle,
      centerWitness,
      halfEdge,
      ...(corner ? { corner, cornerPath } : {}),
    };
  }
  return {
    build,
    plannerSource: args => plannerSource(wasm,args,describeParts),
    plannerSupports: args => plannerSupports(wasm,args,describeParts),
    plannerPrint: args => plannerPrint(wasm,args),
    // A building: its parts where they stand, for the 3D view, with their
    // print sizes and how much filament the kit takes.
    buildingParts: ({ building, plate }) => {
      const parts = buildGarage(wasm, building);
      try {
        const sizes = buildingLayout(building).parts;
        const shown = describeParts(parts, { plate });
        return shown.map((p) => ({ ...p, print: sizes.find((s) => s.id === p.id).print }));
      } finally {
        for (const p of parts) p.solid.delete();
      }
    },
    // A building as STL files, each part as it prints.
    buildingKit: ({ building }) => {
      const parts = buildGarage(wasm, building);
      try {
        return parts.map((part) => {
          const printed = printPose(part);
          try {
            return { id: part.id, name: part.name, bytes: encodeSTL(printed, 'SlotForge Foundry building | ' + part.name + ' | millimetres') };
          } finally {
            printed.delete();
          }
        });
      } finally {
        for (const p of parts) p.solid.delete();
      }
    },
    validateLibraryTrack: (track) => validateLibraryTrack(wasm, track),
    sketchPlacements: () => [...(state?.placements ?? [])],
    preview: (project) => build(project, false),
    buildStats: () => ({ ...stats }),
    historySource: (id) => describeParts(historyInput(id), state.project),
    forgetHistory,
    pick: pickedSurface,
    pickEdge: ({ id, historyId, triangle, point, tolerance }) => {
      const edge = pickFinishEdge(
        pickPart(id, historyId).solid,
        triangle,
        point,
      );
      if (!edge || edge.pickDistance > tolerance) return null;
      return describeEdge(edge);
    },
    restoredEdges: ({ id, historyId, edges }) => {
      const { solid } = pickPart(id, historyId);
      return edges.map((ref) => {
        const edge = describeEdge(
          withRoundedCorner(topology(solid), resolveFinishEdge(solid, ref)),
        );
        // Perimeter selection follows the side originally clicked, even if
        // the worker found this crease from the opposite triangle on replay.
        if (
          !ref.circle &&
          edge.n1.reduce((sum, x, i) => sum + x * ref.n1[i], 0) < 0.99999
        ) {
          [edge.n1, edge.n2] = [edge.n2, edge.n1];
          [edge.a, edge.b] = [edge.b, edge.a];
          delete edge.halfEdge;
        }
        return edge;
      });
    },
    wallPicks: ({ id, historyId, walls }) =>
      wallPickSeeds(pickPart(id, historyId).solid, walls),
    ...meshReviewMethods(wasm),
    sectionView: sections.sectionView,
    closeSection: sections.closeSection,
    export: ({ mode, id }) => exported(mode, id),
    kit,
    keeperToolSTL: () => keeperToolSTL(wasm),
    fitSamples: (params) => packFitSamples(wasm, params),
    crossingSample: (params) => {
      const solid = crossingCoupon(wasm, params);
      try {
        return printableSTL({ solid, role: 'road' }, encodeSTL, undefined,
          { mode: 'track', track: { params } });
      } finally {
        solid.delete();
      }
    },
    borderSTLs: () =>
      packBorderSTLs(state?.parts ?? [], encodeSTL, state?.project),
    barrierSTLs: () =>
      packBarrierSTLs(state?.parts ?? [], encodeSTL, state?.project),
    supportSTLs: () =>
      packSupportSTLs(state?.parts ?? [], encodeSTL, state?.project),
    testJoint: ({ params, which }) => {
      const pieces = buildTestJoint(wasm, params, which);
      try {
        const source = {
          ...state.project,
          track: { ...state.project.track, params },
        };
        return packKit(wasm, pieces, source, encodeSTL, 'source-track.slotfab');
      } finally {
        pieces.forEach((p) => p.solid.delete());
      }
    },
    suggest: ({
      id,
      params = state.project.track.params,
      plate = state.project.plate,
      plan = state.project.track.plan,
    }) => chooseSegmentation(wasm, params, plan, plate, id),
    parse: ({ text, ext }) => parseDrawing(text, ext),
    flatImport: ({ lanes, heights, width, profile }) =>
      inspectFlatImport({ lanes, heights }, width, profile),
    dispose: () => {
      sections.dispose();
      dropPending();
      forgetHistory();
      release(state);
      pruneImports(null);
      state = null;
    },
  };
}
