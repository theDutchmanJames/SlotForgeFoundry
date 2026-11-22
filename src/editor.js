import { readSTLMesh } from './stl-mesh.js';
import { applySurfaceEdit } from './mesh-sculpt.js';
import { trimPlane } from './face-trim.js';
import { hollowFromOpening, simplifySolid } from './geometry/shell-simplify.js';
import { curvedTextTool } from './geometry/text-relief.js';
import { planFaceHeights, validateFaceProfiles } from './face-selection.js';

// All coordinates and lengths are millimetres. Returned solids belong to the caller.

const indexes = new WeakMap();
const add = (a, b) => a.map((x, i) => x + b[i]);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const times = (a, s) => a.map((x) => x * s);
const dot = (a, b) => a.reduce((v, x, i) => v + x * b[i], 0);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a) => Math.hypot(...a);
const unit = (a) => {
  const d = norm(a);
  if (!(d > 0)) throw new Error('The direction has zero length.');
  return times(a, 1 / d);
};
const rad = (a) => (a * Math.PI) / 180;
function finite(value, label) {
  if (!Number.isFinite(value))
    throw new Error(`${label} must be a finite number.`);
  return value;
}
function vector(value, size, label) {
  if (
    !Array.isArray(value) ||
    value.length !== size ||
    !value.every(Number.isFinite)
  )
    throw new Error(`${label} needs ${size} finite coordinates.`);
  return value;
}
function positive(value, label) {
  finite(value, label);
  if (value <= 0) throw new Error(`${label} must be greater than zero.`);
  return value;
}

// Each operation can allocate multiple WASM objects. Free temporary bodies even if
// Manifold rejects a boolean, but transfer ownership of the result to the caller.
function operation(run, retained = (result) => [result]) {
  const owned = new Set();
  try {
    const result = run(
      (obj) => {
        owned.add(obj);
        return obj;
      },
      (obj) => {
        if (owned.delete(obj)) obj.delete();
      },
    );
    for (const item of retained(result)) owned.delete(item);
    return result;
  } finally {
    for (const object of owned) object?.delete?.();
  }
}
function checked(solid, label, allowEmpty = false) {
  const status = solid.status();
  if (status !== 'NoError')
    throw new Error(
      `${label}: ${status}. Check for open edges, duplicate faces, or inconsistent triangle winding.`,
    );
  if (!allowEmpty && (solid.isEmpty() || !(solid.volume() > 0)))
    throw new Error(`${label} produced no positive-volume solid.`);
  return solid;
}

export function parseSTL(wasm, input) {
  const { positions, indices } = readSTLMesh(input);
  const mesh = new wasm.Mesh({
    numProp: 3,
    vertProperties: positions,
    triVerts: indices,
  });
  return operation((own) => {
    try {
      return checked(own(new wasm.Manifold(mesh)), 'STL import');
    } catch (error) {
      if (error?.code !== 'NotManifold') throw error;
      // The JS wrapper throws before returning its handle for non-manifolds.
      // Only weld round-off gaps within the kernel's mesh tolerance.
      if (mesh.merge()) {
        try {
          return checked(own(new wasm.Manifold(mesh)), 'STL import');
        } catch (retry) {
          if (retry?.code !== 'NotManifold') throw retry;
        }
      }
      throw new Error(
        'The STL is not a closed solid. Check for open edges, duplicate faces, or inconsistent triangle winding.',
      );
    }
  });
}

export function encodeSTL(
  solid,
  header = 'SlotForge Foundry | millimetres',
) {
  checked(solid, 'STL export');
  const { triVerts, vertProperties, numProp } = solid.getMesh();
  const count = triVerts.length / 3;
  const bytes = new Uint8Array(84 + count * 50);
  bytes.set(new TextEncoder().encode(header).subarray(0, 80));
  const data = new DataView(bytes.buffer);
  data.setUint32(80, count, true);
  for (let i = 0; i < count; i++) {
    const points = [];
    for (let j = 0; j < 3; j++) {
      const k = numProp * triVerts[i * 3 + j];
      points.push([
        vertProperties[k],
        vertProperties[k + 1],
        vertProperties[k + 2],
      ]);
    }
    const n = cross(sub(points[1], points[0]), sub(points[2], points[0]));
    let offset = 84 + i * 50;
    for (const p of [norm(n) ? unit(n) : [0, 0, 0], ...points])
      for (const v of p) {
        data.setFloat32(offset, v, true);
        offset += 4;
      }
  }
  return bytes;
}

