import { faceSupportRange } from './face-trim.js';

export const MAX_SELECTED_FACES = 1024;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const difference = (a, b) => a.map((value, i) => value - b[i]);
const parallelFacesMessage =
  'Choose flat faces facing the same direction on parallel planes.';
const overlappingFacesMessage =
  'These outlines touch or overlap. Choose separate post tops.';

function sourceFace(region) {
  if (region.sourceFaceKey != null) return region.sourceFaceKey;
  return region.triangleIndices.reduce((min, i) => Math.min(min, i), Infinity);
}

const triangleSets = new WeakMap();
function triangles(region) {
  let set = triangleSets.get(region);
  if (!set) {
    set = new Set(region.triangleIndices);
    triangleSets.set(region, set);
  }
  return set;
}

export function sameSelectedFace(a, b) {
  if (a.partId !== b.partId || a.feature !== b.feature) return false;
  if (a.featureKey != null || b.featureKey != null)
    return a.featureKey === b.featureKey && sourceFace(a) === sourceFace(b);
  return (
    a.triangleIndices.length === b.triangleIndices.length &&
    sourceFace(a) === sourceFace(b) &&
    b.triangleIndices.every((id) => triangles(a).has(id))
  );
}

function flatOutline(region) {
  return region.planar && region.loops?.length > 0;
}

function inFrame(region, frame) {
  if (region === frame) return region.loops;
  const delta = difference(region.origin, frame.origin);
  const x = dot(delta, frame.u),
    y = dot(delta, frame.v);
  const ux = dot(region.u, frame.u),
    vx = dot(region.v, frame.u);
  const uy = dot(region.u, frame.v),
    vy = dot(region.v, frame.v);
  return region.loops.map((loop) =>
    loop.map(([a, b]) => [x + a * ux + b * vx, y + a * uy + b * vy]),
  );
}

function fitsPlane(region, frame, allowDifferentHeight = false) {
  if (dot(region.normal, frame.normal) < 1 - 1e-6) return false;
  const z = allowDifferentHeight
    ? 0
    : dot(difference(region.origin, frame.origin), frame.normal);
  const dzU = dot(region.u, frame.normal),
    dzV = dot(region.v, frame.normal);
  // Picks come from Float32 mesh vertices. Only normal displacement matters,
  // and a far-away model must never turn a real step into a shared face plane.
  const magnitude = frame.normal.reduce(
    (sum, n, i) =>
      sum +
      Math.abs(n) *
        Math.max(Math.abs(frame.origin[i]), Math.abs(region.origin[i])),
    0,
  );
  const tolerance = 1e-5 + Math.min(1e-3, magnitude * 2 ** -23);
  return region.loops.every((loop) =>
    loop.every(([a, b]) => Math.abs(z + a * dzU + b * dzV) <= tolerance),
  );
}

function bounds(loops) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const loop of loops)
    for (const [x, y] of loop) {
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
    }
  return box;
}

const separateBoxes = (a, b) =>
  a[0] > b[2] || b[0] > a[2] || a[1] > b[3] || b[1] > a[3];

function edgesMeet(a, b, c, d) {
  if (
    Math.max(a[0], b[0]) < Math.min(c[0], d[0]) ||
    Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
    Math.max(a[1], b[1]) < Math.min(c[1], d[1]) ||
    Math.max(c[1], d[1]) < Math.min(a[1], b[1])
  )
    return false;
  const side = (p, q, r) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return (
    side(a, b, c) * side(a, b, d) <= 0 && side(c, d, a) * side(c, d, b) <= 0
  );
}

function contains(loops, [x, y]) {
  let inside = false;
  for (const loop of loops) {
    let previous = loop.at(-1);
    for (const next of loop) {
      if (
        previous[1] > y !== next[1] > y &&
        x <
          previous[0] +
            ((y - previous[1]) * (next[0] - previous[0])) /
              (next[1] - previous[1])
      )
        inside = !inside;
      previous = next;
    }
  }
  return inside;
}

function overlappingProfiles(a, b) {
  if (separateBoxes(bounds(a), bounds(b))) return false;
  for (const left of a)
    for (const right of b) {
      if (separateBoxes(bounds([left]), bounds([right]))) continue;
      for (let i = 0; i < left.length; i++)
        for (let j = 0; j < right.length; j++)
          if (
            edgesMeet(
              left[i],
              left[(i + 1) % left.length],
              right[j],
              right[(j + 1) % right.length],
            )
          )
            return true;
    }
  return (
    a.some((loop) => contains(b, loop[0])) ||
    b.some((loop) => contains(a, loop[0]))
  );
}

