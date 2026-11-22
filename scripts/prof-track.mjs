// CPU profile of building one Track Set piece (default R6 corner).
// Run: node --cpu-prof --cpu-prof-dir=<dir> scripts/prof-track.mjs [piece index]
import init from 'manifold-3d';
const root = new URL('../', import.meta.url).href;
const { buildTrack } = await import(root + 'src/track.js');
const { starterPack } = await import(root + 'src/library-profile.js');
const wasm = await init();
wasm.setup();
const piece = starterPack().pieces[Number(process.argv[2] ?? 9)];
for (let i = 0; i < 6; i++) buildTrack(wasm, piece.track.params, piece.track.plan).forEach((x) => x.solid.delete());
console.log('profiled', piece.name);
