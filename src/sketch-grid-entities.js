import { gridToPlane, planeToGrid } from './sketch-grid.js';

// Keep native sketch dimensions editable when entering them in a rotated
// datum. Persist geometry in the original workplane so changing the grid can
// never move an already drawn or imported feature.
function mapEntity(entity, point, angle) {
  if (entity.points) return { ...entity, points: entity.points.map(point) };
  const [x, y] = point([entity.x, entity.y]);
  const result = { ...entity, x, y };
  if (entity.type !== 'circle') {
    const a = (entity.angle ?? 0) + angle;
    if (Math.abs(a % 360) > 1e-9 || entity.type === 'slot')
      result.angle = Number((a % 360).toPrecision(13));
    else delete result.angle;
  }
  return result;
}
export function sketchEntityInGrid(entity, grid) {
  const deg = (Math.atan2(grid.xAxis[1], grid.xAxis[0]) * 180) / Math.PI;
  return mapEntity(entity, (p) => planeToGrid(grid, p), -deg);
}
export function sketchEntityOnPlane(entity, grid) {
  const deg = (Math.atan2(grid.xAxis[1], grid.xAxis[0]) * 180) / Math.PI;
  return mapEntity(entity, (p) => gridToPlane(grid, p), deg);
}