export function updateFaceSelection(members, picked, extend) {
  if (!extend || !members.length) return [picked];
  const first = members[0];
  if (picked.partId !== first.partId)
    throw new Error(
      'Choose faces on the same part. Click a new part to start another selection.',
    );
  const duplicate = members.findIndex((member) =>
    sameSelectedFace(member, picked),
  );
  if (duplicate >= 0) return members.filter((_, index) => index !== duplicate);
  if (
    !flatOutline(first) ||
    !flatOutline(picked) ||
    !fitsPlane(picked, first, true)
  )
    throw new Error(parallelFacesMessage);
  if (members.length >= MAX_SELECTED_FACES)
    throw new Error(
      'Select up to ' + MAX_SELECTED_FACES + ' faces in one edit.',
    );
  const outline = inFrame(picked, first);
  for (const member of members) {
    const sharedSource = sourceFace(member) === sourceFace(picked);
    const overlappingTriangles =
      !member.feature &&
      !picked.feature &&
      picked.triangleIndices.some((id) => triangles(member).has(id));
    if (
      (sharedSource && (!member.feature || !picked.feature)) ||
      overlappingTriangles
    )
      throw new Error(
        'This face includes an existing selection. Click it without Shift to select the whole face.',
      );
    // Distinct full faces on one plane already have disjoint interiors.
    // Stacked levels and clipped features can occupy the same footprint.
    if (
      (member.feature || picked.feature || !fitsPlane(picked, member)) &&
      overlappingProfiles(inFrame(member, first), outline)
    )
      throw new Error(overlappingFacesMessage);
  }
  return [...members, picked];
}

export function composeFaceSelection(members) {
  if (members.length < 2) return members[0] ?? null;
  const first = members[0];
  const coplanar = members.every((member) => fitsPlane(member, first));
  const ids = new Set();
  for (const member of members)
    for (const id of member.triangleIndices) ids.add(id);
  return {
    partId: first.partId,
    origin: first.origin,
    normal: first.normal,
    u: first.u,
    v: first.v,
    planar: true,
    coplanar,
    loops: coplanar ? members.flatMap((member) => inFrame(member, first)) : [],
    triangleIndices: [...ids],
    faceCount: members.length,
    members,
  };
}

const profileCache = new WeakMap();

// Express each outline in the group's axes, at its own centre and elevation.
// Only coplanar groups can also be used as a single, combined profile.
export function faceProfiles(selection) {
  if (!selection) return [];
  const cached = profileCache.get(selection);
  if (cached) return cached;
  const members = selection.members ?? [selection];
  if (!members.every(flatOutline)) return [];
  const { u, v, normal } = members[0];
  const profiles = members.map((member) => {
    const frame = { u, v, normal, origin: member.origin };
    const loops =
      member.u === u && member.v === v ? member.loops : inFrame(member, frame);
    return { frame, loops };
  });
  profileCache.set(selection, profiles);
  return profiles;
}

const finiteVector = (v, length) =>
  Array.isArray(v) && v.length === length && v.every(Number.isFinite);

function validProfileFrame(frame) {
  if (
    !frame ||
    !['origin', 'u', 'v', 'normal'].every((k) => finiteVector(frame[k], 3))
  )
    return false;
  const { u, v, normal } = frame;
  if (
    [u, v, normal].some((axis) => Math.abs(dot(axis, axis) - 1) > 1e-5) ||
    Math.abs(dot(u, normal)) > 1e-5 ||
    Math.abs(dot(v, normal)) > 1e-5 ||
    Math.abs(dot(u, v)) > 1e-5
  )
    return false;
  const cross = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  return dot(cross, normal) > 1 - 1e-5;
}