function meshIndex(solid) {
  let cached = indexes.get(solid);
  if (cached) return cached;
  const mesh = solid.getMesh();
  const vertices = mesh.vertProperties,
    stride = mesh.numProp;
  const ids = new Uint32Array(mesh.triVerts);
  // Render meshes can have duplicate vertices at property seams. Use Manifold's
  // topological pairing so normal/colour discontinuities don't stop selection.
  const merged = new Map();
  for (let i = 0; i < mesh.mergeFromVert.length; i++)
    merged.set(mesh.mergeFromVert[i], mesh.mergeToVert[i]);
  for (let i = 0; i < ids.length; i++) {
    let v = ids[i];
    while (merged.has(v)) v = merged.get(v);
    ids[i] = v;
  }
  const point = (i) => [
    vertices[i * stride],
    vertices[i * stride + 1],
    vertices[i * stride + 2],
  ];
  const normals = new Float64Array(ids.length);
  const neighbors = new Int32Array(ids.length).fill(-1);
  const ends = new Map(),
    base = vertices.length / stride;
  for (let i = 0; i < ids.length; i += 3) {
    const a = point(ids[i]),
      b = point(ids[i + 1]),
      c = point(ids[i + 2]);
    normals.set(cross(sub(b, a), sub(c, a)), i);
    for (let j = 0; j < 3; j++) {
      const from = ids[i + j],
        to = ids[i + ((j + 1) % 3)];
      const key = Math.min(from, to) * base + Math.max(from, to);
      const prev = ends.get(key);
      if (prev === undefined) ends.set(key, i + j);
      else {
        neighbors[i + j] = Math.floor(prev / 3);
        neighbors[prev] = i / 3;
        ends.delete(key);
      }
    }
  }
  cached = { ids, point, normals, neighbors };
  indexes.set(solid, cached);
  return cached;
}

export function surfaceRegion(solid, triangleIndex, toleranceDeg = 8) {
  const { ids, point, normals, neighbors } = meshIndex(solid);
  if (
    !Number.isInteger(triangleIndex) ||
    triangleIndex < 0 ||
    triangleIndex * 3 >= ids.length
  )
    throw new Error('Pick a triangle on the model.');
  if (!(toleranceDeg >= 0 && toleranceDeg < 90))
    throw new Error('Boundary angle must be between 0 and 90 degrees.');
  const normalFor = (t) => Array.from(normals.subarray(t * 3, t * 3 + 3));
  const picked = new Set([triangleIndex]),
    queue = [triangleIndex];
  const threshold = Math.cos(rad(toleranceDeg)) - 1e-10;
  const centroidSum = [0, 0, 0],
    normalSum = [0, 0, 0];
  const low = [Infinity, Infinity, Infinity],
    high = [-Infinity, -Infinity, -Infinity];
  let weight = 0;
  for (let q = 0; q < queue.length; q++) {
    const t = queue[q],
      i = t * 3,
      n = normalFor(t),
      area = norm(n);
    if (!area) continue;
    const a = point(ids[i]),
      b = point(ids[i + 1]),
      c = point(ids[i + 2]);
    for (let j = 0; j < 3; j++) {
      centroidSum[j] += area * ((a[j] + b[j] + c[j]) / 3);
      normalSum[j] += n[j];
      low[j] = Math.min(low[j], a[j], b[j], c[j]);
      high[j] = Math.max(high[j], a[j], b[j], c[j]);
    }
    weight += area;
    for (let j = 0; j < 3; j++) {
      const adj = neighbors[i + j];
      if (adj < 0 || picked.has(adj)) continue;
      const other = normalFor(adj);
      if (norm(other) > 0 && dot(n, other) >= area * norm(other) * threshold) {
        picked.add(adj);
        queue.push(adj);
      }
    }
  }
  const pickedNormal = unit(normalFor(triangleIndex));
  // For a curved region, new artwork belongs on the local tangent of the click.
  const tangentOrigin = times(
    add(
      add(point(ids[triangleIndex * 3]), point(ids[triangleIndex * 3 + 1])),
      point(ids[triangleIndex * 3 + 2]),
    ),
    1 / 3,
  );
  const centroid = weight ? times(centroidSum, 1 / weight) : tangentOrigin;
  // World-space Float32 vertices on a far-from-origin part can stray to
  // either side of its plane. Test the area-weighted plane and include the
  // coordinate spacing only in directions that affect its normal.
  const planeNormal =
    norm(normalSum) > Number.EPSILON * weight ? unit(normalSum) : pickedNormal;
  const spacing = planeNormal.reduce(
    (sum, n, j) =>
      sum +
      Math.abs(n) * Math.max(Math.abs(low[j]), Math.abs(high[j])) * 2 ** -23,
    0,
  );
  const tol = 1e-5 * Math.max(1, norm(sub(high, low))) + spacing;
  const outgoing = new Map();
  let planar = true,
    simple = true;
  for (const t of queue)
    for (let j = 0; j < 3; j++) {
      const from = ids[t * 3 + j],
        to = ids[t * 3 + ((j + 1) % 3)];
      if (
        planar &&
        Math.abs(dot(sub(point(from), centroid), planeNormal)) > tol
      )
        planar = false;
      if (!picked.has(neighbors[t * 3 + j])) {
        if (outgoing.has(from)) simple = false;
        outgoing.set(from, to);
      }
    }
  const normal = planar ? planeNormal : pickedNormal;
  const u = unit(
    sub(
      Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0],
      times(normal, Math.abs(normal[0]) < 0.9 ? normal[0] : normal[1]),
    ),
  );
  const v = unit(cross(normal, u));
  const loops = [];
  if (simple && planar)
    while (outgoing.size) {
      const start = outgoing.keys().next().value;
      let current = start;
      const loop = [];
      do {
        if (!outgoing.has(current))
          throw new Error(
            'The selected boundary is open. Try a smaller selection angle.',
          );
        const d = sub(point(current), centroid);
        loop.push([dot(d, u), dot(d, v)]);
        const next = outgoing.get(current);
        outgoing.delete(current);
        current = next;
      } while (current !== start);
      if (loop.length >= 3) loops.push(loop);
    }
  return {
    origin: planar ? centroid : tangentOrigin,
    normal,
    u,
    v,
    loops,
    triangleIndices: queue,
    planar,
  };
}

