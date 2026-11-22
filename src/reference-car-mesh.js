// Original generic GT body. The envelope and all features scale together.
// X points forward, Y to the driver's left, and Z away from the road.
const fullSize = { length: 4600, width: 1900, height: 1200 };
const guideX = 0.32; // Fraction of body length ahead of its centre.

export function scaleCarDimensions(scale) {
  const { length, width, height } = fullSize;
  return { length: length / scale, width: width / scale, height: height / scale };
}

function surface(color) {
  return { color, positions: [], indices: [] };
}

// Each ring faces the positive axis along which the rings are swept.
function loft(surface, rings) {
  const n = rings[0].length;
  const start = surface.positions.length / 3;
  const last = start + (rings.length - 1) * n;
  for (const ring of rings)
    for (const point of ring) surface.positions.push(...point);
  for (let j = 1; j < n - 1; j++)
    surface.indices.push(start, start + j + 1, start + j, last, last + j, last + j + 1);
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = start + i * n + j, b = start + i * n + (j + 1) % n;
      surface.indices.push(a, b, b + n, a, b + n, a + n);
    }
  }
}

function box(surface, x0, x1, y0, y1, z0, z1) {
  loft(surface, [x0, x1].map(x => [[x,y0,z0], [x,y1,z0], [x,y1,z1], [x,y0,z1]]));
}

