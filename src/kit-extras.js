// Extras in a building's kit: the whole kit as one 3MF, its parts laid out
// on plates as they print; and its footprint on the table, full size, on A4
// sheets to tape together, to mark where it stands.
import { zipSync, strToU8 } from 'fflate';

/** A binary STL read back: its corners welded, [vertices, triangles]. */
export function stlMesh(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = view.getUint32(80, true);
  const verts = [],
    tris = [],
    index = new Map();
  const at = (o) => {
    const p = [view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true)];
    const key = p.map((v) => Math.round(v * 1e4)).join(',');
    let i = index.get(key);
    if (i === undefined) {
      i = verts.length;
      index.set(key, i);
      verts.push(p);
    }
    return i;
  };
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12;
    const tri = [at(o), at(o + 12), at(o + 24)];
    if (tri[0] !== tri[1] && tri[1] !== tri[2] && tri[0] !== tri[2]) tris.push(tri);
  }
  return { verts, tris };
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const PACK = Object.freeze({ gap: 5 });

/**
 * The parts laid on plates, each as it lies to print: in rows across the
 * plate, a new row when one is full, a new plate when the plate is. Each
 * part { name, mesh }; returns for each its plate and its place there.
 */
export function packParts(parts, plate) {
  const W = plate.width - 2 * (plate.margin ?? 0),
    D = plate.depth - 2 * (plate.margin ?? 0);
  const out = [];
  let p = 0,
    x = 0,
    y = 0,
    row = 0;
  // The tallest first, so the rows are even.
  const order = parts.map((part, i) => ({ part, i, size: sizeOf(part.mesh) })).sort((a, b) => b.size[1] - a.size[1]);
  for (const { part, i, size } of order) {
    let [w, d] = size;
    // Turned a quarter if it fits only that way.
    const turn = (w > W || d > D) && d <= W && w <= D;
    if (turn) [w, d] = [d, w];
    if (x && x + w > W) (x = 0), (y += row + PACK.gap), (row = 0);
    if (y && y + d > D) (p += 1), (x = 0), (y = 0), (row = 0);
    out[i] = { part, plate: p, x, y, turn, size: [w, d] };
    x += w + PACK.gap;
    row = Math.max(row, d);
  }
  return out;
}
function sizeOf({ verts }) {
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], v[k])), (hi[k] = Math.max(hi[k], v[k]));
  return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], lo];
}

/**
 * The kit as a 3MF: an object for each part, set out on plates side by side
 * (each plate's area marked by where its parts are), in millimetres. A part
 * with a colour ({ name, face } as a hex number) takes it as its material,
 * so a slicer can match it to a filament.
 */
