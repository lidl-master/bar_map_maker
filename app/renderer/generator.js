// Promise wrapper around the generator worker.
const worker = new Worker(new URL('./gen-worker.js', import.meta.url), { type: 'module' });
const pending = new Map();
let nextId = 0;

worker.addEventListener('message', ({ data }) => {
  const job = pending.get(data.id);
  pending.delete(data.id);
  if ('error' in data) job.reject(new Error(data.error));
  else job.resolve(data.result);
});

// Fires when the worker (or a module it imports) fails to load; nothing queued can finish then.
worker.addEventListener('error', (event) => {
  for (const job of pending.values()) job.reject(new Error(`Terrain generator failed: ${event.message ?? 'worker did not load'}`));
  pending.clear();
});

/** runJob('newMap' | 'placeResources' | 'thumbnails', args) → result */
export function runJob(type, args) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, args });
  });
}
