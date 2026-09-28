// The map tools worker (src/map/tools.ts): one request per worker, then
// the client terminates it. Started by src/map/tools-client.ts for an
// import check (Options → Mapper) or an HTML replay export, so the
// app's main thread never parses a map.

import { type MapToolRequest, type MapToolResponse, runMapToolRequest } from '../tools';

interface ToolsScope {
  postMessage(m: MapToolResponse, transfer?: Transferable[]): void;
  addEventListener(type: 'message', fn: (e: MessageEvent<MapToolRequest>) => void): void;
}

const scope = self as unknown as ToolsScope;

scope.addEventListener('message', (e) => {
  void runMapToolRequest(e.data, { fetch: (input, init) => fetch(input, init) }).then((res) => {
    const mm2 = res.ok && res.t === 'subset' ? res.result.mm2 : null;
    scope.postMessage(res, mm2 ? [mm2.buffer] : []);
  });
});