function mirroredPanel(surface, points, sign) {
  const start = surface.positions.length / 3;
  for (const [x, y, z] of points) surface.positions.push(x, sign * y, z);
  if (sign > 0) surface.indices.push(start, start + 2, start + 1, start, start + 3, start + 2);
  else surface.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

function body(surface, stations) {
  loft(surface, stations.map(([x, w, topWidth, bottom, shoulder, top]) => [
    [x, -w * 0.90, bottom], [x, w * 0.90, bottom],
    [x, w, (bottom + shoulder) / 2], [x, w, shoulder], [x, topWidth, top],
    [x, -topWidth, top], [x, -w, shoulder], [x, -w, (bottom + shoulder) / 2],
  ]));
}

function wheelRing(x, y, radius) {
  // Radii in X and Z must describe a circle in millimetres.
  const radiusX = radius * fullSize.height / fullSize.length;
  return Array.from({ length: 16 }, (_, i) => {
    const angle = i * Math.PI / 8;
    return [x + radiusX * Math.cos(angle), y, 0.26 - radius * Math.sin(angle)];
  });
}

function wheelFace(surface, axle, y, radius) {
  const ring = wheelRing(axle, y, radius);
  if (y < 0) ring.reverse();
  const start = surface.positions.length / 3;
  for (const vertex of ring) surface.positions.push(...vertex);
  for (let i = 1; i < ring.length - 1; i++)
    surface.indices.push(start, start + i, start + i + 1);
}

function spokes(surface, axle, side) {
  const y = side * 0.4995;
  for (let i = 0; i < 5; i++) {
    const angle = i * 2 * Math.PI / 5;
    const start = surface.positions.length / 3;
    for (const [r, offset] of [[0.04,-0.42], [0.15,-0.09], [0.15,0.08], [0.04,0.42]]) {
      surface.positions.push(axle + r * Math.cos(angle + offset) * fullSize.height / fullSize.length,
        y, 0.26 + r * Math.sin(angle + offset));
    }
    if (side < 0) surface.indices.push(start, start+1, start+2, start, start+2, start+3);
    else surface.indices.push(start, start+3, start+2, start, start+2, start+1);
  }
}

function makeBodywork() {
  const paint = surface(0xd56b31), glass = surface(0x334d59), trim = surface(0x252d32),
    alloy = surface(0xa4aaad), lights = surface(0xffecbf), tailLights = surface(0xba3437);
  body(paint, [
    [-0.48, 0.344, 0.31, 0.18, 0.43, 0.48], [-0.448, 0.445, 0.398, 0.14, 0.50, 0.55],
    [-0.292, 0.481, 0.446, 0.15, 0.54, 0.60], [-0.13, 0.457, 0.391, 0.16, 0.50, 0.54],
    [0.113, 0.448, 0.385, 0.15, 0.47, 0.54], [0.277, 0.486, 0.430, 0.14, 0.48, 0.55],
    [0.409, 0.447, 0.389, 0.14, 0.36, 0.41], [0.494, 0.298, 0.250, 0.125, 0.252, 0.29],
  ]);
  body(glass, [
    [-0.327, 0.319, 0.267, 0.53, 0.60, 0.62], [-0.166, 0.367, 0.262, 0.512, 0.64, 0.92],
    [-0.106, 0.374, 0.258, 0.51, 0.67, 0.992], [0.004, 0.362, 0.255, 0.51, 0.66, 0.987],
    [0.177, 0.328, 0.294, 0.508, 0.57, 0.585],
  ]);
  body(paint, [
    [-0.130, 0.245, 0.212, 0.94, 0.964, 0.968], [-0.105, 0.258, 0.221, 0.98, 0.997, 1],
    [0.003, 0.255, 0.217, 0.972, 0.991, 0.995], [0.023, 0.251, 0.207, 0.927, 0.943, 0.951],
  ]);
  // Splitter, raised rear wing and the thin wing uprights.
  body(trim, [[0.368,0.445,0.437,0.104,0.122,0.132], [0.47,0.390,0.380,0.104,0.12,0.132],
    [0.50,0.255,0.249,0.108,0.12,0.128]]);
  body(trim, [[-0.50,0.459,0.454,0.727,0.747,0.752], [-0.445,0.470,0.464,0.680,0.710,0.716]]);
  for (const sign of [-1, 1]) {
    const side = (a, b) => sign < 0 ? [-b, -a] : [a, b];
    box(trim, -0.465, -0.445, ...side(0.23, 0.245), 0.43, 0.72);
    for (const axle of [-0.291, 0.278]) {
      loft(trim, side(0.377, 0.495).map(y => wheelRing(axle, y, 0.26)));
      wheelFace(alloy, axle, sign * 0.497, 0.164);
      wheelFace(trim, axle, sign * 0.499, 0.148);
      spokes(alloy, axle, sign);
      wheelFace(alloy, axle, sign * 0.50, 0.05);
    }
    // Inset headlamp blades follow the sloping bonnet, and rear lamps face back.
    mirroredPanel(lights, [[0.407,0.285,0.422], [0.402,0.371,0.425],
      [0.452,0.332,0.344], [0.473,0.246,0.331]], sign);
    mirroredPanel(trim, [[-0.129,0.376,0.658], [-0.120,0.376,0.659],
      [-0.096,0.260,0.994], [-0.108,0.260,0.995]], sign);
    box(tailLights, -0.481, -0.479, ...side(0.160, 0.320), 0.377, 0.421);
  }
  return [paint, glass, trim, alloy, lights, tailLights].map(s => ({
    color: s.color, positions: Float32Array.from(s.positions), indices: Uint16Array.from(s.indices),
  }));
}

let bodywork;

export function referenceCarMeshes({ position, forward, scale }) {
  const { length, width, height } = scaleCarDimensions(scale);
  const [fx, fy, fz = 0] = forward;
  const xy = Math.hypot(fx, fy);
  const norm = Math.hypot(xy, fz);
  if (!xy || !Number.isFinite(norm)) return [];
  const [dx, dy, dz] = [fx / norm, fy / norm, fz / norm];
  const [lx, ly] = [-fy / xy, fx / xy];
  // The reference car follows the grade of the lane; its wheels sit at local Z=0.
  const [ux, uy, uz] = [-dz * ly, dz * lx, dx * ly - dy * lx];
  bodywork ??= makeBodywork();
  return bodywork.map(part => {
    const vertices = new Float32Array(part.positions.length);
    for (let i = 0; i < vertices.length; i += 3) {
      const x = (part.positions[i] - guideX) * length;
      const y = part.positions[i + 1] * width;
      const z = part.positions[i + 2] * height;
      vertices[i] = position[0] + x * dx + y * lx + z * ux;
      vertices[i + 1] = position[1] + x * dy + y * ly + z * uy;
      vertices[i + 2] = position[2] + x * dz + z * uz;
    }
    return { color: part.color, positions: vertices, indices: part.indices };
  });
}