export function validateFaceProfiles(profiles) {
  if (
    !Array.isArray(profiles) ||
    !profiles.length ||
    profiles.length > MAX_SELECTED_FACES
  )
    throw new Error(
      'Choose between 1 and ' + MAX_SELECTED_FACES + ' flat faces.',
    );
  const first = profiles[0]?.frame;
  const projected = [];
  for (const profile of profiles) {
    if (
      !validProfileFrame(profile?.frame) ||
      !Array.isArray(profile.loops) ||
      !profile.loops.length ||
      !profile.loops.every(
        (loop) =>
          Array.isArray(loop) &&
          loop.length >= 3 &&
          loop.every((p) => finiteVector(p, 2)),
      )
    )
      throw new Error(
        'Each selected face needs a valid surface frame and closed outline.',
      );
    const region = { ...profile.frame, loops: profile.loops };
    if (!fitsPlane(region, first, true)) throw new Error(parallelFacesMessage);
    const loops = inFrame(region, first);
    projected.push({ loops, box: bounds(loops) });
  }
  projected.sort((left, right) => left.box[0] - right.box[0]);
  for (let i = 0; i < projected.length; i++) {
    const left = projected[i];
    for (let j = i + 1; j < projected.length; j++) {
      const right = projected[j];
      if (right.box[0] > left.box[2]) break;
      if (
        !separateBoxes(left.box, right.box) &&
        overlappingProfiles(left.loops, right.loops)
      )
        throw new Error(overlappingFacesMessage);
    }
  }
}

// Supports come from the unedited target for this operation. This includes
// rotated and bottom-facing edits, where the lowest world Z is irrelevant.
export function planFaceHeights(positions, profiles, mode, value, stride = 3) {
  if (!profiles?.length || !positions?.length)
    return {
      valid: false,
      issue: 'Select a flat face on a solid part.',
      changes: [],
    };
  const { min, max, normal } = faceSupportRange(
    positions,
    profiles[0].frame.normal,
    stride,
  );
  const tolerance =
    1e-5 + Math.min(1e-3, Math.max(Math.abs(min), Math.abs(max)) * 2 ** -23);
  const amount = Number.isFinite(value) ? value : NaN;
  const changes = profiles.map(({ frame }) => {
    const start = dot(frame.origin, normal) - min;
    const displacement = mode === 'height' ? amount - start : amount;
    if (Math.abs(displacement) <= tolerance)
      return { start, end: start, delta: 0 };
    const end = mode === 'height' ? amount : start + displacement;
    return { start, end, delta: displacement };
  });
  let issue = '';
  if (!(max > min) || !Number.isFinite(max - min))
    issue = 'Select a face on a solid part.';
  else if (!['offset', 'height'].includes(mode) || !Number.isFinite(value))
    issue = 'Enter a finite face offset or target height.';
  else if (
    changes.some(
      ({ start }) =>
        !Number.isFinite(start) ||
        start < -tolerance ||
        start > max - min + tolerance,
    )
  )
    issue = 'A selected face is outside this part. Select the faces again.';
  else if (
    (mode === 'height' && value < 0) ||
    changes.some(({ end }) => end < -tolerance)
  )
    issue =
      'This would move a face past the part base. Choose a smaller cut or a height of 0 mm or more.';
  else if (
    changes.some(
      ({ end, delta }) => !Number.isFinite(end) || !Number.isFinite(delta),
    )
  )
    issue = 'This distance is too large. Choose a smaller measurement.';
  else if (changes.every(({ delta }) => delta === 0))
    issue =
      mode === 'height'
        ? 'All selected faces are already at this height.'
        : 'Enter a nonzero face offset.';
  return { valid: !issue, issue, min, max, normal, changes };
}

function sameLoop(left, right, eps) {
  const close = (a, b) =>
    Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
  const start = right.findIndex((point) => close(left[0], point));
  if (start < 0) return false;
  return [1, -1].some((step) =>
    left.every((p, i) =>
      close(p, right[(start + right.length + i * step) % right.length]),
    ),
  );
}

// Saved contours remain authoritative if upstream geometry changes. Triangle
// seeds are safe to re-highlight only after verifying the complete profile.
export function matchesSavedFaceOutline(selection, frame, loops) {
  if (
    !selection ||
    !flatOutline(selection) ||
    !frame ||
    !loops ||
    selection.loops.length !== loops.length ||
    !fitsPlane(selection, frame) ||
    selection.members?.some((member) => !fitsPlane(member, frame))
  )
    return false;
  const remaining = new Map();
  for (const loop of loops) {
    if (!remaining.has(loop.length)) remaining.set(loop.length, new Set());
    remaining.get(loop.length).add(loop);
  }
  const box = bounds(loops);
  const epsilon =
    1e-6 +
    Math.min(1e-4, Math.max(box[2] - box[0], box[3] - box[1]) * 2 ** -23);
  for (const projected of inFrame(selection, frame)) {
    const candidates = remaining.get(projected.length);
    const match =
      candidates &&
      Array.from(candidates).find((loop) => sameLoop(projected, loop, epsilon));
    if (!match) return false;
    candidates.delete(match);
  }
  return true;
}
