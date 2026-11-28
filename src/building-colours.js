// The colours a building is shown in: by what its walls and roof are made
// of (bricks red, planks brown), or a set of colours chosen for it. The
// joints of a texture take a colour of their own, like mortar between
// bricks, and the grain of wood a shade darker. The kit carries them in its
// 3MF and a paint list; the parts print in whatever filament is loaded.

/** The surfaces that take a colour of their own, in the order the panel lists them. */
export const SURFACES = Object.freeze([
  ['walls', 'Walls'],
  ['band', 'Lower walls'],
  ['roof', 'Roof'],
  ['trim', 'Windows and trim'],
  ['doors', 'Doors'],
  ['base', 'Base and floors'],
  ['floor', 'Floor texture'],
]);
// What each wall texture is made of, its colour and its joints'.
export const WALL_MATERIALS = Object.freeze({
  plain: { face: 0xd8d0bf },
  brick: { face: 0xa4533c, joint: 0xcdc6b8 },
  block: { face: 0xb0ada5, joint: 0x85827c },
  crack: { face: 0xb6b2a9, joint: 0x77746e },
  metal: { face: 0x8f9aa3, joint: 0x6c767e },
  planks: { face: 0x8f6a45, joint: 0x4a3524 },
  boards: { face: 0x7f5d3d, joint: 0x45321f },
  stone: { face: 0xa59c8b, joint: 0xd2ccc0 },
  timber: { face: 0xe9e2d2, joint: 0x4b3a2c },
  // A wall laid without mortar: grey stone, the gaps between them dark.
  drystone: { face: 0x9a958a, joint: 0x4f4c46 },
});
export const ROOF_MATERIALS = Object.freeze({
  plain: { face: 0x585e66 },
  tile: { face: 0xa3553b, joint: 0x6a3424 },
  metal: { face: 0x8d969d, joint: 0x666e75 },
  shingle: { face: 0x6f5b49, joint: 0x3e3228 },
  seam: { face: 0x56636c, joint: 0x3b454c },
});
// The top of a floor with a texture, inside the walls.
export const FLOOR_MATERIALS = Object.freeze({
  tiles: { face: 0xd8d2c4, joint: 0x8c877d },
  boards: { face: 0x9a7048, joint: 0x4a3524 },
  flags: { face: 0x9e978a, joint: 0x6b665d },
  slabs: { face: 0xaaa8a2, joint: 0x77756f },
  brick: { face: 0x9c4f3a, joint: 0xc9c2b4 },
});
// Joints in a colour chosen for the walls: mortar stays light round bricks
// and stones, every other joint is a shade of the colour.
const MORTAR = new Set(['brick', 'stone']);

/** The sets to start from; 'material' takes walls and roof from their textures. A band along the foot of the walls follows its texture in every set. */
export const COLOUR_SETS = Object.freeze([
  ['material', 'By material', { walls: null, roof: null, trim: 0xece7dc, doors: 0x3f6b4f, base: 0x6f757b }],
  ['redbrick', 'Red brick and slate', { walls: 0xa4533c, roof: 0x4b5058, trim: 0xf0ece2, doors: 0x2f4a6b, base: 0x6f757b }],
  ['yellowbrick', 'Yellow brick', { walls: 0xc9a86a, roof: 0x4b5058, trim: 0xf0ece2, doors: 0x6b2a2a, base: 0x6f757b }],
  ['whitewash', 'Whitewash and terracotta', { walls: 0xece7dc, roof: 0x9f5238, trim: 0x3c5a7a, doors: 0x3c5a7a, base: 0x7a746a }],
  ['timber', 'Weathered timber', { walls: 0x8b7a68, roof: 0x5b5048, trim: 0xcfc6b4, doors: 0x5a4a3a, base: 0x6a645c }],
  ['racing', 'Team colours', { walls: 0xe8e8e6, roof: 0x3a3f46, trim: 0xe5484d, doors: 0xe5484d, base: 0x4b5058 }],
  ['marshal', 'Marshal orange', { walls: 0xf0ece2, roof: 0xe2762f, trim: 0xe2762f, doors: 0xe2762f, base: 0x6f757b }],
  ['industrial', 'Industrial', { walls: 0x8c97a0, roof: 0x6f7880, trim: 0xd9a441, doors: 0x4a5561, base: 0x5b626c }],
]);
export const COLOURS_DEFAULT = Object.freeze({ set: 'material', walls: null, band: null, roof: null, trim: 0xece7dc, doors: 0x3f6b4f, base: 0x6f757b, floor: null });
// The surfaces that may follow their textures (null); the rest always have a colour.
export const BY_TEXTURE = new Set(['walls', 'band', 'roof', 'floor']);