export function kit3mf(title, parts, plate) {
  const placed = packParts(parts, plate);
  const plates = Math.max(1, ...placed.map((q) => q.plate + 1));
  const objects = [],
    items = [];
  // The colours, one material each, in the order the parts first use them.
  const materials = [];
  const materialOf = (c) => {
    if (!c) return -1;
    const key = c.name + ':' + c.face;
    let k = materials.findIndex((m) => m.key === key);
    if (k < 0) k = materials.push({ key, name: c.name, color: '#' + (c.face >>> 0).toString(16).padStart(6, '0').toUpperCase() + 'FF' }) - 1;
    return k;
  };
  const MATERIALS_ID = parts.length + 1;
  placed.forEach(({ part, plate: k, x, y, turn }, i) => {
    const { verts, tris } = part.mesh;
    const [, , , lo] = sizeOf(part.mesh);
    // Its own corner at the origin, turned if packed turned.
    const local = verts.map(([a, b, c]) => {
      const [u, v] = [a - lo[0], b - lo[1]];
      return turn ? [v, -u, c - lo[2]] : [u, v, c - lo[2]];
    });
    const minU = Math.min(...local.map((q) => q[0])),
      minV = Math.min(...local.map((q) => q[1]));
    const vs = local.map(([a, b, c]) => `<vertex x="${(a - minU).toFixed(4)}" y="${(b - minV).toFixed(4)}" z="${c.toFixed(4)}"/>`).join('');
    const ts = tris.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join('');
    const m = materialOf(part.colour);
    objects.push(`<object id="${i + 1}" name="${esc(part.name)}" type="model"${m < 0 ? '' : ` pid="${MATERIALS_ID}" pindex="${m}"`}><mesh><vertices>${vs}</vertices><triangles>${ts}</triangles></mesh></object>`);
    // Plates side by side along x, a plate's width and a gap apart.
    const ox = (plate.margin ?? 0) + k * (plate.width + 20) + x,
      oy = (plate.margin ?? 0) + y;
    items.push(`<item objectid="${i + 1}" transform="1 0 0 0 1 0 0 0 1 ${ox.toFixed(4)} ${oy.toFixed(4)} 0"/>`);
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-GB" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${esc(title)}</metadata>
<metadata name="Application">SlotForge Foundry</metadata>
<resources>${materials.length ? `<basematerials id="${MATERIALS_ID}">${materials.map((m) => `<base name="${esc(m.name)}" displaycolor="${m.color}"/>`).join('')}</basematerials>\n` : ''}${objects.join('\n')}</resources>
<build>${items.join('')}</build>
</model>`;
  const types = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  return { bytes: zipSync({ '[Content_Types].xml': strToU8(types), '_rels/.rels': strToU8(rels), '3D/3dmodel.model': strToU8(model) }, { level: 6 }), plates };
}

/** A4 portrait, printable area and the overlap between two sheets, in mm. */
export const SHEET = Object.freeze({ width: 210, height: 297, margin: 10, overlap: 15 });

/**
 * The footprint on the table, full size, on as many A4 sheets as it takes:
 * its outline, a cross at its middle, and on each sheet crosses at the
 * corners where the next one overlaps, its number, and a 10 mm bar to check
 * the scale. `outline` is the points round it in mm.
 */
export function footprintSheets(title, outline) {
  const xs = outline.map((p) => p[0]),
    ys = outline.map((p) => p[1]);
  const [x0, y0, x1, y1] = [Math.min(...xs) - 10, Math.min(...ys) - 10, Math.max(...xs) + 10, Math.max(...ys) + 10];
  const pw = SHEET.width - 2 * SHEET.margin,
    ph = SHEET.height - 2 * SHEET.margin - 12;
  const stepX = pw - SHEET.overlap,
    stepY = ph - SHEET.overlap;
  const cols = Math.max(1, Math.ceil((x1 - x0 - SHEET.overlap) / stepX)),
    rows = Math.max(1, Math.ceil((y1 - y0 - SHEET.overlap) / stepY));
  const sheets = [];
  const mid = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const f = (v) => Math.round(v * 100) / 100;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      // This sheet's window onto the plan: y up the plan is up the page.
      const wx = x0 + c * stepX,
        wy = y1 - r * stepY - ph;
      const map = ([x, y]) => [f(SHEET.margin + (x - wx)), f(SHEET.margin + 12 + (wy + ph - y))];
      const pts = outline.map(map).map((p) => p.join(',')).join(' ');
      const cross = ([x, y], s = 6) => `<path d="M${x - s} ${y}H${x + s}M${x} ${y - s}V${y + s}" stroke="#000" stroke-width="0.3"/>`;
      // Crosses at the four corners of the overlap, to line the sheets up.
      const marks = [
        [wx + SHEET.overlap / 2, wy + ph - SHEET.overlap / 2],
        [wx + pw - SHEET.overlap / 2, wy + ph - SHEET.overlap / 2],
        [wx + SHEET.overlap / 2, wy + SHEET.overlap / 2],
        [wx + pw - SHEET.overlap / 2, wy + SHEET.overlap / 2],
      ];
      const n = r * cols + c + 1;
      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET.width}mm" height="${SHEET.height}mm" viewBox="0 0 ${SHEET.width} ${SHEET.height}">
<text x="${SHEET.margin}" y="${SHEET.margin + 3}" font-size="4" font-family="sans-serif">${esc(title)} · footprint, full size · sheet ${n} of ${rows * cols} (row ${r + 1}, column ${c + 1})</text>
<text x="${SHEET.margin}" y="${SHEET.margin + 8}" font-size="2.6" font-family="sans-serif">Print at 100 % (actual size). Lay the sheets so their crosses meet, overlapping ${SHEET.overlap} mm, and tape them. The line is the edge of the base on the table.</text>
<path d="M${SHEET.margin} ${SHEET.height - SHEET.margin}h10" stroke="#000" stroke-width="0.6"/><text x="${SHEET.margin + 12}" y="${SHEET.height - SHEET.margin + 1}" font-size="2.6" font-family="sans-serif">10 mm</text>
<rect x="${SHEET.margin}" y="${SHEET.margin + 12}" width="${pw}" height="${ph}" fill="none" stroke="#999" stroke-width="0.2" stroke-dasharray="2 2"/>
<polygon points="${pts}" fill="none" stroke="#000" stroke-width="0.5"/>
${marks.map((p) => cross(map(p))).join('\n')}
${cross(map(mid), 4)}
</svg>
`;
      sheets.push({ name: 'footprint ' + n + '.svg', svg });
    }
  return sheets;
}
