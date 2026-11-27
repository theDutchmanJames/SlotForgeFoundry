// A kit of props on their own, to stand beside the track: so many of each,
// laid in a row on the table, each part printing flat as props do.

import { PROP_IDS, placeProp, propOf } from './props.js';

export const PROPS_DEFAULTS = Object.freeze({
  kind: 'props',
  items: Object.freeze([Object.freeze({ type: 'tyre-stack', count: 3 }), Object.freeze({ type: 'cone', count: 4 })]),
});
export const PROPS_KIT = Object.freeze({ kinds: 15, most: 12, gap: 4 });
const MANY = { workbench: ['top', 'end-1', 'end-2', 'shelf'], table: ['top', 'end-1', 'end-2'], 'pit-board': ['board', 'foot'], parasol: ['canopy', 'pole', 'foot'] };

/** The kit as kept: each item a known prop and how many, at most twelve of each. */
export function validatePropsKit(input) {
  const b = { ...PROPS_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  for (const key of Object.keys(b)) if (!Object.hasOwn(PROPS_DEFAULTS, key)) throw Error('The props have an unknown setting: ' + key + '.');
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > PROPS_KIT.kinds) throw Error('Choose 1 to ' + PROPS_KIT.kinds + ' kinds of prop.');
  const seen = new Set();
  b.items = b.items.map((it, i) => {
    if (!it || typeof it !== 'object' || Object.keys(it).some((k) => !['type', 'count'].includes(k))) throw Error('Prop ' + (i + 1) + ' has a type and a count.');
    if (!PROP_IDS.includes(it.type)) throw Error('Prop ' + (i + 1) + ': choose a prop from the list.');
    if (seen.has(it.type)) throw Error('The ' + propOf(it.type).name.toLowerCase() + ' is in the list twice: give it one count.');
    seen.add(it.type);
    if (!Number.isInteger(it.count) || it.count < 1 || it.count > PROPS_KIT.most) throw Error('Make 1 to ' + PROPS_KIT.most + ' of the ' + propOf(it.type).name.toLowerCase() + '.');
    return { type: it.type, count: it.count };
  });
  return b;
}

/** Where each prop stands in the row: its type and its footprint's corner. */
export function propsRow(b) {
  const out = [];
  let x = 0;
  for (const it of b.items)
    for (let k = 0; k < it.count; k++) {
      out.push({ type: it.type, x, y: 0, rotation: 0, n: k + 1 });
      x += propOf(it.type).size[0] + PROPS_KIT.gap;
    }
  return out;
}
/** The row on the table, [x0, y0, x1, y1]. */
export function propsFootprint(b) {
  const row = propsRow(b);
  const last = row.at(-1);
  return [0, 0, last.x + propOf(last.type).size[0], Math.max(...row.map((p) => propOf(p.type).size[1]))];
}
const partsOf = (b) =>
  propsRow(b).flatMap((p) =>
    (MANY[p.type] ?? ['']).map((key) => ({
      id: p.type + '-' + p.n + (key ? '-' + key : ''),
      name: propOf(p.type).name + (b.items.find((it) => it.type === p.type).count > 1 ? ' ' + p.n : '') + (key ? ', ' + key.replace('-', ' ') : ''),
      role: 'frame',
    })),
  );
export function propsLayout(input) {
  const b = validatePropsKit(input);
  return { building: b, parts: partsOf(b) };
}
export function buildPropsKit(wasm, input) {
  const b = validatePropsKit(input);
  const temp = [],
    own = (s) => (temp.push(s), s);
  try {
    const ids = partsOf(b);
    const parts = propsRow(b)
      .flatMap((p) => placeProp(wasm, own, p, 0))
      .map((q, i) => ({ ...ids[i], solid: q.solid, turn: q.pose, apart: [0, 0, 0] }));
    const keep = new Set(parts.map((p) => p.solid));
    for (const s of new Set(temp)) if (!keep.has(s)) s.delete();
    return parts;
  } catch (e) {
    for (const s of new Set(temp)) s.delete();
    throw e;
  }
}
