// Times every step of a Track Planner "add piece" as the layout grows.
// Run: node scripts/bench-planner.mjs
import init from 'manifold-3d';

const root = new URL('../', import.meta.url).href;
const { createEngine } = await import(root + 'src/engine.js');
const { starterPack } = await import(root + 'src/library-profile.js');
const M = await import(root + 'src/planner-model.js');

const wasm = await init();
wasm.setup();
const engine = createEngine(wasm),
  plate = { width: 250, depth: 210, margin: 5 },
  stock = starterPack().pieces;
const defs = new Map();
for (const i of [0, 4, 5, 6, 7, 8, 9]) {
  const { name, track } = structuredClone(stock[i]);
  defs.set('s' + i, { name, ...engine.plannerSource({ track, plate, autoFit: true }) });
}
const layout = M.newLayout();
for (const [id, d] of defs) layout.sources[id] = { name: d.name, track: d.track };
console.log('sections per piece', [...defs].map(([k, d]) => d.name + ':' + d.sections.length).join(', '));

const order = ['s0', 's4', 's0', 's5', 's0', 's6', 's0', 's7', 's0', 's8', 's0', 's9'];
const totals = {};
let active = {};
const t = (label, fn) => {
  const a = performance.now();
  const r = fn();
  const ms = performance.now() - a;
  totals[label] = ms;
  return r;
};
for (let i = 0; i < 110; i++) {
  const src = order[i % order.length];
  const next = t('structuredClone', () => structuredClone(layout));
  // Alternate hands so the run snakes instead of closing a loop.
  const hand = Math.floor(i / 6) % 2 ? 'left' : 'right';
  try {
    active = t('placeSource', () => M.placeSource(next, defs, src, active.end, hand));
  } catch (e) {
    console.log('stop at', i, e.message);
    break;
  }
  Object.assign(layout, next);
  const rows = t('surfaces', () => M.surfaces(layout, defs));
  const hits = t('crossings', () => M.crossings(rows));
  t('supportRequests', () => M.supportRequests(rows));
  t('endsOf', () => M.endsOf(layout, defs));
  t('tally', () => M.tally(layout, defs));
  t('totalLength', () => M.totalLength(layout, defs));
  t('json', () => JSON.stringify(layout));
  if ([9, 29, 59, 89, 109].includes(i)) {
    const sum = Object.values(totals).reduce((a, b) => a + b, 0);
    console.log(
      'pieces', i + 1, 'sections', layout.nodes.length, 'hits', hits.length, 'total', sum.toFixed(1) + 'ms',
      Object.entries(totals).map(([k, v]) => k + '=' + v.toFixed(1)).join(' '),
    );
  }
}