const isHex = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffff;
/** Colours as kept: a set by name and its five colours; anything else is put right. */
export function checkColours(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const set = COLOUR_SETS.some(([id]) => id === raw.set) || raw.set === 'custom' ? raw.set : COLOURS_DEFAULT.set;
  const base = (COLOUR_SETS.find(([id]) => id === set) ?? COLOUR_SETS[0])[2];
  const out = { set };
  for (const [key] of SURFACES) {
    const v = raw[key];
    out[key] = isHex(v) ? v : v === null && BY_TEXTURE.has(key) ? null : key in base ? base[key] : COLOURS_DEFAULT[key];
  }
  return out;
}
/** The colours of a set, to start from. */
export function setColours(id) {
  const found = COLOUR_SETS.find(([key]) => key === id);
  return checkColours(found ? { set: id, ...found[2] } : null);
}

const darker = (hex, k) => {
  const r = (hex >> 16) & 255,
    g = (hex >> 8) & 255,
    b = hex & 255;
  return (Math.round(r * k) << 16) | (Math.round(g * k) << 8) | Math.round(b * k);
};
// A surface's colour, its joints' and its grain's, for a texture of a kind.
function surface(chosen, material, kind) {
  if (chosen === null) return { face: material.face, joint: material.joint ?? darker(material.face, 0.7), grain: darker(material.face, 0.84) };
  const joint = MORTAR.has(kind) ? material.joint : darker(chosen, 0.62);
  return { face: chosen, joint, grain: darker(chosen, 0.84) };
}
// Parts by what they are: the roles of a building's parts.
const TRIM = new Set(['frame', 'lip', 'brace']);
const BASE = new Set(['buildingBase', 'floor']);

/**
 * The paint for a building's parts in these colours: a function giving a
 * part's { face, joint, grain }. A part's texture comes from its joints;
 * a wall with none is plain.
 */