function readFrame(frame) {
  if (!frame) throw new Error('Select a surface first.');
  const normal = unit(vector(frame.normal, 3, 'Surface normal'));
  const u = unit(vector(frame.u, 3, 'Horizontal axis')),
    v = unit(vector(frame.v, 3, 'Vertical axis'));
  if (Math.abs(dot(u, normal)) > 1e-5 || dot(cross(u, v), normal) < 0.99999)
    throw new Error('Invalid surface coordinate frame.');
  return { u, v, normal, location: vector(frame.origin, 3, 'Origin') };
}

function readProfile(loops) {
  if (
    !Array.isArray(loops) ||
    !loops.length ||
    loops.some((loop) => !Array.isArray(loop) || loop.length < 3)
  )
    throw new Error(
      'Use a closed shape with at least three points, or select a flat face.',
    );
  return loops.map((loop) => loop.map((p) => vector(p, 2, 'Profile point')));
}

function editAllowance(source, depth) {
  const b = source.boundingBox();
  return Math.min(
    depth * 0.002,
    Math.max(1e-5, norm(sub(b.max, b.min)) * 1e-6),
  );
}

// Include Float32 coordinate roundoff when matching the selected outline
// against the solid. Translation along the normal cannot enlarge the outline.
function faceRoundoff(frame, loops) {
  const { u, v, normal, location } = frame;
  let radius = 0;
  for (const loop of loops)
    for (const [x, y] of loop) radius = Math.max(radius, Math.hypot(x, y));
  const tangentMagnitude = norm(
    location.map((x, i) => x * Math.hypot(u[i], v[i])),
  );
  const normalMagnitude = location.reduce(
    (sum, x, i) => sum + Math.abs(x * normal[i]),
    0,
  );
  return {
    lateral: Math.max(1e-8, (tangentMagnitude + radius) * 2 ** -22),
    axial: Math.max(1e-8, (normalMagnitude + radius) * 2 ** -22),
  };
}

function surfaceCoordinates({ u, v, normal, location }) {
  // prettier-ignore
  return [
    u[0], v[0], normal[0], 0,
    u[1], v[1], normal[1], 0,
    u[2], v[2], normal[2], 0,
    -dot(location, u), -dot(location, v), -dot(location, normal), 1,
  ];
}

// A prism reconstructed from a curved rim can miss a hair of stock along its
// boundary and leave vertices at the old height. Use a widened footprint only
// to recognize complete caps. Actual cuts use the requested plane and footprint.
function cutFace(wasm, source, profile, frame, makeTool, depth, roundoff, own) {
  const { normal, location } = frame;
  const plane = dot(location, normal) - depth;
  const [above, below] = source.splitByPlane(normal, plane).map(own);
  const caps = above.decompose().map(own);
  const local = surfaceCoordinates(frame);
  const cover = own(profile.offset(roundoff.lateral, 'Miter'));
  const remaining = caps.filter((cap) => {
    const oriented = own(cap.transform(local));
    if (oriented.boundingBox().max[2] > roundoff.axial) return true;
    // Entirely inside the vertical prism iff its silhouette fits in the
    // footprint. This avoids near-coincident 3D Booleans on dense rims.
    const silhouette = own(oriented.project());
    return (
      !own(silhouette.subtract(cover)).isEmpty() ||
      own(silhouette.intersect(profile)).isEmpty()
    );
  });
  if (remaining.length === caps.length)
    return applyTool(source, makeTool(), false, own);
  if (!remaining.length) {
    if (below.isEmpty())
      throw new Error(
        'This distance would remove the entire part. Enter a smaller inward distance.',
      );
    return checked(below, 'Moving the face inward');
  }
  const tool = makeTool();
  const kept = remaining.map((cap) => own(cap.subtract(tool)));
  return checked(
    own(wasm.Manifold.union([below, ...kept])),
    'Moving the face inward',
  );
}

// Project the farthest bounding corner onto the inward surface normal. Tilt
// shears the profile sideways; its normal displacement still equals depth.
export function throughPartDepth(bounds, origin, normal) {
  const n = unit(normal);
  return Math.max(
    0,
    n.reduce(
      (depth, axis, i) =>
        depth + axis * (origin[i] - (axis < 0 ? bounds.max[i] : bounds.min[i])),
      0,
    ),
  );
}

