// Colors used by the rasterizer are four RGBA bytes in ImageData's native order.
const bytes = new Uint8ClampedArray(4);
const packed = new Uint32Array(bytes.buffer);
// Projection and interpolation use doubles, then the depth buffer stores
// Float32. Allow two Float32 steps in normalized device coordinates.
const depthTolerance = 2 ** -22;

export function rgba(r, g, b) {
  bytes[0] = r;
  bytes[1] = g;
  bytes[2] = b;
  bytes[3] = 255;
  return packed[0];
}

export function paintMesh(markings) {
  const positions = [],
    indices = [],
    colors = [];
  for (const { color, points } of markings) {
    const start = positions.length / 3;
    const rgb = Number.parseInt(color.slice(1), 16);
    const ink = rgba(rgb >> 16, (rgb >> 8) & 255, rgb & 255);
    for (const p of points) positions.push(...p);
    for (let j = 2; j < points.length; j++) {
      indices.push(start, start + j - 1, start + j);
      colors.push(ink);
    }
  }
  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    colors: Uint32Array.from(colors),
    z: Math.fround(markings[0].points[0][2]),
  };
}

function project(mesh, matrix, width, height) {
  const { positions } = mesh;
  const out = (mesh.screen ??= new Float64Array(positions.length));
  // The workbench camera is orthographic. All three screen coordinates vary
  // linearly along a triangle, including its depth.
  for (let i = 0; i < out.length; i += 3) {
    const x = positions[i],
      y = positions[i + 1],
      z = positions[i + 2];
    out[i] =
      ((matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12] + 1) *
        width) /
      2;
    out[i + 1] =
      ((1 - (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13])) *
        height) /
      2;
    out[i + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  }
  return out;
}