export function buildingPaint(colours, parts = []) {
  const c = checkColours(colours);
  // A stepped gable has no joints of its own: it is built of what most walls are.
  const most = new Map();
  for (const p of parts) if (p.joints?.surface === 'wall') most.set(p.joints.kind, (most.get(p.joints.kind) ?? 0) + 1);
  const walls = [...most].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'plain';
  return (part) => {
    const j = part.joints ?? (/gable/.test(part.id) && part.role === 'wall' ? { surface: 'wall', kind: walls } : null);
    // A base or a floor with a texture: the part in the base's colour, its floor in the texture's.
    if (j?.surface === 'floor') return { face: c.base, floor: surface(c.floor, FLOOR_MATERIALS[j.kind] ?? FLOOR_MATERIALS.tiles, j.kind) };
    if (part.role === 'roof' || j?.surface === 'roof') {
      const kind = j?.surface === 'roof' ? j.kind : 'plain';
      return surface(c.roof, ROOF_MATERIALS[kind] ?? ROOF_MATERIALS.plain, kind);
    }
    if (part.role === 'wall' || part.role === 'divider' || j) {
      const kind = j?.kind ?? 'plain';
      const own = surface(c.walls, WALL_MATERIALS[kind] ?? WALL_MATERIALS.plain, kind);
      // A band along its foot in its own colours, below the height it reaches up to.
      const b = j?.band;
      return b ? { ...own, lower: { ...surface(c.band, WALL_MATERIALS[b.kind] ?? WALL_MATERIALS.plain, b.kind), below: b.below } } : own;
    }
    if (part.role === 'door') return { face: c.doors };
    if (TRIM.has(part.role)) return { face: c.trim };
    if (BASE.has(part.role)) return { face: c.base };
    // Anything else (a prop, a stand's seats) keeps the colour of its role.
    return null;
  };
}
/** A colour as the colour input shows it, and back. */
export const hexText = (v) => '#' + (v >>> 0).toString(16).padStart(6, '0');
export const textHex = (s) => (/^#[0-9a-f]{6}$/i.test(s) ? parseInt(s.slice(1), 16) : null);

// The names of the textures, for the paint list.
const WALL_WORDS = { plain: 'smooth', brick: 'bricks', block: 'concrete blocks', crack: 'concrete', metal: 'corrugated metal', planks: 'planks', boards: 'boards', stone: 'stone', timber: 'half-timbered', drystone: 'dry stone' };
const ROOF_WORDS = { plain: 'smooth', tile: 'tiles', metal: 'corrugated sheet', shingle: 'shingles', seam: 'standing seams' };
const FLOOR_WORDS = { tiles: 'square tiles', boards: 'floorboards', flags: 'flagstones', slabs: 'concrete slabs', brick: 'brick paving' };
const SURFACE_OF = (part) => {
  const j = part.joints;
  if (j?.surface === 'floor') return 'base';
  if (part.role === 'roof' || j?.surface === 'roof') return 'roof';
  if (part.role === 'wall' || part.role === 'divider' || j) return 'walls';
  if (part.role === 'door') return 'doors';
  if (TRIM.has(part.role)) return 'trim';
  if (BASE.has(part.role)) return 'base';
  return null;
};
/**
 * Each part's colour, by its id: the surface it belongs to, a name for it
 * ('Walls, bricks'), its colour and its joints', and a wall's band
 * ({ name, kind, face, joint }). A part with no colour of its own (a prop)
 * is left out.
 */
export function partColours(colours, parts) {
  const paint = buildingPaint(colours, parts);
  const walls = parts.find((p) => p.joints?.surface === 'wall');
  const out = new Map();
  for (const p of parts) {
    const c = paint(p);
    const surface = SURFACE_OF(p);
    if (!c || !surface) continue;
    const j = p.joints ?? (/gable/.test(p.id) && walls ? walls.joints : null);
    const kind = surface === 'walls' ? j?.kind ?? 'plain' : surface === 'roof' ? (j?.surface === 'roof' ? j.kind : 'plain') : null;
    const words = surface === 'walls' ? WALL_WORDS[kind] : surface === 'roof' ? ROOF_WORDS[kind] : null;
    const label = SURFACES.find(([k]) => k === surface)[1];
    const band = c.lower && { surface: 'band', kind: j.band.kind, name: 'Lower walls, ' + WALL_WORDS[j.band.kind], face: c.lower.face, joint: c.lower.joint };
    const floor = c.floor && { surface: 'floor', kind: j.kind, name: 'Floors, ' + (FLOOR_WORDS[j.kind] ?? j.kind), face: c.floor.face, joint: c.floor.joint };
    out.set(p.id, { surface, kind, name: words && kind !== 'plain' ? label + ', ' + words : label, face: c.face, joint: kind && kind !== 'plain' ? c.joint : null, ...(band && { band }), ...(floor && { floor }) });
  }
  return out;
}
const HEX = (v) => hexText(v).toUpperCase();
/** The paint list for the kit notes: each colour, the parts in it, and how to bring out its joints. */
export function paintList(colours, parts) {
  const groups = new Map();
  const count = (c) => {
    const key = c.name + c.face + ':' + c.joint;
    const g = groups.get(key) ?? { ...c, count: 0 };
    g.count++;
    groups.set(key, g);
  };
  for (const c of partColours(colours, parts).values()) {
    count(c);
    if (c.band) count(c.band);
    if (c.floor) count(c.floor);
  }
  if (!groups.size) return [];
  const order = SURFACES.map(([k]) => k);
  const lines = [...groups.values()]
    .sort((a, b) => order.indexOf(a.surface) - order.indexOf(b.surface))
    .map((g) => {
      const parts = g.count + (g.count > 1 ? ' parts' : ' part');
      if (!g.joint) return `- ${g.name}: ${HEX(g.face)} (${parts}).`;
      const how = MORTAR.has(g.kind)
        ? 'paint them ' + HEX(g.face) + ', then work ' + HEX(g.joint) + ' into the joints and wipe the faces clean before it dries'
        : 'paint them ' + HEX(g.face) + ', then a thin wash of ' + HEX(g.joint) + ' settles in the joints and the grain';
      return `- ${g.name} (${parts}): ${how}.`;
    });
  const set = COLOUR_SETS.find(([id]) => id === checkColours(colours).set);
  return [
    'Colours' + (set ? ' (' + set[1] + ')' : ''),
    ...lines,
    'Paint the parts before you glue them. Printing in colour: the 3MF gives each part its colour, to match to the filaments you have.',
  ];
}