function profileEdit(
  wasm,
  source,
  op,
  own,
  captureAddition = false,
  move = null,
) {
  const frame = readFrame(op.frame);
  const { u, v, normal, location } = frame;
  if (op.profileKind === 'face' && op.frame.planar === false)
    throw new Error('Choose a flat face to move its whole outline.');
  const offset = vector(op.offset ?? [0, 0], 2, 'Offset');
  const scale = positive(op.scale ?? 1, 'Scale');
  const through = op.type === 'cut' && op.extent === 'through';
  const depth = through
    ? throughPartDepth(source.boundingBox(), location, normal)
    : move
      ? Math.abs(move.delta)
      : positive(op.depth, 'Depth');
  if (through && depth === 0) throw Error('The cut misses the selected part.');
  const tilt = finite(op.tilt ?? 0, 'Tilt'),
    azimuth = rad(finite(op.tiltAzimuth ?? 0, 'Tilt direction'));
  if (Math.abs(tilt) >= 85) throw new Error('Use a tilt between −85° and 85°.');
  const r = rad(finite(op.rotation ?? 0, 'Rotation')),
    c = Math.cos(r),
    s = Math.sin(r);
  const loops = readProfile(op.loops).map((loop) =>
    loop.map(([x, y]) => {
      return [
        scale * (c * x - s * y) + offset[0],
        scale * (s * x + c * y) + offset[1],
      ];
    }),
  );
  const profile = own(new wasm.CrossSection(loops, 'EvenOdd'));
  if (profile.isEmpty() || !(profile.area() > 0))
    throw new Error('The profile encloses no area.');
  const direction = op.type === 'cut' ? -1 : 1;
  const along = add(
    times(normal, direction),
    times(
      add(times(u, Math.cos(azimuth)), times(v, Math.sin(azimuth))),
      Math.tan(rad(tilt)),
    ),
  );
  const wholeFace =
    op.profileKind === 'face' &&
    tilt === 0 &&
    r === 0 &&
    scale === 1 &&
    offset.every((value) => value === 0);
  const roundoff = wholeFace ? faceRoundoff(frame, loops) : null;
  if (move) {
    checkFaceTravel(source, profile, frame, roundoff, move, own);
    // A history edit can invalidate even a face already at the saved target.
    if (!move.delta) return null;
  }
  // Start far enough inside the stock to join a slightly noncoplanar STL
  // face everywhere. The outward end is still at the requested distance.
  const overlap = Math.max(editAllowance(source, depth), roundoff?.axial ?? 0);
  if (op.tool === 'text') {
    if (op.textPatch) {
      const patch = surfaceRegion(
        source,
        op.textPatch.triangle,
        op.textPatch.tolerance,
      );
      if (
        dot(patch.normal, normal) < 0.9999 ||
        Math.abs(dot(sub(op.textPatch.point, patch.origin), normal)) > 1e-3
      )
        throw Error(
          'The picked text surface has changed. Select its current surface again.',
        );
      const tool = curvedTextTool(
        wasm,
        profile,
        op,
        frame,
        meshIndex(source),
        patch.triangleIndices,
        overlap,
        own,
      );
      if (captureAddition) {
        const addition = checked(
          own(tool.subtract(source)),
          'Creating the raised lettering',
        );
        const edited = op.separate
          ? null
          : checked(own(source.add(tool)), 'Raising the lettering');
        return { addition, edited };
      }
      return applyTool(source, tool, direction > 0, own);
    }
    const local = own(source.transform(surfaceCoordinates(frame)));
    const epsilon = Math.max(source.tolerance() * 3, overlap * 0.5);
    const material = own(local.slice(-epsilon));
    if (
      own(profile.subtract(material)).area() >
        Math.max(1e-8, profile.area() * 1e-5) ||
      own(profile.intersect(own(local.slice(epsilon)))).area() >
        Math.max(1e-8, profile.area() * 1e-5)
    )
      throw Error(
        'The full label must fit on the selected surface. Move it or reduce the letter height.',
      );
  }
  const start = sub(location, times(along, overlap));
  const transform = [...u, 0, ...v, 0, ...along, 0, ...start, 1];
  // A post footprint clips Float32 triangles against an inferred inner wall.
  // Clear the reconstruction error at the exposed arc and bore. The separate
  // wall guard in post selection reserves more than this allowance.
  const cutterProfile =
    wholeFace &&
    direction < 0 &&
    op.faceRefs?.some((ref) => ref.feature === 'post')
      ? own(profile.offset(roundoff.lateral, 'Miter'))
      : profile;
  const makeTool = () => {
    const prism = own(
      cutterProfile.extrude(depth + overlap + (through ? overlap : 0)),
    );
    return own(prism.transform(transform));
  };
  if (direction < 0 && wholeFace)
    return cutFace(
      wasm,
      source,
      profile,
      frame,
      makeTool,
      depth,
      roundoff,
      own,
    );
  const tool = makeTool();
  if (captureAddition) {
    const contact = checked(
      own(source.intersect(tool)),
      'Checking profile contact',
      true,
    );
    if (!(contact.volume() > 0))
      throw new Error(
        'The profile misses the model. Move it onto a solid surface.',
      );
    // The backwards overlap joins the edited solid, but is outside the
    // printable attachment. Start its actual extrusion at the picked plane.
    const extension = own(tool.trimByPlane(normal, dot(location, normal)));
    const addition = checked(
      own(extension.subtract(source)),
      'Creating the addition',
    );
    if (
      move &&
      extension.volume() - addition.volume() >
        Math.max(extension.volume() * 1e-6, profile.area() * roundoff.axial * 3)
    )
      throw Error(
        'Another surface blocks this face before its requested height.',
      );
    const edited = op.separate
      ? null
      : checked(own(source.add(tool)), 'Adding the shape');
    return { addition, edited };
  }
  return applyTool(source, tool, direction > 0, own);
}

