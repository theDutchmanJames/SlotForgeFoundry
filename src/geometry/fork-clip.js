import original from './carrera-clip.json' with { type: 'json' };
import { parseSTL } from '../editor.js';
import { SolidWorkshop } from './solids.js';
import { footprintHull } from './plate.js';
import { clipSpec, clipTypeFromHeader } from './clip-types.js';
import {
  drawKeyModel,
  keeperModel,
  keeperPrint,
  retainedPocket,
} from './retained-clip.js';

const templates = new WeakMap();
const originalBytes = Uint8Array.from(atob(original.stl), (c) =>
  c.charCodeAt(0),
);

export function clipTypeFromSTL(bytes) {
  if (
    bytes.length === originalBytes.length &&
    bytes.every((byte, i) => byte === originalBytes[i])
  )
    return 'carrera';
  return clipTypeFromHeader(bytes);
}

function rect(work, x0, x1, y0, y1) {
  return work.section([
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
  ]);
}

function model(work, spec) {
  if (spec.type === 'draw-key') return drawKeyModel(work, spec.thickness);
  const supplied = work.own(parseSTL(work.wasm, originalBytes));
  const flat = work.own(supplied.rotate([-90, 0, 0]));
  return work.own(flat.translate([0, -10, spec.thickness]));
}

function template(work, spec) {
  let cache = templates.get(work);
  if (!cache) templates.set(work, (cache = new Map()));
  const key = spec.type + '/' + spec.thickness;
  if (cache.has(key)) return cache.get(key);
  const seated = model(work, spec);
  const plan = work.own(seated.project());
  // The two open fork slots need room for the arms to flex during insertion.
  const envelope =
    spec.type === 'draw-key'
      ? plan
      : work.own(
          plan.add(
            rect(
              work,
              -spec.reach,
              spec.reach,
              -spec.halfWidth * 0.5,
              spec.halfWidth * 0.5,
            ),
          ),
        );
  const contours = plan.toPolygons();
  const result = { seated, envelope, contours, pockets: new Map() };
  result.keeper = keeperModel(work);
  result.keeperContours = work
    .own(keeperPrint(work, result.keeper).project())
    .toPolygons();
  cache.set(key, result);
  return result;
}

function place(work, solid, point, dir, z = 0) {
  return work.own(
    solid.transform([
      dir[0],
      dir[1],
      0,
      0,
      -dir[1],
      dir[0],
      0,
      0,
      0,
      0,
      1,
      0,
      point[0],
      point[1],
      z,
      1,
    ]),
  );
}

export function forkClipPair(
  work,
  p,
  fit,
  point,
  dir,
  first,
  second,
  loose,
  id,
  { anchor, ensureJointStock, externalKeeper },
) {
  const spec = clipSpec(p);
  if (p.height < spec.minimumHeight)
    throw Error(
      spec.clipName +
        ' needs at least ' +
        spec.minimumHeight +
        ' mm of track height.',
    );
  const shape = template(work, spec);
  const c = fit.clipClearance;
  if (!shape.pockets.has(c)) {
    const pocket = retainedPocket(work, spec, fit, shape.envelope);
    // Mirroring a corner must preserve the keeper's clockwise locking stops
    // on both sides of its joint with an ordinary road.
    shape.pockets.set(c, work.mirrorPockets ? work.own(pocket.mirror([0,1,0])) : pocket);
  }
  const cut = place(work, shape.pockets.get(c), point, dir);
  // Protect the roof over the high main key and the lower keeper chamber
  // separately. The rectangular support pad is much wider than the key.
  const guard =
    spec.type === 'draw-key'
      ? work.union([cut, work.own(cut.translate([0, 0, spec.roofThickness]))])
      : null;
  const span = spec.pocketHalfWidth + c;
  const depth = spec.reach + c;
  for (const [part, sign] of [
    [first, -1],
    [second, 1],
  ]) {
    if (!part) continue;
    const half = (reach, breadth, height) =>
      place(
        work,
        work.prism(
          rect(
            work,
            Math.min(0, sign * reach),
            Math.max(0, sign * reach),
            -breadth,
            breadth,
          ),
          0,
          height,
        ),
        point,
        dir,
      );
    anchor(work, part, half(depth + 1, span + 1, p.height), p);
    if (guard) {
      // A curved road-to-border seam departs from the straight tangent
      // inside the pocket. Trim to the actual part, including that crescent.
      const stock = work.and(guard, work.prism(part.section, 0, p.height));
      ensureJointStock(work, part, stock);
      if (p.hollow) part.additions.push(stock);
      (part.drawKeyGuards ??= []).push(stock);
    } else {
      const height =
        spec.seatHeight + spec.thickness + c + (spec.roofThickness ?? 0.4);
      ensureJointStock(work, part, half(depth, span, height));
    }
    part.cuts.push(cut);
  }
  if (!id && !(externalKeeper && spec.keeperOffsets?.length === 2)) return;
  const wasm = work.wasm;
  if (id)
    loose.push({
      id,
      name: spec.clipName,
      role: 'clip',
      ...(work.planning && {plannerJoint: {xy:point.slice(0,2),dir:dir.slice(),side:first?-1:1}}),
      clipType: spec.type,
      fabricationKey:
        spec.type === 'draw-key'
          ? 'double-dovetail/v2/' + spec.thickness
          : 'flat-fork/carrera',
      printContours: shape.contours,
      footprintXY: footprintHull(shape.contours.flat()),
      solid: place(work, shape.seated, point, dir, spec.seatHeight),
      printPose(callback, sideDown) {
        const stock = new SolidWorkshop(wasm);
        try {
          const free = model(stock, spec);
          return callback(
            sideDown ? free : place(stock, free, point, dir, spec.seatHeight),
          );
        } finally {
          stock.close();
        }
      },
    });
  const parentClipId = id || externalKeeper.parentClipId;
  const stationId = id || externalKeeper.stationId;
  for (const [index, offset] of spec.keeperOffsets.entries()) {
    // An open end supplies only the keeper that seats in its own half.
    if ((offset < 0 && !first) || (offset > 0 && !second)) continue;
    const center = [point[0] + dir[0] * offset, point[1] + dir[1] * offset];
    loose.push({
      id: stationId + '-retainer' + (offset ? '-' + (index + 1) : ''),
      parentClipId,
      name: 'Quarter-turn keeper',
      role: 'retainer',
      ...(work.planning && {plannerJoint: {xy:point.slice(0,2),dir:dir.slice(),side:Math.sign(offset)||(first?-1:1)}}),
      fabricationKey: 'quarter-turn-keeper/v1',
      printContours: shape.keeperContours,
      footprintXY: footprintHull(shape.keeperContours.flat()),
      solid: place(work, shape.keeper, center, dir),
      printPose(callback, sideDown) {
        const stock = new SolidWorkshop(wasm);
        try {
          const keeper = keeperModel(stock);
          return callback(
            sideDown
              ? keeperPrint(stock, keeper)
              : place(stock, keeper, center, dir),
          );
        } finally {
          stock.close();
        }
      },
    });
  }
}
