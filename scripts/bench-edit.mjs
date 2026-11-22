// Times an STL Edit live preview as the edit history grows.
// Run: node scripts/bench-edit.mjs
import init from 'manifold-3d';
const root = new URL('../', import.meta.url).href;
const { createEngine } = await import(root + 'src/engine.js');
const { newProject } = await import(root + 'src/project.js');

const wasm = await init();
wasm.setup();
const engine = createEngine(wasm);
const p = newProject();
p.mode = 'editor';
p.editor = { source: { label: 'Workshop enclosure', demoVersion: 2 }, ops: [] };
engine.build(p);
const [first] = engine.build(p, false);
const { min, max } = first.bounds;
console.log('demo part', first.positions.length / 3, 'vertices; size', max.map((v, i) => (v - min[i]).toFixed(0)).join(' × '));

// Small square pockets in the underside, one per step.
const pocket = (i) => {
  const cols = 8,
    x = min[0] + 8 + (i % cols) * ((max[0] - min[0] - 16) / cols),
    y = min[1] + 8 + Math.floor(i / cols) * 7;
  return {
    id: 'pocket-' + i,
    label: 'Pocket ' + (i + 1),
    target: 'body',
    type: 'cut',
    frame: { origin: [x, y, min[2]], normal: [0, 0, -1], u: [1, 0, 0], v: [0, -1, 0] },
    loops: [[[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]]],
    depth: 1,
  };
};
const time = (fn, runs = 3) => {
  const t = [];
  for (let i = 0; i < runs; i++) {
    const a = performance.now();
    fn();
    t.push(performance.now() - a);
  }
  return Math.min(...t);
};
for (let n = 0; n <= 40; n++) {
  if ([0, 5, 10, 20, 30, 40].includes(n)) {
    const trial = structuredClone(p);
    trial.editor.ops.push(pocket(n));
    const preview = time(() => engine.build(structuredClone(trial), false));
    console.log('history', n, 'steps · live preview of the next step', preview.toFixed(1), 'ms');
  }
  p.editor.ops.push(pocket(n));
  engine.build(structuredClone(p));
}
engine.dispose();
