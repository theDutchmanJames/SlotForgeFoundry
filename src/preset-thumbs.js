// The thumbnail of each standard building, packed into the app as data URLs
// (rendered by scripts/preset-thumbnails.mjs). A preset without one shows its
// name alone.
const files = import.meta.glob('./assets/presets/*.webp', { eager: true, query: '?inline', import: 'default' });
const THUMBS = Object.fromEntries(Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -5), url]));
export const presetThumb = (id) => THUMBS[id] ?? null;
