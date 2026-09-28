// Starts the map worker: a module worker served next to the app. The HTML
// replay build aliases this module to ./spawn-worker-inline.ts
// (vite.config.ts `bundleReplay`), since a single-file replay cannot load
// a worker by URL.

export function spawnMapWorker(): Promise<Worker> {
  return Promise.resolve(new Worker(new URL('./worker/map.worker.ts', import.meta.url), { type: 'module', name: 'map' }));
}