// Both returned solids belong to the caller's geometry operation.
export function editWithAddedProfile(wasm, source, op, own) {
  return profileEdit(wasm, source, op, own, true);
}

// Check the saved face against the material on either side of its plane. Edits
// farther up the history may have moved it since its outline was recorded.
function checkFaceTravel(source, profile, frame, roundoff, move, own) {
  const local = own(source.transform(surfaceCoordinates(frame)));
  const axial = Math.max(roundoff.axial * 2, source.tolerance() * 2, 1e-7);
  const inset = own(
    profile.offset(-Math.max(roundoff.lateral * 3, axial), 'Miter'),
  );
  const interior = inset.isEmpty() ? profile : inset;
  const areaTolerance = interior.area() * 1e-6;
  const hasMaterial = (z) =>
    own(interior.intersect(own(local.slice(z)))).area() > areaTolerance;
  if (
    own(interior.subtract(own(local.slice(-axial)))).area() > areaTolerance ||
    hasMaterial(axial)
  )
    throw Error(
      'The selected face has changed. Select its current surface again.',
    );
  if (move.delta < 0 && move.end > axial && !hasMaterial(move.delta - axial))
    throw Error(
      'The requested height falls in empty space under this face. Choose a shallower cut.',
    );
  if (move.delta > 0 && hasMaterial(move.delta + axial))
    throw Error(
      'Another surface occupies the requested height. Choose a lower height.',
    );
}

const changedSolids = ({ edited, addition }) => [edited, addition];

// Every displacement is measured on the same input solid. Each footprint keeps
// its own starting plane and holes. Dispose of each intermediate full-size body
// as soon as the next one is ready, also on failed live previews.
export function editFaceHeights(
  wasm,
  source,
  op,
  own,
  keepSeparate = op.separate,
) {
  const mesh = source.getMesh();
  const plan = planFaceHeights(
    mesh.vertProperties,
    op.faces,
    op.moveMode,
    op.value,
    mesh.numProp,
  );
  if (!plan.valid) throw Error(plan.issue);
  const removing = plan.changes.some(({ delta }) => delta < 0);
  if (op.separate && removing)
    throw Error(
      'A separate addition requires all moving faces to rise. Turn off the separate part option for cuts.',
    );
  const result = operation((keep, discard) => {
    let edited = source;
    const additions = [];
    for (const [i, change] of plan.changes.entries()) {
      const adding = change.delta > 0;
      const profileOp = {
        frame: op.faces[i].frame,
        loops: op.faces[i].loops,
        type: adding ? 'add' : 'cut',
        tool: 'move-face',
        profileKind: 'face',
        faceRefs: op.faceRefs && [op.faceRefs[i]],
        separate: keepSeparate,
      };
      let step;
      try {
        step = operation((temporary) => {
          const value = profileEdit(
            wasm,
            edited,
            profileOp,
            temporary,
            adding,
            change,
          );
          return adding ? value : { edited: value, addition: null };
        }, changedSolids);
      } catch (error) {
        throw Error(
          'Face ' + (i + 1) + ' of ' + op.faces.length + ' — ' + error.message,
        );
      }
      if (step.addition) additions.push(keep(step.addition));
      if (step.edited) {
        discard(edited);
        edited = keep(step.edited);
      }
    }
    const addition =
      additions.length > 1
        ? checked(
            keep(wasm.Manifold.union(additions)),
            'Joining face additions',
          )
        : (additions[0] ?? null);
    return { edited: edited === source ? null : edited, addition, removing };
  }, changedSolids);
  if (result.edited) own(result.edited);
  if (result.addition) own(result.addition);
  return result;
}

function applyTool(source, tool, adding, own) {
  // A small start overlap joins shapes placed exactly on a face. The far end
  // still lands at the requested depth, including for angled features.
  const contact = own(source.intersect(tool));
  checked(contact, 'Checking profile contact', true);
  if (!(contact.volume() > 0))
    throw new Error(
      'The profile misses the model. Move it onto a solid surface.',
    );
  const result = own(adding ? source.add(tool) : source.subtract(tool));
  if (!adding && result.isEmpty())
    throw new Error(
      'This cut would remove the entire part. Enter a smaller depth.',
    );
  checked(result, adding ? 'Adding the shape' : 'Cutting the shape');
  if (
    Math.abs(result.volume() - source.volume()) <
    1e-10 * Math.max(1, Math.min(tool.volume(), source.volume()))
  )
    throw new Error(
      'This operation does not change the model. Check the placement and depth.',
    );
  return result;
}

