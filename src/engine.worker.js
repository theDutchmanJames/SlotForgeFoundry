import Module from 'manifold-3d';
import wasmURL from 'manifold-3d/manifold.wasm?url&inline';
import { createEngine } from './engine.js';
import { creaseLineIndices, isTrackSurface } from './surface-features.js';
import { prepareSoftwareTrack } from './track-preview.js';

const ready = (async () => {
  const wasmBinary = await (await fetch(wasmURL)).arrayBuffer();
  const wasm = await Module({ wasmBinary, locateFile: () => wasmURL });
  wasm.setup();
  postMessage({ ready: true });
  return createEngine(wasm);
})();
let webgl = false;
onmessage = async ({ data }) => {
  if (data.type === 'viewport') {
    webgl = data.webgl;
    return;
  }
  const { id, method, args } = data;
  try {
    const engine = await ready;
    const value = engine[method](args);
    let transfers = [];
    if (method === 'build' || method === 'preview' || method === 'historySource') {
      if (!webgl && args?.mode === 'track') await prepareSoftwareTrack(value);
      for (const part of value) {
        transfers.push(part.positions.buffer, part.indices.buffer);
        if (webgl && isTrackSurface(part)) {
          part.creaseLines = creaseLineIndices(part);
          transfers.push(part.creaseLines.buffer);
        }
        if (part.previewIndices)
          transfers.push(part.previewIndices.buffer, part.previewMarks.buffer);
      }
    } else if (method === 'sectionView' && value) {
      transfers = value.flatMap((p) =>
        [p.positions, p.indices, p.capIndices].filter(Boolean).map((a) => a.buffer),
      );
    } else if (value instanceof Uint8Array) transfers.push(value.buffer);
    postMessage({ id, value }, transfers);
  } catch (e) {
    postMessage({ id, error: e?.message ?? String(e), warning: e?.warning });
  }
};