// Pixel centres and half-open scanline spans give adjacent faces identical
// coverage on their shared edge. Applying ink to the visible face ID also
// keeps colour off recessed walls and objects in front of a painted surface.
export class SoftwareRaster {
  constructor(context, width, height) {
    this.width = width;
    this.height = height;
    this.image = context.createImageData(width, height);
    this.color = new Uint32Array(this.image.data.buffer);
    this.depth = new Float32Array(width * height);
    this.face = new Int32Array(width * height);
  }
  draw(context, objects, matrix, highlight, grid) {
    this.color.fill(0);
    this.depth.fill(Infinity);
    this.face.fill(0);
    let start = 1;
    const visible = [];
    for (const obj of objects) {
      const mesh = obj.userData.preview,
        ink = obj.userData.kerbPaint;
      let local = matrix;
      const translation =
        obj === highlight && obj.parent?.isMesh
          ? obj.parent.position
          : obj.position;
      if (translation && (translation.x || translation.y || translation.z)) {
        local = matrix.slice();
        for (let j = 0; j < 3; j++)
          local[12 + j] +=
            matrix[j] * translation.x +
            matrix[4 + j] * translation.y +
            matrix[8 + j] * translation.z;
      }
      const s = project(mesh, local, this.width, this.height);
      const { indices, positions, palette, shades } = mesh;
      const end = start + indices.length / 3;
      const bias = obj === highlight ? -depthTolerance : 0;
      visible.push({
        mesh,
        ink,
        start,
        end,
        local,
        selected: obj === highlight || mesh.trackSelected,
      });
      for (let f = 0; f < indices.length / 3; f++) {
        const a = indices[3 * f] * 3,
          b = indices[3 * f + 1] * 3,
          c = indices[3 * f + 2] * 3;
        const painted =
          ink &&
          positions[a + 2] === ink.z &&
          positions[b + 2] === ink.z &&
          positions[c + 2] === ink.z;
        const face = painted ? start + f : -(start + f);
        this.triangle(s, a, b, c, palette[shades[f]], face, bias, 0, 0);
      }
      start = end;
    }
    for (const { ink, start, end, local } of visible) {
      if (!ink) continue;
      const s = project(ink, local, this.width, this.height);
      for (let f = 0; f < ink.colors.length; f++) {
        const i = f * 3;
        this.triangle(
          s,
          ink.indices[i] * 3,
          ink.indices[i + 1] * 3,
          ink.indices[i + 2] * 3,
          ink.colors[f],
          0,
          0,
          start,
          end,
        );
      }
    }
    for (const { mesh, start, selected } of visible) {
      const { screen, indices, marks } = mesh;
      for (let f = 0; f < marks.length; f++) {
        if (!marks[f]) continue;
        for (let j = 0; j < 3; j++) {
          if (marks[f] & (1 << j))
            this.edge(
              screen,
              indices[3 * f + j] * 3,
              indices[3 * f + ((j + 1) % 3)] * 3,
              start + f,
              selected,
            );
        }
      }
    }
    if (grid) this.drawGrid(grid, matrix);
    context.putImageData(this.image, 0, 0);
  }
  drawGrid(grid, matrix) {
    const s = project(grid, matrix, this.width, this.height);
    const p = project(grid.plane, matrix, this.width, this.height);
    const ux = p[3] - p[0],
      uy = p[4] - p[1],
      uz = p[5] - p[2];
    const vx = p[6] - p[0],
      vy = p[7] - p[1],
      vz = p[8] - p[2],
      det = ux * vy - uy * vx;
    if (Math.abs(det) < 1e-12) return;
    const dzdx = (uz * vy - vz * uy) / det,
      dzdy = (ux * vz - vx * uz) / det;
    // Compare at pixel centres even on inclined faces so a coplanar
    // construction line stays continuous while closer surfaces hide it.
    for (let i = 0; i < s.length; i += 6) {
      const dx = s[i + 3] - s[i],
        dy = s[i + 4] - s[i + 1];
      const steep = Math.abs(dy) > Math.abs(dx),
        u = steep ? 1 : 0,
        v = 1 - u;
      const a = s[i + u],
        b = s[i + 3 + u],
        d = b - a;
      if (Math.abs(d) < 1e-8) continue;
      const stop = Math.min(
        steep ? this.height : this.width,
        Math.ceil(Math.max(a, b) - 0.5),
      );
      for (
        let n = Math.max(0, Math.ceil(Math.min(a, b) - 0.5));
        n < stop;
        n++
      ) {
        const f = (n + 0.5 - a) / d,
          pos = s[i + v] + f * (s[i + 3 + v] - s[i + v]);
        const k = Math.floor(pos);
        const x = steep ? k : n,
          y = steep ? n : k;
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
        const z = p[2] + dzdx * (x + 0.5 - p[0]) + dzdy * (y + 0.5 - p[1]);
        const at = y * this.width + x;
        if (z < -1 || z > 1 || z > this.depth[at] + 2 * depthTolerance)
          continue;
        const pixels = this.image.data,
          at4 = 4 * at;
        if (pixels[at4 + 3] === 0) {
          pixels[at4] = 50;
          pixels[at4 + 1] = 108;
          pixels[at4 + 2] = 114;
          pixels[at4 + 3] = 142;
        } else {
          pixels[at4] += (50 - pixels[at4]) * 0.56;
          pixels[at4 + 1] += (108 - pixels[at4 + 1]) * 0.56;
          pixels[at4 + 2] += (114 - pixels[at4 + 2]) * 0.56;
        }
      }
    }
  }
  triangle(s, a, b, c, color, face, bias, inkFrom, inkTo) {
    const dx = s[b] - s[a],
      dy = s[b + 1] - s[a + 1];
    const ex = s[c] - s[a],
      ey = s[c + 1] - s[a + 1];
    const area = dx * ey - dy * ex;
    // Screen Y increases downwards. Discard collapsed subpixel faces before
    // dividing by their projected area to interpolate depth.
    if (!(area < -1e-12)) return;
    const dzdx =
      ((s[b + 2] - s[a + 2]) * ey - (s[c + 2] - s[a + 2]) * dy) / area;
    const dzdy =
      (dx * (s[c + 2] - s[a + 2]) - ex * (s[b + 2] - s[a + 2])) / area;
    if (s[a + 1] > s[b + 1]) [a, b] = [b, a];
    if (s[b + 1] > s[c + 1]) [b, c] = [c, b];
    if (s[a + 1] > s[b + 1]) [a, b] = [b, a];
    const ax = s[a],
      ay = s[a + 1],
      az = s[a + 2] + bias;
    const cy = s[c + 1];
    const longSlope = (s[c] - ax) / (cy - ay);
    for (let half = 0; half < 2; half++) {
      const from = half ? b : a,
        to = half ? c : b;
      const first = Math.max(0, Math.ceil(s[from + 1] - 0.5));
      const last = Math.min(this.height, Math.ceil(s[to + 1] - 0.5));
      if (first >= last) continue;
      const slope = (s[to] - s[from]) / (s[to + 1] - s[from + 1]);
      for (let y = first; y < last; y++) {
        const x1 = ax + (y + 0.5 - ay) * longSlope;
        const x2 = s[from] + (y + 0.5 - s[from + 1]) * slope;
        const l = Math.max(0, Math.ceil(Math.min(x1, x2) - 0.5));
        const r = Math.min(this.width, Math.ceil(Math.max(x1, x2) - 0.5));
        const stop = y * this.width + r;
        let k = y * this.width + l;
        if (inkFrom) {
          for (; k < stop; k++) {
            if (this.face[k] >= inkFrom && this.face[k] < inkTo)
              this.color[k] = color;
          }
        } else {
          let z = az + (l + 0.5 - ax) * dzdx + (y + 0.5 - ay) * dzdy;
          for (; k < stop; k++, z += dzdx) {
            if (z > this.depth[k]) continue;
            this.depth[k] = z;
            this.face[k] = face;
            this.color[k] = color;
          }
        }
      }
    }
  }
  edge(s, a, b, owner, selected) {
    // Walk along the dominant axis. Only samples owned by this face can
    // receive its outline, even when another solid almost touches the edge.
    const steep = Math.abs(s[b + 1] - s[a + 1]) > Math.abs(s[b] - s[a]);
    const i = steep ? 1 : 0,
      j = 1 - i;
    if (s[b + i] < s[a + i]) [a, b] = [b, a];
    const dx = s[b + i] - s[a + i];
    if (dx < 1e-8) return;
    const slope = (s[b + j] - s[a + j]) / dx;
    const scale = 1 / Math.hypot(1, slope);
    const last = Math.min(
      steep ? this.height : this.width,
      Math.ceil(s[b + i] - 0.5),
    );
    for (let x = Math.max(0, Math.ceil(s[a + i] - 0.5)); x < last; x++) {
      const at = s[a + j] + (x + 0.5 - s[a + i]) * slope;
      const lo = Math.max(0, Math.floor(at - 1));
      const hi = Math.min(steep ? this.width : this.height, Math.ceil(at + 1));
      for (let y = lo; y < hi; y++) {
        const k = steep ? x * this.width + y : y * this.width + x;
        if (Math.abs(this.face[k]) !== owner) continue;
        const weight =
          Math.max(0, 1 - Math.abs(y + 0.5 - at) * scale) *
          (selected ? 1 : 0.7);
        const p = k * 4,
          pixels = this.image.data;
        // Same edges as WebGL: focus blue on the selected part, near black
        // elsewhere.
        pixels[p] += ((selected ? 76 : 21) - pixels[p]) * weight;
        pixels[p + 1] += ((selected ? 154 : 24) - pixels[p + 1]) * weight;
        pixels[p + 2] += ((selected ? 255 : 28) - pixels[p + 2]) * weight;
      }
    }
  }
}