function projectedRange(loops, direction) {
  let low = Infinity,
    high = -Infinity;
  for (const loop of loops) {
    for (const point of loop) {
      const projection = dot(direction, point);
      low = Math.min(low, projection);
      high = Math.max(high, projection);
    }
  }
  return [low, high];
}

// The displayed hinge and the cutting solid share this signed distance in the
// selected face's own coordinate system, including faces on the sides of a part.
export function faceHinge(op, loops) {
  let direction;
  if (op.pivotEdge) {
    if (!Array.isArray(op.pivotEdge) || op.pivotEdge.length !== 2)
      throw new Error('Choose two endpoints for the pivot edge.');
    const [a, b] = op.pivotEdge.map((p) => vector(p, 2, 'Pivot endpoint'));
    const edge = unit(sub(b, a));
    direction = [-edge[1], edge[0]];
    const [low, high] = projectedRange(loops, direction);
    const edgePosition = dot(direction, a);
    const tolerance = Math.max(1e-6, (high - low) * 1e-6);
    if (Math.abs(edgePosition - high) <= tolerance)
      direction = times(direction, -1);
    else if (Math.abs(edgePosition - low) > tolerance)
      throw new Error(
        'Choose an outside edge with the whole face on one side.',
      );
  } else {
    const directions = {
      'u-min': [1, 0],
      'u-max': [-1, 0],
      'v-min': [0, 1],
      'v-max': [0, -1],
    };
    direction = directions[op.pivot ?? 'u-min'];
    if (!Array.isArray(direction))
      throw new Error('Choose a supported boundary for the pivot.');
  }
  const rotation = rad(finite(op.hingeRotation ?? 0, 'Hinge rotation') % 360);
  const c = Math.cos(rotation),
    s = Math.sin(rotation);
  const [du, dv] = direction;
  direction = [du * c - dv * s, du * s + dv * c];
  const [low, high] = projectedRange(loops, direction);
  const start = low + finite(op.pivotOffset ?? 0, 'Hinge offset');
  const width = high - start;
  if (width <= Math.max(1e-9, (high - low) * 1e-12))
    throw new Error(
      'The hinge offset leaves no face to tilt. Move the hinge toward the starting edge.',
    );
  return { direction, start, width };
}

// Build a wedge below the specified tilted plane, keeping the selected outline
// (including holes) fixed. Its height is zero on the pivot and increases with
// the perpendicular distance to that line.
function tiltFace(wasm, source, op, own) {
  if (op.frame?.planar === false)
    throw new Error('Tilting a face requires a flat surface.');
  const { u, v, normal, location } = readFrame(op.frame);
  const loops = readProfile(op.loops);
  const angle = finite(op.angle, 'Face angle');
  if (Math.abs(angle) < 0.001 || Math.abs(angle) >= 85)
    throw new Error('Choose a nonzero face angle below 85° in magnitude.');
  const { direction, start, width } = faceHinge(op, loops);
  const slope = Math.tan(rad(Math.abs(angle))),
    height = width * slope;
  const overlap = editAllowance(source, height);
  const profile = own(new wasm.CrossSection(loops, 'EvenOdd'));
  const prism = own(
    own(profile.extrude(height + overlap)).translate([0, 0, -overlap]),
  );
  const n = unit([slope * direction[0], slope * direction[1], -1]);
  const wedge = own(
    prism.trimByPlane(n, (slope * start) / Math.hypot(1, slope)),
  );
  const z = times(normal, Math.sign(angle));
  const tool = own(
    wedge.transform([...u, 0, ...v, 0, ...z, 0, ...location, 1]),
  );
  return applyTool(source, tool, angle > 0, own);
}

// Compare the two full models where their retained bands will meet. A plain cap
// could unite mismatched cross-sections and leave a printable but unusable ledge.
function compareAtSeam(original, moved, n, offset, own) {
  const ref = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const u = unit(cross(ref, n)),
    v = cross(n, u);
  const horizontal = [
    u[0],
    v[0],
    n[0],
    0,
    u[1],
    v[1],
    n[1],
    0,
    u[2],
    v[2],
    n[2],
    0,
    0,
    0,
    0,
    1,
  ];
  const a = own(own(original.transform(horizontal)).slice(offset));
  const b = own(own(moved.transform(horizontal)).slice(offset));
  const mismatch = own(a.subtract(b)).area() + own(b.subtract(a)).area();
  if (
    a.isEmpty() ||
    b.isEmpty() ||
    mismatch > Math.max(1e-5, Math.max(a.area(), b.area()) * 0.002)
  )
    throw new Error(
      'The cross-sections do not match at the join. Move the cut or change the copied end depth.',
    );
}

