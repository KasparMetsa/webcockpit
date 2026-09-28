// Starts the map worker inside the single-file HTML replay (ADR 0020
// "Package notes"): Vite's `?worker&inline` embeds the worker bundle as
// base64 in the replay IIFE and starts it from a blob: URL (data: URL
// fallback), which works from file:// in Chrome and Firefox. Only the
// replay build uses this module (vite.config.ts aliases
// ./spawn-worker to it); the app keeps the normal module worker.

import MapWorker from './worker/map.worker.ts?worker&inline';

export function spawnMapWorker(): Promise<Worker> {
  return Promise.resolve(new MapWorker({ name: 'map' }));
}
