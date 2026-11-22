import { sketchBounds } from './create-sketch-data.js';
import { worldPoint } from './design.js';
import {
  defaultSketchGrid,
  gridToPlane,
  resolveSketchGrid,
} from './sketch-grid.js';

function rectangle(min, max) {
  return [min, [max[0], min[1]], max, [min[0], max[1]]];
}

export function pickedGridSurface(face) {
  const frame = {
    origin: face.seed.point,
    u: face.u,
    v: face.v,
    normal: face.normal,
  };
  const loops = face.loops.map((loop) =>
    loop.map(([x, y]) => [x - face.anchor[0], y - face.anchor[1]]),
  );
  return gridSurface(frame, loops, loops, defaultSketchGrid(loops));
}

export function savedGridSurface(record, sketch) {
  const contours =
    record.plane === 'face' && record.referenceLoops?.length
      ? record.referenceLoops
      : null;
  const config = record.grid ?? defaultSketchGrid();
  if (contours) return gridSurface(sketch.frame, contours, contours, config);
  const bounds = sketchBounds([...sketch.loops, ...sketch.paths]);
  const margin = bounds
    ? Math.max(
        config.pitch,
        0.08 * Math.max(bounds.xmax - bounds.xmin, bounds.ymax - bounds.ymin),
      )
    : 0;
  const loops = [
    bounds
      ? rectangle(
          [bounds.xmin - margin, bounds.ymin - margin],
          [bounds.xmax + margin, bounds.ymax + margin],
        )
      : rectangle([-50, -50], [50, 50]),
  ];
  return gridSurface(sketch.frame, loops, null, config);
}

function gridSurface(frame, loops, clipLoops, config) {
  const resolved = resolveSketchGrid(config, loops);
  // Extend the camera depth range for sketches offset away from their solid.
  const worldCorners = resolved.bounds
    ? rectangle(resolved.bounds.min, resolved.bounds.max).map((p) =>
        worldPoint(frame, gridToPlane(resolved, p)),
      )
    : [];
  return {
    frame,
    loops,
    clipLoops,
    config,
    resolved,
    worldCorners,
  };
}

export function gridCameraFrame(surface) {
  if (!surface) return null;
  const { frame, resolved: grid } = surface;
  const direction = ([x, y]) => frame.u.map((n, i) => n * x + frame.v[i] * y);
  return {
    origin: worldPoint(frame, grid.origin),
    normal: frame.normal,
    u: direction(grid.xAxis),
    v: direction(grid.yAxis),
    loops: grid.bounds ? [rectangle(grid.bounds.min, grid.bounds.max)] : [],
  };
}
