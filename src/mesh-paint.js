import { Matrix4 } from 'three';

// A compact depth / triangle-ID image answers brush and lasso queries without
// raycasting every candidate through an entire scan. Build once per viewpoint.
export function visibleFaceMap(mesh, camera, width, height) {
  const scale = Math.min(1, 768 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale)),
    h = Math.max(1, Math.round(height * scale));
  const matrix = new Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  ).elements;
  const screen = new Float32Array(mesh.positions.length);
  for (let i = 0; i < screen.length; i += 3) {
    const x = mesh.positions[i],
      y = mesh.positions[i + 1],
      z = mesh.positions[i + 2];
    screen[i] =
      ((1 + matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) * w) /
      2;
    screen[i + 1] =
      ((1 - matrix[1] * x - matrix[5] * y - matrix[9] * z - matrix[13]) * h) /
      2;
    screen[i + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  }
  const depth = new Float32Array(w * h).fill(Infinity),
    ids = new Int32Array(w * h).fill(-1);
  for (let k = 0; k < mesh.indices.length; k += 3) {
    const a = mesh.indices[k] * 3,
      b = mesh.indices[k + 1] * 3,
      c = mesh.indices[k + 2] * 3;
    const ax = screen[a],
      ay = screen[a + 1],
      dx = screen[b] - ax,
      dy = screen[b + 1] - ay,
      ex = screen[c] - ax,
      ey = screen[c + 1] - ay;
    const area = dx * ey - dy * ex;
    if (area >= -1e-10) continue;
    const xmin = Math.max(0, Math.floor(Math.min(ax, ax + dx, ax + ex))),
      xmax = Math.min(w - 1, Math.ceil(Math.max(ax, ax + dx, ax + ex)));
    const ymin = Math.max(0, Math.floor(Math.min(ay, ay + dy, ay + ey))),
      ymax = Math.min(h - 1, Math.ceil(Math.max(ay, ay + dy, ay + ey)));
    for (let y = ymin; y <= ymax; y++)
      for (let x = xmin; x <= xmax; x++) {
        const px = x + 0.5 - ax,
          py = y + 0.5 - ay;
        const u = (px * ey - py * ex) / area,
          v = (dx * py - dy * px) / area;
        if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
        const z =
          screen[a + 2] +
          u * (screen[b + 2] - screen[a + 2]) +
          v * (screen[c + 2] - screen[a + 2]);
        const i = y * w + x;
        if (z >= -1 && z <= 1 && z < depth[i]) {
          depth[i] = z;
          ids[i] = k / 3;
        }
      }
  }
  return { ids, w, h, sx: w / width, sy: h / height };
}

export function brushFaces(map, x, y, radius, visit) {
  const xmin = Math.max(0, Math.floor((x - radius) * map.sx)),
    xmax = Math.min(map.w - 1, Math.floor((x + radius) * map.sx));
  const ymin = Math.max(0, Math.floor((y - radius) * map.sy)),
    ymax = Math.min(map.h - 1, Math.floor((y + radius) * map.sy));
  for (let row = ymin; row <= ymax; row++)
    for (let col = xmin; col <= xmax; col++) {
      const dx = (col + 0.5) / map.sx - x,
        dy = (row + 0.5) / map.sy - y;
      const f = map.ids[row * map.w + col];
      if (f >= 0 && dx * dx + dy * dy <= radius * radius) visit(f);
    }
}

export function lassoFaces(map, polygon, visit) {
  if (polygon.length < 3) return;
  const points = polygon.map(([x, y]) => [x * map.sx, y * map.sy]);
  for (let row = 0; row < map.h; row++) {
    const y = row + 0.5,
      hits = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      if (a[1] > y !== b[1] > y)
        hits.push(a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]));
    }
    hits.sort((a, b) => a - b);
    for (let i = 0; i + 1 < hits.length; i += 2) {
      const end = Math.min(map.w - 1, Math.floor(hits[i + 1] - 0.5));
      for (let x = Math.max(0, Math.ceil(hits[i] - 0.5)); x <= end; x++) {
        const f = map.ids[row * map.w + x];
        if (f >= 0) visit(f);
      }
    }
  }
}
