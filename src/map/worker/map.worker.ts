// Map worker entry (ADR 0020): wires the worker globals to MapWorkerCore.
// Loaded as a module worker by the app (src/map/spawn-worker.ts) and as
// an inline blob worker by the HTML replay (src/map/spawn-worker-inline.ts).

import type { MainToWorker, WorkerToMain } from '../protocol';
import { MapWorkerCore } from './core';
import { idbLearnedIds } from './ids';

interface WorkerScope {
  postMessage(m: WorkerToMain): void;
  addEventListener(type: 'message', fn: (e: MessageEvent<MainToWorker>) => void): void;
  requestAnimationFrame?: (cb: () => void) => number;
}

const scope = self as unknown as WorkerScope;
const raf = typeof scope.requestAnimationFrame === 'function' ? scope.requestAnimationFrame.bind(scope) : null;

const core = new MapWorkerCore({
  post: (m) => scope.postMessage(m),
  requestFrame: (cb) => void (raf ? raf(cb) : setTimeout(cb, 16)),
  fetch: (input, init) => fetch(input, init),
  now: () => performance.now(),
  ids: idbLearnedIds(),
});

scope.addEventListener('message', (e) => core.handle(e.data));
