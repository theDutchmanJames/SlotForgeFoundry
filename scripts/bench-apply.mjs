// Times Apply after a live preview of the same Track Set piece.
// Run: node scripts/bench-apply.mjs
import init from 'manifold-3d';
const root = new URL('../', import.meta.url).href;
const { createEngine } = await import(root + 'src/engine.js');
const { starterPack } = await import(root + 'src/library-profile.js');
const { newProject } = await import(root + 'src/project.js');
const wasm = await init();
wasm.setup();
const engine = createEngine(wasm);
for (const i of [0, 4, 9]) {
  const piece = starterPack().pieces[i];
  const p = newProject();
  p.track = structuredClone(piece.track);
  engine.build(structuredClone(p));
  for (const angle of [31, 32]) {
    if (p.track.params.kind === 'curve') p.track.params.angle = angle;
    else p.track.params.length += 10;
    let a = performance.now();
    engine.preview(structuredClone(p));
    const preview = performance.now() - a;
    a = performance.now();
    engine.build(structuredClone(p));
    console.log(piece.name, 'preview', preview.toFixed(0), 'ms · Apply', (performance.now() - a).toFixed(0), 'ms');
  }
}
console.log(engine.buildStats());
engine.dispose();
