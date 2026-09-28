// Runs a map tool (src/map/tools.ts) in a short-lived module worker
// (src/map/worker/tools.worker.ts): the import check of Options → Panes →
// Mapper and the map subset of an HTML replay export. The worker is
// started per request and terminated after its answer, so it keeps no
// memory afterwards (arda.mm2 parsed is tens of MB). Where there are no
// workers (unit tests), the request runs inline.
//
// The main thread only posts the request (map bytes are transferred) and
// waits; parsing, subsetting and deflating happen in the worker.

import type { MapToolRequest, MapToolResponse } from './tools';

/** Starts the tools worker; null when workers are not available. */
function spawnToolsWorker(): Worker | null {
  if (typeof Worker !== 'function') return null;
  try {
    return new Worker(new URL('./worker/tools.worker.ts', import.meta.url), { type: 'module', name: 'map-tools' });
  } catch {
    return null;
  }
}

/** Runs `req`; resolves with the tool's answer (errors come as `{ ok: false }`). */
export async function runMapTool(req: MapToolRequest): Promise<MapToolResponse> {
  const worker = spawnToolsWorker();
  if (!worker) {
    const { runMapToolRequest } = await import('./tools');
    return runMapToolRequest(req, { fetch: (input, init) => fetch(input, init) });
  }
  const transfer: Transferable[] = [];
  if (req.t === 'validate') transfer.push(req.bytes);
  else if (req.source.kind === 'bytes') transfer.push(req.source.bytes);
  return new Promise<MapToolResponse>((resolve) => {
    const done = (res: MapToolResponse): void => {
      worker.terminate();
      resolve(res);
    };
    worker.addEventListener('message', (e: MessageEvent<MapToolResponse>) => done(e.data));
    worker.addEventListener('error', (e: ErrorEvent) => done({ ok: false, message: e.message || 'the map tools worker failed' }));
    worker.postMessage(req, transfer);
  });
}