function splitOp(source, op, own) {
  const b = source.boundingBox();
  const axis = { x: 0, y: 1, z: 2 }[(op.axis ?? 'x').toLowerCase()];
  if (axis === undefined) throw new Error('Choose an X, Y or Z cut axis.');
  const n = [0, 0, 0];
  n[axis] = 1;
  const pos = finite(op.position, 'Cut position'),
    lo = b.min[axis],
    hi = b.max[axis];
  if (!(pos > lo && pos < hi))
    throw new Error('The cut must fall inside the model.');
  const low = op.keep === 'low';
  const clip = (body, keepLow, at) =>
    own(body.trimByPlane(keepLow ? times(n, -1) : n, keepLow ? -at : at));
  if (!op.rebuild) return checked(clip(source, low, pos), 'Split');
  const band = positive(op.band, 'Copied end depth');
  if (band >= Math.min(pos - lo, hi - pos))
    throw new Error('The copied end is too long for this split.');
  const seam = pos + (low ? -band : band),
    delta = pos - (low ? hi : lo);
  const donor = own(source.translate(times(n, delta)));
  compareAtSeam(source, donor, n, seam, own);
  const overlap = Math.min(band * 0.001, Math.max(1e-6, (hi - lo) * 1e-7));
  const retained = clip(source, low, seam),
    end = clip(donor, !low, seam + (low ? -overlap : overlap));
  return checked(own(retained.add(end)), 'Rebuilding the cut end');
}

function radialSplit(source, op, own) {
  const [cx, cy] = vector(op.center ?? [0, 0], 2, 'Arc centre');
  const start = finite(op.startAngle, 'Start angle'),
    end = finite(op.endAngle, 'End angle');
  const mid = finite(op.splitAngle, 'Split angle');
  if (!(start < mid && mid < end && end - start <= 180))
    throw new Error(
      'Use a single arc of up to 180°, with the split strictly between its start and end angles (counterclockwise from +X).',
    );
  const low = op.keep === 'low';
  const band = op.rebuild ? positive(op.bandAngle, 'Copied end angle') : 0;
  if (band >= Math.min(mid - start, end - mid))
    throw new Error('The copied end angle is too large for this split.');
  const plane = (deg) => [-Math.sin(rad(deg)), Math.cos(rad(deg)), 0];
  const clip = (body, keepLow, degree) => {
    const n = times(plane(degree), keepLow ? -1 : 1);
    return own(body.trimByPlane(n, n[0] * cx + n[1] * cy));
  };
  // Radial clipping uses a plane through the centre. A model extending behind
  // the centre would also intersect the opposite ray and produce extra pieces.
  const dir = [
    Math.cos(rad((start + end) / 2)),
    Math.sin(rad((start + end) / 2)),
    0,
  ];
  const mesh = source.getMesh();
  const props = mesh.vertProperties;
  // The nominal end is the surface where the roads meet. Male tabs can
  // project beyond this angle and must travel with the copied donor band.
  const angleSlack = Math.max(
    0.25,
    Math.min(10, op.rebuild ? band : (end - start) / 4),
  );
  let minAngle = Infinity,
    maxAngle = -Infinity;
  for (let i = 0; i < props.length; i += mesh.numProp) {
    const x = props[i] - cx,
      y = props[i + 1] - cy;
    if (Math.hypot(x, y) < 1e-5) continue;
    const midpoint = (start + end) / 2;
    const raw = (Math.atan2(y, x) * 180) / Math.PI;
    const unwrapped = raw + 360 * Math.round((midpoint - raw) / 360);
    minAngle = Math.min(minAngle, unwrapped);
    maxAngle = Math.max(maxAngle, unwrapped);
    if (
      unwrapped < start - angleSlack ||
      unwrapped > end + angleSlack ||
      dir[0] * x + dir[1] * y < -1e-4
    )
      throw new Error(
        'The model extends beyond the specified arc. Check its centre and end angles.',
      );
  }
  if (minAngle > start + 0.25 || maxAngle < end - 0.25)
    throw new Error('The model does not reach both specified ends of the arc.');
  if (!op.rebuild) return checked(clip(source, low, mid), 'Radial split');
  const seam = mid + (low ? -band : band),
    delta = mid - (low ? end : start);
  const q = rad(delta),
    c = Math.cos(q),
    s = Math.sin(q);
  const transform = [
    c,
    s,
    0,
    0,
    -s,
    c,
    0,
    0,
    0,
    0,
    1,
    0,
    cx - c * cx + s * cy,
    cy - s * cx - c * cy,
    0,
    1,
  ];
  const donor = own(source.transform(transform));
  const n = plane(seam);
  compareAtSeam(source, donor, n, n[0] * cx + n[1] * cy, own);
  // Independently clipped, rotated planes can differ by a few floating-point
  // units. Unite overlapping bands to avoid two closed shells merely touching.
  const overlap = Math.min(band * 0.001, 0.0001);
  return checked(
    own(
      clip(source, low, seam).add(
        clip(donor, !low, seam + (low ? -overlap : overlap)),
      ),
    ),
    'Rebuilding the arc end',
  );
}

