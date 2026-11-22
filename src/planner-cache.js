// Track Planner pieces built on this device, kept between sessions so a piece
// placed yesterday arrives fully built today. The cache is disposable: it
// lives in its own IndexedDB database, apart from the library and autosave,
// holds at most CACHE_BYTES and drops the least recently used pieces first.
// Each entry is keyed by the exact recipe (geometry settings, print plate,
// plate fitting, handedness) and by the geometry code that built it, so a new
// Foundry never serves meshes from an older generator.

/* global __FOUNDRY_GEOMETRY__ */
export const GEOMETRY_ID =
  typeof __FOUNDRY_GEOMETRY__ === 'string'
    ? __FOUNDRY_GEOMETRY__
    : 'unversioned';
export const CACHE_BYTES = 64 * 1024 * 1024;
const NAME = 'slotforge-planner-cache';

// The dev server stamps the generator ID once at start, while geometry code
// keeps changing under it, so it never keeps pieces between page loads.
const DEV = Boolean(import.meta.env?.DEV);
let opening = null;
function open() {
  if (DEV || typeof indexedDB === 'undefined') return Promise.resolve(null);
  opening ??= new Promise((resolve) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('pieces');
      request.result.createObjectStore('index');
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab deleting or upgrading the cache closes this connection.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    // No cache (private window, storage refused): build as before, and try
    // again on the next piece rather than for the rest of the session.
    const unavailable = () => {
      opening = null;
      resolve(null);
    };
    request.onerror = unavailable;
    request.onblocked = unavailable;
  });
  return opening;
}

export async function cacheKey(recipe) {
  const text = GEOMETRY_ID + '|' + JSON.stringify(recipe);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Approximate stored size: the mesh arrays dominate.
export function entrySize(value) {
  let bytes = 4096;
  const visit = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 6) return;
    if (ArrayBuffer.isView(v)) {
      bytes += v.byteLength;
      return;
    }
    for (const x of Array.isArray(v) ? v : Object.values(v)) {
      if (typeof x === 'number') bytes += 8;
      else visit(x, depth + 1);
    }
  };
  visit(value, 0);
  return bytes;
}

const done = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export async function readPiece(key) {
  try {
    const db = await open();
    if (!db) return null;
    const tx = db.transaction(['pieces', 'index'], 'readwrite');
    const value = await done(tx.objectStore('pieces').get(key));
    if (value) {
      const index = tx.objectStore('index');
      const entry = await done(index.get(key));
      if (entry) index.put({ ...entry, used: Date.now() }, key);
    }
    return value ?? null;
  } catch {
    return null;
  }
}

export async function storePiece(key, value) {
  try {
    const db = await open();
    if (!db) return;
    const size = entrySize(value);
    if (size > CACHE_BYTES / 4) return;
    const tx = db.transaction(['pieces', 'index'], 'readwrite');
    const pieces = tx.objectStore('pieces'),
      index = tx.objectStore('index');
    pieces.put(value, key);
    index.put({ size, used: Date.now() }, key);
    const [keys, entries] = await Promise.all([
      done(index.getAllKeys()),
      done(index.getAll()),
    ]);
    let total = entries.reduce((sum, e) => sum + e.size, 0);
    const oldest = keys
      .map((k, i) => [k, entries[i]])
      .filter(([k]) => k !== key)
      .sort((a, b) => a[1].used - b[1].used);
    for (const [k, e] of oldest) {
      if (total <= CACHE_BYTES) break;
      pieces.delete(k);
      index.delete(k);
      total -= e.size;
    }
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = resolve;
    });
  } catch {
    // A full or refused cache only means building again next time.
  }
}

export async function clearPieces() {
  const db = await open();
  if (!db) return;
  const tx = db.transaction(['pieces', 'index'], 'readwrite');
  tx.objectStore('pieces').clear();
  tx.objectStore('index').clear();
  await new Promise((resolve) => (tx.oncomplete = tx.onabort = resolve));
}
