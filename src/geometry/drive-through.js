// What the rally pieces the cars drive through or past share: the outline of
// an arch, the turns that lay a sloping slab flat, a run cut into pieces
// that fit the plate, and the parts kept when the rest is freed.

/**
 * An opening in a wall's plane (u along it, v up): from v0 up its jambs at
 * u0 and u1 to `spring`, then half an ellipse rising `rise` more.
 */
export function archOutline(u0, u1, spring, rise, v0 = -1, n = 36) {
  const c = (u0 + u1) / 2,
    a = (u1 - u0) / 2;
  // From below where it springs, up its jambs; from where it springs, the curve alone.
  const pts = v0 < spring ? [[u0, v0], [u1, v0]] : [];
  for (let i = 0; i <= n; i++) {
    const t = (Math.PI * i) / n;
    pts.push([c + a * Math.cos(t), spring + rise * Math.sin(t)]);
  }
  return pts;
}

/** A run of `len` cut into as few equal pieces as are no longer than `room`: [from, to] of each. */
export function cutRun(len, room) {
  const n = Math.max(1, Math.ceil(len / room - 1e-9));
  return Array.from({ length: n }, (_, k) => [(len * k) / n, (len * (k + 1)) / n]);
}
/** As long as a piece may be to lie on the plate along its shorter side, less a little. */
export const plateRoom = (plate) => (plate ? Math.max(40, Math.min(plate.width, plate.depth) - 2 * (plate.margin ?? 0) - 4) : Infinity);

// The turn that lays a flat part with this normal on the plate: about x, or about y.
export const lieX = (n) => [(Math.atan2(n[1], n[2]) * 180) / Math.PI, 0, 0];
export const lieY = (n) => [0, (-Math.atan2(n[0], n[2]) * 180) / Math.PI, 0];

/** The parts, every other solid made on the way freed. */
export function keepParts(temp, parts) {
  const keep = new Set(parts.map((p) => p.solid));
  for (const s of temp) if (!keep.has(s)) s.delete();
  return parts;
}

/** The list of parts in a kit's notes, each with its size as it lies on the plate. */
export const partLines = (parts, sizes, fmt) => parts.map((p) => '- ' + p.name + (sizes[p.id] ? ': ' + sizes[p.id].map((v) => fmt(v)).join(' × ') + ' mm' : '')).join('\n');

/** Each number setting within its limits. */
export function checkLimits(b, limits, labels, unit = {}) {
  for (const [key, [min, max]] of Object.entries(limits))
    if (!Number.isFinite(b[key]) || b[key] < min || b[key] > max) throw Error(labels[key] + ' must be between ' + min + ' and ' + max + (unit[key] ?? ' mm') + '.');
}
export function checkKeys(b, defaults, what) {
  for (const key of Object.keys(b)) if (!Object.hasOwn(defaults, key)) throw Error('The ' + what + ' has an unknown setting: ' + key + '.');
}
