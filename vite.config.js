import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Identifies the code that generates geometry. The Track Planner's device
// cache keys every stored piece by it, so pieces built by an older Foundry
// are never reused. Any source or kernel change gives a new ID.
function geometryId() {
  const hash = createHash('sha256');
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(js|mjs)$/.test(entry.name))
        hash.update(path + '|').update(readFileSync(path));
    }
  };
  walk('src');
  hash.update(readFileSync('node_modules/manifold-3d/package.json'));
  return hash.digest('hex').slice(0, 16);
}

// The geometry worker always receives its embedded WASM bytes. Use the
// browser branch of Emscripten's universal loader, including on file://.
const browserKernel = () => ({
  name: 'offline-manifold-worker',
  enforce: 'pre',
  transform(code, id) {
    if (!id.replaceAll('\\', '/').endsWith('/manifold-3d/manifold.js')) return;
    return code
      .replace('await import("node:module")', '({})')
      .replaceAll('import.meta.url', 'globalThis.location.href');
  },
});
export default defineConfig({
  define: { __FOUNDRY_GEOMETRY__: JSON.stringify(geometryId()) },
  plugins: [browserKernel(), viteSingleFile({ removeViteModuleLoader: true })],
  // Bundle the same installed geometry dependencies as the Node build.
  // The package's browser entry embeds an older copy of its tree library.
  resolve: {
    alias: [
      {
        find: /^polygon-clipping$/,
        replacement: 'polygon-clipping/dist/polygon-clipping.esm.js',
      },
    ],
  },
  // The worker's first imports should not trigger a second optimisation pass
  // and interrupt a geometry build while the development page is loading.
  optimizeDeps: {
    include: [
      'manifold-3d',
      '@xmldom/xmldom',
      'svgpath',
      'fflate',
      'polygon-clipping',
    ],
  },
  worker: { format: 'iife', plugins: () => [browserKernel()] },
  build: { target: 'es2022', chunkSizeWarningLimit: 12000 },
});
