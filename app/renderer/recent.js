// Local autosave: the maps you work on, kept in IndexedDB (this app's origin, inside Electron's userData folder).
// 'meta' holds the small list the welcome screen shows; 'docs' holds the MapDocs (typed arrays clone natively).
// A map stays until the user removes it from Recent maps: nothing is ever evicted. An exported .sd7 can be reopened
// from the Open screen, so it doubles as a file copy of a map.
const DB_NAME = 'bar-map-studio';

let dbPromise = null;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('meta', { keyPath: 'key' });
      request.result.createObjectStore('docs', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/** Runs fn(...objectStores) in one transaction; resolves with the result of the request fn returns, if any. */
async function run(stores, mode, fn) {
  const tx = (await db()).transaction(stores, mode);
  const request = fn(...stores.map((s) => tx.objectStore(s)));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

/** Saves doc under key with a small preview ({size, rgba}). */
export async function saveMap(key, doc, thumb) {
  const meta = {
    key, thumb, savedAt: Date.now(), name: doc.settings.name, sx: doc.sx, sz: doc.sz, biome: doc.biome,
    players: doc.objects.filter((o) => o.type === 'start').length,
  };
  await run(['meta', 'docs'], 'readwrite', (metas, docs) => {
    metas.put(meta);
    docs.put({ key, doc });
  });
}

/** Deletes a saved map; only the user does this (Recent maps → Remove). */
export function removeMap(key) {
  return run(['meta', 'docs'], 'readwrite', (metas, docs) => {
    metas.delete(key);
    docs.delete(key);
  });
}

/** Newest first. */
export async function listMaps() {
  const all = await run(['meta'], 'readonly', (metas) => metas.getAll());
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

export async function loadMap(key) {
  const record = await run(['docs'], 'readonly', (docs) => docs.get(key));
  if (!record) throw new Error('This map is no longer stored on this computer.');
  return record.doc;
}