function solidFaceRange(solid, { normal, u, v }, own) {
  const axis = normal.findIndex(
    (n, i) =>
      Math.abs(n) === 1 && normal.every((other, j) => i === j || other === 0),
  );
  if (axis >= 0) {
    const { min, max } = solid.boundingBox();
    return normal[axis] > 0 ? [min[axis], max[axis]] : [-max[axis], -min[axis]];
  }
  // Rotate the solid before taking bounds, so a corner of a rotated world
  // bounding box cannot move the opposite datum beyond the actual material.
  // prettier-ignore
  const oriented = own(solid.transform([
    u[0], v[0], normal[0], 0,
    u[1], v[1], normal[1], 0,
    u[2], v[2], normal[2], 0,
    0,    0,    0,         1,
  ]));
  const { min, max } = oriented.boundingBox();
  return [min[2], max[2]];
}

function trimFace(source, op, own) {
  const frame = readFrame(op.frame);
  const { normal, location } = frame;
  const [min, max] = solidFaceRange(source, frame, own);
  const face = op.reference === 'top' ? max : dot(normal, location);
  const trim = trimPlane(min, max, face, op.trimMode, op.amount);
  if (!trim.valid) throw new Error(trim.issue);
  const result = checked(
    own(source.trimByPlane(times(normal, -1), -trim.cut)),
    'Trimming the part',
  );
  if (op.trimMode === 'remaining') {
    const [, top] = solidFaceRange(result, frame, own);
    const tolerance = Math.max(result.tolerance() * 2, (max - min) * 1e-9);
    if (Math.abs(top - trim.cut) > tolerance)
      throw new Error(
        'This finished size falls in a gap between shells. Choose a size that reaches solid material.',
      );
  }
  return result;
}

export function applyEdit(wasm, solid, op) {
  if (!op || typeof op !== 'object')
    throw new Error('An edit operation is required.');
  if (op.type === 'surfaceEdit') return applySurfaceEdit(wasm, solid, op);
  return operation((own) => {
    if (op.type === 'hollow') {
      readProfile(op.loops);
      return hollowFromOpening(wasm, solid, op, readFrame(op.frame), own);
    }
    if (op.type === 'simplify') return simplifySolid(solid, op, own);
    if (op.type === 'moveFaces') {
      validateFaceProfiles(op.faces);
      return editFaceHeights(wasm, solid, op, own, false).edited;
    }
    if (op.type === 'add' || op.type === 'cut')
      return profileEdit(wasm, solid, op, own);
    if (op.type === 'tiltFace') return tiltFace(wasm, solid, op, own);
    if (op.type === 'trimFace') return trimFace(solid, op, own);
    if (op.type === 'split' || op.type === 'radialSplit') {
      if (!['low', 'high'].includes(op.keep))
        throw new Error('Choose which side of the cut to keep.');
      return op.type === 'split'
        ? splitOp(solid, op, own)
        : radialSplit(solid, op, own);
    }
    throw new Error(`Unknown STL operation: ${op.type}.`);
  });
}

export function additionsOnly(wasm, edited, source) {
  return operation((own) =>
    checked(own(edited.subtract(source)), 'Additions export', true),
  );
}

function roundedOutline(width, height, radius, quarterSegments) {
  const points = [];
  for (const [x, y, start] of [
    [width / 2 - radius, height / 2 - radius, 0],
    [-width / 2 + radius, height / 2 - radius, 90],
    [-width / 2 + radius, -height / 2 + radius, 180],
    [width / 2 - radius, -height / 2 + radius, 270],
  ]) {
    for (let j = 0; j <= quarterSegments; j++) {
      const a = rad(start + (j * 90) / quarterSegments);
      points.push([x + radius * Math.cos(a), y + radius * Math.sin(a)]);
    }
  }
  return points;
}

export function makeDemo(wasm, version = 2) {
  return operation((own) => {
    // Match the wall, post and bore angular grids. Older history can refer
    // to an individual edge or triangle of the original eight-chord corner.
    const quarterSegments = version === 2 ? 24 : 8;
    const extrude = (w, h, r, z) =>
      own(
        own(
          new wasm.CrossSection([roundedOutline(w, h, r, quarterSegments)]),
        ).extrude(z),
      );
    const outer = extrude(82, 54, 5, 16),
      interior = own(extrude(77.6, 49.6, 2.8, 16).translate([0, 0, 2]));
    const shell = own(outer.subtract(interior));
    const post = own(wasm.Manifold.cylinder(16, 4.3, 4.3, quarterSegments * 4)),
      drill = own(wasm.Manifold.cylinder(16, 1.7, 1.7, quarterSegments * 4));
    const bodies = [shell],
      drills = [];
    for (const x of [-36.6, 36.6])
      for (const y of [-22.6, 22.6]) {
        bodies.push(own(post.translate([x, y, 0])));
        drills.push(own(drill.translate([x, y, 2])));
      }
    const enclosure = own(
      own(wasm.Manifold.union(bodies)).subtract(
        own(wasm.Manifold.union(drills)),
      ),
    );
    // The post intersects the outer corner at a shallow angle. Collapse the
    // microscopic Boolean slivers so the common top face has simple loops.
    return checked(
      version === 2 ? own(enclosure.simplify(1e-5)) : enclosure,
      'Example enclosure',
    );
  });
}
