// What every building kit is held to: each part one whole body that fits the
// plate, no part inside another, and nothing but the base, floors and roofs
// printing over air (they print over the tops of their pockets).
import assert from 'node:assert/strict';
import { printPose, printSize, fitsPlate } from '../src/geometry/building.js';

/** The area of the faces of a part, laid for printing, that face down over air (mm²). */
export function overAir(part) {
  const printed = printPose(part),
    m = printed.getMesh();
  let over = 0;
  for (let i = 0; i < m.triVerts.length; i += 3) {
    const v = [0, 1, 2].map((k) => Array.from(m.vertProperties.subarray(m.triVerts[i + k] * m.numProp, m.triVerts[i + k] * m.numProp + 3)));
    const a = v[1].map((x, j) => x - v[0][j]),
      c = v[2].map((x, j) => x - v[0][j]);
    const n = [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]],
      len = Math.hypot(...n);
    if (len && n[2] / len < -0.71 && Math.min(v[0][2], v[1][2], v[2][2]) > 0.05) over += len / 2;
  }
  printed.delete();
  return over;
}

export function checkKit(parts, plate, label = '') {
  for (const p of parts) {
    const bodies = p.solid.decompose();
    assert.equal(bodies.length, 1, label + p.name + ' is in ' + bodies.length + ' bodies');
    bodies.forEach((s) => s.delete());
    if (plate) assert.ok(fitsPlate(printSize(p), plate), label + p.name + ': ' + printSize(p));
    if (!/^(base|roof|floor)/.test(p.id) && !/-roof-/.test(p.id)) assert.ok(overAir(p) <= 0.5, label + p.name + ' prints ' + overAir(p).toFixed(1) + ' mm² over air');
  }
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const both = parts[i].solid.intersect(parts[j].solid);
      assert.ok(both.volume() < 0.01, label + parts[i].name + ' and ' + parts[j].name + ' overlap by ' + both.volume());
      both.delete();
    }
}
